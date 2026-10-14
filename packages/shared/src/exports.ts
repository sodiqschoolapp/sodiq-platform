import { z } from 'zod';
import type { Language } from './language.js';
import type { Relationship } from './relatives.js';
import type { Role } from './roles.js';
import type { InstructionLanguage } from './settings.js';
import type { RoomStatus, RoomType } from './setup.js';
import type { Sex, StaffStatus } from './staff.js';
import type {
  DocumentType,
  Region,
  ScholarshipCoverage,
  ScholarshipType,
  StudentFieldGroup,
  StudentStatus,
} from './students.js';
import type { JournalType } from './subjects.js';
import type { VacancyStatus } from './vacancies.js';

/**
 * The lists with an Excel export (task 2.2c-1; `12`, Lists: "Every list ...
 * export"). Each list's export route is beside its list route.
 */
export const EXPORT_LISTS = [
  'staff',
  'vacancies',
  'buildings',
  'rooms',
  'divisions',
  'subjects',
  'students',
  'classes',
] as const;

export type ExportList = (typeof EXPORT_LISTS)[number];

/**
 * The column keys of each list, equal to the `key`s of the columns of its page
 * (a web test compares them), in the order of the page. The page sends the keys
 * of the columns shown; the file has those columns in that order.
 */
export const STAFF_EXPORT_COLUMNS = [
  'name',
  'staffId',
  'category',
  'branches',
  'department',
  'subjects',
  'grades',
  'languages',
  'phone',
  'status',
] as const;

export const VACANCY_EXPORT_COLUMNS = [
  'name',
  'department',
  'subjects',
  'grades',
  'languages',
  'weeklyLessons',
  'status',
] as const;

export const BUILDING_EXPORT_COLUMNS = ['name', 'floors', 'rooms', 'status'] as const;

export const ROOM_EXPORT_COLUMNS = [
  'name',
  'building',
  'floor',
  'type',
  'capacity',
  'status',
  'shared',
] as const;

export const DIVISION_EXPORT_COLUMNS = ['name', 'departments', 'staff', 'status'] as const;

export const SUBJECT_EXPORT_COLUMNS = [
  'name',
  'department',
  'grades',
  'journalType',
  'ratingExam',
  'daily',
  'quarterly',
  'switches',
  'status',
] as const;

/**
 * The column keys of the student list's file (task 2.4b-2, pull request #70):
 * the one exception to "equal to the `key`s of the columns of its page". The
 * first part is the page's exported columns, in its order (its photo and
 * groups columns are not exported: `groups` has no data before task 3.2;
 * `tutor` joined with task 3.1b); the rest are export-only columns, chosen by
 * group under the Export button, because the list shows no phone or document
 * (`04`: "Phone numbers are not shown in the list"; decision 2). A web test
 * pins both parts.
 */
/** The class list (task 3.1a): the class shown as "7 Oxford", its year, language, Tutor, main classroom, maximum size and status. */
export const CLASS_EXPORT_COLUMNS = [
  'name',
  'year',
  'language',
  'tutor',
  'mainRoom',
  // Task 3.1b: the members today, the count of the card.
  'students',
  'maxSize',
  'status',
] as const;

export const STUDENT_EXPORT_COLUMNS = [
  'uid',
  'name',
  'class',
  // Task 3.1b: the Tutor of the class in force today.
  'tutor',
  'status',
  'paternalName',
  'sex',
  'grade',
  'startsOn',
  'phone',
  'email',
  'birthDate',
  'documentType',
  'documentNumber',
  'jshshir',
  'address',
  'region',
  'contractNumber',
  'contractSignedOn',
  'scholarshipType',
  'scholarshipCoverage',
  'scholarshipAmount',
  'previousSchool',
  'diagnosticScore',
  'consentSignedOn',
  // Task 2.5b-2, decision 1 (Look first): the relatives, Contact columns.
  'mainContactName',
  'mainContactRelationship',
  'mainContactPhone',
  'mainContactExtraPhones',
  'otherRelatives',
] as const;

export type StudentExportColumn = (typeof STUDENT_EXPORT_COLUMNS)[number];

/** The page's exported columns: every reader of the list sees them. */
export const STUDENT_LIST_EXPORT_COLUMNS = [
  'uid',
  'name',
  'class',
  'tutor',
  'status',
] as const satisfies readonly StudentExportColumn[];

