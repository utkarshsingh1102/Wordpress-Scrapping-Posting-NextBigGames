import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { prisma } from '../db';
import { uploadMedia } from '../wp/client';

const MAX_IMAGES = Number(process.env.ZIP_MAX_IMAGES ?? 150);
const MAX_BYTES = Number(process.env.ZIP_MAX_BYTES ?? 100 * 1024 * 1024); // 100 MB

const IMAGE_EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

const router = Router();

router.post('/image-zip/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res
      .status(400)
      .json({ error: 'no file uploaded — use multipart/form-data field "file"' });
    return;
  }

  const originalName = req.file.originalname;
  if (
    req.file.mimetype !== 'application/zip' &&
    req.file.mimetype !== 'application/x-zip-compressed' &&
    !originalName.toLowerCase().endsWith('.zip')
  ) {
    res.status(400).json({ error: 'file must be a .zip archive' });
    return;
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(req.file.buffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: `failed to read zip: ${msg}` });
    return;
  }

  // Pick image entries, skip directories + macOS metadata. Sort by entry name
  // with a natural numeric collation so page-2.png comes before page-10.png.
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory)
    .filter((e) => !e.entryName.startsWith('__MACOSX/'))
    .filter((e) => !e.entryName.split('/').pop()?.startsWith('.'))
    .map((e) => {
      const filename = e.entryName.split('/').pop() ?? e.entryName;
      const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
      return { entry: e, filename, ext, mime: IMAGE_EXT_TO_MIME[ext] };
    })
    .filter((e) => !!e.mime)
    .sort((a, b) =>
      a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }),
    );

  if (entries.length === 0) {
    res.status(400).json({
      error: 'zip contained no images (supported: .png, .jpg, .jpeg, .webp, .gif)',
    });
    return;
  }
  if (entries.length > MAX_IMAGES) {
    res.status(413).json({
      error: `zip has ${entries.length} images; limit is ${MAX_IMAGES}. Raise ZIP_MAX_IMAGES if needed.`,
    });
    return;
  }

  const titleBase =
    originalName.replace(/\.zip$/i, '').trim() || 'Image gallery';
  const slugBase =
    titleBase
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .slice(0, 80) || 'gallery';

  // Upload each image to WP in parallel. The position is preserved via the
  // index — we re-sort after Promise.all so order doesn't depend on which
  // upload finishes first.
  let uploaded: Array<{ idx: number; sourceUrl: string }>;
  try {
    uploaded = await Promise.all(
      entries.map(async (e, idx) => {
        const buffer = e.entry.getData();
        const media = await uploadMedia({
          binary: buffer,
          filename: `${slugBase}-${String(idx + 1).padStart(3, '0')}${e.ext}`,
          mimeType: e.mime as string,
        });
        return { idx, sourceUrl: media.source_url };
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: `WordPress media upload failed: ${msg}` });
    return;
  }

  uploaded.sort((a, b) => a.idx - b.idx);
  const bodyHtml = uploaded
    .map(({ sourceUrl }) => `<p><img src="${sourceUrl}" alt="" /></p>`)
    .join('\n');
  const images = uploaded.map((u) => u.sourceUrl);
  const featuredImage = images[0] ?? null;

  const post = await prisma.post.create({
    data: {
      // Synthetic unique key — zip uploads have no "real" source URL.
      sourceUrl: `zip://${slugBase}-${Date.now()}`,
      title: titleBase,
      slug: slugBase,
      author: null,
      publishedAt: null,
      category: null,
      featuredImage,
      bodyHtml,
      imagesJson: JSON.stringify(images),
      linksJson: '[]',
      status: 'scraped',
      source: 'zip',
    },
  });

  res.status(201).json({
    postId: post.id,
    imageCount: uploaded.length,
    title: titleBase,
  });
});

router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res
        .status(413)
        .json({ error: `file too large; limit is ${MAX_BYTES} bytes` });
      return;
    }
    res.status(400).json({ error: `upload error: ${err.message}` });
    return;
  }
  next(err);
});

export default router;
