import { request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import type { DynamicModule } from '@nestjs/common';
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import { gpx, point } from './gpx-fixtures.ts';
import { MAX_GPX_BYTES } from './gpx-parser.ts';

const require = createRequire(`${process.cwd()}/apps/api/src/app.module.ts`);
const { configureTestDatabaseProcess } = require('../../../scripts/database-url-policy.cjs') as {
  configureTestDatabaseProcess(environment: NodeJS.ProcessEnv): string;
};
configureTestDatabaseProcess(process.env);
if (!process.env.ACTIVITY_FINGERPRINT_SECRET) {
  throw new Error('ACTIVITY_FINGERPRINT_SECRET is required for API integration tests.');
}

const { NestFactory } = require('@nestjs/core') as {
  NestFactory: typeof import('@nestjs/core').NestFactory;
};
require('ts-node').register({ project: 'apps/api/tsconfig.json' });
const { AppModule } = require('./app.module.ts') as {
  AppModule: { register(timeoutMs?: number): DynamicModule };
};
interface ImportServiceToken {
  new (): { importActivity(input: Uint8Array): unknown };
}
const { ActivityImportService } = require('./activities/activity-import.service.ts') as {
  ActivityImportService: ImportServiceToken;
};
const { ActivityPersistenceService } = require('./activities/activity-persistence.service.ts') as {
  ActivityPersistenceService: new (...args: never[]) => { create: (...args: unknown[]) => Promise<unknown> };
};
const { PrismaService } = require('./prisma/prisma.service.ts') as {
  PrismaService: new (...args: never[]) => {
    activity: {
      count(args?: unknown): Promise<number>;
      create(args: unknown): Promise<{ id: string }>;
    };
    $transaction: (...args: unknown[]) => Promise<unknown>;
  };
};
const { Prisma } = require('./generated/prisma/client.ts') as {
  Prisma: {
    PrismaClientKnownRequestError: new (message: string, options: {
      code: string;
      clientVersion: string;
      meta?: Record<string, unknown>;
    }) => Error;
  };
};

const validActivity = `<gpx version="1.1" creator="synthetic-tests" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>${point({ time: '2026-01-01T00:01:00Z' })}${point({ lon: '0.001', time: '2026-01-01T00:02:00Z' })}</trkseg></trk>
  <trk><trkseg>${point({ time: '2026-01-01T00:00:00Z' })}${point({ lon: '0.001', time: '2026-01-01T00:00:30Z' })}</trkseg></trk>
</gpx>`;

interface ApiApp {
  app: INestApplication;
  url: string;
}

async function startApi(timeoutMs?: number): Promise<ApiApp> {
  const app = await NestFactory.create(AppModule.register(timeoutMs), { logger: false });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${address.port}` };
}

let api: ApiApp;
const createdActivityIds: string[] = [];

before(async () => { api = await startApi(); });
after(async () => { await api.app.close(); });
afterEach(async () => {
  for (const id of createdActivityIds.splice(0)) {
    const response = await fetch(`${api.url}/activities/${id}`, { method: 'DELETE' });
    assert.ok(response.status === 204 || response.status === 404);
  }
});

function trackCreatedId(value: unknown): void {
  const body = value as { activity?: { id?: unknown } };
  if (typeof body.activity?.id === 'string') createdActivityIds.push(body.activity.id);
}

async function upload(
  url: string,
  contents?: string | Uint8Array,
  options: { filename?: string; contentType?: string; field?: string } = {},
): Promise<Response> {
  const form = new FormData();
  if (contents !== undefined) {
    const source = typeof contents === 'string' ? new TextEncoder().encode(contents) : contents;
    const bytes = new Uint8Array(source.byteLength);
    bytes.set(source);
    const blob = new Blob([bytes.buffer], { type: options.contentType ?? 'application/gpx+xml' });
    form.append(options.field ?? 'file', blob, options.filename ?? 'activity.gpx');
  }
  const response = await fetch(`${url}/activities/import`, { method: 'POST', body: form });
  if (response.status === 200) trackCreatedId(await response.clone().json());
  return response;
}

async function assertError(response: Response, statusCode: number, code: string): Promise<Record<string, unknown>> {
  assert.equal(response.status, statusCode);
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ['code', 'message', 'statusCode']);
  assert.equal(body.statusCode, statusCode);
  assert.equal(body.code, code);
  assert.equal(typeof body.message, 'string');
  return body;
}

function openSlowUpload(url: string) {
  const boundary = 'runpulse-test-boundary';
  const request = httpRequest(`${url}/activities/import`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  let responseResolve!: (response: { status: number; body: string }) => void;
  let responseReject!: (error: Error) => void;
  const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
    responseResolve = resolve;
    responseReject = reject;
  });
  request.on('response', incoming => {
    const chunks: Buffer[] = [];
    incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
    incoming.on('end', () => responseResolve({
      status: incoming.statusCode ?? 0,
      body: Buffer.concat(chunks).toString('utf8'),
    }));
  });
  request.on('error', responseReject);
  request.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="slow.gpx"\r\nContent-Type: application/gpx+xml\r\n\r\n`);
  return {
    response,
    finish(contents = validActivity) {
      request.end(`${contents}\r\n--${boundary}--\r\n`);
    },
    abort() { request.destroy(); },
  };
}

