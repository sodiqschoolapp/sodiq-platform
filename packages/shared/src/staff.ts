import { z } from 'zod';
import { PHONE_FORMAT, storedPhone } from './phones.js';
import { schoolDateSchema } from './academic-year.js';
import { firstPasswordSlipSchema } from './accounts.js';
import { roleSchema, type Role } from './roles.js';
import { instructionLanguageSchema } from './settings.js';
import { subjectGradesSchema } from './subjects.js';

/**
 * Staff records (docs/spec/04-people.md, Teacher and staff record; task 2.2a,
 * pull request #53). The database keeps the same bounds and lists
 * (db/migrations/0024); tests compare them.
 */

/** A first name, a surname or a father's name (answer 13; decided on pull request #53). */
export const STAFF_NAME_MAX_LENGTH = 60;

/** Answer 12. */
export const EDUCATION_LEVELS = [
  'secondary',
  'specialised_secondary',
  'bachelor',
  'master',
  'phd',
  'other',
] as const;

export const educationLevelSchema = z.enum(EDUCATION_LEVELS);

export type EducationLevel = z.infer<typeof educationLevelSchema>;

export const SEXES = ['male', 'female'] as const;

export const sexSchema = z.enum(SEXES);

export type Sex = z.infer<typeof sexSchema>;

/** `04`: "Contract type (full or part time) and date." */
export const CONTRACT_TYPES = ['full_time', 'part_time'] as const;

export const contractTypeSchema = z.enum(CONTRACT_TYPES);

export type ContractType = z.infer<typeof contractTypeSchema>;

/** Answer 11 with the bounds of decision 12: lessons per week by contract and most lessons per day. */
export const WEEKLY_LESSONS_MAX = 60;
export const DAILY_LESSONS_MAX = 12;

/** `04`: "Status: Active, inactive, left." */
export const STAFF_STATUSES = ['active', 'inactive', 'left'] as const;

export const staffStatusSchema = z.enum(STAFF_STATUSES);

export type StaffStatus = z.infer<typeof staffStatusSchema>;

/**
 * The categories shown on a profile: the person's current roles in the
 * branch, taken from the assignments of the person's account, never typed,
 * of every role of `04` (Teacher and staff record, Personal; spec change of
 * 13 October 2026, item A2), in this order.
 */
export const STAFF_CATEGORY_ROLES = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'spiritual_vice_principal',
  'head_tutor',
  'tutor',
  'senior_head_teacher',
  'head_teacher',
  'teacher',
] as const satisfies readonly Role[];

/** S-YYNNNN (`04`; spec change of 12 October 2026). */
export const staffIdSchema = z.string().regex(/^S-[0-9]{6}$/);

/** The default country code of a phone typed in the form (`04`, Close relatives: "+998 by default"). */
export const DEFAULT_PHONE_PREFIX = '+998';

