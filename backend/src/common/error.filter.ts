import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { BrainError } from '../brain/brain.types';

const BRAIN_STATUS: Record<string, number> = {
  not_configured: HttpStatus.SERVICE_UNAVAILABLE,
  unreachable: HttpStatus.SERVICE_UNAVAILABLE,
  rate_limited: HttpStatus.TOO_MANY_REQUESTS,
  truncated: HttpStatus.BAD_GATEWAY,
  unparsable: HttpStatus.BAD_GATEWAY,
  refused: HttpStatus.BAD_GATEWAY,
  upstream: HttpStatus.BAD_GATEWAY,
};

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(e: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (e instanceof BrainError) {
      res.status(BRAIN_STATUS[e.code] ?? HttpStatus.BAD_GATEWAY).json({ code: e.code, message: e.message });
      return;
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const body = e.getResponse();
      const raw = typeof body === 'string' ? body : (body as { message?: string | string[] }).message;
      const message = status >= 500 ? 'Unexpected error' : Array.isArray(raw) ? raw.join('; ') : raw || e.message;
      res.status(status).json({ code: status, message });
      return;
    }
    this.log.error('Unhandled error', (e as Error)?.stack);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ code: 500, message: 'Unexpected error' });
  }
}
