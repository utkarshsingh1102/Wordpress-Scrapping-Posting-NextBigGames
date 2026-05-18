import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, type Settings as TSettings, type SettingsUpdate } from '../lib/api';

type FormState = {
  sourceUrl: string;
  wpUrl: string;
  wpUsername: string;
  wpAppPassword: string; // empty = unchanged
  wpAuthorUsername: string;
  scrapeCron: string;
  scrapeCronEnabled: boolean;
};

function toForm(s: TSettings): FormState {
  return {
    sourceUrl: s.sourceUrl,
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
  if (form.sourceUrl !== base.sourceUrl) update.sourceUrl = form.sourceUrl;
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
  if (form.scrapeCronEnabled !== base.scrape.cronEnabled) scrape.cronEnabled = form.scrapeCronEnabled;
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

      {form && base && (
        <div className="space-y-4">
          <Card title="Source">
            <Field label="Source URL">
              <input
                type="url"
                value={form.sourceUrl}
                onChange={(e) => update('sourceUrl', e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </Field>
          </Card>

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
        </div>
      )}
    </section>
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
