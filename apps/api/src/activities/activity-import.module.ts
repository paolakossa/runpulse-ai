import { DynamicModule, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ActivityImportController, ActivityImportExceptionFilter } from './activity-import.controller.ts';
import {
  ActivityImportAdmissionMiddleware,
  ActivityImportLifecycleInterceptor,
  DEFAULT_UPLOAD_RECEIVE_TIMEOUT_MS,
  MAX_UPLOAD_RECEIVE_TIMEOUT_MS,
  UPLOAD_RECEIVE_TIMEOUT,
} from './activity-import.middleware.ts';
import { ActivityImportService } from './activity-import.service.ts';

@Module({
  controllers: [ActivityImportController],
  providers: [
    ActivityImportService,
    ActivityImportAdmissionMiddleware,
    ActivityImportLifecycleInterceptor,
    ActivityImportExceptionFilter,
  ],
})
export class ActivityImportModule implements NestModule {
  static register(receiveTimeoutMs = DEFAULT_UPLOAD_RECEIVE_TIMEOUT_MS): DynamicModule {
    if (!Number.isSafeInteger(receiveTimeoutMs) || receiveTimeoutMs < 1 || receiveTimeoutMs > MAX_UPLOAD_RECEIVE_TIMEOUT_MS) {
      throw new RangeError('The upload receive timeout must be a positive, bounded integer.');
    }
    return {
      module: ActivityImportModule,
      providers: [{ provide: UPLOAD_RECEIVE_TIMEOUT, useValue: receiveTimeoutMs }],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(ActivityImportAdmissionMiddleware)
      .forRoutes({ path: 'activities/import', method: RequestMethod.POST });
  }
}
