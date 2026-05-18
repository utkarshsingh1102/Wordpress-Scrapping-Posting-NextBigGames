import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

function deriveSourceName(sourceUrl: string): string | null {
  if (sourceUrl.startsWith('zip://')) return 'Upload';
  try {
    const host = new URL(sourceUrl).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

router.get('/posts', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const posts = await prisma.post.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ scrapedAt: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      sourceUrl: true,
      title: true,
      slug: true,
      author: true,
      publishedAt: true,
      category: true,
      featuredImage: true,
      status: true,
      wpPostId: true,
      scrapedAt: true,
      sourceSite: { select: { name: true } },
    },
  });
  const shaped = posts.map(({ sourceSite, ...p }) => ({
    ...p,
    sourceName: sourceSite?.name ?? deriveSourceName(p.sourceUrl),
  }));
  res.json({ posts: shaped });
});

router.get('/posts/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const post = await prisma.post.findUnique({
    where: { id },
    include: { sourceSite: { select: { name: true } } },
  });
  if (!post) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const { sourceSite, ...rest } = post;
  res.json({
    ...rest,
    sourceName: sourceSite?.name ?? deriveSourceName(post.sourceUrl),
    images: JSON.parse(post.imagesJson) as string[],
    links: JSON.parse(post.linksJson) as string[],
  });
});

router.post('/posts/bulk-discard', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (
    !ids ||
    ids.length === 0 ||
    !ids.every((i: unknown) => typeof i === 'number' && Number.isFinite(i))
  ) {
    res.status(400).json({ error: 'ids must be a non-empty array of numbers' });
    return;
  }

  const results: Array<{ id: number; ok: boolean; error?: string }> = [];
  for (const id of ids) {
    try {
      const post = await prisma.post.findUnique({ where: { id } });
      if (!post) {
        results.push({ id, ok: false, error: 'not found' });
        continue;
      }
      await prisma.post.update({
        where: { id },
        data: { status: 'discarded' },
      });
      results.push({ id, ok: true });
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

router.delete('/posts/:id', async (req, res) => {
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
  await prisma.post.update({
    where: { id },
    data: { status: 'discarded' },
  });
  res.json({ ok: true });
});

export default router;
