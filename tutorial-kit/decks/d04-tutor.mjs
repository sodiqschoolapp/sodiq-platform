import { F, T, D, K, S, BRANCH, signIn, shell, feedback } from './common.mjs';

// Shared by Tutor and Class teacher decks. label = 'Tutor' or 'Class teacher'.
export const tutorCore = (label, cls, person) => [
  F('Home: my class today', {
    what: `The ${label}'s home page starts with the own class.`,
    steps: [`**Class ${cls}**: Today and This week attendance %, **Absent now**, **Timetable today**`, `**Early warning: ${cls}**`, 'Then the own lessons: Today / This week'],
    show: ['At 09:05: "Absent now" lists who is missing in lesson 1'],
    time: '"Absent now" follows the clock: film it during a lesson (time machine).',
  }),
  F('My class and its timetable', {
    what: 'The class record, its groups and the class week.',
    steps: ['**Classes and subjects** → **Classes**: only own classes ("You are not the Tutor of a class yet." if none)', '**Timetable** → School view or Class view (own class)', 'Groups that draw from the class: Classes → **Groups**'],
    show: [`${cls}: home room, Tutor dates, the PE and English groups`],
  }),
  F(`${label} lessons`, {
    what: 'Lessons of the "Tutors" department (Kelajak soati, Ma’naviyat soati, Homework slot) belong to whoever is the class’s ' + label + ' on the day.',
    steps: ['They appear in the own timetable and Home like any lesson', 'Journal: enter attendance and the plan like a teacher', 'An acting ' + label + ' takes them for the acting dates'],
    show: [`${label === 'Class teacher' ? 'Homework' : 'Kelajak soati'} of ${cls} on the home page; take its attendance`],
    who: `Nobody picks the teacher of these lessons by hand. A ${label}'s own unlock request goes to the Academic Vice Principal.`,
  }),
  F('Absence reasons', {
    what: `The ${label} records why a student was away, without changing the mark.`,
    steps: ['**Journal** → **Student absences** → Class, From, To', 'Row: Lessons missed, "At school earlier that day"', '**Set the reason**: Illness, Family, Permitted by the school, Unexcused, Unknown → Note, **Attach a file**', '**Clear the reason**'],
    show: ['A parent phoned: set "Illness" for Monday; the teacher’s cell shows "Reason: Illness"'],
    time: 'Until the quarter closes.',
  }),
  F('My class in the journals', {
    what: 'Every subject journal of the class, own students’ rows only.',
    steps: ['**Journal** → **Journals** → a subject of the class', 'A group journal shows only the own students'],
    show: [`An English group: only the ${cls} students appear`],
  }),
  F('Students of the branch and my class', {
    what: `The whole branch list to view; full profiles of the own class.`,
    steps: ['**People** → **Students** (view only)', 'Own class: Overview with contacts, Attendance, Results, Timetable, Relatives, **History**', '**Export**: own class with phone, relatives and score; rows of other classes are counted and left out'],
    show: [`Export ${cls}; open the file`],
  }),
  F('Results of my class', {
    what: 'Every subject result of the class, the rating and the warnings.',
    steps: ['Student → **Results** tab (all subjects of own class)', 'Results → **Rating**: In a subject / Of a class (own classes)', 'Results → **Early warning** → **Mark handled** with a Staff note', 'Results → **Reports**: Attendance, Results table (own class)'],
    show: ['One student with "Absences in a row" → mark handled after a call home'],
  }),
];

export default {
  title: 'Tutor tutorial',
  footer: 'Sodiq platform tutorials · Tutor',
  slides: [
    { kind: 'cover', kicker: 'Tutorial · Tutor', title: 'Tutor (sinf rahbari, grades 5–11)', sub: 'Looks after one class: its attendance, its reasons of absence, its Tutor lessons, its results and its families.', meta: `Demo: Umida Rashidova, Tutor of 5 Melbourne, "${BRANCH}" · Chrome profile "Tutor"` },
    K('The role in one slide', [
      { title: 'Sees', body: ['The full student list of the branch (view)', 'Own class: every field the Tutor reads, relatives, history', 'School timetable and the own class’s', 'Attendance per lesson and daily %'] },
      { title: 'Does', body: ['Records absence reasons', 'Holds the class’s Tutor lessons (Kelajak soati)', 'Exports the own class', 'Marks early warnings handled'] },
      { title: 'Does not', body: ['Change a mark', 'See other classes’ profiles', 'Move students between classes'], tone: 'warn' },
    ]),
    S('A Tutor is usually a Teacher too', 'Umida holds two roles. The button "Menu and home page: …" switches menu and home; her rights are always those of both roles. The teaching part is the Teacher video.'),
    ...signIn('Tutor', false),
    shell('Tutor', 'Home, People, Classes and subjects, Timetable, Journal, Results', ['**Menu and home page: Tutor / Teacher**']),
    D('1', 'The class', 'Record on a school day, during lessons.'),
    ...tutorCore('Tutor', '5 Melbourne', 'Umida Rashidova'),
    F('A new or acting Tutor', {
      what: 'Tutors change on dates; their lessons follow.',
      steps: ['The AVP sets **Set acting Tutor** with From / Until', 'The acting Tutor sees the class and holds its Tutor lessons for those dates'],
      show: ['Jump into the acting dates: Sanjar’s home now shows 5 Melbourne too; Umida’s bell: "tutor_changed"'],
      time: 'From today or later; held lessons keep who held them.',
    }),
    feedback,
  ],
};
