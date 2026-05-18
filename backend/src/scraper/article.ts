import { load, type CheerioAPI } from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { fetchHtml } from './http';
import { cleanBodyHtml } from './cleaner';

export type ScrapedArticle = {
  sourceUrl: string;
  title: string;
  slug: string;
  author: string | null;
  publishedAt: Date | null;
  category: string | null;
  featuredImage: string | null;
  bodyHtml: string;
  images: string[];
  links: string[];
};

function getFirstMeta($: CheerioAPI, property: string): string | null {
  const c = $(`meta[property="${property}"]`).first().attr('content');
  return c ?? null;
}

// Some sites emit two og:image tags — site default first, page-specific second.
function getLastMeta($: CheerioAPI, property: string): string | null {
  let val: string | null = null;
  $(`meta[property="${property}"]`).each((_, el) => {
    const c = $(el).attr('content');
    if (c) val = c;
  });
  return val;
}

function deriveSlug(url: string): string {
  const m = /\/([a-z0-9-]+)\/?$/i.exec(url);
  return m ? m[1] : '';
}

// Try to lift a category from a same-site link to /category/foo.
function extractCategory($: CheerioAPI): string | null {
  const link = $('a[href*="/category/"]').first();
  if (link.length === 0) return null;
  const text = link.text().trim();
  return text || null;
}

export async function fetchArticle(url: string): Promise<ScrapedArticle> {
  const html = await fetchHtml(url);

  // Meta-tag extraction is universal across WordPress + most CMSes — keep it.
  const $ = load(html);
  const ogTitle = getFirstMeta($, 'og:title');
  const featuredImage = getLastMeta($, 'og:image');
  const publishedRaw = getFirstMeta($, 'article:published_time');
  const publishedAt = publishedRaw ? new Date(publishedRaw) : null;

  // Body extraction via Mozilla Readability — same library Firefox Reader Mode
  // uses. Works on ~85% of blog/news sites with zero per-site config.
  const dom = new JSDOM(html, { url });
  const parsed = new Readability(dom.window.document).parse();

  const title = (ogTitle ?? parsed?.title ?? 'Untitled').trim() || 'Untitled';
  const author = parsed?.byline?.trim() || $('a[href*="/author/"]').first().text().trim() || null;
  const rawBody = parsed?.content ?? '';

  // Resolve lazy-loaded images, dedup, collect link list.
  const body$ = load(`<div id="__body">${rawBody}</div>`);
  const root = body$('#__body');
  root.find('img').each((_, el) => {
    const $img = body$(el);
    const dataSrc = $img.attr('data-src');
    const src = $img.attr('src');
    const real = dataSrc && !dataSrc.startsWith('data:')
      ? dataSrc
      : src && !src.startsWith('data:')
        ? src
        : null;
    if (real) $img.attr('src', real);
    $img.removeAttr('data-src').removeAttr('data-lazyloaded');
  });

  const bodyHtml = cleanBodyHtml(root.html()?.trim() ?? '');

  const images: string[] = [];
  body$('#__body img').each((_, el) => {
    const src = body$(el).attr('src');
    if (src && !src.startsWith('data:') && !images.includes(src)) images.push(src);
  });

  const links: string[] = [];
  body$('#__body a[href]').each((_, el) => {
    const href = body$(el).attr('href');
    if (href && /^https?:\/\//i.test(href) && !links.includes(href)) links.push(href);
  });

  return {
    sourceUrl: url,
    title,
    slug: deriveSlug(url),
    author,
    publishedAt,
    category: extractCategory($),
    featuredImage,
    bodyHtml,
    images,
    links,
  };
}
