import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const DATABASE_URL = 'postgres://sodiq_app:not-a-real-password@localhost:5432/sodiq_dev';

function problemOf(environment: Record<string, string | undefined>): string {
  try {
    loadConfig(environment);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.message;
    }
    throw error;
  }
  throw new Error('loadConfig accepted the environment.');
}

// docs/build-plan.md, task 0.4a: configuration loading.
describe('loadConfig', () => {
  it('reads the variables', () => {
    expect(loadConfig({ DATABASE_URL, HOST: '0.0.0.0', PORT: '8080' })).toEqual({
      host: '0.0.0.0',
      port: 8080,
      databaseUrl: DATABASE_URL,
    });
  });

  it('listens only on this machine, on port 3000, unless told otherwise', () => {
    expect(loadConfig({ DATABASE_URL })).toMatchObject({ host: '127.0.0.1', port: 3000 });
  });

  it('treats an empty variable as not set', () => {
    expect(loadConfig({ DATABASE_URL, HOST: '', PORT: '' })).toMatchObject({
      host: '127.0.0.1',
      port: 3000,
    });
    expect(problemOf({ DATABASE_URL: '' })).toContain('DATABASE_URL');
  });

  it('ignores variables it does not know', () => {
    expect(loadConfig({ DATABASE_URL, PATH: '/usr/bin' })).not.toHaveProperty('PATH');
  });

  it.each([
    ['no database address', {}, 'DATABASE_URL'],
    ['a database address of another kind', { DATABASE_URL: 'mysql://localhost/x' }, 'DATABASE_URL'],
    ['a port that is not a number', { DATABASE_URL, PORT: 'abc' }, 'PORT'],
    ['a port that is not whole', { DATABASE_URL, PORT: '80.5' }, 'PORT'],
    ['a port out of range', { DATABASE_URL, PORT: '70000' }, 'PORT'],
  ])('refuses %s and names the variable', (_name, environment, variable) => {
    expect(problemOf(environment)).toContain(`${variable} must`);
  });

  it('names every wrong variable at once', () => {
    const problem = problemOf({ PORT: 'abc' });

    expect(problem).toContain('DATABASE_URL must');
    expect(problem).toContain('PORT must');
  });

  it('never prints a value', () => {
    const problem = problemOf({
      DATABASE_URL: 'mysql://someone:real-looking-password@db.example/x',
      PORT: '99999999',
    });

    expect(problem).not.toContain('real-looking-password');
    expect(problem).not.toContain('99999999');
  });
});
