import { Router } from 'express';
import { z } from 'zod';
import {
  getEffectiveSettings,
  updateSettings,
} from '../services/settings';
import { restartScheduler } from '../scheduler';
import { clearAuthorCache } from '../wp/client';

const router = Router();

function maskAppPassword(p: string | null): string | null {
  if (!p) return null;
  const trimmed = p.replace(/\s+/g, '');
  return '••••••••••••' + trimmed.slice(-4);
}

function maskApiKey(k: string | null): string | null {
  if (!k) return null;
  return '••••••••••••' + k.slice(-4);
}

router.get('/settings', async (_req, res) => {
  const s = await getEffectiveSettings();
  res.json({
    sourceUrl: s.sourceUrl,
    wp: {
      url: s.wp.url,
      username: s.wp.username,
      appPasswordMasked: maskAppPassword(s.wp.appPassword),
      authorUsername: s.wp.authorUsername,
    },
    imagegen: {
      openaiApiKeyMasked: maskApiKey(s.imagegen.openaiApiKey),
    },
    scrape: {
      cron: s.scrape.cron,
      cronEnabled: s.scrape.cronEnabled,
    },
  });
});

const updateSchema = z.object({
  sourceUrl: z.string().url().optional(),
  wp: z
    .object({
      url: z.string().url().nullable().optional(),
      username: z.string().nullable().optional(),
      // Empty string means "leave unchanged"; null clears.
      appPassword: z.string().nullable().optional(),
      authorUsername: z.string().nullable().optional(),
    })
    .optional(),
  imagegen: z
    .object({
      // Empty string means "leave unchanged"; null clears.
      openaiApiKey: z.string().nullable().optional(),
    })
    .optional(),
  scrape: z
    .object({
      cron: z.string().optional(),
      cronEnabled: z.boolean().optional(),
    })
    .optional(),
});

router.put('/settings', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updates = parsed.data;

  // Drop empty-string appPassword — UI uses "" to mean "leave unchanged".
  if (updates.wp?.appPassword === '') {
    delete updates.wp.appPassword;
  }
  if (updates.imagegen?.openaiApiKey === '') {
    delete updates.imagegen.openaiApiKey;
  }

  try {
    const s = await updateSettings(updates);
    if (updates.scrape?.cron !== undefined || updates.scrape?.cronEnabled !== undefined) {
      await restartScheduler();
    }
    if (updates.wp?.authorUsername !== undefined || updates.wp?.url !== undefined) {
      clearAuthorCache();
    }
    res.json({
      sourceUrl: s.sourceUrl,
      wp: {
        url: s.wp.url,
        username: s.wp.username,
        appPasswordMasked: maskAppPassword(s.wp.appPassword),
        authorUsername: s.wp.authorUsername,
      },
      imagegen: {
        openaiApiKeyMasked: maskApiKey(s.imagegen.openaiApiKey),
      },
      scrape: {
        cron: s.scrape.cron,
        cronEnabled: s.scrape.cronEnabled,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

export default router;
