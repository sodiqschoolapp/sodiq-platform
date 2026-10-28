import {
  ConsoleLogger,
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { CLOCK } from '../clock/clock.module.js';
import { CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.js';
import { GrafanaPush, type Fetch, type LogLine } from './grafana.js';
import type { Point } from './influx.js';
import { RequestMetrics, type RequestLine } from './request-metrics.js';
import { MEASUREMENTS } from './series.js';

/** Which process this is: the API or the jobs worker. */
export const MONITORING_SERVICE = Symbol('MONITORING_SERVICE');
/** For the tests: what sends the pushes instead of the network. */
export const MONITORING_FETCH = Symbol('MONITORING_FETCH');

export type MonitoredService = 'api' | 'worker';

const NUMBERS_EVERY_MS = 60_000;
const LOGS_EVERY_MS = 10_000;
/** Lines kept while Grafana does not take them; the oldest go first. */
const MAX_WAITING_LINES = 5_000;

/**
 * The numbers and the logs of this process to Grafana Cloud (task 10.2a): every minute the
 * ended minutes of the requests and a heartbeat, every 10 seconds the log lines. Without the
 * configuration nothing is pushed or kept, and no timer runs.
 */
@Injectable()
export class Monitoring implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly grafana: GrafanaPush | undefined;
  private readonly onServer: boolean;
  private waiting: LogLine[] = [];
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MONITORING_SERVICE) private readonly service: MonitoredService,
    @Inject(MONITORING_FETCH) fetcher: Fetch | undefined,
    private readonly requests: RequestMetrics,
  ) {
    const grafana = config.monitoring.grafana;
    this.grafana = grafana === undefined ? undefined : new GrafanaPush(grafana, fetcher);
    this.onServer = config.monitoring.instance !== 'local';
    this.requests.onLine((line) => {
      this.requestLine(line);
    });
    ShippingLogger.sink = (level, text) => {
      this.keep(level, text);
    };
  }

  /** Whether anything is pushed. */
  get pushing(): boolean {
    return this.grafana !== undefined;
  }

  /** The labels every series and log stream of this process carries. */
  get common(): Record<string, string> {
    return { service: this.service, instance: this.config.monitoring.instance };
  }

  onApplicationBootstrap(): void {
    if (this.grafana === undefined) return;
    const every = (ms: number, work: () => Promise<void>) => {
      const timer = setInterval(() => {
        void work();
      }, ms);
      // A timer never keeps a stopping process alive.
      timer.unref();
      this.timers.push(timer);
    };
    every(NUMBERS_EVERY_MS, () => this.pushNumbers());
    every(LOGS_EVERY_MS, () => this.shipLogs());
  }

  async onApplicationShutdown(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    await this.shipLogs();
  }

  /** The ended minutes of the requests and the heartbeat of this process. */
  async pushNumbers(): Promise<void> {
    if (this.grafana === undefined) return;
    const heartbeat: Point = {
      measurement: MEASUREMENTS.process.name,
      tags: this.common,
      fields: { up: 1 },
      at: this.clock.now().getTime(),
    };
    await this.grafana.metrics([heartbeat, ...this.requests.takeEnded(this.common)]);
  }

  /** Points of another part of the process (the counts job), with this process's labels. */
  async push(points: readonly Point[]): Promise<void> {
    if (this.grafana === undefined) return;
    await this.grafana.metrics(
      points.map((point) => ({ ...point, tags: { ...this.common, ...point.tags } })),
    );
  }

  async shipLogs(): Promise<void> {
    if (this.grafana === undefined || this.waiting.length === 0) return;
    const lines = this.waiting;
    this.waiting = [];
    await this.grafana.logs(this.common, lines);
  }

  private requestLine(line: RequestLine): void {
    const text = JSON.stringify({ kind: 'request', ...line });
    // On a server the line is also in the service's own log, as the other lines are.
    if (this.onServer) process.stdout.write(`${text}\n`);
    this.keep('info', text);
  }

  private keep(level: string, text: string): void {
    if (this.grafana === undefined) return;
    this.waiting.push({ at: this.clock.now().getTime(), level, text });
    if (this.waiting.length > MAX_WAITING_LINES) {
      this.waiting.splice(0, this.waiting.length - MAX_WAITING_LINES);
    }
  }
}

/**
 * The logger of the process (`app.useLogger` in `main.ts` and `worker.ts`): writes as Nest's
 * own, and hands each line, as written, to the shipper (owner, 28 October 2026: the logs, under
 * the rule of the error reports; the lines are the ones the log already holds).
 */
export class ShippingLogger extends ConsoleLogger {
  static sink: ((level: string, text: string) => void) | undefined;

  override log(message: unknown, ...rest: unknown[]): void {
    super.log(message, ...rest);
    ShippingLogger.ship('info', message, rest);
  }

  override warn(message: unknown, ...rest: unknown[]): void {
    super.warn(message, ...rest);
    ShippingLogger.ship('warn', message, rest);
  }

  override error(message: unknown, ...rest: unknown[]): void {
    super.error(message, ...rest);
    ShippingLogger.ship('error', message, rest);
  }

  /** The message, the stack of an error line and the context, as text. */
  static ship(level: string, message: unknown, rest: readonly unknown[]): void {
    const texts = [message, ...rest].filter((part) => typeof part === 'string');
    ShippingLogger.sink?.(level, texts.join(' '));
  }
}