/** The group each column of the student file belongs to; a column is exported only by a reader of its group. */
export const STUDENT_EXPORT_GROUPS: Readonly<Record<StudentExportColumn, StudentFieldGroup>> = {
  uid: 'basic',
  name: 'basic',
  class: 'basic',
  tutor: 'basic',
  status: 'basic',
  paternalName: 'basic',
  sex: 'basic',
  grade: 'basic',
  startsOn: 'basic',
  phone: 'contact',
  email: 'contact',
  birthDate: 'identity',
  documentType: 'identity',
  documentNumber: 'identity',
  jshshir: 'identity',
  address: 'identity',
  region: 'identity',
  contractNumber: 'financial',
  contractSignedOn: 'financial',
  scholarshipType: 'financial',
  scholarshipCoverage: 'financial',
  scholarshipAmount: 'financial',
  previousSchool: 'financial',
  diagnosticScore: 'financial',
  consentSignedOn: 'financial',
  mainContactName: 'contact',
  mainContactRelationship: 'contact',
  mainContactPhone: 'contact',
  mainContactExtraPhones: 'contact',
  otherRelatives: 'contact',
};

export type StaffExportColumn = (typeof STAFF_EXPORT_COLUMNS)[number];
export type VacancyExportColumn = (typeof VACANCY_EXPORT_COLUMNS)[number];
export type BuildingExportColumn = (typeof BUILDING_EXPORT_COLUMNS)[number];
export type RoomExportColumn = (typeof ROOM_EXPORT_COLUMNS)[number];
export type DivisionExportColumn = (typeof DIVISION_EXPORT_COLUMNS)[number];
export type SubjectExportColumn = (typeof SUBJECT_EXPORT_COLUMNS)[number];
export type ClassExportColumn = (typeof CLASS_EXPORT_COLUMNS)[number];

/**
 * The contact columns of the staff list, left out of the Principal's export
 * (decision 4 of pull request #58; edge cases, Personal data and the audit log:
 * "Whole-branch exports with contact or identity fields are for the Super
 * Admin and Academic Vice Principal"). The staff list has no identity column.
 */
export const STAFF_CONTACT_EXPORT_COLUMNS: readonly StaffExportColumn[] = ['phone'];

/** At most this many rows in one export: a branch's lists hold a few thousand (decision 10). */
export const EXPORT_ROWS_MAX = 5000;

export const EXPORT_SEARCH_MAX_LENGTH = 200;
export const EXPORT_FILTERS_MAX = 20;
export const EXPORT_FILTER_KEY_MAX_LENGTH = 50;
export const EXPORT_FILTER_VALUE_MAX_LENGTH = 100;

/** The header naming the column keys written to the file, in their order, separated by commas. */
export const EXPORT_COLUMNS_HEADER = 'X-Export-Columns';

/** The rows of an export: the ticked ones (decision 12), or every row that matched. */
export const EXPORT_SELECTIONS = ['ticked', 'matching'] as const;

export type ExportSelection = (typeof EXPORT_SELECTIONS)[number];

/** A list of distinct items: a repeated one is a mistake of the caller. */
const distinct = <T>(items: readonly T[]): boolean => new Set(items).size === items.length;

/**
 * What the Export button of a list sends: the ids of the rows (the ticked rows,
 * or every row that matches), the keys of the columns shown, and the search and
 * filters as the list had them. The rows come from `ids`, read again by the
 * server under the branch filter; `search` and `filters` are only written to
 * the audit entry ("Every export is logged with its filters and row count").
 */
export function exportRequestSchema<const Columns extends readonly [string, ...string[]]>(
  columns: Columns,
) {
  return z.strictObject({
    ids: z
      .array(z.uuid())
      .min(1)
      .max(EXPORT_ROWS_MAX)
      .refine(distinct, { message: 'Each id once.' }),
    columns: z
      .array(z.enum(columns))
      .min(1)
      .max(columns.length)
      .refine(distinct, { message: 'Each column once.' }),
    /** Whether the rows are the ticked ones or every row that matched the search and filters. */
    selection: z.enum(EXPORT_SELECTIONS),
    search: z.string().max(EXPORT_SEARCH_MAX_LENGTH),
    filters: z
      .record(
        z.string().min(1).max(EXPORT_FILTER_KEY_MAX_LENGTH),
        z.string().max(EXPORT_FILTER_VALUE_MAX_LENGTH),
      )
      .refine((filters) => Object.keys(filters).length <= EXPORT_FILTERS_MAX, {
        message: `At most ${String(EXPORT_FILTERS_MAX)} filters.`,
      }),
  });
}

