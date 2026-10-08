import { setTimeout as delay } from 'node:timers/promises';
import { Inject, Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import { NOTIFICATION_MESSAGES, type Notification } from '@sodiq/shared';
import { Client } from 'pg';
import { CONFIG } from '../../../config/config.module.js';
import type { AppConfig } from '../../../config/config.js';
import { Transactions } from '../../../database/transactions.js';
import { reportFault } from '../../../reporting/reporting.js';
import { readItems, type OwnedItem } from '../notifications.service.js';
import { LIVE_CHANNEL, livePayloadSchema } from './live-payload.js';
import { LiveSockets, nameOf } from './socket-server.js';

/** How long the listener waits before it connects again after its connection dropped. */
const RECONNECT_MS = 1000;

/**
 * One dedicated connection of the API process that listens on the channel
 * (`LISTEN`; Kysely cannot) and pushes what it hears to the connected tabs.
 * What was missed while the connection was down is not lost: the rows are in
 * the table, and every tab that connects again gets the state
 * (`edge/system-behaviour`: "Nothing that cannot be rebuilt lives only in the
 * job queue"). Log lines hold ids and counts only, never the data.
 */
@Injectable()
export class LiveListener implements BeforeApplicationShutdown {
  private readonly logger = new Logger('Live');
  private client: Client | undefined;
  private connectionString: string | undefined;
  private stopped = false;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly transactions: Transactions,
    private readonly sockets: LiveSockets,
  ) {}

  /** Connects and listens. The address of the database of the application unless the tests give theirs. */
  async start(connectionString: string = this.config.databaseUrl): Promise<void> {
    this.connectionString = connectionString;
    this.stopped = false;
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connectionString === undefined) {
      return;
    }
    const client = new Client({
      connectionString: this.connectionString,
      application_name: 'sodiq-api-live',
    });
    client.on('notification', (message) => {
      void this.hear(message.payload ?? '');
    });
    client.on('error', (error) => {
      this.logger.error(`The live connection failed: ${nameOf(error)}`);
      reportFault(error, { part: 'live' });
    });
    client.on('end', () => {
      if (this.client === client) {
        this.client = undefined;
        this.logger.warn('The live connection ended; connecting again.');
        void delay(RECONNECT_MS).then(() => this.connect());
      }
    });
    try {
      await client.connect();
      await client.query(`listen ${LIVE_CHANNEL}`);
    } catch (error) {
      this.logger.error(`The live connection could not be made: ${nameOf(error)}`);
      reportFault(error, { part: 'live' });
      await client.end().catch(() => undefined);
      void delay(RECONNECT_MS).then(() => this.connect());
      return;
    }
    this.client = client;
  }

  /** One payload of the channel. A payload that cannot be read is logged and dropped. */
  async hear(text: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.logger.error('A live payload was not JSON.');
      return;
    }
    const payload = livePayloadSchema.safeParse(parsed);
    if (!payload.success) {
      this.logger.error('A live payload did not fit its schema.');
      return;
    }
    const heard = payload.data;
    try {
      switch (heard.kind) {
        case 'new': {
          const owned = await this.transactions.run([], (transaction) =>
            readItems(transaction, heard.ids),
          );
          await this.pushNew(owned);
          break;
        }
        case 'read':
          await this.sockets.tell(heard.accountId, NOTIFICATION_MESSAGES.read, {
            ids: heard.ids,
            readAt: heard.readAt,
          });
          break;
        case 'read_all':
          await this.sockets.tell(heard.accountId, NOTIFICATION_MESSAGES.readAll, {
            readAt: heard.readAt,
          });
          break;
      }
    } catch (error) {
      this.logger.error(`A live payload (${heard.kind}) could not be pushed: ${nameOf(error)}`);
      reportFault(error, { part: 'live' });
    }
  }

  /** Each account gets its own items, and only those. */
  private async pushNew(owned: OwnedItem[]): Promise<void> {
    const byAccount = new Map<string, Notification[]>();
    for (const { accountId, item } of owned) {
      byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), item]);
    }
    for (const [accountId, items] of byAccount) {
      await this.sockets.tell(accountId, NOTIFICATION_MESSAGES.new, { items });
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    const client = this.client;
    this.client = undefined;
    if (client !== undefined) {
      await client.end().catch(() => undefined);
    }
  }
}
