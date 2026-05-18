import { load } from 'cheerio';
import { http, fetchHtml } from './http';

// Article URL discovery is layered, ordered by reliability:
//   1. WordPress REST API   — JSON of recent posts; works on any WP site
//   2. RSS / Atom feed      — universal blog standard
//   3. Homepage heuristics  — last resort, filters out section pages

const COMMON_FEED_PATHS = [
  '/feed/',
  '/feed',
  '/rss/',
  '/rss',
  '/feed.xml',
  '/rss.xml',
  '/atom.xml',
  '/feed/atom/',
  '/index.rss',
  '/index.xml',
];

// Look for feed URLs in the homepage HTML. Two sources:
//   - <link rel="alternate" type="application/rss+xml" href="..."> (W3C standard,
//     but plenty of sites omit it)
//   - <a href> values containing rss / feed / atom in the path
function discoverFeedUrlsFromHtml(html: string, homepageUrl: string): string[] {
  const $ = load(html);
  const found = new Set<string>();
  $(
    'link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"], link[rel="alternate"][type="application/xml"]',
  ).each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      try {
        found.add(new URL(href, homepageUrl).toString());
      } catch {
        /* skip invalid */
      }
    }
  });
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    if (!/(\.rss($|\?)|\.atom($|\?)|\/rss($|\/|\?)|\/feed($|\/|\?)|\/atom($|\/|\?))/i.test(href)) {
      return;
    }
    try {
      found.add(new URL(href, homepageUrl).toString());
    } catch {
      /* skip invalid */
    }
  });
  return [...found];
}

const NON_ARTICLE_PATH_PREFIXES = [
  '/category/',
  '/tag/',
  '/author/',
  '/page/',
  '/feed',
  '/rss',
  '/wp-login',
  '/wp-admin',
  '/wp-json',
  '/wp-content/',
  '/wp-includes/',
  '/comments/',
  '/search',
  '/login',
  '/register',
];

const NON_ARTICLE_EXACT_PATHS = new Set([
  '/',
  '/about',
  '/about/',
  '/contact',
  '/contact/',
  '/privacy-policy',
  '/privacy-policy/',
  '/privacy',
  '/privacy/',
  '/terms-of-service',
  '/terms-of-service/',
  '/terms',
  '/terms/',
  '/events',
  '/events/',
  '/jobs',
  '/jobs/',
  // Common section landing pages that should be filtered out — these show
  // article lists, not articles themselves.
  '/news',
  '/news/',
  '/blog',
  '/blog/',
  '/articles',
  '/articles/',
  '/posts',
  '/posts/',
  '/features',
  '/features/',
  '/feature',
  '/feature/',
  '/reviews',
  '/reviews/',
  '/review',
  '/review/',
  '/games',
  '/games/',
  '/guides',
  '/guides/',
  '/videos',
  '/videos/',
]);

async function tryWordPressApi(homepageUrl: string, limit: number): Promise<string[]> {
  try {
    const url = new URL('/wp-json/wp/v2/posts', homepageUrl);
    url.searchParams.set('per_page', String(Math.min(limit, 100)));
    url.searchParams.set('_fields', 'link');
    url.searchParams.set('orderby', 'date');
    url.searchParams.set('order', 'desc');
    const res = await http.get<Array<{ link?: string }>>(url.toString(), {
      timeout: 12000,
      responseType: 'json',
    });
    if (Array.isArray(res.data)) {
      const links = res.data
        .map((p) => (typeof p?.link === 'string' ? p.link : null))
        .filter((l): l is string => !!l);
      if (links.length > 0) {
        console.log(`[scraper] WP REST API found ${links.length} posts for ${homepageUrl}`);
        return links.slice(0, limit);
      }
    }
  } catch {
    /* fall through to RSS */
  }
  return [];
}

