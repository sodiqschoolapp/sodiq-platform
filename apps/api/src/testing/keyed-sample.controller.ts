import { Controller, Post } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { RequestKeys } from '../database/request-keys.js';
import { Transactions } from '../database/transactions.js';
import { RequestKey, Returns, ValidBody, ValidParams } from '../http/schemas.js';
import { requiresInTable } from '../modules/access/access.decorators.js';
import { CurrentAccess, type Access } from '../modules/access/permission.guard.js';

export const keyedSampleParamsSchema = z.object({ notebookId: z.uuid() });
export const keyedSampleBodySchema = z.object({ label: z.string().min(1).max(50) });
export const keyedSampleResponseSchema = z.object({ id: z.uuid() });

type KeyedSampleParams = z.infer<typeof keyedSampleParamsSchema>;
type KeyedSampleBody = z.infer<typeof keyedSampleBodySchema>;
type KeyedSampleResponse = z.infer<typeof keyedSampleResponseSchema>;

/** The table the route writes to. The test creates it, with the branch filter. */
export const KEYED_SAMPLE_TABLE = 'scratch_notes';

/**
 * Exists only in tests (docs/build-plan.md, tasks 0.4b and 0.7b). It shows the
 * pieces every changing route uses: a declared permission, checked path
 * parameters, a transaction for the branch the guard allowed, and a request
 * key that makes a repeat harmless. For an application made with
 * `permissionTable: SAMPLE_PERMISSIONS`.
 */
@Controller('sample-notebooks')
export class KeyedSampleController {
  constructor(
    private readonly transactions: Transactions,
    private readonly requestKeys: RequestKeys,
  ) {}

  @Post(':notebookId/notes')
  @requiresInTable('sample', 'create')
  @Returns(keyedSampleResponseSchema, 201)
  create(
    @CurrentAccess() access: Access,
    @ValidParams(keyedSampleParamsSchema) params: KeyedSampleParams,
    @RequestKey() key: string,
    @ValidBody(keyedSampleBodySchema) body: KeyedSampleBody,
  ): Promise<KeyedSampleResponse> {
    // The branch comes from the permission guard, never from the path, the
    // query or the body. The permission was checked before `runOnce`.
    return this.transactions.run(access.branchIds, async (transaction) => {
      const once = await this.requestKeys.runOnce(
        transaction,
        {
          key,
          scope: 'sample.note',
          input: { notebookId: params.notebookId, label: body.label },
        },
        async () => {
          const inserted = await sql<{ id: string }>`
            insert into ${sql.table(KEYED_SAMPLE_TABLE)} (branch_id, label)
            values (${access.branchId}, ${body.label})
            returning id
          `.execute(transaction);
          return { id: inserted.rows[0]?.id ?? '' };
        },
      );
      return once.result;
    });
  }
}
