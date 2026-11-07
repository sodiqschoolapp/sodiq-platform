import { z } from 'zod';
import { firstPasswordSlipSchema } from './accounts.js';
import { classNameKey } from './classes.js';
import { LANGUAGES, type Language } from './language.js';
import type { Role } from './roles.js';
import { INSTRUCTION_LANGUAGES, type InstructionLanguage } from './settings.js';
import type { Weekday } from './setup.js';
import type { ContractType, EducationLevel, Sex } from './staff.js';

/**
 * The staff import from the system's Excel template (task 9.4h; `04`, Teacher
 * and staff record: "Staff are imported from the system's Excel template in
 * the same way as students"; the owner's spec change of 3 November 2026). One
 * row is one person: the personal fields, the main division and department,
 * the subjects with the grades taught, the languages of instruction, the
 * admission date, the contract type and date, and the role (Teacher, Tutor or
 * none). Only the Super Admin imports staff. The owner's spec change of 7
 * November 2026: date of birth, phone and admission date may be left empty,
 * and one column per weekday, Monday to Saturday, holds the hours the person
 * is at school that day (`04`, Availability), applied in the branch of the
 * import from the admission date, or from the import's day without one.
 */

/** Up to this many subjects on a row (plan decision 9). */
export const STAFF_IMPORT_SUBJECTS = 8;

const SUBJECT_COLUMNS = [
  'subject1',
  'subject2',
  'subject3',
  'subject4',
  'subject5',
  'subject6',
  'subject7',
  'subject8',
] as const;

export type StaffImportSubjectColumn = (typeof SUBJECT_COLUMNS)[number];

/**
 * The hours columns, Monday to Saturday (the school week; Sunday hours are
 * typed by hand), each with its weekday of `WEEKDAYS`.
 */
const HOURS_COLUMNS = [
  'hoursMonday',
  'hoursTuesday',
  'hoursWednesday',
  'hoursThursday',
  'hoursFriday',
  'hoursSaturday',
] as const;

export type StaffImportHoursColumn = (typeof HOURS_COLUMNS)[number];

/** The hours columns in their order, with the weekday each one holds. */
export const STAFF_IMPORT_HOURS_COLUMNS: readonly {
  column: StaffImportHoursColumn;
  weekday: Weekday;
}[] = HOURS_COLUMNS.map((column, index) => ({ column, weekday: (index + 1) as Weekday }));

/** The subject columns in their order: each one "name: grades". */
export const STAFF_IMPORT_SUBJECT_COLUMNS: readonly StaffImportSubjectColumn[] = SUBJECT_COLUMNS;

/**
 * The columns of the template, in their order. Row 1 of the sheet holds
 * these keys (hidden): the mark of the system's template (as 9.4g).
 */
export const STAFF_IMPORT_COLUMNS = [
  'lastName',
  'firstName',
  'fatherName',
  'sex',
  'birthDate',
  'educationLevel',
  'phone',
  'email',
  'jshshir',
  'division',
  'department',
  ...SUBJECT_COLUMNS,
  'languages',
  'admissionDate',
  'contractType',
  'contractDate',
  'role',
  ...HOURS_COLUMNS,
] as const;

export type StaffImportColumn = (typeof STAFF_IMPORT_COLUMNS)[number];

export const staffImportColumnSchema = z.enum(STAFF_IMPORT_COLUMNS);

/** The name of the template's sheet; with the row of keys it marks the system's template. */
export const STAFF_IMPORT_SHEET = 'Staff';

/** The name of the sheet of allowed values. */
export const STAFF_IMPORT_LISTS_SHEET = 'Lists';

/** At most this many rows in one file (plan decision 11). */
export const STAFF_IMPORT_MAX_ROWS = 1000;

/** The roles an import gives (`edge/people-roles-accounts`: "an import can create only Teachers and Tutors"). */
export const STAFF_IMPORT_ROLES = ['teacher', 'tutor'] as const satisfies readonly Role[];

export type StaffImportRole = (typeof STAFF_IMPORT_ROLES)[number];

/** The languages of instruction as one cell: Uzbek, Russian or both (`04`). */
export const STAFF_IMPORT_LANGUAGE_CHOICES = ['uz', 'ru', 'both'] as const;

export type StaffImportLanguageChoice = (typeof STAFF_IMPORT_LANGUAGE_CHOICES)[number];

/** The languages a choice of the languages cell stands for. */
export const languagesOfChoice = (choice: StaffImportLanguageChoice): InstructionLanguage[] =>
  choice === 'both' ? [...INSTRUCTION_LANGUAGES] : [choice];

