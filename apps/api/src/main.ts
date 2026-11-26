import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
@Controller('health')
class HealthController {
  @Get() check() { return { status: 'ok' }; }
}
@Module({ controllers: [HealthController] })
class AppModule {}
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3001, '127.0.0.1');
}
void bootstrap();
