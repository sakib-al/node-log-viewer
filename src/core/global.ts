import { Logger, createLogger } from './logger.js';
import type { LogContext, LogEntry, LogLevel, LoggerOptions } from './types.js';
import type { LogViewerPlugin } from '../plugins/plugin.js';

let current: Logger | null = null;
let initialized = false;

/**
 * Creates the global logger. Call this once at application startup.
 * Calling it again returns the existing instance unless `force: true` is passed.
 */
export function initLogger(options: LoggerOptions & { force?: boolean } = {}): Logger {
  const { force, ...loggerOptions } = options;
  if (current && initialized && !force) {
    return current;
  }
  current = createLogger(loggerOptions);
  initialized = true;
  return current;
}

/** Makes an existing Logger instance the global one. */
export function setLogger(logger: Logger): Logger {
  current = logger;
  initialized = true;
  return logger;
}

/**
 * Returns the global logger. If `initLogger()` has not been called yet a logger with
 * default options (`./logs`) is created so logging never throws.
 */
export function getLogger(): Logger {
  if (!current) {
    current = createLogger();
  }
  return current;
}

/** True once `initLogger()` or `setLogger()` has been called. */
export function isLoggerInitialized(): boolean {
  return initialized;
}

/** Test helper: forgets the global logger. */
export function resetLogger(): void {
  current = null;
  initialized = false;
}

type ContextArg = LogContext | Error | unknown;

export const log = {
  debug(message: string, context?: ContextArg): LogEntry | undefined {
    return getLogger().debug(message, context);
  },
  info(message: string, context?: ContextArg): LogEntry | undefined {
    return getLogger().info(message, context);
  },
  warn(message: string, context?: ContextArg): LogEntry | undefined {
    return getLogger().warn(message, context);
  },
  error(messageOrError: string | Error | unknown, context?: ContextArg): LogEntry | undefined {
    return getLogger().error(messageOrError, context);
  },
  exception(err: unknown, context?: ContextArg, message?: string): LogEntry | undefined {
    return getLogger().exception(err, context, message);
  },
  log(level: LogLevel, message: string, context?: ContextArg): LogEntry | undefined {
    return getLogger().log(level, message, context);
  },
  /** Child logger bound to a `source` (e.g. a module or class name) and/or default context. */
  child(bindings?: { source?: string; context?: LogContext }): Logger {
    return getLogger().child(bindings);
  },
  use(plugin: LogViewerPlugin): Logger {
    return getLogger().use(plugin);
  },
  flush(): Promise<void> {
    return getLogger().flush();
  },
  close(): Promise<void> {
    return getLogger().close();
  },
  /** The underlying global Logger instance. */
  get instance(): Logger {
    return getLogger();
  },
};

export type GlobalLog = typeof log;
