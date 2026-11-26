import { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable, type NestInterceptor, type ExecutionContext, type CallHandler } from '@nestjs/common';
import { finalize, type Observable } from 'rxjs';
import { activityImportApiErrors, type ActivityImportApiErrorCode } from './activity-import-errors.ts';

export const DEFAULT_UPLOAD_RECEIVE_TIMEOUT_MS = 60_000;
export const MAX_UPLOAD_RECEIVE_TIMEOUT_MS = 120_000;
export const UPLOAD_RECEIVE_TIMEOUT = Symbol('UPLOAD_RECEIVE_TIMEOUT');

export interface ActivityImportLifecycle {
  timedOut: boolean;
  release(): void;
}

export interface ActivityImportRequest extends IncomingMessage {
  activityImportLifecycle?: ActivityImportLifecycle;
  file?: { buffer: Uint8Array };
}

function sendError(response: ServerResponse, code: ActivityImportApiErrorCode): void {
  if (response.headersSent || response.destroyed) return;
  const definition = activityImportApiErrors[code];
  response.statusCode = definition.statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify({ statusCode: definition.statusCode, code, message: definition.message }));
}

@Injectable()
export class ActivityImportAdmissionMiddleware {
  private activeImports = 0;

  constructor(@Inject(UPLOAD_RECEIVE_TIMEOUT) private readonly timeoutMs: number) {}

  use(request: IncomingMessage, response: ServerResponse, next: (error?: Error) => void): void {
    if (this.activeImports >= 1) {
      response.setHeader('Connection', 'close');
      sendError(response, 'IMPORT_SATURATED');
      response.once('finish', () => request.destroy());
      return;
    }

    this.activeImports++;
    let released = false;
    let bodyComplete = request.readableEnded;
    let timer: NodeJS.Timeout | undefined;
    const lifecycle: ActivityImportLifecycle = {
      timedOut: false,
      release: () => {
        if (released) return;
        released = true;
        if (timer) clearTimeout(timer);
        this.activeImports--;
      },
    };
    const importRequest = request as ActivityImportRequest;
    importRequest.activityImportLifecycle = lifecycle;

    const clearReceiveTimeout = (): void => {
      bodyComplete = true;
      if (timer) clearTimeout(timer);
    };
    request.once('end', clearReceiveTimeout);
    request.once('aborted', clearReceiveTimeout);
    request.once('error', clearReceiveTimeout);

    if (!bodyComplete) {
      timer = setTimeout(() => {
        if (bodyComplete || request.destroyed || response.headersSent) return;
        lifecycle.timedOut = true;
        request.pause();
        response.setHeader('Connection', 'close');
        sendError(response, 'UPLOAD_TIMEOUT');
        const abortRequest = (): void => {
          if (!request.destroyed) request.destroy();
        };
        response.once('finish', abortRequest);
        response.once('close', abortRequest);
      }, this.timeoutMs);
    }
    next();
  }
}

@Injectable()
export class ActivityImportLifecycleInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<ActivityImportRequest>();
    return next.handle().pipe(finalize(() => request.activityImportLifecycle?.release()));
  }
}
