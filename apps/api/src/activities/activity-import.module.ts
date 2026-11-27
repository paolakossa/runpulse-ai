import { DynamicModule, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ActivityImportController, ActivityImportExceptionFilter } from './activity-import.controller.ts';
import { ActivityService } from './activity.service.ts';
import { ActivityPersistenceService } from './activity-persistence.service.ts';
import {
  ActivityImportAdmissionMiddleware,
  ActivityImportLifecycleInterceptor,
  DEFAULT_UPLOAD_RECEIVE_TIMEOUT_MS,
  MAX_UPLOAD_RECEIVE_TIMEOUT_MS,
  UPLOAD_RECEIVE_TIMEOUT,
} from './activity-import.middleware.ts';
import { ACTIVITY_FINGERPRINT_SECRET, parseActivityFingerprintSecret } from './activity-fingerprint.ts';
import { ActivityImportService } from './activity-import.service.ts';
import { PrismaModule } from '../prisma/prisma.module.ts';

@Module({
  imports: [PrismaModule],
  controllers: [ActivityImportController],
  providers: [
    ActivityService,
    ActivityPersistenceService,
    ActivityImportService,
    {
      provide: ACTIVITY_FINGERPRINT_SECRET,
      useFactory: () => parseActivityFingerprintSecret(process.env.ACTIVITY_FINGERPRINT_SECRET),
    },
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
