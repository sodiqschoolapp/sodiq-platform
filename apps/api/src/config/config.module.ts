import { Global, Module } from '@nestjs/common';
import { loadConfig, type AppConfig } from './config.js';

/** Injection token of the checked configuration (`AppConfig`). */
export const CONFIG = Symbol('CONFIG');

@Global()
@Module({
  providers: [
    {
      provide: CONFIG,
      useFactory: (): AppConfig => loadConfig(process.env),
    },
  ],
  exports: [CONFIG],
})
export class ConfigModule {}
