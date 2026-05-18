import { useEffect, useState } from 'react';
import { api, type PostDetail, type PostSummary, type RegenerateImageResult } from '../lib/api';
import { StatusPill } from '../components/StatusPill';

type Filter = 'scraped' | 'published' | 'all';

type BulkResultState =
  | {
      kind: 'approve';
      summary: { total: number; ok: number; failed: number };
      errors: Array<{ id: number; error: string }>;
    }
  | {
      kind: 'reject';
      summary: { total: number; ok: number; failed: number };
      errors: Array<{ id: number; error: string }>;
    }
  | {
      kind: 'clean-wp';
      summary: { total: number; ok: number; changed: number; failed: number };
      errors: Array<{ id: number; error: string }>;
    };

export default function Review() {
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [filter, setFilter] = useState<Filter>('scraped');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PostDetail | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [regenBusy, setRegenBusy] = useState(false);
  const [regen, setRegen] = useState<RegenerateImageResult | null>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<'approve' | 'reject' | 'clean-wp' | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResultState | null>(null);
  const [bulkErrorsExpanded, setBulkErrorsExpanded] = useState(false);

  async function loadPosts() {
    const { posts } = await api.listPosts(filter === 'all' ? undefined : filter);
    setPosts(posts);
    if (posts.length > 0 && (selectedId === null || !posts.find((p) => p.id === selectedId))) {
      setSelectedId(posts[0].id);
    } else if (posts.length === 0) {
      setSelectedId(null);
    }
  }

  useEffect(() => {
    setError(null);
    setSelected(new Set());
    loadPosts().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, [filter]);

  useEffect(() => {
    setRegen(null);
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    api
      .getPost(selectedId)
      .then(setDetail)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [selectedId]);

  async function handleRegenerateImage() {
    if (!detail) return;
    setRegenBusy(true);
    setError(null);
    setSuccess(null);
    setRegen(null);
    try {
      const r = await api.regenerateImage(detail.id, '1536x1024');
      setRegen(r);
      const persistedNote = r.persisted
        ? `Featured image replaced${r.persisted.bodyImageReplaced ? ' and first body image swapped' : ''}.`
        : '';
      setSuccess(`Image regenerated. ${persistedNote}`.trim());
      // Refresh detail so the iframe + featured image reflect the new URL.
      const refreshed = await api.getPost(detail.id);
      setDetail(refreshed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegenBusy(false);
    }
  }

  function downloadGeneratedImage() {
    if (!regen?.image) return;
    const a = document.createElement('a');
    a.href = `data:${regen.image.mimeType};base64,${regen.image.base64}`;
    a.download = `regen-post-${detail?.id ?? 'image'}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === posts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(posts.map((p) => p.id)));
    }
  }

  async function refreshAfterBulk() {
    setSelected(new Set());
    await loadPosts();
    if (selectedId !== null) {
      try {
        const refreshed = await api.getPost(selectedId);
        setDetail(refreshed);
      } catch {
        // Selected post may have been discarded out of view; ignore.
      }
    }
  }

  async function handleBulkApprove() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (
      !confirm(
        `Approve and publish ${ids.length} post${ids.length > 1 ? 's' : ''} as WP draft${ids.length > 1 ? 's' : ''}? This may take ${ids.length * 5}-${ids.length * 15}s.`,
      )
    )
      return;

    setBulkBusy('approve');
    setBulkResult(null);
    setError(null);
    setSuccess(null);
    try {
      const r = await api.bulkPublish(ids);
      setBulkResult({
        kind: 'approve',
        summary: r.summary,
        errors: r.results
          .filter((x) => !x.ok)
          .map((x) => ({ id: x.id, error: x.error ?? 'unknown error' })),
      });
      await refreshAfterBulk();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkBusy(null);
    }
  }

  async function handleBulkCleanWp() {
    const eligibleIds = posts
      .filter((p) => selected.has(p.id) && p.status === 'published')
      .map((p) => p.id);
    if (eligibleIds.length === 0) {
      setError('No published posts in selection — re-clean only applies to posts already on WP.');
      return;
    }
    if (
      !confirm(
        `Re-clean ${eligibleIds.length} WP draft${eligibleIds.length > 1 ? 's' : ''}? This fetches each from WP, strips noise sections, and pushes back.`,
      )
    )
      return;

    setBulkBusy('clean-wp');
    setBulkResult(null);
    setError(null);
    setSuccess(null);
    try {
      const r = await api.bulkCleanWp(eligibleIds);
      setBulkResult({
        kind: 'clean-wp',
        summary: r.summary,
        errors: r.results
          .filter((x) => !x.ok)
          .map((x) => ({ id: x.id, error: x.error ?? 'unknown error' })),
      });
      await refreshAfterBulk();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkBusy(null);
    }
  }

  async function handleSingleCleanWp() {
    if (!detail || !detail.wpPostId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await api.cleanWp(detail.id);
      setSuccess(
        r.changed
          ? `WP draft #${r.wpPostId} updated (noise removed).`
          : `WP draft #${r.wpPostId} was already clean.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleCleanAllDbBodies() {
    if (
      !confirm(
        'Sweep ALL stored post bodies and strip noise sections? Affects future publishes; does not touch already-published WP drafts (use Re-clean on WP for those).',
      )
    )
      return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await api.cleanDbBodies();
      setSuccess(
        `Swept ${r.total} stored post${r.total === 1 ? '' : 's'} — cleaned ${r.cleaned}, ${r.unchanged} already clean.`,
      );
      await loadPosts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkReject() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Reject (discard) ${ids.length} post${ids.length > 1 ? 's' : ''}?`))
      return;

    setBulkBusy('reject');
    setBulkResult(null);
    setError(null);
    setSuccess(null);
    try {
      const r = await api.bulkDiscard(ids);
      setBulkResult({
        kind: 'reject',
        summary: r.summary,
        errors: r.results
          .filter((x) => !x.ok)
          .map((x) => ({ id: x.id, error: x.error ?? 'unknown error' })),
      });
      await refreshAfterBulk();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkBusy(null);
    }
  }

  async function handlePublish() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await api.publishPost(detail.id);
      setSuccess(
        `Published as WP draft #${r.wpPostId} · ${r.bodyImagesUploaded} body images uploaded, ${r.bodyImagesSkipped} skipped`,
      );
      await loadPosts();
      const refreshed = await api.getPost(detail.id);
      setDetail(refreshed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscard() {
    if (!detail) return;
    if (!confirm(`Discard "${detail.title}"?`)) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.discardPost(detail.id);
      setSuccess('Discarded.');
      setSelectedId(null);
      await loadPosts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const allSelected = posts.length > 0 && selected.size === posts.length;
  const someSelected = selected.size > 0 && selected.size < posts.length;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Review</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCleanAllDbBodies}
            disabled={busy}
            className="px-3 py-1.5 rounded border border-slate-300 text-xs hover:bg-slate-50 disabled:opacity-50"
            title="Strip Share / About-the-author / More-posts blocks from every stored post body. Affects future publishes."
          >
            Clean all stored bodies
          </button>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            className="rounded border bg-white px-2 py-1 text-sm"
          >
            <option value="scraped">Scraped (pending)</option>
            <option value="published">Published</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-3 rounded border border-green-200 bg-green-50 p-2 text-sm text-green-800">
          {success}
        </div>
      )}
      {bulkResult && (
        <div
          className={`mb-3 rounded border p-3 text-sm ${
            bulkResult.summary.failed === 0
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <span>{renderBulkSummary(bulkResult)}</span>
            {bulkResult.errors.length > 0 && (
              <button
                onClick={() => setBulkErrorsExpanded(!bulkErrorsExpanded)}
                className="text-xs underline"
              >
                {bulkErrorsExpanded ? 'hide errors' : 'show errors'}
              </button>
            )}
          </div>
          {bulkErrorsExpanded && bulkResult.errors.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs font-mono">
              {bulkResult.errors.map((e) => (
                <li key={e.id}>
                  #{e.id} — {e.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <aside className="rounded border bg-white max-h-[75vh] overflow-y-auto">
          {posts.length > 0 && (
            <div className="sticky top-0 z-10 bg-white border-b p-2 space-y-2">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleSelectAll}
                />
                <span>
                  {selected.size > 0
                    ? `${selected.size} selected`
                    : `Select all (${posts.length})`}
                </span>
              </label>
              <div className="flex gap-1.5">
                <button
                  onClick={handleBulkApprove}
                  disabled={selected.size === 0 || bulkBusy !== null}
                  className="flex-1 px-2 py-1 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bulkBusy === 'approve'
                    ? `Approving ${selected.size || ''}…`
                    : `Approve${selected.size ? ` ${selected.size}` : ''}`}
                </button>
                <button
                  onClick={handleBulkReject}
                  disabled={selected.size === 0 || bulkBusy !== null}
                  className="flex-1 px-2 py-1 rounded border border-slate-300 text-xs hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bulkBusy === 'reject'
                    ? `Rejecting ${selected.size || ''}…`
                    : `Reject${selected.size ? ` ${selected.size}` : ''}`}
                </button>
              </div>
              <button
                onClick={handleBulkCleanWp}
                disabled={selected.size === 0 || bulkBusy !== null}
                className="w-full px-2 py-1 rounded border border-slate-300 text-xs hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                title="For posts in selection that are already on WP: fetch, strip noise sections, push back."
              >
                {bulkBusy === 'clean-wp'
                  ? `Re-cleaning WP…`
                  : `Re-clean WP draft${selected.size > 1 ? 's' : ''} in selection`}
              </button>
            </div>
          )}
          {posts.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No posts in this view.</p>
          ) : (
            <ul>
              {posts.map((p) => (
                <li key={p.id} className="border-b">
                  <div
                    className={`flex items-start gap-2 px-3 py-2 ${
                      selectedId === p.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleSelected(p.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 flex-shrink-0"
                      aria-label={`Select ${p.title}`}
                    />
                    <button
                      onClick={() => setSelectedId(p.id)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="text-sm font-medium line-clamp-2">{p.title}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                        <StatusPill status={p.status} />
                        {p.sourceName && (
                          <span
                            className="inline-block max-w-[10rem] truncate rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
                            title={p.sourceName}
                          >
                            {p.sourceName}
                          </span>
                        )}
                        <span className="truncate">{p.author ?? '—'}</span>
                        <span>·</span>
                        <span>
                          {p.publishedAt
                            ? new Date(p.publishedAt).toLocaleDateString()
                            : '—'}
                        </span>
                      </div>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="col-span-2 rounded border bg-white">
          {!detail ? (
            <p className="p-4 text-sm text-slate-500">Select a post to preview.</p>
          ) : (
            <div className="flex flex-col h-[75vh]">
              <header className="p-4 border-b">
                <h3 className="text-lg font-semibold">{detail.title}</h3>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                  <StatusPill status={detail.status} />
                  <span>{detail.author ?? '—'}</span>
                  <span>·</span>
                  <span>{detail.category ?? '—'}</span>
                  <span>·</span>
                  <span>
                    {detail.publishedAt
                      ? new Date(detail.publishedAt).toLocaleDateString()
                      : '—'}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={handlePublish}
                    disabled={busy || detail.status === 'published'}
                    className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {detail.status === 'published'
                      ? `Published (WP #${detail.wpPostId})`
                      : busy
                      ? 'Publishing…'
                      : 'Approve (publish to WP)'}
                  </button>
                  <button
                    onClick={handleDiscard}
                    disabled={busy}
                    className="px-3 py-1.5 rounded border border-slate-300 text-sm hover:bg-slate-50 disabled:opacity-50"
                  >
                    Reject (discard)
                  </button>
                  {detail.status === 'published' && detail.wpPostId && (
                    <button
                      onClick={handleSingleCleanWp}
                      disabled={busy}
                      className="px-3 py-1.5 rounded border border-slate-300 text-sm hover:bg-slate-50 disabled:opacity-50"
                      title="Fetch the WP draft, strip noise sections, push back."
                    >
                      Re-clean on WP
                    </button>
                  )}
                  <button
                    onClick={handleRegenerateImage}
                    disabled={regenBusy || !detail.featuredImage}
                    className="px-3 py-1.5 rounded border border-purple-300 bg-purple-50 text-purple-800 text-sm font-medium hover:bg-purple-100 disabled:opacity-50"
                    title="Analyse the first image with GPT-4o vision, write an editorial prompt following the doc's formula, then generate a new banner with ChatGPT Images 2.0."
                  >
                    {regenBusy ? 'Regenerating image…' : 'Regenerate image'}
                  </button>
                  <a
                    href={detail.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-sm text-blue-600 hover:underline"
                  >
                    Source ↗
                  </a>
                </div>
              </header>
              <BodyPreview detail={detail} />
              {regen && (
                <RegenPanel
                  regen={regen}
                  onDownload={downloadGeneratedImage}
                  onClose={() => setRegen(null)}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function RegenPanel({
  regen,
  onDownload,
  onClose,
}: {
  regen: RegenerateImageResult;
  onDownload: () => void;
  onClose: () => void;
}) {
  const dataUrl = regen.image
    ? `data:${regen.image.mimeType};base64,${regen.image.base64}`
    : null;
  return (
    <div className="border-t bg-slate-50 p-4 max-h-[55vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold">
          Regenerated image · {regen.models.image}
        </h4>
        <div className="flex items-center gap-2">
          {dataUrl && (
            <button
              onClick={onDownload}
              className="px-2 py-1 rounded border border-slate-300 text-xs hover:bg-white"
            >
              Download PNG
            </button>
          )}
          <button
            onClick={onClose}
            className="px-2 py-1 rounded border border-slate-300 text-xs hover:bg-white"
          >
            Close
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <figure>
          <figcaption className="text-xs text-slate-500 mb-1">Reference (original)</figcaption>
          <img
            src={regen.referenceImageUrl}
            alt="reference"
            className="w-full rounded border border-slate-200 bg-white object-contain"
          />
        </figure>
        <figure>
          <figcaption className="text-xs text-slate-500 mb-1">Generated</figcaption>
          {dataUrl ? (
            <img
              src={dataUrl}
              alt="generated"
              className="w-full rounded border border-slate-200 bg-white object-contain"
            />
          ) : (
            <div className="text-xs text-slate-500">
              Image bytes were not returned.
            </div>
          )}
        </figure>
      </div>

      <details className="mb-2" open>
        <summary className="text-xs font-semibold text-slate-700 cursor-pointer">
          Generated prompt
        </summary>
        <p className="mt-1 whitespace-pre-wrap text-xs bg-white border border-slate-200 rounded p-2 font-mono">
          {regen.generatedPrompt}
        </p>
      </details>

      <details>
        <summary className="text-xs font-semibold text-slate-700 cursor-pointer">
          Vision analysis · {regen.models.vision}
        </summary>
        <p className="mt-1 whitespace-pre-wrap text-xs bg-white border border-slate-200 rounded p-2">
          {regen.visionAnalysis}
        </p>
      </details>
    </div>
  );
}

function renderBulkSummary(r: BulkResultState): string {
  if (r.kind === 'approve') {
    const tail = r.summary.failed > 0 ? `, ${r.summary.failed} failed` : '';
    return `Approved ${r.summary.ok} of ${r.summary.total}${tail}`;
  }
  if (r.kind === 'reject') {
    const tail = r.summary.failed > 0 ? `, ${r.summary.failed} failed` : '';
    return `Rejected ${r.summary.ok} of ${r.summary.total}${tail}`;
  }
  const alreadyClean = r.summary.ok - r.summary.changed;
  return `Re-cleaned WP: ${r.summary.changed} changed, ${alreadyClean} already clean, ${r.summary.failed} failed (of ${r.summary.total})`;
}

function BodyPreview({ detail }: { detail: PostDetail }) {
  const featured = detail.featuredImage
    ? `<img src="${detail.featuredImage}" alt="" />`
    : '';
  const srcDoc = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #1e293b; line-height: 1.6; max-width: 720px; margin: 24px auto; padding: 0 16px; }
  h1, h2, h3, h4 { line-height: 1.25; }
  h1 { font-size: 1.6rem; }
  h2 { font-size: 1.3rem; margin-top: 1.4em; }
  h3 { font-size: 1.1rem; margin-top: 1.2em; }
  p { margin: 0.75em 0; }
  img { max-width: 100%; height: auto; border-radius: 6px; }
  a { color: #2563eb; }
  ul, ol { padding-left: 1.5em; }
  blockquote { border-left: 3px solid #cbd5e1; padding-left: 1em; color: #475569; margin: 1em 0; }
  pre, code { background: #f1f5f9; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
  pre { padding: 0.75em; overflow-x: auto; }
  figure { margin: 1em 0; }
</style></head><body>
${featured}
${detail.bodyHtml}
</body></html>`;
  return (
    <iframe
      title="post preview"
      srcDoc={srcDoc}
      sandbox="allow-same-origin"
      className="flex-1 w-full"
    />
  );
}
