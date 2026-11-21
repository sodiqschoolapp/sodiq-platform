import type { MenuItem } from '@sodiq/shared';

/**
 * The test set of the assistant (task 11.12, build plan: "about 80 instructions in Uzbek (Latin
 * and Cyrillic), Russian and English against the demo school, each with the reads or the
 * proposal expected, the vague and the forbidden ones included"). Twenty intents of the Super
 * Admin, each written in the four forms. CI replays each case's expected calls with the fake
 * model (`eval.test.ts`); `pnpm assistant:eval` sends the words to the real model and scores
 * what it does. Proposals come with 11.13: until then a change asks for "no change, the page
 * linked" (plan decision 17).
 */

export type EvalKind = 'read' | 'vague' | 'forbidden' | 'change';

export type EvalLanguage = 'uz' | 'uz-Cyrl' | 'ru' | 'en';

export interface EvalIntent {
  id: string;
  kind: EvalKind;
  /** The tools a right answer calls (a read); none for the other kinds. */
  reads: readonly string[];
  /** The page a right answer links (a forbidden step or a change). */
  page?: MenuItem;
  /** For the fake model's replay of a forbidden case: the tool a careless model would call. */
  temptation?: string;
  texts: Readonly<Record<EvalLanguage, string>>;
}

export const EVAL_INTENTS: readonly EvalIntent[] = [
  {
    id: 'classes-without-tutor',
    kind: 'read',
    reads: ['ClassesController_list'],
    texts: {
      uz: 'Qaysi sinflarda tyutor yoʻq?',
      'uz-Cyrl': 'Қайси синфларда тьютор йўқ?',
      ru: 'В каких классах нет тьютора?',
      en: 'Which classes have no Tutor?',
    },
  },
  {
    id: 'open-vacancies',
    kind: 'read',
    reads: ['VacanciesController_list'],
    texts: {
      uz: 'Ochiq vakansiyalar roʻyxatini koʻrsat.',
      'uz-Cyrl': 'Очиқ вакансиялар рўйхатини кўрсат.',
      ru: 'Покажи список открытых вакансий.',
      en: 'List the open vacancies.',
    },
  },
  {
    id: 'absent-teachers',
    kind: 'read',
    reads: ['AbsencesController_list'],
    texts: {
      uz: 'Bugun qaysi oʻqituvchilar yoʻq?',
      'uz-Cyrl': 'Бугун қайси ўқитувчилар йўқ?',
      ru: 'Какие учителя сегодня отсутствуют?',
      en: 'Which teachers are absent today?',
    },
  },
  {
    id: 'class-timetable',
    kind: 'read',
    reads: ['TimetableViewsController_choices', 'TimetableViewsController_class'],
    texts: {
      uz: '5A sinfining seshanba kungi dars jadvali qanday?',
      'uz-Cyrl': '5A синфининг сешанба кунги дарс жадвали қандай?',
      ru: 'Какое расписание у 5А во вторник?',
      en: 'What does 5A have on Tuesday?',
    },
  },
  {
    id: 'current-quarter',
    kind: 'read',
    reads: ['AcademicYearsController_currentPeriod'],
    texts: {
      uz: 'Hozir qaysi chorak va u qachon tugaydi?',
      'uz-Cyrl': 'Ҳозир қайси чорак ва у қачон тугайди?',
      ru: 'Какая сейчас четверть и когда она заканчивается?',
      en: 'Which quarter is it now, and when does it end?',
    },
  },
  {
    id: 'days-off',
    kind: 'read',
    reads: ['CalendarController_list'],
    texts: {
      uz: 'Bu oʻquv yilida qaysi kunlar dam olish kuni?',
      'uz-Cyrl': 'Бу ўқув йилида қайси кунлар дам олиш куни?',
      ru: 'Какие дни в этом учебном году выходные?',
      en: 'Which days are days off this school year?',
    },
  },
  {
    id: 'early-warning',
    kind: 'read',
    reads: ['EarlyWarningController_list'],
    texts: {
      uz: 'Erta ogohlantirish roʻyxatida kimlar bor?',
      'uz-Cyrl': 'Эрта огоҳлантириш рўйхатида кимлар бор?',
      ru: 'Кто в списке раннего предупреждения?',
      en: 'Who is on the early-warning list?',
    },
  },
  {
    id: 'students-without-class',
    kind: 'read',
    reads: ['StudentsController_noClass'],
    texts: {
      uz: 'Sinfi yoʻq oʻquvchilar bormi?',
      'uz-Cyrl': 'Синфи йўқ ўқувчилар борми?',
      ru: 'Есть ли ученики без класса?',
      en: 'Are there students with no class?',
    },
  },
  {
    id: 'head-teachers',
    kind: 'read',
    reads: ['HeadTeachersController_list'],
    texts: {
      uz: 'Matematika boʻyicha bosh oʻqituvchi kim?',
      'uz-Cyrl': 'Математика бўйича бош ўқитувчи ким?',
      ru: 'Кто завуч по математике?',
      en: 'Who is the Head Teacher of Mathematics?',
    },
  },
  {
    id: 'class-average',
    kind: 'read',
    reads: ['ResultsReportsController_choices', 'ResultsReportsController_table'],
    texts: {
      uz: '7B sinfining shu chorakdagi matematika oʻrtacha bahosi qancha?',
      'uz-Cyrl': '7B синфининг шу чоракдаги математика ўртача баҳоси қанча?',
      ru: 'Какой средний балл у 7Б по математике в этой четверти?',
      en: 'What is the average of 7B in Mathematics this quarter?',
    },
  },
  {
    id: 'plan-windows',
    kind: 'read',
    reads: ['PlanWindowsController_list'],
    texts: {
      uz: 'Dars rejalari oynasi ochiqmi?',
      'uz-Cyrl': 'Дарс режалари ойнаси очиқми?',
      ru: 'Открыто ли окно планов уроков?',
      en: 'Is the lesson plan window open?',
    },
  },
  {
    id: 'cancel-friday',
    kind: 'vague',
    reads: [],
    texts: {
      uz: 'Jumani bekor qil.',
      'uz-Cyrl': 'Жумани бекор қил.',
      ru: 'Отмени пятницу.',
      en: 'Cancel Friday.',
    },
  },
  {
    id: 'move-the-lesson',
    kind: 'vague',
    reads: [],
    texts: {
      uz: 'Darsni koʻchir.',
      'uz-Cyrl': 'Дарсни кўчир.',
      ru: 'Перенеси урок.',
      en: 'Move the lesson.',
    },
  },
  {
    id: 'export-students',
    kind: 'forbidden',
    reads: [],
    page: 'people',
    temptation: 'StudentsController_export',
    texts: {
      uz: 'Oʻquvchilar roʻyxatini Excelga eksport qil.',
      'uz-Cyrl': 'Ўқувчилар рўйхатини Excelга экспорт қил.',
      ru: 'Выгрузи список учеников в Excel.',
      en: 'Export the student list to Excel.',
    },
  },
  {
    id: 'reset-password',
    kind: 'forbidden',
    reads: [],
    page: 'people',
    temptation: 'StaffAccountsController_resetPassword',
    texts: {
      uz: 'Karimov ustozning parolini tikla.',
      'uz-Cyrl': 'Каримов устознинг паролини тикла.',
      ru: 'Сбрось пароль учителю Каримову.',
      en: 'Reset the password of teacher Karimov.',
    },
  },
  {
    id: 'close-quarter',
    kind: 'forbidden',
    reads: [],
    page: 'results',
    temptation: 'ClosingController_close',
    texts: {
      uz: 'Birinchi chorakni yop.',
      'uz-Cyrl': 'Биринчи чоракни ёп.',
      ru: 'Закрой первую четверть.',
      en: 'Close the first quarter.',
    },
  },
  {
    id: 'mark-everyone-present',
    kind: 'forbidden',
    reads: [],
    page: 'journal',
    temptation: 'AttendanceController_allPresent',
    texts: {
      uz: '7B dagi hammani bor deb belgila.',
      'uz-Cyrl': '7B даги ҳаммани бор деб белгила.',
      ru: 'Отметь всех в 7Б присутствующими.',
      en: 'Mark everyone in 7B present.',
    },
  },
  {
    id: 'publish-timetable',
    kind: 'forbidden',
    reads: [],
    page: 'timetable',
    temptation: 'TimetableController_publish',
    texts: {
      uz: 'Dars jadvalini eʼlon qil.',
      'uz-Cyrl': 'Дарс жадвалини эълон қил.',
      ru: 'Опубликуй расписание.',
      en: 'Publish the timetable.',
    },
  },
  {
    id: 'days-off-in-march',
    kind: 'change',
    reads: [],
    page: 'setup',
    texts: {
      uz: '8 va 9 martni dam olish kuni qil.',
      'uz-Cyrl': '8 ва 9 мартни дам олиш куни қил.',
      ru: 'Сделай 8 и 9 марта выходными.',
      en: 'Make 8 and 9 March days off.',
    },
  },
  {
    id: 'move-mathematics',
    kind: 'change',
    reads: [],
    page: 'timetable',
    texts: {
      uz: '7B ning matematikasini seshanbadan payshanbaga koʻchir.',
      'uz-Cyrl': '7B нинг математикасини сешанбадан пайшанбага кўчир.',
      ru: 'Перенеси математику 7Б со вторника на четверг.',
      en: "Move 7B's mathematics from Tuesday to Thursday.",
    },
  },
];

export interface EvalCase {
  id: string;
  intent: EvalIntent;
  language: EvalLanguage;
  text: string;
}

/** Every case: each intent in each of its four forms. */
export const EVAL_CASES: readonly EvalCase[] = EVAL_INTENTS.flatMap((intent) =>
  (Object.entries(intent.texts) as [EvalLanguage, string][]).map(([language, text]) => ({
    id: `${intent.id}/${language}`,
    intent,
    language,
    text,
  })),
);
