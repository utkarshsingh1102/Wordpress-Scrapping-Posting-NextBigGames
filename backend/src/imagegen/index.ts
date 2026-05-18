import fs from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { prisma } from '../db';
import { analyzeImage } from './visionAnalyzer';
import { writeImagePrompt } from './promptWriter';
import { generateImage } from './imageGenerator';
import { config } from '../config';

// Where generated PNGs live on disk. Served at /generated/<filename> by
// the static middleware in src/index.ts.
export const GENERATED_DIR = path.resolve(
  process.cwd(),
  'storage/generated',
);
const PUBLIC_PREFIX = '/generated';

async function ensureGeneratedDir(): Promise<void> {
  await fs.mkdir(GENERATED_DIR, { recursive: true });
}

function publicUrlForFile(filename: string): string {
  // Absolute URL so WP can fetch it during publish-time media upload.
  // In prod, set PUBLIC_BASE_URL to the deployed backend origin so WordPress
  // can actually reach the file (localhost is unreachable from a remote WP host).
  const base = config.publicBaseUrl ?? `http://localhost:${config.port}`;
  return `${base}${PUBLIC_PREFIX}/${filename}`;
}

/**
 * End-to-end pipeline:
 *   1. Pick the first image of the blog post (featuredImage, else first <img> in body).
 *   2. Pull a plain-text summary from the body HTML (first ~600 chars).
 *   3. Vision-analyse the reference image with gpt-4o.
 *   4. Ask gpt-4o to write a final editorial-banner prompt following the
 *      formula codified in promptBuilder.ts (derived from the worked examples
 *      in WEBSITE POST + PROMPT.docx).
 *   5. Call gpt-image-2 / ChatGPT Images 2.0 with that prompt and return the PNG bytes.
 *
 * This is pure: it does not mutate the post. Callers can persist / replace
 * the image as they see fit.
 */

export type RegenerateResult = {
  referenceImageUrl: string;
  visionAnalysis: string;
  generatedPrompt: string;
  image: { binary: Buffer; mimeType: string };
  models: { vision: string; promptWriter: string; image: string };
  persisted?: {
    publicUrl: string;
    diskPath: string;
    bodyImageReplaced: boolean;
  };
};

function firstBodyImage(bodyHtml: string): string | null {
  const $ = load(bodyHtml);
  const src = $('img').first().attr('src');
  return src ?? null;
}

function htmlToSummary(bodyHtml: string, maxChars = 600): string {
  const $ = load(bodyHtml);
  $('script, style').remove();
  const text = $.text().replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? text.slice(0, maxChars) + '…' : text;
}

function replaceFirstImgSrc(html: string, newSrc: string): {
  html: string;
  replaced: boolean;
} {
  const $ = load(html, null, false);
  const first = $('img').first();
  if (first.length === 0) return { html, replaced: false };
  first.attr('src', newSrc);
  // Strip lazy-load attrs that would otherwise win over src.
  first.removeAttr('data-src');
  first.removeAttr('srcset');
  first.removeAttr('data-srcset');
  return { html: $.html(), replaced: true };
}

