import path from 'node:path';
import { prisma } from '../db';
import { http } from '../scraper/http';
import {
  uploadMedia,
  createPost,
  resolveAuthorId,
  type WpMedia,
} from '../wp/client';
import { shouldSkipImage } from '../wp/imageFilter';
import { withRetry } from '../util/retry';
import { getEffectiveSettings } from '../services/settings';

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'image';
}

function ensureExtension(filename: string, mimeType: string): string {
  if (path.extname(filename)) return filename;
  return filename + (MIME_EXT[mimeType] ?? '.bin');
}

type DownloadedAsset = {
  binary: Buffer;
  mimeType: string;
  filename: string;
};

async function downloadAsset(url: string): Promise<DownloadedAsset> {
  return withRetry(
    async () => {
      const res = await http.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        headers: { Accept: 'image/*,*/*;q=0.8' },
      });
      const ct = res.headers['content-type'];
      const mimeType =
        (typeof ct === 'string' ? ct.split(';')[0].trim() : '') ||
        'application/octet-stream';
      const urlPath = new URL(url).pathname;
      const rawName = decodeURIComponent(path.basename(urlPath)) || `image-${Date.now()}`;
      const filename = ensureExtension(sanitizeFilename(rawName), mimeType);
      return { binary: Buffer.from(res.data), mimeType, filename };
    },
    { label: `download ${url}` },
  );
}

// Strip WP's `-WxH` size suffix to get the original (larger) variant.
// e.g. image-142-620x331.png → image-142.png
function stripWpSizeSuffix(url: string): string | null {
  const m = /^(.+)-\d+x\d+(\.[a-z0-9]+)(\?.*)?$/i.exec(url);
  if (!m) return null;
  return m[1] + m[2] + (m[3] ?? '');
}

// Try the un-sized original first (better quality for WP to resample from);
// fall back to the URL as-is if the original 404s.
async function downloadAssetLargestAvailable(
  url: string,
): Promise<DownloadedAsset> {
  const original = stripWpSizeSuffix(url);
  if (original && original !== url) {
    try {
      return await downloadAsset(original);
    } catch {
      // 404 / missing original → fall through
    }
  }
  return downloadAsset(url);
}

export type PublishResult = {
  postId: number;
  wpPostId: number;
  wpLink: string;
  featuredImageUploaded: boolean;
  bodyImagesUploaded: number;
  bodyImagesSkipped: number;
  bodyImageErrors: string[];
};

export async function publishPost(postId: number): Promise<PublishResult> {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) throw new Error(`Post ${postId} not found`);
  if (post.status === 'published') {
    throw new Error(
      `Post ${postId} already published (wpPostId=${post.wpPostId})`,
    );
  }

  // Resolve author up-front so we fail fast before any media uploads.
  const settings = await getEffectiveSettings();
  let authorId: number | undefined;
  if (settings.wp.authorUsername) {
    authorId = await resolveAuthorId(settings.wp.authorUsername);
  }

  let featuredMedia: WpMedia | null = null;
  if (post.featuredImage) {
    const asset = await downloadAssetLargestAvailable(post.featuredImage);
    featuredMedia = await uploadMedia(asset);
  }

  const urlMap: Record<string, string> = {};
  if (featuredMedia && post.featuredImage) {
    urlMap[post.featuredImage] = featuredMedia.source_url;
  }

  const bodyImages = JSON.parse(post.imagesJson) as string[];
  const bodyImageErrors: string[] = [];
  let bodyImagesUploaded = 0;
  let bodyImagesSkipped = 0;

  for (const imgUrl of bodyImages) {
    if (urlMap[imgUrl]) continue;
    if (shouldSkipImage(imgUrl)) {
      bodyImagesSkipped++;
      continue;
    }
    try {
      const asset = await downloadAsset(imgUrl);
      const media = await uploadMedia(asset);
      urlMap[imgUrl] = media.source_url;
      bodyImagesUploaded++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      bodyImageErrors.push(`${imgUrl}: ${msg}`);
      bodyImagesSkipped++;
    }
  }

  let bodyHtml = post.bodyHtml;
  for (const [oldUrl, newUrl] of Object.entries(urlMap)) {
    bodyHtml = bodyHtml.split(oldUrl).join(newUrl);
  }

  const wpPost = await createPost({
    title: post.title,
    content: bodyHtml,
    status: 'draft',
    featuredMedia: featuredMedia?.id,
    date: post.publishedAt,
    authorId,
  });

  await prisma.post.update({
    where: { id: post.id },
    data: {
      status: 'published',
      wpPostId: wpPost.id,
      wpPublishedAt: new Date(),
    },
  });

  return {
    postId: post.id,
    wpPostId: wpPost.id,
    wpLink: wpPost.link,
    featuredImageUploaded: featuredMedia !== null,
    bodyImagesUploaded,
    bodyImagesSkipped,
    bodyImageErrors,
  };
}
