import { getActivityImportTarget } from './activity-import-proxy.ts';
import { isActivityId } from './activity-import-utils.ts';

const ACTIVITY_API_TIMEOUT_MS = 15_000;

type ActivityProxyErrorCode = 'INVALID_PAGINATION' | 'INVALID_ACTIVITY_ID';

class ActivityProxyInputError extends Error {
  readonly code: ActivityProxyErrorCode;

  constructor(code: ActivityProxyErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function apiError(statusCode: number, code: string, message: string): Response {
  return Response.json(
    { statusCode, code, message },
    { status: statusCode, headers: { 'cache-control': 'no-store' } },
  );
}

function getActivityApiOrigin(configuredUrl?: string): string {
  return getActivityImportTarget(configuredUrl).origin;
}

function validatePagination(url: URL): void {
  const allowed = new Set(['page', 'pageSize']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new ActivityProxyInputError('INVALID_PAGINATION', 'Activity pagination parameters are invalid.');
    }
  }

  const page = url.searchParams.get('page');
  const pageSize = url.searchParams.get('pageSize');
  if ((page !== null && (!/^[1-9]\d*$/.test(page) || Number(page) > 10_000)) ||
      (pageSize !== null && (!/^[1-9]\d*$/.test(pageSize) || Number(pageSize) > 100))) {
    throw new ActivityProxyInputError('INVALID_PAGINATION', 'Activity pagination parameters are invalid.');
  }
}

export function getActivityListTarget(requestUrl: string, configuredUrl?: string): URL {
  const incoming = new URL(requestUrl);
  validatePagination(incoming);
  const target = new URL('/activities', getActivityApiOrigin(configuredUrl));
  target.search = incoming.search;
  return target;
}

export function getActivityRecordTarget(id: string, configuredUrl?: string): URL {
  if (!isActivityId(id)) {
    throw new ActivityProxyInputError('INVALID_ACTIVITY_ID', 'The activity identifier is invalid.');
  }
  return new URL(`/activities/${id}`, getActivityApiOrigin(configuredUrl));
}

function inputErrorResponse(error: ActivityProxyInputError): Response {
  const messages: Record<ActivityProxyErrorCode, string> = {
    INVALID_PAGINATION: 'The requested activity page is invalid.',
    INVALID_ACTIVITY_ID: 'The activity identifier is invalid.',
  };
  return apiError(400, error.code, messages[error.code]);
}

async function forwardActivityRequest(
  request: Request,
  target: URL,
  method: 'GET' | 'DELETE',
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(ACTIVITY_API_TIMEOUT_MS);
  const signal = method === 'GET' ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal;
  try {
    const upstream = await fetch(target, {
      method,
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal,
    });
    const headers = new Headers({ 'cache-control': 'no-store' });
    const contentType = upstream.headers.get('content-type');
    const retryAfter = upstream.headers.get('retry-after');
    if (contentType) headers.set('content-type', contentType);
    if (retryAfter) headers.set('retry-after', retryAfter);

    return new Response(upstream.status === 204 ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (timeoutSignal.aborted) {
      return apiError(504, 'API_TIMEOUT', 'The local Activity API did not respond in time. Retry the request.');
    }
    return apiError(502, 'API_UNAVAILABLE', 'Could not connect to the local Activity API. Confirm it is running, then retry.');
  }
}

export function proxyActivityList(request: Request, configuredUrl?: string): Promise<Response> {
  let target: URL;
  try {
    target = getActivityListTarget(request.url, configuredUrl);
  } catch (error) {
    if (error instanceof ActivityProxyInputError) return Promise.resolve(inputErrorResponse(error));
    return Promise.resolve(apiError(502, 'API_UNAVAILABLE', 'Could not connect to the local Activity API. Confirm it is running, then retry.'));
  }
  return forwardActivityRequest(request, target, 'GET');
}

export function proxyActivityRecord(
  request: Request,
  id: string,
  method: 'GET' | 'DELETE',
  configuredUrl?: string,
): Promise<Response> {
  let target: URL;
  try {
    target = getActivityRecordTarget(id, configuredUrl);
  } catch (error) {
    if (error instanceof ActivityProxyInputError) return Promise.resolve(inputErrorResponse(error));
    return Promise.resolve(apiError(502, 'API_UNAVAILABLE', 'Could not connect to the local Activity API. Confirm it is running, then retry.'));
  }
  return forwardActivityRequest(request, target, method);
}
