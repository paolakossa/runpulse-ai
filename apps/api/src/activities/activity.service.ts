import { Injectable } from '@nestjs/common';
import { ActivityImportApiError } from './activity-import-errors.ts';
import { ActivityPersistenceService } from './activity-persistence.service.ts';
import type { ActivityPage } from './activity-persistence.service.ts';
import type { PersistedActivitySummary } from './activity-import.service.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateActivityId(id: string): string {
  if (!UUID_PATTERN.test(id)) throw new ActivityImportApiError('INVALID_ACTIVITY_ID');
  return id;
}

@Injectable()
export class ActivityService {
  constructor(private readonly persistence: ActivityPersistenceService) {}

  list(page: number, pageSize: number): Promise<ActivityPage> {
    return this.persistence.list(page, pageSize);
  }

  async get(id: string): Promise<PersistedActivitySummary> {
    const activity = await this.persistence.findById(validateActivityId(id));
    if (!activity) throw new ActivityImportApiError('ACTIVITY_NOT_FOUND');
    return activity;
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.persistence.deleteById(validateActivityId(id));
    if (!deleted) throw new ActivityImportApiError('ACTIVITY_NOT_FOUND');
  }
}
