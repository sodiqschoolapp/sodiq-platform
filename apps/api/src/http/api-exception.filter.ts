import { Catch, NotFoundException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { sendError } from './error-response.js';

/** Every error inside the application ends here and leaves in the one shape. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    sendError(host.switchToHttp().getResponse<Response>(), exception);
  }
}

/** For paths outside the API prefix, which NestJS leaves to Express. */
export function notFoundFallback(_request: Request, response: Response) {
  sendError(response, new NotFoundException());
}

/**
 * For errors that Express would otherwise answer with its own page. Express
 * recognises an error handler by its four parameters.
 */
export function errorFallback(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
) {
  if (response.headersSent) {
    // The answer has started: Express can only close the connection.
    next(error);
    return;
  }
  sendError(response, error);
}
