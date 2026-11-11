import { useState, type FormEvent } from 'react';
import { MoonIcon, SunIcon } from './Icons';

interface LoginViewProps {
  title: string;
  realm?: string;
  error: string | null;
  dark: boolean;
  onToggleTheme: () => void;
  onSubmit: (username: string, password: string) => Promise<void>;
}

export function LoginView({ title, realm, error, dark, onToggleTheme, onSubmit }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const message = localError ?? error;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setLocalError('Username is required');
      return;
    }
    setLocalError(null);
    setSubmitting(true);
    try {
      await onSubmit(username, password);
    } catch (err) {
      setLocalError((err as Error).message || 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-slate-50 dark:bg-slate-950">
      <header className="flex h-14 shrink-0 items-center justify-end gap-2 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={onToggleTheme}
          title="Toggle theme"
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {dark ? <SunIcon /> : <MoonIcon />}
        </button>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 font-mono text-sm font-bold text-white dark:bg-slate-100 dark:text-slate-900">
              {'>_'}
            </span>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">{title}</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Sign in to view logs{realm ? ` · ${realm}` : ''}
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            {message && (
              <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
                {message}
              </div>
            )}

            <label className="mb-4 block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">Username</span>
              <input
                type="text"
                name="username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-emerald-500/40 focus:border-emerald-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>

            <label className="mb-6 block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">Password</span>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-emerald-500/40 focus:border-emerald-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-slate-900 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
