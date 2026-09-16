import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { AvailablePlugin, PluginView, SettingsField } from '../types';
import { cx } from '../lib';
import { CheckIcon, ChevronIcon, CopyIcon, PlugIcon } from './Icons';

interface Props {
  allowEdit: boolean;
}

export function SettingsView({ allowEdit }: Props) {
  const [plugins, setPlugins] = useState<PluginView[] | null>(null);
  const [available, setAvailable] = useState<AvailablePlugin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = () => {
    api
      .plugins()
      .then(({ plugins: list, available: avail }) => {
        setPlugins(list);
        setAvailable(avail);
        setError(null);
        // First visit: expand the first registered plugin (or the first available one when none is registered).
        setOpen((prev) => (prev.size ? prev : new Set([list[0]?.name ?? (avail[0] ? `available:${avail[0].name}` : '')])));
      })
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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

        {plugins && (
          <section className="space-y-3">
            <SectionHeading count={plugins.length}>Registered</SectionHeading>
            {plugins.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <PlugIcon className="mx-auto mb-2 text-slate-400" width={24} height={24} />
                No plugins registered yet. Pick one from the list below and add it to your logger setup in code; it will appear
                here with its settings once the app restarts.
              </div>
            )}
            {plugins.map((p) => (
              <AccordionItem
                key={p.name}
                open={open.has(p.name)}
                onToggle={() => toggle(p.name)}
                title={p.title}
                name={p.name}
                subtitle={p.description}
                badge={
                  <Badge tone={p.enabled ? 'ok' : 'muted'}>{p.enabled ? 'Enabled' : 'Disabled'}</Badge>
                }
              >
                <PluginPanel
                  plugin={p}
                  allowEdit={allowEdit}
                  onSaved={(np) => setPlugins((list) => list?.map((x) => (x.name === np.name ? np : x)) ?? null)}
                />
              </AccordionItem>
            ))}
          </section>
        )}

        {available.length > 0 && (
          <section className="space-y-3">
            <SectionHeading count={available.length}>Available</SectionHeading>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              These plugins ship with node-log-viewer but are not added to your logger. Plugins are registered in code so
              that credentials can come from your environment; once registered you can manage them from this page.
            </p>
            {available.map((p) => {
              const key = `available:${p.name}`;
              return (
                <AccordionItem
                  key={key}
                  open={open.has(key)}
                  onToggle={() => toggle(key)}
                  title={p.title}
                  name={p.name}
                  subtitle={p.description}
                  badge={<Badge tone="warn">Not registered</Badge>}
                >
                  <SetupPanel plugin={p} />
                </AccordionItem>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}

function SectionHeading({ children, count }: { children: ReactNode; count: number }) {
  return (
    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {children}
      <span className="rounded-full bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{count}</span>
    </h3>
  );
}

function Badge({ tone, children }: { tone: 'ok' | 'muted' | 'warn'; children: ReactNode }) {
  return (
    <span
      className={cx(
        'rounded-full px-2 py-px text-[11px] font-semibold',
        tone === 'ok' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200',
        tone === 'muted' && 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
        tone === 'warn' && 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
      )}
    >
      {children}
    </span>
  );
}

function AccordionItem({
  open,
  onToggle,
  title,
  name,
  subtitle,
  badge,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  name: string;
  subtitle?: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const panelId = `plugin-panel-${name}`;
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={cx(
          'flex w-full items-start justify-between gap-4 rounded-xl px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60',
          open && 'rounded-b-none border-b border-slate-100 dark:border-slate-800',
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{title}</h3>
            {badge}
            <code className="rounded bg-slate-100 px-1.5 py-px font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{name}</code>
          </div>
          {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        <ChevronIcon className={cx('mt-1 shrink-0 text-slate-400 transition-transform', open && 'rotate-90')} />
      </button>
      {open && <div id={panelId}>{children}</div>}
    </section>
  );
}

function PluginPanel({ plugin, allowEdit, onSaved }: { plugin: PluginView; allowEdit: boolean; onSaved: (p: PluginView) => void }) {
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
    <>
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
    </>
  );
}

type Flavor = 'node' | 'nest';

function setupSnippet(p: AvailablePlugin, flavor: Flavor): string {
  const call = `${p.factory}({ ${p.credentialOption}: process.env.${p.envVar} })`;
  if (flavor === 'nest') {
    return [
      `// app.module.ts`,
      `import { LogViewerModule, ${p.factory} } from 'node-log-viewer/nest';`,
      ``,
      `@Module({`,
      `  imports: [`,
      `    LogViewerModule.forRoot({`,
      `      dir: 'logs',`,
      `      plugins: [${call}],`,
      `    }),`,
      `  ],`,
      `})`,
      `export class AppModule {}`,
    ].join('\n');
  }
  return [
    `// app.js - where you call initLogger()`,
    `const { initLogger, ${p.factory} } = require('node-log-viewer');`,
    ``,
    `initLogger({`,
    `  dir: 'logs',`,
    `  plugins: [${call}],`,
    `});`,
  ].join('\n');
}

function SetupPanel({ plugin }: { plugin: AvailablePlugin }) {
  const [flavor, setFlavor] = useState<Flavor>('node');
  const [copied, setCopied] = useState(false);
  const code = setupSnippet(plugin, flavor);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (http origin); the user can still select the text
    }
  };

  return (
    <div className="space-y-4 px-5 py-4">
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-300">
        <li>
          Create an incoming webhook in {plugin.title} and copy its URL (
          <a href={plugin.docsUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-900 dark:hover:text-slate-100">
            {plugin.title} docs
          </a>
          ).
        </li>
        <li>
          Register the plugin where you configure the logger. You can pass the URL from an environment variable now, or leave it
          out and paste it on this page later.
        </li>
        <li>Restart the app. {plugin.title} will move to the “Registered” list above with its settings and a test button.</li>
      </ol>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800/60">
          <div className="flex gap-1">
            {(['node', 'nest'] as Flavor[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFlavor(f)}
                className={cx(
                  'rounded-md px-2.5 py-1 text-xs font-medium',
                  flavor === f
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
                )}
              >
                {f === 'node' ? 'Node.js / Express' : 'NestJS'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
          >
            {copied ? <CheckIcon width={12} height={12} /> : <CopyIcon width={12} height={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="overflow-x-auto bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">{code}</pre>
      </div>
    </div>
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
