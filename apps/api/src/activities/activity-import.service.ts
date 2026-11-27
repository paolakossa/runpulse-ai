import { Inject, Injectable } from '@nestjs/common';
import { ActivityImportApiError } from './activity-import-errors.ts';
import type { ActivityMetrics } from '../activity-metrics.ts';
import { calculateActivityMetrics } from '../activity-metrics.ts';
import { ActivityImportError, parseGpx } from '../gpx-parser.ts';
import { ActivityPersistenceService } from './activity-persistence.service.ts';
import { ACTIVITY_FINGERPRINT_SECRET, activityFingerprint } from './activity-fingerprint.ts';

export interface ActivityImportSummary {
  activity: {
    startTime: string | null;
    endTime: string | null;
    segmentCount: number;
    trackPointCount: number;
  };
  metrics: Pick<
    ActivityMetrics,
    | 'totalDistanceMeters'
    | 'elapsedSeconds'
    | 'recordedDurationSeconds'
    | 'averageElapsedPaceSecondsPerKm'
    | 'totalElevationGainMeters'
    | 'totalElevationLossMeters'
    | 'averageHeartRateBpm'
    | 'maxHeartRateBpm'
    | 'hasOverlappingSegments'
  >;
  coverage: {
    distance: number | null;
    elevation: number | null;
    heartRate: number | null;
  };
}

export interface PersistedActivitySummary extends ActivityImportSummary {
  activity: ActivityImportSummary['activity'] & {
    id: string;
    importedAt: string;
  };
}

function hasFitSignature(input: Uint8Array): boolean {
  return input.byteLength >= 12 &&
    (input[0] === 12 || input[0] === 14) &&
    input[8] === 0x2e && input[9] === 0x46 && input[10] === 0x49 && input[11] === 0x54;
}

function assertFiniteMetrics(metrics: ActivityMetrics): void {
  for (const value of Object.values(metrics)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new RangeError('Activity metrics must be finite.');
    }
  }
  for (const value of [metrics.distanceCoverage, metrics.elevationCoverage, metrics.heartRateCoverage]) {
    if (value !== null && (value < 0 || value > 1)) {
      throw new RangeError('Activity coverage must be between zero and one.');
    }
  }
}

@Injectable()
export class ActivityImportService {
  constructor(
    @Inject(ACTIVITY_FINGERPRINT_SECRET) private readonly fingerprintSecret: Buffer,
    private readonly activityPersistenceService: ActivityPersistenceService,
  ) {}

  async importActivity(input: Uint8Array): Promise<PersistedActivitySummary> {
    if (input.byteLength === 0) throw new ActivityImportApiError('EMPTY_FILE');
    if (hasFitSignature(input)) throw new ActivityImportApiError('UNSUPPORTED_FORMAT');

    let activity;
    try {
      activity = parseGpx(input);
    } catch (error) {
      if (error instanceof ActivityImportError && error.code === 'UNSUPPORTED_FORMAT') {
        throw new ActivityImportApiError('UNSUPPORTED_FORMAT');
      }
      if (error instanceof ActivityImportError) throw new ActivityImportApiError('INVALID_GPX');
      throw error;
    }

    const metrics = calculateActivityMetrics(activity);
    assertFiniteMetrics(metrics);

    let startTime = Infinity;
    let endTime = -Infinity;
    for (const segment of activity.segments) {
      for (const sample of segment.samples) {
        const time = Date.parse(sample.timestamp);
        startTime = Math.min(startTime, time);
        endTime = Math.max(endTime, time);
      }
    }

    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      throw new RangeError('A parsed activity must contain timestamped samples.');
    }

    const summary: ActivityImportSummary = {
      activity: {
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        segmentCount: activity.segments.length,
        trackPointCount: metrics.trackPointCount,
      },
      metrics: {
        totalDistanceMeters: metrics.totalDistanceMeters,
        elapsedSeconds: metrics.elapsedSeconds,
        recordedDurationSeconds: metrics.recordedDurationSeconds,
        averageElapsedPaceSecondsPerKm: metrics.averageElapsedPaceSecondsPerKm,
        totalElevationGainMeters: metrics.totalElevationGainMeters,
        totalElevationLossMeters: metrics.totalElevationLossMeters,
        averageHeartRateBpm: metrics.averageHeartRateBpm,
        maxHeartRateBpm: metrics.maxHeartRateBpm,
        hasOverlappingSegments: metrics.hasOverlappingSegments,
      },
      coverage: {
        distance: metrics.distanceCoverage,
        elevation: metrics.elevationCoverage,
        heartRate: metrics.heartRateCoverage,
      },
    };
    return this.activityPersistenceService.create(summary, activityFingerprint(activity, this.fingerprintSecret));
  }
}
