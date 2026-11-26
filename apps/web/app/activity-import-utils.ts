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
  | 'INTERNAL_ERROR';

type NullableNumber = number | null;

export interface ActivityImportResponse {
  activity: {
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

function isActivitySummary(value: unknown): value is ActivityImportResponse['activity'] {
  return isRecord(value) &&
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

export function parseActivityImportResponse(value: unknown): ActivityImportResponse | null {
  if (!isRecord(value) ||
      !isActivitySummary(value.activity) ||
      !isActivityMetrics(value.metrics) ||
      !isActivityCoverage(value.coverage)) {
    return null;
  }

  return { activity: value.activity, metrics: value.metrics, coverage: value.coverage };
}

function parseErrorResponse(value: unknown): ActivityImportErrorResponse | null {
  if (!isRecord(value) || typeof value.statusCode !== 'number' || typeof value.code !== 'string') {
    return null;
  }

  const codes: readonly string[] = [
    'MISSING_FILE',
    'EMPTY_FILE',
    'INVALID_GPX',
    'UNSUPPORTED_FORMAT',
    'FILE_TOO_LARGE',
    'INVALID_MULTIPART',
    'UPLOAD_TIMEOUT',
    'IMPORT_SATURATED',
    'INTERNAL_ERROR',
  ];
  if (!codes.includes(value.code)) return null;
  return { statusCode: value.statusCode, code: value.code as ActivityImportErrorCode };
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
  INTERNAL_ERROR: 'The import failed unexpectedly. Please try again later.',
};

export function getImportErrorMessage(statusCode: number, value: unknown): string {
  const error = parseErrorResponse(value);
  if (error?.statusCode === statusCode) return errorMessages[error.code];

  if (statusCode === 400) return 'The upload was invalid. Choose a valid GPX activity and retry.';
  if (statusCode === 408) return errorMessages.UPLOAD_TIMEOUT;
  if (statusCode === 413) return errorMessages.FILE_TOO_LARGE;
  if (statusCode === 415) return errorMessages.UNSUPPORTED_FORMAT;
  if (statusCode === 429) return errorMessages.IMPORT_SATURATED;
  if (statusCode === 502) return 'Could not connect to the local Activity API. Confirm it is running, then retry.';
  if (statusCode >= 500) return 'The local API returned an unexpected server error. Please try again later.';
  return 'The local API returned an unexpected response. Check that it is running and retry.';
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
