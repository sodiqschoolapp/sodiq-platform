import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import type { z } from 'zod';
import { toErrorDetails } from './validation.js';

/** Metadata key under which `@Returns` keeps the schema of the answer. */
export const RESPONSE_SCHEMA = Symbol('RESPONSE_SCHEMA');

/**
 * Sends only what the schema of `@Returns` describes: fields the schema does
 * not know are dropped, so a column that a query returns by accident never
 * reaches the browser. An answer that does not fit its schema is a fault of
 * the server (500), named in the log by field and kind, never by value.
 */
@Injectable()
export class ResponseSchemaInterceptor implements NestInterceptor {
  private readonly reflector = new Reflector();

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = this.reflector.get<z.ZodType | undefined>(RESPONSE_SCHEMA, context.getHandler());
    if (schema === undefined) {
      return next.handle();
    }
    return next.handle().pipe(
      map((answer: unknown) => {
        const result = schema.safeParse(answer);
        if (!result.success) {
          const problems = toErrorDetails(result.error)
            .map((detail) => `${detail.path || '(whole answer)'}: ${detail.code}`)
            .join(', ');
          throw new Error(
            `The answer of ${context.getClass().name}.${context.getHandler().name} does not match its schema (${problems}).`,
          );
        }
        return result.data;
      }),
    );
  }
}
