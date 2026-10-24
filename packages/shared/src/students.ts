import { z } from 'zod';
import { phoneLeftEmpty } from './phones.js';
import { schoolDateSchema } from './academic-year.js';
import { personNameSchema } from './accounts.js';
import { classNotRestoredSchema, studentClassSchema } from './classes.js';
import { studentGroupSchema } from './groups.js';
import { moveClassSchema, moveGroupSchema, studentMoveSchema } from './moves.js';
import { branchMoveLineSchema, studentBranchMoveSchema } from './branch-moves.js';
import { spellingKey, storedStudentName, validName } from './names.js';
import { studentRelativesInputSchema } from './relatives.js';
import { jshshirSchema, sexSchema, staffPhoneSchema } from './staff.js';
import { journalEntriesChoiceSchema } from './journal-entries.js';

/**
 * Student records (docs/spec/04-people.md, Student record, UID sets; task
 * 2.4a, pull request #67). The database keeps the same bounds and lists
 * (db/migrations/0032); tests compare them.
 */

/** A first name, a surname or a paternal name. */
export const STUDENT_NAME_MAX_LENGTH = 60;
export const STUDENT_ADDRESS_MAX_LENGTH = 200;
export const PREVIOUS_SCHOOL_MAX_LENGTH = 120;
export const CONTRACT_NUMBER_MAX_LENGTH = 30;
export const UID_REASON_MAX_LENGTH = 500;
/** A partial scholarship's amount in so'm (answer 21); the bound of the database. */
export const SCHOLARSHIP_AMOUNT_MAX = 1_000_000_000;

/** `04`: "Status: Active ... Inactive (archived) ... Graduated." */
export const STUDENT_STATUSES = ['active', 'inactive', 'graduated'] as const;

export const studentStatusSchema = z.enum(STUDENT_STATUSES);

export type StudentStatus = z.infer<typeof studentStatusSchema>;

/**
 * A student active today whose start date is still ahead (`04`, Student
 * record: a student is active before the start date, #42 task 2.4a): shown
 * "From <date>" in place of "Active" until that day (issue #105, H13). The
 * status filter still counts the student as active.
 */
export const startsLater = (
  student: { status: StudentStatus | null; startsOn: string },
  today: string,
): boolean => student.status === 'active' && student.startsOn > today;

/**
 * What wrote a status row (task 2.4b-1, decision 8): the create, a leaving,
 * a return, an undo of a leaving, the cancel of a scheduled one, the
 * graduation (task 9.5a) and the Super Admin's restore of a graduated student.
 */
export const STATUS_CAUSES = [
  'start',
  'leaving',
  'return',
  'undo',
  'cancel',
  'graduation',
  'restore',
] as const;

export const statusCauseSchema = z.enum(STATUS_CAUSES);

export type StatusCause = z.infer<typeof statusCauseSchema>;

/** The reason of a leaving, an undo, a return or a restore; the bound of the database (0033). */
export const STATUS_REASON_MAX_LENGTH = 500;

/** `04`: "passport or ID with JSHSHIR or birth certificate number". */
export const DOCUMENT_TYPES = ['passport', 'id_card', 'birth_certificate'] as const;

export const documentTypeSchema = z.enum(DOCUMENT_TYPES);

export type DocumentType = z.infer<typeof documentTypeSchema>;

/** Answer 19: the 12 regions, the Republic of Karakalpakstan, Tashkent city, and "Other". */
export const REGIONS = [
  'andijan',
  'bukhara',
  'fergana',
  'jizzakh',
  'kashkadarya',
  'khorezm',
  'namangan',
  'navoi',
  'samarkand',
  'surkhandarya',
  'syrdarya',
  'tashkent_region',
  'karakalpakstan',
  'tashkent_city',
  'other',
] as const;

export const regionSchema = z.enum(REGIONS);

export type Region = z.infer<typeof regionSchema>;

/** Answer 21. */
export const SCHOLARSHIP_TYPES = ['none', 'merit', 'financial_aid', 'gift'] as const;

export const scholarshipTypeSchema = z.enum(SCHOLARSHIP_TYPES);

export type ScholarshipType = z.infer<typeof scholarshipTypeSchema>;

export const SCHOLARSHIP_COVERAGES = ['full', 'partial'] as const;

export const scholarshipCoverageSchema = z.enum(SCHOLARSHIP_COVERAGES);

