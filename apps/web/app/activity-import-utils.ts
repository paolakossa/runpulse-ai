export const MAX_ACTIVITY_FILE_BYTES = 10 * 1024 * 1024;

export type ActivityImportErrorCode =
  | 'MISSING_FILE'
  | 'EMPTY_FILE'
  | 'INVALID_GPX'
  | 'UNSUPPORTED_FORMAT'
  | 'FILE_TOO_LARGE'
  | 'INVALID_MULTIPART'
  | 'UPLOAD_TIMEOUT'
  | 'IMPORT_SATURATED'
  | 'DUPLICATE_ACTIVITY'
  | 'INVALID_ACTIVITY_ID'
  | 'INVALID_PAGINATION'
  | 'ACTIVITY_NOT_FOUND'
  | 'API_TIMEOUT'
  | 'API_UNAVAILABLE'
  | 'DATABASE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

type NullableNumber = number | null;

export interface ActivityImportResponse {
  activity: {
    id: string;
    importedAt: string;
    startTime: string | null;
    endTime: string | null;
    segmentCount: number;
    trackPointCount: number;
  };
  metrics: {
    totalDistanceMeters: NullableNumber;
    elapsedSeconds: NullableNumber;
    recordedDurationSeconds: NullableNumber;
    averageElapsedPaceSecondsPerKm: NullableNumber;
    totalElevationGainMeters: NullableNumber;
    totalElevationLossMeters: NullableNumber;
    averageHeartRateBpm: NullableNumber;
    maxHeartRateBpm: NullableNumber;
    hasOverlappingSegments: boolean;
  };
  coverage: {
    distance: NullableNumber;
    elevation: NullableNumber;
    heartRate: NullableNumber;
  };
}

