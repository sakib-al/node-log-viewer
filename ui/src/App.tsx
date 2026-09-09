import { useCallback, useEffect, useState } from 'react';
import { INITIAL_TITLE, api } from './api';
import type { DateFileInfo, Meta } from './types';
import { cx } from './lib';
import { Sidebar } from './components/Sidebar';
import { LogsView } from './components/LogsView';
import { SettingsView } from './components/SettingsView';
import { ListIcon, MenuIcon, MoonIcon, SettingsIcon, SunIcon } from './components/Icons';

type View = 'logs' | 'settings';

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('nlv-theme', dark ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [dates, setDates] = useState<DateFileInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>('logs');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const [loadingDates, setLoadingDates] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { dark, toggle } = useTheme();

  const title = meta?.title ?? INITIAL_TITLE;
  useEffect(() => {
    document.title = title;
  }, [title]);

  const loadDates = useCallback(async () => {
    try {
      const list = await api.dates();
      setDates(list);
      setError(null);
      setSelected((cur) => (cur && list.some((d) => d.date === cur) ? cur : list[0]?.date ?? null));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingDates(false);
    }
  }, []);

  useEffect(() => {
    api.meta().then(setMeta).catch(() => undefined);
    void loadDates();
  }, [loadDates]);

  const reload = useCallback(() => {
    void loadDates();
    setRefreshToken((t) => t + 1);
  }, [loadDates]);

  const onDelete = async (date: string) => {
    if (!window.confirm(`Delete the log file for ${date}? This cannot be undone.`)) return;
    try {
      await api.deleteDate(date);
      await loadDates();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          title="Toggle sidebar"
        >
          <MenuIcon />
        </button>
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 font-mono text-xs font-bold text-white dark:bg-slate-100 dark:text-slate-900">
            {'>_'}
          </span>
          <h1 className="text-sm font-semibold">{title}</h1>
          {meta && <span className="hidden text-xs text-slate-400 sm:inline">v{meta.version}</span>}
        </div>

        <nav className="ml-6 flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          <NavButton active={view === 'logs'} onClick={() => setView('logs')} icon={<ListIcon width={14} height={14} />} label="Logs" />
          <NavButton active={view === 'settings'} onClick={() => setView('settings')} icon={<SettingsIcon width={14} height={14} />} label="Plugins" />
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {view === 'logs' && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <span className="relative inline-flex h-5 w-9 items-center">
                <input type="checkbox" className="peer sr-only" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
                <span className="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-emerald-500 dark:bg-slate-600" />
                <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
              </span>
              Live
            </label>
          )}
          <button
            type="button"
            onClick={toggle}
            title="Toggle theme"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {view === 'logs' && sidebarOpen && (
          <Sidebar dates={dates} selected={selected} onSelect={setSelected} onDelete={meta?.allowDelete === false ? undefined : onDelete} loading={loadingDates} />
        )}
        <main className="min-w-0 flex-1 bg-slate-50 dark:bg-slate-950">
          {view === 'logs' ? (
            <LogsView date={selected} autoRefresh={autoRefresh} refreshToken={refreshToken} onReload={reload} />
          ) : (
            <SettingsView allowEdit={meta?.allowPluginConfig !== false} />
          )}
        </main>
      </div>

      {meta && (
        <footer className="flex h-7 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4 font-mono text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          <span className="truncate">{meta.dir}</span>
          <span>node-log-viewer</span>
        </footer>
      )}
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition',
        active ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
