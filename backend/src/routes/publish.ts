import { Router } from 'express';
import { publishPost } from '../publisher';

const router = Router();

// IMPORTANT: register before /posts/:id/publish so Express doesn't try to
// match :id="bulk-publish". (Different segment count, but be defensive.)
router.post('/posts/bulk-publish', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (
    !ids ||
    ids.length === 0 ||
    !ids.every((i: unknown) => typeof i === 'number' && Number.isFinite(i))
  ) {
    res.status(400).json({ error: 'ids must be a non-empty array of numbers' });
    return;
  }

  const results: Array<{
    id: number;
    ok: boolean;
    wpPostId?: number;
    error?: string;
  }> = [];
  for (const id of ids) {
    try {
      const r = await publishPost(id);
      results.push({ id, ok: true, wpPostId: r.wpPostId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ id, ok: false, error: msg });
    }
  }
  res.json({
    results,
    summary: {
      total: results.length,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    },
  });
});

router.post('/posts/:id/publish', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  try {
    const result = await publishPost(id);
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

export default router;
