import { F, T, D, K, S, BRANCH, signIn, shell, feedback } from './common.mjs';

export const headCore = (scope, branchNote, req = { who: 'Shahnoza (English group B)', name: 'Shahnoza', pron: 'her', journal: 'English group B (Shahnoza)', master: 'Ingliz tili grade 5', move: 'English B to English A', subject: 'English' }) => [
  F('Home: requests waiting for you', {
    what: 'A teacher’s home page plus the requests you decide.',
    steps: ['**Home** → **Requests waiting for you**: plan and unlock requests, "n late"', 'Today / This week, Reminders, My journals (own teaching)'],
    show: [`A request from ${req.who} arrives in the card`],
  }),
  T('Who decides a request', ['Request from', 'Decided by'], [
    ['Teacher', 'the subject’s Head Teacher in the branch; also the Senior Head Teacher, the AVP or the Super Admin'],
    ['Head Teacher', 'the Senior Head Teacher or the AVP; also the Super Admin'],
    ['Senior Head Teacher', 'the AVP of the lesson’s branch, then the Super Admin'],
    ['A Tutor for own Tutor lesson', 'the AVP, then the Super Admin'],
    ['Academic Vice Principal', 'the Super Admin'],
  ], { lead: 'Nobody approves their own request. With no Head Teacher for a subject, requests go to the Senior Head Teacher and the AVP.', size: 26 }),
  F('Approve an unlock request', {
    what: 'Opens one locked lesson for one teacher for 1–7 days.',
    steps: ['Journal → **Unlock requests** → **Waiting for me** → **Decide**', '**Approve** → Days open 1–7, or **Refuse** → Reason of the refusal', '**Open the journal** to see the lesson'],
    show: [`Approve ${req.name}’s request for 1 day; ${req.pron} locked cell opens`],
    time: 'Open until 00:00 after the decision + the days; entries are marked late and counted in the discipline report.',
  }),
  F('Approve a plan edit request', {
    what: 'After the window, plans change only with your yes.',
    steps: ['Lesson plans → **Plan edit requests** → **Decide** → **Approve** (School days open 1–10; untick "Allow …" dates) or **Refuse**', '**Approve together** / **Approve all** for requests of one change', '"waiting 2 school days" marks a slow decision'],
    show: ['A "window_end" request from a teacher whose plan was not complete'],
  }),
  F(`Journals of ${scope}`, {
    what: 'Read the journals of your subjects; you do not enter in other teachers’ lessons.',
    steps: ['**Journal** → **Journals** → Classes / Groups (own subjects only)', 'Journal → **Journal discipline** (own subjects): Held, Not started, Complete, Locked incomplete, Entries after the edit period'],
    show: [`Open ${req.journal} as a reader`],
  }),
  F('Lesson plans of the subjects', {
    what: 'Every plan of your subjects, and the reports.',
    steps: ['**Lesson plans** → the plans of your subjects → **Print** / **Excel**', '**Plan reports**: Completeness, Progress, Edit requests', '**Parallel classes**: where each class has reached'],
    show: ['Completeness report: who has not filled the quarter'],
  }),
  F('Master plans', {
    what: 'A model plan teachers copy and follow.',
    steps: ['Lesson plans → **Master plans** → **Add master** → quarter, subject, grade → **Add row**', branchNote, 'Teachers see "Master updated" → **Compare**'],
    show: [`Master for ${req.master}, quarter 2; ${req.name} copies it`],
  }),
  F('Students and groups of the subjects', {
    what: 'The full student list; move students between groups of your subjects.',
    steps: ['**People** → **Students**: the whole list, Basic fields; **Export** Basic columns', 'Student → **Move to another group** (own subjects) → New group, First day there', '**People** → **Head Teachers**: own subjects'],
    show: [`Move a student from ${req.move} from tomorrow`],
    time: 'A move starts tomorrow by default; you cannot date it in the past (AVP or Super Admin only).',
  }),
  F('Timetables of the subjects’ teachers', {
    what: 'Your own week, and the teachers of your subjects in those subjects.',
    steps: ['**Timetable** → Teacher view → a teacher of your subject'],
    show: [`${req.name}’s week: only ${req.pron} ${req.subject} lessons show`],
  }),
  F('Results of the subjects', {
    what: 'Results, rating, warnings and reports limited to your subjects.',
    steps: ['Student → **Results** (own subjects)', 'Results → **Rating** → In a subject', 'Results → **Early warning** (own subjects)', 'Results → **Reports**: Results table (own subject columns), Subject mastery'],
    show: [`Subject mastery of ${req.master}`],
  }),
];

export default {
  title: 'Head Teacher tutorial',
  footer: 'Sodiq platform tutorials · Head Teacher',
  slides: [
    { kind: 'cover', kicker: 'Tutorial · Head Teacher', title: 'Head Teacher', sub: 'Oversees a list of subjects in one branch: their journals, plans, groups and requests. Also teaches.', meta: `Demo: Madina Ergasheva, Ingliz tili, Rus tili, Arab tili, Ona tili, "${BRANCH}" · Edge` },
    K('The role in one slide', [
      { title: 'For own subjects, own branch', body: ['Reads journals and lesson plans', 'Approves unlock and plan edit requests', 'Keeps master plans', 'Moves students between groups', 'Sees the timetables of the subjects’ teachers'] },
      { title: 'Also', body: ['The full student list; exports its Basic fields', 'Works as a Teacher: see the Teacher video', 'One Head Teacher per subject per branch'] },
      { title: 'Does not', body: ['Correct another teacher’s marks (AVP)', 'Approve own requests (Senior Head Teacher or AVP)', 'See a subject outside the list'], tone: 'warn' },
    ]),
    S('Two roles, one account', 'Madina is Head Teacher and Teacher. "Menu and home page: …" switches the menu; she always has the rights of both.'),
    ...signIn('Head Teacher', false),
    shell('Head Teacher', 'Home, People, Classes and subjects, Timetable, Journal, Results, Lesson plans', ['**Menu and home page: Head Teacher / Teacher**']),
    D('1', 'Overseeing the subjects', 'Record after the first locks and plan window end (time machine).'),
    ...headCore('own subjects', 'Kept for this branch'),
    F('Appointments and changes', {
      what: 'The Super Admin appoints with a subject list and dates; open requests pass to the next holder.',
      steps: ['People → **Head Teachers**: From, Until, State'],
      show: ['When the subjects change, requests waiting move to the new Head Teacher'],
    }),
    feedback,
  ],
};
