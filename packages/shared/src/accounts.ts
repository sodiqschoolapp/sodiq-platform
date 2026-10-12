import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { branchIdSchema } from './branches.js';
import { roleSchema, type Role } from './roles.js';

/**
 * Accounts and roles (task 2.3a, pull request #62). `edge/people-roles-accounts`,
 * Who can act: "The Super Admin creates staff accounts and gives all roles";
 * rights are assignments with dates.
 */

/**
 * The login forms of the owner's answer 14 (`docs/decisions.md`, "Decided
 * ahead for tasks 2.1 to 2.6"): `a.karimov`, `akmal.karimov`,
 * `akmal.b.karimov`, then a number. The database checks the same form and
 * length (db/migrations/0027); a test compares them.
 */
export const LOGIN_FORMAT = /^[a-z]+(\.[a-z]+){1,2}[0-9]*$/;

export const LOGIN_MAX_LENGTH = 64;

export const loginSchema = z.string().max(LOGIN_MAX_LENGTH).regex(LOGIN_FORMAT);

/**
 * The roles a Super Admin gives on the account section in 2.3a (decision 6):
 * the Head Teacher and the Senior Head Teacher come with their subjects in
 * 2.3b; Student and Parent are Release 2; HR, Nurse, Psychologist and
 * Librarian Release 3 (`02`).
 */
export const GIVABLE_ROLES = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'spiritual_vice_principal',
  'head_tutor',
  'tutor',
  'teacher',
] as const satisfies readonly Role[];

export const givableRoleSchema = z.enum(GIVABLE_ROLES);

export type GivableRole = z.infer<typeof givableRoleSchema>;

/** A first and last name, from a staff record. */
export const personNameSchema = z.object({ firstName: z.string(), lastName: z.string() });

export type PersonName = z.infer<typeof personNameSchema>;

/** The login chosen in the form: the suggestion or one the Super Admin typed. */
export const accountCreateSchema = z.object({ login: loginSchema });

export type AccountCreate = z.infer<typeof accountCreateSchema>;

/**
 * The first free login of answer 14 for the person; `null` when no form fits
 * the length and the Super Admin types one.
 */
export const loginSuggestionSchema = z.object({ login: loginSchema.nullable() });

export type LoginSuggestion = z.infer<typeof loginSuggestionSchema>;

/**
 * The slip of a first password (answer 15: "a printable page from the
 * browser, one slip per person"). Answered once, by the create and by a
 * re-hire, and stored nowhere ("printed once on per-person slips and not
 * stored", Accounts and sign-in).
 */
export const firstPasswordSlipSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  login: z.string(),
  password: z.string(),
  /** The first password works until this moment (7 days). */
  validUntil: z.iso.datetime(),
});

export type FirstPasswordSlip = z.infer<typeof firstPasswordSlipSchema>;

/**
 * Who gave or ended a role: the name when the staff record of that account
 * is in a branch the request may read, the login otherwise (correction 1 of
 * the review of pull request #62).
 */
export const actorSchema = z.object({ login: z.string(), name: personNameSchema.nullable() });

export type Actor = z.infer<typeof actorSchema>;

/** `planned`: begins later; `current`: in force now; `ended`: its end has come, or it was taken back. */
export const ROLE_STATES = ['planned', 'current', 'ended'] as const;

export const roleStateSchema = z.enum(ROLE_STATES);

/** One assignment of the account, with its dates in the time zone of its branch (of the school without one). */
export const accountRoleSchema = z.object({
  id: z.uuid(),
  role: roleSchema,
  branchId: branchIdSchema.nullable(),
  branchName: z.string().nullable(),
  from: schoolDateSchema,
  /** The first day without the role; `null` while it has no end. */
  until: schoolDateSchema.nullable(),
  state: roleStateSchema,
  givenBy: actorSchema.nullable(),
  endedBy: actorSchema.nullable(),
});

export type AccountRole = z.infer<typeof accountRoleSchema>;

/** The account of a staff record. */
export const accountDetailSchema = z.object({
  login: z.string(),
  createdAt: z.iso.datetime(),
  /** No session was ever opened with the account. */
  neverUsed: z.boolean(),
  locked: z.boolean(),
  roles: z.array(accountRoleSchema),
});

export type AccountDetail = z.infer<typeof accountDetailSchema>;

/** The account section of a staff record: its account, or none yet. */
export const staffAccountSchema = z.object({
  account: accountDetailSchema.nullable(),
  /**
   * Whether the reader may create the account and give and end roles: the
   * Super Admin (decided by the server from every current assignment).
   */
  canEdit: z.boolean(),
  /** The person has left for good: no account and no role is given (decision 12). */
  left: z.boolean(),
  /** Today in the time zone of the branch of the request: the first date a role may be given or ended. */
  today: schoolDateSchema,
});

export type StaffAccount = z.infer<typeof staffAccountSchema>;

/** A role from a date (decision 10): no branch for the Super Admin, one of the person's branches for every other role. */
export const roleGiveSchema = z.object({
  role: givableRoleSchema,
  branchId: branchIdSchema.nullable(),
  from: schoolDateSchema,
});

export type RoleGive = z.infer<typeof roleGiveSchema>;

/** The end of a role from a date: today ends it now, a later date at 00:00 of that day. */
export const roleEndSchema = z.object({ from: schoolDateSchema });

export type RoleEnd = z.infer<typeof roleEndSchema>;

export const roleParamsSchema = z.object({ id: z.uuid(), assignmentId: z.uuid() });

export type RoleParams = z.infer<typeof roleParamsSchema>;

/** The number of active Super Admins, for the banner while fewer than two exist (Accounts and sign-in). */
export const superAdminSummarySchema = z.object({ active: z.int().nonnegative() });

export type SuperAdminSummary = z.infer<typeof superAdminSummarySchema>;
