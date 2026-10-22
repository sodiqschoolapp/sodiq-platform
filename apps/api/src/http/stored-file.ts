import {
  applyDecorators,
  HttpCode,
  Injectable,
  SetMetadata,
  StreamableFile,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';
import { RETURNS_FILE } from './schemas.js';
import { contentDisposition } from './xlsx.js';

/**
 * A file a person added that a route hands back as it was added (task 7.1a,
 * decision 1: a file of a plan item): its type, its names and its bytes.
 * `@ReturnsStoredFile(types)` sends it as an attachment, never shown in the
 * page and never sniffed as another type.
 */
export class StoredFile {
  constructor(
    readonly type: string,
    /** The name as it was added, for `filename*`. */
    readonly fileName: string,
    /** The same name in ASCII letters, for a browser that ignores `filename*`. */
    readonly asciiName: string,
    readonly content: Buffer,
  ) {}
}

@Injectable()
export class StoredFileInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((answer: unknown) => {
        if (!(answer instanceof StoredFile)) {
          throw new Error(
            `${context.getClass().name}.${context.getHandler().name} answers a stored file, and returned something else.`,
          );
        }
        context
          .switchToHttp()
          .getResponse<Response>()
          .setHeader('X-Content-Type-Options', 'nosniff');
        return new StreamableFile(answer.content, {
          type: answer.type,
          disposition: contentDisposition(answer),
          length: answer.content.length,
        });
      }),
    );
  }
}

/** For a route that answers a stored file of one of `types`: status 200 with the file. */
export function ReturnsStoredFile(types: readonly string[]): MethodDecorator {
  const binary = { schema: { type: 'string', format: 'binary' } } as const;
  return applyDecorators(
    HttpCode(200),
    ApiResponse({
      status: 200,
      content: Object.fromEntries(types.map((type) => [type, binary])),
    }),
    SetMetadata(RETURNS_FILE, true),
    UseInterceptors(StoredFileInterceptor),
  );
}
