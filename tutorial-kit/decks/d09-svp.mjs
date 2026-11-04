import { F, T, D, K, S, BRANCH, signIn, shell, feedback } from './common.mjs';

export const attendanceHome = F('Home: attendance of all classes today', {
  what: 'Every class’s attendance today, with the classes below the branch threshold marked.',
  steps: ['**Home** → **Attendance of all classes today**: the branch figure, "n classes below 80%", per class **Today**'],
  show: ['At 10:00 of a school day (time machine): one class "below"'],
  time: 'The threshold is School setup → Settings → Early-warning list → "Attendance below, percent" (default 80).',
});

export default {
  title: 'Spiritual and Moral VP tutorial',
  footer: 'Sodiq platform tutorials · Vice Principal for Spiritual and Moral Education',
  slides: [
    { kind: 'cover', kicker: 'Tutorial · Vice Principal', title: 'Vice Principal for Spiritual and Moral Education', sub: 'Watches attendance across the branch and knows every student and their family contacts. Views only.', meta: `Demo: Shoira Valiyeva, "${BRANCH}" (and Demo Yunusobod for history) · Chrome “Spiritual VP”` },
    K('The role in one slide', [
      { title: 'Sees', body: ['Attendance of every class, and attendance analytics', 'The student list (last column: attendance %, never the average)', 'A student’s Overview (Basic and Contact), Attendance, Timetable, Relatives'] },
      { title: 'Also', body: ['Timetables of the branch', 'Journals: attendance only', 'Early warning: attendance reasons only'] },
      { title: 'Not', body: ['Marks, results or plans', 'Exports of students', 'Events (Release 2)'], tone: 'warn' },
    ]),
    ...signIn('Vice Principal for Spiritual and Moral Education', false),
    shell('Spiritual VP', 'Home, People, Classes and subjects, Timetable, Journal, Results'),
    attendanceHome,
    F('Students and families', {
      what: 'Who the students are and how to reach their families.',
      steps: ['**People** → **Students** (view): filters Grade, Class, Groups, Status', 'Student → Overview (Basic, Contact), **Attendance**, **Timetable**, **Relatives** (name, relationship, phones)'],
      show: ['Find a student with "Absences in a row"; open Relatives'],
    }),
    F('Attendance in the journals', {
      what: 'The attendance columns of every journal; no numbers.',
      steps: ['**Journal** → Journals → a class → attendance only', 'Journal → **Student absences** (view): reasons the Tutors recorded'],
    }),
    F('Attendance report and early warning', {
      what: 'Attendance by class, by Tutor or by day.',
      steps: ['Results → **Reports** → **Attendance**: Rows By class / By Tutor or Class teacher / By day; up to 92 days → Excel', 'Results → **Early warning**: Low attendance, Absences in a row'],
      show: ['Demo Yunusobod, October: the class with the lowest attendance'],
    }),
    F('Timetables and classes', {
      what: 'The week of every class, teacher and room.',
      steps: ['**Timetable** → views', '**Classes and subjects** → Classes, Groups (view)'],
    }),
    feedback,
  ],
};
