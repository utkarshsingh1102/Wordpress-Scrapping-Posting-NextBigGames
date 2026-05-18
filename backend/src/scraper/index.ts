import type { Post } from '@prisma/client';
import { prisma } from '../db';
import { getEffectiveSettings } from '../services/settings';
import { fetchPostUrls } from './homepage';
import { fetchArticle } from './article';
import { sleep } from '../util/retry';

const DEFAULT_LIMIT = 10;
const POLITE_DELAY_MS = 250;

export type ScrapeJobResult = {
  jobId: number;
  postsFound: number;
  postsScraped: number;
  postsSkipped: number;
  errors: string[];
};

export async function scrapeSingleUrl(
  url: string,
): Promise<{ post: Post; created: boolean }> {
  const existing = await prisma.post.findUnique({ where: { sourceUrl: url } });
  if (existing) return { post: existing, created: false };
  const article = await fetchArticle(url);
  const post = await prisma.post.create({
    data: {
      sourceUrl: article.sourceUrl,
      title: article.title,
      slug: article.slug,
      author: article.author,
      publishedAt: article.publishedAt,
      category: article.category,
      featuredImage: article.featuredImage,
      bodyHtml: article.bodyHtml,
      imagesJson: JSON.stringify(article.images),
      linksJson: JSON.stringify(article.links),
      status: 'scraped',
    },
  });
  return { post, created: true };
}

export async function runScrape(
  opts: { type: 'manual' | 'scheduled'; limit?: number } = { type: 'manual' },
): Promise<ScrapeJobResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const job = await prisma.job.create({
    data: { type: opts.type, status: 'running' },
  });

  const errors: string[] = [];
  let postsFound = 0;
  let postsScraped = 0;
  let postsSkipped = 0;

  try {
    const settings = await getEffectiveSettings();
    const urls = await fetchPostUrls(settings.sourceUrl, limit);
    postsFound = urls.length;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        const { created } = await scrapeSingleUrl(url);
        if (created) postsScraped++;
        else postsSkipped++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${url}: ${msg}`);
      }
      if (i < urls.length - 1) await sleep(POLITE_DELAY_MS);
    }

    await prisma.job.update({
      where: { id: job.id },
      data: {
        finishedAt: new Date(),
        status:
          postsFound > 0 && errors.length === postsFound ? 'failed' : 'success',
        postsFound,
        postsScraped,
        postsSkipped,
        errorLog: errors.length > 0 ? errors.join('\n') : null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`scrape: ${msg}`);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        finishedAt: new Date(),
        status: 'failed',
        postsFound,
        postsScraped,
        postsSkipped,
        errorLog: errors.join('\n'),
      },
    });
  }

  return { jobId: job.id, postsFound, postsScraped, postsSkipped, errors };
}
