import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { PluginConfig } from '../plugins/plugin.js';

export interface PersistedSettings {
  version: 1;
  plugins: Record<string, PluginConfig>;
}

const EMPTY: PersistedSettings = { version: 1, plugins: {} };

/**
 * Persists UI-editable settings (plugin configs) as JSON next to the log files.
 * Lives inside the log directory so it is covered by the same `.gitignore`.
 */
export class SettingsStore {
  readonly file: string;
  private cache: PersistedSettings | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(dir: string, fileName = '.log-viewer.json') {
    this.file = path.join(path.resolve(dir), fileName);
  }

  async load(): Promise<PersistedSettings> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      this.cache = {
        version: 1,
        plugins: parsed.plugins && typeof parsed.plugins === 'object' ? parsed.plugins : {},
      };
    } catch {
      this.cache = { ...EMPTY, plugins: {} };
    }
    return this.cache;
  }

  async getPluginConfig(name: string): Promise<PluginConfig | undefined> {
    const s = await this.load();
    return s.plugins[name];
  }

  async setPluginConfig(name: string, config: PluginConfig): Promise<void> {
    const s = await this.load();
    s.plugins[name] = config;
    await this.save();
  }

  private save(): Promise<void> {
    const snapshot = JSON.stringify(this.cache ?? EMPTY, null, 2);
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, this.file);
    });
    return this.writing;
  }
}
