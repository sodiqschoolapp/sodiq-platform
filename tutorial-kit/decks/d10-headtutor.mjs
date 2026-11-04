import { F, T, D, K, S, BRANCH, signIn, shell, feedback } from './common.mjs';
import { attendanceHome } from './d09-svp.mjs';

export default {
  title: 'Head Tutor tutorial',
  footer: 'Sodiq platform tutorials · Head Tutor',
  slides: [
    { kind: 'cover', kicker: 'Tutorial · Head Tutor', title: 'Head Tutor', sub: 'Oversees every class, its Tutor or Class teacher, and attendance. Reads every field of every student of the branch.', meta: `Demo: Ulugʻbek Tojiboyev, "${BRANCH}" · Firefox private window` },
    K('The role in one slide', [
      { title: 'Sees', body: ['All classes with their Tutors and Class teachers', 'Attendance by class and by Tutor', 'The school timetable and every class’s', 'Every field of every student, the financial group included'] },
      { title: 'Does', body: ['Exports the student list with every field group', 'Reads the discipline of Tutor lessons', 'Rating "Of a class" for every class'] },
      { title: 'Not', body: ['Changes to students, classes or marks', 'Results of subjects'], tone: 'warn' },
    ]),
    ...signIn('Head Tutor', false),
    shell('Head Tutor', 'Home, People, Classes and subjects, Timetable, Journal, Results'),
    attendanceHome,
    F('Classes and their Tutors', {
      what: 'Every class with its Tutor or Class teacher and their dates.',
      steps: ['**Classes and subjects** → **Classes** → a class → Tutors (Planned / Current / Ended)', 'Groups (view)'],
      show: ['5 Melbourne: Umida; an acting Tutor with dates'],
    }),
    F('Every student, every field', {
      what: 'The Head Tutor reads the whole record, contract and scholarship included.',
      steps: ['**People** → **Students** → filters, **Consent** ("Active, no consent")', 'Tabs: Overview (all groups), Attendance, Timetable, Relatives, **Contract and scholarship**', '**Export** → Also export: every group'],
      show: ['Export the branch with Contract, scholarship and consent'],
      who: 'Every export is logged.',
    }),
    F('Attendance by Tutor', {
      what: 'Which Tutor’s class misses most, and why.',
      steps: ['Results → **Reports** → **Attendance** → Rows **By Tutor or Class teacher**', 'Journal → **Student absences** (view): reasons recorded', 'Journal → **Journal discipline**: the Tutor subjects, read only'],
      show: ['October in Demo Yunusobod by Tutor'],
    }),
    F('Timetables and rating', {
      what: 'The school and every class; the rating of each class.',
      steps: ['**Timetable** → School / Class views (own teacher view too)', 'Results → **Rating** → Of a class (every class)', 'Results → **Results table**, **Early warning** (attendance reasons)'],
    }),
    feedback,
  ],
};
