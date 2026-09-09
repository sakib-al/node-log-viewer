import type { LogEntry } from '../core/types.js';
import { levelAtLeast } from '../core/types.js';
import type { LogViewerPlugin } from './plugin.js';

export type PluginErrorHandler = (plugin: LogViewerPlugin, error: unknown, entry?: LogEntry) => void;

/**
 * Holds registered plugins and fans entries out to them.
 * A throwing/rejecting plugin never affects the logger or other plugins.
 */
export class PluginRegistry {
  private readonly plugins = new Map<string, LogViewerPlugin>();
  private inFlight = new Set<Promise<void>>();

  constructor(private readonly onError: PluginErrorHandler = defaultErrorHandler) {}

  register(plugin: LogViewerPlugin): void {
    if (!plugin || typeof plugin.name !== 'string' || !plugin.name) {
      throw new Error('Plugin must have a non-empty string "name"');
    }
    if (typeof plugin.onLog !== 'function') {
      throw new Error(`Plugin "${plugin.name}" must implement onLog(entry)`);
    }
    this.plugins.set(plugin.name, plugin);
  }

  unregister(name: string): boolean {
    return this.plugins.delete(name);
  }

  get(name: string): LogViewerPlugin | undefined {
    return this.plugins.get(name);
  }

  list(): LogViewerPlugin[] {
    return [...this.plugins.values()];
  }

  /** Dispatches `entry` to all enabled plugins whose minLevel allows it. Never throws. */
  dispatch(entry: LogEntry): void {
    for (const plugin of this.plugins.values()) {
      if (plugin.enabled === false) continue;
      if (plugin.minLevel && !levelAtLeast(entry.level, plugin.minLevel)) continue;
      try {
        const result = plugin.onLog(entry);
        if (result && typeof (result as Promise<void>).then === 'function') {
          const tracked: Promise<void> = (result as Promise<void>)
            .catch((err) => this.onError(plugin, err, entry))
            .finally(() => this.inFlight.delete(tracked));
          this.inFlight.add(tracked);
        }
      } catch (err) {
        this.onError(plugin, err, entry);
      }
    }
  }

  /** Waits for all in-flight async deliveries. */
  async flush(): Promise<void> {
    while (this.inFlight.size) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  async close(): Promise<void> {
    await this.flush();
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.close?.();
      } catch (err) {
        this.onError(plugin, err);
      }
    }
  }
}

function defaultErrorHandler(plugin: LogViewerPlugin, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`[node-log-viewer] plugin "${plugin.name}" failed: ${msg}`);
}
