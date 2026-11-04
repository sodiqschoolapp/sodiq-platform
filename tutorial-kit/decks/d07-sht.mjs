import { F, T, D, K, S, signIn, shell, feedback } from './common.mjs';
import { headCore } from './d06-ht.mjs';

export default {
  title: 'Senior Head Teacher tutorial',
  footer: 'Sodiq platform tutorials · Senior Head Teacher',
  slides: [
    { kind: 'cover', kicker: 'Tutorial · Senior Head Teacher', title: 'Senior Head Teacher', sub: 'Everything a Head Teacher does for the subjects given, in every branch. Sees the Head Teachers of those subjects and their requests.', meta: 'Demo: the seeded Senior Head Teacher (Mathematics, Physics, Informatics), across Demo Yunusobod, Demo Chilonzor and Istirohat demo' },
    K('The role in one slide', [
      { title: 'Across branches', body: ['A **Branch** filter in the top bar: every branch', 'Journals, plans, groups, rating and warnings of own subjects in each branch', 'Master plans for one branch or **All branches**'] },
      { title: 'Decides', body: ['Teachers’ requests, beside the Head Teacher', 'The Head Teachers’ own requests', 'Own requests go to the AVP of the lesson’s branch'] },
      { title: 'Limits', body: ['One Senior Head Teacher per subject at a time', 'No timetable editing; no corrections', 'Also works as a Teacher (Teacher video)'], tone: 'warn' },
    ]),
    ...signIn('Senior Head Teacher', false),
    shell('Senior Head Teacher', 'Home, People, Classes and subjects, Timetable, Journal, Results, Lesson plans', ['**Branch** dropdown: all branches', '**Menu and home page: Senior Head Teacher / Teacher**']),
    F('Switching branches', {
      what: 'The same screens, branch by branch.',
      steps: ['Top bar → **Branch** → Istirohat demo / Demo Yunusobod / Demo Chilonzor', 'Typed changes are asked about before the switch'],
      show: ['Matematika journals of groups A and B, then of 6 Oxford in Demo Chilonzor'],
    }),
    D('1', 'Overseeing the subjects', 'The Head Teacher’s screens, for every branch.'),
    ...headCore('own subjects in every branch', '**Kept for**: This branch or **All branches**', { who: 'Aziz Rahimov (Matematika group A)', name: 'Aziz', pron: 'his', journal: 'Matematika group B (Bahodir)', master: 'Matematika grade 5', move: 'Matematika B to Matematika A', subject: 'Matematika' }),
    F('Head Teachers of my subjects', {
      what: 'Who holds each subject in each branch, and what waits for them.',
      steps: ['People → **Head Teachers** (own subjects)', 'Unlock and plan requests list the tier that may decide'],
      show: ['A Head Teacher’s own unlock request lands in the Senior Head Teacher’s "Waiting for me"'],
    }),
    feedback,
  ],
};