export async function regenerateFirstImageForPost(opts: {
  postId: number;
  openaiApiKey: string;
  size?: '1536x1024' | '1024x1536' | '1024x1024';
  persist?: boolean; // default true — replaces featured image + first body img
}): Promise<RegenerateResult> {
  const post = await prisma.post.findUnique({ where: { id: opts.postId } });
  if (!post) throw new Error(`Post ${opts.postId} not found`);

  // Prefer the ORIGINAL source image. On re-regeneration, post.featuredImage
  // points at a previously-generated localhost URL, which would (a) drift the
  // style on each round and (b) fail because OpenAI's vision endpoint can't
  // reach localhost. Fall back through original → current featured → first
  // body image so we always start from the most authentic reference.
  const referenceImageUrl =
    post.originalFeaturedImage ?? post.featuredImage ?? firstBodyImage(post.bodyHtml);
  if (!referenceImageUrl) {
    throw new Error(`Post ${opts.postId} has no first image to regenerate`);
  }

  const summary = htmlToSummary(post.rewrittenBodyHtml ?? post.bodyHtml);

  const vision = await analyzeImage({
    imageUrl: referenceImageUrl,
    apiKey: opts.openaiApiKey,
  });

  const written = await writeImagePrompt({
    apiKey: opts.openaiApiKey,
    input: {
      blogTitle: post.title,
      blogSummary: summary,
      referenceImageAnalysis: vision.description,
    },
  });

  const image = await generateImage({
    apiKey: opts.openaiApiKey,
    prompt: written.prompt,
    size: opts.size,
  });

  let persisted: RegenerateResult['persisted'];
  if (opts.persist !== false) {
    await ensureGeneratedDir();
    const filename = `post-${post.id}-${Date.now()}.png`;
    const diskPath = path.join(GENERATED_DIR, filename);
    await fs.writeFile(diskPath, image.binary);
    const publicUrl = publicUrlForFile(filename);

    // Swap the first <img src=...> in both stored body variants.
    const bodySwap = replaceFirstImgSrc(post.bodyHtml, publicUrl);
    const rewrittenSwap = post.rewrittenBodyHtml
      ? replaceFirstImgSrc(post.rewrittenBodyHtml, publicUrl)
      : { html: null as string | null, replaced: false };

    // Keep imagesJson in sync — replace the old reference URL entry if present.
    let images: string[] = [];
    try {
      const parsed = JSON.parse(post.imagesJson);
      if (Array.isArray(parsed)) images = parsed as string[];
    } catch {
      // imagesJson corrupted — start fresh
    }
    const idx = images.indexOf(referenceImageUrl);
    if (idx >= 0) {
      images[idx] = publicUrl;
    } else {
      images.unshift(publicUrl);
    }

    await prisma.post.update({
      where: { id: post.id },
      data: {
        featuredImage: publicUrl,
        bodyHtml: bodySwap.html,
        rewrittenBodyHtml: rewrittenSwap.html ?? post.rewrittenBodyHtml,
        imagesJson: JSON.stringify(images),
        originalFeaturedImage: post.originalFeaturedImage ?? referenceImageUrl,
        generatedImagePath: path.relative(process.cwd(), diskPath),
        generatedImagePrompt: written.prompt,
      },
    });

    persisted = {
      publicUrl,
      diskPath,
      bodyImageReplaced: bodySwap.replaced || rewrittenSwap.replaced,
    };
  }

  return {
    referenceImageUrl,
    visionAnalysis: vision.description,
    generatedPrompt: written.prompt,
    image: { binary: image.binary, mimeType: image.mimeType },
    models: {
      vision: vision.model,
      promptWriter: written.model,
      image: image.model,
    },
    persisted,
  };
}

/**
 * Standalone variant: regenerate from raw inputs without a DB-backed post.
 * Useful for ad-hoc testing or for callers that already have the image URL
 * and article text in hand.
 */
export async function regenerateFromImageUrl(opts: {
  imageUrl: string;
  blogTitle: string;
  blogSummary: string;
  openaiApiKey: string;
  size?: '1536x1024' | '1024x1536' | '1024x1024';
}): Promise<RegenerateResult> {
  const vision = await analyzeImage({
    imageUrl: opts.imageUrl,
    apiKey: opts.openaiApiKey,
  });
  const written = await writeImagePrompt({
    apiKey: opts.openaiApiKey,
    input: {
      blogTitle: opts.blogTitle,
      blogSummary: opts.blogSummary,
      referenceImageAnalysis: vision.description,
    },
  });
  const image = await generateImage({
    apiKey: opts.openaiApiKey,
    prompt: written.prompt,
    size: opts.size,
  });
  return {
    referenceImageUrl: opts.imageUrl,
    visionAnalysis: vision.description,
    generatedPrompt: written.prompt,
    image: { binary: image.binary, mimeType: image.mimeType },
    models: {
      vision: vision.model,
      promptWriter: written.model,
      image: image.model,
    },
  };
}
