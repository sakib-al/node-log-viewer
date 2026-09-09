import type { DateFileInfo } from '../types';
import { cx, formatBytes, formatDateLabel } from '../lib';
import { TrashIcon } from './Icons';

interface Props {
  dates: DateFileInfo[];
  selected: string | null;
  onSelect: (date: string) => void;
  onDelete?: (date: string) => void;
  loading: boolean;
}

export function Sidebar({ dates, selected, onSelect, onDelete, loading }: Props) {
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span>Log files</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {dates.length}
        </span>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {dates.length === 0 && !loading && (
          <p className="px-2 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            No log files yet. Entries appear here as soon as your app logs something.
          </p>
        )}
        <ul className="space-y-1">
          {dates.map((d) => {
            const active = d.date === selected;
            return (
              <li key={d.date}>
                <div
                  className={cx(
                    'group flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition',
                    active
                      ? 'bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800',
                  )}
                >
                  <button type="button" onClick={() => onSelect(d.date)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{formatDateLabel(d.date)}</span>
                      <span className={cx('text-[11px] tabular-nums', active ? 'opacity-70' : 'text-slate-500 dark:text-slate-400')}>
                        {d.count}
                      </span>
                    </div>
                    <div className={cx('mt-0.5 flex items-center gap-2 text-[11px]', active ? 'opacity-70' : 'text-slate-500 dark:text-slate-400')}>
                      <span className="font-mono">{d.date}</span>
                      <span>·</span>
                      <span>{formatBytes(d.sizeBytes)}</span>
                      {d.counts.error > 0 && (
                        <span className={cx('ml-auto rounded px-1.5 py-px font-semibold', active ? 'bg-rose-500 text-white' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-200')}>
                          {d.counts.error} err
                        </span>
                      )}
                    </div>
                  </button>
                  {onDelete && (
                    <button
                      type="button"
                      title="Delete this log file"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(d.date);
                      }}
                      className={cx(
                        'mt-0.5 rounded p-1 opacity-0 transition group-hover:opacity-100 focus:opacity-100',
                        active ? 'hover:bg-white/20' : 'text-slate-400 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-900/50',
                      )}
                    >
                      <TrashIcon width={14} height={14} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
