import express from 'express';
import cors from 'cors';
import { config } from './config';
import { GENERATED_DIR } from './imagegen';
import healthRouter from './routes/health';
import scrapeRouter from './routes/scrape';
import postsRouter from './routes/posts';
import jobsRouter from './routes/jobs';
import publishRouter from './routes/publish';
import wpRouter from './routes/wp';
import settingsRouter from './routes/settings';
import cleanupRouter from './routes/cleanup';
import imagegenRouter from './routes/imagegen';
import { startScheduler } from './scheduler';
import { autoMigrateFromEnv } from './services/settings';

const app = express();

app.use(cors({ origin: config.corsOrigin ?? true }));
app.use(express.json({ limit: '20mb' }));
app.use('/generated', express.static(GENERATED_DIR, { fallthrough: false }));
app.use('/api', healthRouter);
app.use('/api', scrapeRouter);
app.use('/api', postsRouter);
app.use('/api', jobsRouter);
app.use('/api', publishRouter);
app.use('/api', wpRouter);
app.use('/api', settingsRouter);
app.use('/api', cleanupRouter);
app.use('/api', imagegenRouter);

app.listen(config.port, async () => {
  console.log(`Backend listening on port ${config.port}`);
  try {
    await autoMigrateFromEnv();
    await startScheduler();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[startup] failed:', msg);
  }
});
