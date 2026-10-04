import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.js';
import { createDatabase, type Database } from './database.js';

/** Injection token of the Kysely instance that connects as the application user. */
export const DATABASE = Symbol('DATABASE');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [CONFIG],
      useFactory: (config: AppConfig): Database => createDatabase(config.databaseUrl),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.destroy();
  }
}
