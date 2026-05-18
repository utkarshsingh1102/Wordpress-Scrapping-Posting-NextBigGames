import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ImageZipUploadResult, type Job, type ScrapeResult } from '../lib/api';
import { StatusPill } from '../components/StatusPill';

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState({ scraped: 0, published: 0, discarded: 0 });
  const [scraping, setScraping] = useState(false);
  const [lastResult, setLastResult] = useState<ScrapeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<ImageZipUploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  async function handleZipChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setUploadResult(null);
    try {
      const result = await api.uploadImageZip(file);
      setUploadResult(result);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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

      {uploadResult && (
        <div className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Imported as Post #{uploadResult.postId} — {uploadResult.imageCount} image(s).{' '}
          <Link to="/review" className="underline">Review and publish</Link>
        </div>
      )}

      <div className="mb-6 rounded border bg-white p-4">
        <h3 className="text-sm font-semibold mb-2">Import image gallery (.zip)</h3>
        <p className="mb-2 text-xs text-slate-500">
          Upload a <code className="font-mono">.zip</code> of images (PNG, JPG, WebP, GIF) — each image becomes one block in the WordPress draft, in filename order.
          Max 50 images, 25 MB.
        </p>
        <p className="mb-2 text-xs text-slate-500">
          <strong>For a PDF:</strong> open it in Preview / Acrobat → export each page as an image → zip the folder → upload here.
          Page order follows natural filename sort (so name files <code className="font-mono">page-01.png</code>, <code className="font-mono">page-02.png</code>…).
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/zip,.zip"
          disabled={uploading}
          onChange={handleZipChange}
          className="block text-sm file:mr-3 file:rounded file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700 file:disabled:opacity-50"
        />
        {uploading && (
          <p className="mt-2 text-xs text-slate-500">
            Uploading images to WordPress… can take 30–120 s for large galleries.
          </p>
        )}
      </div>

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
