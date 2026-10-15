import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { AppModule } from './app.module';
import { GosiBrain } from './brain/brain.types';
import { ErrorFilter } from './common/error.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '5mb' });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  const brain = app.get(GosiBrain);
  const ui = existsSync(resolve(process.env.FRONTEND_DIST ?? '../frontend/dist/frontend/browser'));
  const log = new Logger('Startup');
  log.log('------------------------------------------------------------');
  log.log(`API Documentation Engine is running`);
  log.log(ui ? `Open the app:  http://localhost:${port}` : `API only:      http://localhost:${port}/api  (frontend not built, use npm start in frontend)`);
  log.log(brain.mode === 'mock' ? 'AI:            OFFLINE (no API key). Run "npm run ai:check" to connect' : `AI:            connected (${brain.label})`);
  log.log(`Data file:     ${process.env.DB_FILE ?? './data/registry.sqlite'}`);
  log.log('------------------------------------------------------------');
}

bootstrap();
