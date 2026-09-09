import { useEffect, useState } from 'react';
import { api } from '../api';
import type { PluginView, SettingsField } from '../types';
import { cx } from '../lib';
import { PlugIcon } from './Icons';

interface Props {
  allowEdit: boolean;
}

export function SettingsView({ allowEdit }: Props) {
  const [plugins, setPlugins] = useState<PluginView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .plugins()
      .then((p) => {
        setPlugins(p);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <div>
          <h2 className="text-xl font-semibold">Plugins</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Plugins receive every log entry at or above their minimum level and forward it elsewhere. Settings saved here are
            stored next to your log files (and are git-ignored with them).
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
            {error}
          </div>
        )}

        {plugins && plugins.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <PlugIcon className="mx-auto mb-2 text-slate-400" width={24} height={24} />
            No plugins registered. Add one in code, for example:
            <pre className="mx-auto mt-3 max-w-md rounded-lg bg-slate-900 p-3 text-left font-mono text-xs text-slate-100">
              {`import { createLogger, discordPlugin } from 'node-log-viewer';\n\nconst logger = createLogger({\n  plugins: [discordPlugin()],\n});`}
            </pre>
          </div>
        )}

        {plugins?.map((p) => (
          <PluginCard key={p.name} plugin={p} allowEdit={allowEdit} onSaved={(np) => setPlugins((list) => list?.map((x) => (x.name === np.name ? np : x)) ?? null)} />
        ))}
      </div>
    </div>
  );
}

function PluginCard({ plugin, allowEdit, onSaved }: { plugin: PluginView; allowEdit: boolean; onSaved: (p: PluginView) => void }) {
  const [form, setForm] = useState<Record<string, unknown>>(plugin.config);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => setForm(plugin.config), [plugin]);

  const editable = allowEdit && plugin.configurable;

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const updated = await api.savePlugin(plugin.name, form);
      onSaved(updated);
      setNotice({ tone: 'ok', text: 'Settings saved.' });
    } catch (e) {
      setNotice({ tone: 'err', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setNotice(null);
    try {
      await api.testPlugin(plugin.name);
      setNotice({ tone: 'ok', text: 'Test message sent. Check your channel.' });
    } catch (e) {
      setNotice({ tone: 'err', text: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">{plugin.title}</h3>
            <span
              className={cx(
                'rounded-full px-2 py-px text-[11px] font-semibold',
                plugin.enabled
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
              )}
            >
              {plugin.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          {plugin.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{plugin.description}</p>}
        </div>
        <code className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{plugin.name}</code>
      </header>

      <div className="space-y-4 px-5 py-4">
        {plugin.settingsSchema.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">This plugin has no editable settings.</p>
        )}
        {plugin.settingsSchema.map((field) => (
          <Field
            key={field.key}
            field={field}
            value={form[field.key]}
            secretSet={plugin.secretsSet.includes(field.key)}
            disabled={!editable}
            onChange={(v) => setForm((f) => ({ ...f, [field.key]: v }))}
          />
        ))}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
        <div className="text-sm">
          {notice && (
            <span className={notice.tone === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}>{notice.text}</span>
          )}
          {!allowEdit && <span className="text-slate-500 dark:text-slate-400">Editing is disabled by the server configuration.</span>}
        </div>
        <div className="flex items-center gap-2">
          {plugin.testable && (
            <button
              type="button"
              onClick={test}
              disabled={testing}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              {testing ? 'Sending…' : 'Send test message'}
            </button>
          )}
          {editable && (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}

function Field({
  field,
  value,
  secretSet,
  disabled,
  onChange,
}: {
  field: SettingsField;
  value: unknown;
  secretSet: boolean;
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const inputCls =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-slate-400 focus:ring-2 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950';

  if (field.type === 'boolean') {
    return (
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 accent-slate-900 dark:accent-slate-100"
        />
        <span>
          <span className="block text-sm font-medium">{field.label}</span>
          {field.description && <span className="block text-xs text-slate-500 dark:text-slate-400">{field.description}</span>}
        </span>
      </label>
    );
  }

  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">
        {field.label}
        {'required' in field && field.required && <span className="ml-1 text-rose-500">*</span>}
      </span>
      {field.type === 'select' ? (
        <select value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
          value={value === undefined || value === null ? '' : String(value)}
          disabled={disabled}
          placeholder={field.type === 'password' && secretSet ? '•••••••••••• (saved — leave blank to keep)' : field.placeholder}
          onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
          autoComplete="off"
          className={cx(inputCls, field.type === 'password' && 'font-mono')}
        />
      )}
      {field.description && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{field.description}</span>}
    </label>
  );
}
