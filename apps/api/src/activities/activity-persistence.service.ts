import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.ts';
import type { Activity as ActivityRow } from '../generated/prisma/client.ts';
import { PrismaService } from '../prisma/prisma.service.ts';
import { ActivityImportApiError } from './activity-import-errors.ts';
import { isFingerprintUniqueViolation } from './activity-database-errors.ts';
import type { ActivityImportSummary, PersistedActivitySummary } from './activity-import.service.ts';

export interface ActivityPage {
  items: PersistedActivitySummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function toSummary(row: ActivityRow): PersistedActivitySummary {
  return {
    activity: {
      id: row.id,
      importedAt: row.importedAt.toISOString(),
      startTime: row.startTime?.toISOString() ?? null,
      endTime: row.endTime?.toISOString() ?? null,
      segmentCount: row.segmentCount,
      trackPointCount: row.trackPointCount,
    },
    metrics: {
      totalDistanceMeters: row.totalDistanceMeters,
      elapsedSeconds: row.elapsedSeconds,
      recordedDurationSeconds: row.recordedDurationSeconds,
      averageElapsedPaceSecondsPerKm: row.averageElapsedPaceSecondsPerKm,
      totalElevationGainMeters: row.totalElevationGainMeters,
      totalElevationLossMeters: row.totalElevationLossMeters,
      averageHeartRateBpm: row.averageHeartRateBpm,
      maxHeartRateBpm: row.maxHeartRateBpm,
      hasOverlappingSegments: row.hasOverlappingSegments,
    },
    coverage: {
      distance: row.distanceCoverage,
      elevation: row.elevationCoverage,
      heartRate: row.heartRateCoverage,
    },
  };
}

@Injectable()
export class ActivityPersistenceService {
  constructor(private readonly prisma: PrismaService) {}

  async create(summary: ActivityImportSummary, fingerprint: string): Promise<PersistedActivitySummary> {
    try {
      const row = await this.prisma.activity.create({
        data: {
          fingerprint,
          startTime: summary.activity.startTime === null ? null : new Date(summary.activity.startTime),
          endTime: summary.activity.endTime === null ? null : new Date(summary.activity.endTime),
          segmentCount: summary.activity.segmentCount,
          trackPointCount: summary.activity.trackPointCount,
          totalDistanceMeters: summary.metrics.totalDistanceMeters,
          elapsedSeconds: summary.metrics.elapsedSeconds,
          recordedDurationSeconds: summary.metrics.recordedDurationSeconds,
          averageElapsedPaceSecondsPerKm: summary.metrics.averageElapsedPaceSecondsPerKm,
          totalElevationGainMeters: summary.metrics.totalElevationGainMeters,
          totalElevationLossMeters: summary.metrics.totalElevationLossMeters,
          averageHeartRateBpm: summary.metrics.averageHeartRateBpm,
          maxHeartRateBpm: summary.metrics.maxHeartRateBpm,
          hasOverlappingSegments: summary.metrics.hasOverlappingSegments,
          distanceCoverage: summary.coverage.distance,
          elevationCoverage: summary.coverage.elevation,
          heartRateCoverage: summary.coverage.heartRate,
        },
      });
      return toSummary(row);
    } catch (error) {
      if (isFingerprintUniqueViolation(error)) {
        throw new ActivityImportApiError('DUPLICATE_ACTIVITY');
      }
      throw error;
    }
  }

  async list(page: number, pageSize: number): Promise<ActivityPage> {
    const skip = (page - 1) * pageSize;
    return this.prisma.$transaction(async transaction => {
      const [rows, total] = await Promise.all([
        transaction.activity.findMany({
          skip,
          take: pageSize,
          orderBy: [{ importedAt: 'desc' }, { id: 'desc' }],
        }),
        transaction.activity.count(),
      ]);
      return {
        items: rows.map(toSummary),
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 2_000,
      timeout: 8_000,
    });
  }

  async findById(id: string): Promise<PersistedActivitySummary | null> {
    const row = await this.prisma.activity.findUnique({ where: { id } });
    return row === null ? null : toSummary(row);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.activity.deleteMany({ where: { id } });
    return result.count === 1;
  }
}
