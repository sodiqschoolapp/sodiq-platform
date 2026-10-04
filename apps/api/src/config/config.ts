import { z } from 'zod';

/** A variable that is set but empty counts as not set. */
const emptyAsUnset = (value: unknown): unknown => (value === '' ? undefined : value);

const environmentSchema = z.object({
  // The API answers only on this machine unless the server sets HOST (task 0.10).
  HOST: z.preprocess(emptyAsUnset, z.string().default('127.0.0.1')),
  PORT: z.preprocess(emptyAsUnset, z.coerce.number().int().min(1).max(65535).default(3000)),
  DATABASE_URL: z.preprocess(emptyAsUnset, z.url({ protocol: /^postgres(ql)?$/ })),
});

type VariableName = keyof z.infer<typeof environmentSchema>;

/** What to tell the person who starts the API. It never repeats the value. */
const PROBLEM: Record<VariableName, string> = {
  HOST: 'HOST must be a host name or an address',
  PORT: 'PORT must be a whole number from 1 to 65535',
  DATABASE_URL:
    'DATABASE_URL must be set to a postgres:// address (on a developer machine: copy .env.example to .env, see README.md, Setup)',
};

export interface AppConfig {
  host: string;
  port: number;
  databaseUrl: string;
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
  };
}
