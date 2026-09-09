import { useState } from 'react';
import type { LogEntry } from '../types';
import { LEVEL_STYLES, copyText, cx, formatTime, pretty } from '../lib';
import { CheckIcon, ChevronIcon, CopyIcon } from './Icons';

interface Props {
  entry: LogEntry;
  highlight?: string;
}

export function LogEntryRow({ entry, highlight }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasDetails = Boolean(entry.context || entry.error);
  const style = LEVEL_STYLES[entry.level];

  const onCopy = async () => {
    const ok = await copyText(JSON.stringify(entry, null, 2));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

  return (
    <li className={cx('border-b border-slate-100 dark:border-slate-800', open && 'bg-slate-50/70 dark:bg-slate-900/60')}>
      <div
        className={cx('flex items-start gap-3 px-4 py-2.5', hasDetails && 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/60')}
        onClick={() => hasDetails && setOpen((v) => !v)}
        role={hasDetails ? 'button' : undefined}
        aria-expanded={hasDetails ? open : undefined}
      >
        <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center text-slate-400">
          {hasDetails && <ChevronIcon width={14} height={14} className={cx('transition-transform', open && 'rotate-90')} />}
        </span>
        <span className="mt-0.5 w-24 shrink-0 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400" title={entry.ts}>
          {formatTime(entry.ts)}
        </span>
        <span className={cx('mt-0.5 w-14 shrink-0 rounded px-1.5 py-px text-center text-[11px] font-semibold uppercase', style.badge)}>
          {entry.level}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm leading-6">
            {entry.source && (
              <span className="mr-2 rounded bg-slate-100 px-1.5 py-px font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {entry.source}
              </span>
            )}
            <Highlighted text={entry.message} query={highlight} />
          </p>
          {!open && entry.error && (
            <p className="mt-0.5 truncate font-mono text-xs text-rose-600 dark:text-rose-300">
              {entry.error.name}: {entry.error.message}
            </p>
          )}
        </div>
        <button
          type="button"
          title="Copy entry as JSON"
          onClick={(e) => {
            e.stopPropagation();
            void onCopy();
          }}
          className="mt-0.5 shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          {copied ? <CheckIcon width={14} height={14} /> : <CopyIcon width={14} height={14} />}
        </button>
      </div>
      {open && hasDetails && (
        <div className="space-y-3 px-4 pb-4 pl-14">
          {entry.error && (
            <Section title={`${entry.error.name}: ${entry.error.message}`} tone="error">
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-rose-900 dark:text-rose-100">
                {entry.error.stack ?? '(no stack trace)'}
              </pre>
              {Object.keys(entry.error).some((k) => !['name', 'message', 'stack'].includes(k)) && (
                <pre className="mt-2 overflow-x-auto font-mono text-xs leading-5 text-rose-900/80 dark:text-rose-100/80">
                  {pretty(Object.fromEntries(Object.entries(entry.error).filter(([k]) => !['name', 'message', 'stack'].includes(k))))}
                </pre>
              )}
            </Section>
          )}
          {entry.context && (
            <Section title="Context">
              <pre className="overflow-x-auto font-mono text-xs leading-5 text-slate-800 dark:text-slate-200">{pretty(entry.context)}</pre>
            </Section>
          )}
          <p className="font-mono text-[11px] text-slate-400">id {entry.id} · {entry.ts}</p>
        </div>
      )}
    </li>
  );
}

function Section({ title, tone, children }: { title: string; tone?: 'error'; children: React.ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-lg border p-3',
        tone === 'error'
          ? 'border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/40'
          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950',
      )}
    >
      <div className={cx('mb-2 text-xs font-semibold', tone === 'error' ? 'text-rose-700 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400')}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Highlighted({ text, query }: { text: string; query?: string }) {
  const q = query?.trim();
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-500/40 dark:text-inherit">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}
