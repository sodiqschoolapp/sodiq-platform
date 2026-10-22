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
      trustProxy: false,
      webFiles: undefined,
      reporting: { dsn: undefined, environment: 'development', release: undefined },
      photos: { store: 'none' },
      mail: { webOrigin: 'http://localhost:5173', outboxDir: undefined },
    });
  });

  // Task 5.9c-1, decision 4: the Chromium of the PDFs, or the one playwright-core installs.
  it('takes the path of the Chromium that makes the PDFs, none when unset or empty', () => {
    expect(loadConfig({ ...VALID, CHROMIUM_PATH: '/opt/chromium/chrome' }).chromiumPath).toBe(
      '/opt/chromium/chrome',
    );
    expect(loadConfig(VALID).chromiumPath).toBeUndefined();
    expect(loadConfig({ ...VALID, CHROMIUM_PATH: '' }).chromiumPath).toBeUndefined();
  });

  // Task 2.3c-2, decisions 14 and 15 of pull request #66.
  describe('the mail', () => {
    it('takes the origin of the web app, with no path', () => {
      expect(loadConfig({ ...VALID, WEB_ORIGIN: 'https://app-test.sodiqschool.uz' }).mail).toEqual({
        webOrigin: 'https://app-test.sodiqschool.uz',
        outboxDir: undefined,
      });
      expect(problemOf({ ...VALID, WEB_ORIGIN: 'https://app.example.test/sign-in' })).toContain(
        'WEB_ORIGIN must',
      );
      expect(problemOf({ ...VALID, WEB_ORIGIN: 'ftp://app.example.test' })).toContain(
        'WEB_ORIGIN must',
      );
    });

    it('takes an outbox directory on a laptop or in the browser tests', () => {
      expect(loadConfig({ ...VALID, MAIL_OUTBOX_DIR: '/tmp/outbox' }).mail.outboxDir).toBe(
        '/tmp/outbox',
      );
    });

    it.each([
      ['RENDER_GIT_COMMIT', 'abc123'],
      ['TRUST_PROXY', '1'],
      ['WEB_FILES', '/srv/web'],
    ])('refuses the outbox directory on a server (%s)', (name, value) => {
      expect(problemOf({ ...VALID, MAIL_OUTBOX_DIR: '/tmp/outbox', [name]: value })).toContain(
        'MAIL_OUTBOX_DIR is for the browser tests only',
      );
      expect(loadConfig({ ...VALID, [name]: value }).mail.outboxDir).toBeUndefined();
    });
  });

  // Task 2.2c-2, the owner's answer 2: the R2 bucket from four variables, all
  // or none; decision 9: memory for a laptop and the browser tests, never with R2.
  describe('the photo store', () => {
    const R2 = {
      R2_ACCOUNT_ID: 'a'.repeat(32),
      R2_ACCESS_KEY_ID: 'invented-access-key-id',
      R2_SECRET_ACCESS_KEY: 'invented-secret-that-must-never-be-printed',
      R2_BUCKET: 'sodiq-photos-test',
    };

    it('uses no store when nothing is set, also when the variables are empty', () => {
      expect(loadConfig(VALID).photos).toEqual({ store: 'none' });
      expect(
        loadConfig({
          ...VALID,
          R2_ACCOUNT_ID: '',
          R2_ACCESS_KEY_ID: '',
          R2_SECRET_ACCESS_KEY: '',
          R2_BUCKET: '',
          PHOTOS_IN_MEMORY: '',
        }).photos,
      ).toEqual({ store: 'none' });
    });

    it('uses R2 when all four are set', () => {
      expect(loadConfig({ ...VALID, ...R2 }).photos).toEqual({
        store: 'r2',
        accountId: R2.R2_ACCOUNT_ID,
        accessKeyId: R2.R2_ACCESS_KEY_ID,
        secretAccessKey: R2.R2_SECRET_ACCESS_KEY,
        bucket: R2.R2_BUCKET,
      });
    });

    it('uses memory only when asked', () => {
      expect(loadConfig({ ...VALID, PHOTOS_IN_MEMORY: '1' }).photos).toEqual({ store: 'memory' });
      expect(loadConfig({ ...VALID, PHOTOS_IN_MEMORY: '0' }).photos).toEqual({ store: 'none' });
    });

    it.each(Object.keys(R2))('refuses the R2 variables without %s, naming it', (missing) => {
      const problem = problemOf({ ...VALID, ...R2, [missing]: undefined });
      expect(problem).toContain(`${missing} must`);
      expect(problem).not.toContain(R2.R2_SECRET_ACCESS_KEY);
      expect(problem).not.toContain(R2.R2_ACCESS_KEY_ID);
    });

    it('refuses memory together with R2', () => {
      const problem = problemOf({ ...VALID, ...R2, PHOTOS_IN_MEMORY: '1' });
      expect(problem).toContain('PHOTOS_IN_MEMORY must');
      expect(problem).not.toContain(R2.R2_SECRET_ACCESS_KEY);
    });

    it('refuses a wrong account id or bucket without printing it', () => {
      const problem = problemOf({
        ...VALID,
        ...R2,
        R2_ACCOUNT_ID: 'not-an-account',
        R2_BUCKET: 'Not_A_Bucket',
      });
      expect(problem).toContain('R2_ACCOUNT_ID must');
      expect(problem).toContain('R2_BUCKET must');
      expect(problem).not.toContain('not-an-account');
      expect(problem).not.toContain('Not_A_Bucket');
    });
  });

  // Task 0.10: what a server sets and a laptop does not.
  describe('the variables of a server', () => {
    it('trusts the first hop only when told to', () => {
      expect(loadConfig(VALID).trustProxy).toBe(false);
      expect(loadConfig({ ...VALID, TRUST_PROXY: '0' }).trustProxy).toBe(false);
      expect(loadConfig({ ...VALID, TRUST_PROXY: '' }).trustProxy).toBe(false);
      expect(loadConfig({ ...VALID, TRUST_PROXY: '1' }).trustProxy).toBe(true);
    });

    it.each(['true', '2', 'yes'])('refuses TRUST_PROXY "%s" and names the variable', (value) => {
      expect(problemOf({ ...VALID, TRUST_PROXY: value })).toContain('TRUST_PROXY must');
    });

    it('serves the web files only when a directory is given', () => {
      expect(loadConfig(VALID).webFiles).toBeUndefined();
      expect(loadConfig({ ...VALID, WEB_FILES: '' }).webFiles).toBeUndefined();
      expect(loadConfig({ ...VALID, WEB_FILES: 'apps/web/dist' }).webFiles).toBe('apps/web/dist');
    });

    it('reports errors only with an address, in the named environment and release', () => {
      expect(loadConfig(VALID).reporting).toEqual({
        dsn: undefined,
        environment: 'development',
        release: undefined,
      });
      expect(
        loadConfig({
          ...VALID,
          SENTRY_DSN: 'https://public-key@o0.ingest.example/1',
          SENTRY_ENVIRONMENT: 'test',
          RENDER_GIT_COMMIT: 'abc123',
        }).reporting,
      ).toEqual({
        dsn: 'https://public-key@o0.ingest.example/1',
        environment: 'test',
        release: 'abc123',
      });
    });

    it.each([
      ['an address of another kind', 'postgres://x'],
      ['a text that is no address', 'not-an-address'],
    ])('refuses %s as SENTRY_DSN and names the variable only', (_name, dsn) => {
      const problem = problemOf({ ...VALID, SENTRY_DSN: dsn });

      expect(problem).toContain('SENTRY_DSN must');
      expect(problem).not.toContain(dsn);
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
