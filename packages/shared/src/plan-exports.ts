import type { Language } from './language.js';

/**
 * The texts of a plan's PDF and Excel and of the plan reports' Excel (task
 * 8.8, pull request #226; `edge/lesson-plans`: "Plans export to PDF and Excel
 * with their marks"; `edge/system-behaviour`: "Interface texts exist in three
 * languages"). Written on the server in the language of the account.
 */
export interface PlanExportTexts {
  readonly plan: string;
  readonly quarter: string;
  readonly teacher: string;
  readonly asOf: string;
  readonly page: string;
  readonly columns: {
    readonly number: string;
    readonly date: string;
    readonly topic: string;
    readonly classworks: string;
    readonly homeworks: string;
    readonly objectives: string;
    readonly materials: string;
    readonly marks: string;
  };
  readonly marks: {
    readonly movedFrom: string;
    readonly editedAfterLesson: string;
    readonly notDelivered: string;
    readonly notGiven: string;
    readonly notHeld: string;
    readonly copyOf: string;
  };
  readonly notCovered: string;
  /** Task 9.2d: the "carried in" tray and the outcomes of not-covered items. */
  readonly carriedIn: string;
  readonly outcomes: {
    readonly merged: string;
    readonly carried: string;
    readonly carriedAutomatic: string;
    readonly dropped: string;
  };
  readonly reports: {
    readonly completeness: string;
    readonly progress: string;
    readonly requests: string;
    readonly unit: string;
    readonly teacher: string;
    readonly subject: string;
    readonly department: string;
    readonly state: string;
    readonly rows: string;
    readonly noTopic: string;
    readonly flag: string;
    readonly belowMinimum: string;
    readonly planned: string;
    readonly held: string;
    readonly delivered: string;
    readonly notCovered: string;
    readonly behind: string;
    readonly plannedWorks: string;
    readonly notHeldWorks: string;
    readonly percentNotHeld: string;
    readonly kind: string;
    readonly status: string;
    readonly decidedBy: string;
    readonly decidedOn: string;
    readonly changes: string;
    readonly yes: string;
    readonly states: Readonly<Record<string, string>>;
    readonly flags: Readonly<Record<string, string>>;
    readonly kinds: Readonly<Record<string, string>>;
    readonly statuses: Readonly<Record<string, string>>;
  };
  /** The first word of the file names. */
  readonly fileNames: { readonly plan: string; readonly report: string };
}

const en: PlanExportTexts = {
  plan: 'Lesson plan',
  quarter: 'Quarter {{number}}',
  teacher: 'Teacher: {{name}}',
  asOf: 'As of {{moment}}',
  page: 'Page {{page}}',
  columns: {
    number: 'No.',
    date: 'Date',
    topic: 'Topic',
    classworks: 'Classwork',
    homeworks: 'Homework',
    objectives: 'Objectives',
    materials: 'Materials',
    marks: 'Marks',
  },
  marks: {
    movedFrom: 'moved from {{date}}',
    editedAfterLesson: 'edited after the lesson',
    notDelivered: 'topic not delivered',
    notGiven: 'not given: {{titles}}',
    notHeld: 'not held: {{titles}}',
    copyOf: 'not delivered on {{date}}',
  },
  notCovered: 'Not covered',
  carriedIn: 'Carried in',
  outcomes: {
    merged: 'merged into the lesson of {{date}}',
    carried: 'carried to the next quarter',
    carriedAutomatic: 'carried to the next quarter at closing',
    dropped: 'dropped: {{reason}}',
  },
  reports: {
    completeness: 'Plan completeness',
    progress: 'Plan progress',
    requests: 'Plan edit requests',
    unit: 'Class or group',
    teacher: 'Teacher',
    subject: 'Subject',
    department: 'Department',
    state: 'State',
    rows: 'Lessons',
    noTopic: 'Lessons with no topic',
    flag: 'Flag',
    belowMinimum: 'Below the minimum works',
    planned: 'Lessons planned',
    held: 'Lessons held',
    delivered: 'Topics delivered',
    notCovered: 'Items not covered',
    behind: 'Behind the plan',
    plannedWorks: 'Planned works',
    notHeldWorks: 'Works not held',
    percentNotHeld: 'Share not held, %',
    kind: 'Kind',
    status: 'Status',
    decidedBy: 'Decided by',
    decidedOn: 'Decided on',
    changes: 'Changes',
    yes: 'Yes',
    states: {
      complete: 'Complete',
      incomplete: 'Incomplete',
      not_started: 'Not started',
      no_lessons: 'No lessons',
    },
    flags: { overdue: 'Overdue', window_not_opened: 'Window not opened', vacancy: 'Vacancy' },
    kinds: { text: 'Text', replan: 'Re-plan', extension: 'Extension' },
    statuses: {
      prepared: 'Prepared',
      sent: 'Sent',
      approved: 'Approved',
      refused: 'Refused',
      void: 'Void',
    },
  },
  fileNames: { plan: 'Lesson-plan', report: 'Plan-report' },
};

