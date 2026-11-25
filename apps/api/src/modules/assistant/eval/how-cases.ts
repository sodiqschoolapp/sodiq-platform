import type { AssistantRole } from '@sodiq/shared';

/**
 * Task 11.19 (build plan, Done when: "the eval set gains 30 'how do we' and 'what does this do'
 * questions across the three roles, answered with the right page and steps, among them actions
 * the person's role cannot take (it names the role that can)"): 12 of the Super Admin, 9 of the
 * Academic Vice Principal and 9 of the Teacher, each in the four forms of the set. CI replays a
 * search of the map and the link; the steps, in the names the person sees, and the naming of
 * the role are scored only by `pnpm assistant:eval` against the real model (plan, review should
 * fix 7). Three intents (one per role) ask how to do what the role's list can propose: the
 * answer gives the steps and offers to do it, and proposes nothing before the person agrees
 * (review correction 1).
 */
export interface HowIntent {
  id: string;
  role: AssistantRole;
  /** The map node a right answer finds (`find_in_platform` or `explain_place`). */
  finds: string;
  /** The words the replay searches the map with. */
  search: string;
  /** The page a right answer links; none when the role does not open it. */
  page?: string;
  /** The role cannot take it: the map shows it is not among the roles that see it. */
  cannot?: { roleWords: readonly string[] };
  /** A route on the role's list that does it: offered, never proposed in this answer. */
  offers?: string;
  texts: Readonly<Record<'uz' | 'uz-Cyrl' | 'ru' | 'en', string>>;
}

/** Stems of the Super Admin's name in the three languages, folded by `spellingKey`. */
const SUPER_ADMIN = ['super'];
/** Stems of the Academic Vice Principal's name. */
const VICE = ['vice', 'zamestitel', 'orinbosar', 'urinbosar'];

