import type { Language } from './language.js';

/**
 * The texts of the Excel files of the reports of `08` (task 9.3b-2), written on the server in the
 * language of the account (`edge/system-behaviour`: "Interface texts exist in three languages").
 * The quarter reports carry "Provisional" with the moment or "Final" with the close, as the
 * rating's file (`edge/journal`, "A results table is exported in week 6"); the range reports
 * carry their range and the moment of the export (decision 12).
 */
export interface ReportExportTexts {
  /** The sheet names: at most 31 characters, none of : \ / ? * [ ]. */
  readonly sheets: {
    readonly attendance: string;
    readonly table: string;
    readonly mastery: string;
    readonly discipline: string;
    readonly load: string;
    readonly rooms: string;
    readonly classes: string;
    readonly freePeriods: string;
  };
  readonly quarter: string;
  readonly provisional: string;
  readonly final: string;
  readonly notOfficial: string;
  readonly range: string;
  readonly week: string;
  readonly exportedAt: string;
  readonly noTutor: string;
  readonly columns: {
    readonly class: string;
    readonly tutor: string;
    readonly present: string;
    readonly late: string;
    readonly absent: string;
    readonly skipped: string;
    readonly unmarked: string;
    readonly exempt: string;
    readonly expected: string;
    readonly percentOfExpected: string;
    readonly daily: string;
    readonly student: string;
    readonly grade: string;
    readonly band: string;
    readonly students: string;
    readonly percent: string;
    readonly teacher: string;
    readonly held: string;
    readonly notStarted: string;
    readonly inProgress: string;
    readonly complete: string;
    readonly lockedIncomplete: string;
    readonly noAttendance: string;
    readonly noTopic: string;
    readonly worksMissing: string;
    readonly unplanned: string;
    readonly lateEntries: string;
    readonly lessons: string;
    readonly planned: string;
    readonly elsewhere: string;
    readonly contract: string;
    readonly invigilations: string;
    readonly vacancy: string;
    readonly subject: string;
    readonly load: string;
    readonly room: string;
    readonly periods: string;
    readonly weekday: string;
    readonly time: string;
  };
  readonly states: {
    readonly exempt: string;
    readonly not_assessed: string;
    readonly no_result: string;
  };
  readonly total: string;
  readonly fileNames: {
    readonly attendance: string;
    readonly table: string;
    readonly mastery: string;
    readonly discipline: string;
    readonly load: string;
  };
}

const en: ReportExportTexts = {
  sheets: {
    attendance: 'Attendance',
    table: 'Results table',
    mastery: 'Subject mastery',
    discipline: 'Journal discipline',
    load: 'Teachers',
    rooms: 'Rooms',
    classes: 'Classes',
    freePeriods: 'Free periods',
  },
  quarter: 'Quarter {{number}}',
  provisional: 'Provisional · {{moment}}',
  final: 'Final · closed {{date}} · version {{version}}',
  notOfficial: 'Not official',
  range: '{{from}} – {{to}}',
  week: 'Week of {{date}}',
  exportedAt: 'Exported {{moment}}',
  noTutor: 'No Tutor',
  columns: {
    class: 'Class',
    tutor: 'Tutor',
    present: 'Present',
    late: 'Late',
    absent: 'Absent',
    skipped: 'Skipped',
    unmarked: 'Unmarked',
    exempt: 'Exempt',
    expected: 'Expected',
    percentOfExpected: '% of expected',
    daily: 'Daily attendance %',
    student: 'Student',
    grade: 'Grade',
    band: 'Band',
    students: 'Students',
    percent: '%',
    teacher: 'Teacher',
    held: 'Lessons held',
    notStarted: 'Not started',
    inProgress: 'In progress',
    complete: 'Complete',
    lockedIncomplete: 'Locked incomplete',
    noAttendance: 'Attendance not marked',
    noTopic: 'No topic',
    worksMissing: 'Works with scores missing',
    unplanned: 'Unplanned works',
    lateEntries: 'Entries after the edit period',
    lessons: 'Lessons this week',
    planned: 'Planned load',
    elsewhere: 'Other branches',
    contract: 'Contract',
    invigilations: 'Invigilations',
    vacancy: 'Vacancy',
    subject: 'Subject',
    load: 'Load',
    room: 'Room',
    periods: 'Periods',
    weekday: 'Day',
    time: 'Time',
  },
  states: { exempt: 'Exempt', not_assessed: 'Not assessed', no_result: 'No result' },
  total: 'Total',
  fileNames: {
    attendance: 'attendance',
    table: 'results-table',
    mastery: 'subject-mastery',
    discipline: 'journal-discipline',
    load: 'timetable-load',
  },
};

