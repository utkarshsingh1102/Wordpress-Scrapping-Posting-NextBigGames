import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type LinkedinNewsletter,
  type LinkedInNewsletterScrapeResult,
  type LinkedInScrapeAllResult,
} from '../lib/api';

type ResultPanel =
  | { kind: 'single'; data: LinkedInNewsletterScrapeResult }
  | { kind: 'all'; data: LinkedInScrapeAllResult };

export default function LinkedIn() {
  const [newsletters, setNewsletters] = useState<LinkedinNewsletter[]>([]);
  const [loading, setLoading] = useState(true);
  const [addUrl, setAddUrl] = useState('');
  const [addName, setAddName] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const [scrapingId, setScrapingId] = useState<number | null>(null);
  const [scrapeAllBusy, setScrapeAllBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultPanel | null>(null);

  async function load() {
    try {
      const { newsletters } = await api.listLinkedInNewsletters();
      setNewsletters(newsletters);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAddBusy(true);
    try {
      await api.addLinkedInNewsletter(addUrl.trim(), addName.trim() || undefined);
      setAddUrl('');
      setAddName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddBusy(false);
    }
  }

  async function handleDelete(n: LinkedinNewsletter) {
    if (!confirm(`Remove "${n.name}" from saved newsletters?`)) return;
    setError(null);
    try {
      await api.deleteLinkedInNewsletter(n.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleScrapeOne(n: LinkedinNewsletter) {
    setError(null);
    setResult(null);
    setScrapingId(n.id);
    try {
      const data = await api.scrapeLinkedInNewsletter(n.id);
      setResult({ kind: 'single', data });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScrapingId(null);
    }
  }

  async function handleScrapeAll() {
    if (newsletters.length === 0) return;
    setError(null);
    setResult(null);
    setScrapeAllBusy(true);
    try {
      const data = await api.scrapeAllLinkedInNewsletters();
      setResult({ kind: 'all', data });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScrapeAllBusy(false);
    }
  }

  const anyBusy = addBusy || scrapeAllBusy || scrapingId !== null;

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">LinkedIn Newsletter</h2>
          <p className="mt-1 text-sm text-slate-600">
            Save LinkedIn newsletter landing pages. Press Scrape to pull every edition listed on
            that page into the Review queue. No automatic scheduling — scraping is manual only.
          </p>
        </div>
        <button
          onClick={handleScrapeAll}
          disabled={anyBusy || newsletters.length === 0}
          className="px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {scrapeAllBusy
            ? 'Scraping all…'
            : `Scrape all newsletters${newsletters.length ? ` (${newsletters.length})` : ''}`}
        </button>
      </div>

      <form onSubmit={handleAdd} className="rounded border bg-white p-4">
        <div className="text-sm font-medium text-slate-700">Add a newsletter</div>
        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_240px_auto]">
          <input
            type="url"
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            placeholder="https://www.linkedin.com/newsletters/your-newsletter-1234567890/"
            className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={addBusy}
            required
          />
          <input
            type="text"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="Display name (optional)"
            className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={addBusy}
          />
          <button
            type="submit"
            disabled={addBusy || !addUrl.trim()}
            className="px-4 py-2 rounded bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {addBusy ? 'Adding…' : 'Add'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          URL must look like
          <code className="mx-1 rounded bg-slate-100 px-1 py-0.5">linkedin.com/newsletters/…</code>
          (the landing page that lists every edition).
        </p>
      </form>

      {error && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mt-6 rounded border bg-white">
        <div className="border-b px-4 py-3 text-sm font-medium">Saved newsletters</div>
        {loading ? (
          <p className="p-4 text-sm text-slate-500">Loading…</p>
        ) : newsletters.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No newsletters saved yet.</p>
        ) : (
          <ul className="divide-y">
            {newsletters.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{n.name}</div>
                  <div className="truncate text-xs text-slate-500">{n.url}</div>
                  <div className="text-xs text-slate-500">
                    Last scraped:{' '}
                    {n.lastScrapedAt ? new Date(n.lastScrapedAt).toLocaleString() : 'never'}
                  </div>
                </div>
                <button
                  onClick={() => handleScrapeOne(n)}
                  disabled={anyBusy}
                  className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {scrapingId === n.id ? 'Scraping…' : 'Scrape'}
                </button>
                <button
                  onClick={() => handleDelete(n)}
                  disabled={anyBusy}
                  className="px-3 py-1.5 rounded border border-slate-300 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {result?.kind === 'single' && <SingleResult data={result.data} />}
      {result?.kind === 'all' && <AllResult data={result.data} />}
    </section>
  );
}

function SingleResult({ data }: { data: LinkedInNewsletterScrapeResult }) {
  return (
    <div className="mt-6 rounded border bg-white">
      <Header
        title="Scrape result"
        url={data.newsletterUrl}
        summary={
          data.ok
            ? `${data.editionsFound} editions found`
            : data.error ?? 'Failed'
        }
        counts={data.summary}
        error={!data.ok}
      />
      {data.ok && <EditionList results={data.results} />}
    </div>
  );
}

function AllResult({ data }: { data: LinkedInScrapeAllResult }) {
  return (
    <div className="mt-6 rounded border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="text-sm">
          <span className="font-medium">Scrape all result:</span>{' '}
          <span className="text-slate-600">
            {data.summary.newsletters} newsletter
            {data.summary.newsletters === 1 ? '' : 's'} • {data.summary.total} editions
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded bg-green-100 px-2 py-0.5 font-medium text-green-800">
            {data.summary.created} new
          </span>
          <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
            {data.summary.existed} existed
          </span>
          {data.summary.failed > 0 && (
            <span className="rounded bg-red-100 px-2 py-0.5 font-medium text-red-800">
              {data.summary.failed} failed
            </span>
          )}
          <Link
            to="/review"
            className="ml-1 rounded border border-blue-300 bg-white px-2 py-0.5 font-medium text-blue-700 hover:bg-blue-50"
          >
            Open Review →
          </Link>
        </div>
      </div>
      <ul className="divide-y">
        {data.newsletters.map((n) => (
          <li key={n.newsletterUrl} className="px-4 py-3">
            <div className="text-sm font-medium">{n.newsletterUrl}</div>
            {n.ok ? (
              <>
                <div className="mt-1 text-xs text-slate-500">
                  {n.editionsFound} editions • {n.summary.created} new • {n.summary.existed}{' '}
                  existed
                  {n.summary.failed > 0 && ` • ${n.summary.failed} failed`}
                </div>
                <EditionList results={n.results} />
              </>
            ) : (
              <div className="mt-1 text-xs text-red-700">Failed: {n.error}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Header({
  title,
  url,
  summary,
  counts,
  error,
}: {
  title: string;
  url: string;
  summary: string;
  counts: { total: number; created: number; existed: number; failed: number };
  error: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
      <div className="min-w-0 text-sm">
        <span className="font-medium">{title}:</span>{' '}
        <span className={error ? 'text-red-700' : 'text-slate-600'}>{summary}</span>
        <div className="truncate text-xs text-slate-500">{url}</div>
      </div>
      {!error && (
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded bg-green-100 px-2 py-0.5 font-medium text-green-800">
            {counts.created} new
          </span>
          <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
            {counts.existed} existed
          </span>
          {counts.failed > 0 && (
            <span className="rounded bg-red-100 px-2 py-0.5 font-medium text-red-800">
              {counts.failed} failed
            </span>
          )}
          <Link
            to="/review"
            className="ml-1 rounded border border-blue-300 bg-white px-2 py-0.5 font-medium text-blue-700 hover:bg-blue-50"
          >
            Open Review →
          </Link>
        </div>
      )}
    </div>
  );
}

function EditionList({
  results,
}: {
  results: LinkedInNewsletterScrapeResult['results'];
}) {
  if (results.length === 0) return null;
  return (
    <ul className="mt-2 divide-y rounded border bg-slate-50/40">
      {results.map((r) => (
        <li key={r.url} className="px-3 py-2 text-sm">
          {r.ok ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{r.title}</div>
                <div className="truncate text-xs text-slate-500">{r.url}</div>
              </div>
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                  r.created ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {r.created ? 'new' : 'existed'}
              </span>
            </div>
          ) : (
            <div>
              <div className="truncate text-xs text-slate-500">{r.url}</div>
              <div className="text-red-700">Failed: {r.error}</div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