/** The words of the template in one language: headings and the values of its lists. */
export interface StaffImportWords {
  headings: Record<Exclude<StaffImportColumn, StaffImportSubjectColumn>, string>;
  /** The heading of a subject column, with `{{n}}`. */
  subject: string;
  sexes: Record<Sex, string>;
  educationLevels: Record<EducationLevel, string>;
  contractTypes: Record<ContractType, string>;
  languages: Record<StaffImportLanguageChoice, string>;
  /** Every role by its name, so that a role the import does not give is told as such. */
  roles: Record<Role, string>;
}

/** The words of the staff screens of the web app, so the file and the screens say the same. */
export const STAFF_IMPORT_WORDS: Readonly<Record<Language, StaffImportWords>> = {
  uz: {
    headings: {
      lastName: 'Familiya',
      firstName: 'Ism',
      fatherName: 'Otasining ismi',
      sex: 'Jinsi',
      birthDate: 'Tugʻilgan sana',
      educationLevel: 'Maʼlumoti',
      phone: 'Telefon',
      email: 'Elektron pochta',
      jshshir: 'JSHSHIR',
      division: 'Asosiy boʻlim',
      department: 'Kafedra',
      languages: 'Taʼlim tillari',
      admissionDate: 'Ishga qabul sanasi',
      contractType: 'Shartnoma',
      contractDate: 'Shartnoma sanasi',
      role: 'Rol',
      hoursMonday: 'Dushanba: soatlar',
      hoursTuesday: 'Seshanba: soatlar',
      hoursWednesday: 'Chorshanba: soatlar',
      hoursThursday: 'Payshanba: soatlar',
      hoursFriday: 'Juma: soatlar',
      hoursSaturday: 'Shanba: soatlar',
    },
    subject: '{{n}}-fan: sinflar',
    sexes: { male: 'Erkak', female: 'Ayol' },
    educationLevels: {
      secondary: 'Oʻrta',
      specialised_secondary: 'Oʻrta maxsus',
      bachelor: 'Bakalavr',
      master: 'Magistr',
      phd: 'PhD',
      other: 'Boshqa',
    },
    contractTypes: { full_time: 'Toʻliq stavka', part_time: 'Yarim stavka' },
    languages: { uz: 'Oʻzbek', ru: 'Rus', both: 'Oʻzbek va rus' },
    roles: {
      super_admin: 'Super administrator',
      principal: 'Direktor',
      academic_vice_principal: 'Oʻquv ishlari boʻyicha direktor oʻrinbosari',
      spiritual_vice_principal: 'Maʼnaviy-axloqiy tarbiya boʻyicha direktor oʻrinbosari',
      head_tutor: 'Bosh tyutor',
      tutor: 'Tyutor',
      class_teacher: 'Sinf rahbari',
      senior_head_teacher: 'Katta fan rahbari',
      head_teacher: 'Fan rahbari',
      teacher: 'Oʻqituvchi',
      student: 'Oʻquvchi',
      parent: 'Ota-ona',
      hr: 'Kadrlar boʻlimi',
      nurse: 'Hamshira',
      psychologist: 'Psixolog',
      librarian: 'Kutubxonachi',
    },
  },
  ru: {
    headings: {
      lastName: 'Фамилия',
      firstName: 'Имя',
      fatherName: 'Отчество',
      sex: 'Пол',
      birthDate: 'Дата рождения',
      educationLevel: 'Образование',
      phone: 'Телефон',
      email: 'Эл. почта',
      jshshir: 'ПИНФЛ',
      division: 'Основной отдел',
      department: 'Кафедра',
      languages: 'Языки обучения',
      admissionDate: 'Дата приёма',
      contractType: 'Договор',
      contractDate: 'Дата договора',
      role: 'Роль',
      hoursMonday: 'Понедельник: часы',
      hoursTuesday: 'Вторник: часы',
      hoursWednesday: 'Среда: часы',
      hoursThursday: 'Четверг: часы',
      hoursFriday: 'Пятница: часы',
      hoursSaturday: 'Суббота: часы',
    },
    subject: 'Предмет {{n}}: классы',
    sexes: { male: 'Мужской', female: 'Женский' },
    educationLevels: {
      secondary: 'Среднее',
      specialised_secondary: 'Среднее специальное',
      bachelor: 'Бакалавр',
      master: 'Магистр',
      phd: 'PhD',
      other: 'Другое',
    },
    contractTypes: { full_time: 'Полная ставка', part_time: 'Неполная ставка' },
    languages: { uz: 'Узбекский', ru: 'Русский', both: 'Узбекский и русский' },
    roles: {
      super_admin: 'Суперадминистратор',
      principal: 'Директор',
      academic_vice_principal: 'Заместитель директора по учебной работе',
      spiritual_vice_principal: 'Заместитель директора по духовно-нравственному воспитанию',
      head_tutor: 'Старший тьютор',
      tutor: 'Тьютор',
      class_teacher: 'Классный руководитель',
      senior_head_teacher: 'Старший руководитель предметов',
      head_teacher: 'Руководитель предметов',
      teacher: 'Учитель',
      student: 'Ученик',
      parent: 'Родитель',
      hr: 'Отдел кадров',
      nurse: 'Медсестра',
      psychologist: 'Психолог',
      librarian: 'Библиотекарь',
    },
  },
  en: {
    headings: {
      lastName: 'Surname',
      firstName: 'First name',
      fatherName: "Father's name",
      sex: 'Sex',
      birthDate: 'Date of birth',
      educationLevel: 'Education',
      phone: 'Phone',
      email: 'Email',
      jshshir: 'JSHSHIR',
      division: 'Main division',
      department: 'Department',
      languages: 'Languages of instruction',
      admissionDate: 'Admission date',
      contractType: 'Contract',
      contractDate: 'Contract date',
      role: 'Role',
      hoursMonday: 'Monday: hours',
      hoursTuesday: 'Tuesday: hours',
      hoursWednesday: 'Wednesday: hours',
      hoursThursday: 'Thursday: hours',
      hoursFriday: 'Friday: hours',
      hoursSaturday: 'Saturday: hours',
    },
    subject: 'Subject {{n}}: grades',
    sexes: { male: 'Male', female: 'Female' },
    educationLevels: {
      secondary: 'Secondary',
      specialised_secondary: 'Specialised secondary',
      bachelor: 'Bachelor',
      master: 'Master',
      phd: 'PhD',
      other: 'Other',
    },
    contractTypes: { full_time: 'Full time', part_time: 'Part time' },
    languages: { uz: 'Uzbek', ru: 'Russian', both: 'Uzbek and Russian' },
    roles: {
      super_admin: 'Super Admin',
      principal: 'Principal',
      academic_vice_principal: 'Academic Vice Principal',
      spiritual_vice_principal: 'Vice Principal for Spiritual and Moral Education',
      head_tutor: 'Head Tutor',
      tutor: 'Tutor',
      class_teacher: 'Class teacher',
      senior_head_teacher: 'Senior Head Teacher',
      head_teacher: 'Head Teacher',
      teacher: 'Teacher',
      student: 'Student',
      parent: 'Parent',
      hr: 'HR',
      nurse: 'Nurse',
      psychologist: 'Psychologist',
      librarian: 'Librarian',
    },
  },
};

