export type ActivityImportApiErrorCode =
  | 'MISSING_FILE'
  | 'EMPTY_FILE'
  | 'INVALID_GPX'
  | 'UNSUPPORTED_FORMAT'
  | 'FILE_TOO_LARGE'
  | 'INVALID_MULTIPART'
  | 'UPLOAD_TIMEOUT'
  | 'IMPORT_SATURATED'
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
  INTERNAL_ERROR: { statusCode: 500, message: 'The activity import could not be completed.' },
};

export class ActivityImportApiError extends Error {
  constructor(readonly code: ActivityImportApiErrorCode) {
    super(activityImportApiErrors[code].message);
    this.name = 'ActivityImportApiError';
  }
}