export type ScholarshipCoverage = z.infer<typeof scholarshipCoverageSchema>;

/** Grades 1 to 11 (answer 17). */
export const studentGradeSchema = z.int().min(1).max(11);

/** Seven digits (`04`, UID sets; the "SI" of the main file is not typed or stored). */
export const studentUidSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{7}$/);

export { spellingKey, storedStudentName };

/** Answer 18: typed as on the student's document, Latin or Cyrillic. */
export const studentNameSchema = z
  .string()
  .transform(storedStudentName)
  .pipe(z.string().min(1).max(STUDENT_NAME_MAX_LENGTH).refine(validName));

const optionalStudentNameSchema = z
  .string()
  .transform(storedStudentName)
  .transform((name) => (name === '' ? null : name))
  .pipe(z.string().max(STUDENT_NAME_MAX_LENGTH).refine(validName).nullable())
  .nullable();

/** The folded surname and first name, as `students.name_key` stores it. */
export function studentNameKey(lastName: string, firstName: string): string {
  return `${spellingKey(lastName)} ${spellingKey(firstName)}`;
}

/**
 * `04`, UID sets: the set of each grade in 2026–2027. "A set belongs to the
 * students who are in a grade together and moves up with them ... a new set
 * is opened for the new grade 1".
 */
export const UID_SETS_2026: Readonly<Record<number, string>> = {
  1: '2601',
  2: '2602',
  3: '2603',
  4: '2604',
  5: '2605',
  6: '2606',
  7: '2607',
  8: '2507',
  9: '2407',
  10: '2307',
  11: '2308',
};

/**
 * The set of a grade in the academic year that begins in `yearStart` (decision
 * 5): the table of 2026–2027 moved up one grade per year; a grade 1 of a later
 * year has the new set `<YY>01`. `null` when no set is known (a year before
 * 2026 whose grade was past 11 in 2026–2027).
 */
export function uidSetOf(grade: number, yearStart: number): string | null {
  const shift = yearStart - 2026;
  const gradeIn2026 = grade - shift;
  if (gradeIn2026 >= 1) {
    return UID_SETS_2026[gradeIn2026] ?? null;
  }
  // A grade 1 of the year that began in yearStart - (grade - 1).
  const firstYear = yearStart - (grade - 1);
  return `${String(firstYear % 100).padStart(2, '0')}01`;
}

/**
 * The academic year whose UID sets a new student or a corrected UID is checked
 * against (decision 5 of task 2.4a as changed by correction 2 of #67): the
 * year of the branch that holds the start date, or the first that begins
 * after it. `undefined` when the branch has none. One rule for the check of
 * the API and the set named in its warning (task 2.7b-1, decision 7).
 */
export function uidYearOf<Year extends { readonly startDate: string; readonly endDate: string }>(
  startsOn: string,
  years: readonly Year[],
): Year | undefined {
  return years
    .filter((year) => year.endDate >= startsOn)
    .reduce<Year | undefined>(
      (first, year) => (first === undefined || year.startDate < first.startDate ? year : first),
      undefined,
    );
}

/** The set of a grade in an academic year, by the year's start date. */
export const uidSetFor = (grade: number, year: { readonly startDate: string }): string | null =>
  uidSetOf(grade, Number(year.startDate.slice(0, 4)));

/** Whether a UID is outside the set of the grade: the warning to confirm (`04`, Release 1). */
export function uidOutsideSet(uid: string, grade: number, yearStart: number): boolean {
  const set = uidSetOf(grade, yearStart);
  return set !== null && !uid.startsWith(set);
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .transform((text) => (text === '' ? null : text))
    .pipe(z.string().max(max).nullable())
    .nullable();

const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((text) => (text === '' ? null : text))
  .pipe(z.email().max(254).nullable())
  .nullable();

/** A phone with its country code (as staff), empty means none. */
const optionalPhoneSchema = z
  .string()
  .transform((typed) => (phoneLeftEmpty(typed) ? '' : typed.replace(/[\s().-]/g, '')))
  .transform((text) => (text === '' ? null : text))
  .pipe(staffPhoneSchema.nullable())
  .nullable();

/** A document number: spaces dropped, upper case, letters, digits and hyphens, 4 to 20. */
export const documentNumberSchema = z
  .string()
  .transform((typed) => typed.replace(/\s+/g, '').toUpperCase())
  .transform((text) => (text === '' ? null : text))
  .pipe(
    z
      .string()
      .regex(/^[A-Z0-9][A-Z0-9-]{2,18}[A-Z0-9]$/)
      .nullable(),
  )
  .nullable();

/** A contract number: outer spaces dropped, inner runs made one (answer 22: unique without case). */
export const contractNumberSchema = z
  .string()
  .transform((typed) => typed.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1).max(CONTRACT_NUMBER_MAX_LENGTH));

