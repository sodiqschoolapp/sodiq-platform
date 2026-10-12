import type { Server } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Logger, type INestApplication } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestKeys } from '../database/request-keys.js';
import { Transactions } from '../database/transactions.js';
import { JobQueue } from '../jobs/job-queue.js';
import { JobRunner } from '../jobs/job-runner.js';
import { Jobs } from '../jobs/jobs.service.js';
import { LiveListener } from '../modules/notifications/live/listener.js';
import { LiveSockets } from '../modules/notifications/live/socket-server.js';
import { insertBranch } from '../testing/branch-filter-sql.js';
import { createTestApp } from '../testing/create-test-app.js';
import { FixedClock } from '../testing/fixed-clock.js';
import { createScratchNotes, sampleJob, waitForJob } from '../testing/sample-job.js';
import { SAMPLE_ROW_VALUE, SAMPLE_SECRET, SampleController } from '../testing/sample.controller.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import {
  REPORTED_KEYS,
  reportedEvent,
  reportFault,
  startReporting,
  STOP_LIMIT_MS,
  stopReporting,
} from './reporting.js';

// Invented: the shape of a Sentry address, pointing nowhere.
const DSN = 'https://0123456789abcdef@o0.ingest.sentry.example/1';
const COOKIE = 'sodiq_session=a-session-token-that-must-not-leave';
const INVENTED_PERSON = 'Nodira Rasulova';

/** An event as the SDK could build it, with everything that must not leave. */
function fullEvent(): Sentry.ErrorEvent {
  return {
    type: undefined,
    event_id: 'e1',
    timestamp: 1_760_000_000,
    platform: 'node',
    level: 'error',
    environment: 'test',
    release: 'abc123',
    sdk: { name: 'sentry.javascript.node', version: '0.0.0' },
    server_name: 'srv-abc',
    transaction: 'POST /api/people',
    logger: 'x',
    dist: '1',
    modules: { pg: '8.0.0' },
    fingerprint: ['x'],
    breadcrumbs: [{ message: `select * from people where name = '${INVENTED_PERSON}'` }],
    contexts: { os: { name: 'linux' }, runtime: { name: 'node' } },
    extra: { row: { name: INVENTED_PERSON } },
    user: { id: 'account-1', ip_address: '10.0.0.1' },
    request: {
      url: `https://app-test.example/api/people?search=${encodeURIComponent(INVENTED_PERSON)}`,
      method: 'POST',
      headers: { cookie: COOKIE, 'x-request-id': 'r1' },
      data: { firstName: 'Nodira', lastName: 'Rasulova' },
      cookies: { sodiq_session: 'a-session-token-that-must-not-leave' },
    },
    tags: { request_id: 'r1', job: 'sample.note', part: 'live', hostname: 'srv-abc' },
    exception: {
      values: [
        {
          type: 'Error',
          value: 'invalid input syntax for type date',
          mechanism: { type: 'generic', handled: true },
          stacktrace: {
            frames: [
              {
                filename: 'people.service.js',
                function: 'create',
                lineno: 10,
                vars: { person: INVENTED_PERSON },
              },
            ],
          },
        },
      ],
    },
  };
}

/** Records what would be sent; `flush` behaves as the real transport's. */
function recordingTransport() {
  const events: Sentry.ErrorEvent[] = [];
  const transport: Sentry.NodeOptions['transport'] = () => ({
    send: (envelope) => {
      const [, items] = envelope;
      for (const [header, payload] of items as [{ type: string }, unknown][]) {
        if (header.type === 'event') {
          events.push(payload as Sentry.ErrorEvent);
        }
      }
      return Promise.resolve({});
    },
    flush: () => Promise.resolve(true),
  });
  return { events, transport };
}

/** A transport that never answers: the network is away. */
function hangingTransport(): Sentry.NodeOptions['transport'] {
  return (options) => Sentry.createTransport(options, () => new Promise<never>(() => undefined));
}

/** Waits for the SDK to hand the events to the transport. */
async function sent(events: Sentry.ErrorEvent[], count: number): Promise<Sentry.ErrorEvent[]> {
  for (let attempt = 0; attempt < 40 && events.length < count; attempt += 1) {
    await delay(50);
  }
  return events;
}

function silenceLog() {
  return vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
}

