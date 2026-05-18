import { Router } from 'express';
import { prisma } from '../db';
import { cleanBodyHtml } from '../scraper/cleaner';
import { getWpPostContent, updateWpPost } from '../wp/client';

const router = Router();

/**
 * Sweep every Post.bodyHtml in the DB and strip noise sections.
 * Idempotent — posts already clean are left untouched.
 */
router.post('/posts/clean-bodies', async (_req, res) => {
  const all = await prisma.post.findMany({
    select: { id: true, bodyHtml: true },
  });
  let cleaned = 0;
  let unchanged = 0;
  const errors: Array<{ id: number; error: string }> = [];
  for (const p of all) {
    try {
      const next = cleanBodyHtml(p.bodyHtml);
      if (next !== p.bodyHtml) {
        await prisma.post.update({
          where: { id: p.id },
          data: { bodyHtml: next },
        });
        cleaned++;
      } else {
        unchanged++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ id: p.id, error: msg });
    }
  }
  res.json({ total: all.length, cleaned, unchanged, errors });
});

/**
 * For a single already-published post: fetch its current content from WP,
 * strip noise, push the cleaned version back to WP. Avoids re-uploading
 * images by working with WP's own rendered content.
 */
router.post('/posts/:id/clean-wp', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (!post.wpPostId) {
    res.status(400).json({ error: 'post has not been published to WP yet' });
    return;
  }
  try {
    const current = await getWpPostContent(post.wpPostId);
    const cleaned = cleanBodyHtml(current);
    if (cleaned === current) {
      res.json({ ok: true, wpPostId: post.wpPostId, changed: false });
      return;
    }
    await updateWpPost({ wpPostId: post.wpPostId, content: cleaned });
    res.json({
      ok: true,
      wpPostId: post.wpPostId,
      changed: true,
      bytesBefore: current.length,
      bytesAfter: cleaned.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

/**
 * Bulk version of clean-wp — accepts {ids:[...]} of OUR post IDs.
 * Processes sequentially with per-item result.
 */
router.post('/posts/bulk-clean-wp', async (req, res) => {
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
    changed?: boolean;
    error?: string;
  }> = [];

  for (const id of ids) {
    try {
      const post = await prisma.post.findUnique({ where: { id } });
      if (!post) {
        results.push({ id, ok: false, error: 'not found' });
        continue;
      }
      if (!post.wpPostId) {
        results.push({ id, ok: false, error: 'not published to WP yet' });
        continue;
      }
      const current = await getWpPostContent(post.wpPostId);
      const cleaned = cleanBodyHtml(current);
      if (cleaned === current) {
        results.push({ id, ok: true, wpPostId: post.wpPostId, changed: false });
        continue;
      }
      await updateWpPost({ wpPostId: post.wpPostId, content: cleaned });
      results.push({ id, ok: true, wpPostId: post.wpPostId, changed: true });
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
      changed: results.filter((r) => r.changed).length,
      failed: results.filter((r) => !r.ok).length,
    },
  });
});

export default router;