function probeImportCapacity(url: string): Promise<number> {
  const boundary = 'runpulse-capacity-probe';
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${url}/activities/import`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode ?? 0));
    });
    request.on('error', reject);
    request.end(`--${boundary}--\r\n`);
  });
}

test('persists an import, adds persistence metadata, and rejects duplicate summaries', async () => {
  const baseline = await (await fetch(`${api.url}/activities?pageSize=1`)).json();
  const first = await upload(api.url, validActivity);
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.match(body.activity.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.ok(Number.isFinite(Date.parse(body.activity.importedAt)));
  assert.equal(body.activity.startTime, '2026-01-01T00:00:00.000Z');
  assert.equal(body.activity.trackPointCount, 4);
  const afterFirstImport = await (await fetch(`${api.url}/activities?pageSize=1`)).json();
  assert.equal(afterFirstImport.total, baseline.total + 1);

  await assertError(await upload(api.url, validActivity), 409, 'DUPLICATE_ACTIVITY');
  const afterDuplicateImport = await (await fetch(`${api.url}/activities?pageSize=1`)).json();
  assert.equal(afterDuplicateImport.total, baseline.total + 1);
});

test('retrieves, paginates, orders, and deletes persisted summaries', async () => {
  const baseline = await (await fetch(`${api.url}/activities?pageSize=100`)).json();
  const firstResponse = await upload(api.url, validActivity);
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  const secondGpx = validActivity.replace('lon="0.001"', 'lon="0.002"');
  const secondResponse = await upload(api.url, secondGpx);
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json();

  const firstPageResponse = await fetch(`${api.url}/activities?page=1&pageSize=1`);
  assert.equal(firstPageResponse.status, 200);
  const firstPage = await firstPageResponse.json();
  const secondPage = await (await fetch(`${api.url}/activities?page=2&pageSize=1`)).json();
  assert.equal(firstPage.total, baseline.total + 2);
  assert.equal(firstPage.totalPages, firstPage.total);
  assert.equal(firstPage.items.length, 1);
  assert.equal(secondPage.items.length, 1);
  const firstTwo = await (await fetch(`${api.url}/activities?pageSize=100`)).json();
  assert.deepEqual([firstPage.items[0], secondPage.items[0]], firstTwo.items.slice(0, 2));
  const ordered = firstTwo.items.map((item: { activity: { id: string; importedAt: string } }) => item.activity);
  for (let index = 1; index < ordered.length; index++) {
    assert.ok(Date.parse(ordered[index - 1].importedAt) > Date.parse(ordered[index].importedAt) ||
      (ordered[index - 1].importedAt === ordered[index].importedAt && ordered[index - 1].id > ordered[index].id));
  }
  assert.ok(firstTwo.items.some((item: { activity: { id: string } }) => item.activity.id === first.activity.id));
  assert.ok(firstTwo.items.some((item: { activity: { id: string } }) => item.activity.id === second.activity.id));

  const retrieved = await fetch(`${api.url}/activities/${second.activity.id}`);
  assert.equal(retrieved.status, 200);
  assert.deepEqual(await retrieved.json(), second);
  await assertError(await fetch(`${api.url}/activities?page=0`), 400, 'INVALID_PAGINATION');
  await assertError(await fetch(`${api.url}/activities?pageSize=101`), 400, 'INVALID_PAGINATION');
  await assertError(await fetch(`${api.url}/activities/not-a-uuid`), 400, 'INVALID_ACTIVITY_ID');
  await assertError(await fetch(`${api.url}/activities/857f4000-4264-4d12-8f52-2501d447ddf0`), 404, 'ACTIVITY_NOT_FOUND');

  const deleted = await fetch(`${api.url}/activities/${first.activity.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 204);
  await assertError(await fetch(`${api.url}/activities/${first.activity.id}`), 404, 'ACTIVITY_NOT_FOUND');
});

