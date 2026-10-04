import { Test } from '@nestjs/testing';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../../clock/clock.module.js';
import { createDatabase } from '../../database/database.js';
import { DATABASE } from '../../database/database.module.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { FIRST_PASSWORD_LENGTH } from './accounts.service.js';
import {
  FIRST_ACCOUNT_USAGE,
  FirstAccountModule,
  parseFirstAccountArguments,
  runFirstAccountCommand,
} from './first-account.command.js';
import { verifyPassword } from './password-hash.js';

// All names are invented.
describe('the arguments of the first-account command', () => {
  it('are the command and the two names', () => {
    expect(
      parseFirstAccountArguments([
        'first-account',
        '--first-name',
        'Ilhom',
        '--last-name',
        'Qodirov',
      ]),
    ).toEqual({ firstName: 'Ilhom', lastName: 'Qodirov' });
    expect(
      parseFirstAccountArguments(['first-account', '--last-name=Qodirov', '--first-name=Ilhom']),
    ).toEqual({ firstName: 'Ilhom', lastName: 'Qodirov' });
  });

  // `pnpm auth:first-account -- --first-name ...` hands the `--` on.
  it('are read the same with the "--" that pnpm passes on', () => {
    expect(
      parseFirstAccountArguments([
        'first-account',
        '--',
        '--first-name',
        'Ilhom',
        '--last-name',
        'Qodirov',
      ]),
    ).toEqual({ firstName: 'Ilhom', lastName: 'Qodirov' });
  });

  it('keep a name as it was typed, for the login rule to judge', () => {
    expect(
      parseFirstAccountArguments(['first-account', '--first-name', 'Oʻtkir', '--last-name', '']),
    ).toEqual({ firstName: 'Oʻtkir', lastName: '' });
  });

  it.each([
    ['nothing', []],
    ['another command', ['migrate', '--first-name', 'Ilhom', '--last-name', 'Qodirov']],
    ['no command', ['--first-name', 'Ilhom', '--last-name', 'Qodirov']],
    ['no first name', ['first-account', '--last-name', 'Qodirov']],
    ['no last name', ['first-account', '--first-name', 'Ilhom']],
    ['a first name without its value', ['first-account', '--first-name', '--last-name', 'Qodirov']],
    ['a last name without its value', ['first-account', '--first-name', 'Ilhom', '--last-name']],
    ['names without their options', ['first-account', 'Ilhom', 'Qodirov']],
    [
      'a word too many',
      ['first-account', '--first-name', 'Ilhom', '--last-name', 'Qodirov', 'extra'],
    ],
    [
      'an option the command does not have',
      ['first-account', '--first-name', 'Ilhom', '--last-name', 'Qodirov', '--role', 'teacher'],
    ],
  ])('are refused for %s', (_name, argv) => {
    expect(parseFirstAccountArguments(argv)).toBeUndefined();
  });
});