export const studentContractSchema = z.object({
  number: contractNumberSchema,
  signedOn: schoolDateSchema,
});

export type StudentContract = z.infer<typeof studentContractSchema>;

/** Answer 21: a type, full or partial for a scholarship, an amount for a partial one. */
export const scholarshipSchema = z
  .object({
    type: scholarshipTypeSchema,
    coverage: scholarshipCoverageSchema.nullable(),
    amount: z.int().min(1).max(SCHOLARSHIP_AMOUNT_MAX).nullable(),
  })
  .refine((scholarship) => (scholarship.type === 'none') === (scholarship.coverage === null), {
    path: ['coverage'],
    message: 'Full or partial for a scholarship, nothing otherwise.',
  })
  .refine((scholarship) => (scholarship.coverage === 'partial') === (scholarship.amount !== null), {
    path: ['amount'],
    message: 'An amount for a partial scholarship only.',
  });

export type Scholarship = z.infer<typeof scholarshipSchema>;

const studentFields = {
  firstName: studentNameSchema,
  lastName: studentNameSchema,
  paternalName: optionalStudentNameSchema,
  sex: sexSchema,
  birthDate: schoolDateSchema,
  grade: studentGradeSchema,
  documentType: documentTypeSchema.nullable(),
  documentNumber: documentNumberSchema,
  jshshir: jshshirSchema,
  phone: optionalPhoneSchema,
  email: optionalEmailSchema,
  address: optionalText(STUDENT_ADDRESS_MAX_LENGTH),
  region: regionSchema.nullable(),
  previousSchool: optionalText(PREVIOUS_SCHOOL_MAX_LENGTH),
  diagnosticScore: z.int().min(0).max(100).nullable(),
  scholarship: scholarshipSchema,
  consentSignedOn: schoolDateSchema.nullable(),
  contract: studentContractSchema,
};

const documentPair = (record: {
  documentType: DocumentType | null;
  documentNumber: string | null;
}): boolean => (record.documentType === null) === (record.documentNumber === null);

const DOCUMENT_PAIR = {
  path: ['documentNumber'],
  message: 'A document type and its number, both or neither.',
};

/**
 * What is typed for a student, as the edit takes it: every field but the UID
 * (strict: a `uid` is refused; the UID has a correction route of its own) and
 * the start date, where the first status row begins (fixed at the create;
 * decided in the build of task 2.4a).
 */
export const studentRecordSchema = z
  .strictObject(studentFields)
  .refine(documentPair, DOCUMENT_PAIR);

export type StudentRecord = z.infer<typeof studentRecordSchema>;

/** The create: the record, the start date, the UID and the confirmation of a UID outside the grade's set. */
export const studentCreateSchema = z
  .strictObject({
    ...studentFields,
    startsOn: schoolDateSchema,
    uid: studentUidSchema,
    confirmUidSet: z.boolean(),
    /** At least one relative, exactly one main contact (`04`, Close relatives; task 2.5a). */
    relatives: studentRelativesInputSchema,
    /**
     * The class the student joins on the start date (task 3.1b, decision 2):
     * required when the start date is today or earlier in the branch's time
     * zone (`student_needs_class`), optional for a later start.
     */
    classId: z.uuid().nullable().default(null),
  })
  .refine(documentPair, DOCUMENT_PAIR);

export type StudentCreate = z.infer<typeof studentCreateSchema>;

/**
 * The correction of a mistyped UID (edge: "A mistyped UID can be corrected by
 * the Academic Vice Principal with a reason; the old value stays in history").
 */
export const studentUidCorrectionSchema = z.strictObject({
  uid: studentUidSchema,
  reason: z.string().trim().min(1).max(UID_REASON_MAX_LENGTH),
  confirmUidSet: z.boolean(),
});

export type StudentUidCorrection = z.infer<typeof studentUidCorrectionSchema>;

