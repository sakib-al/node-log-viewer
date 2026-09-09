import type { LevelCounts, LevelFilter } from '../types';
import { LEVELS } from '../types';
import { LEVEL_STYLES, cx } from '../lib';

interface Props {
  counts: LevelCounts | null;
  value: LevelFilter;
  onChange: (level: LevelFilter) => void;
}

export function LevelTabs({ counts, value, onChange }: Props) {
  const tabs: Array<{ key: LevelFilter; label: string; dot?: string; color?: string }> = [
    { key: 'all', label: 'All' },
    ...LEVELS.map((l) => ({ key: l as LevelFilter, label: LEVEL_STYLES[l].label, dot: LEVEL_STYLES[l].dot, color: LEVEL_STYLES[l].tab })),
  ];
  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 dark:bg-slate-800" role="tablist">
      {tabs.map((t) => {
        const active = t.key === value;
        const n = counts ? counts[t.key] : 0;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(t.key)}
            className={cx(
              'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition',
              active
                ? 'bg-white shadow-sm text-slate-900 dark:bg-slate-950 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white',
            )}
          >
            {t.dot && <span className={cx('h-2 w-2 rounded-full', t.dot)} />}
            <span className={cx(active && t.color)}>{t.label}</span>
            <span className="rounded-full bg-slate-200/80 px-1.5 text-[11px] tabular-nums text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {n}
            </span>
          </button>
        );
      })}
    </div>
  );
}
