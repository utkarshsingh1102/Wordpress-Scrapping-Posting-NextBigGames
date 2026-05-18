import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import * as pdfImgConvert from 'pdf-img-convert';
import { prisma } from '../db';
import { uploadMedia } from '../wp/client';

const MAX_PAGES = Number(process.env.PDF_MAX_PAGES ?? 30);
const MAX_BYTES = Number(process.env.PDF_MAX_BYTES ?? 15 * 1024 * 1024); // 15 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

const router = Router();

router.post('/pdf/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'no file uploaded — use multipart/form-data field "file"' });
    return;
  }
  if (
    req.file.mimetype !== 'application/pdf' &&
    !req.file.originalname.toLowerCase().endsWith('.pdf')
  ) {
    res.status(400).json({ error: 'file must be a PDF' });
    return;
  }

  const filenameBase =
    req.file.originalname
      .replace(/\.pdf$/i, '')
      .replace(/[^a-z0-9_-]+/gi, '-')
      .slice(0, 80) || 'document';
  const title = req.file.originalname.replace(/\.pdf$/i, '').trim() || 'Untitled PDF';

  let pageImages: Uint8Array[];
  try {
    pageImages = (await pdfImgConvert.convert(req.file.buffer, {
      // 2x scale keeps text legible; reduce if Render free-tier 60s timeout bites.
      scale: 2.0,
    })) as Uint8Array[];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: `failed to parse PDF: ${msg}` });
    return;
  }

  if (pageImages.length === 0) {
    res.status(400).json({ error: 'PDF had no pages' });
    return;
  }
  if (pageImages.length > MAX_PAGES) {
    res.status(413).json({
      error: `PDF has ${pageImages.length} pages; limit is ${MAX_PAGES}. Split the PDF or raise PDF_MAX_PAGES.`,
    });
    return;
  }

  // Upload each page to WP Media in parallel. WP becomes the canonical store —
  // page images survive backend restart (Render free tier has no persistent disk).
  let uploaded: Array<{ pageNum: number; sourceUrl: string }>;
  try {
    uploaded = await Promise.all(
      pageImages.map(async (bytes, idx) => {
        const buffer = Buffer.from(bytes);
        const media = await uploadMedia({
          binary: buffer,
          filename: `${filenameBase}-page-${idx + 1}.png`,
          mimeType: 'image/png',
        });
        return { pageNum: idx + 1, sourceUrl: media.source_url };
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: `WordPress media upload failed: ${msg}` });
    return;
  }

  uploaded.sort((a, b) => a.pageNum - b.pageNum);

  const bodyHtml = uploaded
    .map(({ sourceUrl }) => `<p><img src="${sourceUrl}" alt="" /></p>`)
    .join('\n');
  const images = uploaded.map((u) => u.sourceUrl);
  const featuredImage = images[0] ?? null;
  const slugBase = filenameBase.toLowerCase() || 'pdf';

  const post = await prisma.post.create({
    data: {
      // Synthetic unique key — keeps the `@unique` constraint on Post.sourceUrl
      // happy for PDF posts that have no real source URL.
      sourceUrl: `pdf://${slugBase}-${Date.now()}`,
      title,
      slug: slugBase,
      author: null,
      publishedAt: null,
      category: null,
      featuredImage,
      bodyHtml,
      imagesJson: JSON.stringify(images),
      linksJson: '[]',
      status: 'scraped',
      source: 'pdf',
    },
  });

  res.status(201).json({
    postId: post.id,
    pageCount: uploaded.length,
    title,
  });
});

// Multer's file-size limit throws — turn that into a clean 413.
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: `file too large; limit is ${MAX_BYTES} bytes` });
      return;
    }
    res.status(400).json({ error: `upload error: ${err.message}` });
    return;
  }
  next(err);
});

export default router;
