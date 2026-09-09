/**
 * NestJS integration for node-log-viewer.
 *
 * @example
 *   // app.module.ts
 *   import { LogViewerModule } from 'node-log-viewer/nest';
 *   @Module({ imports: [LogViewerModule.forRoot({ dir: 'logs', path: '/logs' })] })
 *   export class AppModule {}
 *
 *   // main.ts
 *   import { LogViewerLogger } from 'node-log-viewer/nest';
 *   const app = await NestFactory.create(AppModule, { bufferLogs: true });
 *   app.useLogger(app.get(LogViewerLogger));
 */
import {
  Catch,
  HttpException,
  Inject,
  Injectable,
  Module,
  Optional,
  type ArgumentsHost,
  type DynamicModule,
  type HttpServer,
  type LoggerService,
  type OnModuleInit,
} from '@nestjs/common';
import { APP_FILTER, BaseExceptionFilter, HttpAdapterHost, type AbstractHttpAdapter } from '@nestjs/core';
import { setLogger } from './core/global.js';
import { Logger, createLogger } from './core/logger.js';
import type { LogContext, LogLevel, LoggerOptions } from './core/types.js';
import { isError } from './core/utils.js';
import type { AuthOptions } from './server/auth.js';
import { createLogViewer } from './server/handler.js';

export { Logger, createLogger, discordPlugin, DiscordWebhookPlugin, createLogViewer, log, getLogger, initLogger, setLogger } from './index.js';
export type * from './index.js';

export const LOG_VIEWER_OPTIONS = 'NODE_LOG_VIEWER_OPTIONS';

export interface LogViewerModuleOptions extends LoggerOptions {
  /** Reuse an existing logger instead of creating one from the options. */
  logger?: Logger;
  /**
   * Where to mount the web UI. Default `/logs`. Pass `false` to disable the UI.
   * The path is absolute and intentionally not affected by `setGlobalPrefix()`.
   */
  path?: string | false;
  auth?: AuthOptions;
  title?: string;
  allowDelete?: boolean;
  allowPluginConfig?: boolean;
  /** Register a global exception filter that records unhandled exceptions. Default `true`. */
  catchExceptions?: boolean;
  /** Also record 4xx HttpExceptions (as `warn`). Default `false`. */
  logClientErrors?: boolean;
}

type NestParams = unknown[];

/**
 * Nest `LoggerService` implementation backed by node-log-viewer.
 * Use with `app.useLogger(app.get(LogViewerLogger))`, or inject it into your own providers.
 */
@Injectable()
export class LogViewerLogger implements LoggerService {
  constructor(@Inject(Logger) readonly logger: Logger) {}

  log(message: unknown, ...params: NestParams): void {
    this.write('info', message, params);
  }

  error(message: unknown, ...params: NestParams): void {
    this.write('error', message, params);
  }

  warn(message: unknown, ...params: NestParams): void {
    this.write('warn', message, params);
  }

  debug(message: unknown, ...params: NestParams): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: NestParams): void {
    this.write('debug', message, params);
  }

  fatal(message: unknown, ...params: NestParams): void {
    this.write('error', message, params);
  }

  /** Nest calls `logger.error(message, stack, context)` / `logger.log(message, context)`. */
  private write(level: LogLevel, message: unknown, params: NestParams): void {
    const rest = params.filter((p) => p !== undefined && p !== null);
    let source: string | undefined;
    let stack: string | undefined;

    if (rest.length && typeof rest[rest.length - 1] === 'string' && !looksLikeStack(rest[rest.length - 1] as string)) {
      source = rest.pop() as string;
    }
    if (level === 'error' && rest.length && typeof rest[rest.length - 1] === 'string' && looksLikeStack(rest[rest.length - 1] as string)) {
      stack = rest.pop() as string;
    }

    const target = source ? this.logger.child({ source }) : this.logger;
    const context: LogContext = {};
    if (rest.length === 1 && rest[0] && typeof rest[0] === 'object' && !isError(rest[0])) {
      Object.assign(context, rest[0] as LogContext);
    } else if (rest.length) {
      context.params = rest;
    }

    if (isError(message)) {
      // Nest often passes (error, error.stack); the stack is already on the error object.
      if (stack && stack === message.stack) stack = undefined;
      if (stack) context.stack = stack;
      target.exception(message, Object.keys(context).length ? context : undefined);
      return;
    }
    if (message && typeof message === 'object') {
      target.log(level, JSON.stringify(message), Object.keys(context).length ? context : undefined);
      return;
    }
    const text = String(message);
    if (stack) {
      target.log(level, text, { ...context, error: syntheticError(text, stack) });
      return;
    }
    target.log(level, text, Object.keys(context).length ? context : undefined);
  }
}

