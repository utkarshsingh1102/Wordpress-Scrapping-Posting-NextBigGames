import { Router } from 'express';
import { z } from 'zod';
import { regenerateFirstImageForPost, regenerateFromImageUrl } from '../imagegen';
import { getEffectiveSettings } from '../services/settings';

const router = Router();

const sizeSchema = z
  .enum(['1536x1024', '1024x1536', '1024x1024'])
  .optional();

const includeImageSchema = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined) return true;
    if (typeof v === 'boolean') return v;
    return v === 'true' || v === '1';
  });

router.post('/posts/:id/regenerate-image', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid post id' });
    return;
  }
  const bodySchema = z.object({
    size: sizeSchema,
    includeImage: includeImageSchema,
  });
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const settings = await getEffectiveSettings();
  if (!settings.imagegen.openaiApiKey) {
    res.status(400).json({
      error:
        'OpenAI API key not configured. Set it in Settings → Image Generation.',
    });
    return;
  }

  try {
    const result = await regenerateFirstImageForPost({
      postId: id,
      openaiApiKey: settings.imagegen.openaiApiKey,
      size: parsed.data.size,
    });
    res.json({
      referenceImageUrl: result.referenceImageUrl,
      visionAnalysis: result.visionAnalysis,
      generatedPrompt: result.generatedPrompt,
      models: result.models,
      persisted: result.persisted,
      image: parsed.data.includeImage
        ? {
            mimeType: result.image.mimeType,
            base64: result.image.binary.toString('base64'),
          }
        : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

const adhocSchema = z.object({
  imageUrl: z.string().url(),
  blogTitle: z.string().min(1),
  blogSummary: z.string().default(''),
  size: sizeSchema,
  includeImage: includeImageSchema,
});

router.post('/imagegen/regenerate', async (req, res) => {
  const parsed = adhocSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const settings = await getEffectiveSettings();
  if (!settings.imagegen.openaiApiKey) {
    res.status(400).json({
      error:
        'OpenAI API key not configured. Set it in Settings → Image Generation.',
    });
    return;
  }
  try {
    const result = await regenerateFromImageUrl({
      imageUrl: parsed.data.imageUrl,
      blogTitle: parsed.data.blogTitle,
      blogSummary: parsed.data.blogSummary,
      openaiApiKey: settings.imagegen.openaiApiKey,
      size: parsed.data.size,
    });
    res.json({
      referenceImageUrl: result.referenceImageUrl,
      visionAnalysis: result.visionAnalysis,
      generatedPrompt: result.generatedPrompt,
      models: result.models,
      image: parsed.data.includeImage
        ? {
            mimeType: result.image.mimeType,
            base64: result.image.binary.toString('base64'),
          }
        : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

export default router;