const ru: ReportExportTexts = {
  sheets: {
    attendance: 'Посещаемость',
    table: 'Таблица результатов',
    mastery: 'Усвоение предмета',
    discipline: 'Дисциплина журнала',
    load: 'Учителя',
    rooms: 'Кабинеты',
    classes: 'Классы',
    freePeriods: 'Окна',
  },
  quarter: '{{number}} четверть',
  provisional: 'Предварительно · {{moment}}',
  final: 'Итог · закрыта {{date}} · версия {{version}}',
  notOfficial: 'Неофициально',
  range: '{{from}} – {{to}}',
  week: 'Неделя с {{date}}',
  exportedAt: 'Выгружено {{moment}}',
  noTutor: 'Без тьютора',
  columns: {
    class: 'Класс',
    tutor: 'Тьютор',
    present: 'Присутствовал',
    late: 'Опоздал',
    absent: 'Отсутствовал',
    skipped: 'Пропустил урок',
    unmarked: 'Не отмечено',
    exempt: 'Освобождён',
    expected: 'Ожидалось',
    percentOfExpected: '% от ожидаемых',
    daily: 'Посещаемость за день, %',
    student: 'Ученик',
    grade: 'Оценка',
    band: 'Диапазон',
    students: 'Учеников',
    percent: '%',
    teacher: 'Учитель',
    held: 'Проведено уроков',
    notStarted: 'Не начат',
    inProgress: 'В работе',
    complete: 'Заполнен',
    lockedIncomplete: 'Закрыт незаполненным',
    noAttendance: 'Посещаемость не отмечена',
    noTopic: 'Без темы',
    worksMissing: 'Работы без баллов',
    unplanned: 'Незапланированные работы',
    lateEntries: 'Записи после срока',
    lessons: 'Уроков за неделю',
    planned: 'Плановая нагрузка',
    elsewhere: 'Другие филиалы',
    contract: 'По договору',
    invigilations: 'Дежурства на экзаменах',
    vacancy: 'Вакансия',
    subject: 'Предмет',
    load: 'Нагрузка',
    room: 'Кабинет',
    periods: 'Уроков в неделе',
    weekday: 'День',
    time: 'Время',
  },
  states: { exempt: 'Освобождён', not_assessed: 'Не аттестован', no_result: 'Нет результата' },
  total: 'Итого',
  fileNames: {
    attendance: 'poseshchaemost',
    table: 'tablitsa-rezultatov',
    mastery: 'usvoenie-predmeta',
    discipline: 'distsiplina-zhurnala',
    load: 'nagruzka',
  },
};

const uz: ReportExportTexts = {
  sheets: {
    attendance: 'Davomat',
    table: 'Natijalar jadvali',
    mastery: 'Fanni oʻzlashtirish',
    discipline: 'Jurnal intizomi',
    load: 'Oʻqituvchilar',
    rooms: 'Xonalar',
    classes: 'Sinflar',
    freePeriods: 'Boʻsh darslar',
  },
  quarter: '{{number}}-chorak',
  provisional: 'Dastlabki · {{moment}}',
  final: 'Yakuniy · yopilgan {{date}} · {{version}}-versiya',
  notOfficial: 'Rasmiy emas',
  range: '{{from}} – {{to}}',
  week: '{{date}} haftasi',
  exportedAt: 'Yuklangan {{moment}}',
  noTutor: 'Tyutorsiz',
  columns: {
    class: 'Sinf',
    tutor: 'Tyutor',
    present: 'Kelgan',
    late: 'Kechikkan',
    absent: 'Kelmagan',
    skipped: 'Darsga kirmagan',
    unmarked: 'Belgilanmagan',
    exempt: 'Ozod',
    expected: 'Kutilgan',
    percentOfExpected: 'Kutilgandan %',
    daily: 'Kunlik davomat %',
    student: 'Oʻquvchi',
    grade: 'Baho',
    band: 'Oraliq',
    students: 'Oʻquvchilar',
    percent: '%',
    teacher: 'Oʻqituvchi',
    held: 'Oʻtilgan darslar',
    notStarted: 'Boshlanmagan',
    inProgress: 'Jarayonda',
    complete: 'Toʻldirilgan',
    lockedIncomplete: 'Toʻldirilmay yopilgan',
    noAttendance: 'Davomat belgilanmagan',
    noTopic: 'Mavzusiz',
    worksMissing: 'Ballari yoʻq ishlar',
    unplanned: 'Rejadan tashqari ishlar',
    lateEntries: 'Muddatdan keyingi yozuvlar',
    lessons: 'Haftadagi darslar',
    planned: 'Rejadagi yuklama',
    elsewhere: 'Boshqa filiallar',
    contract: 'Shartnoma boʻyicha',
    invigilations: 'Imtihon navbatchiligi',
    vacancy: 'Vakansiya',
    subject: 'Fan',
    load: 'Yuklama',
    room: 'Xona',
    periods: 'Haftadagi darslar soni',
    weekday: 'Kun',
    time: 'Vaqt',
  },
  states: { exempt: 'Ozod', not_assessed: 'Baholanmagan', no_result: 'Natija yoʻq' },
  total: 'Jami',
  fileNames: {
    attendance: 'davomat',
    table: 'natijalar-jadvali',
    mastery: 'fanni-ozlashtirish',
    discipline: 'jurnal-intizomi',
    load: 'yuklama',
  },
};

export const REPORT_EXPORT_TEXTS: Readonly<Record<Language, ReportExportTexts>> = Object.freeze({
  uz,
  ru,
  en,
});

/** The ASCII file names of the `filename` fallback of the download header. */
export const REPORT_EXPORT_ASCII_NAMES = Object.freeze({
  attendance: 'attendance',
  table: 'results-table',
  mastery: 'subject-mastery',
  discipline: 'journal-discipline',
  load: 'timetable-load',
});
