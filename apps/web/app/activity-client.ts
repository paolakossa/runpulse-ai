import {
  getActivityApiErrorMessage,
  isActivityId,
  parseActivityImportResponse,
  parseActivityPageResponse,
  type ActivityImportResponse,
  type ActivityPageResponse,
} from './activity-import-utils.ts';

export type ActivityRequestResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; status?: number };

type Fetcher = typeof fetch;

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function unexpectedResponse(): { ok: false; message: string } {
  return {
    ok: false,
    message: 'The local API returned an unexpected response. Check that it is running and retry.',
  };
}

export async function fetchActivityPage(
  page: number,
  pageSize: number,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<ActivityRequestResult<ActivityPageResponse>> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return {
      ok: false,
      message: getActivityApiErrorMessage(400, { statusCode: 400, code: 'INVALID_PAGINATION' }),
      status: 400,
    };
  }

  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const response = await fetcher(`/api/activities?${query}`, { cache: 'no-store', signal });
  const payload = await responseJson(response);
  if (!response.ok) {
    return { ok: false, message: getActivityApiErrorMessage(response.status, payload), status: response.status };
  }

  const value = parseActivityPageResponse(payload);
  return value === null || value.page !== page || value.pageSize !== pageSize
    ? { ok: false, message: unexpectedResponse().message, status: response.status }
    : { ok: true, value };
}

export async function fetchActivity(
  id: string,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<ActivityRequestResult<ActivityImportResponse>> {
  if (!isActivityId(id)) {
    return {
      ok: false,
      message: getActivityApiErrorMessage(400, { statusCode: 400, code: 'INVALID_ACTIVITY_ID' }),
      status: 400,
    };
  }

  const response = await fetcher(`/api/activities/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    signal,
  });
  const payload = await responseJson(response);
  if (!response.ok) {
    return { ok: false, message: getActivityApiErrorMessage(response.status, payload), status: response.status };
  }

  const value = parseActivityImportResponse(payload);
  return value === null
    ? { ok: false, message: unexpectedResponse().message, status: response.status }
    : { ok: true, value };
}

export async function deleteActivity(
  id: string,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<ActivityRequestResult<void>> {
  if (!isActivityId(id)) {
    return {
      ok: false,
      message: getActivityApiErrorMessage(400, { statusCode: 400, code: 'INVALID_ACTIVITY_ID' }),
      status: 400,
    };
  }

  const response = await fetcher(`/api/activities/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    cache: 'no-store',
    signal,
  });
  if (response.status === 204) return { ok: true, value: undefined };
  const payload = await responseJson(response);
  return {
    ok: false,
    message: getActivityApiErrorMessage(response.status, payload),
    status: response.status,
  };
}
