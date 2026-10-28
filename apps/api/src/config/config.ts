import { z } from 'zod';

/** A variable that is set but empty counts as not set. */
const emptyAsUnset = (value: unknown): unknown => (value === '' ? undefined : value);

/** 32 bytes in base64 are 43 characters and one `=`. */
const KEY_OF_32_BYTES = /^[A-Za-z0-9+/]{43}=$/;

const environmentSchema = z.object({
  // The API answers only on this machine unless the server sets HOST (task 0.10).
  HOST: z.preprocess(emptyAsUnset, z.string().default('127.0.0.1')),
  PORT: z.preprocess(emptyAsUnset, z.coerce.number().int().min(1).max(65535).default(3000)),
  DATABASE_URL: z.preprocess(emptyAsUnset, z.url({ protocol: /^postgres(ql)?$/ })),
  // The key that encrypts the secrets of the second step of sign-in (task 0.6c).
  SECOND_STEP_KEY: z.preprocess(
    emptyAsUnset,
    z
      .string()
      .regex(KEY_OF_32_BYTES)
      .refine((value) => Buffer.from(value, 'base64').length === 32),
  ),
  // Behind Render's load balancer, which ends TLS (task 0.10): `1` trusts the
  // first hop's `X-Forwarded-Proto`; unset or `0` trusts nothing (a laptop, CI).
  TRUST_PROXY: z.preprocess(emptyAsUnset, z.enum(['0', '1']).default('0')),
  // The directory of the web app's built files, which the API then serves on
  // its own origin (task 0.10). Unset: the API serves no files (Vite does).
  WEB_FILES: z.preprocess(emptyAsUnset, z.string().optional()),
  // The Chromium that makes the PDFs (task 5.9c-1, decision 4). Unset: the
  // one playwright-core installs; none there: the PDF routes answer
  // `pdf_unavailable` and everything else works.
  CHROMIUM_PATH: z.preprocess(emptyAsUnset, z.string().optional()),
  // Error reports (task 0.10). Unset: none are sent.
  SENTRY_DSN: z.preprocess(emptyAsUnset, z.url({ protocol: /^https?$/ }).optional()),
  SENTRY_ENVIRONMENT: z.preprocess(emptyAsUnset, z.string().default('development')),
  // Set by Render at build and start: the commit of the running version.
  RENDER_GIT_COMMIT: z.preprocess(emptyAsUnset, z.string().optional()),
  // The R2 bucket of the photos (task 2.2c-2; the owner's answer 2, these
  // exact names). All four or none; the owner enters them in Render. None:
  // the photo routes answer `photos_not_configured` and everything else works.
  R2_ACCOUNT_ID: z.preprocess(
    emptyAsUnset,
    z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
  ),
  R2_ACCESS_KEY_ID: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
  R2_SECRET_ACCESS_KEY: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
  R2_BUCKET: z.preprocess(
    emptyAsUnset,
    z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)
      .optional(),
  ),
  // A laptop and the browser tests' server only (decision 9 of pull request
  // #59): `1` keeps photos in memory, lost on a restart. Never on Render.
  PHOTOS_IN_MEMORY: z.preprocess(emptyAsUnset, z.enum(['0', '1']).default('0')),
  // The address of the web app, for the links in emails (task 2.3c-2,
  // decision 15 of #66): never taken from a request's Host or Origin, which
  // the caller chooses. An origin only: scheme, host and port.
  WEB_ORIGIN: z.preprocess(
    emptyAsUnset,
    z
      .url({ protocol: /^https?$/ })
      .refine((value) => new URL(value).origin === value)
      .default('http://localhost:5173'),
  ),
  // The browser tests only (decision 14 of #66): each mail is also written as
  // a file into this directory, so a test can follow its link. Refused on a
  // Render service.
  MAIL_OUTBOX_DIR: z.preprocess(emptyAsUnset, z.string().optional()),
  // Grafana Cloud (task 10.2a; docs/monitoring.md): the push addresses of the
  // numbers (Influx line protocol) and of the logs (Loki), the user of each,
  // and one token that may write both. All five or none; none: nothing is
  // pushed or shipped and everything else works.
  GRAFANA_METRICS_URL: z.preprocess(emptyAsUnset, z.url({ protocol: /^https?$/ }).optional()),
  GRAFANA_METRICS_USER: z.preprocess(emptyAsUnset, z.string().regex(/^\d{1,20}$/).optional()),
  GRAFANA_LOGS_URL: z.preprocess(emptyAsUnset, z.url({ protocol: /^https?$/ }).optional()),
  GRAFANA_LOGS_USER: z.preprocess(emptyAsUnset, z.string().regex(/^\d{1,20}$/).optional()),
  GRAFANA_TOKEN: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
  // Set by Render on each instance of a service: which server a number came from.
  RENDER_INSTANCE_ID: z.preprocess(emptyAsUnset, z.string().max(100).optional()),
});

