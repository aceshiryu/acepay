import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { captureException } from '../observability/sentry';

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

/**
 * Turns every thrown error into a consistent envelope:
 *   { error: { code, message, requestId, details? } }
 *
 * - HttpExceptions keep their status + any structured body (our guards already
 *   throw { error, message } objects — those are preserved as code/message).
 * - Provider SDK errors (Lemon Squeezy / Xendit) and anything unexpected become
 *   a 502/500 with a generic message; the real error is logged server-side and
 *   never leaked to the caller in production.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');
  private readonly isProd = process.env.NODE_ENV === 'production';

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const requestId =
      (req.header?.('x-request-id') as string | undefined) ??
      (req as unknown as { id?: string }).id ??
      randomUUID();

    const { status, code, message, details } = this.normalize(exception);

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${req.method} ${req.url} -> ${status} ${code}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      // Report server-side failures to Sentry (no-op when SENTRY_DSN is unset).
      captureException(exception, { requestId });
    } else {
      this.logger.warn(`[${requestId}] ${req.method} ${req.url} -> ${status} ${code}: ${message}`);
    }

    const body: ErrorEnvelope = {
      error: {
        code,
        message: status >= 500 && this.isProd ? 'Internal server error' : message,
        requestId,
        ...(details !== undefined && !this.isProd ? { details } : {}),
      },
    };

    res.setHeader('x-request-id', requestId);
    res.status(status).json(body);
  }

  private normalize(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resBody = exception.getResponse();
      if (typeof resBody === 'string') {
        return { status, code: codeFromStatus(status), message: resBody };
      }
      const obj = resBody as Record<string, unknown>;
      // Our guards throw { error: 'invalid_api_key', message: '...' }.
      const code =
        (typeof obj.error === 'string' && obj.error) ||
        (typeof obj.code === 'string' && obj.code) ||
        codeFromStatus(status);
      const message = Array.isArray(obj.message)
        ? (obj.message as string[]).join(', ')
        : typeof obj.message === 'string'
        ? obj.message
        : exception.message;
      return { status, code, message, details: obj.details ?? obj.errors };
    }

    // Provider SDK / upstream failures — treat as a bad gateway, not a bug.
    if (isProviderError(exception)) {
      return {
        status: HttpStatus.BAD_GATEWAY,
        code: 'provider_error',
        message: (exception as Error).message,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal_error',
      message: exception instanceof Error ? exception.message : 'Unexpected error',
    };
  }
}

function codeFromStatus(status: number): string {
  const map: Record<number, string> = {
    400: 'bad_request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    422: 'unprocessable_entity',
    429: 'rate_limited',
    500: 'internal_error',
    502: 'provider_error',
    503: 'service_unavailable',
  };
  return map[status] ?? 'error';
}

const PROVIDER_HINTS = ['lemon squeezy', 'lemonsqueezy', 'xendit', 'invoice', 'checkout'];

function isProviderError(exception: unknown): boolean {
  if (!(exception instanceof Error)) return false;
  const m = exception.message.toLowerCase();
  return PROVIDER_HINTS.some((h) => m.includes(h));
}
