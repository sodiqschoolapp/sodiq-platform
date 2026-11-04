import { F, T, D, K, S, BRANCH, signIn, shell, feedback } from './common.mjs';

export default {
  title: 'Principal tutorial',
  footer: 'Sodiq platform tutorials · Principal',
  slides: [
    { kind: 'cover', kicker: 'Tutorial · Principal', title: 'Principal', sub: 'Sees everything in the branch: timetables, every journal, lists, results and analytics. Changes nothing.', meta: `Demo: Rustam Yoʻldoshev, "${BRANCH}" (and Demo Yunusobod for two months of data) · Firefox private window` },
    K('The role in one slide', [
      { title: 'Sees', body: ['School setup, people, classes, timetable, journals, plans, results', 'The audit log of the branch', 'Requests and their state'] },
      { title: 'Exports', body: ['Lists (staff without phone; students without identity documents)', 'Journals and the branch export', 'Reports and rating as Excel'] },
      { title: 'Never', body: ['Creates, edits or archives anything', 'Decides a request', 'The publish button is not there: the checks are'], tone: 'warn' },
    ], { notes: 'The Principal’s video is a tour. Every screen opens; no screen has a save button for this role. Hidden fields like a date of birth open with a logged "Show" button.' }),
    ...signIn('Principal', false),
    shell('Principal', 'Home, School setup, People, Classes and subjects, Timetable, Journal, Results, Lesson plans, Audit log'),
    F('Home page', {
      what: 'The branch in four numbers.',
      steps: ['**Students**, **Staff**, **Attendance today**', '**Results by grade** (Provisional / Final)'],
      show: ['Demo Yunusobod: attendance of today, results of quarter 1'],
    }),
    F('School setup, read only', {
      what: 'The setup checklist and every setup page, without edit buttons.',
      steps: ['**School setup** → Setup checklist, Branch, Buildings and floors, Rooms (List / By floor), Divisions, Academic years, Slot types, Day templates, Calendar, Settings, Subjects', '**Export** on the lists'],
      show: ['Calendar with its days off; Settings with Edit days'],
    }),
    F('People', {
      what: 'Staff, students, parents, vacancies, Head Teachers, accounts never used.',
      steps: ['People → **Staff**: Export leaves out the phone', 'People → **Students**: all tabs; **Show documents and date of birth** (logged)', 'People → **Parents**: search by phone; **Show workplace and email**', '**Accounts never used**, **Entries after a reset**'],
      show: ['Open a student; press Show; then find that show in the audit log'],
    }),
    F('Classes, groups and the teaching load', {
      what: 'Every class, group and load row of the branch.',
      steps: ['**Classes and subjects** → Classes, Groups', 'Timetable → **Teaching load** ("Not a draft: read only.")', 'Timetable → **Draft builder**: the checks without Publish'],
    }),
    F('Timetable', {
      what: 'Every view, every version, every daily change.',
      steps: ['**Timetable views**: School, Class, Teacher, Room; Day / Week; Print, Excel', '**Day changes**, **Exams**, **Absences**, **Room closures** (read)', '**Version history** → **Compare with**; a lesson’s **History**'],
      show: ['The school view of today'],
    }),
    F('Journals', {
      what: 'Every journal of the branch, read only, with every export.',
      steps: ['**Journal** → Journals → any class → Grid / Lesson mode', '**Unlock requests** (Branch tab), **Exemptions** (with reasons), **Student absences**, **Orphan lessons**, **Closing checklist**', '**Journal discipline**; **Export of the branch** → Download'],
      show: ['Journal discipline of October in Demo Yunusobod', 'The seeded forgotten day as "Not started"'],
    }),
    F('Lesson plans', {
      what: 'Every plan, window and request.',
      steps: ['**Lesson plans** → plans, **Plan windows**, **Plan edit requests**, **Plan reports**, **Master plans**'],
    }),
    F('Results and reports', {
      what: 'Rating, early warning and the five reports.',
      steps: ['Results → **Rating**: In a subject / Of a class / Of classes', 'Results → **Early warning** (branch)', 'Results → **Reports**: Attendance, Results table, Subject mastery, Journal discipline, Timetable load → Excel'],
      show: ['Rating "Of classes" for grade 5: 5 Melbourne against 5 Tokyo'],
      time: '"Provisional" until the AVP closes the quarter, then "Final".',
    }),
    F('Audit log', {
      what: 'Who changed what in the branch, before and after.',
      steps: ['**Audit log** → From, To, Kind, About whom', 'Any panel → **Change log**'],
      show: ['Kind = Journal: a correction with its reason'],
    }),
    feedback,
  ],
};
