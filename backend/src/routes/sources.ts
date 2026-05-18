import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(100),
  homepageUrl: z.string().url(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});

router.get('/sources', async (_req, res) => {
  const sources = await prisma.source.findMany({ orderBy: { createdAt: 'asc' } });
  res.json(sources);
});

router.post('/sources', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const source = await prisma.source.create({
      data: { name: parsed.data.name, homepageUrl: parsed.data.homepageUrl },
    });
    res.status(201).json(source);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Unique constraint')) {
      res.status(409).json({ error: 'a source with that homepage URL already exists' });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

router.patch('/sources/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const source = await prisma.source.update({
      where: { id },
      data: parsed.data,
    });
    res.json(source);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(404).json({ error: msg });
  }
});

router.delete('/sources/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  try {
    await prisma.source.delete({ where: { id } });
    res.status(204).end();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(404).json({ error: msg });
  }
});

export default router;
