import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { DynamicModule, INestApplication } from '@nestjs/common';
import { gpx } from '../../api/src/gpx-fixtures.ts';
import { MAX_ACTIVITY_FILE_BYTES } from './activity-import-utils.ts';
import { getActivityImportTarget, proxyActivityImport } from './activity-import-proxy.ts';
import { GET as getActivityList } from './api/activities/route.ts';
import {
  DELETE as deleteActivity,
  GET as getActivity,
} from './api/activities/[id]/route.ts';

const require = createRequire(`${process.cwd()}/apps/api/src/app.module.ts`);
const { configureTestDatabaseProcess } = require('../../../scripts/database-url-policy.cjs') as {
  configureTestDatabaseProcess(environment: NodeJS.ProcessEnv): string;
};
configureTestDatabaseProcess(process.env);
const { NestFactory } = require('@nestjs/core') as {
  NestFactory: typeof import('@nestjs/core').NestFactory;
};
require('ts-node').register({ project: 'apps/api/tsconfig.json' });
const { AppModule } = require('../../api/src/app.module.ts') as {
  AppModule: { register(timeoutMs?: number): DynamicModule };
};

let app: INestApplication;
let apiUrl: string;
const createdActivityIds: string[] = [];

before(async () => {
  app = await NestFactory.create(AppModule.register(1500), { logger: false });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  apiUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => { await app.close(); });
afterEach(async () => {
  for (const id of createdActivityIds.splice(0)) {
    const response = await fetch(`${apiUrl}/activities/${id}`, { method: 'DELETE' });
    assert.ok(response.status === 204 || response.status === 404);
  }
});

async function trackCreatedActivity(response: Response): Promise<void> {
  if (response.status !== 200) return;
  const body = await response.clone().json() as { activity?: { id?: unknown } };
  const id = body.activity?.id;
  assert.equal(typeof id, 'string');
  if (typeof id !== 'string') throw new Error('Successful persisted imports must return an activity ID.');
  createdActivityIds.push(id);
}

function waitForApiRequest(boundary: string, apiApp = app): Promise<IncomingMessage> {
  const server = apiApp.getHttpServer();
  return new Promise((resolve, reject) => {
    const onRequest = (request: IncomingMessage): void => {
      const contentType = request.headers['content-type'];
      if (request.url !== '/activities/import' ||
          typeof contentType !== 'string' ||
          !contentType.includes(`boundary=${boundary}`)) {
        return;
      }
      clearTimeout(timer);
      server.off('request', onRequest);
      resolve(request);
    };
    const timer = setTimeout(() => {
      server.off('request', onRequest);
      reject(new Error(`Timed out waiting for the API to receive boundary ${boundary}.`));
    }, 2_000);
    server.on('request', onRequest);
  });
}

async function waitForSuccessfulImport(targetUrl = apiUrl): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const response = await proxyActivityImport(formRequest(gpx()), targetUrl);
    if (response.status === 200) {
      await trackCreatedActivity(response);
      await response.arrayBuffer();
      return;
    }
    assert.equal(response.status, 429);
    await response.arrayBuffer();
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for API import capacity to recover.');
}

function formRequest(contents: string, filename = 'synthetic.gpx'): Request {
  const form = new FormData();
  form.append('file', new Blob([contents]), filename);
  return new Request('http://runpulse.local/api/activities/import', {
    method: 'POST',
    body: form,
  });
}