/** The duplicate warning asks with what is typed (edge: "A matching name and date of birth"). */
export const studentCheckSchema = z.strictObject({
  firstName: studentNameSchema,
  lastName: studentNameSchema,
  birthDate: schoolDateSchema,
  /** The record being edited, which is not its own duplicate. */
  studentId: z.uuid().nullable(),
});

export type StudentCheck = z.infer<typeof studentCheckSchema>;

/**
 * Matches in the branch of the request are named; of other branches only
 * whether one exists (decision 3 of pull request #67).
 */
export const studentCheckResultSchema = z.object({
  sameNameAndBirth: z.array(
    z.object({
      id: z.uuid(),
      uid: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      status: studentStatusSchema.nullable(),
    }),
  ),
  elsewhere: z.boolean(),
});

export type StudentCheckResult = z.infer<typeof studentCheckResultSchema>;

/**
 * The groups of readers of the student record (`edge/people-roles-accounts`,
 * Personal data and the audit log; decision 4 of pull request #67): Basic for
 * all staff of the branch, then Contact, Identity and Financial.
 */
/**
 * The groups of fields of a student (edge/people-roles-accounts, Personal data
 * and the audit log); `diagnostic` is the diagnostic score, which has readers
 * of its own (task 3.6a, owner's answer L50).
 */
export const STUDENT_FIELD_GROUPS = [
  'basic',
  'contact',
  'identity',
  'financial',
  'diagnostic',
] as const;

export const studentFieldGroupSchema = z.enum(STUDENT_FIELD_GROUPS);

export type StudentFieldGroup = z.infer<typeof studentFieldGroupSchema>;

/** A student as the list answers it: the Basic group (edge, Personal data) and the status. */
export const studentListItemSchema = z.object({
  id: z.uuid(),
  uid: z.string(),
  /**
   * The UIDs of the records merged into this one (task 3.3d; the System
   * block's "Also UID ...", and the list's UID search), by the moment of
   * the merge, each record's current UID first. For every reader.
   */
  mergedUids: z.array(z.string()),
  firstName: z.string(),
  lastName: z.string(),
  paternalName: z.string().nullable(),
  sex: sexSchema,
  grade: studentGradeSchema,
  startsOn: schoolDateSchema,
  /** The current photo (Basic: "name, class, photo, UID"; task 2.4b-2), `null` when there is none. */
  photoId: z.uuid().nullable(),
  /**
   * Whether no enrolment consent is recorded (answer 23: "a list shows active
   * students without it"); `null` for a reader without the Financial group,
   * where the consent belongs (decision 4 of pull request #67).
   */
  consentMissing: z.boolean().nullable(),
  /**
   * The status in force today in the branch's time zone: from the create on,
   * also before the start date (`startsLater`); `null` only without a status row.
   */
  status: studentStatusSchema.nullable(),
  /**
   * The next change after the status shown, when it begins after today: a
   * scheduled leaving shows "leaves on …" (edge: "the student shows the
   * current class with a badge"). `from` is the first day of the new status.
   */
  planned: z.object({ status: studentStatusSchema, from: schoolDateSchema }).nullable(),
  /** The class in force today; `null` shows "—" (task 3.1b). */
  class: studentClassSchema.nullable(),
  /** A class the student joins after today: a placement before the start, or before the date (decision 6). */
  plannedClass: studentClassSchema.nullable(),
  /** The Tutor of the class in force today, and the acting Tutor beside them. */
  tutor: personNameSchema.nullable(),
  actingTutor: personNameSchema.nullable(),
  /**
   * The groups of the student (`04`, Student list: "class …, groups, tutor";
   * task 3.2b): in force today, else the first planned, one per subject, by
   * name. A Tutor reads them on the rows of own classes only (decision 4 of
   * pull request #92): empty on the others.
   */
  groups: z.array(studentGroupSchema),
  /**
   * The number of status rows and class rows: every status change and every
   * placement writes one or more, so a change sent with an older number is
   * refused `student_changed` (edge: "The second one gets \"student changed,
   * reload\""; task 3.1b, decision 17).
   */
  version: z.int().min(0),
  /**
   * Whether this reader may open the record (task 3.1c, decision 8 of pull
   * request #90): decided by the server with the rule of the record, so a
   * Tutor opens the rows of own classes only and still reads the whole list.
   */
  opens: z.boolean(),
});

export type StudentListItem = z.infer<typeof studentListItemSchema>;