test('persists real zero metrics separately from unavailable metrics', async () => {
  const flat = gpx(
    point({ elevation: '0' }) +
    point({ elevation: '0', time: '2026-01-01T00:00:10Z' }),
  );
  const response = await upload(api.url, flat);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.metrics.totalDistanceMeters, 0);
  assert.equal(body.metrics.totalElevationGainMeters, 0);
  assert.equal(body.metrics.totalElevationLossMeters, 0);
  assert.equal(body.metrics.averageElapsedPaceSecondsPerKm, null);
  assert.equal(body.metrics.averageHeartRateBpm, null);
  assert.equal(body.coverage.distance, 1);
  assert.equal(body.coverage.heartRate, 0);

  const fetched = await fetch(`${api.url}/activities/${body.activity.id}`);
  assert.equal(fetched.status, 200);
  const persisted = await fetched.json();
  assert.equal(persisted.metrics.totalDistanceMeters, 0);
  assert.equal(persisted.metrics.totalElevationGainMeters, 0);
  assert.equal(persisted.metrics.averageElapsedPaceSecondsPerKm, null);
  assert.equal(persisted.metrics.averageHeartRateBpm, null);
  assert.equal(persisted.coverage.heartRate, 0);
});

test('database uniqueness handles concurrent writes outside the import admission gate', async () => {
  const persistence = api.app.get(ActivityPersistenceService);
  const summary = {
    activity: {
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T00:00:00.000Z',
      segmentCount: 1,
      trackPointCount: 1,
    },
    metrics: {
      totalDistanceMeters: null,
      elapsedSeconds: 0,
      recordedDurationSeconds: 0,
      averageElapsedPaceSecondsPerKm: null,
      totalElevationGainMeters: null,
      totalElevationLossMeters: null,
      averageHeartRateBpm: null,
      maxHeartRateBpm: null,
      hasOverlappingSegments: false,
    },
    coverage: { distance: null, elevation: null, heartRate: null },
  };
  const fingerprint = `v1:${'a'.repeat(64)}`;
  const results = await Promise.allSettled([
    persistence.create(summary, fingerprint),
    persistence.create(summary, fingerprint),
  ]);
  const successes = results.filter(result => result.status === 'fulfilled');
  const failures = results.filter(result => result.status === 'rejected');
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  const created = (successes[0] as PromiseFulfilledResult<{ activity: { id: string } }>).value;
  createdActivityIds.push(created.activity.id);
  assert.equal((failures[0] as PromiseRejectedResult).reason.code, 'DUPLICATE_ACTIVITY');
  const prisma = api.app.get(PrismaService);
  assert.equal(await prisma.activity.count({ where: { fingerprint } }), 1);
});

test('database CHECK constraints reject invalid coverage and non-finite metrics', async () => {
  const prisma = api.app.get(PrismaService);
  const base = {
    fingerprint: `v1:${'b'.repeat(64)}`,
    segmentCount: 1,
    trackPointCount: 1,
    hasOverlappingSegments: false,
  };
  await assert.rejects(prisma.activity.create({
    data: { ...base, distanceCoverage: 1.01 },
  }));
  await assert.rejects(prisma.activity.create({
    data: { ...base, fingerprint: `v1:${'c'.repeat(64)}`, totalDistanceMeters: Number.POSITIVE_INFINITY },
  }));
  assert.equal(await prisma.activity.count({ where: { fingerprint: base.fingerprint } }), 0);
});

function fitSignature(): Uint8Array {
  const bytes = new Uint8Array(14);
  bytes[0] = 14;
  bytes.set(new TextEncoder().encode('.FIT'), 8);
  return bytes;
}

