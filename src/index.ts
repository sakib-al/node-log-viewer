export { Logger, createLogger } from './core/logger.js';
export { log, initLogger, getLogger, setLogger, isLoggerInitialized, resetLogger } from './core/global.js';
export type { GlobalLog } from './core/global.js';
export { FileStore } from './core/storage/file-store.js';
export { LogReader, parseLines } from './core/storage/reader.js';
export { SettingsStore } from './core/settings-store.js';
export { LOG_LEVELS, isLogLevel, levelAtLeast } from './core/types.js';
export type {
  DateFileInfo,
  LevelCounts,
  LogContext,
  LogEntry,
  LogLevel,
  LoggerOptions,
  ReadQuery,
  ReadResult,
  SerializedError,
} from './core/types.js';
export { serializeError } from './core/utils.js';

export { PluginRegistry } from './plugins/registry.js';
export type { LogViewerPlugin, PluginConfig, PluginSettingsField } from './plugins/plugin.js';
export { DiscordWebhookPlugin, discordPlugin, buildDiscordPayload, isDiscordWebhookUrl } from './plugins/discord.js';
export type { DiscordPluginOptions } from './plugins/discord.js';

export { createLogViewer } from './server/handler.js';
export type { LogViewerHandler, LogViewerOptions } from './server/handler.js';
export type { AuthOptions } from './server/auth.js';
export type { NodeHandler } from './server/http.js';

export { VERSION } from './version.js';
