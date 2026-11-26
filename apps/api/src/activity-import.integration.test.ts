import { request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import type { DynamicModule } from '@nestjs/common';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { gpx, point } from './gpx-fixtures.ts';
import { MAX_GPX_BYTES } from './gpx-parser.ts';

const require = createRequire(`${process.cwd()}/apps/api/src/app.module.ts`);
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

before(async () => { api = await startApi(); });
after(async () => { await api.app.close(); });

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
  return fetch(`${url}/activities/import`, { method: 'POST', body: form });
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
  assert.deepEqual({
    ...body,
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
  assert.equal((await first.response).status, 200);
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