// Edge cases, "Accounts and sign-in": the first Super Admin is created by a
// one-time command on the server, which is logged; first passwords are printed
// once and not stored.
describe('the first-account command', () => {
  let database: TestDatabase;
  const clock = new FixedClock('2026-10-05T09:00:00+05:00');
  let out: string[];
  let errors: string[];
  /** Everything that reached the terminal or a log some other way than the two outputs. */
  let logged: string[];

  /** The application context as `cli.ts` opens it, on the test database. */
  const open = async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FirstAccountModule] })
      .overrideProvider(DATABASE)
      // A connection of its own: closing the context closes it, as in the real command.
      .useValue(createDatabase(database.appUrl))
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    return moduleRef.init();
  };

  const run = (...argv: string[]) =>
    runFirstAccountCommand(
      argv,
      { out: (line) => out.push(line), error: (line) => errors.push(line) },
      open,
    );

  const NAMES = ['--first-name', 'Ilhom', '--last-name', 'Qodirov'];

  async function accounts() {
    const found = await sql<{ login: string; password_hash: string; text: string }>`
      select login, password_hash, to_jsonb(a)::text as text from accounts a order by id
    `.execute(database.migrator);
    return found.rows;
  }

  async function auditEntries() {
    const found = await sql<{
      action: string;
      actor_id: string | null;
      new_value: unknown;
      details: unknown;
      text: string;
    }>`
      select action, actor_id, new_value, details, to_jsonb(l)::text as text
      from audit_log_school l order by id
    `.execute(database.migrator);
    return found.rows;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.destroy();
  });

  beforeEach(() => {
    out = [];
    errors = [];
    logged = [];
    const keep = (...parts: unknown[]): boolean => {
      logged.push(parts.map((part) => (typeof part === 'string' ? part : String(part))).join(' '));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(keep);
    vi.spyOn(process.stderr, 'write').mockImplementation(keep);
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation(keep);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['without arguments', []],
    ['without the last name', ['first-account', '--first-name', 'Ilhom']],
    ['with an option it does not have', ['first-account', ...NAMES, '--role', 'teacher']],
  ])('run %s prints how it is used and creates nothing', async (_name, argv) => {
    expect(await run(...argv)).toBe(1);

    expect(errors).toEqual([FIRST_ACCOUNT_USAGE]);
    expect(out).toEqual([]);
    expect(await accounts()).toEqual([]);
    expect(await auditEntries()).toEqual([]);
  });

  it.each([
    ['a Cyrillic first name', ['--first-name', 'Илхом', '--last-name', 'Qodirov'], 'Илхом'],
    ['a Cyrillic last name', ['--first-name', 'Ilhom', '--last-name', 'Кодиров'], 'Кодиров'],
    ['an empty last name', ['--first-name', 'Ilhom', '--last-name', ''], 'Ilhom'],
  ])('refuses %s without repeating the name, and creates nothing', async (_name, names, typed) => {
    expect(await run('first-account', ...names)).toBe(1);

    expect(errors).toEqual(['A login needs a first and a last name in Latin letters.']);
    expect(out).toEqual([]);
    expect([...errors, ...logged].join('\n')).not.toContain(typed);
    expect(await accounts()).toEqual([]);
    expect(await auditEntries()).toEqual([]);
  });

  // The whole first run, with the "--" that pnpm passes on.
  describe('run as pnpm runs it', () => {
    let exitCode: number;
    let output: string[];
    let errorOutput: string[];
    let log: string;
    let login: string;
    let password: string;

    beforeAll(async () => {
      out = [];
      errors = [];
      logged = [];
      const keep = (...parts: unknown[]): boolean => {
        logged.push(parts.map(String).join(' '));
        return true;
      };
      vi.spyOn(process.stdout, 'write').mockImplementation(keep);
      vi.spyOn(process.stderr, 'write').mockImplementation(keep);
      for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        vi.spyOn(console, method).mockImplementation(keep);
      }
      exitCode = await run('first-account', '--', ...NAMES);
      vi.restoreAllMocks();
      output = out;
      errorOutput = errors;
      log = logged.join('\n');
      login = output.find((line) => line.startsWith('Login: '))?.slice('Login: '.length) ?? '';
      password =
        output
          .find((line) => line.startsWith('First password: '))
          ?.slice('First password: '.length) ?? '';
    });

    it('creates the account and ends without an error', async () => {
      expect(exitCode).toBe(0);
      expect(errorOutput).toEqual([]);
      expect((await accounts()).map((account) => account.login)).toEqual(['i.qodirov']);
    });

    it('writes the login and the first password to the output exactly once', async () => {
      expect(login).toBe('i.qodirov');
      expect(password).toHaveLength(FIRST_PASSWORD_LENGTH);
      const everything = output.join('\n');
      expect(everything.split(login)).toHaveLength(2);
      expect(everything.split(password)).toHaveLength(2);
      // It is the password of the account, not some other text.
      const [account] = await accounts();
      expect(await verifyPassword(account?.password_hash ?? '', password)).toBe(true);
    });

    it('writes neither of them, nor the names, to any log', () => {
      expect(log).not.toContain(password);
      expect(log).not.toContain(login);
      expect(log).not.toMatch(/Ilhom|Qodirov/);
    });

    it('stores the first password nowhere: not in the account, not in the audit entry', async () => {
      for (const row of [...(await accounts()), ...(await auditEntries())]) {
        expect(row.text).not.toContain(password);
      }
    });

    it('is logged in the audit log without an actor, naming the command', async () => {
      const entries = await auditEntries();

      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({
        action: 'account.create',
        actor_id: null,
        details: { command: 'first-account' },
      });
      expect(entries[1]).toMatchObject({
        action: 'assignment.given',
        actor_id: null,
        new_value: { role: 'super_admin', branchId: null },
        details: { command: 'first-account' },
      });
      for (const entry of entries) {
        expect(entry.text).not.toMatch(/Ilhom|Qodirov/);
      }
    });

    it('makes the account the Super Admin and says so', async () => {
      const found = await sql<{ login: string; role: string; branch_id: string | null }>`
        select a.login, s.role, s.branch_id
        from assignments s join accounts a on a.id = s.account_id
      `.execute(database.migrator);

      expect(found.rows).toEqual([{ login: 'i.qodirov', role: 'super_admin', branch_id: null }]);
      expect(output).toContain('Role: Super Admin');
    });
  });

  it('refuses a second run, prints no login or password and changes nothing', async () => {
    const before = await accounts();

    expect(await run('first-account', ...NAMES)).toBe(1);

    expect(errors).toEqual([
      'A Super Admin already exists. The first account is created only once.',
    ]);
    expect(out).toEqual([]);
    expect(await accounts()).toEqual(before);
    expect(await auditEntries()).toHaveLength(2);
  });

  it('says so, without a password in any output, when the database cannot be reached', async () => {
    const code = await runFirstAccountCommand(
      ['first-account', ...NAMES],
      { out: (line) => out.push(line), error: (line) => errors.push(line) },
      () => Promise.reject(new Error('The database is not reachable.')),
    );

    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(errors).toEqual(['Could not create the first account: The database is not reachable.']);
  });
});