const OKINA = 'ʻ';
const MODIFIER_APOSTROPHE = 'ʼ';
/** The apostrophes a keyboard types: ', `, ʻ, ʼ, ’ and ‘. */
const APOSTROPHES = /['`ʻʼ’‘]/g;

/**
 * A name in its stored form (answer 13; review of pull request #53,
 * correction 9): outer spaces dropped, inner runs of spaces made one, and each
 * apostrophe stored as one letter: after o or g it is the ʻ of oʻ and gʻ
 * (U+02BB), elsewhere the sign ʼ (U+02BC). So "O'tkir", "O’tkir" and "Oʻtkir"
 * are one name, and the duplicate warning compares them as one.
 */
export function storedName(typed: string): string {
  const spaced = typed.trim().replace(/\s+/g, ' ');
  return spaced.replace(APOSTROPHES, (_mark, offset: number) => {
    const before = spaced.charAt(offset - 1).toLowerCase();
    return before === 'o' || before === 'g' ? OKINA : MODIFIER_APOSTROPHE;
  });
}

/** Latin letters, ʻ and ʼ, words joined by one space or hyphen; the check of the database. */
const STORED_NAME = /^[A-Za-zʻʼ]+([ -][A-Za-zʻʼ]+)*$/;

export const staffNameSchema = z
  .string()
  .transform(storedName)
  .pipe(z.string().min(1).max(STAFF_NAME_MAX_LENGTH).regex(STORED_NAME));

/** An optional name: empty means none. */
const optionalNameSchema = z
  .string()
  .transform(storedName)
  .transform((name) => (name === '' ? null : name))
  .pipe(z.string().max(STAFF_NAME_MAX_LENGTH).regex(STORED_NAME).nullable())
  .nullable();

/**
 * A phone with its country code, read by `storedPhone` (task 3.5b, H25): an
 * Uzbek number is "+998" and nine digits, another country's "+" and 7 to 15
 * digits (pull request #53, decision 11, narrowed for Uzbek numbers).
 */
export const staffPhoneSchema = z
  .string()
  .transform(storedPhone)
  .pipe(z.string().regex(PHONE_FORMAT));

const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((text) => (text === '' ? null : text))
  .pipe(z.email().max(254).nullable())
  .nullable();

/** JSHSHIR: the personal number of 14 digits; empty means none. */
export const jshshirSchema = z
  .string()
  .trim()
  .transform((text) => (text === '' ? null : text))
  .pipe(
    z
      .string()
      .regex(/^[0-9]{14}$/)
      .nullable(),
  )
  .nullable();

/**
 * The divisions of a record (`03`, Divisions): one main division and any
 * further ones, each once, each with its department when it has one. The
 * database also requires a department in Academic.
 */
export const staffDivisionsSchema = z
  .array(
    z.object({
      divisionId: z.uuid(),
      departmentId: z.uuid().nullable(),
      main: z.boolean(),
    }),
  )
  .min(1)
  .max(10)
  .superRefine((divisions, context) => {
    if (divisions.filter((division) => division.main).length !== 1) {
      context.addIssue({ code: 'custom', message: 'Exactly one main division.' });
    }
    if (new Set(divisions.map((division) => division.divisionId)).size !== divisions.length) {
      context.addIssue({ code: 'custom', message: 'Each division once.' });
    }
  });

export type StaffDivisions = z.infer<typeof staffDivisionsSchema>;

/**
 * What is typed for a person (`04`, Personal and Academic blocks), as the
 * create and the edit take it. Subjects and languages have a route of their
 * own (`staffTeachingSchema`), and so do the branches and the status.
 */
export const staffRecordSchema = z.object({
  firstName: staffNameSchema,
  lastName: staffNameSchema,
  fatherName: optionalNameSchema,
  sex: sexSchema,
  birthDate: schoolDateSchema,
  educationLevel: educationLevelSchema.nullable(),
  phone: staffPhoneSchema,
  email: optionalEmailSchema,
  jshshir: jshshirSchema,
  admissionDate: schoolDateSchema,
  contractType: contractTypeSchema.nullable(),
  contractDate: schoolDateSchema.nullable(),
  weeklyLessons: z.int().min(1).max(WEEKLY_LESSONS_MAX).nullable(),
  dailyLessons: z.int().min(1).max(DAILY_LESSONS_MAX).nullable(),
  divisions: staffDivisionsSchema,
  /**
   * The start date of a department move of the record (a change of the department of its Academic division) (`edge/people-roles-accounts`,
   * row 15; task 3.4c, decision 2): sent with a move only, today or later in
   * the branch's time zone and no later than the end of its latest year.
   */
  departmentStartsOn: schoolDateSchema.nullable().optional(),
});

export type StaffRecord = z.infer<typeof staffRecordSchema>;

/**
 * The fields the Academic Vice Principal may change (`edge/people-roles-accounts`,
 * Accounts and sign-in: "Phone, email and name are changed by the Super Admin
 * or Academic Vice Principal"); every other field is the Super Admin's.
 */
export const STAFF_CONTACT_FIELDS = [
  'firstName',
  'lastName',
  'fatherName',
  'phone',
  'email',
] as const satisfies readonly (keyof StaffRecord)[];

/** Subjects with the grades taught, and the languages of instruction (`04`). */
export const staffTeachingSchema = z
  .object({
    subjects: z
      .array(z.object({ subjectId: z.uuid(), grades: subjectGradesSchema }))
      .max(30)
      .refine((rows) => new Set(rows.map((row) => row.subjectId)).size === rows.length, {
        message: 'Each subject once.',
      }),
    languages: z
      .array(instructionLanguageSchema)
      .max(2)
      .refine((languages) => new Set(languages).size === languages.length, {
        message: 'Each language once.',
      }),
  })
  .refine((teaching) => teaching.subjects.length === 0 || teaching.languages.length > 0, {
    path: ['languages'],
    message: 'A language of instruction once there is a subject.',
  });

export type StaffTeaching = z.infer<typeof staffTeachingSchema>;

/** The branches of a person: the main one and any further ones (`04`). */
export const staffBranchesSchema = z
  .object({
    mainBranchId: z.uuid(),
    furtherBranchIds: z.array(z.uuid()).max(10),
  })
  .refine(
    (branches) =>
      !branches.furtherBranchIds.includes(branches.mainBranchId) &&
      new Set(branches.furtherBranchIds).size === branches.furtherBranchIds.length,
    { path: ['furtherBranchIds'], message: 'Each branch once.' },
  );

export type StaffBranches = z.infer<typeof staffBranchesSchema>;

/** A status from a date, today or later (`edge/people-roles-accounts`, Staff over time). */
export const staffStatusChangeSchema = z.object({
  status: staffStatusSchema,
  from: schoolDateSchema,
});

export type StaffStatusChange = z.infer<typeof staffStatusChangeSchema>;

/** The duplicate warning asks with what is typed (`edge/people-roles-accounts`, Staff over time). */
export const staffCheckSchema = z.object({
  firstName: staffNameSchema,
  lastName: staffNameSchema,
  birthDate: schoolDateSchema,
  phone: staffPhoneSchema,
  /** The record being edited, which is not its own duplicate. */
  staffRecordId: z.uuid().nullable(),
});

export type StaffCheck = z.infer<typeof staffCheckSchema>;

const staffMatchSchema = z.object({
  id: z.uuid(),
  staffId: staffIdSchema,
  firstName: z.string(),
  lastName: z.string(),
});

/**
 * Matches in the branch of the request are named; of other branches only
 * whether one exists (owner's answer 2 on pull request #53).
 */
export const staffCheckResultSchema = z.object({
  sameNameAndBirth: z.array(staffMatchSchema),
  elsewhere: z.boolean(),
  /**
   * The phone is another staff record's, archived and left included: refused
   * on Save (`edge/people-roles-accounts`, re-hire row; task 3.6b-1). The
   * record is named when it is of the branch of the request, `match: null`
   * for one of another branch. `null` when the phone is free.
   */
  phoneTaken: z.object({ match: staffMatchSchema.nullable() }).nullable(),
  /**
   * The relative whose main phone this is (task 3.6b-1): the two records
   * will be the same person, and the email is taken when none is typed
   * (decision 6, Look first). Named when linked live in the branch.
   */
  relative: z.object({ fullName: z.string(), email: z.string().nullable() }).nullable(),
  /** A relative not linked in the branch has the phone: marked, nothing of it told. */
  relativeElsewhere: z.boolean(),
});

export type StaffCheckResult = z.infer<typeof staffCheckResultSchema>;

/** A row of the status history. */
export const staffStatusRowSchema = z.object({
  id: z.uuid(),
  status: staffStatusSchema,
  from: schoolDateSchema,
  until: schoolDateSchema.nullable(),
});

export type StaffStatusRow = z.infer<typeof staffStatusRowSchema>;

/** A planned department move of a person's division (task 3.6b-3); the department is `null` for none. */
export const departmentMoveSchema = z.object({
  departmentId: z.uuid().nullable(),
  startsOn: schoolDateSchema,
});

/** A person as the list answers it: the columns of `04` that exist so far. */
export const staffListItemSchema = z.object({
  id: z.uuid(),
  staffId: staffIdSchema,
  firstName: z.string(),
  lastName: z.string(),
  fatherName: z.string().nullable(),
  categories: z.array(roleSchema),
  branches: z.array(z.object({ branchId: z.uuid(), name: z.string(), main: z.boolean() })),
  divisions: z.array(
    z.object({
      divisionId: z.uuid(),
      /**
       * The department in force today in the branch time of the request (task
       * 3.6b-3, decision 6): until a planned move's start date, the one before it.
       */
      departmentId: z.uuid().nullable(),
      main: z.boolean(),
      /** The date the department in force has held since (task 3.4c, decision 8); `null` if never moved. */
      departmentSince: schoolDateSchema.nullable(),
      /**
       * A move planned after today (task 3.6b-3): the department the rules
       * already read, and the date the record shows it from; `null` without one.
       */
      departmentMove: departmentMoveSchema.nullable(),
    }),
  ),
  subjects: z.array(z.object({ subjectId: z.uuid(), grades: z.array(z.int()) })),
  languages: z.array(instructionLanguageSchema),
  phone: z.string(),
  /** The status in force today in the main branch's time zone; `null` before the first row (admission later). */
  status: staffStatusSchema.nullable(),
  /** A change planned after today, if any. */
  planned: z.object({ status: staffStatusSchema, from: schoolDateSchema }).nullable(),
  /** The current photo (task 2.2c-2): a new id per upload, `null` when there is none. */
  photoId: z.uuid().nullable(),
});

export type StaffListItem = z.infer<typeof staffListItemSchema>;

export const staffListSchema = z.object({
  staff: z.array(staffListItemSchema),
  /** Today in the time zone of the branch of the request. */
  today: schoolDateSchema,
});

export type StaffList = z.infer<typeof staffListSchema>;

/**
 * What the account may do with the record, decided by the server from every
 * current assignment; the screen follows it (`.claude/rules/api.md`).
 */
export const staffRightsSchema = z.object({
  /** Every field of the record, the branches and the status: the Super Admin. */
  all: z.boolean(),
  /** Name, phone and email: the Super Admin and the Academic Vice Principal. */
  contact: z.boolean(),
  /** Subjects, grades and languages. */
  teaching: z.boolean(),
  /** The account section: the Super Admin and the Principal read it (task 2.3a, decision 4). */
  accounts: z.boolean(),
  /**
   * The section "Sign-in access": the Super Admin, the Academic Vice Principal
   * and the Principal read it (task 2.3c-1, decision 13); what each may change
   * comes with the section.
   */
  accountAccess: z.boolean(),
  /**
   * The email: `contact`, except on the caller's own record and, for the
   * Academic Vice Principal, on an account they may not lock and reset (task
   * 2.3c-2, decision 4 of pull request #66): the email opens the account.
   */
  email: z.boolean(),
});

export type StaffRights = z.infer<typeof staffRightsSchema>;

/**
 * "Classes taught, filled from the teaching load" (`04`, Teacher and staff
 * record, Academic; task 5.5c-2b): for each academic year of the branch of
 * the request that is not closed, the classes and groups of the person's rows
 * in the published version in force on the year's day (today, or the year's
 * first day when that is later), with their subjects; the years by start.
 */
export const classesTaughtSchema = z.array(
  z.object({
    academicYearId: z.uuid(),
    startDate: schoolDateSchema,
    endDate: schoolDateSchema,
    /** Classes first, by grade and name, then groups by name. */
    entries: z.array(
      z.object({
        kind: z.enum(['class', 'group']),
        id: z.uuid(),
        /** The grade of a class; `null` for a group, whose name holds it. */
        grade: z.int().nullable(),
        name: z.string(),
        subjectIds: z.array(z.uuid()),
      }),
    ),
  }),
);

export type ClassesTaught = z.infer<typeof classesTaughtSchema>;

/** A person as the record route answers it. */
export const staffDetailSchema = staffListItemSchema.extend({
  classesTaught: classesTaughtSchema,
  sex: sexSchema,
  /** `null` while hidden from the Principal (decision 9); `identityHidden` says so. */
  birthDate: schoolDateSchema.nullable(),
  jshshir: z.string().nullable(),
  identityHidden: z.boolean(),
  educationLevel: educationLevelSchema.nullable(),
  email: z.string().nullable(),
  admissionDate: schoolDateSchema,
  contractType: contractTypeSchema.nullable(),
  contractDate: schoolDateSchema.nullable(),
  weeklyLessons: z.int().nullable(),
  dailyLessons: z.int().nullable(),
  statuses: z.array(staffStatusRowSchema),
  rights: staffRightsSchema,
  today: schoolDateSchema,
  /**
   * The relative marked as the same person (`edge/close-relatives`, row 8;
   * task 2.5b-2, decision 6): for a reader holding `relatives` view, when the
   * relative is linked live in the branch of the request; `null` otherwise.
   */
  sameAsRelative: z.object({ id: z.uuid(), fullName: z.string() }).nullable(),
});

export type StaffDetail = z.infer<typeof staffDetailSchema>;

/**
 * The answer of a status change: the record, and the slip of a new first
 * password when the change re-hires a person with an account (task 2.3a,
 * decision 7: "Re-hiring restores the same record, staff ID and login with a
 * new employment period and a forced password change").
 */
export const staffStatusAnswerSchema = staffDetailSchema.extend({
  slip: firstPasswordSlipSchema.nullable(),
});

export type StaffStatusAnswer = z.infer<typeof staffStatusAnswerSchema>;

/** The identity fields shown on a logged "show" (decision 9). */
export const staffIdentitySchema = z.object({
  birthDate: schoolDateSchema,
  jshshir: z.string().nullable(),
});

export type StaffIdentity = z.infer<typeof staffIdentitySchema>;

export const staffParamsSchema = z.object({ id: z.uuid() });

export type StaffParams = z.infer<typeof staffParamsSchema>;