export const studentListSchema = z.object({
  students: z.array(studentListItemSchema),
  /** Leave, return and delete: the Super Admin and the Academic Vice Principal (task 2.4b-1). */
  canArchive: z.boolean(),
  /**
   * The groups this reader may export in the branch of the request (task
   * 2.4b-2, decisions 1 to 3; task 3.6a): empty without `students`
   * `export`; the groups of each role in `EXPORT_GROUPS_OF_ROLE` of the API.
   */
  exportGroups: z.array(studentFieldGroupSchema),
  /**
   * The list holds the students the reader teaches only: a Teacher who reads
   * no other student (task 3.6a, L48). The server always sends it.
   */
  taughtOnly: z.boolean().optional(),
  /** The reader reads the Financial group: the consent filter is offered (answer 23). */
  readsFinancial: z.boolean(),
  /** Today in the time zone of the branch of the request. */
  today: schoolDateSchema,
});

export type StudentList = z.infer<typeof studentListSchema>;

/**
 * The query of the student list: `consent=missing` answers only the active
 * students without consent (answer 23), and is refused to a reader without
 * the Financial group (review of pull request #70, correction 1).
 */
export const studentListQuerySchema = z.strictObject({
  consent: z.literal('missing').optional(),
});

export type StudentListQuery = z.infer<typeof studentListQuerySchema>;

/**
 * The counter of the Academic Vice Principal's home page (edge: "An active
 * student with no class ... appear ... in a counter on the Academic Vice
 * Principal's home page"): the students active today with no class.
 */
export const studentNoClassSchema = z.object({ count: z.int().min(0) });

export type StudentNoClass = z.infer<typeof studentNoClassSchema>;

/** The Contact group: "phones of student and relatives" (edge), and the email (decision 4). */
export const studentContactSchema = z.object({
  phone: z.string().nullable(),
  email: z.string().nullable(),
});

export type StudentContact = z.infer<typeof studentContactSchema>;

/** The Identity group: "document numbers, address, date of birth" (edge), and the region (decision 4). */
export const studentIdentitySchema = z.object({
  birthDate: schoolDateSchema,
  documentType: documentTypeSchema.nullable(),
  documentNumber: z.string().nullable(),
  jshshir: z.string().nullable(),
  address: z.string().nullable(),
  region: regionSchema.nullable(),
});

export type StudentIdentity = z.infer<typeof studentIdentitySchema>;

/**
 * The Financial group: "contract, scholarship, stipend" (edge), with the
 * previous school and the consent (decision 4). The diagnostic score has
 * readers of its own (task 3.6a, owner's answer L50): `diagnosticScore` of
 * the record.
 */
export const studentFinancialSchema = z.object({
  /** Every contract, newest first. */
  contracts: z.array(z.object({ id: z.uuid(), number: z.string(), signedOn: schoolDateSchema })),
  scholarship: scholarshipSchema,
  previousSchool: z.string().nullable(),
  consentSignedOn: schoolDateSchema.nullable(),
});

export type StudentFinancial = z.infer<typeof studentFinancialSchema>;

/** A row of the status history. */
export const studentStatusRowSchema = z.object({
  status: studentStatusSchema,
  from: schoolDateSchema,
  until: schoolDateSchema.nullable(),
  cause: statusCauseSchema,
  /** For the Financial readers only (task 2.4b-1, decision 9); `null` otherwise or when none was given. */
  reason: z.string().nullable(),
});

export type StudentStatusRow = z.infer<typeof studentStatusRowSchema>;

/**
 * A student as the record route answers it: each group the reader may see,
 * `null` for a group they may not (edge/people-roles-accounts, Personal data
 * and the audit log). The Principal sees Identity hidden, with a logged show.
 */
