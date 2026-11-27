import { ArgumentsHost, Catch, Controller, Delete, ExceptionFilter, Get, Header, HttpCode, HttpException, HttpStatus, Injectable, Logger, Param, Post, Query, UploadedFile, UseFilters, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { ServerResponse } from 'node:http';
import { ActivityImportApiError, activityImportApiErrors, type ActivityImportApiErrorCode } from './activity-import-errors.ts';
import { ActivityImportLifecycleInterceptor } from './activity-import.middleware.ts';
import { ActivityImportService, type PersistedActivitySummary } from './activity-import.service.ts';
import { ActivityService } from './activity.service.ts';
import { parseActivityPagination } from './activity-pagination.ts';
import { isDatabaseUnavailable } from './activity-database-errors.ts';
import { ActivityImportError, MAX_GPX_BYTES } from '../gpx-parser.ts';

const FILE_UPLOAD_LIMITS = {
  fileSize: MAX_GPX_BYTES,
  files: 1,
  fields: 0,
  parts: 1,
  fieldNameSize: 4,
  fieldSize: 0,
  headerPairs: 32,
};

function sendApiError(response: ServerResponse, code: ActivityImportApiErrorCode): void {
  if (response.headersSent || response.destroyed) return;
  const definition = activityImportApiErrors[code];
  response.statusCode = definition.statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify({ statusCode: definition.statusCode, code, message: definition.message }));
}

@Catch()
@Injectable()
export class ActivityImportExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ActivityImportExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<ServerResponse>();
    if (response.headersSent || response.destroyed) return;

    let code: ActivityImportApiErrorCode;
    if (exception instanceof ActivityImportApiError) {
      code = exception.code;
    } else if (exception instanceof ActivityImportError) {
      code = exception.code === 'UNSUPPORTED_FORMAT' ? 'UNSUPPORTED_FORMAT' : 'INVALID_GPX';
    } else if (isDatabaseUnavailable(exception)) {
      code = 'DATABASE_UNAVAILABLE';
    } else if (exception instanceof HttpException && exception.getStatus() === 413) {
      code = 'FILE_TOO_LARGE';
    } else if (exception instanceof HttpException && exception.getStatus() === 400) {
      code = 'INVALID_MULTIPART';
    } else {
      code = 'INTERNAL_ERROR';
    }

    if (code === 'INTERNAL_ERROR') this.logger.error('Activity operation failed unexpectedly.');
    if (code === 'DATABASE_UNAVAILABLE') this.logger.error('The local activity database is unavailable.');
    sendApiError(response, code);
  }
}

@Controller('activities')
@UseFilters(ActivityImportExceptionFilter)
export class ActivityImportController {
  constructor(
    private readonly activityImportService: ActivityImportService,
    private readonly activityService: ActivityService,
  ) {}

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'no-store')
  @UseInterceptors(
    ActivityImportLifecycleInterceptor,
    FileInterceptor('file', { limits: FILE_UPLOAD_LIMITS }),
  )
  import(@UploadedFile() file: { buffer: Uint8Array } | undefined): Promise<PersistedActivitySummary> {
    if (!file) throw new ActivityImportApiError('MISSING_FILE');
    return this.activityImportService.importActivity(file.buffer);
  }

  @Get()
  @Header('cache-control', 'no-store')
  list(
    @Query('page') page: unknown,
    @Query('pageSize') pageSize: unknown,
  ) {
    const pagination = parseActivityPagination(page, pageSize);
    return this.activityService.list(pagination.page, pagination.pageSize);
  }

  @Get(':id')
  @Header('cache-control', 'no-store')
  get(@Param('id') id: string) {
    return this.activityService.get(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id') id: string): Promise<void> {
    return this.activityService.delete(id);
  }
}