// docs/spec/13-technology.md, Monitoring: Sentry for errors. docs/decisions.md,
// 0.4a: a fault is logged with the request id and the name, message and stack
// of the error only; Sentry must keep to the same rule. CLAUDE.md: no personal
// data in logs or error reports.
describe('what a report holds', () => {
  it('keeps exactly the allowed keys, whatever the SDK added', () => {
    const kept = reportedEvent(fullEvent());

    expect(Object.keys(kept).sort()).toEqual([...REPORTED_KEYS].sort());
    expect(Object.keys(fullEvent()).length).toBeGreaterThan(REPORTED_KEYS.length);
  });

  it('keeps the name, message and stack of the error, and the frames without their variables', () => {
    const kept = reportedEvent(fullEvent());

    expect(kept.exception).toEqual({
      values: [
        {
          type: 'Error',
          value: 'invalid input syntax for type date',
          mechanism: { type: 'generic', handled: true },
          stacktrace: {
            frames: [{ filename: 'people.service.js', function: 'create', lineno: 10 }],
          },
        },
      ],
    });
  });

  it('keeps the tags of the request, the job and the part, and no other', () => {
    expect(reportedEvent(fullEvent()).tags).toEqual({
      request_id: 'r1',
      job: 'sample.note',
      part: 'live',
    });
    expect(reportedEvent({ ...fullEvent(), tags: { hostname: 'srv-abc' } })).not.toHaveProperty(
      'tags',
    );
  });

  it('leaves nothing of the request, the session, the person or the machine', () => {
    const text = JSON.stringify(reportedEvent(fullEvent()));

    for (const secret of [
      INVENTED_PERSON,
      'Nodira',
      'sodiq_session',
      'a-session-token',
      'account-1',
      '10.0.0.1',
      'srv-abc',
      'app-test.example',
      'select *',
      'linux',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('keeps the environment and the release, so a fault names its version', () => {
    expect(reportedEvent(fullEvent())).toMatchObject({ environment: 'test', release: 'abc123' });
  });
});

describe('the reports of the server', () => {
  const recorded = recordingTransport();

  beforeAll(() => {
    startReporting(
      { dsn: DSN, environment: 'test', release: 'abc123' },
      { transport: recorded.transport, processHandlers: false },
    );
  });

  afterEach(() => {
    recorded.events.splice(0);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await stopReporting();
  });

  describe('of a job and of the live connection', () => {
    let database: TestDatabase;
    let transactions: Transactions;
    let queue: JobQueue;
    let runner: JobRunner;
    let north: string;
    const clock = new FixedClock('2026-10-09T09:00:00+05:00');

    beforeAll(async () => {
      database = await createTestDatabase();
      transactions = new Transactions(database.app, clock);
      north = await insertBranch(database.migrator, 'North');
      await createScratchNotes(database.migrator);
      queue = new JobQueue(
        { connectionString: database.appUrl, worker: true, pollingIntervalSeconds: 0.5 },
        [sampleJob],
      );
      runner = new JobRunner(queue, transactions, new RequestKeys(clock), [sampleJob]);
      runner.handle(sampleJob, () => Promise.reject(new Error('The run failed.')));
      await runner.start();
    });

    afterAll(async () => {
      await queue.beforeApplicationShutdown();
      await database.destroy();
    });

    it('reports a failed job with its name', async () => {
      silenceLog();
      const noteId = '00000000-0000-4000-8000-000000000001';
      await sql`insert into scratch_notes (id, branch_id) values (${noteId}, ${north})`.execute(
        database.migrator,
      );
      const jobs = new Jobs(queue, [sampleJob]);
      const id = await transactions.run([north], (transaction) =>
        jobs.enqueue(transaction, sampleJob, { branchIds: [north], data: { noteId } }),
      );

      await waitForJob(database.migrator, id, 'failed');
      const [event] = await sent(recorded.events, 1);
      expect(event?.tags).toEqual({ job: 'sample.note' });
      expect(event?.exception?.values?.[0]).toMatchObject({ value: 'The run failed.' });
    });

    it('reports a live connection that could not be made, as part "live"', async () => {
      silenceLog();
      const listener = new LiveListener(
        { trustProxy: false } as never,
        transactions,
        {} as LiveSockets,
      );
      // A port where nothing listens: refused at once.
      await listener.start('postgres://sodiq_app:x@127.0.0.1:1/nothing');
      await listener.beforeApplicationShutdown();

      const [event] = await sent(recorded.events, 1);
      expect(event?.tags).toEqual({ part: 'live' });
    });
  });
  // Last: closing its application stops the reports (ReportingModule), as a stop of the server does.
  describe('of a request', () => {
    let app: INestApplication;
    let server: Server;

    beforeAll(async () => {
      app = await createTestApp({
        clock: new FixedClock('2026-10-09T09:00:00+05:00'),
        controllers: [SampleController],
      });
      server = app.getHttpServer() as Server;
    });

    afterAll(async () => {
      await app.close();
    });

    it('reports a fault (500) with the request id, as the log does', async () => {
      silenceLog();
      const response = await request(server).get('/api/sample/fault').set('Cookie', COOKIE);

      expect(response.status).toBe(500);
      const [event] = await sent(recorded.events, 1);
      expect(event?.tags).toEqual({ request_id: response.headers['x-request-id'] });
      expect(event?.exception?.values?.[0]).toMatchObject({ type: 'Error', value: SAMPLE_SECRET });
      expect(event?.exception?.values?.[0]?.stacktrace?.frames?.length).toBeGreaterThan(0);
      // The other fields of the error (the row's values) and the request never leave.
      const text = JSON.stringify(event);
      expect(text).not.toContain(SAMPLE_ROW_VALUE);
      expect(text).not.toContain('sodiq_session');
      expect(event).not.toHaveProperty('request');
      expect(
        Object.keys(event ?? {}).every((key) => (REPORTED_KEYS as readonly string[]).includes(key)),
      ).toBe(true);
    });

    it('reports nothing for a refused request', async () => {
      silenceLog();
      await request(server).get('/api/sample/refused');
      await request(server).get('/api/sample?limit=1000');
      await request(server).get('/api/no-such-route');
      await delay(200);

      expect(recorded.events).toEqual([]);
    });
  });
});

describe('a network that never answers', () => {
  let log: ReturnType<typeof silenceLog>;

  beforeAll(() => {
    log = silenceLog();
  });

  // Again for each test: the stop of the application in the first one ends the reports.
  beforeEach(() => {
    startReporting(
      { dsn: DSN, environment: 'test', release: undefined },
      { transport: hangingTransport(), processHandlers: false },
    );
  });

  afterAll(async () => {
    await stopReporting();
    log.mockRestore();
  });

  it('delays no answer: a fault is still answered at once', async () => {
    const app = await createTestApp({ controllers: [SampleController] });
    try {
      const started = performance.now();
      const response = await request(app.getHttpServer()).get('/api/sample/fault');

      expect(response.status).toBe(500);
      expect(performance.now() - started).toBeLessThan(STOP_LIMIT_MS);
    } finally {
      await app.close();
    }
  });

  it('delays no caller of reportFault', () => {
    const started = performance.now();
    reportFault(new Error('invented'), { part: 'jobs' });

    expect(performance.now() - started).toBeLessThan(100);
  });

  it('is given up within the limit at a stop', async () => {
    reportFault(new Error('invented'), { part: 'jobs' });
    const started = performance.now();

    await stopReporting();

    expect(performance.now() - started).toBeLessThan(STOP_LIMIT_MS + 1000);
  });

  // Owner's correction f: an uncaught exception is reported and the process
  // exits, as Node does without a handler; a network that never answers
  // delays the exit by the limit at most. The handler is taken from the
  // process and called directly, with the exit stubbed, so the test process
  // itself goes on.
  it('exits the process after an uncaught exception, within the limit', async () => {
    const before = new Set(process.listeners('uncaughtException'));
    const rejectionsBefore = new Set(process.listeners('unhandledRejection'));
    startReporting(
      { dsn: DSN, environment: 'test', release: undefined },
      { transport: hangingTransport(), processHandlers: true },
    );
    const handlers = process.listeners('uncaughtException').filter((h) => !before.has(h));
    const rejectionHandlers = process
      .listeners('unhandledRejection')
      .filter((h) => !rejectionsBefore.has(h));
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(handlers).toHaveLength(1);
      expect(rejectionHandlers).toHaveLength(1);
      const started = performance.now();

      handlers[0]?.(new Error('invented, uncaught'), 'uncaughtException');
      for (let attempt = 0; attempt < 100 && exit.mock.calls.length === 0; attempt += 1) {
        await delay(50);
      }

      expect(exit).toHaveBeenCalledWith(1);
      expect(performance.now() - started).toBeLessThan(STOP_LIMIT_MS + 1000);
    } finally {
      for (const handler of handlers) {
        process.removeListener('uncaughtException', handler);
      }
      for (const handler of rejectionHandlers) {
        process.removeListener('unhandledRejection', handler);
      }
      exit.mockRestore();
      consoleError.mockRestore();
    }
  });
});