export const staffExportSchema = exportRequestSchema(STAFF_EXPORT_COLUMNS);
export const vacancyExportSchema = exportRequestSchema(VACANCY_EXPORT_COLUMNS);
export const buildingExportSchema = exportRequestSchema(BUILDING_EXPORT_COLUMNS);
export const roomExportSchema = exportRequestSchema(ROOM_EXPORT_COLUMNS);
export const divisionExportSchema = exportRequestSchema(DIVISION_EXPORT_COLUMNS);
export const subjectExportSchema = exportRequestSchema(SUBJECT_EXPORT_COLUMNS);
export const studentExportSchema = exportRequestSchema(STUDENT_EXPORT_COLUMNS);
export const classExportSchema = exportRequestSchema(CLASS_EXPORT_COLUMNS);

export type StaffExport = z.infer<typeof staffExportSchema>;
export type VacancyExport = z.infer<typeof vacancyExportSchema>;
export type BuildingExport = z.infer<typeof buildingExportSchema>;
export type RoomExport = z.infer<typeof roomExportSchema>;
export type DivisionExport = z.infer<typeof divisionExportSchema>;
export type SubjectExport = z.infer<typeof subjectExportSchema>;
export type StudentExport = z.infer<typeof studentExportSchema>;
export type ClassExport = z.infer<typeof classExportSchema>;

/** The texts of one list's file: its name (sheet and file) and the heading of each column. */
export interface ExportListTexts<Column extends string> {
  name: string;
  columns: Record<Column, string>;
}

/**
 * Every text an export file holds, in one language (`12`, Language: "every
 * export" exists in Uzbek, Russian and English). The same words as the list's
 * headers on the screen; a web test compares them, so file and screen cannot
 * drift.
 */
export interface ExportTexts {
  staff: ExportListTexts<StaffExportColumn>;
  vacancies: ExportListTexts<VacancyExportColumn>;
  buildings: ExportListTexts<BuildingExportColumn>;
  rooms: ExportListTexts<RoomExportColumn>;
  divisions: ExportListTexts<DivisionExportColumn>;
  subjects: ExportListTexts<SubjectExportColumn>;
  students: ExportListTexts<StudentExportColumn>;
  classes: ExportListTexts<ClassExportColumn>;
  /** The texts of the cells of the student file, as the student list and profile write them. */
  student: {
    statuses: Record<StudentStatus, string>;
    /** A student before the start date (`status` null). */
    notStarted: string;
    /** The class cell until classes exist (task 3.1), with `{{grade}}` for the grade's text. */
    gradeNoClass: string;
    sexes: Record<Sex, string>;
    documentTypes: Record<DocumentType, string>;
    regions: Record<Region, string>;
    scholarshipTypes: Record<ScholarshipType, string>;
    scholarshipCoverages: Record<ScholarshipCoverage, string>;
    /** The relationship of a relative to the student, as the Relatives tab names it (task 2.5b-2). */
    relationships: Record<Relationship, string>;
  };
  /** The two headings the status column of the staff file adds: a planned status and its first day. */
  plannedStatus: string;
  plannedFrom: string;
  roles: Record<Role, string>;
  staffStatuses: Record<StaffStatus, string>;
  notStarted: string;
  instructionLanguages: Record<InstructionLanguage, string>;
  vacancyStatuses: Record<VacancyStatus, string>;
  active: string;
  archived: string;
  roomTypes: Record<RoomType, string>;
  roomStatuses: Record<RoomStatus, string>;
  journalTypes: Record<JournalType, string>;
  yes: string;
  no: string;
  /**
   * The second heading of the Shared column of the rooms file: the number of
   * lessons a shared room takes at once, a number cell (task 2.7b-1, decision 10).
   */
  lessonsAtOnce: string;
  /** One grade as the lists name it, with `{{grade}}` for its number. */
  grade: string;
  /** The parts of the daily distribution, one number column each. */
  weightParts: { attendance: string; classwork: string; homework: string };
  switches: { groupSubject: string; languageRule: string; demanding: string };
}

