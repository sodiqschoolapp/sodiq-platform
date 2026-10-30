import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { BRANCH_HEADER, type Clock } from '@sodiq/shared';
import type { NextFunction, Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { CLOCK } from '../clock/clock.module.js';
import { requestIdOf } from '../http/request-id.js';
import { declarationsOf } from '../modules/access/access.decorators.js';
import type { Point } from './otlp.js';
import { DURATION_BOUNDS, MEASUREMENTS } from './series.js';

/**
 * The numbers of answered requests (task 10.2a; owner, 28 October 2026: "the API's request
 * times and answers per route and branch"): per process, one-minute buckets by method, route
 * template, status class and branch. Never the query, a body, a name or the id of a record: the
 * route is Express's matched pattern (`/api/journal/lessons/:lessonId/attendance`), `unmatched`
 * when no route took the request; the branch is the one the permission guard accepted.
 */

const MINUTE_MS = 60_000;

export interface AnsweredRequest {
  method: string;
  route: string;
  status: number;
  branch: string;
  ms: number;
  /** The moment of the answer, from the injected clock. */
  at: Date;
}

interface Bucket {
  minute: number;
  labels: Readonly<Record<string, string>>;
  count: number;
  msSum: number;
  /** Per bound of `DURATION_BOUNDS` and the rest: the answers no longer than it. */
  within: number[];
}

/** What the guard let through, by request: the route's pattern and branch. Not on the request. */
const PASSED = new WeakMap<Request, { route: string; branch: string }>();

/** Answers the route's pattern, or `unmatched` (also for a catch-all such as Nest's `/api*path` of an unknown address). */
function routeOf(request: Request): string {
  const route: unknown = request.route;
  if (route !== null && typeof route === 'object' && 'path' in route) {
    const { path } = route;
    if (typeof path === 'string' && !path.includes('*')) return `${request.baseUrl}${path}`;
  }
  return 'unmatched';
}

/**
 * Runs after the guards, so only for a request a guard let through: on a route that works for
 * the branch of the request, the branch is the header the permission guard read (it refuses any
 * other); a school-wide, public or own-account route has none.
 */
@Injectable()
export class RequestMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const request = context.switchToHttp().getRequest<Request>();
      const [declared] = declarationsOf(context.getHandler());
      const header = request.headers[BRANCH_HEADER.toLowerCase()];
      const branch =
        declared?.kind === 'requires' && declared.branch !== 'none' && typeof header === 'string'
          ? header.toLowerCase()
          : 'none';
      PASSED.set(request, { route: routeOf(request), branch });
    }
    return next.handle();
  }
}

/** One log line of an answered request: nothing of the query, the body or the person. */
export interface RequestLine {
  requestId: string;
  method: string;
  route: string;
  path: string;
  status: number;
  ms: number;
  branch: string;
}

@Injectable()
export class RequestMetrics {
  private buckets = new Map<string, Bucket>();
  private readonly listeners: ((line: RequestLine) => void)[] = [];

  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  /** Called with each request line (the log shipper). */
  onLine(listener: (line: RequestLine) => void): void {
    this.listeners.push(listener);
  }

  /** The middleware that times each request and counts it when its answer is sent. */
  middleware(): (request: Request, response: Response, next: NextFunction) => void {
    return (request, response, next) => {
      const started = process.hrtime.bigint();
      response.on('finish', () => {
        const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
        const passed = PASSED.get(request);
        const route = passed?.route ?? routeOf(request);
        const branch = passed?.branch ?? 'none';
        this.record({
          method: request.method,
          route,
          status: response.statusCode,
          branch,
          ms,
          at: this.clock.now(),
        });
        const line: RequestLine = {
          requestId: requestIdOf(response),
          method: request.method,
          route,
          // The path without its query: the list pattern puts the typed search there.
          path: (request.originalUrl.split('?')[0] ?? '').slice(0, 300),
          status: response.statusCode,
          ms,
          branch,
        };
        for (const listener of this.listeners) listener(line);
      });
      next();
    };
  }

  record(answered: AnsweredRequest): void {
    const minute = Math.floor(answered.at.getTime() / MINUTE_MS) * MINUTE_MS;
    const labels = {
      method: answered.method,
      route: answered.route,
      status: `${String(Math.floor(answered.status / 100))}xx`,
      branch: answered.branch,
    };
    const key = JSON.stringify([minute, labels]);
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = {
        minute,
        labels,
        count: 0,
        msSum: 0,
        within: DURATION_BOUNDS.map(() => 0),
      };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.msSum += answered.ms;
    bucket.within = bucket.within.map((within, index) =>
      answered.ms <= (DURATION_BOUNDS[index] ?? 0) * 1000 ? within + 1 : within,
    );
  }

  /**
   * The points of every minute that has ended by the clock, taken out: each minute is pushed
   * once, as that minute's numbers (plan decision 8: the rules read them with `sum_over_time`).
   */
  takeEnded(common: Readonly<Record<string, string>>): Point[] {
    const now = this.clock.now().getTime();
    const points: Point[] = [];
    for (const [key, bucket] of this.buckets) {
      if (bucket.minute + MINUTE_MS > now) continue;
      this.buckets.delete(key);
      const tags = { ...common, ...bucket.labels };
      points.push({
        measurement: MEASUREMENTS.requests.name,
        tags,
        fields: { count: bucket.count, ms_sum: bucket.msSum },
        at: bucket.minute,
      });
      DURATION_BOUNDS.forEach((bound, index) => {
        points.push({
          measurement: MEASUREMENTS.requestDuration.name,
          tags: { ...tags, le: String(bound) },
          fields: { bucket: bucket.within[index] ?? 0 },
          at: bucket.minute,
        });
      });
      points.push({
        measurement: MEASUREMENTS.requestDuration.name,
        tags: { ...tags, le: '+Inf' },
        fields: { bucket: bucket.count },
        at: bucket.minute,
      });
    }
    return points;
  }
}
