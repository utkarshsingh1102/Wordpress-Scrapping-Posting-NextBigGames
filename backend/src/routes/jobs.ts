import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

router.get('/jobs', async (_req, res) => {
  const jobs = await prisma.job.findMany({
    orderBy: { startedAt: 'desc' },
    take: 50,
  });
  res.json({ jobs });
});

export default router;
