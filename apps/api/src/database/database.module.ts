import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.js';
import { createDatabase, type Database } from './database.js';
import { DATABASE } from './database.tokens.js';
import { RequestKeys } from './request-keys.js';
import { Transactions } from './transactions.js';

// The token lives in its own file so that the services of this module can
// import it without importing the module.
export { DATABASE };

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [CONFIG],
      useFactory: (config: AppConfig): Database => createDatabase(config.databaseUrl),
    },
    Transactions,
    RequestKeys,
  ],
  exports: [DATABASE, Transactions, RequestKeys],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.destroy();
  }
}
