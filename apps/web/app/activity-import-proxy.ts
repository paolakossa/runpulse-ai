import { request as httpRequest, type IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';

export const DEFAULT_ACTIVITY_API_URL = 'http://127.0.0.1:3001';

const API_UNAVAILABLE_BODY = JSON.stringify({
  statusCode: 502,
  code: 'API_UNAVAILABLE',
  message: 'The local Activity API is unavailable.',
});

function unavailableResponse(): Response {
  return new Response(API_UNAVAILABLE_BODY, {
    status: 502,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function getActivityImportTarget(configuredUrl = process.env.RUNPULSE_API_URL): URL {
  const base = new URL(configuredUrl?.trim() || DEFAULT_ACTIVITY_API_URL);
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
  if (base.protocol !== 'http:' || !loopbackHosts.has(base.hostname.toLowerCase()) ||
      base.username !== '' || base.password !== '' || base.pathname !== '/' ||
      base.search !== '' || base.hash !== '') {
    throw new TypeError('RUNPULSE_API_URL must be a loopback HTTP URL.');
  }
  return new URL('/activities/import', base.origin);
}

export function proxyActivityImport(request: Request, configuredUrl?: string): Promise<Response> {
  let target: URL;
  try {
    target = getActivityImportTarget(configuredUrl);
  } catch {
    return Promise.resolve(unavailableResponse());
  }

  if (request.signal.aborted) return Promise.resolve(new Response(null, { status: 499 }));

  return new Promise(resolve => {
    let response: IncomingMessage | undefined;
    let responseSent = false;
    const body = request.body
      ? Readable.fromWeb(request.body as import('node:stream/web').ReadableStream<Uint8Array>)
      : undefined;
    const upstream = httpRequest(target, {
      method: 'POST',
      headers: request.headers.get('content-type')
        ? { 'content-type': request.headers.get('content-type')! }
        : {},
    });

    const cleanup = (): void => request.signal.removeEventListener('abort', abort);
    const send = (result: Response): void => {
      if (responseSent) return;
      responseSent = true;
      resolve(result);
    };
    const abort = (): void => {
      body?.destroy();
      response?.destroy();
      upstream.destroy();
      send(new Response(null, { status: 499 }));
      cleanup();
    };
    const stopRequestBody = (): void => {
      if (!body || body.readableEnded || body.destroyed) return;
      body.unpipe(upstream);
      body.destroy();
      if (!upstream.destroyed && !upstream.writableEnded) upstream.end();
    };

    request.signal.addEventListener('abort', abort, { once: true });
    upstream.once('response', incoming => {
      response = incoming;
      stopRequestBody();

      const headers = new Headers();
      for (const name of ['content-type', 'cache-control', 'retry-after']) {
        const value = incoming.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }
      if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');

      const status = incoming.statusCode ?? 502;
      const responseBody = status === 204 || status === 304 ? null : Readable.toWeb(incoming);
      send(new Response(responseBody, { status, headers }));
      incoming.once('close', cleanup);
    });
    upstream.once('error', () => {
      cleanup();
      send(request.signal.aborted ? new Response(null, { status: 499 }) : unavailableResponse());
    });

    if (body) {
      body.once('error', () => upstream.destroy());
      body.pipe(upstream);
    } else {
      upstream.end();
    }
  });
}