test('imports GPX through the HTTP app and returns only the approved summary contract', async () => {
  const response = await upload(api.url, validActivity, { filename: 'misleading.data', contentType: 'application/octet-stream' });
  assert.equal(response.status, 200);
  const body = await response.json();
  const pace = body.metrics.averageElapsedPaceSecondsPerKm;
  const { id, importedAt, ...activity } = body.activity;
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.ok(Number.isFinite(Date.parse(importedAt)));
  assert.deepEqual({
    ...body,
    activity,
    metrics: {
      ...body.metrics,
      totalDistanceMeters: null, // asserted independently below
      averageElapsedPaceSecondsPerKm: null,
    },
  }, {
    activity: {
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T00:02:00.000Z',
      segmentCount: 2,
      trackPointCount: 4,
    },
    metrics: {
      totalDistanceMeters: null, // asserted independently below
      elapsedSeconds: 120,
      recordedDurationSeconds: 90,
      averageElapsedPaceSecondsPerKm: null,
      totalElevationGainMeters: null,
      totalElevationLossMeters: null,
      averageHeartRateBpm: null,
      maxHeartRateBpm: null,
      hasOverlappingSegments: false,
    },
    coverage: { distance: 1, elevation: 0, heartRate: 0 },
  });
  assert.ok(Math.abs(body.metrics.totalDistanceMeters - 222.38985328911747) < 1e-9);
  assert.ok(Math.abs(pace - 120 / (body.metrics.totalDistanceMeters / 1000)) < 1e-9);
  assert.equal(JSON.stringify(body).includes('latitude'), false);
  assert.equal(JSON.stringify(body).includes('longitude'), false);
  assert.equal(JSON.stringify(body).includes('misleading.data'), false);
});

test('preserves null metrics and coverage for activities without sensor pairs', async () => {
  const response = await upload(api.url, gpx(), { filename: 'single.gpx' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.activity.trackPointCount, 1);
  assert.equal(body.metrics.totalDistanceMeters, null);
  assert.equal(body.metrics.averageElapsedPaceSecondsPerKm, null);
  assert.equal(body.metrics.totalElevationGainMeters, null);
  assert.equal(body.metrics.averageHeartRateBpm, null);
  assert.deepEqual(body.coverage, { distance: null, elevation: null, heartRate: null });
});

test('accepts a UTF-8 BOM and rejects malformed UTF-8 and conflicting XML encodings', async () => {
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(gpx())]);
  assert.equal((await upload(api.url, withBom)).status, 200);
  await assertError(await upload(api.url, new Uint8Array([0xc3, 0x28])), 400, 'INVALID_GPX');
  await assertError(await upload(api.url, '<?xml version="1.0" encoding="UTF-16"?>' + gpx()), 400, 'INVALID_GPX');
  await assertError(await upload(api.url, '<?xml version="1.1" encoding="UTF-8"?>' + gpx()), 400, 'INVALID_GPX');
});

test('returns stable client errors for missing, empty, malformed and unsafe imports', async () => {
  await assertError(await upload(api.url), 400, 'MISSING_FILE');
  await assertError(await upload(api.url, ''), 400, 'EMPTY_FILE');
  await assertError(await upload(api.url, '<gpx><trk>'), 400, 'INVALID_GPX');
  const unsafe = '<!DOCTYPE gpx [<!ENTITY x "private">]>' + gpx();
  const unsafeError = await assertError(await upload(api.url, unsafe, { filename: 'private-location.gpx' }), 400, 'INVALID_GPX');
  assert.equal(JSON.stringify(unsafeError).includes('private-location'), false);
  assert.equal(JSON.stringify(unsafeError).includes('private'), false);
});

test('returns unsupported format for TCX roots and FIT signatures', async () => {
  const tcx = '<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"/>';
  await assertError(await upload(api.url, tcx, { filename: 'activity.gpx' }), 415, 'UNSUPPORTED_FORMAT');
  await assertError(await upload(api.url, fitSignature(), { filename: 'activity.gpx' }), 415, 'UNSUPPORTED_FORMAT');
});

test('enforces inclusive file size limits at the multipart boundary', async () => {
  const base = gpx();
  const padding = MAX_GPX_BYTES - Buffer.byteLength(base);
  assert.ok(padding > 0);
  const exact = base + ' '.repeat(padding);
  assert.equal(Buffer.byteLength(exact), MAX_GPX_BYTES);
  assert.equal((await upload(api.url, exact)).status, 200);
  await assertError(await upload(api.url, exact + ' '), 413, 'FILE_TOO_LARGE');
});

