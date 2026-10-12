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
});

const R2_VARIABLES = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
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
  if (data.PHOTOS_IN_MEMORY === '1' && r2Set.length > 0) {
    wrong.push('PHOTOS_IN_MEMORY');
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
