import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const DATABASE_URL = 'postgres://sodiq_app:not-a-real-password@localhost:5432/sodiq_dev';
// Invented for the tests: 32 bytes in base64.
const SECOND_STEP_KEY = Buffer.alloc(32, 7).toString('base64');
const VALID = { DATABASE_URL, SECOND_STEP_KEY };

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
    expect(loadConfig({ ...VALID, HOST: '0.0.0.0', PORT: '8080' })).toEqual({
      host: '0.0.0.0',
      port: 8080,
      databaseUrl: DATABASE_URL,
      secondStepKey: SECOND_STEP_KEY,
    });
  });

  it('listens only on this machine, on port 3000, unless told otherwise', () => {
    expect(loadConfig(VALID)).toMatchObject({ host: '127.0.0.1', port: 3000 });
  });

  it('treats an empty variable as not set', () => {
    expect(loadConfig({ ...VALID, HOST: '', PORT: '' })).toMatchObject({
      host: '127.0.0.1',
      port: 3000,
    });
    expect(problemOf({ ...VALID, DATABASE_URL: '' })).toContain('DATABASE_URL');
    expect(problemOf({ ...VALID, SECOND_STEP_KEY: '' })).toContain('SECOND_STEP_KEY');
  });

  it('ignores variables it does not know', () => {
    expect(loadConfig({ ...VALID, PATH: '/usr/bin' })).not.toHaveProperty('PATH');
  });

  it.each([
    ['no database address', { SECOND_STEP_KEY }, 'DATABASE_URL'],
    [
      'a database address of another kind',
      { ...VALID, DATABASE_URL: 'mysql://localhost/x' },
      'DATABASE_URL',
    ],
    ['a port that is not a number', { ...VALID, PORT: 'abc' }, 'PORT'],
    ['a port that is not whole', { ...VALID, PORT: '80.5' }, 'PORT'],
    ['a port out of range', { ...VALID, PORT: '70000' }, 'PORT'],
  ])('refuses %s and names the variable', (_name, environment, variable) => {
    expect(problemOf(environment)).toContain(`${variable} must`);
  });

  // Task 0.6c, asked for by the owner: the key is checked at start like the
  // database address: 32 bytes, base64.
  describe('the key of the second step', () => {
    it.each([
      ['no key', undefined],
      ['a key of 31 bytes', Buffer.alloc(31, 7).toString('base64')],
      ['a key of 33 bytes', Buffer.alloc(33, 7).toString('base64')],
      ['a key of 16 bytes', Buffer.alloc(16, 7).toString('base64')],
      ['a text that is not base64', `${'!'.repeat(43)}=`],
      ['a key in base64url', `${'-_'.repeat(21)}A=`],
      ['a key in hex', 'ab'.repeat(32)],
      ['a key without its padding', SECOND_STEP_KEY.slice(0, 43)],
      ['a key with a space after it', `${SECOND_STEP_KEY} `],
    ])('refuses %s and names the variable', (_name, key) => {
      const problem = problemOf({ DATABASE_URL, SECOND_STEP_KEY: key });

      expect(problem).toContain('SECOND_STEP_KEY must');
      expect(problem).not.toContain('DATABASE_URL');
    });

    it('accepts 32 bytes in base64', () => {
      const key = Buffer.from('an invented key of 32 bytes !!!!').toString('base64');

      expect(loadConfig({ DATABASE_URL, SECOND_STEP_KEY: key }).secondStepKey).toBe(key);
    });
  });

  it('names every wrong variable at once', () => {
    const problem = problemOf({ PORT: 'abc' });

    expect(problem).toContain('DATABASE_URL must');
    expect(problem).toContain('PORT must');
    expect(problem).toContain('SECOND_STEP_KEY must');
  });

  it('never prints a value', () => {
    const problem = problemOf({
      DATABASE_URL: 'mysql://someone:real-looking-password@db.example/x',
      PORT: '99999999',
      SECOND_STEP_KEY: 'a-real-looking-key-that-is-too-short',
    });

    expect(problem).not.toContain('real-looking-password');
    expect(problem).not.toContain('99999999');
    expect(problem).not.toContain('a-real-looking-key');
  });
});
