import type { AddressInfo } from 'node:net';
import { parseArgs } from 'node:util';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { schoolDateOf, schoolDateSchema, type Clock } from '@sodiq/shared';
import { addDays } from '@sodiq/timetable-rules';
import { CLOCK } from '../clock/clock.module.js';
import { Transactions } from '../database/transactions.js';
import { JobQueue } from '../jobs/job-queue.js';
import { Audit } from '../modules/audit/audit.service.js';
import { MonitoringApi, MonitoringApiError, signIn } from './monitoring-api.js';
import {
  buildMonitoringBranch,
  markMonitoringBranch,
  MonitoringBranchRefused,
  monitoringPrecheck,
} from './monitoring-branch.js';

/**
 * The one-time command of the owner that builds the hidden Monitoring branch on the server (task
 * 10.2b; `docs/monitoring.md`, step 9):
 *
 *   node apps/api/dist/monitoring/cli.js monitoring-branch --subject <English name> --year-end <date>
 *
 * It asks for the owner's Super Admin login, password and second-step code at the prompt (never
 * echoed, never logged), signs in to this server's own API over the local loopback, and builds
 * the branch through the routes (`buildMonitoringBranch`). It prints each step, and at the end
 * the test teacher's login and first password, once.
 */

export const MONITORING_BRANCH_USAGE =
  'Usage: node apps/api/dist/monitoring/cli.js monitoring-branch --subject <English name> --year-end <YYYY-MM-DD> [--year-start <YYYY-MM-DD>]';

const TIME_ZONE = 'Asia/Tashkent';

export interface MonitoringBranchArguments {
  subject: string;
  yearEnd: string;
  yearStart: string | null;
}

/** The arguments, or nothing when the line is not the command's. */
export function parseMonitoringBranchArguments(
  argv: readonly string[],
): MonitoringBranchArguments | undefined {
  try {
    const { positionals, values } = parseArgs({
      args: argv.filter((argument) => argument !== '--'),
      allowPositionals: true,
      strict: true,
      options: {
        subject: { type: 'string' },
        'year-end': { type: 'string' },
        'year-start': { type: 'string' },
      },
    });
    const subject = values.subject?.trim();
    const yearEnd = schoolDateSchema.safeParse(values['year-end']);
    const yearStart =
      values['year-start'] === undefined ? null : schoolDateSchema.safeParse(values['year-start']);
    if (
      positionals.length !== 1 ||
      positionals[0] !== 'monitoring-branch' ||
      subject === undefined ||
      subject === '' ||
      !yearEnd.success ||
      (yearStart !== null && !yearStart.success)
    ) {
      return undefined;
    }
    return { subject, yearEnd: yearEnd.data, yearStart: yearStart?.data ?? null };
  } catch {
    return undefined;
  }
}

/** Where the command reads and writes: the terminal of the person who runs it, and nowhere else. */
export interface MonitoringBranchTerminal {
  out: (line: string) => void;
  error: (line: string) => void;
  /** A typed answer; `hidden` for a secret, which the terminal does not echo. */
  ask: (question: string, hidden: boolean) => Promise<string>;
}

/** Returns the exit code. */
export async function runMonitoringBranchCommand(
  argv: readonly string[],
  terminal: MonitoringBranchTerminal,
  open: () => Promise<NestExpressApplication>,
): Promise<number> {
  const parsed = parseMonitoringBranchArguments(argv);
  if (parsed === undefined) {
    terminal.error(MONITORING_BRANCH_USAGE);
    return 1;
  }
  let app: NestExpressApplication | undefined;
  try {
    app = await open();
    const now = app.get<Clock>(CLOCK).now();
    const tomorrow = addDays(schoolDateOf(now, TIME_ZONE), 1);
    const yearStart = parsed.yearStart ?? tomorrow;
    if (yearStart < tomorrow) {
      throw new MonitoringBranchRefused(
        `The year starts tomorrow (${tomorrow}) or later: a timetable is published from tomorrow.`,
      );
    }
    if (parsed.yearEnd <= yearStart) {
      throw new MonitoringBranchRefused('The year ends after it starts.');
    }
    const transactions = app.get(Transactions);
    const audit = app.get(Audit);
    const subject = await monitoringPrecheck(transactions, parsed.subject);

    await app.get(JobQueue).ready();
    const server = app.getHttpServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const api = new MonitoringApi(
      `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    );
    const login = (await terminal.ask('Your Super Admin login: ', false)).trim();
    await signIn(api, login, await terminal.ask('Your password: ', true), () =>
      terminal.ask('The code of your second step: ', true),
    );
    const built = await buildMonitoringBranch(
      api,
      { subject, yearStart, yearEnd: parsed.yearEnd },
      (branchId) => markMonitoringBranch(transactions, audit, { login, branchId }),
      terminal.out,
    );
    terminal.out(`Test teacher login: ${built.teacherLogin}`);
    terminal.out(`First password: ${built.teacherFirstPassword}`);
    terminal.out(
      'The password is shown only now. Sign in once as the test teacher, set a new password, and store the login and the new password as the two secrets of the check (docs/monitoring.md, step 10).',
    );
    return 0;
  } catch (error) {
    const known = error instanceof MonitoringBranchRefused || error instanceof MonitoringApiError;
    const reason = error instanceof Error ? error.message : String(error);
    terminal.error(known ? reason : `The Monitoring branch was not built: ${reason}`);
    return 1;
  } finally {
    // A failed close must not hide what was built or why it stopped.
    await app?.close().catch(() => undefined);
  }
}
