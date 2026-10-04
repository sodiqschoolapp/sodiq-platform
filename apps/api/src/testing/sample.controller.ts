import { Controller, ForbiddenException, Get, Inject, Post } from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { z } from 'zod';
import { CLOCK } from '../clock/clock.module.js';
import { Returns, ValidBody, ValidQuery } from '../http/schemas.js';
import { Public } from '../modules/auth/session.guard.js';

export const sampleBodySchema = z.object({
  name: z.string().min(1).max(50),
  count: z.number().int().min(0),
});

export const sampleQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const sampleResponseSchema = z.object({
  name: z.string(),
  count: z.number().int(),
  receivedAt: z.iso.datetime(),
});

/** What the query looks like after its defaults are filled. */
export const sampleListSchema = z.object({ limit: z.number().int() });

type SampleBody = z.infer<typeof sampleBodySchema>;
type SampleQuery = z.infer<typeof sampleQuerySchema>;
type SampleResponse = z.infer<typeof sampleResponseSchema>;

/** Never appears in an answer; the tests check that. */
export const SAMPLE_SECRET = 'internal-detail-7f3a';

/** Stands for a value of a row inside a database error. It appears neither in an answer nor in the log. */
export const SAMPLE_ROW_VALUE = 'row-value-91c2';

/**
 * Exists only in tests (docs/build-plan.md, task 0.4a: "a sample route"). It
 * shows the pieces every real route uses: validated input, the injected clock
 * and the one error shape. Pass it to `createTestApp({ controllers })`. Its
 * routes are public: they are never part of the running application.
 */
@Controller('sample')
export class SampleController {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  @Post()
  @Public()
  @Returns(sampleResponseSchema, 201)
  create(@ValidBody(sampleBodySchema) body: SampleBody): SampleResponse {
    return { ...body, receivedAt: this.clock.now().toISOString() };
  }

  @Get()
  @Public()
  @Returns(sampleListSchema)
  list(@ValidQuery(sampleQuerySchema) query: SampleQuery): SampleQuery {
    return query;
  }

  @Get('refused')
  @Public()
  refused(): never {
    throw new ForbiddenException(SAMPLE_SECRET);
  }

  /** Returns more than its schema knows, as a query with one column too many would. */
  @Get('extra-field')
  @Public()
  @Returns(sampleListSchema)
  extraField(): SampleQuery {
    const row = { limit: 1, hidden: SAMPLE_SECRET };
    return row;
  }

  /** Returns something its schema refuses. */
  @Get('wrong-answer')
  @Public()
  @Returns(sampleListSchema)
  wrongAnswer(): SampleQuery {
    const row: { limit: unknown } = { limit: SAMPLE_SECRET };
    return row as SampleQuery;
  }

  /** Fails like a database error: the message names the fault, `detail` holds values of a row. */
  @Get('fault')
  @Public()
  fault(): never {
    throw Object.assign(new Error(SAMPLE_SECRET), { detail: SAMPLE_ROW_VALUE });
  }
}