const R2_VARIABLES = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
] as const;

const GRAFANA_VARIABLES = [
  'GRAFANA_METRICS_URL',
  'GRAFANA_METRICS_USER',
  'GRAFANA_LOGS_URL',
  'GRAFANA_LOGS_USER',
  'GRAFANA_TOKEN',
] as const;

type VariableName = keyof z.infer<typeof environmentSchema>;

/** What to tell the person who starts the API. It never repeats the value. */
const PROBLEM: Record<VariableName, string> = {
  HOST: 'HOST must be a host name or an address',
  PORT: 'PORT must be a whole number from 1 to 65535',
  DATABASE_URL:
    'DATABASE_URL must be set to a postgres:// address (on a developer machine: copy .env.example to .env, see README.md, Setup)',
  SECOND_STEP_KEY:
    'SECOND_STEP_KEY must be set to 32 random bytes in base64 (on a developer machine: copy the line from .env.example to .env)',
  TRUST_PROXY: 'TRUST_PROXY must be 0 or 1',
  WEB_FILES: 'WEB_FILES must be a directory',
  CHROMIUM_PATH: 'CHROMIUM_PATH must be the path of a Chromium program, or unset',
  SENTRY_DSN: 'SENTRY_DSN must be an https:// address, or unset',
  SENTRY_ENVIRONMENT: 'SENTRY_ENVIRONMENT must be a name',
  RENDER_GIT_COMMIT: 'RENDER_GIT_COMMIT must be a commit',
  R2_ACCOUNT_ID:
    'R2_ACCOUNT_ID must be the 32-letter account id of Cloudflare, set with the three other R2 variables',
  R2_ACCESS_KEY_ID: 'R2_ACCESS_KEY_ID must be set with the three other R2 variables',
  R2_SECRET_ACCESS_KEY: 'R2_SECRET_ACCESS_KEY must be set with the three other R2 variables',
  R2_BUCKET: 'R2_BUCKET must be a bucket name, set with the three other R2 variables',
  PHOTOS_IN_MEMORY:
    'PHOTOS_IN_MEMORY must be 0 or 1, and is never set together with the R2 variables',
  WEB_ORIGIN:
    'WEB_ORIGIN must be the address of the web app, for example https://app.example.test, with no path',
  MAIL_OUTBOX_DIR:
    'MAIL_OUTBOX_DIR is for the browser tests only and is never set on a server (with RENDER_GIT_COMMIT, TRUST_PROXY=1 or WEB_FILES)',
  GRAFANA_METRICS_URL:
    'GRAFANA_METRICS_URL must be the https:// push address of the numbers, set with the four other GRAFANA variables',
  GRAFANA_METRICS_USER:
    'GRAFANA_METRICS_USER must be the number of the metrics user, set with the four other GRAFANA variables',
  GRAFANA_LOGS_URL:
    'GRAFANA_LOGS_URL must be the https:// push address of the logs, set with the four other GRAFANA variables',
  GRAFANA_LOGS_USER:
    'GRAFANA_LOGS_USER must be the number of the logs user, set with the four other GRAFANA variables',
  GRAFANA_TOKEN: 'GRAFANA_TOKEN must be set with the four other GRAFANA variables',
  RENDER_INSTANCE_ID: 'RENDER_INSTANCE_ID must be the name of an instance',
};

export interface AppConfig {
  host: string;
  port: number;
  databaseUrl: string;
  /** 32 bytes in base64. Only `SecondStepSecrets` reads it. */
  secondStepKey: string;
  /** Whether the first hop in front of the API (a load balancer that ends TLS) is trusted. */
  trustProxy: boolean;
  /** The directory of the web app's built files to serve, or none. */
  webFiles: string | undefined;
  /** Where error reports go, or nowhere. */
  reporting: ReportingConfig;
  /** Where photos are kept: the R2 bucket, memory (a laptop, the browser tests) or nowhere. */
  photos: PhotosConfig;
  mail: MailConfig;
  /** The Chromium of the PDFs (task 5.9c-1), or the one playwright-core installs. */
  chromiumPath: string | undefined;
  /** Where the numbers and the logs go (task 10.2a), or nowhere. */
  monitoring: MonitoringConfig;
}

export interface MonitoringConfig {
  /** Grafana Cloud's push addresses, users and token; undefined: nothing is pushed. */
  grafana:
    | {
        metricsUrl: string;
        metricsUser: string;
        logsUrl: string;
        logsUser: string;
        /** Only the pusher reads it. */
        token: string;
      }
    | undefined;
  /** The instance of the service on Render, `local` elsewhere. */
  instance: string;
}

