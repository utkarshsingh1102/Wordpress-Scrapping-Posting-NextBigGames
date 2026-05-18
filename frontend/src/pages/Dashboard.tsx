import { useEffect, useState } from 'react';
import { api, type Job, type ScrapeResult } from '../lib/api';
import { StatusPill } from '../components/StatusPill';

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState({ scraped: 0, published: 0, discarded: 0 });
  const [scraping, setScraping] = useState(false);
  const [lastResult, setLastResult] = useState<ScrapeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [jobsRes, scraped, published, discarded] = await Promise.all([
      api.listJobs(),
      api.listPosts('scraped'),
      api.listPosts('published'),
      api.listPosts('discarded'),
    ]);
    setJobs(jobsRes.jobs);
    setStats({
      scraped: scraped.posts.length,
      published: published.posts.length,
      discarded: discarded.posts.length,
    });
  }

  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function handleScrape() {
    setScraping(true);
    setError(null);
    setLastResult(null);
    try {
      const result = await api.scrapeAll();
      setLastResult(result);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScraping(false);
    }
  }

  const lastJob = jobs[0];

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Dashboard</h2>
        <button
          onClick={handleScrape}
          disabled={scraping}
          className="px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {scraping ? 'Scraping…' : 'Scrape Now'}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {lastResult && (
        <div className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Scrape complete: {lastResult.postsScraped} new · {lastResult.postsSkipped} skipped
          {lastResult.errors.length > 0 && <span> · {lastResult.errors.length} errors</span>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Scraped (pending)" value={stats.scraped} />
        <StatCard label="Published" value={stats.published} />
        <StatCard label="Discarded" value={stats.discarded} />
      </div>

      <div className="rounded border bg-white p-4">
        <h3 className="text-sm font-semibold mb-3">Last job</h3>
        {lastJob ? (
          <div className="text-sm">
            <div className="flex items-center gap-2">
              <StatusPill status={lastJob.status} />
              <span className="text-slate-500">
                {new Date(lastJob.startedAt).toLocaleString()} · {lastJob.type}
              </span>
            </div>
            <div className="mt-2 text-slate-600">
              Found {lastJob.postsFound} · scraped {lastJob.postsScraped} · skipped {lastJob.postsSkipped}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No jobs yet. Click "Scrape Now" to get started.</p>
        )}
      </div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
