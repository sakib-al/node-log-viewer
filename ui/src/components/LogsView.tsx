import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { LevelFilter, ReadResult } from '../types';
import { cx, formatDateLabel } from '../lib';
import { LevelTabs } from './LevelTabs';
import { LogEntryRow } from './LogEntryRow';
import { RefreshIcon, SearchIcon } from './Icons';

interface Props {
  date: string | null;
  autoRefresh: boolean;
  /** Bumped by the parent to force a reload (e.g. after the date list refreshed). */
  refreshToken: number;
  onReload: () => void;
}

const PAGE_SIZES = [25, 50, 100, 200];

export function LogsView({ date, autoRefresh, refreshToken, onReload }: Props) {
  const [level, setLevel] = useState<LevelFilter>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [result, setResult] = useState<ReadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [date, level, debounced, pageSize, order]);

  useEffect(() => {
    if (!date) {
      setResult(null);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    api
      .logs({ date, level, search: debounced, page, pageSize, order })
      .then((r) => {
        if (id !== requestId.current) return;
        setResult(r);
        setError(null);
      })
      .catch((e: Error) => {
        if (id !== requestId.current) return;
        setError(e.message);
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [date, level, debounced, page, pageSize, order, refreshToken]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(onReload, 4000);
    return () => clearInterval(t);
  }, [autoRefresh, onReload]);

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  if (!date) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-10 text-center text-slate-500 dark:text-slate-400">
        <p className="text-lg font-medium">No log file selected</p>
        <p className="mt-1 text-sm">Log something from your application and it will show up in the sidebar.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="space-y-3 border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{formatDateLabel(date)}</h2>
            <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{date}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" width={14} height={14} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search message, context, stack…"
                className="w-72 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none ring-slate-400 placeholder:text-slate-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <button
              type="button"
              onClick={onReload}
              title="Refresh"
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RefreshIcon className={cx(loading && 'animate-spin')} />
            </button>
          </div>
        </div>
        <LevelTabs counts={result?.counts ?? null} value={level} onChange={setLevel} />
      </div>

      {error && (
        <div className="mx-5 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {result && result.entries.length === 0 && (
          <p className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">No entries match the current filter.</p>
        )}
        <ul>
          {result?.entries.map((e) => (
            <LogEntryRow key={e.id} entry={e} highlight={debounced} />
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-2 text-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
          <span>
            {result ? `${result.total} ${result.total === 1 ? 'entry' : 'entries'}` : '—'}
          </span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {order === 'desc' ? 'Newest first' : 'Oldest first'}
          </button>
        </div>
        <div className="flex items-center gap-1">
          <PageButton disabled={page <= 1} onClick={() => setPage(1)}>
            «
          </PageButton>
          <PageButton disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </PageButton>
          <span className="px-2 tabular-nums text-slate-600 dark:text-slate-300">
            {page} / {totalPages}
          </span>
          <PageButton disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </PageButton>
          <PageButton disabled={page >= totalPages} onClick={() => setPage(totalPages)}>
            »
          </PageButton>
        </div>
      </div>
    </div>
  );
}

function PageButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
    >
      {children}
    </button>
  );
}
