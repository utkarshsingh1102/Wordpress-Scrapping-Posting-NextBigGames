import { load } from 'cheerio';
import { fetchHtml } from './http';

// Single-segment URLs on gamigion.com that are NOT article posts.
const NON_ARTICLE_SLUGS = new Set([
  'about',
  'events',
  'feed',
  'jobs',
  'journal',
  'games-radar',
  'highlights',
  'trending',
  'game-analysis',
  'contact',
  'privacy-policy',
  'terms-of-service',
  'login',
  'register',
  'category',
  'author',
  'tag',
  'page',
  'comments',
  'wp-login',
  'wp-admin',
  'wp-json',
]);

const ARTICLE_URL_RE = /^https:\/\/www\.gamigion\.com\/([a-z0-9-]+)\/$/i;

export async function fetchPostUrls(homepageUrl: string, limit: number): Promise<string[]> {
  const html = await fetchHtml(homepageUrl);
  const $ = load(html);
  const urls: string[] = [];
  const seen = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const m = ARTICLE_URL_RE.exec(href);
    if (!m) return;
    const slug = m[1].toLowerCase();
    if (NON_ARTICLE_SLUGS.has(slug)) return;
    if (seen.has(href)) return;
    seen.add(href);
    urls.push(href);
  });

  return urls.slice(0, limit);
}
