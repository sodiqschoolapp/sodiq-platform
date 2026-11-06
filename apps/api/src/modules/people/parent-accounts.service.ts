import { Inject, Injectable } from '@nestjs/common';
import {
  latinSpelling,
  PARENT_FIRST_PASSWORD_VALID_DAYS,
  PARENT_RESET_PASSWORD_VALID_DAYS,
  type Clock,
  type Language,
  type ParentAccount,
  type ParentChild,
  type ParentReset,
  type ParentSlip,
  type ParentSlipList,
  type ParentSlipPrint,
  type ParentSlipState,
  type ParentsNeverUsed,
  type ParentsNeverUsedExport,
  type PrintedParentSlip,
  type PrintedParentSlips,
  type SchoolDate,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { REAL_CLOCK } from '../../clock/clock.module.js';
import { CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/config.js';
import { transactionMoment, Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { XlsxFile } from '../../http/xlsx.js';
import { branchToday } from '../access/taught-scope.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { exportList, oneCell } from '../audit/export-list.js';
import { Accounts, prepareFirstPassword } from '../auth/accounts.service.js';
import { loginBase } from '../auth/login.js';
import { PasswordResets } from '../auth/password-resets.service.js';
import { Sessions } from '../auth/sessions.service.js';
import { SignInThrottle } from '../auth/sign-in-throttle.service.js';
import { notFound } from '../setup/setup-refusals.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `edge/close-relatives`: a first password of a parent is valid for 30 days. */
export const PARENT_FIRST_PASSWORD_VALID_MS = PARENT_FIRST_PASSWORD_VALID_DAYS * DAY_MS;

/** `edge/close-relatives`: a reset slip of a parent is valid for 7 days. */
export const PARENT_RESET_PASSWORD_VALID_MS = PARENT_RESET_PASSWORD_VALID_DAYS * DAY_MS;

/** A relative linked with portal access on to a student, as the class or branch reads it. */
interface LinkedRow {
  relative_id: string;
  full_name: string;
  student_id: string;
  first_name: string;
  last_name: string;
  account_id: string | null;
  login: string | null;
  must_change_password: boolean | null;
}

/** A relative of a class or branch with its children and its account, as read. */
interface Linked {
  relativeId: string;
  fullName: string;
  children: ParentChild[];
  accountId: string | null;
  login: string | null;
  mustChangePassword: boolean | null;
}

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('The Parent accounts work for the branch of the request.');
  }
  return access.branchId;
}

/** The rows by relative, children in the order read (by last and first name). */
function grouped(rows: readonly LinkedRow[]): Linked[] {
  const found = new Map<string, Linked>();
  for (const row of rows) {
    let one = found.get(row.relative_id);
    if (one === undefined) {
      one = {
        relativeId: row.relative_id,
        fullName: row.full_name,
        children: [],
        accountId: row.account_id,
        login: row.login,
        mustChangePassword: row.must_change_password,
      };
      found.set(row.relative_id, one);
    }
    if (!one.children.some((child) => child.studentId === row.student_id)) {
      one.children.push({
        studentId: row.student_id,
        firstName: row.first_name,
        lastName: row.last_name,
      });
    }
  }
  return [...found.values()];
}

/**
 * The login of a relative (reading 1 of the Release 2 plan): the staff form built from the
 * first and the last word of the full name, a Cyrillic name in Latin letters (decision 18).
 */
export function parentLoginBase(fullName: string): string {
  const words = latinSpelling(fullName).trim().split(/\s+/);
  const first = words[0] ?? '';
  const last = words.at(-1) ?? '';
  return loginBase(first, last);
}

/**
 * The Parent accounts of relatives (task 11.1; `10`, Signing in; `edge/close-relatives`): the
 * slips of a class, the reset, the account part of the Parent page and the report of accounts
 * never used. The guard lets in the Super Admin and the Academic Vice Principal of the branch
 * of the request (`parent_accounts`); every route here reads the relatives through the branch
 * filter and checks that a child of the branch is active today (decision 7).
 *
 * Passwords and slips run by real time, never the demo clock (task 10.5, decision 1), as the
 * staff passwords do; the class members and the active students follow the branch date of
 * the request.
 */
@Injectable()
export class ParentAccounts {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly accounts: Accounts,
    private readonly resets: PasswordResets,
    private readonly throttle: SignInThrottle,
    private readonly sessions: Sessions,
    @Inject(REAL_CLOCK) private readonly realClock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** The relatives of the class to print, to print again, or signed in. */
  async slipList(access: Access, classId: string): Promise<ParentSlipList> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await this.classOf(transaction, classId);
      const today = await branchToday(transaction, branchId);
      const linked = grouped(await this.ofClass(transaction, classId, today, true));
      const now = this.realClock.now();
      return {
        classId,
        className: found.name,
        relatives: await Promise.all(
          linked.map(async (one) => {
            const slip =
              one.accountId === null
                ? null
                : await this.slipOf(transaction, one.accountId, branchId, now);
            return {
              relativeId: one.relativeId,
              fullName: one.fullName,
              children: one.children,
              state: stateOf(one, slip),
              login: one.login,
              slip,
            };
          }),
        ),
      };
    });
  }

  /**
   * Prints the slips of a class (`edge/close-relatives`): a new first password, valid for 30
   * days, for every relative to print and for each relative named in `printAgain`, whose
   * earlier password then fails. The account is made at the first print. Answers the slips
   * once; the passwords are stored only as their hashes.
   */
  async print(
    access: Access,
    classId: string,
    request: ParentSlipPrint,
    requestId: string,
  ): Promise<PrintedParentSlips> {
    const branchId = branchOf(access);
    // The hashes take tens of milliseconds each: made before the transaction that locks the
    // relatives (as the staff import, 9.4h), one per relative read now; one needed later is
    // made inside.
    const before = await this.transactions.run(access.branchIds, async (transaction) => {
      await this.classOf(transaction, classId);
      const today = await branchToday(transaction, branchId);
      return grouped(await this.ofClass(transaction, classId, today, true));
    });
    const prepared = await Promise.all(
      before
        .filter(
          (one) => one.mustChangePassword !== false || request.printAgain.includes(one.relativeId),
        )
        .map(() => prepareFirstPassword()),
    );
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await this.classOf(transaction, classId);
      const today = await branchToday(transaction, branchId);
      await this.refuseOutside(transaction, classId, today, request.printAgain);
      // Must-fix 3 of the spec review: the account rows of the relatives are locked, in the
      // order of their ids and in a statement of their own; their state is read again after.
      const ids = [
        ...new Set([
          ...grouped(await this.ofClass(transaction, classId, today, true)).map(
            (one) => one.relativeId,
          ),
          ...request.printAgain,
        ]),
      ].sort();
      await this.lockRelatives(transaction, ids);
      const linked = grouped(await this.ofClass(transaction, classId, today, true));
      const now = this.realClock.now();
      const slips: PrintedParentSlip[] = [];
      for (const one of linked) {
        const slip =
          one.accountId === null
            ? null
            : await this.slipOf(transaction, one.accountId, branchId, now);
        const state = stateOf(one, slip);
        const again = request.printAgain.includes(one.relativeId);
        if (state === 'signed_in') {
          if (again) {
            throw new ApiException('parent_signed_in', 409);
          }
          continue;
        }
        if (state === 'valid_slip' && !again) {
          continue;
        }
        const password = prepared.pop() ?? (await prepareFirstPassword());
        const validUntil = new Date(now.getTime() + PARENT_FIRST_PASSWORD_VALID_MS);
        const login =
          one.accountId === null
            ? await this.createAccount(transaction, access, one, password, requestId, branchId)
            : await this.givePassword(transaction, one.accountId, password.hash, validUntil);
        await this.recordSlip(transaction, access, {
          branchId,
          relativeId: one.relativeId,
          classId,
          kind: 'first',
          language: request.language,
          printedAt: now,
          validUntil,
          again,
          requestId,
        });
        slips.push({
          relativeId: one.relativeId,
          fullName: one.fullName,
          children: one.children,
          login,
          password: password.password,
          kind: 'first',
          printedAt: now.toISOString(),
          validUntil: validUntil.toISOString(),
        });
      }
      return {
        language: request.language,
        className: found.name,
        botUsername: this.config.parentBotUsername,
        slips,
      };
    });
  }

  /**
   * The reset of a parent's password (`edge/close-relatives`, forgotten password): a new
   * one-time password on a slip, valid for 7 days, changed at the first sign-in; every session
   * ends; "reset by X for Y" in the log.
   */
  async reset(
    access: Access,
    relativeId: string,
    request: ParentReset,
    requestId: string,
  ): Promise<PrintedParentSlips> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const today = await branchToday(transaction, branchId);
      const one = await this.inScope(transaction, relativeId, today);
      await this.lockRelatives(transaction, [relativeId]);
      const account = await transaction
        .selectFrom('relative_accounts')
        .innerJoin('accounts', 'accounts.id', 'relative_accounts.account_id')
        .select(['accounts.id', 'accounts.login'])
        .where('relative_accounts.relative_id', '=', relativeId)
        .executeTakeFirst();
      if (account === undefined) {
        throw new ApiException('parent_no_account', 409);
      }
      const reset = await this.resets.byAdministrator(transaction, {
        accountId: account.id,
        resetBy: access.accountId,
        validForMs: PARENT_RESET_PASSWORD_VALID_MS,
        branchId,
        actingAssignmentId: access.assignmentId,
        personId: relativeId,
        requestId,
      });
      const now = new Date(reset.validUntil.getTime() - PARENT_RESET_PASSWORD_VALID_MS);
      await this.recordSlip(transaction, access, {
        branchId,
        relativeId,
        classId: null,
        kind: 'reset',
        language: request.language,
        printedAt: now,
        validUntil: reset.validUntil,
        again: false,
        requestId,
      });
      return {
        language: request.language,
        className: null,
        botUsername: this.config.parentBotUsername,
        slips: [
          {
            relativeId,
            fullName: one.fullName,
            children: one.children,
            login: account.login,
            password: reset.oneTimePassword,
            kind: 'reset',
            printedAt: now.toISOString(),
            validUntil: reset.validUntil.toISOString(),
          },
        ],
      };
    });
  }

  /** The account part of the Parent page. */
  async account(access: Access, relativeId: string): Promise<ParentAccount> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const today = await branchToday(transaction, branchId);
      const one = await this.inScope(transaction, relativeId, today);
      if (one.accountId === null || one.login === null) {
        return { account: null };
      }
      const last = await transaction
        .selectFrom('sessions')
        .select((builder) => builder.fn.max('created_at').as('at'))
        .where('account_id', '=', one.accountId)
        .executeTakeFirst();
      const at = last?.at ?? null;
      return {
        account: {
          login: one.login,
          signedIn: one.mustChangePassword === false,
          lastSignInAt: at === null ? null : new Date(at).toISOString(),
          slip: await this.slipOf(transaction, one.accountId, branchId, this.realClock.now()),
        },
      };
    });
  }

  /**
   * The report of Parent accounts never used (`edge/close-relatives`: "a report lists Parent
   * accounts never used"): the relatives of the active students of the branch whose account
   * has no password chosen yet (`password_changed_at` empty, decision 8). Each read is logged
   * as an export with its row count (decision 8).
   */
  async neverUsed(access: Access, requestId: string): Promise<ParentsNeverUsed> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const accounts = await this.neverUsedRows(transaction, access);
      await this.audit.record(transaction, {
        branchId: branchOf(access),
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'parent_account.never_used',
        details: { rows: accounts.length },
        requestId,
      });
      return { accounts };
    });
  }

  /** The Excel file of the report, from the rows the report reads (an export, logged). */
  async neverUsedFile(
    access: Access,
    request: ParentsNeverUsedExport,
    requestId: string,
  ): Promise<XlsxFile> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const accounts = await this.neverUsedRows(transaction, access);
      type Row = ParentsNeverUsed['accounts'][number];
      return exportList<Row, ParentsNeverUsedExport['columns'][number]>(
        transaction,
        this.audit,
        this.realClock,
        access,
        requestId,
        {
          list: 'parents_never_used',
          action: 'parent_account.never_used_export',
          request,
          rows: new Map(accounts.map((row) => [row.relativeId, row])),
          allowed: () => true,
          columns: {
            name: oneCell(
              (texts) => texts.parents_never_used.columns.name,
              (row) => row.fullName,
            ),
            login: oneCell(
              (texts) => texts.parents_never_used.columns.login,
              (row) => row.login,
            ),
            children: oneCell(
              (texts) => texts.parents_never_used.columns.children,
              (row) =>
                row.children.map((child) => `${child.lastName} ${child.firstName}`).join(', '),
            ),
            printedAt: oneCell(
              (texts) => texts.parents_never_used.columns.printedAt,
              (row) => row.slip?.printedAt.slice(0, 10) ?? null,
            ),
            validUntil: oneCell(
              (texts) => texts.parents_never_used.columns.validUntil,
              (row) => row.slip?.validUntil.slice(0, 10) ?? null,
            ),
            expired: oneCell(
              (texts) => texts.parents_never_used.columns.expired,
              (row, texts) => (row.expired ? texts.yes : texts.no),
            ),
          },
        },
      );
    });
  }

  private async neverUsedRows(
    transaction: Transaction,
    access: Access,
  ): Promise<ParentsNeverUsed['accounts']> {
    const branchId = branchOf(access);
    const today = await branchToday(transaction, branchId);
    const rows = grouped(await this.ofBranch(transaction, today));
    const now = this.realClock.now();
    const result: ParentsNeverUsed['accounts'] = [];
    for (const one of rows) {
      if (one.accountId === null || one.login === null) {
        continue;
      }
      const account = await transaction
        .selectFrom('accounts')
        .select(['password_changed_at', 'password_expires_at'])
        .where('id', '=', one.accountId)
        .executeTakeFirstOrThrow();
      if (account.password_changed_at !== null) {
        continue;
      }
      result.push({
        relativeId: one.relativeId,
        fullName: one.fullName,
        login: one.login,
        children: one.children,
        slip: await this.slipOf(transaction, one.accountId, branchId, now),
        expired: account.password_expires_at !== null && account.password_expires_at <= now,
      });
    }
    return result;
  }

  /** The class of the branch of the request, or 404. */
  private async classOf(transaction: Transaction, classId: string): Promise<{ name: string }> {
    const found = await transaction
      .selectFrom('classes')
      .select(['name', 'grade'])
      .where('id', '=', classId)
      .executeTakeFirst();
    if (found === undefined) {
      throw notFound();
    }
    return { name: `${String(found.grade)} ${found.name}` };
  }

  /**
   * The relatives linked live to the students who are members of the class today and active;
   * with `portalOnly`, only the links with portal access on (`edge/close-relatives`: "each
   * relative linked to a student of the class with portal access on"). Merged and archived
   * relatives never.
   */
  private async ofClass(
    transaction: Transaction,
    classId: string,
    today: SchoolDate,
    portalOnly: boolean,
  ): Promise<LinkedRow[]> {
    let query = transaction
      .selectFrom('class_memberships as m')
      .innerJoin('students as s', 's.id', 'm.student_id')
      .innerJoin('student_relatives as l', 'l.student_id', 's.id')
      .innerJoin('relatives as r', 'r.id', 'l.relative_id')
      .innerJoin('relative_accounts as ra', 'ra.relative_id', 'r.id')
      .leftJoin('accounts as a', 'a.id', 'ra.account_id')
      .select([
        'r.id as relative_id',
        'r.full_name',
        's.id as student_id',
        's.first_name',
        's.last_name',
        'ra.account_id',
        'a.login',
        'a.must_change_password',
      ])
      .where('m.class_id', '=', classId)
      .where('m.valid_from', '<=', today)
      .where('m.valid_until', '>', today)
      .where('l.unlinked_at', 'is', null)
      .where('r.archived_at', 'is', null)
      .where('r.merged_into', 'is', null)
      .where((builder) =>
        builder.exists(
          builder
            .selectFrom('student_statuses as st')
            .select('st.id')
            .whereRef('st.student_id', '=', 's.id')
            .where('st.status', '=', 'active')
            .where('st.valid_from', '<=', today)
            .where((inner) =>
              inner.or([inner('st.valid_until', 'is', null), inner('st.valid_until', '>', today)]),
            ),
        ),
      );
    if (portalOnly) {
      query = query.where('l.portal_access', '=', true);
    }
    return query
      .orderBy('r.name_key')
      .orderBy('r.id')
      .orderBy('s.last_name')
      .orderBy('s.first_name')
      .orderBy('s.id')
      .execute();
  }

  /** The relatives linked with portal access on to the active students of the branch. */
  private async ofBranch(transaction: Transaction, today: SchoolDate): Promise<LinkedRow[]> {
    return transaction
      .selectFrom('students as s')
      .innerJoin('student_relatives as l', 'l.student_id', 's.id')
      .innerJoin('relatives as r', 'r.id', 'l.relative_id')
      .innerJoin('relative_accounts as ra', 'ra.relative_id', 'r.id')
      .leftJoin('accounts as a', 'a.id', 'ra.account_id')
      .select([
        'r.id as relative_id',
        'r.full_name',
        's.id as student_id',
        's.first_name',
        's.last_name',
        'ra.account_id',
        'a.login',
        'a.must_change_password',
      ])
      .where('l.unlinked_at', 'is', null)
      .where('l.portal_access', '=', true)
      .where('r.archived_at', 'is', null)
      .where('r.merged_into', 'is', null)
      .where((builder) =>
        builder.exists(
          builder
            .selectFrom('student_statuses as st')
            .select('st.id')
            .whereRef('st.student_id', '=', 's.id')
            .where('st.status', '=', 'active')
            .where('st.valid_from', '<=', today)
            .where((inner) =>
              inner.or([inner('st.valid_until', 'is', null), inner('st.valid_until', '>', today)]),
            ),
        ),
      )
      .orderBy('r.name_key')
      .orderBy('r.id')
      .orderBy('s.last_name')
      .orderBy('s.first_name')
      .orderBy('s.id')
      .execute();
  }

  /**
   * The relative, read through the branch filter, with a live link (any portal access) to an
   * active student of the branch today (decision 7); 404 otherwise, also for a relative whose
   * only child of the branch has left (must-fix 4 of the spec review).
   */
  private async inScope(
    transaction: Transaction,
    relativeId: string,
    today: SchoolDate,
  ): Promise<Linked> {
    const rows = await transaction
      .selectFrom('students as s')
      .innerJoin('student_relatives as l', 'l.student_id', 's.id')
      .innerJoin('relatives as r', 'r.id', 'l.relative_id')
      .innerJoin('relative_accounts as ra', 'ra.relative_id', 'r.id')
      .leftJoin('accounts as a', 'a.id', 'ra.account_id')
      .select([
        'r.id as relative_id',
        'r.full_name',
        's.id as student_id',
        's.first_name',
        's.last_name',
        'ra.account_id',
        'a.login',
        'a.must_change_password',
      ])
      .where('r.id', '=', relativeId)
      .where('l.unlinked_at', 'is', null)
      .where('r.archived_at', 'is', null)
      .where('r.merged_into', 'is', null)
      .where((builder) =>
        builder.exists(
          builder
            .selectFrom('student_statuses as st')
            .select('st.id')
            .whereRef('st.student_id', '=', 's.id')
            .where('st.status', '=', 'active')
            .where('st.valid_from', '<=', today)
            .where((inner) =>
              inner.or([inner('st.valid_until', 'is', null), inner('st.valid_until', '>', today)]),
            ),
        ),
      )
      .orderBy('s.last_name')
      .orderBy('s.first_name')
      .orderBy('s.id')
      .execute();
    const [one] = grouped(rows);
    if (one === undefined) {
      throw notFound();
    }
    return one;
  }

  /**
   * Every id of `printAgain` is a relative of the class: 404 for one of another branch or
   * unknown, 409 `parent_portal_off` for one linked to the class with portal access off on
   * every link.
   */
  private async refuseOutside(
    transaction: Transaction,
    classId: string,
    today: SchoolDate,
    ids: readonly string[],
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const all = new Set(
      (await this.ofClass(transaction, classId, today, false)).map((row) => row.relative_id),
    );
    const portal = new Set(
      (await this.ofClass(transaction, classId, today, true)).map((row) => row.relative_id),
    );
    if (ids.some((id) => !all.has(id))) {
      throw notFound();
    }
    if (ids.some((id) => !portal.has(id))) {
      throw new ApiException('parent_portal_off', 409);
    }
  }

  private async lockRelatives(transaction: Transaction, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await transaction
      .selectFrom('relative_accounts')
      .select('relative_id')
      .where('relative_id', 'in', [...ids])
      .orderBy('relative_id')
      .forUpdate()
      .execute();
  }

  private async slipOf(
    transaction: Transaction,
    accountId: string,
    branchId: string,
    now: Date,
  ): Promise<ParentSlip | null> {
    const found = await sql<{
      kind: 'first' | 'reset';
      printed_at: Date;
      valid_until: Date;
      valid: boolean;
      other_branch: boolean;
      class_name: string | null;
      class_grade: number | null;
    }>`
      select p.kind, p.printed_at, p.valid_until, p.valid, p.other_branch, p.class_name,
        c.grade as class_grade
      from parent_slip_state(${accountId}::uuid, ${branchId}::uuid, ${now}) p
      left join classes c on c.id = p.class_id
    `.execute(transaction);
    const row = found.rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      kind: row.kind,
      printedAt: new Date(row.printed_at).toISOString(),
      validUntil: new Date(row.valid_until).toISOString(),
      valid: row.valid,
      otherBranch: row.other_branch,
      className:
        row.class_name === null
          ? null
          : row.class_grade === null
            ? row.class_name
            : `${String(row.class_grade)} ${row.class_name}`,
    };
  }

  private async createAccount(
    transaction: Transaction,
    access: Access,
    one: Linked,
    password: { password: string; hash: string },
    requestId: string,
    branchId: string,
  ): Promise<string> {
    const base = parentLoginBase(one.fullName);
    const [first, last] = base.split('.');
    const created = await this.accounts.create(transaction, {
      firstName: first ?? '',
      lastName: last ?? '',
      login: undefined,
      createdBy: access.accountId,
      requestId,
      actingAssignmentId: access.assignmentId,
      personId: one.relativeId,
      firstPassword: password,
      validForMs: PARENT_FIRST_PASSWORD_VALID_MS,
      branchId,
      details: { parent: true },
    });
    await transaction
      .updateTable('relative_accounts')
      .set({ account_id: created.id, switched_on_at: await transactionMoment(transaction) })
      .where('relative_id', '=', one.relativeId)
      .execute();
    return created.login;
  }

  /** A new first password on an existing account: the earlier one fails, its sessions end. */
  private async givePassword(
    transaction: Transaction,
    accountId: string,
    hash: string,
    validUntil: Date,
  ): Promise<string> {
    const now = this.realClock.now();
    const changed = await transaction
      .updateTable('accounts')
      .set({
        password_hash: hash,
        must_change_password: true,
        password_expires_at: validUntil,
        password_reset_by: null,
        password_reset_at: null,
      })
      .where('id', '=', accountId)
      .returning('login')
      .executeTakeFirstOrThrow();
    await this.throttle.forget(transaction, changed.login);
    await this.sessions.writeEndsByTime(transaction, accountId);
    await transaction
      .updateTable('sessions')
      .set({ ended_at: now, end_reason: 'password_reset' })
      .where('account_id', '=', accountId)
      .where('ended_at', 'is', null)
      .execute();
    return changed.login;
  }

  private async recordSlip(
    transaction: Transaction,
    access: Access,
    slip: {
      branchId: string;
      relativeId: string;
      classId: string | null;
      kind: 'first' | 'reset';
      language: Language;
      printedAt: Date;
      validUntil: Date;
      again: boolean;
      requestId: string;
    },
  ): Promise<void> {
    const account = await transaction
      .selectFrom('relative_accounts')
      .select('account_id')
      .where('relative_id', '=', slip.relativeId)
      .executeTakeFirstOrThrow();
    if (account.account_id === null) {
      throw new Error('A slip is printed for a relative with an account.');
    }
    await transaction
      .insertInto('parent_slips')
      .values({
        branch_id: slip.branchId,
        account_id: account.account_id,
        relative_id: slip.relativeId,
        class_id: slip.classId,
        kind: slip.kind,
        language: slip.language,
        printed_at: slip.printedAt,
        valid_until: slip.validUntil,
        printed_by: access.accountId,
        assignment_id: access.assignmentId,
      })
      .execute();
    await this.audit.record(transaction, {
      branchId: slip.branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      personId: slip.relativeId,
      action: 'parent_account.slip',
      record: { type: 'relative', id: slip.relativeId },
      details: {
        kind: slip.kind,
        classId: slip.classId,
        language: slip.language,
        again: slip.again,
        validUntil: slip.validUntil.toISOString(),
      },
      requestId: slip.requestId,
    });
  }
}

/** Decision 4: signed in once a password was chosen; a valid slip is not printed again. */
function stateOf(one: Linked, slip: ParentSlip | null): ParentSlipState {
  if (one.accountId !== null && one.mustChangePassword === false) {
    return 'signed_in';
  }
  return slip?.valid === true ? 'valid_slip' : 'to_print';
}

