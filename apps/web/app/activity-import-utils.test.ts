import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatCoverage,
  formatDistance,
  formatDuration,
  formatElevation,
  formatHeartRate,
  formatPace,
  formatLocalTimestamp,
  getActivityApiErrorMessage,
  getImportErrorMessage,
  isDuplicateActivityError,
  parseActivityPageResponse,
  parseActivityImportResponse,
} from './activity-import-utils.ts';

const response = {
  activity: {
    id: '857f4000-4264-4d12-8f52-2501d447ddf0',
    importedAt: '2026-01-02T03:04:05.000Z',
    startTime: '2026-01-01T00:00:00.000Z',
    endTime: '2026-01-01T00:00:00.000Z',
    segmentCount: 1,
    trackPointCount: 1,
  },
  metrics: {
    totalDistanceMeters: 0,
    elapsedSeconds: 0,
    recordedDurationSeconds: 0,
    averageElapsedPaceSecondsPerKm: null,
    totalElevationGainMeters: 0,
    totalElevationLossMeters: 0,
    averageHeartRateBpm: null,
    maxHeartRateBpm: 0,
    hasOverlappingSegments: false,
  },
  coverage: { distance: 0, elevation: 0, heartRate: null },
};

test('validates the API response without changing null or zero values', () => {
  const parsed = parseActivityImportResponse(response);
  assert.deepEqual(parsed, response);
});

test('rejects malformed or non-finite activity responses', () => {
  assert.equal(parseActivityImportResponse(null), null);
  assert.equal(parseActivityImportResponse({ ...response, metrics: { ...response.metrics, elapsedSeconds: Infinity } }), null);
  assert.equal(parseActivityImportResponse({ ...response, coverage: { ...response.coverage, distance: 1.01 } }), null);
  assert.equal(parseActivityImportResponse({
    ...response,
    activity: { ...response.activity, trackPointCount: -1 },
  }), null);
  assert.equal(parseActivityImportResponse({
    ...response,
    metrics: { ...response.metrics, hasOverlappingSegments: null },
  }), null);
});

test('preserves persistence identifiers and timestamps when returned by the API', () => {
  assert.deepEqual(parseActivityImportResponse(response), response);
  const { id: _id, ...withoutId } = response.activity;
  assert.equal(parseActivityImportResponse({
    ...response,
    activity: withoutId,
  }), null);
});

test('validates paginated persisted activities without collapsing null and zero', () => {
  const page = { items: [response], page: 1, pageSize: 20, total: 1, totalPages: 1 };
  assert.deepEqual(parseActivityPageResponse(page), page);
  assert.equal(parseActivityPageResponse({ ...page, total: -1 }), null);
  assert.equal(parseActivityPageResponse({ ...page, pageSize: 101 }), null);
  assert.equal(parseActivityPageResponse({ ...page, totalPages: 2 }), null);
  assert.equal(parseActivityPageResponse({
    ...page,
    items: Array.from({ length: 21 }, () => response),
    pageSize: 20,
    total: 21,
    totalPages: 2,
  }), null);
  assert.equal(parseActivityPageResponse({ ...page, items: [{ ...response, metrics: {} }] }), null);
});

test('formats null as N/A while preserving real zero measurements', () => {
  assert.equal(formatDistance(null), 'N/A');
  assert.equal(formatDistance(0), '0.00 km');
  assert.equal(formatDuration(null), 'N/A');
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatPace(null), 'N/A');
  assert.equal(formatPace(0), '0:00 /km');
  assert.equal(formatElevation(null), 'N/A');
  assert.equal(formatElevation(0), '0.0 m');
  assert.equal(formatHeartRate(null), 'N/A');
  assert.equal(formatHeartRate(0), '0 bpm');
  assert.equal(formatCoverage(null), 'N/A');
  assert.equal(formatCoverage(0), '0%');
});

test('rounds pace and duration before splitting units', () => {
  assert.equal(formatPace(59.6), '1:00 /km');
  assert.equal(formatPace(3599.6), '60:00 /km');
  assert.equal(formatDuration(59.6), '1:00');
  assert.equal(formatDuration(3599.6), '1:00:00');
  assert.equal(formatDuration(86400), '24:00:00');
});

test('maps stable API errors to actionable upload messages', () => {
  const cases = [
    [400, 'INVALID_GPX', /valid GPX/i],
    [400, 'MISSING_FILE', /choose.*file/i],
    [400, 'EMPTY_FILE', /empty/i],
    [400, 'INVALID_MULTIPART', /request was invalid/i],
    [413, 'FILE_TOO_LARGE', /10 MiB/i],
    [415, 'UNSUPPORTED_FORMAT', /\.gpx/i],
    [408, 'UPLOAD_TIMEOUT', /timed out/i],
    [429, 'IMPORT_SATURATED', /in progress/i],
    [503, 'DATABASE_UNAVAILABLE', /database.*unavailable/i],
    [500, 'INTERNAL_ERROR', /try again/i],
  ] as const;

  for (const [statusCode, code, message] of cases) {
    assert.match(getImportErrorMessage(statusCode, { statusCode, code, message: 'Backend details are not shown.' }), message);
  }
  assert.match(getImportErrorMessage(502, null), /local.*API/i);
});

test('gives an actionable message for a duplicate activity', () => {
  assert.equal(
    getImportErrorMessage(409, { statusCode: 409, code: 'DUPLICATE_ACTIVITY' }),
    'This activity has already been imported. View your activity history or choose a different GPX file.',
  );
  assert.equal(isDuplicateActivityError({ statusCode: 409, code: 'DUPLICATE_ACTIVITY' }), true);
  assert.equal(isDuplicateActivityError({ statusCode: 409, code: 'INTERNAL_ERROR' }), false);
});

test('maps activity history errors without exposing backend details', () => {
  assert.match(getActivityApiErrorMessage(404, { statusCode: 404, code: 'ACTIVITY_NOT_FOUND' }), /could not be found/i);
  assert.match(getActivityApiErrorMessage(400, { statusCode: 400, code: 'INVALID_ACTIVITY_ID' }), /invalid.*activity/i);
  assert.match(getActivityApiErrorMessage(503, { statusCode: 503, code: 'DATABASE_UNAVAILABLE', message: 'secret' }), /database.*unavailable/i);
  assert.doesNotMatch(getActivityApiErrorMessage(503, { statusCode: 503, code: 'DATABASE_UNAVAILABLE', message: 'secret' }), /secret/);
  assert.equal(formatLocalTimestamp(null), 'N/A');
  assert.match(formatLocalTimestamp('2026-01-01T00:00:00.000Z'), /local time/);
});
