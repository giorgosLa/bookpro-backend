import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { FastifyReply } from 'fastify';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<{ url: string }>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const response = exception instanceof HttpException ? exception.getResponse() : null;
    const message =
      response && typeof response === 'object'
        ? (response as any).message ?? (exception instanceof Error ? exception.message : 'Internal server error')
        : typeof response === 'string'
          ? response
          : 'Internal server error';

    // Pass through any extra fields from the exception response (e.g. missingFields)
    const { message: _msg, statusCode: _sc, error: _err, ...extra } =
      response && typeof response === 'object' ? (response as Record<string, unknown>) : {};

    if (status >= 500) {
      this.logger.error(`${request.url} → ${status}`, exception instanceof Error ? exception.stack : String(exception));
      // Only report genuine server errors to Sentry — 4xx are expected client errors (noise).
      Sentry.captureException(exception);
    }

    reply.status(status).send({
      statusCode: status,
      message: Array.isArray(message) ? message : [message],
      ...extra,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
