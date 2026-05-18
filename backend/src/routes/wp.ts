import { Router } from 'express';
import { testWpConnection } from '../wp/client';

const router = Router();

router.get('/wp/test', async (_req, res) => {
  try {
    const user = await testWpConnection();
    res.json({ ok: true, user });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

export default router;
