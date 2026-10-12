import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { MailConfig } from '../config/config.js';

/** One email: the address, the subject and the plain text. */
export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * The mail service (task 2.3c-2, pull request #66). One implementation until
 * go-live, `LogMailer`; the real one (Resend, docs/spec/13-technology.md) is a
 * provider account and comes with the go-live tasks. A mailer that fails
 * throws, and only the function that sends fails (`edge/system-behaviour`).
 */
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export const MAILER = Symbol('MAILER');

/** Where `LogMailer` writes; a test hands in its own to capture the lines. */
export interface MailLog {
  log(message: string): void;
}

/**
 * The owner's answer 16 ("Decided ahead for tasks 2.1 to 2.6"): "until
 * go-live (task 10.4) emails are written to the log only, never sent". The
 * mail goes to the API log under the logger `Mail`, never to the error
 * reports. With `outboxDir` (the browser tests only, refused on a server by
 * the configuration) each mail is also one JSON file there, so a browser test
 * can follow its link. Until go-live the data on every server is invented;
 * this class must be replaced before any real staff email is loaded
 * (correction 3 of the review of #66).
 */
export class LogMailer implements Mailer {
  constructor(
    private readonly outboxDir: string | undefined,
    private readonly log: MailLog = new Logger('Mail'),
  ) {}

  async send(mail: Mail): Promise<void> {
    this.log.log(`To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}`);
    if (this.outboxDir !== undefined) {
      await mkdir(this.outboxDir, { recursive: true });
      // A test finds its mail by the address and takes the newest file.
      await writeFile(join(this.outboxDir, `${randomUUID()}.json`), JSON.stringify(mail));
    }
  }
}

export function mailerOf(config: MailConfig): Mailer {
  return new LogMailer(config.outboxDir);
}

/** The API tests' mailer: keeps the mails, prints nothing, and can be made to fail. */
export class RecordingMailer implements Mailer {
  readonly sent: Mail[] = [];
  failing = false;

  send(mail: Mail): Promise<void> {
    if (this.failing) {
      return Promise.reject(new Error('The mail service did not answer.'));
    }
    this.sent.push(mail);
    return Promise.resolve();
  }
}
