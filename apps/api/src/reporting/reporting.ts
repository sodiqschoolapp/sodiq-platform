import * as Sentry from '@sentry/node';
import type { ReportingConfig } from '../config/config.js';

/** Which part of the process a fault that belongs to no request or job came from. */
export type FaultPart = 'live' | 'jobs';

export interface FaultTags {
  requestId?: string;
  /** The name of the job whose run failed. */
  job?: string;
  part?: FaultPart;
}

/** The keys of an event that leave the server. Nothing else does, whatever the SDK adds. */
export const REPORTED_KEYS = [
  'event_id',
  'timestamp',
  'platform',
  'level',
  'environment',
  'release',
  'sdk',
  'exception',
  'tags',
] as const;

/** The tags of a report: the request or the job, and the part. */
const REPORTED_TAGS = ['request_id', 'job', 'part'] as const;

/**
 * What a report holds: the name, message and stack of the error, the request
 * id, and in which environment and release it happened. That is what the log
 * holds (docs/decisions.md, 0.4a), and nothing of a request, a session, a row
 * or the machine (CLAUDE.md: no personal data in error reports). An allow-list,
 * so that a default of the SDK can never add a field.
 */
export function reportedEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const kept: Record<string, unknown> = {};
  for (const key of REPORTED_KEYS) {
    if (key === 'exception' || key === 'tags') {
      continue;
    }
    const value = event[key];
    if (value !== undefined) {
      kept[key] = value;
    }
  }
  if (event.exception?.values !== undefined) {
    kept.exception = {
      values: event.exception.values.map((value) => ({
        ...(value.type === undefined ? {} : { type: value.type }),
        ...(value.value === undefined ? {} : { value: value.value }),
        ...(value.mechanism === undefined ? {} : { mechanism: value.mechanism }),
        ...(value.stacktrace?.frames === undefined
          ? {}
          : {
              stacktrace: {
                // A frame's `vars` would be the local variables of the fault: values of rows.
                frames: value.stacktrace.frames.map(withoutVariables),
              },
            }),
      })),
    };
  }
  const tags: Record<string, string> = {};
  for (const name of REPORTED_TAGS) {
    const value = event.tags?.[name];
    if (typeof value === 'string') {
      tags[name] = value;
    }
  }
  if (Object.keys(tags).length > 0) {
    kept.tags = tags;
  }
  // Built from the keys of the allow-list only. An error event's `type` is
  // `undefined` by definition: the key is absent, as in the test of the keys.
  return kept as unknown as Sentry.ErrorEvent;
}

function withoutVariables(frame: Sentry.StackFrame): Sentry.StackFrame {
  const copy = { ...frame };
  delete copy.vars;
  return copy;
}

export interface ReportingOptions {
  /** For the tests: where the reports go instead of the network. */
  transport?: Sentry.NodeOptions['transport'];
  /**
   * Whether an uncaught exception or an unhandled rejection is reported and
   * then ends the process, as Node does without a handler. Off in the tests.
   */
  processHandlers?: boolean;
}

/**
 * Starts the reports (docs/spec/13-technology.md, Monitoring: Sentry for
 * errors). Without an address nothing is sent and `reportFault` does nothing.
 * No tracing, no breadcrumbs, no request data, no personal data (every
 * default integration off): only what `reportedEvent` keeps leaves the server.
 */
export function startReporting(config: ReportingConfig, options: ReportingOptions = {}): void {
  if (config.dsn === undefined) {
    return;
  }
  const processHandlers = options.processHandlers ?? true;
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    ...(config.release === undefined ? {} : { release: config.release }),
    ...(options.transport === undefined ? {} : { transport: options.transport }),
    defaultIntegrations: false,
    integrations: processHandlers
      ? [
          // Report, then exit as Node does: a process in an unknown state does
          // not go on taking requests. Render starts it again.
          Sentry.onUncaughtExceptionIntegration({ exitEvenIfOtherHandlersAreRegistered: true }),
          Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
        ]
      : [],
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    // The uncaught-exception handler closes with this limit before it exits.
    shutdownTimeout: STOP_LIMIT_MS,
    beforeSend: reportedEvent,
    beforeBreadcrumb: () => null,
  });
}

/**
 * Reports a fault of the server. Called beside every log line of a fault: a
 * 500, a failed job, a fault of the live connection. It never waits for the
 * transport, so a report that cannot be sent delays no answer and no job
 * (`edge/system-behaviour`: a service that is down fails alone).
 */
export function reportFault(error: unknown, tags: FaultTags = {}): void {
  if (!Sentry.isInitialized()) {
    return;
  }
  Sentry.captureException(error, {
    tags: {
      ...(tags.requestId === undefined ? {} : { request_id: tags.requestId }),
      ...(tags.job === undefined ? {} : { job: tags.job }),
      ...(tags.part === undefined ? {} : { part: tags.part }),
    },
  });
}

/** How long a stop waits for the last reports to leave. */
export const STOP_LIMIT_MS = 2000;

/** Sends what is still queued, within the limit, and ends the reports. */
export async function stopReporting(): Promise<void> {
  if (!Sentry.isInitialized()) {
    return;
  }
  await Sentry.close(STOP_LIMIT_MS);
}
