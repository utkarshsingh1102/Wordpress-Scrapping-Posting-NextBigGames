import { Router } from 'express';
import { prisma } from '../db';
import {
  fetchLinkedInArticle,
  fetchLinkedInNewsletterEditionUrls,
  isLinkedInArticleUrl,
  isLinkedInNewsletterUrl,
} from '../scraper/linkedin';
import { sleep } from '../util/retry';

const router = Router();

const POLITE_DELAY_MS = 400;

type EditionResult =
  | { url: string; ok: true; created: boolean; postId: number; title: string }
  | { url: string; ok: false; error: string };

type NewsletterScrapeResult = {
  newsletterId: number | null;
  newsletterUrl: string;
  ok: boolean;
  error?: string;
  editionsFound: number;
  results: EditionResult[];
  summary: { total: number; created: number; existed: number; failed: number };
};

function canonicalize(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

function summarize(results: EditionResult[]) {
  return {
    total: results.length,
    created: results.filter((r) => r.ok && r.created).length,
    existed: results.filter((r) => r.ok && !r.created).length,
    failed: results.filter((r) => !r.ok).length,
  };
}

async function scrapeOneEdition(url: string): Promise<EditionResult> {
  try {
    const canonical = canonicalize(url);
    const existing = await prisma.post.findUnique({ where: { sourceUrl: canonical } });
    if (existing) {
      // Re-scraping a previously discarded URL should make the post visible
      // again — otherwise the UI reports "existed" but Review's default
      // "scraped" filter hides it and the user thinks the scrape did nothing.
      if (existing.status === 'discarded') {
        await prisma.post.update({
          where: { id: existing.id },
          data: { status: 'scraped' },
        });
      }
      return {
        url: canonical,
        ok: true,
        created: false,
        postId: existing.id,
        title: existing.title,
      };
    }
    const article = await fetchLinkedInArticle(canonical);
    const post = await prisma.post.create({
      data: {
        sourceUrl: article.sourceUrl,
        title: article.title,
        slug: article.slug,
        author: article.author,
        publishedAt: article.publishedAt,
        category: article.category,
        featuredImage: article.featuredImage,
        bodyHtml: article.bodyHtml,
        imagesJson: JSON.stringify(article.images),
        linksJson: JSON.stringify(article.links),
        status: 'scraped',
        source: 'linkedin',
        sourceSiteId: null,
      },
    });
    return { url: canonical, ok: true, created: true, postId: post.id, title: post.title };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { url, ok: false, error: msg };
  }
}

async function scrapeNewsletter(
  newsletterUrl: string,
  newsletterId: number | null,
): Promise<NewsletterScrapeResult> {
  if (!isLinkedInNewsletterUrl(newsletterUrl)) {
    return {
      newsletterId,
      newsletterUrl,
      ok: false,
      error: 'URL is not a LinkedIn newsletter landing page (/newsletters/…)',
      editionsFound: 0,
      results: [],
      summary: { total: 0, created: 0, existed: 0, failed: 0 },
    };
  }

  let editions: string[];
  try {
    editions = await fetchLinkedInNewsletterEditionUrls(newsletterUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      newsletterId,
      newsletterUrl,
      ok: false,
      error: `Failed to list editions: ${msg}`,
      editionsFound: 0,
      results: [],
      summary: { total: 0, created: 0, existed: 0, failed: 0 },
    };
  }

  const results: EditionResult[] = [];
  for (let i = 0; i < editions.length; i++) {
    results.push(await scrapeOneEdition(editions[i]));
    if (i < editions.length - 1) await sleep(POLITE_DELAY_MS);
  }

  if (newsletterId != null) {
    await prisma.linkedinNewsletter
      .update({ where: { id: newsletterId }, data: { lastScrapedAt: new Date() } })
      .catch(() => {
        // tolerate concurrent deletes
      });
  }

  return {
    newsletterId,
    newsletterUrl,
    ok: true,
    editionsFound: editions.length,
    results,
    summary: summarize(results),
  };
}

// ---- saved newsletters CRUD ----

router.get('/linkedin/newsletters', async (_req, res) => {
  const items = await prisma.linkedinNewsletter.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json({ newsletters: items });
});

router.post('/linkedin/newsletters', async (req, res) => {
  const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl) || !isLinkedInNewsletterUrl(rawUrl)) {
    res.status(400).json({
      error: 'url must be a LinkedIn newsletter landing page (linkedin.com/newsletters/…)',
    });
    return;
  }
  const url = canonicalize(rawUrl);

  // Derive a default name from the slug if the user didn't supply one.
  let name = rawName;
  if (!name) {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      const slug = parts[parts.length - 1] ?? 'newsletter';
      name = slug
        .replace(/-\d+$/, '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim() || 'LinkedIn Newsletter';
    } catch {
      name = 'LinkedIn Newsletter';
    }
  }

  try {
    const created = await prisma.linkedinNewsletter.create({ data: { name, url } });
    res.status(201).json(created);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Unique constraint/i.test(msg)) {
      const existing = await prisma.linkedinNewsletter.findUnique({ where: { url } });
      res.status(409).json({ error: 'Newsletter already saved', existing });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

router.delete('/linkedin/newsletters/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  try {
    await prisma.linkedinNewsletter.delete({ where: { id } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'not found' });
  }
});

// ---- scrape endpoints ----

router.post('/linkedin/newsletters/:id/scrape', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const item = await prisma.linkedinNewsletter.findUnique({ where: { id } });
  if (!item) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const result = await scrapeNewsletter(item.url, item.id);
  res.json(result);
});

router.post('/linkedin/newsletters/scrape-all', async (_req, res) => {
  const items = await prisma.linkedinNewsletter.findMany({
    orderBy: { createdAt: 'asc' },
  });
  if (items.length === 0) {
    res.json({
      newsletters: [],
      summary: { newsletters: 0, total: 0, created: 0, existed: 0, failed: 0 },
    });
    return;
  }

  const newsletters: NewsletterScrapeResult[] = [];
  for (let i = 0; i < items.length; i++) {
    newsletters.push(await scrapeNewsletter(items[i].url, items[i].id));
    if (i < items.length - 1) await sleep(POLITE_DELAY_MS);
  }

  const total = newsletters.reduce((s, n) => s + n.summary.total, 0);
  const created = newsletters.reduce((s, n) => s + n.summary.created, 0);
  const existed = newsletters.reduce((s, n) => s + n.summary.existed, 0);
  const failed = newsletters.reduce((s, n) => s + n.summary.failed, 0);

  res.json({
    newsletters,
    summary: { newsletters: items.length, total, created, existed, failed },
  });
});

// Ad-hoc scrape: accepts either a newsletter landing page or a single Pulse URL.
// Kept for one-off use without saving the URL.
router.post('/linkedin/scrape', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: 'url is required and must be http(s)' });
    return;
  }

  if (isLinkedInNewsletterUrl(url)) {
    const result = await scrapeNewsletter(url, null);
    if (!result.ok) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.json({ mode: 'newsletter', ...result });
    return;
  }

  if (!isLinkedInArticleUrl(url)) {
    res.status(400).json({
      error:
        'URL must be a LinkedIn newsletter (linkedin.com/newsletters/…) or Pulse article (linkedin.com/pulse/…)',
    });
    return;
  }

  const result = await scrapeOneEdition(url);
  if (!result.ok) {
    res.status(502).json({ error: result.error });
    return;
  }
  res.status(result.created ? 201 : 200).json({
    mode: 'article',
    created: result.created,
    post: { id: result.postId, title: result.title, status: 'scraped' },
  });
});

export default router;
