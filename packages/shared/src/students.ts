import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { jshshirSchema, sexSchema, staffPhoneSchema } from './staff.js';

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

const OKINA = 'ʻ';
const MODIFIER_APOSTROPHE = 'ʼ';
/** The apostrophes a keyboard types: ', `, ʻ, ʼ, ’ and ‘. */
const APOSTROPHES = /['`ʻʼ’‘]/g;

/**
 * A student's name in its stored form: outer spaces dropped, inner runs made
 * one, and in Latin each apostrophe stored as ʻ after o or g and as ʼ
 * elsewhere (as `storedName` of the staff record).
 */
export function storedStudentName(typed: string): string {
  const spaced = typed.trim().replace(/\s+/g, ' ');
  return spaced.replace(APOSTROPHES, (_mark, offset: number) => {
    const before = spaced.charAt(offset - 1).toLowerCase();
    return before === 'o' || before === 'g' ? OKINA : MODIFIER_APOSTROPHE;
  });
}

/** Latin with ʻ and ʼ, or Cyrillic with ў қ ғ ҳ; one script per name; the check of the database. */
const LATIN_NAME = /^[A-Za-zʻʼ]+([ -][A-Za-zʻʼ]+)*$/;
const CYRILLIC_NAME = /^[А-Яа-яЁёЎўҚқҒғҲҳ]+([ -][А-Яа-яЁёЎўҚқҒғҲҳ]+)*$/;

const validName = (name: string): boolean => LATIN_NAME.test(name) || CYRILLIC_NAME.test(name);

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

/** Cyrillic letters to the Latin of the Uzbek state alphabet (the Russian ones too). */
const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'x',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: '',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ў: 'o',
  қ: 'q',
  ғ: 'g',
  ҳ: 'h',
};

/**
 * A text with its spelling differences removed (answer 18: "Search and the
 * duplicate check treat look-alike spellings as the same (Oʻtkir, O'tkir,
 * Ўткир)"): lower case, Cyrillic written in Latin, every apostrophe and the
 * hard and soft signs dropped (so oʻ is o and gʻ is g), "kh" and every h not
 * after s or c written x (Russian writes Uzbek x and h both as х: Рахимов is
 * Rahimov), runs of spaces made one. The Russian у of an Uzbek ў (Уткир for
 * Ўткир) is not folded: u and o stay apart (decided in the build of 2.4a). The one folding of the platform: the list search and the
 * stored `name_key` of the duplicate check use it; a change to it comes with a
 * migration that rewrites `students.name_key`.
 */
export function spellingKey(text: string): string {
  const lower = text.normalize('NFKC').toLocaleLowerCase('en');
  let latin = '';
  for (const letter of lower) {
    latin += CYRILLIC_TO_LATIN[letter] ?? letter;
  }
  return latin
    .replace(APOSTROPHES, '')
    .replace(/kh/g, 'x')
    .replace(/(?<![sc])h/g, 'x')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  .transform((typed) => typed.replace(/[\s()-]/g, ''))
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

/** A student as the list answers it: the Basic group (edge, Personal data) and the status. */
export const studentListItemSchema = z.object({
  id: z.uuid(),
  uid: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  paternalName: z.string().nullable(),
  sex: sexSchema,
  grade: studentGradeSchema,
  startsOn: schoolDateSchema,
  /** The status in force today in the branch's time zone; `null` before the start date. */
  status: studentStatusSchema.nullable(),
  /**
   * The next change after the status shown, when it begins after today: a
   * scheduled leaving shows "leaves on …" (edge: "the student shows the
   * current class with a badge"). `from` is the first day of the new status.
   */
  planned: z.object({ status: studentStatusSchema, from: schoolDateSchema }).nullable(),
  /**
   * The number of status rows: every status change writes one or more, so a
   * change sent with an older number is refused `student_changed` (edge:
   * "The second one gets \"student changed, reload\"").
   */
  version: z.int().min(0),
});

export type StudentListItem = z.infer<typeof studentListItemSchema>;

export const studentListSchema = z.object({
  students: z.array(studentListItemSchema),
  /** Leave, return and delete: the Super Admin and the Academic Vice Principal (task 2.4b-1). */
  canArchive: z.boolean(),
  /** Today in the time zone of the branch of the request. */
  today: schoolDateSchema,
});

export type StudentList = z.infer<typeof studentListSchema>;

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
 * previous school, the diagnostic score and the consent (decision 4).
 */
export const studentFinancialSchema = z.object({
  /** Every contract, newest first. */
  contracts: z.array(z.object({ id: z.uuid(), number: z.string(), signedOn: schoolDateSchema })),
  scholarship: scholarshipSchema,
  previousSchool: z.string().nullable(),
  diagnosticScore: z.int().nullable(),
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
  statuses: z.array(studentStatusRowSchema),
  /** Edit and UID correction: the Super Admin and the Academic Vice Principal. */
  canEdit: z.boolean(),
  /** Leave, cancel, undo, return and delete (task 2.4b-1). */
  canArchive: z.boolean(),
  /** The restore of a graduated student: the Super Admin (task 2.4b-1). */
  canRestoreGraduated: z.boolean(),
  /** The delete of a student created twice is open: no data (`students_delete_guard`, 0033). */
  deletable: z.boolean(),
  today: schoolDateSchema,
});

export type StudentDetail = z.infer<typeof studentDetailSchema>;

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
  contract: studentContractSchema,
  reason: statusReasonSchema.nullable(),
  version: versionSchema,
});

export type StudentReturn = z.infer<typeof studentReturnSchema>;

/** Edge: "A student is graduated by mistake. The Super Admin restores the student to active ... and a reason." */
export const studentRestoreSchema = z.strictObject({
  from: schoolDateSchema,
  reason: statusReasonSchema,
  version: versionSchema,
});

export type StudentRestore = z.infer<typeof studentRestoreSchema>;

/** Edge: "A student is created twice by mistake" (decision 4: with a reason). */
export const studentDeleteSchema = z.strictObject({
  reason: statusReasonSchema,
  version: versionSchema,
});

export type StudentDelete = z.infer<typeof studentDeleteSchema>;
