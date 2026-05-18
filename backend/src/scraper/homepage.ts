import { load } from 'cheerio';
import { fetchHtml } from './http';

// Path segments that are never article URLs on any WP-style site.
const NON_ARTICLE_PATH_PREFIXES = [
  '/category/',
  '/tag/',
  '/author/',
  '/page/',
  '/feed',
  '/wp-login',
  '/wp-admin',
  '/wp-json',
  '/comments/',
  '/login',
  '/register',
];

const NON_ARTICLE_PATHS = new Set([
  '/',
  '/about',
  '/about/',
  '/contact',
  '/contact/',
  '/privacy-policy',
  '/privacy-policy/',
  '/terms-of-service',
  '/terms-of-service/',
  '/events',
  '/events/',
  '/jobs',
  '/jobs/',
]);

function isProbablyArticleUrl(url: URL): boolean {
  const path = url.pathname;
  if (NON_ARTICLE_PATHS.has(path)) return false;
  if (NON_ARTICLE_PATH_PREFIXES.some((p) => path.startsWith(p))) return false;
  // Need something past the leading slash. Single-segment slugs OK
  // (e.g. /my-article-title/), multi-segment OK (e.g. /2026/05/article/).
  if (path.length <= 1) return false;
  return true;
}

export async function fetchPostUrls(homepageUrl: string, limit: number): Promise<string[]> {
  const html = await fetchHtml(homepageUrl);
  const $ = load(html);

  const home = new URL(homepageUrl);
  const urls: string[] = [];
  const seen = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    let abs: URL;
    try {
      abs = new URL(href, homepageUrl);
    } catch {
      return;
    }

    // Same host only — avoids picking up outbound links / ad URLs.
    if (abs.hostname !== home.hostname) return;
    if (!isProbablyArticleUrl(abs)) return;

    // Strip query + fragment so we don't dedup ?utm_source variants.
    const normalised = `${abs.origin}${abs.pathname}`;
    if (seen.has(normalised)) return;
    seen.add(normalised);
    urls.push(normalised);
  });

  return urls.slice(0, limit);
}