/** The heading of a column in one language. */
export function staffImportHeading(column: StaffImportColumn, language: Language): string {
  const words = STAFF_IMPORT_WORDS[language];
  const subject = /^subject(\d)$/.exec(column);
  if (subject !== null) {
    return words.subject.replace('{{n}}', subject[1] ?? '');
  }
  return words.headings[column as Exclude<StaffImportColumn, StaffImportSubjectColumn>];
}

/** The heading row of the template: each column in Uzbek, Russian and English. */
export const staffImportHeadingRow = (): string[] =>
  STAFF_IMPORT_COLUMNS.map((column) =>
    LANGUAGES.map((language) => staffImportHeading(column, language)).join(' / '),
  );

/**
 * A name of the school's lists (a division, a department, a subject) as it is
 * compared: case, outer and repeated spaces and apostrophes ignored, and
 * look-alike Cyrillic and Latin letters the same (`edge/students-classes-
 * groups`, the import row; plan decision 8).
 */
export const staffImportNameKey = (text: string): string =>
  classNameKey(
    text
      .normalize('NFKC')
      .replace(/[ʻʼ'`‘’]/g, '')
      .toLocaleLowerCase('en'),
  );

/**
 * One row of an upload as read from the sheet, before it is checked: every
 * cell as text. Kept in `staff_imports.rows` (plan decision 2).
 */
export const staffImportRowSchema = z.object({
  rowNumber: z.int().min(1),
  cells: z.partialRecord(staffImportColumnSchema, z.string()),
});

export type StaffImportRow = z.infer<typeof staffImportRowSchema>;

export const staffImportRowsSchema = z.array(staffImportRowSchema);

/**
 * The kinds of problem of a row found before the save; a refusal of the save
 * itself carries the API's own error code (`ERROR_CODES`).
 */
export const STAFF_IMPORT_PROBLEMS = [
  'required',
  'invalid',
  'date_invalid',
  'phone_invalid',
  'value_unknown',
  /** A division, department or subject no record of the school is named by. */
  'name_unknown',
  /** A name two records of the school share in some language: never guessed. */
  'name_ambiguous',
  /** The department is not one of the division named. */
  'department_not_of_division',
  /** The grades of a subject cell cannot be read (`Mathematics: 5, 6, 7` or `5-7`). */
  'grades_invalid',
  /** The same subject in two columns of the row. */
  'subject_twice',
  /** A role the import does not give (`edge`: "an import can create only Teachers and Tutors"). */
  'import_role_not_allowed',
  /** The same phone or JSHSHIR on another row. */
  'duplicate_in_file',
  /** No login can be made of the name (by hand the Super Admin types one). */
  'import_no_login',
  /** An hours cell that is not ranges of times (`08:00-16:05`, or several with commas). */
  'hours_invalid',
  /** A time of an hours cell outside the day (00:00 to 24:00). */
  'hours_outside_day',
  /** A range whose end is not after its start. */
  'hours_end_before_start',
  /** Two ranges of one day that share a minute. */
  'hours_overlap',
  /** More ranges in the hours of the row than one availability entry holds (`AVAILABILITY_RANGES_MAX`). */
  'hours_over_limit',
] as const;

export const staffImportProblemSchema = z.object({
  column: staffImportColumnSchema.nullable(),
  code: z.string(),
  /** The other rows of the file a duplicate is on. */
  rows: z.array(z.int()).optional(),
  /** The staff record of the branch that holds a value (as the hand create names it). */
  recordId: z.uuid().optional(),
  /** Its name, as the hand create's refusal shows it. */
  staffName: z.string().optional(),
  /** The holder is a staff record of another branch: nothing more is told. */
  elsewhere: z.boolean().optional(),
  /** The holder has left: they are re-hired by hand on their record (review correction 1). */
  left: z.boolean().optional(),
});

export type StaffImportProblem = z.infer<typeof staffImportProblemSchema>;

export const staffImportPreviewRowSchema = z.object({
  rowNumber: z.int(),
  lastName: z.string().nullable(),
  firstName: z.string().nullable(),
  role: z.enum(STAFF_IMPORT_ROLES).nullable(),
  problems: z.array(staffImportProblemSchema),
  /**
   * The duplicate warning (`edge/people-roles-accounts`, re-hire row: "The
   * system also warns on the same name and date of birth"): the records of the
   * branch named, of other branches only whether one exists, and the earlier
   * rows of the file with the same name and date.
   */
  warning: z
    .object({
      records: z.array(
        z.object({ id: z.uuid(), staffId: z.string().nullable(), name: z.string() }),
      ),
      elsewhere: z.boolean(),
      rows: z.array(z.int()),
      confirmed: z.boolean(),
    })
    .nullable(),
  /** The phone is a relative's main phone: the two records are marked the same person. */
  samePerson: z.object({ fullName: z.string().nullable() }).nullable(),
  /** The login the account would get; `null` for a row without a role. */
  login: z.string().nullable(),
});

export type StaffImportPreviewRow = z.infer<typeof staffImportPreviewRowSchema>;

export const staffImportPreviewSchema = z.object({
  importId: z.uuid(),
  /** The day this file was already imported into the branch; `null` when it was not. */
  alreadyImportedOn: z.string().nullable(),
  rows: z.array(staffImportPreviewRowSchema),
  /** No row has a problem and every warning is confirmed. */
  clean: z.boolean(),
});

export type StaffImportPreview = z.infer<typeof staffImportPreviewSchema>;

/** The decisions sent with the preview and the confirm. */
export const staffImportDecisionsSchema = z.strictObject({
  /** The rows whose name and date of birth warning is confirmed. */
  confirmedWarnings: z.array(z.int().min(1)).max(STAFF_IMPORT_MAX_ROWS).default([]),
});

export type StaffImportDecisions = z.infer<typeof staffImportDecisionsSchema>;

export const staffImportParamsSchema = z.object({ id: z.uuid() });

export type StaffImportParams = z.infer<typeof staffImportParamsSchema>;

export const staffImportTemplateQuerySchema = z.strictObject({
  language: z.enum(LANGUAGES),
});

export type StaffImportTemplateQuery = z.infer<typeof staffImportTemplateQuerySchema>;

/**
 * The answer of the confirm: saved, with the records and the slips of the
 * first passwords (answered once, stored nowhere: `edge/people-roles-
 * accounts`, "printed once on per-person slips and not stored"); or the
 * preview again with what is not clean (nothing saved).
 */
export const staffImportConfirmResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('saved'),
    created: z.int().min(1),
    staff: z.array(
      z.object({
        id: z.uuid(),
        staffId: z.string(),
        lastName: z.string(),
        firstName: z.string(),
        login: z.string().nullable(),
      }),
    ),
    slips: z.array(firstPasswordSlipSchema),
    /** The day of issue printed on the slips: today in the branch. */
    issuedOn: z.string(),
  }),
  z.object({ outcome: z.literal('not_clean'), preview: staffImportPreviewSchema }),
]);

export type StaffImportConfirmResult = z.infer<typeof staffImportConfirmResultSchema>;
