import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { LogViewerLogger } from 'node-log-viewer/nest';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // Route Nest's own logger (and any `new Logger()` in your code) through node-log-viewer.
  app.useLogger(app.get(LogViewerLogger));

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(`App:        http://localhost:${port}`);
  console.log(`Log viewer: http://localhost:${port}/logs`);
}

void bootstrap();
