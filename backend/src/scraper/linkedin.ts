import { load, type CheerioAPI } from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { fetchHtml } from './http';
import { cleanBodyHtml } from './cleaner';
import type { ScrapedArticle } from './article';

// LinkedIn Pulse / newsletter URLs look like:
//   https://www.linkedin.com/pulse/<slug>-<authorHash>
//   https://www.linkedin.com/pulse/<slug>-<authorHash>/?trackingId=...
export function isLinkedInArticleUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return false;
    return /\/pulse\//i.test(u.pathname);
  } catch {
    return false;
  }
}

// Newsletter landing page (lists all editions) — e.g.
//   https://www.linkedin.com/newsletters/gaming-business-briefing-7415347940648681472/
export function isLinkedInNewsletterUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return false;
    return /\/newsletters\//i.test(u.pathname);
  } catch {
    return false;
  }
}

function canonicalizePulseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return raw;
  }
}

// Extract all Pulse article URLs referenced from a newsletter landing page.
// Returns canonical URLs (no query/hash, no trailing slash), de-duped, in the
// order they first appear in the HTML.
export async function fetchLinkedInNewsletterEditionUrls(url: string): Promise<string[]> {
  if (!isLinkedInNewsletterUrl(url)) {
    throw new Error('URL is not a LinkedIn newsletter landing page (/newsletters/…)');
  }
  const html = await fetchHtml(url);
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /https?:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/pulse\/[^"'\s<>]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const canon = canonicalizePulseUrl(m[0]);
    if (!seen.has(canon)) {
      seen.add(canon);
      out.push(canon);
    }
  }
  return out;
}

type JsonLdArticle = {
  '@type'?: string | string[];
  headline?: string;
  articleBody?: string;
  image?: string | { url?: string } | Array<string | { url?: string }>;
  datePublished?: string;
  author?:
    | string
    | { name?: string }
    | Array<string | { name?: string }>;
};

function flattenJsonLd(node: unknown, out: JsonLdArticle[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const n of node) flattenJsonLd(n, out);
    return;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    const types = Array.isArray(t) ? t : t ? [t] : [];
    if (types.some((x) => typeof x === 'string' && /article|newsarticle|blogposting/i.test(x))) {
      out.push(obj as JsonLdArticle);
    }
    if (Array.isArray(obj['@graph'])) flattenJsonLd(obj['@graph'], out);
  }
}

function readJsonLdArticles($: CheerioAPI): JsonLdArticle[] {
  const out: JsonLdArticle[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      flattenJsonLd(JSON.parse(raw), out);
    } catch {
      // ignore malformed JSON-LD blocks
    }
  });
  return out;
}

function pickImage(image: JsonLdArticle['image']): string | null {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) {
    for (const it of image) {
      const v = pickImage(it);
      if (v) return v;
    }
    return null;
  }
  return image.url ?? null;
}

function pickAuthor(author: JsonLdArticle['author']): string | null {
  if (!author) return null;
  if (typeof author === 'string') return author;
  if (Array.isArray(author)) {
    for (const a of author) {
      const v = pickAuthor(a);
      if (v) return v;
    }
    return null;
  }
  return author.name ?? null;
}

function getFirstMeta($: CheerioAPI, attr: 'property' | 'name', value: string): string | null {
  const c = $(`meta[${attr}="${value}"]`).first().attr('content');
  return c?.trim() || null;
}

function deriveSlug(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? '';
  } catch {
    return '';
  }
}

// Convert plain text articleBody (JSON-LD often stores it as text) into
// simple <p>…</p> HTML, so the editor and WP both render paragraphs.
function textToHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}|\r{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs
    .map((p) => `<p>${p.replace(/\n/g, '<br />')}</p>`)
    .join('\n');
}

function collectImagesAndLinks(bodyHtml: string): { images: string[]; links: string[] } {
  const $ = load(`<div id="__b">${bodyHtml}</div>`);
  const images: string[] = [];
  $('#__b img').each((_, el) => {
    const src = $(el).attr('src');
    if (src && !src.startsWith('data:') && !images.includes(src)) images.push(src);
  });
  const links: string[] = [];
  $('#__b a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && /^https?:\/\//i.test(href) && !links.includes(href)) links.push(href);
  });
  return { images, links };
}

export async function fetchLinkedInArticle(url: string): Promise<ScrapedArticle> {
  if (!isLinkedInArticleUrl(url)) {
    throw new Error('URL is not a LinkedIn Pulse / newsletter article');
  }

  const html = await fetchHtml(url);
  const $ = load(html);

  const articles = readJsonLdArticles($);
  const ld = articles[0] ?? null;

  // Title — on LinkedIn newsletters, JSON-LD `headline` is often the article's
  // intro paragraph, not the title. og:title and <title> are reliably the real
  // headline, so prefer them and fall back to JSON-LD only as a last resort.
  const ogTitle = getFirstMeta($, 'property', 'og:title') ?? getFirstMeta($, 'name', 'title');
  const docTitle = $('title').first().text().trim() || null;
  const title = (ogTitle ?? docTitle ?? ld?.headline ?? 'Untitled').trim() || 'Untitled';

  const featuredImage =
    pickImage(ld?.image) ?? getFirstMeta($, 'property', 'og:image') ?? null;

  const publishedRaw =
    ld?.datePublished ?? getFirstMeta($, 'property', 'article:published_time');
  const publishedAt = publishedRaw ? new Date(publishedRaw) : null;

  const author =
    pickAuthor(ld?.author) ??
    getFirstMeta($, 'name', 'author') ??
    null;

  // Body extraction.
  // 1) Prefer JSON-LD articleBody when it's HTML-ish.
  // 2) Fall back to Readability on the page HTML.
  // 3) Final fallback: plain-text articleBody promoted to paragraphs.
  let bodyHtml = '';
  if (ld?.articleBody && /<\w+[^>]*>/.test(ld.articleBody)) {
    bodyHtml = ld.articleBody;
  } else {
    const dom = new JSDOM(html, { url });
    const parsed = new Readability(dom.window.document).parse();
    if (parsed?.content && parsed.content.trim().length > 0) {
      bodyHtml = parsed.content;
    } else if (ld?.articleBody) {
      bodyHtml = textToHtml(ld.articleBody);
    }
  }

  // Resolve lazy-loaded images so the body has real <img src>.
  if (bodyHtml) {
    const body$ = load(`<div id="__body">${bodyHtml}</div>`);
    body$('#__body img').each((_, el) => {
      const $img = body$(el);
      const dataSrc = $img.attr('data-src') || $img.attr('data-delayed-url');
      const src = $img.attr('src');
      const real =
        dataSrc && !dataSrc.startsWith('data:')
          ? dataSrc
          : src && !src.startsWith('data:')
          ? src
          : null;
      if (real) $img.attr('src', real);
      $img.removeAttr('data-src').removeAttr('data-delayed-url').removeAttr('data-lazyloaded');
    });
    bodyHtml = body$('#__body').html()?.trim() ?? '';
  }

  bodyHtml = cleanBodyHtml(bodyHtml);

  if (!bodyHtml) {
    throw new Error(
      'Could not extract the article body from LinkedIn. The page may require login or have changed format.',
    );
  }

  const { images, links } = collectImagesAndLinks(bodyHtml);

  return {
    sourceUrl: url,
    title,
    slug: deriveSlug(url),
    author,
    publishedAt,
    category: null,
    featuredImage,
    bodyHtml,
    images,
    links,
  };
}
