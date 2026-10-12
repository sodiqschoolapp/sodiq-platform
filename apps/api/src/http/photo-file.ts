import {
  Injectable,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { PhotoType } from '@sodiq/shared';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';

/** A photo a route answers (task 2.2c-2): its bytes and its type. `@ReturnsPhoto()` sends it. */
export class PhotoFile {
  constructor(
    readonly type: PhotoType,
    readonly content: Buffer,
  ) {}
}

/**
 * Sends the `PhotoFile` a route returns, shown in the page, never sniffed as
 * another type. `Cache-Control: no-store` is already set for every answer
 * (`no-store.ts`; decision 6): the page keeps the photo in memory instead.
 */
@Injectable()
export class PhotoFileInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((answer: unknown) => {
        if (!(answer instanceof PhotoFile)) {
          throw new Error(
            `${context.getClass().name}.${context.getHandler().name} answers a photo, and returned something else.`,
          );
        }
        context
          .switchToHttp()
          .getResponse<Response>()
          .setHeader('X-Content-Type-Options', 'nosniff');
        return new StreamableFile(answer.content, {
          type: answer.type,
          disposition: 'inline',
          length: answer.content.length,
        });
      }),
    );
  }
}