function looksLikeStack(value: string): boolean {
  return /\n\s+at\s/.test(value) || /^\w*Error:/.test(value);
}

function syntheticError(message: string, stack: string): Error {
  const firstLine = stack.split('\n')[0] ?? '';
  const nameMatch = firstLine.match(/^(\w+Error|Error)\b/);
  const err = new Error(message);
  err.name = nameMatch ? nameMatch[1] : 'Error';
  err.stack = stack;
  return err;
}

/**
 * Global exception filter that records unhandled exceptions to the log files
 * (and therefore to any plugins such as Discord), then delegates to Nest's default handling.
 */
@Catch()
@Injectable()
export class LogViewerExceptionFilter extends BaseExceptionFilter {
  constructor(
    @Inject(Logger) private readonly viewerLogger: Logger,
    @Optional() @Inject(LOG_VIEWER_OPTIONS) private readonly options: LogViewerModuleOptions = {},
  ) {
    super();
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    try {
      this.record(exception, host);
    } catch {
      // never let logging break the response
    }

    const applicationRef = this.applicationRef ?? this.httpAdapterHost?.httpAdapter;
    if (!applicationRef) {
      // Happens when two copies of @nestjs/core are loaded (typically a `file:` / `npm link`
      // install whose own node_modules contains Nest): the HttpAdapterHost token of this copy
      // never gets injected. Reply directly on the platform response instead of crashing.
      warnDuplicateNest();
      replyWithoutAdapter(exception, host);
      return;
    }
    if (isHttpExceptionLike(exception) && !(exception instanceof HttpException)) {
      // HttpException created by another copy of @nestjs/common: `instanceof` fails, so Nest's
      // BaseExceptionFilter would treat it as an unknown 500. Answer it like a normal HttpException.
      const response = host.getArgByIndex(1);
      if (!applicationRef.isHeadersSent(response)) {
        applicationRef.reply(response, httpExceptionBody(exception), exception.getStatus());
      } else {
        applicationRef.end(response);
      }
      return;
    }
    super.catch(exception, host);
  }

  /**
   * Same response behaviour as Nest's default, minus the extra `Logger.error(...)` line:
   * the exception was already recorded by `record()` with request context, so logging it
   * again through `app.useLogger(LogViewerLogger)` would create a duplicate entry.
   */
  override handleUnknownError(exception: unknown, host: ArgumentsHost, applicationRef: AbstractHttpAdapter | HttpServer): void {
    const body = this.isHttpError(exception)
      ? { statusCode: exception.statusCode, message: exception.message }
      : { statusCode: 500, message: 'Internal server error' };
    const response = host.getArgByIndex(1);
    if (!applicationRef.isHeadersSent(response)) {
      applicationRef.reply(response, body, body.statusCode);
    } else {
      applicationRef.end(response);
    }
  }

  private record(exception: unknown, host: ArgumentsHost): void {
    const status = isHttpExceptionLike(exception) ? exception.getStatus() : 500;
    const isServerError = status >= 500;
    if (!isServerError && !this.options.logClientErrors) return;

    const context: LogContext = { status };
    if (host.getType() === 'http') {
      const req = host.switchToHttp().getRequest<{ method?: string; url?: string; originalUrl?: string }>();
      if (req) {
        context.method = req.method;
        context.url = req.originalUrl ?? req.url;
      }
    }
    if (isHttpExceptionLike(exception)) {
      context.response = exception.getResponse();
    }
    const target = this.viewerLogger.child({ source: 'ExceptionFilter' });
    if (isServerError) {
      target.exception(exception, context);
    } else {
      const message = exception instanceof Error ? exception.message : String(exception);
      target.warn(message, context);
    }
  }
}

interface HttpExceptionLike {
  getStatus(): number;
  getResponse(): string | object;
  message: string;
}

/** Duck-typed HttpException check that also matches instances from a different @nestjs/common copy. */
function isHttpExceptionLike(value: unknown): value is HttpExceptionLike {
  if (value instanceof HttpException) return true;
  const v = value as Partial<HttpExceptionLike> | null;
  return typeof v === 'object' && v !== null && typeof v.getStatus === 'function' && typeof v.getResponse === 'function';
}

function httpExceptionBody(exception: HttpExceptionLike): object {
  const res = exception.getResponse();
  return typeof res === 'string' ? { statusCode: exception.getStatus(), message: res } : res;
}

/**
 * Last-resort reply used when no HttpAdapter is available. Supports Express (`status().json()`),
 * Fastify (`code().send()`) and raw Node responses.
 */
