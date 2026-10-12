import { Global, Module } from '@nestjs/common';
import { CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.js';
import { MAILER, mailerOf } from './mailer.js';

/** The mail service for every module (task 2.3c-2). */
@Global()
@Module({
  providers: [
    {
      provide: MAILER,
      useFactory: (config: AppConfig) => mailerOf(config.mail),
      inject: [CONFIG],
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
