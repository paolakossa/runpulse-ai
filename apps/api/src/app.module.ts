import { Controller, Get, Module, type DynamicModule } from '@nestjs/common';
import { ActivityImportModule } from './activities/activity-import.module.ts';
import { DEFAULT_UPLOAD_RECEIVE_TIMEOUT_MS } from './activities/activity-import.middleware.ts';

@Controller('health')
class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}

@Module({})
export class AppModule {
  static register(receiveTimeoutMs = DEFAULT_UPLOAD_RECEIVE_TIMEOUT_MS): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      imports: [ActivityImportModule.register(receiveTimeoutMs)],
    };
  }
}
