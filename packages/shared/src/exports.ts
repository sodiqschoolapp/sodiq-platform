import { z } from 'zod';
import type { Language } from './language.js';
import type { Role } from './roles.js';
import type { InstructionLanguage } from './settings.js';
import type { RoomStatus, RoomType } from './setup.js';
import type { StaffStatus } from './staff.js';
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

export type StaffExportColumn = (typeof STAFF_EXPORT_COLUMNS)[number];
export type VacancyExportColumn = (typeof VACANCY_EXPORT_COLUMNS)[number];
export type BuildingExportColumn = (typeof BUILDING_EXPORT_COLUMNS)[number];
export type RoomExportColumn = (typeof ROOM_EXPORT_COLUMNS)[number];
export type DivisionExportColumn = (typeof DIVISION_EXPORT_COLUMNS)[number];
export type SubjectExportColumn = (typeof SUBJECT_EXPORT_COLUMNS)[number];

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

export type StaffExport = z.infer<typeof staffExportSchema>;
export type VacancyExport = z.infer<typeof vacancyExportSchema>;
export type BuildingExport = z.infer<typeof buildingExportSchema>;
export type RoomExport = z.infer<typeof roomExportSchema>;
export type DivisionExport = z.infer<typeof divisionExportSchema>;
export type SubjectExport = z.infer<typeof subjectExportSchema>;

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
      switches: 'Переключатели',
      status: 'Статус',
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
      switches: 'Belgilar',
      status: 'Holati',
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
  weightParts: { attendance: 'Davomat', classwork: 'Sinf ishi', homework: 'Uy vazifasi' },
  switches: { groupSubject: 'Guruhli fan', languageRule: 'Til qoidasi', demanding: 'Murakkab fan' },
};

/**
 * The texts of every export file in the three languages. A missing text fails
 * the type-check (`12`: "A missing translation fails the build"); the file is
 * in the language of the account that exports (decision 7).
 */
export const EXPORT_TEXTS: Readonly<Record<Language, ExportTexts>> = { uz, ru, en };
