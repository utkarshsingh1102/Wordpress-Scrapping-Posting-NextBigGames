import { Router } from 'express';
import { runScrape, scrapeSingleUrl } from '../scraper';

const router = Router();

router.post('/scrape', async (_req, res) => {
  try {
    const result = await runScrape({ type: 'manual' });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

router.post('/scrape-url', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url : null;
  if (!url || !/^https:\/\/www\.gamigion\.com\/[a-z0-9-]+\/?$/i.test(url)) {
    res.status(400).json({ error: 'url must be a single gamigion.com article URL' });
    return;
  }
  try {
    const { post, created } = await scrapeSingleUrl(url);
    res.json({ created, post: { id: post.id, title: post.title, status: post.status } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

export default router;
