import { ActivityImportApiError } from './activity-import-errors.ts';

export const DEFAULT_ACTIVITY_PAGE_SIZE = 20;
export const MAX_ACTIVITY_PAGE_SIZE = 100;
export const MAX_ACTIVITY_PAGE = 10_000;

export interface ActivityPagination {
  page: number;
  pageSize: number;
}

function parsePositiveInteger(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new ActivityImportApiError('INVALID_PAGINATION');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new ActivityImportApiError('INVALID_PAGINATION');
  }
  return parsed;
}

export function parseActivityPagination(page: unknown, pageSize: unknown): ActivityPagination {
  return {
    page: parsePositiveInteger(page, 1, MAX_ACTIVITY_PAGE),
    pageSize: parsePositiveInteger(pageSize, DEFAULT_ACTIVITY_PAGE_SIZE, MAX_ACTIVITY_PAGE_SIZE),
  };
}
