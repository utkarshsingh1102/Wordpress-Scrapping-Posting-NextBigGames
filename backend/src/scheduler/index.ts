import cron, { type ScheduledTask } from 'node-cron';
import { runScrape } from '../scraper';
import { getEffectiveSettings } from '../services/settings';

let currentTask: ScheduledTask | null = null;
let currentExpr: string | null = null;

function applyCron(expr: string, enabled: boolean): void {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
    currentExpr = null;
  }
  if (!enabled) {
    console.log('[cron] scrape scheduler disabled');
    return;
  }
  if (!cron.validate(expr)) {
    console.warn(`[cron] invalid cron expression '${expr}', scheduler not started`);
    return;
  }
  currentTask = cron.schedule(expr, async () => {
    const startedAt = new Date().toISOString();
    console.log(`[cron] scheduled scrape starting at ${startedAt}`);
    try {
      const r = await runScrape({ type: 'scheduled' });
      console.log(
        `[cron] scheduled scrape done: found=${r.postsFound} scraped=${r.postsScraped} skipped=${r.postsSkipped} errors=${r.errors.length}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron] scheduled scrape failed: ${msg}`);
    }
  });
  currentExpr = expr;
  console.log(`[cron] scrape scheduler started (cron='${expr}')`);
}

export async function startScheduler(): Promise<void> {
  const s = await getEffectiveSettings();
  applyCron(s.scrape.cron, s.scrape.cronEnabled);
}

export async function restartScheduler(): Promise<void> {
  const s = await getEffectiveSettings(true);
  if (s.scrape.cron === currentExpr && currentTask !== null) return;
  applyCron(s.scrape.cron, s.scrape.cronEnabled);
}
