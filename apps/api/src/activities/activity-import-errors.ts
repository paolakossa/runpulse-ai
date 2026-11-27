export type ActivityImportApiErrorCode =
  | 'MISSING_FILE'
  | 'EMPTY_FILE'
  | 'INVALID_GPX'
  | 'UNSUPPORTED_FORMAT'
  | 'FILE_TOO_LARGE'
  | 'INVALID_MULTIPART'
  | 'UPLOAD_TIMEOUT'
  | 'IMPORT_SATURATED'
  | 'DUPLICATE_ACTIVITY'
  | 'ACTIVITY_NOT_FOUND'
  | 'INVALID_ACTIVITY_ID'
  | 'INVALID_PAGINATION'
  | 'DATABASE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export const activityImportApiErrors: Record<
  ActivityImportApiErrorCode,
  { statusCode: number; message: string }
> = {
  MISSING_FILE: { statusCode: 400, message: 'A GPX file is required in the file field.' },
  EMPTY_FILE: { statusCode: 400, message: 'The uploaded file is empty.' },
  INVALID_GPX: { statusCode: 400, message: 'The uploaded file is not a valid GPX activity.' },
  UNSUPPORTED_FORMAT: { statusCode: 415, message: 'Only GPX activity files are supported.' },
  FILE_TOO_LARGE: { statusCode: 413, message: 'The uploaded file exceeds the 10 MiB limit.' },
  INVALID_MULTIPART: { statusCode: 400, message: 'The multipart upload is invalid.' },
  UPLOAD_TIMEOUT: { statusCode: 408, message: 'The upload did not complete within the allowed time.' },
  IMPORT_SATURATED: { statusCode: 429, message: 'Activity import capacity is currently full.' },
  DUPLICATE_ACTIVITY: { statusCode: 409, message: 'This activity has already been imported.' },
  ACTIVITY_NOT_FOUND: { statusCode: 404, message: 'The requested activity was not found.' },
  INVALID_ACTIVITY_ID: { statusCode: 400, message: 'The activity identifier is invalid.' },
  INVALID_PAGINATION: { statusCode: 400, message: 'The activity pagination parameters are invalid.' },
  DATABASE_UNAVAILABLE: { statusCode: 503, message: 'The local activity database is unavailable.' },
  INTERNAL_ERROR: { statusCode: 500, message: 'The activity import could not be completed.' },
};

export class ActivityImportApiError extends Error {
  readonly code: ActivityImportApiErrorCode;

  constructor(code: ActivityImportApiErrorCode) {
    super(activityImportApiErrors[code].message);
    this.code = code;
    this.name = 'ActivityImportApiError';
  }
}