export const studentDetailSchema = studentListItemSchema.extend({
  contact: studentContactSchema.nullable(),
  identity: studentIdentitySchema.nullable(),
  /** `identity` is `null` and a show is offered (the Principal). */
  identityHidden: z.boolean(),
  financial: studentFinancialSchema.nullable(),
  /**
   * The entrance diagnostic score (task 3.6a, owner's answer L50): read by
   * the readers of Financial, the Head Teachers and the class Tutor; `null`
   * when not typed or not read (`readsDiagnostic`).
   */
  diagnosticScore: z.int().nullable(),
  readsDiagnostic: z.boolean(),
  statuses: z.array(studentStatusRowSchema),
  /** The Academic block (task 3.1b): the main classroom of the class shown, by name. */
  mainRoom: z.string().nullable(),
  /**
   * The classes a cancel or an undo of a leaving could not give back: archived
   * meanwhile, or in a closed year (decision 1). Answered by those changes only.
   */
  classesNotRestored: z.array(classNotRestoredSchema).optional(),
  /**
   * The class the student left, which the return form offers first (task
   * 3.3b): answered to a reader who may return the student, while the
   * student is inactive; `null` when no class was left.
   */
  classLeft: studentClassSchema.nullable().optional(),
  /**
   * The groups a return or a graduate restore placed automatically, tagged
   * for review (task 3.3b): the notice of "Put into a class". Answered by those
   * changes only.
   */
  groupsPlaced: z
    .array(z.object({ studentId: z.uuid(), groupId: z.uuid(), subjectId: z.uuid() }))
    .optional(),
  /** Edit and UID correction: the Super Admin and the Academic Vice Principal. */
  canEdit: z.boolean(),
  /** Leave, cancel, undo, return and delete (task 2.4b-1). */
  canArchive: z.boolean(),
  /** The restore of a graduated student: the Super Admin (task 2.4b-1). */
  canRestoreGraduated: z.boolean(),
  /** The delete of a student created twice is open: no data (`students_delete_guard`, 0033). */
  deletable: z.boolean(),
  /**
   * The scheduled moves of the student (task 3.3a; edge: "the student shows
   * the current class with a badge"), by date: changed or cancelled until
   * their date.
   */
  scheduledMoves: z.array(studentMoveSchema),
  /** The Academic block's "transfer history" (`04`, Student record): the latest class move begun, if any. */
  lastClassMove: studentMoveSchema.nullable(),
  /** Class transfers: `classes` `edit`, the Super Admin and the Academic Vice Principal (task 3.3a, decision 3). */
  canMoveClass: z.boolean(),
  /**
   * The subjects whose group rows of the student this reader may move
   * (`group_transfers` `edit` in its scope, task 3.3a, decision 2), by id.
   */
  groupMoveSubjects: z.array(z.uuid()),
  /** A move dated before today: the Super Admin and the Academic Vice Principal (task 3.3a, decision 4). */
  canMoveInPast: z.boolean(),
  /** The History tab (`student_history` `view` in its scope; task 3.3a, decision 9). */
  readsHistory: z.boolean(),
  /**
   * The open release of the student to another branch (task 3.3c; the badge
   * of the sending branch), for a reader of `branch_moves`; `null` when none.
   */
  branchMove: studentBranchMoveSchema.nullable(),
  /** The Academic block: the latest accepted move to this branch (decision 3), for every reader of the record. */
  lastBranchMove: studentBranchMoveSchema.nullable(),
  /** Release and cancel: `branch_moves` `edit` (task 3.3c). */
  canMoveBranch: z.boolean(),
  /** The merge with another record: `student_merges` `edit`, the Super Admin (task 3.3d). */
  canMerge: z.boolean(),
  today: schoolDateSchema,
});

export type StudentDetail = z.infer<typeof studentDetailSchema>;

/**
 * An earlier date and target of a scheduled move that was changed (task 3.5c,
 * H34 of issue #105): one move with its changes, oldest first.
 */
export const moveChangeLineSchema = z.object({
  from: schoolDateSchema,
  toClass: moveClassSchema.nullable(),
  toGroup: moveGroupSchema.nullable(),
});

export type MoveChangeLine = z.infer<typeof moveChangeLineSchema>;

/**
 * One line of the History tab (`04`, Profile tabs; Movements: "The profile
 * History tab shows each move with dates"; task 3.3a): a move, with the
 * earlier dates and targets of a scheduled move changed into it (task 3.5c,
 * H34); one stay in a class or a group, from its first day (task 3.5c, H35:
 * "one line per stay in a class, from its first to its last day (or
 * 'hozirgacha')"); a stretch of one status, two adjacent active rows of a
 * cancel or an undo drawn as one. `until` is the first day after on every
 * line; on a stay `null` while it has no end and reaches past today ("until
 * now", or "from <date>" for a stay that begins after today).
 */