test('rejects invalid multipart requests and more than one file', async () => {
  const malformed = await fetch(`${api.url}/activities/import`, {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=invalid' },
    body: 'not a complete multipart body',
  });
  await assertError(malformed, 400, 'INVALID_MULTIPART');

  const multiple = new FormData();
  multiple.append('file', new Blob([gpx()]), 'one.gpx');
  multiple.append('file', new Blob([gpx()]), 'two.gpx');
  await assertError(await fetch(`${api.url}/activities/import`, { method: 'POST', body: multiple }), 400, 'INVALID_MULTIPART');

  const wrongField = new FormData();
  wrongField.append('activity', new Blob([gpx()]), 'one.gpx');
  await assertError(await fetch(`${api.url}/activities/import`, { method: 'POST', body: wrongField }), 400, 'INVALID_MULTIPART');
});

test('returns sanitized internal errors and keeps the health endpoint available', async () => {
  const service = api.app.get(ActivityImportService);
  const original = service.importActivity.bind(service);
  service.importActivity = (_contents: Uint8Array) => {
    throw new Error('private coordinates and secret-file.gpx');
  };
  try {
    const error = await assertError(await upload(api.url, gpx()), 500, 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(error).includes('private'), false);
    assert.equal(JSON.stringify(error).includes('secret-file'), false);
  } finally {
    service.importActivity = original;
  }
  const health = await fetch(`${api.url}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
});

test('sanitizes temporary database failures and accepts a later import', async () => {
  const persistence = api.app.get(ActivityPersistenceService);
  const original = persistence.create.bind(persistence);
  const privateConnectionDetails = 'private connection string localhost:5434';
  persistence.create = async () => {
    throw new Prisma.PrismaClientKnownRequestError(privateConnectionDetails, {
      code: 'P1001',
      clientVersion: '7.10.1',
    });
  };
  try {
    const unavailable = await assertError(await upload(api.url, gpx()), 503, 'DATABASE_UNAVAILABLE');
    assert.equal(JSON.stringify(unavailable).includes(privateConnectionDetails), false);
  } finally {
    persistence.create = original;
  }
  assert.equal((await upload(api.url, gpx())).status, 200);
});

test('sanitizes transaction failures and recovers on the next database operation', async () => {
  const prisma = api.app.get(PrismaService);
  const original = prisma.$transaction.bind(prisma);
  prisma.$transaction = async () => {
    throw new Error('private database transaction details');
  };
  try {
    const failure = await assertError(await fetch(`${api.url}/activities`), 500, 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(failure).includes('private database'), false);
  } finally {
    prisma.$transaction = original;
  }
  assert.equal((await fetch(`${api.url}/activities`)).status, 200);
});

test('limits concurrent uploads and a rejected request cannot release the active permit', async () => {
  const first = openSlowUpload(api.url);
  await new Promise(resolve => setTimeout(resolve, 40));
  const rejected = openSlowUpload(api.url);
  const rejectedResponse = await rejected.response;
  const rejectedBody = JSON.parse(rejectedResponse.body);
  assert.deepEqual(Object.keys(rejectedBody).sort(), ['code', 'message', 'statusCode']);
  assert.equal(rejectedBody.statusCode, 429);
  assert.equal(rejectedBody.code, 'IMPORT_SATURATED');
  const anotherRejected = openSlowUpload(api.url);
  assert.equal((await anotherRejected.response).status, 429);
  first.finish();
  const firstResponse = await first.response;
  assert.equal(firstResponse.status, 200);
  trackCreatedId(JSON.parse(firstResponse.body));
  assert.equal((await upload(api.url, gpx())).status, 200);
});

test('aborted uploads release their permit after parser cleanup', async () => {
  const aborted = openSlowUpload(api.url);
  void aborted.response.catch(() => undefined);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(await probeImportCapacity(api.url), 429);
  aborted.abort();
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    if (await probeImportCapacity(api.url) !== 429) break;
  }
  assert.equal((await upload(api.url, gpx())).status, 200);
});

test('times out incomplete uploads and releases capacity for a later import', async () => {
  const timeoutApi = await startApi(150);
  try {
    const slow = openSlowUpload(timeoutApi.url);
    const result = await slow.response;
    assert.equal(result.status, 408);
    const body = JSON.parse(result.body);
    assert.deepEqual(Object.keys(body).sort(), ['code', 'message', 'statusCode']);
    assert.equal(body.statusCode, 408);
    assert.equal(body.code, 'UPLOAD_TIMEOUT');
    assert.equal((await upload(timeoutApi.url, gpx())).status, 200);
  } finally {
    await timeoutApi.app.close();
  }
});