const ru: PlanExportTexts = {
  plan: 'План уроков',
  quarter: '{{number}} четверть',
  teacher: 'Учитель: {{name}}',
  asOf: 'По состоянию на {{moment}}',
  page: 'Страница {{page}}',
  columns: {
    number: '№',
    date: 'Дата',
    topic: 'Тема',
    classworks: 'Классная работа',
    homeworks: 'Домашнее задание',
    objectives: 'Цели',
    materials: 'Материалы',
    marks: 'Отметки',
  },
  marks: {
    movedFrom: 'перенесено с {{date}}',
    editedAfterLesson: 'изменено после урока',
    notDelivered: 'тема не пройдена',
    notGiven: 'не задано: {{titles}}',
    notHeld: 'не проводилось: {{titles}}',
    copyOf: 'не пройдено {{date}}',
  },
  notCovered: 'Не пройдено',
  carriedIn: 'Перенесено',
  outcomes: {
    merged: 'объединено с уроком {{date}}',
    carried: 'перенесено в следующую четверть',
    carriedAutomatic: 'перенесено в следующую четверть при закрытии',
    dropped: 'удалено: {{reason}}',
  },
  reports: {
    completeness: 'Заполненность планов',
    progress: 'Прохождение планов',
    requests: 'Запросы на изменение планов',
    unit: 'Класс или группа',
    teacher: 'Учитель',
    subject: 'Предмет',
    department: 'Кафедра',
    state: 'Состояние',
    rows: 'Уроки',
    noTopic: 'Уроки без темы',
    flag: 'Отметка',
    belowMinimum: 'Ниже минимума работ',
    planned: 'Уроков запланировано',
    held: 'Уроков проведено',
    delivered: 'Тем пройдено',
    notCovered: 'Пунктов не пройдено',
    behind: 'Отстаёт от плана',
    plannedWorks: 'Запланированных работ',
    notHeldWorks: 'Работ не проводилось',
    percentNotHeld: 'Доля не проведённых, %',
    kind: 'Вид',
    status: 'Статус',
    decidedBy: 'Решил',
    decidedOn: 'Дата решения',
    changes: 'Изменения',
    yes: 'Да',
    states: {
      complete: 'Заполнен',
      incomplete: 'Не заполнен',
      not_started: 'Не начат',
      no_lessons: 'Нет уроков',
    },
    flags: { overdue: 'Просрочен', window_not_opened: 'Окно не открыто', vacancy: 'Вакансия' },
    kinds: { text: 'Текст', replan: 'Перепланирование', extension: 'Продление' },
    statuses: {
      prepared: 'Подготовлен',
      sent: 'Отправлен',
      approved: 'Одобрен',
      refused: 'Отклонён',
      void: 'Недействителен',
    },
  },
  fileNames: { plan: 'План-уроков', report: 'Отчёт-по-планам' },
};

const uz: PlanExportTexts = {
  plan: 'Dars rejasi',
  quarter: '{{number}}-chorak',
  teacher: 'Oʻqituvchi: {{name}}',
  asOf: '{{moment}} holatiga',
  page: '{{page}}-sahifa',
  columns: {
    number: '№',
    date: 'Sana',
    topic: 'Mavzu',
    classworks: 'Sinf ishi',
    homeworks: 'Uy vazifasi',
    objectives: 'Maqsadlar',
    materials: 'Materiallar',
    marks: 'Belgilar',
  },
  marks: {
    movedFrom: '{{date}} dan koʻchirildi',
    editedAfterLesson: 'darsdan keyin tahrirlandi',
    notDelivered: 'mavzu oʻtilmadi',
    notGiven: 'berilmadi: {{titles}}',
    notHeld: 'oʻtkazilmadi: {{titles}}',
    copyOf: '{{date}} da oʻtilmagan',
  },
  notCovered: 'Oʻtilmagan',
  carriedIn: 'Koʻchirilgan',
  outcomes: {
    merged: '{{date}} darsiga birlashtirildi',
    carried: 'keyingi chorakka koʻchirildi',
    carriedAutomatic: 'yopishda keyingi chorakka koʻchirildi',
    dropped: 'oʻchirildi: {{reason}}',
  },
  reports: {
    completeness: 'Rejalar toʻliqligi',
    progress: 'Rejalarning bajarilishi',
    requests: 'Rejalarni tahrirlash soʻrovlari',
    unit: 'Sinf yoki guruh',
    teacher: 'Oʻqituvchi',
    subject: 'Fan',
    department: 'Kafedra',
    state: 'Holati',
    rows: 'Darslar',
    noTopic: 'Mavzusiz darslar',
    flag: 'Belgi',
    belowMinimum: 'Ishlar minimumidan kam',
    planned: 'Rejalashtirilgan darslar',
    held: 'Oʻtkazilgan darslar',
    delivered: 'Oʻtilgan mavzular',
    notCovered: 'Oʻtilmagan bandlar',
    behind: 'Rejadan orqada',
    plannedWorks: 'Rejalashtirilgan ishlar',
    notHeldWorks: 'Oʻtkazilmagan ishlar',
    percentNotHeld: 'Oʻtkazilmaganlar ulushi, %',
    kind: 'Turi',
    status: 'Holati',
    decidedBy: 'Hal qildi',
    decidedOn: 'Hal qilingan sana',
    changes: 'Oʻzgarishlar',
    yes: 'Ha',
    states: {
      complete: 'Toʻliq',
      incomplete: 'Toʻliq emas',
      not_started: 'Boshlanmagan',
      no_lessons: 'Darslar yoʻq',
    },
    flags: {
      overdue: 'Muddati oʻtgan',
      window_not_opened: 'Oyna ochilmagan',
      vacancy: 'Vakansiya',
    },
    kinds: { text: 'Matn', replan: 'Qayta rejalash', extension: 'Uzaytirish' },
    statuses: {
      prepared: 'Tayyorlangan',
      sent: 'Yuborilgan',
      approved: 'Tasdiqlangan',
      refused: 'Rad etilgan',
      void: 'Bekor',
    },
  },
  fileNames: { plan: 'Dars-rejasi', report: 'Rejalar-hisoboti' },
};

export const PLAN_EXPORT_TEXTS: Readonly<Record<Language, PlanExportTexts>> = { uz, ru, en };

/** The ASCII names of the files, for a browser that ignores `filename*`. */
export const PLAN_EXPORT_ASCII_NAMES = { plan: 'lesson-plan', report: 'plan-report' } as const;