export const studentHistoryLineSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('move'),
    move: studentMoveSchema,
    changes: z.array(moveChangeLineSchema),
  }),
  branchMoveLineSchema,
  z.object({
    kind: z.literal('class'),
    class: moveClassSchema,
    from: schoolDateSchema,
    until: schoolDateSchema.nullable(),
  }),
  z.object({
    kind: z.literal('group'),
    group: moveGroupSchema,
    subjectId: z.uuid(),
    from: schoolDateSchema,
    until: schoolDateSchema.nullable(),
  }),
  z.object({
    kind: z.literal('status'),
    status: studentStatusSchema,
    cause: statusCauseSchema,
    from: schoolDateSchema,
    until: schoolDateSchema.nullable(),
  }),
  /**
   * A record merged into this one (task 3.3d): the day of the merge in the
   * branch of the request, the merged UID and the reason.
   */
  z.object({
    kind: z.literal('merged'),
    on: schoolDateSchema,
    uid: z.string(),
    reason: z.string(),
  }),
]);

export type StudentHistoryLine = z.infer<typeof studentHistoryLineSchema>;

/** The History tab: newest first, by date, then the order the lines were written (should-fix 8). */
export const studentHistorySchema = z.object({
  lines: z.array(studentHistoryLineSchema),
  today: schoolDateSchema,
});

export type StudentHistory = z.infer<typeof studentHistorySchema>;

export const studentParamsSchema = z.object({ id: z.uuid() });

export type StudentParams = z.infer<typeof studentParamsSchema>;

const statusReasonSchema = z.string().trim().min(1).max(STATUS_REASON_MAX_LENGTH);

/** The status state the person saw (`version` of the list or the record). */
const versionSchema = z.int().min(0);

/**
 * Leaving the school (`04`, Movements: "Asks for confirmation, date and
 * reason"; edge: "The leave date is the last day as a student").
 */
export const studentLeavingSchema = z.strictObject({
  lastDay: schoolDateSchema,
  reason: statusReasonSchema,
  version: versionSchema,
  /** The entries after the last day that the leaving does not void by itself, voided with a reason (task 8.6). */
  journalEntries: journalEntriesChoiceSchema.optional(),
});

export type StudentLeaving = z.infer<typeof studentLeavingSchema>;

/** The cancel of a scheduled leaving (edge: "It can be changed or cancelled until the date"). */
export const studentCancelLeavingSchema = z.strictObject({ version: versionSchema });

export type StudentCancelLeaving = z.infer<typeof studentCancelLeavingSchema>;

/** Edge: "A leaving entered by mistake has its own \"undo leaving\" action with a reason." */
export const studentUndoLeavingSchema = z.strictObject({
  reason: statusReasonSchema,
  version: versionSchema,
});

export type StudentUndoLeaving = z.infer<typeof studentUndoLeavingSchema>;

/**
 * Coming back from the Inactive list (`04`, Movements; edge: "Contracts are
 * kept as a dated list, and a return adds a new one"), into the grade the
 * student returns to (decision 7).
 */
export const studentReturnSchema = z.strictObject({
  from: schoolDateSchema,
  grade: studentGradeSchema,
  /** The class the student comes back to, from `from` (task 3.3b, decision 13). */
  classId: z.uuid(),
  contract: studentContractSchema,
  reason: statusReasonSchema.nullable(),
  /** The class left teaches in another language: the return is confirmed (task 3.3b, decision 2). */
  confirmLanguage: z.boolean().optional(),
  version: versionSchema,
  /** Into another class: the entries of the journals left on or after `from`, voided with a reason (task 8.6). */
  journalEntries: journalEntriesChoiceSchema.optional(),
});

export type StudentReturn = z.infer<typeof studentReturnSchema>;

/** Edge: "A student is graduated by mistake. The Super Admin restores the student to active ... and a reason." */
export const studentRestoreSchema = z.strictObject({
  from: schoolDateSchema,
  /** The class the student is restored into; the student takes its grade (task 3.3b, decision 6). */
  classId: z.uuid(),
  reason: statusReasonSchema,
  version: versionSchema,
});

export type StudentRestore = z.infer<typeof studentRestoreSchema>;

/** The cancel of a scheduled return or restore (edge: "It can be changed or cancelled until the date"; task 3.6b-2, L170). */
export const studentCancelReturnSchema = z.strictObject({ version: versionSchema });

export type StudentCancelReturn = z.infer<typeof studentCancelReturnSchema>;

/** Edge: "A student is created twice by mistake" (decision 4: with a reason). */
export const studentDeleteSchema = z.strictObject({
  reason: statusReasonSchema,
  version: versionSchema,
});

export type StudentDelete = z.infer<typeof studentDeleteSchema>;