async function fetchFeedLinks(feedUrl: string, limit: number): Promise<string[]> {
  const res = await http.get<string>(feedUrl, {
    timeout: 12000,
    responseType: 'text',
    headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9' },
  });
  const $ = load(res.data, { xmlMode: true });
  const links: string[] = [];
  // RSS 2.0: <item><link>URL</link></item>
  $('item > link').each((_, el) => {
    const text = $(el).text().trim();
    if (text && /^https?:\/\//i.test(text)) links.push(text);
  });
  // Atom: <entry><link href="URL" />
  $('entry > link').each((_, el) => {
    const href = $(el).attr('href');
    if (href && /^https?:\/\//i.test(href)) links.push(href);
  });
  return links.slice(0, limit);
}

async function tryRssFeed(
  homepageUrl: string,
  limit: number,
  homepageHtml: string | null,
): Promise<string[]> {
  const candidates = new Set<string>();

  // 1. Discover feeds from homepage HTML (most reliable — points at the
  //    site's real feed even if it lives at a non-standard path).
  if (homepageHtml) {
    for (const url of discoverFeedUrlsFromHtml(homepageHtml, homepageUrl)) {
      candidates.add(url);
    }
  }

  // 2. Add common path guesses as fallback.
  for (const path of COMMON_FEED_PATHS) {
    try {
      candidates.add(new URL(path, homepageUrl).toString());
    } catch {
      /* skip */
    }
  }

  for (const feedUrl of candidates) {
    try {
      const links = await fetchFeedLinks(feedUrl, limit);
      if (links.length > 0) {
        console.log(
          `[scraper] feed ${feedUrl} found ${links.length} entries for ${homepageUrl}`,
        );
        return links;
      }
    } catch {
      /* try next */
    }
  }
  return [];
}

function isProbablyArticleUrl(url: URL, homeHost: string): boolean {
  if (url.hostname !== homeHost) return false;
  const path = url.pathname.toLowerCase();
  if (NON_ARTICLE_EXACT_PATHS.has(path)) return false;
  if (NON_ARTICLE_PATH_PREFIXES.some((p) => path.startsWith(p))) return false;
  // Need more than just a section name. Article URLs typically look like:
  //   /news/some-article-slug/
  //   /2026/05/article-title/
  //   /post/12345-the-title/
  // Section landings like /news/ have only one segment and were caught above.
  const segments = path.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
  if (segments.length === 0) return false;
  if (segments.length === 1) {
    // One-segment paths only qualify if they look slug-like — multi-word with
    // dashes and reasonably long. This rules out /news but allows /my-article.
    const seg = segments[0];
    return seg.length >= 15 && seg.includes('-');
  }
  return true;
}

function extractArticleLinksFromHtml(
  homepageUrl: string,
  html: string,
  limit: number,
): string[] {
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
    if (!isProbablyArticleUrl(abs, home.hostname)) return;
    const normalised = `${abs.origin}${abs.pathname}`;
    if (seen.has(normalised)) return;
    seen.add(normalised);
    urls.push(normalised);
  });

  if (urls.length > 0) {
    console.log(`[scraper] homepage heuristics found ${urls.length} candidates for ${homepageUrl}`);
  }
  return urls.slice(0, limit);
}

export async function fetchPostUrls(homepageUrl: string, limit: number): Promise<string[]> {
  // 1. WordPress REST API.
  const wp = await tryWordPressApi(homepageUrl, limit);
  if (wp.length > 0) return wp;

  // Fetch homepage HTML once — used by both feed discovery and heuristics.
  let homepageHtml: string | null = null;
  try {
    homepageHtml = await fetchHtml(homepageUrl);
  } catch {
    /* RSS-only sites might fail homepage fetch; we'll still try common paths */
  }

  // 2. RSS / Atom feed (discovered from HTML or common paths).
  const rss = await tryRssFeed(homepageUrl, limit, homepageHtml);
  if (rss.length > 0) return rss;

  // 3. Heuristic article-URL extraction from homepage HTML.
  if (!homepageHtml) return [];
  return extractArticleLinksFromHtml(homepageUrl, homepageHtml, limit);
}
