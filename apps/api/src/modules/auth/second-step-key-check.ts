import { Injectable } from '@nestjs/common';
import { Transactions } from '../../database/transactions.js';
import { SecondStepSecrets } from './second-step-secrets.js';

/** The key of this start does not open what is stored. It never holds the key or a secret. */
export class SecondStepKeyError extends Error {
  constructor() {
    super(
      'SECOND_STEP_KEY does not decrypt the oldest stored secret of the second step. ' +
        'Start with the key the secrets were encrypted with. With another key every person ' +
        'who gives a code would lose the second step and set up a new one with the password alone.',
    );
  }
}

/**
 * Asked for by the owner (task 0.6c): the API and the worker refuse to start
 * with a key that does not open the stored secrets. Without this, a wrong key
 * on a server would turn every second step into "set up required", one person
 * after the other (`TwoStep`, a secret that cannot be decrypted). That path
 * stays for the rare single row that is damaged.
 *
 * The entry points call `run` before they take requests or jobs (`main.ts`,
 * `worker.ts`). It is not a start hook of the module: `pnpm api:client` builds
 * the application without a database and must not ask it anything.
 */
@Injectable()
export class SecondStepKeyCheck {
  constructor(
    private readonly transactions: Transactions,
    private readonly secrets: SecondStepSecrets,
  ) {}

  /** Throws `SecondStepKeyError` when the oldest stored secret cannot be decrypted. No row, no check. */
  async run(): Promise<void> {
    const oldest = await this.transactions.run([], (transaction) =>
      transaction
        .selectFrom('account_second_steps')
        .select(['account_id', 'secret'])
        .orderBy('created_at')
        .orderBy('account_id')
        .limit(1)
        .executeTakeFirst(),
    );
    if (oldest !== undefined && this.secrets.open(oldest.account_id, oldest.secret) === undefined) {
      throw new SecondStepKeyError();
    }
  }
}
