import { Controller, ForbiddenException, Get, Inject, Post } from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { z } from 'zod';
import { CLOCK } from '../clock/clock.module.js';
import { Returns, ValidBody, ValidQuery } from '../http/schemas.js';

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

type SampleBody = z.infer<typeof sampleBodySchema>;
type SampleQuery = z.infer<typeof sampleQuerySchema>;
type SampleResponse = z.infer<typeof sampleResponseSchema>;

/** Never appears in an answer; the tests check that. */
export const SAMPLE_SECRET = 'internal-detail-7f3a';

/**
 * Exists only in tests (docs/build-plan.md, task 0.4a: "a sample route"). It
 * shows the pieces every real route uses: validated input, the injected clock
 * and the one error shape. Pass it to `createTestApp({ controllers })`.
 */
@Controller('sample')
export class SampleController {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  @Post()
  @Returns(sampleResponseSchema, 201)
  create(@ValidBody(sampleBodySchema) body: SampleBody): SampleResponse {
    return { ...body, receivedAt: this.clock.now().toISOString() };
  }

  @Get()
  list(@ValidQuery(sampleQuerySchema) query: SampleQuery): SampleQuery {
    return query;
  }

  @Get('refused')
  refused(): never {
    throw new ForbiddenException(SAMPLE_SECRET);
  }

  @Get('fault')
  fault(): never {
    throw new Error(SAMPLE_SECRET);
  }
}
