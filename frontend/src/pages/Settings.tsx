import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  api,
  type Settings as TSettings,
  type SettingsUpdate,
  type Source,
} from '../lib/api';

type FormState = {
  wpUrl: string;
  wpUsername: string;
  wpAppPassword: string; // empty = unchanged
  wpAuthorUsername: string;
  scrapeCron: string;
  scrapeCronEnabled: boolean;
};

function toForm(s: TSettings): FormState {
  return {
    wpUrl: s.wp.url ?? '',
    wpUsername: s.wp.username ?? '',
    wpAppPassword: '',
    wpAuthorUsername: s.wp.authorUsername ?? '',
    scrapeCron: s.scrape.cron,
    scrapeCronEnabled: s.scrape.cronEnabled,
  };
}

function diffUpdate(form: FormState, base: TSettings): SettingsUpdate {
  const update: SettingsUpdate = {};
  const wp: Record<string, string | null> = {};
  if (form.wpUrl !== (base.wp.url ?? '')) wp.url = form.wpUrl || null;
  if (form.wpUsername !== (base.wp.username ?? '')) wp.username = form.wpUsername || null;
  if (form.wpAppPassword.length > 0) wp.appPassword = form.wpAppPassword;
  if (form.wpAuthorUsername !== (base.wp.authorUsername ?? '')) {
    wp.authorUsername = form.wpAuthorUsername || null;
  }
  if (Object.keys(wp).length > 0) update.wp = wp;
  const scrape: Record<string, string | boolean> = {};
  if (form.scrapeCron !== base.scrape.cron) scrape.cron = form.scrapeCron;
  if (form.scrapeCronEnabled !== base.scrape.cronEnabled)
    scrape.cronEnabled = form.scrapeCronEnabled;
  if (Object.keys(scrape).length > 0) update.scrape = scrape;
  return update;
}

export default function Settings() {
  const [base, setBase] = useState<TSettings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setBase(s);
        setForm(toForm(s));
      })
      .catch((e: unknown) =>
        setLoadError(e instanceof Error ? e.message : String(e)),
      );
  }, []);

  function update<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [field]: value } : f));
    setSaved(false);
    setSaveError(null);
  }

  async function handleSave() {
    if (!form || !base) return;
    const updates = diffUpdate(form, base);
    if (Object.keys(updates).length === 0) {
      setSaveError('Nothing to save.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const s = await api.saveSettings(updates);
      setBase(s);
      setForm(toForm(s));
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testWp();
      if (r.ok && r.user) {
        setTestResult({ ok: true, msg: `Connected as ${r.user.name} (id ${r.user.id})` });
      } else {
        setTestResult({ ok: false, msg: r.error ?? 'unknown error' });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  const dirty = form && base ? Object.keys(diffUpdate(form, base)).length > 0 : false;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Settings</h2>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {loadError && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {loadError}
        </div>
      )}
      {saveError && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {saveError}
        </div>
      )}
      {saved && (
        <div className="mb-3 rounded border border-green-200 bg-green-50 p-2 text-sm text-green-800">
          Settings saved. {base?.scrape.cronEnabled ? 'Cron rescheduled.' : ''}
        </div>
      )}

      <div className="space-y-4">
        <SourcesCard />

        {form && base && (
          <>
            <Card
              title="WordPress"
              actions={
                <button
                  onClick={handleTest}
                  disabled={testing}
                  className="px-3 py-1.5 rounded border border-slate-300 text-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
              }
            >
              <Field label="URL">
                <input
                  type="url"
                  value={form.wpUrl}
                  onChange={(e) => update('wpUrl', e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </Field>
              <Field label="Username">
                <input
                  type="text"
                  value={form.wpUsername}
                  onChange={(e) => update('wpUsername', e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </Field>
              <Field label="App password">
                <input
                  type="password"
                  value={form.wpAppPassword}
                  onChange={(e) => update('wpAppPassword', e.target.value)}
                  placeholder={base.wp.appPasswordMasked ?? '(not set)'}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-mono"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Leave empty to keep the existing password. New value is encrypted with AES-256-GCM before storage.
                </p>
              </Field>
              <Field label="Author">
                <input
                  type="text"
                  value={form.wpAuthorUsername}
                  onChange={(e) => update('wpAuthorUsername', e.target.value)}
                  placeholder="(leave empty to use the authenticating user)"
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-mono"
                />
                <p className="mt-1 text-xs text-slate-500">
                  The WP login slug (not display name) of the user that should be set as author on published posts. The user must exist on the WP site.
                </p>
              </Field>
              {testResult && (
                <div
                  className={`text-sm mt-2 ${
                    testResult.ok ? 'text-green-700' : 'text-red-700'
                  }`}
                >
                  {testResult.ok ? '✓ ' : '✗ '}
                  {testResult.msg}
                </div>
              )}
            </Card>

            <Card title="Scrape schedule">
              <Field label="Cron expression">
                <input
                  type="text"
                  value={form.scrapeCron}
                  onChange={(e) => update('scrapeCron', e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-mono"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Default <code className="font-mono">0 * * * *</code> = top of every hour. Cron changes restart the in-process scheduler.
                </p>
              </Field>
              <Field label="Enabled">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.scrapeCronEnabled}
                    onChange={(e) => update('scrapeCronEnabled', e.target.checked)}
                  />
                  <span>Run scheduled scrapes</span>
                </label>
              </Field>
            </Card>
          </>
        )}
      </div>
    </section>
  );
}

function SourcesCard() {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [homepageUrl, setHomepageUrl] = useState('');

  async function load() {
    try {
      setSources(await api.listSources());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !homepageUrl.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createSource(name.trim(), homepageUrl.trim());
      setName('');
      setHomepageUrl('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(src: Source) {
    setError(null);
    try {
      await api.updateSource(src.id, { enabled: !src.enabled });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(src: Source) {
    if (!window.confirm(`Delete source "${src.name}"? Existing posts will be kept (unlinked).`)) return;
    setError(null);
    try {
      await api.deleteSource(src.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Card title="Scrape sources">
      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {sources && sources.length === 0 && (
        <p className="text-sm text-slate-500">No sources yet. Add one below.</p>
      )}

      {sources && sources.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200">
          {sources.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <label className="inline-flex items-center gap-2 shrink-0">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={() => handleToggle(s)}
                />
              </label>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{s.name}</div>
                <div className="truncate text-xs text-slate-500">{s.homepageUrl}</div>
              </div>
              {s.lastScrapedAt && (
                <span className="shrink-0 text-xs text-slate-500">
                  last scraped {new Date(s.lastScrapedAt).toLocaleString()}
                </span>
              )}
              <button
                onClick={() => handleDelete(s)}
                className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-red-50 hover:border-red-300 hover:text-red-700"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="mt-3 grid grid-cols-[1fr_2fr_auto] gap-2">
        <input
          type="text"
          placeholder="Name (e.g. TechCrunch)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <input
          type="url"
          placeholder="https://example.com/"
          value={homepageUrl}
          onChange={(e) => setHomepageUrl(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm font-mono"
        />
        <button
          type="submit"
          disabled={busy || !name.trim() || !homepageUrl.trim()}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </form>
      <p className="mt-1 text-xs text-slate-500">
        Content is extracted with Mozilla Readability — works on most blog/news sites with no per-site config.
      </p>
    </Card>
  );
}

function Card({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded border bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {actions}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 items-start">
      <span className="pt-1 text-sm text-slate-500">{label}</span>
      <div className="col-span-2">{children}</div>
    </div>
  );
}
