import { Logger } from '@nestjs/common';
import type { MonitoringConfig } from '../config/config.js';
import { lineOf, type Point } from './influx.js';

/** How long one push may take (`edge/system-behaviour`: only that function fails). */
export const PUSH_TIMEOUT_MS = 5_000;

export type Fetch = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

type GrafanaConfig = NonNullable<MonitoringConfig['grafana']>;

/** A log line for Loki: its moment in milliseconds and its text, with the labels of its stream. */
export interface LogLine {
  at: number;
  level: string;
  text: string;
}

/**
 * The two pushes to Grafana Cloud (task 10.2a, plan decision 8): numbers in Influx line protocol,
 * logs as Loki's JSON. A push that fails or takes longer than 5 seconds is dropped, never tried
 * again in a loop and never awaited by a request; the first failure after a success is logged
 * once (by status, never by what was sent), so a Grafana that is down does not fill the log.
 */
export class GrafanaPush {
  private readonly logger = new Logger('Monitoring');
  private readonly failing = new Set<'metrics' | 'logs'>();

  constructor(
    private readonly config: GrafanaConfig,
    private readonly fetcher: Fetch = (url, init) => fetch(url, init),
  ) {}

  async metrics(points: readonly Point[]): Promise<void> {
    if (points.length === 0) return;
    await this.send('metrics', this.config.metricsUrl, this.config.metricsUser, {
      'Content-Type': 'text/plain; charset=utf-8',
      body: points.map(lineOf).join('\n'),
    });
  }

  async logs(labels: Readonly<Record<string, string>>, lines: readonly LogLine[]): Promise<void> {
    if (lines.length === 0) return;
    // One stream per level, each line's moment in nanoseconds as text.
    const levels = [...new Set(lines.map((line) => line.level))];
    const streams = levels.map((level) => ({
      stream: { ...labels, level },
      values: lines
        .filter((line) => line.level === level)
        .map((line) => [`${String(line.at)}000000`, line.text]),
    }));
    await this.send('logs', this.config.logsUrl, this.config.logsUser, {
      'Content-Type': 'application/json',
      body: JSON.stringify({ streams }),
    });
  }

  private async send(
    kind: 'metrics' | 'logs',
    url: string,
    user: string,
    content: { 'Content-Type': string; body: string },
  ): Promise<void> {
    let status: string;
    try {
      const answer = await this.fetcher(url, {
        method: 'POST',
        headers: {
          'Content-Type': content['Content-Type'],
          Authorization: `Basic ${Buffer.from(`${user}:${this.config.token}`).toString('base64')}`,
        },
        body: content.body,
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
      if (answer.ok) {
        this.failing.delete(kind);
        return;
      }
      status = `answered ${String(answer.status)}`;
    } catch (error) {
      status = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'failed';
    }
    if (!this.failing.has(kind)) {
      this.failing.add(kind);
      this.logger.warn(`The push of ${kind} to Grafana ${status}; dropped until it works again.`);
    }
  }
}
