import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as collectionRoute from './api/activities/route.ts';
import * as itemRoute from './api/activities/[id]/route.ts';
import { getActivityListTarget, getActivityRecordTarget } from './activity-api-proxy.ts';

async function readError(response: Response): Promise<{ code: string }> {
  assert.equal(response.status, 400);
  return response.json() as Promise<{ code: string }>;
}

test('activity routes expose only the allowlisted methods', () => {
  assert.equal(typeof collectionRoute.GET, 'function');
  assert.equal('POST' in collectionRoute, false);
  assert.equal(typeof itemRoute.GET, 'function');
  assert.equal(typeof itemRoute.DELETE, 'function');
  assert.equal('POST' in itemRoute, false);
});

test('rejects invalid pagination and unrecognized query parameters before forwarding', async () => {
  for (const url of [
    'http://runpulse.local/api/activities?page=0',
    'http://runpulse.local/api/activities?page=10001',
    'http://runpulse.local/api/activities?pageSize=101',
    'http://runpulse.local/api/activities?page=1&page=2',
    'http://runpulse.local/api/activities?destination=http://example.com',
  ]) {
    const body = await readError(await collectionRoute.GET(new Request(url)));
    assert.equal(body.code, 'INVALID_PAGINATION');
  }
});

test('rejects malformed activity IDs before forwarding', async () => {
  const context = { params: Promise.resolve({ id: '../import' }) };
  const body = await readError(await itemRoute.GET(new Request('http://runpulse.local'), context));
  assert.equal(body.code, 'INVALID_ACTIVITY_ID');
});

test('activity proxy destinations are fixed, loopback-only, and identifier-safe', () => {
  const listTarget = getActivityListTarget('http://runpulse.local/api/activities?page=2&pageSize=10', 'http://127.0.0.1:3010');
  assert.equal(listTarget.href, 'http://127.0.0.1:3010/activities?page=2&pageSize=10');
  assert.equal(
    getActivityRecordTarget('857f4000-4264-4d12-8f52-2501d447ddf0', 'http://localhost:3010').href,
    'http://localhost:3010/activities/857f4000-4264-4d12-8f52-2501d447ddf0',
  );
  assert.throws(() => getActivityRecordTarget('../import', 'http://127.0.0.1:3010'), /activity ID/i);
  assert.throws(() => getActivityListTarget('http://runpulse.local/api/activities', 'https://example.com'), /loopback HTTP URL/);
});
