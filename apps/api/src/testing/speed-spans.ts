import type { LogEvent } from 'kysely';

/**
 * Task 10.1b, "measure where the time of each read that missed goes": every query the application
 * sends, summed by its text (the parameters are `$n`, so one text is one query of the code). The
 * speed run resets it before a measure and reads the slowest texts after; what is left of the
 * measure's time is the server's own work (calculation, decoding, waiting). Test code only.
 */
export class QuerySpans {
  private readonly byText = new Map<string, { count: number; ms: number }>();
  /** The parameters of the slowest run of each text (for a plan of it). */
  readonly slowestParameters = new Map<
    string,
    { ms: number; sql: string; parameters: readonly unknown[] }
  >();
  private failed = 0;

  readonly log = (event: LogEvent): void => {
    if (event.level === 'error') this.failed += 1;
    const text = event.query.sql.replace(/\s+/g, ' ').trim();
    const one = this.byText.get(text) ?? { count: 0, ms: 0 };
    one.count += 1;
    one.ms += event.queryDurationMillis;
    const slowest = this.slowestParameters.get(text);
    if (slowest === undefined || slowest.ms < event.queryDurationMillis) {
      this.slowestParameters.set(text, {
        ms: event.queryDurationMillis,
        sql: event.query.sql,
        parameters: event.query.parameters,
      });
    }
    this.byText.set(text, one);
  };

  reset(): void {
    this.byText.clear();
    this.slowestParameters.clear();
    this.failed = 0;
  }

  /** The time of every query, the number of queries, and the `limit` slowest texts by their sum. */
  summary(limit: number): {
    queries: number;
    ms: number;
    slowest: { text: string; count: number; ms: number }[];
  } {
    const all = [...this.byText].map(([text, one]) => ({ text, ...one }));
    return {
      queries: all.reduce((sum, one) => sum + one.count, 0),
      ms: all.reduce((sum, one) => sum + one.ms, 0),
      slowest: all.sort((a, b) => b.ms - a.ms).slice(0, limit),
    };
  }
}