function incompleteRequest(signal?: AbortSignal, boundary = 'runpulse-proxy-slow-upload'): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="slow.gpx"\r\nContent-Type: application/gpx+xml\r\n\r\n`,
      ));
    },
  });
  return new Request('http://runpulse.local/api/activities/import', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
    signal,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

async function errorBody(response: Response) {
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['code', 'message', 'statusCode']);
  return body;
}

test('streams a synthetic GPX through the same-origin proxy and preserves the API response', async () => {
  const response = await proxyActivityImport(formRequest(gpx()), apiUrl);
  await trackCreatedActivity(response);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.activity.trackPointCount, 1);
  assert.equal(body.metrics.totalDistanceMeters, null);
  assert.equal(body.coverage.distance, null);
  assert.equal('latitude' in body, false);
});

test('backend URL configuration defaults locally and rejects non-loopback hosts', () => {
  assert.equal(getActivityImportTarget('').href, 'http://127.0.0.1:3001/activities/import');
  assert.equal(getActivityImportTarget('http://localhost:3002').href, 'http://localhost:3002/activities/import');
  assert.throws(() => getActivityImportTarget('https://example.com'), /loopback HTTP URL/);
  assert.throws(() => getActivityImportTarget('http://user:pass@127.0.0.1:3001'), /loopback HTTP URL/);
});

test('preserves the exact 10 MiB upload boundary and backend 413 response', async () => {
  const base = gpx();
  const padding = MAX_ACTIVITY_FILE_BYTES - Buffer.byteLength(base);
  const exact = base + ' '.repeat(padding);
  assert.equal(Buffer.byteLength(exact), MAX_ACTIVITY_FILE_BYTES);
  const accepted = await proxyActivityImport(formRequest(exact), apiUrl);
  await trackCreatedActivity(accepted);
  assert.equal(accepted.status, 200);

  const oversized = await proxyActivityImport(formRequest(exact + ' '), apiUrl);
  assert.equal(oversized.status, 413);
  assert.equal((await errorBody(oversized)).code, 'FILE_TOO_LARGE');
});

test('preserves sanitized unsupported-format errors from the API', async () => {
  const tcx = '<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"/>';
  const response = await proxyActivityImport(formRequest(tcx), apiUrl);
  assert.equal(response.status, 415);
  const body = await errorBody(response);
  assert.equal(body.code, 'UNSUPPORTED_FORMAT');
  assert.doesNotMatch(JSON.stringify(body), /TrainingCenterDatabase|synthetic\.gpx/);
});

test('preserves API concurrency and timeout behavior through streaming proxying', async () => {
  const apiReceivedUpload = waitForApiRequest('runpulse-proxy-slow-upload');
  const slowUpload = proxyActivityImport(incompleteRequest(), apiUrl);
  await apiReceivedUpload;

  const saturated = await proxyActivityImport(formRequest(gpx()), apiUrl);
  assert.equal(saturated.status, 429);
  assert.equal((await errorBody(saturated)).code, 'IMPORT_SATURATED');

  const timedOut = await slowUpload;
  assert.equal(timedOut.status, 408);
  assert.equal((await errorBody(timedOut)).code, 'UPLOAD_TIMEOUT');

  const laterImport = await proxyActivityImport(formRequest(gpx()), apiUrl);
  await trackCreatedActivity(laterImport);
  assert.equal(laterImport.status, 200);
});

test('cancellation through the proxy releases API capacity for a later import', async () => {
  const cancellationApp = await NestFactory.create(AppModule.register(10_000), { logger: false });
  try {
    await cancellationApp.listen(0, '127.0.0.1');
    const address = cancellationApp.getHttpServer().address() as AddressInfo;
    const cancellationApiUrl = `http://127.0.0.1:${address.port}`;
    const abortController = new AbortController();
    const boundary = 'runpulse-proxy-cancel-upload';
    const apiReceivedUpload = waitForApiRequest(boundary, cancellationApp);
    const cancelledUpload = proxyActivityImport(incompleteRequest(abortController.signal, boundary), cancellationApiUrl);
    const apiRequest = await apiReceivedUpload;
    const apiRequestAborted = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The API did not observe the cancelled proxy request.')), 1_000);
      apiRequest.once('aborted', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    abortController.abort();

    const cancelledResponse = await cancelledUpload;
    assert.equal(cancelledResponse.status, 499);
    await apiRequestAborted;

    await waitForSuccessfulImport(cancellationApiUrl);
  } finally {
    await cancellationApp.close();
  }
});

test('same-origin history routes list, retrieve, and delete a synthetic persisted activity', async () => {
  const previousUrl = process.env.RUNPULSE_API_URL;
  process.env.RUNPULSE_API_URL = apiUrl;
  try {
    const before = await getActivityList(new Request('http://runpulse.local/api/activities?page=1&pageSize=100'));
    assert.equal(before.status, 200);
    const beforePage = await before.json() as { total: number };

    const imported = await proxyActivityImport(formRequest(gpx()), apiUrl);
    await trackCreatedActivity(imported);
    assert.equal(imported.status, 200);
    const importedBody = await imported.json() as {
      activity: { id: string; importedAt: string };
    };
    const id = importedBody.activity.id;
    assert.ok(Number.isFinite(Date.parse(importedBody.activity.importedAt)));

    const listResponse = await getActivityList(
      new Request('http://runpulse.local/api/activities?page=1&pageSize=100'),
    );
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.headers.get('cache-control'), 'no-store');
    const page = await listResponse.json() as {
      items: Array<{ activity: { id: string } }>;
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
    assert.equal(page.page, 1);
    assert.equal(page.pageSize, 100);
    assert.equal(page.total, beforePage.total + 1);
    assert.ok(page.totalPages >= 1);
    assert.ok(page.items.some(item => item.activity.id === id));

    const context = { params: Promise.resolve({ id }) };
    const detailResponse = await getActivity(new Request('http://runpulse.local'), context);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as { activity: { id: string } };
    assert.equal(detail.activity.id, id);

    const deletionResponse = await deleteActivity(new Request('http://runpulse.local'), context);
    assert.equal(deletionResponse.status, 204);
    const deletedDetail = await getActivity(new Request('http://runpulse.local'), context);
    assert.equal(deletedDetail.status, 404);
    assert.equal((await errorBody(deletedDetail)).code, 'ACTIVITY_NOT_FOUND');
    const repeatedDeletion = await deleteActivity(new Request('http://runpulse.local'), context);
    assert.equal(repeatedDeletion.status, 404);
  } finally {
    if (previousUrl === undefined) delete process.env.RUNPULSE_API_URL;
    else process.env.RUNPULSE_API_URL = previousUrl;
  }
});
