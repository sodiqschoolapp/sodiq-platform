import type { Language } from './language.js';

/**
 * The texts of a rating's Excel file (task 9.3a), written on the server in the language of the
 * account (`edge/system-behaviour`: "Interface texts exist in three languages"). The stamp is
 * `edge/journal`, "A results table is exported in week 6 and passed around as final": "Every
 * export and print states 'Provisional' with date and time, or 'Final' with the closing date and
 * version".
 */
export interface RatingExportTexts {
  /** The sheet names: at most 31 characters, none of : \ / ? * [ ]. */
  readonly sheets: {
    readonly subject: string;
    readonly class: string;
    readonly classes: string;
  };
  readonly quarter: string;
  readonly provisional: string;
  readonly final: string;
  readonly notOfficial: string;
  readonly allGrades: string;
  readonly grade: string;
  readonly languages: { readonly uz: string; readonly ru: string };
  readonly columns: {
    readonly place: string;
    readonly student: string;
    readonly figure: string;
    readonly state: string;
    readonly subjects: string;
    readonly fewerSubjects: string;
    readonly class: string;
    readonly students: string;
  };
  readonly states: {
    readonly exempt: string;
    readonly not_assessed: string;
    readonly no_result: string;
  };
  readonly flags: {
    readonly few_lessons: string;
    readonly attendance_only: string;
    readonly left_subject: string;
  };
  readonly yes: string;
  readonly fileName: string;
}

const en: RatingExportTexts = {
  sheets: {
    subject: 'Rating in a subject',
    class: 'Rating of a class',
    classes: 'Rating of classes',
  },
  quarter: 'Quarter {{number}}',
  provisional: 'Provisional · {{moment}}',
  final: 'Final · closed {{date}} · version {{version}}',
  notOfficial: 'Not official',
  allGrades: 'All grades',
  grade: 'Grade {{grade}}',
  languages: { uz: 'Uzbek', ru: 'Russian' },
  columns: {
    place: 'Place',
    student: 'Student',
    figure: 'Result',
    state: 'Note',
    subjects: 'Subjects',
    fewerSubjects: 'Fewer subjects',
    class: 'Class',
    students: 'Students',
  },
  states: { exempt: 'Exempt', not_assessed: 'Not assessed', no_result: 'No result' },
  flags: {
    few_lessons: 'Few lessons, to be decided',
    attendance_only: 'Attendance only, to be decided',
    left_subject: 'Left the subject on {{date}}',
  },
  yes: 'Yes',
  fileName: 'rating',
};

const ru: RatingExportTexts = {
  sheets: { subject: 'Рейтинг по предмету', class: 'Рейтинг класса', classes: 'Рейтинг классов' },
  quarter: '{{number}} четверть',
  provisional: 'Предварительно · {{moment}}',
  final: 'Окончательно · закрыта {{date}} · версия {{version}}',
  notOfficial: 'Неофициальная',
  allGrades: 'Все параллели',
  grade: '{{grade}} класс',
  languages: { uz: 'Узбекский', ru: 'Русский' },
  columns: {
    place: 'Место',
    student: 'Ученик',
    figure: 'Результат',
    state: 'Примечание',
    subjects: 'Предметы',
    fewerSubjects: 'Меньше предметов',
    class: 'Класс',
    students: 'Учеников',
  },
  states: { exempt: 'Освобождён', not_assessed: 'Не аттестован', no_result: 'Нет результата' },
  flags: {
    few_lessons: 'Мало уроков, решение при закрытии',
    attendance_only: 'Только посещаемость, решение при закрытии',
    left_subject: 'Выбыл с предмета {{date}}',
  },
  yes: 'Да',
  fileName: 'reyting',
};

const uz: RatingExportTexts = {
  sheets: { subject: 'Fan boʻyicha reyting', class: 'Sinf reytingi', classes: 'Sinflar reytingi' },
  quarter: '{{number}}-chorak',
  provisional: 'Dastlabki · {{moment}}',
  final: 'Yakuniy · yopilgan {{date}} · {{version}}-versiya',
  notOfficial: 'Rasmiy emas',
  allGrades: 'Barcha sinflar',
  grade: '{{grade}}-sinflar',
  languages: { uz: 'Oʻzbek', ru: 'Rus' },
  columns: {
    place: 'Oʻrin',
    student: 'Oʻquvchi',
    figure: 'Natija',
    state: 'Izoh',
    subjects: 'Fanlar',
    fewerSubjects: 'Fanlar kamroq',
    class: 'Sinf',
    students: 'Oʻquvchilar',
  },
  states: { exempt: 'Ozod', not_assessed: 'Baholanmagan', no_result: 'Natija yoʻq' },
  flags: {
    few_lessons: 'Darslar kam, yopishda hal qilinadi',
    attendance_only: 'Faqat davomat, yopishda hal qilinadi',
    left_subject: '{{date}} fandan chiqqan',
  },
  yes: 'Ha',
  fileName: 'reyting',
};

export const RATING_EXPORT_TEXTS: Readonly<Record<Language, RatingExportTexts>> = { uz, ru, en };

/** The file name in ASCII letters, for a browser that ignores `filename*`. */
export const RATING_EXPORT_ASCII_NAME = 'rating';
