import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteActivity, fetchActivity, fetchActivityPage } from './activity-client.ts';

const activity = {
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

test('fetches a validated activity page without browser caching', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await fetchActivityPage(2, 10, new AbortController().signal, async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return Response.json({ items: [activity], page: 2, pageSize: 10, total: 11, totalPages: 2 });
  });

  assert.equal(requestUrl, '/api/activities?page=2&pageSize=10');
  assert.equal(requestInit?.cache, 'no-store');
  assert.ok(requestInit?.signal);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.items[0]?.metrics.totalDistanceMeters, 0);
});

test('maps API failures and rejects malformed successful responses', async () => {
  const databaseFailure = await fetchActivityPage(1, 20, new AbortController().signal, async () =>
    Response.json({ statusCode: 503, code: 'DATABASE_UNAVAILABLE', message: 'do not expose' }, { status: 503 }),
  );
  assert.equal(databaseFailure.ok, false);
  if (!databaseFailure.ok) {
    assert.match(databaseFailure.message, /database.*unavailable/i);
    assert.doesNotMatch(databaseFailure.message, /expose/);
  }

  const malformed = await fetchActivity('857f4000-4264-4d12-8f52-2501d447ddf0', new AbortController().signal, async () =>
    Response.json({ activity: {} }),
  );
  assert.equal(malformed.ok, false);
});

test('rejects activity pages whose metadata does not match the requested page', async () => {
  const mismatchedPage = await fetchActivityPage(2, 20, new AbortController().signal, async () =>
    Response.json({ items: [activity], page: 1, pageSize: 20, total: 21, totalPages: 2 }),
  );
  assert.equal(mismatchedPage.ok, false);
  if (mismatchedPage.ok === false) {
    assert.match(mismatchedPage.message, /unexpected response/i);
    assert.doesNotMatch(mismatchedPage.message, /backend/i);
  }

  const oversizedOverview = await fetchActivityPage(1, 5, new AbortController().signal, async () =>
    Response.json({
      items: Array.from({ length: 6 }, () => activity),
      page: 1,
      pageSize: 20,
      total: 21,
      totalPages: 2,
    }),
  );
  assert.equal(oversizedOverview.ok, false);
  if (oversizedOverview.ok === false) {
    assert.match(oversizedOverview.message, /unexpected response/i);
    assert.doesNotMatch(oversizedOverview.message, /backend/i);
  }
});

test('deletes only a validated activity ID with an explicit same-origin request', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await deleteActivity(
    '857f4000-4264-4d12-8f52-2501d447ddf0',
    new AbortController().signal,
    async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(null, { status: 204 });
    },
  );

  assert.equal(requestUrl, '/api/activities/857f4000-4264-4d12-8f52-2501d447ddf0');
  assert.equal(requestInit?.method, 'DELETE');
  assert.equal(requestInit?.cache, 'no-store');
  assert.equal(result.ok, true);

  let called = false;
  const invalid = await deleteActivity('../import', new AbortController().signal, async () => {
    called = true;
    return new Response(null, { status: 204 });
  });
  assert.equal(invalid.ok, false);
  assert.equal(called, false);
});

test('does not treat already-missing or database-failed deletion responses as success', async () => {
  const missing = await deleteActivity(
    '857f4000-4264-4d12-8f52-2501d447ddf0',
    new AbortController().signal,
    async () => Response.json(
      { statusCode: 404, code: 'ACTIVITY_NOT_FOUND', message: 'not found' },
      { status: 404 },
    ),
  );
  assert.equal(missing.ok, false);
  if (missing.ok === false) {
    assert.equal(missing.status, 404);
    assert.match(missing.message, /could not be found/i);
  }

  const unavailable = await deleteActivity(
    '857f4000-4264-4d12-8f52-2501d447ddf0',
    new AbortController().signal,
    async () => Response.json(
      { statusCode: 503, code: 'DATABASE_UNAVAILABLE', message: 'sanitized' },
      { status: 503 },
    ),
  );
  assert.equal(unavailable.ok, false);
  if (unavailable.ok === false) {
    assert.equal(unavailable.status, 503);
    assert.match(unavailable.message, /database.*unavailable/i);
  }
});
