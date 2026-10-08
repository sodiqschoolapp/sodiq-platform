import * as Sentry from '@sentry/browser';

/** The keys of an event that leave the browser. Nothing else does, whatever the SDK adds. */
export const REPORTED_KEYS = [
  'event_id',
  'timestamp',
  'platform',
  'level',
  'environment',
  'release',
  'sdk',
  'exception',
  'request',
] as const;

export interface ReportingSettings {
  dsn: string | undefined;
  environment: string;
  release: string | undefined;
}

/** The address of a page without its query and hash: the list pattern puts the typed search there. */
export function pageOf(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

/**
 * What a report of the web app holds: the name, message and stack of the
 * error, the page it happened on (its path only), and the environment and
 * release. Nothing of the person, the session, the headers, the typed
 * search or what the page showed (CLAUDE.md: no personal data in error
 * reports). An allow-list, so that a default of the SDK can never add a field.
 */
export function reportedEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const kept: Record<string, unknown> = {};
  for (const key of REPORTED_KEYS) {
    if (key === 'exception' || key === 'request') {
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
                // A frame's `vars` would be the local variables of the fault: what the page showed.
                frames: value.stacktrace.frames.map(withoutVariables),
              },
            }),
      })),
    };
  }
  if (typeof event.request?.url === 'string') {
    kept.request = { url: pageOf(event.request.url) };
  }
  // An error event's `type` is `undefined` by definition: the key is absent.
  return kept as unknown as Sentry.ErrorEvent;
}

function withoutVariables(frame: Sentry.StackFrame): Sentry.StackFrame {
  const copy = { ...frame };
  delete copy.vars;
  return copy;
}

/**
 * Starts the reports (docs/spec/13-technology.md, Monitoring: Sentry for
 * errors). Without an address nothing is sent. No tracing, no replay, no
 * breadcrumbs, and only two integrations: the global handlers (an error or a
 * rejection nobody caught) and the one that drops a repeat of the last event.
 */
export function startReporting(settings: ReportingSettings): void {
  if (settings.dsn === undefined || settings.dsn === '') {
    return;
  }
  Sentry.init({
    dsn: settings.dsn,
    environment: settings.environment,
    ...(settings.release === undefined || settings.release === ''
      ? {}
      : { release: settings.release }),
    defaultIntegrations: false,
    integrations: [Sentry.globalHandlersIntegration(), Sentry.dedupeIntegration()],
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    beforeSend: reportedEvent,
    beforeBreadcrumb: () => null,
  });
}

/** Reports a fault the app caught itself, for example one that React caught while drawing. */
export function reportFault(error: unknown): void {
  if (!Sentry.isInitialized()) {
    return;
  }
  Sentry.captureException(error);
}

/**
 * The options of React's root that report what it catches: a fault while
 * drawing that no boundary caught, and one a boundary caught (the page's
 * error state). React 19 calls them with the error and where it happened.
 */
export function rootOptions(report: (error: unknown) => void = reportFault) {
  // As React's own defaults: the fault is printed too, so a laptop without a
  // DSN still shows it in the console.
  return {
    onUncaughtError: (error: unknown) => {
      console.error(error);
      report(error);
    },
    onCaughtError: (error: unknown) => {
      console.error(error);
      report(error);
    },
  };
}

/** The settings of this build, from Vite's environment at build time. */
export function buildSettings(): ReportingSettings {
  return {
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? 'development',
    release: import.meta.env.VITE_RELEASE,
  };
}