const en: ExportTexts = {
  staff: {
    name: 'Staff',
    columns: {
      name: 'Name',
      staffId: 'Staff ID',
      category: 'Category',
      branches: 'Branches',
      department: 'Department',
      subjects: 'Subjects',
      grades: 'Grades',
      languages: 'Languages of instruction',
      phone: 'Phone',
      status: 'Status',
    },
  },
  vacancies: {
    name: 'Vacancies',
    columns: {
      name: 'Name',
      department: 'Department',
      subjects: 'Subjects',
      grades: 'Grades',
      languages: 'Languages of instruction',
      weeklyLessons: 'Lessons per week by contract',
      status: 'Status',
    },
  },
  buildings: {
    name: 'Buildings',
    columns: { name: 'Name', floors: 'Floors', rooms: 'Rooms', status: 'Status' },
  },
  rooms: {
    name: 'Rooms',
    columns: {
      name: 'Name or number',
      building: 'Building',
      floor: 'Floor',
      type: 'Type',
      capacity: 'Capacity',
      status: 'Status',
      shared: 'Shared',
    },
  },
  divisions: {
    name: 'Divisions',
    columns: { name: 'Name', departments: 'Departments', staff: 'Staff', status: 'Status' },
  },
  subjects: {
    name: 'Subjects',
    columns: {
      name: 'Name',
      department: 'Department',
      grades: 'Grades',
      journalType: 'Journal type',
      ratingExam: 'Rating exam',
      daily: 'Daily distribution',
      quarterly: 'Quarters not set',
      switches: 'Switches',
      status: 'Status',
    },
  },
  classes: {
    name: 'Classes',
    columns: {
      name: 'Class',
      year: 'Academic year',
      language: 'Language of instruction',
      tutor: 'Tutor',
      mainRoom: 'Main classroom',
      students: 'Students',
      maxSize: 'Maximum size',
      status: 'Status',
    },
  },
  students: {
    name: 'Students',
    columns: {
      uid: 'UID',
      name: 'Name and surname',
      class: 'Class',
      tutor: 'Tutor',
      status: 'Status',
      paternalName: 'Paternal name',
      sex: 'Sex',
      grade: 'Grade',
      startsOn: 'Start date',
      phone: 'Phone',
      email: 'Email',
      birthDate: 'Date of birth',
      documentType: 'Document',
      documentNumber: 'Document number',
      jshshir: 'JSHSHIR',
      address: 'Address',
      region: 'Region',
      contractNumber: 'Contract number',
      contractSignedOn: 'Contract date',
      scholarshipType: 'Scholarship',
      scholarshipCoverage: 'Coverage',
      scholarshipAmount: 'Amount in soʻm',
      previousSchool: 'Previous school',
      diagnosticScore: 'Diagnostic test score',
      consentSignedOn: 'Consent signed on',
      mainContactName: 'Main contact',
      mainContactRelationship: 'Main contact: relationship',
      mainContactPhone: 'Main contact: phone',
      mainContactExtraPhones: 'Main contact: extra phones',
      otherRelatives: 'Other relatives',
    },
  },
  student: {
    statuses: {
      active: 'Active',
      inactive: 'Inactive',
      graduated: 'Graduated',
    },
    notStarted: 'Starts later',
    gradeNoClass: '{{grade}}, no class',
    sexes: {
      male: 'Male',
      female: 'Female',
    },
    documentTypes: {
      passport: 'Passport',
      id_card: 'ID card',
      birth_certificate: 'Birth certificate',
    },
    regions: {
      andijan: 'Andijan Region',
      bukhara: 'Bukhara Region',
      fergana: 'Fergana Region',
      jizzakh: 'Jizzakh Region',
      kashkadarya: 'Kashkadarya Region',
      khorezm: 'Khorezm Region',
      namangan: 'Namangan Region',
      navoi: 'Navoi Region',
      samarkand: 'Samarkand Region',
      surkhandarya: 'Surkhandarya Region',
      syrdarya: 'Syrdarya Region',
      tashkent_region: 'Tashkent Region',
      karakalpakstan: 'Republic of Karakalpakstan',
      tashkent_city: 'Tashkent city',
      other: 'Other',
    },
    scholarshipTypes: {
      none: 'Not a scholarship student',
      merit: 'Merit',
      financial_aid: 'Financial aid',
      gift: 'Gift',
    },
    scholarshipCoverages: {
      full: 'Full',
      partial: 'Partial',
    },
    relationships: {
      father: 'Father',
      mother: 'Mother',
      grandfather: 'Grandfather',
      grandmother: 'Grandmother',
      uncle: 'Uncle',
      aunt: 'Aunt',
      brother: 'Brother',
      sister: 'Sister',
      guardian: 'Guardian',
      other: 'Other',
    },
  },
  plannedStatus: 'Planned status',
  plannedFrom: 'Planned from',
  roles: {
    super_admin: 'Super Admin',
    principal: 'Principal',
    academic_vice_principal: 'Academic Vice Principal',
    spiritual_vice_principal: 'Vice Principal for Spiritual and Moral Education',
    head_tutor: 'Head Tutor',
    tutor: 'Tutor',
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
  staffStatuses: { active: 'Active', inactive: 'Inactive', left: 'Left' },
  notStarted: 'Not started yet',
  instructionLanguages: { uz: 'Uzbek', ru: 'Russian' },
  vacancyStatuses: { open: 'Open', closed: 'Closed' },
  active: 'Active',
  archived: 'Archived',
  roomTypes: {
    classroom: 'Classroom',
    laboratory: 'Laboratory',
    sports_hall: 'Sports hall',
    hall: 'Hall',
    other: 'Other',
  },
  roomStatuses: { in_use: 'In use', under_repair: 'Under repair', closed: 'Closed' },
  journalTypes: { graded: 'Graded', attendance_only: 'Attendance only' },
  yes: 'Yes',
  no: 'No',
  lessonsAtOnce: 'Lessons at once',
  grade: 'Grade {{grade}}',
  weightParts: { attendance: 'Attendance', classwork: 'Classwork', homework: 'Homework' },
  switches: {
    groupSubject: 'Group subject',
    languageRule: 'Language rule',
    demanding: 'Demanding',
  },
};

const ru: ExportTexts = {
  staff: {
    name: 'Сотрудники',
    columns: {
      name: 'Имя',
      staffId: 'Табельный номер',
      category: 'Категория',
      branches: 'Филиалы',
      department: 'Кафедра',
      subjects: 'Предметы',
      grades: 'Классы',
      languages: 'Языки обучения',
      phone: 'Телефон',
      status: 'Статус',
    },
  },
  vacancies: {
    name: 'Вакансии',
    columns: {
      name: 'Название',
      department: 'Кафедра',
      subjects: 'Предметы',
      grades: 'Классы',
      languages: 'Языки обучения',
      weeklyLessons: 'Уроков в неделю по договору',
      status: 'Статус',
    },
  },
  buildings: {
    name: 'Здания',
    columns: { name: 'Название', floors: 'Этажи', rooms: 'Кабинеты', status: 'Состояние' },
  },
  rooms: {
    name: 'Кабинеты',
    columns: {
      name: 'Название или номер',
      building: 'Здание',
      floor: 'Этаж',
      type: 'Тип',
      capacity: 'Вместимость',
      status: 'Состояние',
      shared: 'Общий',
    },
  },
  divisions: {
    name: 'Отделы',
    columns: {
      name: 'Название',
      departments: 'Кафедры',
      staff: 'Сотрудники',
      status: 'Состояние',
    },
  },
  subjects: {
    name: 'Предметы',
    columns: {
      name: 'Название',
      department: 'Кафедра',
      grades: 'Классы',
      journalType: 'Тип журнала',
      ratingExam: 'Рейтинговый экзамен',
      daily: 'Ежедневное распределение',
      quarterly: 'Четверти без весов',
      switches: 'Признаки',
      status: 'Статус',
    },
  },
  classes: {
    name: 'Классы',
    columns: {
      name: 'Класс',
      year: 'Учебный год',
      language: 'Язык обучения',
      tutor: 'Тьютор',
      mainRoom: 'Основной кабинет',
      students: 'Учеников',
      maxSize: 'Наибольший размер',
      status: 'Состояние',
    },
  },
  students: {
    name: 'Ученики',
    columns: {
      uid: 'UID',
      name: 'Имя и фамилия',
      class: 'Класс',
      tutor: 'Тьютор',
      status: 'Статус',
      paternalName: 'Отчество',
      sex: 'Пол',
      grade: 'Параллель',
      startsOn: 'Дата начала',
      phone: 'Телефон',
      email: 'Электронная почта',
      birthDate: 'Дата рождения',
      documentType: 'Документ',
      documentNumber: 'Номер документа',
      jshshir: 'ПИНФЛ',
      address: 'Адрес',
      region: 'Регион',
      contractNumber: 'Номер договора',
      contractSignedOn: 'Дата договора',
      scholarshipType: 'Стипендия',
      scholarshipCoverage: 'Покрытие',
      scholarshipAmount: 'Сумма в сумах',
      previousSchool: 'Предыдущая школа',
      diagnosticScore: 'Балл диагностического теста',
      consentSignedOn: 'Согласие подписано',
      mainContactName: 'Основной контакт',
      mainContactRelationship: 'Основной контакт: родство',
      mainContactPhone: 'Основной контакт: телефон',
      mainContactExtraPhones: 'Основной контакт: дополнительные телефоны',
      otherRelatives: 'Другие родственники',
    },
  },
  student: {
    statuses: {
      active: 'Учится',
      inactive: 'Неактивен',
      graduated: 'Выпускник',
    },
    notStarted: 'Начнёт позже',
    gradeNoClass: '{{grade}}, без класса',
    sexes: {
      male: 'Мужской',
      female: 'Женский',
    },
    documentTypes: {
      passport: 'Паспорт',
      id_card: 'ID-карта',
      birth_certificate: 'Свидетельство о рождении',
    },
    regions: {
      andijan: 'Андижанская область',
      bukhara: 'Бухарская область',
      fergana: 'Ферганская область',
      jizzakh: 'Джизакская область',
      kashkadarya: 'Кашкадарьинская область',
      khorezm: 'Хорезмская область',
      namangan: 'Наманганская область',
      navoi: 'Навоийская область',
      samarkand: 'Самаркандская область',
      surkhandarya: 'Сурхандарьинская область',
      syrdarya: 'Сырдарьинская область',
      tashkent_region: 'Ташкентская область',
      karakalpakstan: 'Республика Каракалпакстан',
      tashkent_city: 'город Ташкент',
      other: 'Другое',
    },
    scholarshipTypes: {
      none: 'Не стипендиат',
      merit: 'За успехи',
      financial_aid: 'Материальная помощь',
      gift: 'Подарок',
    },
    scholarshipCoverages: {
      full: 'Полное',
      partial: 'Частичное',
    },
    relationships: {
      father: 'Отец',
      mother: 'Мать',
      grandfather: 'Дедушка',
      grandmother: 'Бабушка',
      uncle: 'Дядя',
      aunt: 'Тётя',
      brother: 'Брат',
      sister: 'Сестра',
      guardian: 'Опекун',
      other: 'Другое',
    },
  },
  plannedStatus: 'Запланированный статус',
  plannedFrom: 'Запланирован с',
  roles: {
    super_admin: 'Супер-администратор',
    principal: 'Директор',
    academic_vice_principal: 'Заместитель директора по учебной работе',
    spiritual_vice_principal: 'Заместитель директора по духовно-нравственному воспитанию',
    head_tutor: 'Старший тьютор',
    tutor: 'Тьютор',
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
  staffStatuses: { active: 'Активен', inactive: 'Неактивен', left: 'Уволен' },
  notStarted: 'Ещё не начал работу',
  instructionLanguages: { uz: 'Узбекский', ru: 'Русский' },
  vacancyStatuses: { open: 'Открыта', closed: 'Закрыта' },
  active: 'Действует',
  archived: 'В архиве',
  roomTypes: {
    classroom: 'Классная комната',
    laboratory: 'Лаборатория',
    sports_hall: 'Спортивный зал',
    hall: 'Зал',
    other: 'Другое',
  },
  roomStatuses: { in_use: 'Используется', under_repair: 'На ремонте', closed: 'Закрыт' },
  journalTypes: { graded: 'С оценками', attendance_only: 'Только посещаемость' },
  yes: 'Да',
  no: 'Нет',
  lessonsAtOnce: 'Уроков одновременно',
  grade: '{{grade}} класс',
  weightParts: {
    attendance: 'Посещаемость',
    classwork: 'Классная работа',
    homework: 'Домашняя работа',
  },
  switches: {
    groupSubject: 'Предмет по группам',
    languageRule: 'Правило языка',
    demanding: 'Трудный предмет',
  },
};

const uz: ExportTexts = {
  staff: {
    name: 'Xodimlar',
    columns: {
      name: 'Ism',
      staffId: 'Xodim raqami',
      category: 'Toifa',
      branches: 'Filiallar',
      department: 'Kafedra',
      subjects: 'Fanlar',
      grades: 'Sinflar',
      languages: 'Taʼlim tillari',
      phone: 'Telefon',
      status: 'Holat',
    },
  },
  vacancies: {
    name: 'Vakansiyalar',
    columns: {
      name: 'Nomi',
      department: 'Kafedra',
      subjects: 'Fanlar',
      grades: 'Sinflar',
      languages: 'Taʼlim tillari',
      weeklyLessons: 'Shartnoma boʻyicha haftalik darslar',
      status: 'Holat',
    },
  },
  buildings: {
    name: 'Binolar',
    columns: { name: 'Nomi', floors: 'Qavatlar', rooms: 'Xonalar', status: 'Holati' },
  },
  rooms: {
    name: 'Xonalar',
    columns: {
      name: 'Nomi yoki raqami',
      building: 'Bino',
      floor: 'Qavat',
      type: 'Turi',
      capacity: 'Sigʻimi',
      status: 'Holati',
      shared: 'Umumiy',
    },
  },
  divisions: {
    name: 'Boʻlimlar',
    columns: { name: 'Nomi', departments: 'Kafedralar', staff: 'Xodimlar', status: 'Holati' },
  },
  subjects: {
    name: 'Fanlar',
    columns: {
      name: 'Nomi',
      department: 'Kafedra',
      grades: 'Sinflar',
      journalType: 'Jurnal turi',
      ratingExam: 'Reyting imtihoni',
      daily: 'Kunlik taqsimot',
      quarterly: 'Vaznsiz choraklar',
      switches: 'Xususiyatlar',
      status: 'Holati',
    },
  },
  classes: {
    name: 'Sinflar',
    columns: {
      name: 'Sinf',
      year: 'Oʻquv yili',
      language: 'Taʼlim tili',
      tutor: 'Tyutor',
      mainRoom: 'Asosiy xona',
      students: 'Oʻquvchilar',
      maxSize: 'Eng koʻp oʻquvchi',
      status: 'Holati',
    },
  },
  students: {
    name: 'Oʻquvchilar',
    columns: {
      uid: 'UID',
      name: 'Ism va familiya',
      class: 'Sinf',
      tutor: 'Tyutor',
      status: 'Holat',
      paternalName: 'Otasining ismi',
      sex: 'Jinsi',
      grade: 'Sinf darajasi',
      startsOn: 'Boshlanish sanasi',
      phone: 'Telefon',
      email: 'Elektron pochta',
      birthDate: 'Tugʻilgan sana',
      documentType: 'Hujjat',
      documentNumber: 'Hujjat raqami',
      jshshir: 'JSHSHIR',
      address: 'Manzil',
      region: 'Hudud',
      contractNumber: 'Shartnoma raqami',
      contractSignedOn: 'Shartnoma sanasi',
      scholarshipType: 'Grant',
      scholarshipCoverage: 'Qamrov',
      scholarshipAmount: 'Miqdori, soʻm',
      previousSchool: 'Avvalgi maktab',
      diagnosticScore: 'Diagnostik test bali',
      consentSignedOn: 'Rozilik imzolangan sana',
      mainContactName: 'Asosiy aloqa',
      mainContactRelationship: 'Asosiy aloqa: qarindoshligi',
      mainContactPhone: 'Asosiy aloqa: telefoni',
      mainContactExtraPhones: 'Asosiy aloqa: qoʻshimcha telefonlari',
      otherRelatives: 'Boshqa qarindoshlar',
    },
  },
  student: {
    statuses: {
      active: 'Faol',
      inactive: 'Faol emas',
      graduated: 'Bitiruvchi',
    },
    notStarted: 'Keyinroq boshlaydi',
    gradeNoClass: '{{grade}}, sinfsiz',
    sexes: {
      male: 'Erkak',
      female: 'Ayol',
    },
    documentTypes: {
      passport: 'Pasport',
      id_card: 'ID-karta',
      birth_certificate: 'Tugʻilganlik haqidagi guvohnoma',
    },
    regions: {
      andijan: 'Andijon viloyati',
      bukhara: 'Buxoro viloyati',
      fergana: 'Fargʻona viloyati',
      jizzakh: 'Jizzax viloyati',
      kashkadarya: 'Qashqadaryo viloyati',
      khorezm: 'Xorazm viloyati',
      namangan: 'Namangan viloyati',
      navoi: 'Navoiy viloyati',
      samarkand: 'Samarqand viloyati',
      surkhandarya: 'Surxondaryo viloyati',
      syrdarya: 'Sirdaryo viloyati',
      tashkent_region: 'Toshkent viloyati',
      karakalpakstan: 'Qoraqalpogʻiston Respublikasi',
      tashkent_city: 'Toshkent shahri',
      other: 'Boshqa',
    },
    scholarshipTypes: {
      none: 'Grant oluvchi emas',
      merit: 'Yutuqlar uchun',
      financial_aid: 'Moddiy yordam',
      gift: 'Sovgʻa',
    },
    scholarshipCoverages: {
      full: 'Toʻliq',
      partial: 'Qisman',
    },
    relationships: {
      father: 'Otasi',
      mother: 'Onasi',
      grandfather: 'Bobosi',
      grandmother: 'Buvisi',
      uncle: 'Amakisi yoki togʻasi',
      aunt: 'Ammasi yoki xolasi',
      brother: 'Akasi yoki ukasi',
      sister: 'Opasi yoki singlisi',
      guardian: 'Vasiysi',
      other: 'Boshqa',
    },
  },
  plannedStatus: 'Rejalashtirilgan holat',
  plannedFrom: 'Rejalashtirilgan sana',
  roles: {
    super_admin: 'Super administrator',
    principal: 'Direktor',
    academic_vice_principal: 'Oʻquv ishlari boʻyicha direktor oʻrinbosari',
    spiritual_vice_principal: 'Maʼnaviy-axloqiy tarbiya boʻyicha direktor oʻrinbosari',
    head_tutor: 'Bosh tyutor',
    tutor: 'Tyutor',
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
  staffStatuses: { active: 'Faol', inactive: 'Faol emas', left: 'Ishdan ketgan' },
  notStarted: 'Hali ish boshlamagan',
  instructionLanguages: { uz: 'Oʻzbek', ru: 'Rus' },
  vacancyStatuses: { open: 'Ochiq', closed: 'Yopilgan' },
  active: 'Faol',
  archived: 'Arxivda',
  roomTypes: {
    classroom: 'Sinf xonasi',
    laboratory: 'Laboratoriya',
    sports_hall: 'Sport zali',
    hall: 'Zal',
    other: 'Boshqa',
  },
  roomStatuses: { in_use: 'Foydalanishda', under_repair: 'Taʼmirda', closed: 'Yopiq' },
  journalTypes: { graded: 'Baholanadi', attendance_only: 'Faqat davomat' },
  yes: 'Ha',
  no: 'Yoʻq',
  lessonsAtOnce: 'Bir vaqtdagi darslar',
  grade: '{{grade}}-sinf',
  weightParts: { attendance: 'Davomat', classwork: 'Sinf ishi', homework: 'Uy vazifasi' },
  switches: { groupSubject: 'Guruhli fan', languageRule: 'Til qoidasi', demanding: 'Murakkab fan' },
};

/**
 * The texts of every export file in the three languages. A missing text fails
 * the type-check (`12`: "A missing translation fails the build"); the file is
 * in the language of the account that exports (decision 7).
 */
export const EXPORT_TEXTS: Readonly<Record<Language, ExportTexts>> = { uz, ru, en };
