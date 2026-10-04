import { Controller, Post } from '@nestjs/common';
import { branchIdSchema } from '@sodiq/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import { RequestKeys } from '../database/request-keys.js';
import { Transactions } from '../database/transactions.js';
import { RequestKey, Returns, ValidBody, ValidParams } from '../http/schemas.js';

export const keyedSampleParamsSchema = z.object({ branchId: branchIdSchema });
export const keyedSampleBodySchema = z.object({ label: z.string().min(1).max(50) });
export const keyedSampleResponseSchema = z.object({ id: z.uuid() });

type KeyedSampleParams = z.infer<typeof keyedSampleParamsSchema>;
type KeyedSampleBody = z.infer<typeof keyedSampleBodySchema>;
type KeyedSampleResponse = z.infer<typeof keyedSampleResponseSchema>;

/** The table the route writes to. The test creates it, with the branch filter. */
export const KEYED_SAMPLE_TABLE = 'scratch_notes';

/**
 * Exists only in tests (docs/build-plan.md, task 0.4b). It shows the pieces
 * every changing route uses: checked path parameters, a transaction with the
 * branch filter, and a request key that makes a repeat harmless.
 */
@Controller('sample-branches')
export class KeyedSampleController {
  constructor(
    private readonly transactions: Transactions,
    private readonly requestKeys: RequestKeys,
  ) {}

  @Post(':branchId/notes')
  @Returns(keyedSampleResponseSchema, 201)
  create(
    @ValidParams(keyedSampleParamsSchema) params: KeyedSampleParams,
    @RequestKey() key: string,
    @ValidBody(keyedSampleBodySchema) body: KeyedSampleBody,
  ): Promise<KeyedSampleResponse> {
    // Not a pattern for real routes: from task 0.7 the branches come from the
    // permission guard, never from the path, the query or the body.
    return this.transactions.run([params.branchId], async (transaction) => {
      const once = await this.requestKeys.runOnce(
        transaction,
        { key, scope: 'sample.note', input: { branchId: params.branchId, label: body.label } },
        async () => {
          const inserted = await sql<{ id: string }>`
            insert into ${sql.table(KEYED_SAMPLE_TABLE)} (branch_id, label)
            values (${params.branchId}, ${body.label})
            returning id
          `.execute(transaction);
          return { id: inserted.rows[0]?.id ?? '' };
        },
      );
      return once.result;
    });
  }
}