export interface ActivityPageResponse {
  items: ActivityImportResponse[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface ActivityImportErrorResponse {
  statusCode: number;
  code: ActivityImportErrorCode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableNumber(value: unknown): value is NullableNumber {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isCoverage(value: unknown): value is NullableNumber {
  return isNullableNumber(value) && (value === null || (value >= 0 && value <= 1));
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

export function isActivityId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isActivitySummary(value: unknown): value is ActivityImportResponse['activity'] {
  return isRecord(value) &&
    isActivityId(value.id) &&
    typeof value.importedAt === 'string' &&
    Number.isFinite(Date.parse(value.importedAt)) &&
    isNullableTimestamp(value.startTime) &&
    isNullableTimestamp(value.endTime) &&
    typeof value.segmentCount === 'number' &&
    Number.isSafeInteger(value.segmentCount) &&
    value.segmentCount >= 0 &&
    typeof value.trackPointCount === 'number' &&
    Number.isSafeInteger(value.trackPointCount) &&
    value.trackPointCount >= 0;
}

function isActivityMetrics(value: unknown): value is ActivityImportResponse['metrics'] {
  if (!isRecord(value)) return false;
  const metricFields = [
    'totalDistanceMeters',
    'elapsedSeconds',
    'recordedDurationSeconds',
    'averageElapsedPaceSecondsPerKm',
    'totalElevationGainMeters',
    'totalElevationLossMeters',
    'averageHeartRateBpm',
    'maxHeartRateBpm',
  ] as const;
  return metricFields.every(field => isNullableNumber(value[field])) &&
    typeof value.hasOverlappingSegments === 'boolean';
}

function isActivityCoverage(value: unknown): value is ActivityImportResponse['coverage'] {
  return isRecord(value) &&
    isCoverage(value.distance) &&
    isCoverage(value.elevation) &&
    isCoverage(value.heartRate);
}

const errorMessages: Record<ActivityImportErrorCode, string> = {
  MISSING_FILE: 'Choose a GPX file to import.',
  EMPTY_FILE: 'That file is empty. Choose another GPX file.',
  INVALID_GPX: 'The file is not a valid GPX activity. Check it and try another GPX file.',
  UNSUPPORTED_FORMAT: 'Only GPX files are supported. Choose a file ending in .gpx.',
  FILE_TOO_LARGE: 'The file exceeds the 10 MiB limit. Choose a smaller GPX file.',
  INVALID_MULTIPART: 'The upload request was invalid. Choose the GPX file again and retry.',
  UPLOAD_TIMEOUT: 'The upload timed out. Check the local API and try again.',
  IMPORT_SATURATED: 'Another import is in progress. Wait a moment, then retry.',
  DUPLICATE_ACTIVITY: 'This activity has already been imported. View your activity history or choose a different GPX file.',
  INVALID_ACTIVITY_ID: 'The activity identifier is invalid. Return to activity history and choose an activity.',
  INVALID_PAGINATION: 'The requested activity page is invalid. Return to the first page and retry.',
  ACTIVITY_NOT_FOUND: 'This activity could not be found. It may have already been deleted.',
  API_TIMEOUT: 'The local Activity API did not respond in time. Retry the request.',
  API_UNAVAILABLE: 'Could not connect to the local Activity API. Confirm it is running, then retry.',
  DATABASE_UNAVAILABLE: 'The local activity database is unavailable. Confirm it is running, then retry.',
  INTERNAL_ERROR: 'The request failed unexpectedly. Please try again later.',
};

function isActivityImportErrorCode(value: string): value is ActivityImportErrorCode {
  return Object.hasOwn(errorMessages, value);
}

export function parseActivityImportResponse(value: unknown): ActivityImportResponse | null {
  if (!isRecord(value) ||
      !isActivitySummary(value.activity) ||
      !isActivityMetrics(value.metrics) ||
      !isActivityCoverage(value.coverage)) {
    return null;
  }

  return { activity: value.activity, metrics: value.metrics, coverage: value.coverage };
}

export function parseActivityPageResponse(value: unknown): ActivityPageResponse | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;

  const { page, pageSize, total, totalPages } = value;
  if (typeof page !== 'number' ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      typeof pageSize !== 'number' ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      typeof total !== 'number' ||
      !Number.isSafeInteger(total) ||
      total < 0 ||
      typeof totalPages !== 'number' ||
      !Number.isSafeInteger(totalPages) ||
      totalPages < 0) {
    return null;
  }

  const items: ActivityImportResponse[] = [];
  for (const item of value.items) {
    const parsed = parseActivityImportResponse(item);
    if (parsed === null) return null;
    items.push(parsed);
  }

  if (items.length > pageSize ||
      items.length > total ||
      totalPages !== Math.ceil(total / pageSize)) {
    return null;
  }

  return {
    items,
    page,
    pageSize,
    total,
    totalPages,
  };
}

function parseErrorResponse(value: unknown): ActivityImportErrorResponse | null {
  if (!isRecord(value) ||
      typeof value.statusCode !== 'number' ||
      !Number.isSafeInteger(value.statusCode) ||
      typeof value.code !== 'string' ||
      !isActivityImportErrorCode(value.code)) {
    return null;
  }

  return { statusCode: value.statusCode, code: value.code };
}

export function getImportErrorMessage(statusCode: number, value: unknown): string {
  const error = parseErrorResponse(value);
  if (error?.statusCode === statusCode) return errorMessages[error.code];

  if (statusCode === 400) return 'The upload was invalid. Choose a valid GPX activity and retry.';
  if (statusCode === 408) return errorMessages.UPLOAD_TIMEOUT;
  if (statusCode === 413) return errorMessages.FILE_TOO_LARGE;
  if (statusCode === 415) return errorMessages.UNSUPPORTED_FORMAT;
  if (statusCode === 429) return errorMessages.IMPORT_SATURATED;
  if (statusCode === 409) return errorMessages.DUPLICATE_ACTIVITY;
  if (statusCode === 503) return errorMessages.DATABASE_UNAVAILABLE;
  if (statusCode === 502) return 'Could not connect to the local Activity API. Confirm it is running, then retry.';
  if (statusCode >= 500) return 'The local API returned an unexpected server error. Please try again later.';
  return 'The local API returned an unexpected response. Check that it is running and retry.';
}

export function getActivityApiErrorMessage(statusCode: number, value: unknown): string {
  const error = parseErrorResponse(value);
  if (error?.statusCode === statusCode) return errorMessages[error.code];
  if (statusCode === 404) return errorMessages.ACTIVITY_NOT_FOUND;
  if (statusCode === 503) return errorMessages.DATABASE_UNAVAILABLE;
  if (statusCode === 502) return errorMessages.API_UNAVAILABLE;
  if (statusCode >= 500) return errorMessages.INTERNAL_ERROR;
  if (statusCode === 400) return 'The activity request was invalid. Check the activity URL and retry.';
  return 'The local API returned an unexpected response. Check that it is running and retry.';
}

export function isDuplicateActivityError(value: unknown): boolean {
  const error = parseErrorResponse(value);
  return error?.statusCode === 409 && error.code === 'DUPLICATE_ACTIVITY';
}

export function formatLocalTimestamp(value: string | null): string {
  if (value === null || !Number.isFinite(Date.parse(value))) return 'N/A';
  return `${new Date(value).toLocaleString()} (local time)`;
}

export function formatDistance(value: NullableNumber): string {
  return value === null || !Number.isFinite(value) || value < 0 ? 'N/A' : `${(value / 1000).toFixed(2)} km`;
}

export function formatDuration(value: NullableNumber): string {
  if (value === null || !Number.isFinite(value) || value < 0) return 'N/A';
  const totalSeconds = Math.round(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
  return `${minutes}:${paddedSeconds}`;
}

export function formatPace(value: NullableNumber): string {
  if (value === null || !Number.isFinite(value) || value < 0) return 'N/A';
  const totalSeconds = Math.round(value);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')} /km`;
}

export function formatElevation(value: NullableNumber): string {
  return value === null || !Number.isFinite(value) ? 'N/A' : `${value.toFixed(1)} m`;
}

export function formatHeartRate(value: NullableNumber): string {
  return value === null || !Number.isFinite(value) ? 'N/A' : `${Math.round(value)} bpm`;
}

export function formatCoverage(value: NullableNumber): string {
  if (value === null || !Number.isFinite(value) || value < 0 || value > 1) return 'N/A';
  const percent = value * 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}
