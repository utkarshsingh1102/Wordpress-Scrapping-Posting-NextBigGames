import { Router } from 'express';
import { prisma } from '../db';
import { runScrape, scrapeSingleUrl } from '../scraper';

const router = Router();

router.post('/scrape', async (req, res) => {
  const sourceIds = Array.isArray(req.body?.sourceIds)
    ? req.body.sourceIds.filter((x: unknown) => typeof x === 'number')
    : undefined;
  try {
    const result = await runScrape({ type: 'manual', sourceIds });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

router.post('/scrape-url', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url : null;
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: 'url is required and must be http(s)' });
    return;
  }

  // Match the URL to one of the configured Sources by hostname so we can
  // attribute the Post correctly. Reject URLs that don't belong to any source —
  // prevents stray scrapes hitting arbitrary websites.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).json({ error: 'invalid url' });
    return;
  }

  const sources = await prisma.source.findMany({ where: { enabled: true } });
  const match = sources.find((s) => {
    try {
      return new URL(s.homepageUrl).hostname === parsed.hostname;
    } catch {
      return false;
    }
  });
  if (!match) {
    res.status(400).json({
      error: `no enabled source matches hostname ${parsed.hostname}. Add it under Settings → Sources first.`,
    });
    return;
  }

  try {
    const { post, created } = await scrapeSingleUrl(url, match.id);
    res.json({ created, post: { id: post.id, title: post.title, status: post.status } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

export default router;