export const HOW_INTENTS: readonly HowIntent[] = [
  {
    id: 'how-move-student-branch',
    role: 'super_admin',
    finds: 'features/people/student-panel.tsx#button:people.students.branchMoves.move',
    search: 'Move to another branch',
    page: '/people/students',
    texts: {
      uz: 'Oʻquvchini boshqa filialga qanday oʻtkazamiz?',
      'uz-Cyrl': 'Ўқувчини бошқа филиалга қандай ўтказамиз?',
      ru: 'Как перевести ученика в другой филиал?',
      en: 'How do we move a student to another branch?',
    },
  },
  {
    id: 'how-add-room',
    role: 'super_admin',
    finds: 'features/setup/rooms-page.tsx#button:setup.rooms.add',
    search: 'Add room',
    page: '/setup/rooms',
    offers: 'POST /api/setup/rooms',
    texts: {
      uz: 'Yangi xonani qanday qoʻshamiz?',
      'uz-Cyrl': 'Янги хонани қандай қўшамиз?',
      ru: 'Как добавить новый кабинет?',
      en: 'How do we add a new room?',
    },
  },
  {
    id: 'what-bulk-cancel',
    role: 'super_admin',
    finds: 'features/timetable/day-page.tsx#button:timetable.bulk.open',
    search: 'Bulk cancel',
    page: '/timetable/day',
    texts: {
      uz: 'Kun sahifasidagi «Ommaviy bekor qilish» tugmasi nima qiladi?',
      'uz-Cyrl': 'Кун саҳифасидаги «Оммавий бекор қилиш» тугмаси нима қилади?',
      ru: 'Что делает кнопка «Массовая отмена» на странице дня?',
      en: 'What does the Bulk cancel button on the day page do?',
    },
  },
  {
    id: 'how-reset-password',
    role: 'super_admin',
    finds: 'features/people/account-access-section.tsx#button:people.access.resetPassword',
    search: 'Reset password',
    page: '/people/staff',
    texts: {
      uz: 'Oʻqituvchining parolini qanday tiklayman?',
      'uz-Cyrl': 'Ўқитувчининг паролини қандай тиклайман?',
      ru: 'Как сбросить пароль учителя?',
      en: 'How do I reset a teacher’s password?',
    },
  },
  {
    id: 'how-publish-version',
    role: 'super_admin',
    finds: 'features/timetable/publish-step.tsx#button:timetable.publish.action',
    search: 'Publish',
    page: '/timetable/builder',
    texts: {
      uz: 'Dars jadvali versiyasini qanday eʼlon qilamiz?',
      'uz-Cyrl': 'Дарс жадвали версиясини қандай эълон қиламиз?',
      ru: 'Как опубликовать версию расписания?',
      en: 'How do we publish a timetable version?',
    },
  },
  {
    id: 'how-close-quarter',
    role: 'super_admin',
    finds: 'features/results/closing-page.tsx#button:results.closing.closeQuarter',
    search: 'Close the quarter',
    page: '/results/closing',
    texts: {
      uz: 'Choraklikni qanday yopamiz?',
      'uz-Cyrl': 'Чораклик қандай ёпилади?',
      ru: 'Как закрыть четверть?',
      en: 'How do we close a quarter?',
    },
  },
  {
    id: 'where-new-exemption',
    role: 'super_admin',
    finds: 'features/journal/exemptions-page.tsx#button:journal.exemptions.new',
    search: 'New exemption',
    page: '/journal/exemptions',
    texts: {
      uz: 'Oʻquvchiga ozod qilishni qayerda yarataman?',
      'uz-Cyrl': 'Ўқувчига озод қилишни қаерда яратаман?',
      ru: 'Где оформить освобождение для ученика?',
      en: 'Where do I create an exemption for a student?',
    },
  },
  {
    id: 'how-import-students',
    role: 'super_admin',
    finds: 'features/people/student-import-page.tsx#button:people.import.template',
    search: 'Download the template',
    page: '/people/students/import',
    texts: {
      uz: 'Oʻquvchilarni Exceldan qanday import qilamiz?',
      'uz-Cyrl': 'Ўқувчиларни Excelдан қандай импорт қиламиз?',
      ru: 'Как загрузить учеников из Excel?',
      en: 'How do we import students from Excel?',
    },
  },
  {
    id: 'how-add-vacancy',
    role: 'super_admin',
    finds: 'features/people/vacancies-page.tsx#button:people.vacancies.add',
    search: 'Add vacancy',
    page: '/people/vacancies',
    texts: {
      uz: 'Vakansiyani qanday qoʻshamiz?',
      'uz-Cyrl': 'Вакансияни қандай қўшамиз?',
      ru: 'Как добавить вакансию?',
      en: 'How do we add a vacancy?',
    },
  },
  {
    id: 'what-reset-second-step',
    role: 'super_admin',
    finds: 'features/people/account-access-section.tsx#button:people.access.resetSecondStep',
    search: 'Reset second step',
    page: '/people/staff',
    texts: {
      uz: '«Ikkinchi bosqichni tiklash» tugmasi nima qiladi?',
      'uz-Cyrl': '«Иккинчи босқични тиклаш» тугмаси нима қилади?',
      ru: 'Что делает кнопка «Сбросить второй шаг»?',
      en: 'What does the Reset second step button do?',
    },
  },
  {
    id: 'how-substitute-absence',
    role: 'super_admin',
    finds: 'features/timetable/absence-panel.tsx#button:timetable.absences.substituteJournal',
    search: 'Substitute for the whole absence',
    page: '/timetable/absences',
    texts: {
      uz: 'Kasal oʻqituvchining oʻrniga qanday qilib oʻrinbosar qoʻyamiz?',
      'uz-Cyrl': 'Касал ўқитувчининг ўрнига қандай қилиб ўринбосар қўямиз?',
      ru: 'Как поставить замену за отсутствующего учителя?',
      en: 'How do we put a substitute in for an absent teacher?',
    },
  },
  {
    id: 'how-send-feedback',
    role: 'super_admin',
    finds: 'features/feedback/feedback-button.tsx#button:feedback.button',
    search: 'Send feedback',
    page: '/',
    texts: {
      uz: 'Platforma haqida fikrni qanday yuboraman?',
      'uz-Cyrl': 'Платформа ҳақида фикрни қандай юбораман?',
      ru: 'Как отправить отзыв о платформе?',
      en: 'How do I send feedback about the platform?',
    },
  },
  {
    id: 'vice-how-move-class',
    role: 'academic_vice_principal',
    finds: 'features/people/student-panel.tsx#button:people.students.moves.moveClass',
    search: 'Move to another class',
    page: '/people/students',
    texts: {
      uz: 'Oʻquvchini boshqa sinfga qanday oʻtkazamiz?',
      'uz-Cyrl': 'Ўқувчини бошқа синфга қандай ўтказамиз?',
      ru: 'Как перевести ученика в другой класс?',
      en: 'How do we move a student to another class?',
    },
  },
  {
    id: 'vice-cannot-add-room',
    role: 'academic_vice_principal',
    finds: 'features/setup/rooms-page.tsx#button:setup.rooms.add',
    search: 'Add room',
    cannot: { roleWords: SUPER_ADMIN },
    texts: {
      uz: 'Yangi xona qanday qoʻshaman?',
      'uz-Cyrl': 'Янги хона қандай қўшаман?',
      ru: 'Как мне добавить новый кабинет?',
      en: 'How do I add a new room?',
    },
  },
  {
    id: 'vice-cannot-new-branch',
    role: 'academic_vice_principal',
    finds: 'features/setup/branches-page.tsx#button:setup.branch.newBranch',
    search: 'New branch',
    cannot: { roleWords: SUPER_ADMIN },
    texts: {
      uz: 'Yangi filialni qanday ochaman?',
      'uz-Cyrl': 'Янги филиални қандай очаман?',
      ru: 'Как мне создать новый филиал?',
      en: 'How do I create a new branch?',
    },
  },
  {
    id: 'vice-how-decide-unlock',
    role: 'academic_vice_principal',
    finds: 'features/journal/edit-period.tsx#panel:journal.locks.decideTitle',
    search: 'Decide the unlock request',
    page: '/journal/unlocks',
    texts: {
      uz: 'Oʻqituvchining ochish soʻroviga qanday javob beraman?',
      'uz-Cyrl': 'Ўқитувчининг очиш сўровига қандай жавоб бераман?',
      ru: 'Как мне решить запрос учителя на разблокировку?',
      en: 'How do I decide a teacher’s unlock request?',
    },
  },
  {
    id: 'vice-how-day-off',
    role: 'academic_vice_principal',
    finds: 'features/setup/calendar-page.tsx#button:setup.calendar.add',
    search: 'Add entry',
    page: '/setup/calendar',
    offers: 'POST /api/setup/calendar-entries',
    texts: {
      uz: 'Bir kunni dam olish kuni qilib qanday belgilaymiz?',
      'uz-Cyrl': 'Бир кунни дам олиш куни қилиб қандай белгилаймиз?',
      ru: 'Как сделать день выходным?',
      en: 'How do we make a date a day off?',
    },
  },
  {
    id: 'vice-how-new-class',
    role: 'academic_vice_principal',
    finds: 'features/classes/classes-page.tsx#button:classes.add',
    search: 'New class',
    page: '/classes',
    texts: {
      uz: 'Yangi sinfni qanday yaratamiz?',
      'uz-Cyrl': 'Янги синфни қандай яратамиз?',
      ru: 'Как создать новый класс?',
      en: 'How do we create a new class?',
    },
  },
  {
    id: 'vice-what-mark-handled',
    role: 'academic_vice_principal',
    finds: 'features/results/early-warning-page.tsx#button:results.earlyWarning.handle',
    search: 'Mark handled',
    page: '/results/early-warning',
    texts: {
      uz: 'Erta ogohlantirish roʻyxatidagi «Koʻrib chiqildi» tugmasi nima qiladi?',
      'uz-Cyrl': 'Эрта огоҳлантириш рўйхатидаги «Кўриб чиқилди» тугмаси нима қилади?',
      ru: 'Что делает кнопка «Отметить как рассмотренное» в списке раннего предупреждения?',
      en: 'What does Mark handled on the early warning list do?',
    },
  },
  {
    id: 'vice-how-journal-export',
    role: 'academic_vice_principal',
    finds: 'features/journal/branch-exports-page.tsx#button:journal.exports.ask',
    search: 'Ask for the export',
    page: '/journal/exports',
    texts: {
      uz: 'Filialning barcha jurnallarini fayl qilib qanday olaman?',
      'uz-Cyrl': 'Филиалнинг барча журналларини файл қилиб қандай оламан?',
      ru: 'Как получить все журналы филиала файлом?',
      en: 'How do I get all the journals of the branch as a file?',
    },
  },
  {
    id: 'vice-how-columns',
    role: 'academic_vice_principal',
    finds: 'components/list/list-page.tsx#button:list.columns',
    search: 'Columns',
    page: '/people/students',
    texts: {
      uz: 'Roʻyxatda qaysi ustunlar koʻrinishini qanday tanlayman?',
      'uz-Cyrl': 'Рўйхатда қайси устунлар кўринишини қандай танлайман?',
      ru: 'Как выбрать, какие столбцы показывает список?',
      en: 'How do I choose which columns a list shows?',
    },
  },
  {
    id: 'teacher-how-unlock',
    role: 'teacher',
    finds: 'features/journal/edit-period.tsx#button:journal.locks.request',
    search: 'Request unlock',
    page: '/journal',
    offers: 'POST /api/journal/lessons/:lessonId/unlocks',
    texts: {
      uz: 'Qulflangan darsni ochishni qanday soʻrayman?',
      'uz-Cyrl': 'Қулфланган дарсни очишни қандай сўрайман?',
      ru: 'Как попросить разблокировать урок?',
      en: 'How do I ask to unlock a lesson?',
    },
  },
  {
    id: 'teacher-what-all-present',
    role: 'teacher',
    finds: 'features/journal/journal-page.tsx#button:journal.entry.allPresent',
    search: 'All present',
    page: '/journal',
    texts: {
      uz: 'Jurnaldagi «Hamma keldi» tugmasi nima qiladi?',
      'uz-Cyrl': 'Журналдаги «Ҳамма келди» тугмаси нима қилади?',
      ru: 'Что делает кнопка «Все присутствуют» в журнале?',
      en: 'What does All present in the journal do?',
    },
  },
  {
    id: 'teacher-cannot-publish',
    role: 'teacher',
    finds: 'features/timetable/publish-step.tsx#button:timetable.publish.action',
    search: 'Publish',
    cannot: { roleWords: [...SUPER_ADMIN, ...VICE] },
    texts: {
      uz: 'Dars jadvalini qanday eʼlon qilaman?',
      'uz-Cyrl': 'Дарс жадвалини қандай эълон қиламан?',
      ru: 'Как мне опубликовать расписание?',
      en: 'How do I publish the timetable?',
    },
  },
  {
    id: 'teacher-cannot-close-quarter',
    role: 'teacher',
    finds: 'features/results/closing-page.tsx#button:results.closing.closeQuarter',
    search: 'Close the quarter',
    cannot: { roleWords: [...SUPER_ADMIN, ...VICE] },
    texts: {
      uz: 'Choraklikni qanday yopaman?',
      'uz-Cyrl': 'Чоракликни қандай ёпаман?',
      ru: 'Как мне закрыть четверть?',
      en: 'How do I close the quarter?',
    },
  },
  {
    id: 'teacher-cannot-bulk-cancel',
    role: 'teacher',
    finds: 'features/timetable/day-page.tsx#button:timetable.bulk.open',
    search: 'Bulk cancel',
    cannot: { roleWords: [...SUPER_ADMIN, ...VICE] },
    texts: {
      uz: 'Bugungi barcha darslarni qanday bekor qilaman?',
      'uz-Cyrl': 'Бугунги барча дарсларни қандай бекор қиламан?',
      ru: 'Как мне отменить все уроки сегодня?',
      en: 'How do I cancel all of today’s lessons?',
    },
  },
  {
    id: 'teacher-cannot-reset-password',
    role: 'teacher',
    finds: 'features/people/account-access-section.tsx#button:people.access.resetPassword',
    search: 'Reset password',
    cannot: { roleWords: [...SUPER_ADMIN, ...VICE] },
    texts: {
      uz: 'Boshqa oʻqituvchining parolini qanday tiklayman?',
      'uz-Cyrl': 'Бошқа ўқитувчининг паролини қандай тиклайман?',
      ru: 'Как мне сбросить пароль другому учителю?',
      en: 'How do I reset another teacher’s password?',
    },
  },
  {
    id: 'teacher-how-next-lesson',
    role: 'teacher',
    finds: 'features/journal/journal-page.tsx#button:journal.lessonMode.nextLesson',
    search: 'Next lesson',
    page: '/journal',
    texts: {
      uz: 'Dars rejimida keyingi darsga qanday oʻtaman?',
      'uz-Cyrl': 'Дарс режимида кейинги дарсга қандай ўтаман?',
      ru: 'Как в режиме урока перейти к следующему уроку?',
      en: 'In lesson mode, how do I go to the next lesson?',
    },
  },
  {
    id: 'teacher-how-change-password',
    role: 'teacher',
    finds: 'features/access/app-menu.tsx#button:layout.changePassword',
    search: 'Change password',
    page: '/account/password',
    texts: {
      uz: 'Oʻz parolimni qanday oʻzgartiraman?',
      'uz-Cyrl': 'Ўз паролимни қандай ўзгартираман?',
      ru: 'Как сменить свой пароль?',
      en: 'How do I change my password?',
    },
  },
  {
    id: 'teacher-how-dark-theme',
    role: 'teacher',
    finds: 'components/theme-switch.tsx#tab:theme.label',
    search: 'Theme',
    page: '/account',
    texts: {
      uz: 'Qorongʻi mavzuga qanday oʻtaman?',
      'uz-Cyrl': 'Қоронғи мавзуга қандай ўтаман?',
      ru: 'Как включить тёмную тему?',
      en: 'How do I switch to the dark theme?',
    },
  },
];
