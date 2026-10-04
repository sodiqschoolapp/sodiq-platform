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
});

type VariableName = keyof z.infer<typeof environmentSchema>;

/** What to tell the person who starts the API. It never repeats the value. */
const PROBLEM: Record<VariableName, string> = {
  HOST: 'HOST must be a host name or an address',
  PORT: 'PORT must be a whole number from 1 to 65535',
  DATABASE_URL:
    'DATABASE_URL must be set to a postgres:// address (on a developer machine: copy .env.example to .env, see README.md, Setup)',
  SECOND_STEP_KEY:
    'SECOND_STEP_KEY must be set to 32 random bytes in base64 (on a developer machine: copy the line from .env.example to .env)',
};

export interface AppConfig {
  host: string;
  port: number;
  databaseUrl: string;
  /** 32 bytes in base64. Only `SecondStepSecrets` reads it. */
  secondStepKey: string;
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
  return {
    host: result.data.HOST,
    port: result.data.PORT,
    databaseUrl: result.data.DATABASE_URL,
    secondStepKey: result.data.SECOND_STEP_KEY,
  };
}
