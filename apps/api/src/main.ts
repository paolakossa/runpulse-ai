import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';

async function bootstrap() {
  const app = await NestFactory.create(AppModule.register());
  app.enableShutdownHooks();
  await app.listen(3001, '127.0.0.1');
}
void bootstrap();
