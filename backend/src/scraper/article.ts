import { load, type CheerioAPI } from 'cheerio';
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

// Some plugins (AIOSEO + theme) emit two og:image tags — site default first,
// page-specific second. The last one wins.
function getLastMeta($: CheerioAPI, property: string): string | null {
  let val: string | null = null;
  $(`meta[property="${property}"]`).each((_, el) => {
    const c = $(el).attr('content');
    if (c) val = c;
  });
  return val;
}

function stripSiteSuffix(title: string): string {
  return title.replace(/\s*[-–—|]\s*Gamigion.*$/i, '').trim();
}

function deriveSlug(url: string): string {
  const m = /\/([a-z0-9-]+)\/?$/i.exec(url);
  return m ? m[1] : '';
}

export async function fetchArticle(url: string): Promise<ScrapedArticle> {
  const html = await fetchHtml(url);
  const $ = load(html);

  const ogTitle = getFirstMeta($, 'og:title');
  const h1 = $('h1.typify-pagecaption').first().text().trim();
  const title = stripSiteSuffix(ogTitle ?? h1 ?? '') || h1 || 'Untitled';

  const featuredImage = getLastMeta($, 'og:image');

  const publishedRaw = getFirstMeta($, 'article:published_time');
  const publishedAt = publishedRaw ? new Date(publishedRaw) : null;

  const author =
    $('a[href*="/author/"]').first().text().trim() ||
    $('.typify-authorbox__cn a').first().text().trim() ||
    null;

  const category = $('a[href*="/category/"]').first().text().trim() || null;

  // Prefer `.typify-the_content` — it's the article body without the share-row
  // and author-bio that get nested inside `.typify-entrycontent` by the theme.
  let body = $('.typify-the_content').first();
  if (body.length === 0) body = $('.typify-entrycontent').first();
  if (body.length === 0) body = $('article .typify-post__content').first();

  // Backstop: even when the inner selector matched, some posts include share /
  // author markup inline. Strip anything that looks like share UI or authorbox.
  body
    .find(
      [
        '.typify-single-post-footer',
        '.typify-sharerow',
        '.typify-author-section',
        '.typify-authorbox',
        '[class*="reaktions"]',
        '[class*="sharebox"]',
      ].join(', '),
    )
    .remove();

  // Resolve lazy-loaded images: copy data-src onto src; drop the lazy attrs.
  body.find('img').each((_, el) => {
    const $img = $(el);
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

  // Final-pass cleaner is the source of truth for what counts as noise —
  // shared between fresh scrapes and retroactive DB sweeps.
  const bodyHtml = cleanBodyHtml(body.html()?.trim() ?? '');

  const images: string[] = [];
  body.find('img').each((_, el) => {
    const src = $(el).attr('src');
    if (src && !src.startsWith('data:') && !images.includes(src)) {
      images.push(src);
    }
  });

  const links: string[] = [];
  body.find('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && /^https?:\/\//i.test(href) && !links.includes(href)) {
      links.push(href);
    }
  });

  return {
    sourceUrl: url,
    title,
    slug: deriveSlug(url),
    author: author || null,
    publishedAt,
    category: category || null,
    featuredImage,
    bodyHtml,
    images,
    links,
  };
}
