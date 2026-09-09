import type { LogEntry, LogLevel } from '../core/types.js';

/** Describes one field of a plugin's settings form, rendered generically by the UI. */
export type PluginSettingsField =
  | {
      key: string;
      label: string;
      type: 'text' | 'password' | 'url' | 'number';
      description?: string;
      placeholder?: string;
      required?: boolean;
    }
  | {
      key: string;
      label: string;
      type: 'boolean';
      description?: string;
    }
  | {
      key: string;
      label: string;
      type: 'select';
      description?: string;
      options: Array<{ value: string; label: string }>;
    };

export type PluginConfig = Record<string, unknown>;

/**
 * A plugin is a "log sink": it receives every entry the logger records
 * (at or above `minLevel`) and can forward it anywhere.
 */
export interface LogViewerPlugin {
  /** Unique machine name, e.g. `discord`. Used as the settings key and in API routes. */
  readonly name: string;
  /** Human readable title for the UI. */
  readonly title?: string;
  readonly description?: string;
  /** Entries below this level are not delivered. Default: `debug` (everything). */
  minLevel?: LogLevel;
  /** When false the plugin is registered but receives nothing. Default: true. */
  enabled?: boolean;

  /** Called for each entry. May be async; errors are caught and never break logging. */
  onLog(entry: LogEntry): void | Promise<void>;

  /** Fields the UI should render on the Settings page. */
  settingsSchema?: PluginSettingsField[];
  /** Current config to prefill the UI form. Secret fields should still be returned; the UI masks `password` types. */
  getConfig?(): PluginConfig;
  /** Apply config coming from the UI (or from a persisted settings file). Should validate and throw on bad input. */
  configure?(config: PluginConfig): void | Promise<void>;
  /** Send a test message using the current config. Throw to report failure. */
  test?(): Promise<void>;
  /** Called when the logger shuts down; flush pending work. */
  close?(): void | Promise<void>;
}
