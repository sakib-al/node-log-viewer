import { format } from 'node:util';
import type { LogViewerPlugin } from '../plugins/plugin.js';
import { PluginRegistry } from '../plugins/registry.js';
import { SettingsStore } from './settings-store.js';
import { FileStore } from './storage/file-store.js';
import { LogReader } from './storage/reader.js';
import type { LogContext, LogEntry, LogLevel, LoggerOptions, SerializedError } from './types.js';
import { levelAtLeast } from './types.js';
import { generateId, isError, normalizeContext, serializeError } from './utils.js';

type ContextArg = LogContext | Error | unknown;

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';

export class Logger {
  readonly store: FileStore;
  readonly reader: LogReader;
  readonly plugins: PluginRegistry;
  /** Persisted, UI-editable settings (plugin configs). */
  readonly settings: SettingsStore;
  readonly options: Required<Pick<LoggerOptions, 'dir' | 'level' | 'console' | 'gitignore' | 'extension'>> &
    Pick<LoggerOptions, 'source'>;

  private readonly baseContext: LogContext | undefined;
  private writeErrorReported = false;
  private readonly parent: Logger | null;

  constructor(options: LoggerOptions = {}, internals?: { parent: Logger; source?: string; context?: LogContext }) {
    this.parent = internals?.parent ?? null;
    if (this.parent) {
      this.options = { ...this.parent.options, source: internals?.source ?? this.parent.options.source };
      this.store = this.parent.store;
      this.reader = this.parent.reader;
      this.plugins = this.parent.plugins;
      this.settings = this.parent.settings;
      this.baseContext = internals?.context;
      return;
    }

    this.options = {
      dir: options.dir ?? 'logs',
      level: options.level ?? 'debug',
      console: options.console ?? process.env.NODE_ENV !== 'production',
      gitignore: options.gitignore ?? true,
      extension: options.extension ?? 'log',
      source: options.source,
    };
    this.store = new FileStore({ dir: this.options.dir, extension: this.options.extension, gitignore: this.options.gitignore });
    this.reader = new LogReader(this.store);
    this.plugins = new PluginRegistry();
    this.settings = new SettingsStore(this.store.dir);
    this.baseContext = undefined;
    for (const p of options.plugins ?? []) this.use(p);
    // create the directory eagerly so the .gitignore exists even before the first log
    void this.store.init().catch((err) => this.reportWriteError(err));
  }

  /**
   * Registers a plugin and (asynchronously) applies any config previously saved from the UI.
   * Returns `this` for chaining.
   */
  use(plugin: LogViewerPlugin): this {
    this.plugins.register(plugin);
    this.hydration = this.hydration.then(() => this.hydratePlugin(plugin));
    return this;
  }

  /** Resolves once persisted settings have been applied to all registered plugins. */
  ready(): Promise<void> {
    return this.hydration;
  }

  private hydration: Promise<void> = Promise.resolve();

  private async hydratePlugin(plugin: LogViewerPlugin): Promise<void> {
    if (typeof plugin.configure !== 'function') return;
    try {
      const saved = await this.settings.getPluginConfig(plugin.name);
      if (saved) await plugin.configure(saved);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[node-log-viewer] could not apply saved settings for plugin "${plugin.name}": ${msg}`);
    }
  }

  /** Creates a logger that shares storage/plugins but adds a source and/or default context. */
  child(bindings: { source?: string; context?: LogContext } = {}): Logger {
    const merged = { ...(this.baseContext ?? {}), ...(bindings.context ?? {}) };
    return new Logger({}, {
      parent: this,
      source: bindings.source,
      context: Object.keys(merged).length ? merged : undefined,
    });
  }

  debug(message: string, context?: ContextArg): LogEntry | undefined {
    return this.log('debug', message, context);
  }

  info(message: string, context?: ContextArg): LogEntry | undefined {
    return this.log('info', message, context);
  }

  warn(message: string, context?: ContextArg): LogEntry | undefined {
    return this.log('warn', message, context);
  }

  /** Accepts either a message (optionally with an Error as context) or an Error directly. */
  error(messageOrError: string | Error | unknown, context?: ContextArg): LogEntry | undefined {
    if (typeof messageOrError !== 'string') {
      return this.exception(messageOrError, context);
    }
    return this.log('error', messageOrError, context);
  }

  /**
   * Records a caught exception at `error` level.
   * @example try { ... } catch (err) { logger.exception(err, { userId }) }
   */
  exception(err: unknown, context?: ContextArg, message?: string): LogEntry | undefined {
    const serialized = serializeError(err);
    const msg = message ?? (isError(err) ? `${serialized.name}: ${serialized.message}` : serialized.message);
    return this.write('error', msg, context, serialized);
  }

  /** Generic entry point used by all level helpers. */
  log(level: LogLevel, message: string, context?: ContextArg): LogEntry | undefined {
    let error: SerializedError | undefined;
    let ctx: ContextArg = context;
    if (isError(context)) {
      error = serializeError(context);
      ctx = undefined;
    } else if (context && typeof context === 'object' && isError((context as { error?: unknown }).error)) {
      const { error: innerError, ...rest } = context as LogContext & { error: unknown };
      error = serializeError(innerError);
      ctx = rest;
    }
    return this.write(level, message, ctx, error);
  }

  /** Waits for all queued file writes and plugin deliveries. */
  async flush(): Promise<void> {
    await this.store.flush();
    await this.plugins.flush();
  }

  async close(): Promise<void> {
    await this.store.flush();
    await this.plugins.close();
  }

  private write(level: LogLevel, message: string, context: ContextArg, error?: SerializedError): LogEntry | undefined {
    if (!levelAtLeast(level, this.options.level)) return undefined;

    const normalized = normalizeContext(context);
    const mergedContext =
      this.baseContext || normalized ? { ...(this.baseContext ?? {}), ...(normalized ?? {}) } : undefined;

    const entry: LogEntry = {
      id: generateId(),
      ts: new Date().toISOString(),
      level,
      message: typeof message === 'string' ? message : format('%s', message),
    };
    if (this.options.source) entry.source = this.options.source;
    if (mergedContext) entry.context = mergedContext;
    if (error) entry.error = error;

    if (this.options.console) this.printToConsole(entry);
    this.store.append(entry).catch((err) => this.reportWriteError(err));
    this.plugins.dispatch(entry);
    return entry;
  }

  private printToConsole(entry: LogEntry): void {
    const color = process.stdout.isTTY ? COLORS[entry.level] : '';
    const reset = process.stdout.isTTY ? RESET : '';
    const src = entry.source ? ` [${entry.source}]` : '';
    const line = `${color}${entry.ts} ${entry.level.toUpperCase().padEnd(5)}${reset}${src} ${entry.message}`;
    const extra: unknown[] = [];
    if (entry.context) extra.push(entry.context);
    if (entry.error?.stack) extra.push(`\n${entry.error.stack}`);
    const fn = entry.level === 'error' ? console.error : entry.level === 'warn' ? console.warn : console.log;
    fn(line, ...extra);
  }

  private reportWriteError(err: unknown): void {
    if (this.writeErrorReported) return;
    this.writeErrorReported = true;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[node-log-viewer] failed to write log file in "${this.store.dir}": ${msg}`);
  }
}

export function createLogger(options?: LoggerOptions): Logger {
  return new Logger(options);
}