function replyWithoutAdapter(exception: unknown, host: ArgumentsHost): void {
  if (host.getType() !== 'http') return;
  const res = host.switchToHttp().getResponse<Record<string, unknown>>();
  if (!res || typeof res !== 'object') return;

  let status = 500;
  let body: object = { statusCode: 500, message: 'Internal server error' };
  if (isHttpExceptionLike(exception)) {
    status = exception.getStatus();
    body = httpExceptionBody(exception);
  } else if (typeof (exception as { statusCode?: unknown })?.statusCode === 'number') {
    status = (exception as { statusCode: number }).statusCode;
    body = { statusCode: status, message: (exception as Error).message };
  }

  const headersSent = Boolean(res.headersSent ?? res.sent);
  if (headersSent) {
    if (typeof res.end === 'function') (res.end as () => void)();
    return;
  }
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    (res.status as (c: number) => { json(b: object): void })(status).json(body); // Express
  } else if (typeof res.code === 'function' && typeof res.send === 'function') {
    (res.code as (c: number) => { send(b: object): void })(status).send(body); // Fastify
  } else if (typeof res.writeHead === 'function' && typeof res.end === 'function') {
    (res.writeHead as (c: number, h: Record<string, string>) => void)(status, { 'content-type': 'application/json' });
    (res.end as (b: string) => void)(JSON.stringify(body));
  }
}

/**
 * Only relevant for local development of this package. A registry install never triggers this:
 * the tarball has no nested node_modules, so @nestjs/* always resolves to the host app's copy.
 *
 * With a `file:` symlink or `npm link`, Node follows the link into this repo and loads the dev
 * copy of @nestjs/core from here. Two Nest copies means class-based DI tokens (HttpAdapterHost)
 * and `instanceof HttpException` no longer match. Fix: install as a copy instead of a link, e.g.
 * `npm install ../node-logger-system --install-links` or `npm pack` + install the .tgz.
 */
let duplicateNestWarned = false;
function warnDuplicateNest(): void {
  if (duplicateNestWarned) return;
  duplicateNestWarned = true;
  console.warn(
    '[node-log-viewer] Nest did not inject HttpAdapterHost into the log viewer. This usually means two copies of ' +
      '@nestjs/core are loaded, e.g. node-log-viewer was installed with a `file:` symlink or `npm link` and is using its own ' +
      'node_modules. Install it as a copy (`npm install <path> --install-links`, or `npm pack` and install the .tgz) or from ' +
      "the registry so it shares your app's @nestjs/* packages.",
  );
}

@Module({})
export class LogViewerModule implements OnModuleInit {
  static forRoot(options: LogViewerModuleOptions = {}): DynamicModule {
    const { logger: existing, path: _p, auth: _a, title: _t, allowDelete: _d, allowPluginConfig: _c, catchExceptions, logClientErrors: _l, ...loggerOptions } = options;
    const logger = existing ?? createLogger(loggerOptions);
    // Make it the process-wide default so `import { log } from 'node-log-viewer'` works anywhere.
    setLogger(logger);
    const providers: DynamicModule['providers'] = [
      { provide: LOG_VIEWER_OPTIONS, useValue: options },
      { provide: Logger, useValue: logger },
      LogViewerLogger,
    ];
    if (catchExceptions !== false) {
      providers.push({ provide: APP_FILTER, useClass: LogViewerExceptionFilter });
    }
    return {
      module: LogViewerModule,
      global: true,
      providers,
      exports: [Logger, LogViewerLogger, LOG_VIEWER_OPTIONS],
    };
  }

  constructor(
    @Inject(LOG_VIEWER_OPTIONS) private readonly options: LogViewerModuleOptions,
    @Inject(Logger) private readonly logger: Logger,
    @Optional() @Inject(HttpAdapterHost) private readonly adapterHost?: HttpAdapterHost,
  ) {}

  /**
   * Mounts the viewer with `httpAdapter.use(path, handler)` so the whole sub-tree
   * (`/logs`, `/logs/api/...`, `/logs/assets/...`) is served. Nest's `MiddlewareConsumer`
   * registers `RequestMethod.ALL` middleware with an exact-match `app.all(path)`, which
   * would only serve the root of the viewer.
   */
  onModuleInit(): void {
    if (this.options.path === false) return;
    const adapter = this.adapterHost?.httpAdapter;
    if (!adapter || typeof adapter.use !== 'function') {
      console.warn('[node-log-viewer] HttpAdapterHost is not available; the log viewer UI was not mounted.');
      warnDuplicateNest();
      return;
    }
    const mount = normalizeMount(this.options.path ?? '/logs');
    const handler = createLogViewer({
      logger: this.logger,
      basePath: mount,
      auth: this.options.auth,
      title: this.options.title,
      allowDelete: this.options.allowDelete,
      allowPluginConfig: this.options.allowPluginConfig,
    });
    if (mount === '/') {
      adapter.use(handler);
    } else {
      adapter.use(mount, handler);
    }
  }
}

function normalizeMount(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '/';
}