export interface MailConfig {
  /** The origin of the web app, for the links in emails. */
  webOrigin: string;
  /** The browser tests only: a directory where each mail is also written as a file. */
  outboxDir: string | undefined;
}

export type PhotosConfig =
  | { store: 'none' }
  | { store: 'memory' }
  | {
      store: 'r2';
      accountId: string;
      accessKeyId: string;
      /** Only `R2PhotoStore` reads it. */
      secretAccessKey: string;
      bucket: string;
    };

export interface ReportingConfig {
  dsn: string | undefined;
  environment: string;
  /** The commit of the running version, when the server says it. */
  release: string | undefined;
}

export class ConfigError extends Error {}

/**
 * Reads and checks the whole configuration once, at start. A missing or wrong
 * variable stops the API with the names of all of them.
 */
export function loadConfig(environment: Record<string, string | undefined>): AppConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const names = new Set(result.error.issues.map((issue) => issue.path[0] as VariableName));
    const problems = [...names].map((name) => PROBLEM[name]);
    throw new ConfigError(`The configuration is not valid: ${problems.join('; ')}.`);
  }
  const data = result.data;
  const r2Set = R2_VARIABLES.filter((name) => data[name] !== undefined);
  const wrong: VariableName[] = [];
  if (r2Set.length > 0 && r2Set.length < R2_VARIABLES.length) {
    wrong.push(...R2_VARIABLES.filter((name) => data[name] === undefined));
  }
  const grafanaSet = GRAFANA_VARIABLES.filter((name) => data[name] !== undefined);
  if (grafanaSet.length > 0 && grafanaSet.length < GRAFANA_VARIABLES.length) {
    wrong.push(...GRAFANA_VARIABLES.filter((name) => data[name] === undefined));
  }
  if (data.PHOTOS_IN_MEMORY === '1' && r2Set.length > 0) {
    wrong.push('PHOTOS_IN_MEMORY');
  }
  // A marker that a Render service really has (the review of the plan of #66,
  // must-fix 4): NODE_ENV is set by nobody.
  const onServer =
    data.RENDER_GIT_COMMIT !== undefined ||
    data.TRUST_PROXY === '1' ||
    data.WEB_FILES !== undefined;
  if (data.MAIL_OUTBOX_DIR !== undefined && onServer) {
    wrong.push('MAIL_OUTBOX_DIR');
  }
  if (wrong.length > 0) {
    const problems = wrong.map((name) => PROBLEM[name]);
    throw new ConfigError(`The configuration is not valid: ${problems.join('; ')}.`);
  }
  return {
    host: result.data.HOST,
    port: result.data.PORT,
    databaseUrl: result.data.DATABASE_URL,
    secondStepKey: result.data.SECOND_STEP_KEY,
    trustProxy: result.data.TRUST_PROXY === '1',
    webFiles: result.data.WEB_FILES,
    reporting: {
      dsn: result.data.SENTRY_DSN,
      environment: result.data.SENTRY_ENVIRONMENT,
      release: result.data.RENDER_GIT_COMMIT,
    },
    photos: photosOf(data),
    mail: { webOrigin: data.WEB_ORIGIN, outboxDir: data.MAIL_OUTBOX_DIR },
    chromiumPath: data.CHROMIUM_PATH,
    monitoring: {
      grafana:
        data.GRAFANA_METRICS_URL !== undefined &&
        data.GRAFANA_METRICS_USER !== undefined &&
        data.GRAFANA_LOGS_URL !== undefined &&
        data.GRAFANA_LOGS_USER !== undefined &&
        data.GRAFANA_TOKEN !== undefined
          ? {
              metricsUrl: data.GRAFANA_METRICS_URL,
              metricsUser: data.GRAFANA_METRICS_USER,
              logsUrl: data.GRAFANA_LOGS_URL,
              logsUser: data.GRAFANA_LOGS_USER,
              token: data.GRAFANA_TOKEN,
            }
          : undefined,
      instance: data.RENDER_INSTANCE_ID ?? 'local',
    },
  };
}

function photosOf(data: z.infer<typeof environmentSchema>): PhotosConfig {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = data;
  if (
    R2_ACCOUNT_ID !== undefined &&
    R2_ACCESS_KEY_ID !== undefined &&
    R2_SECRET_ACCESS_KEY !== undefined &&
    R2_BUCKET !== undefined
  ) {
    return {
      store: 'r2',
      accountId: R2_ACCOUNT_ID,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      bucket: R2_BUCKET,
    };
  }
  return data.PHOTOS_IN_MEMORY === '1' ? { store: 'memory' } : { store: 'none' };
}
