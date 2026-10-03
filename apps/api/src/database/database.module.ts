import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { databaseUrl } from './config.js';
import { createDatabase, type Database } from './database.js';

/** Injection token of the Kysely instance that connects as the application user. */
export const DATABASE = Symbol('DATABASE');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: (): Database => createDatabase(databaseUrl('DATABASE_URL')),
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
