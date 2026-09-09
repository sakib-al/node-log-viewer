import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { Logger } from 'node-log-viewer/nest';

@Controller()
export class AppController {
  // The node-log-viewer Logger is provided globally by LogViewerModule.
  private readonly log: Logger;

  constructor(@Inject(Logger) logger: Logger) {
    this.log = logger.child({ source: AppController.name });
  }

  @Get()
  home() {
    this.log.info('Home requested');
    return { hello: 'world', logs: '/logs', try: ['/users/1', '/users/404', '/boom'] };
  }

  @Get('users/:id')
  user(@Param('id') id: string) {
    if (id === '404') {
      // 4xx HttpExceptions are not recorded unless `logClientErrors: true`
      throw new NotFoundException(`User ${id} not found`);
    }
    this.log.debug('Loading user', { id });
    return { id, name: 'Jane' };
  }

  @Get('boom')
  boom() {
    // Unhandled -> caught by LogViewerExceptionFilter -> written to logs (+ Discord if configured)
    throw new Error('Unexpected failure while processing /boom');
  }

  @Get('caught')
  caught() {
    try {
      JSON.parse('{ nope');
    } catch (err) {
      this.log.exception(err, { route: '/caught' });
    }
    return { ok: true, note: 'error recorded' };
  }
}
