import { Module } from '@nestjs/common';
import { LogViewerModule, discordPlugin } from 'node-log-viewer/nest';
import { AppController } from './app.controller';

@Module({
  imports: [
    LogViewerModule.forRoot({
      dir: 'logs', // ./logs/YYYY-MM-DD.log, git-ignored automatically
      path: '/logs', // UI at http://localhost:3000/logs  (pass `false` to disable the UI)
      title: 'Nest example logs',
      plugins: [discordPlugin({ webhookUrl: process.env.DISCORD_WEBHOOK_URL })],
      catchExceptions: true, // global filter: unhandled 5xx exceptions are recorded
      // auth: { type: 'basic', username: 'admin', password: process.env.LOGS_PASSWORD! },
    }),
  ],
  controllers: [AppController],
})
export class AppModule {}
