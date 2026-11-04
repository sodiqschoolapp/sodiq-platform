import { F, T, D, K, S, signIn, shell, feedback } from './common.mjs';
import { tutorCore } from './d04-tutor.mjs';

export default {
  title: 'Class teacher tutorial',
  footer: 'Sodiq platform tutorials · Class teacher',
  slides: [
    { kind: 'cover', kicker: 'Tutorial · Class teacher', title: 'Class teacher (Sinf rahbari, grades 0–4)', sub: 'Takes the Tutor’s place in a class of grades 0–4, and teaches its subjects like any teacher.', meta: 'Demo: Kamola Nurmatova, Class teacher of 3 Genius, Istirohat demo · Edge private window' },
    K('The role in one slide', [
      { title: 'Like a Tutor, for one class', body: ['Everything the Tutor sees and does, for the own class of grades 0–4', 'Holds its Ma’naviyat soati and Homework slot lessons', 'Records absence reasons'] },
      { title: 'Also a Teacher', body: ['Teaches subjects of the own class (Mathematics, native language, reading…) through the teaching load', 'Keeps those journals and plans: see the Teacher video', 'Subjects of grades 0–4 may come from several departments'] },
      { title: 'Rules', body: ['One own class at a time', 'An acting Class teacher of another class has that class too for the period', 'Overseen by the Head Tutor', 'Rating exams in grades 0–4 only when the Super Admin turns them on'], tone: 'warn' },
    ]),
    S('Kamola’s week', 'Kamola teaches her own class Matem, Ona tili, O’qish, Mantiq and Ta’sviriy san’at, and holds its Homework lesson every day at 15:25. Other teachers bring English, Arab tili, PE, Robotex and the rest.', { notes: 'Grade 3 has lunch at 11:45, earlier than grade 5. Her subjects come from several departments; the platform allows that because she teaches them only in grades 0–4.' }),
    ...signIn('Class teacher', false),
    shell('Class teacher', 'Home, People, Classes and subjects, Timetable, Journal, Results, plus the Teacher items', ['**Menu and home page: Class teacher / Teacher**']),
    D('1', 'My class', 'Same screens as the Tutor, with the word "Class teacher".'),
    ...tutorCore('Class teacher', '3 Genius', 'Kamola Nurmatova'),
    F('Teaching the own class', {
      what: 'The Class teacher’s subjects of 3 Genius come through the teaching load like any teacher’s.',
      steps: ['Home (Teacher menu) → Today → the lesson → journal', 'Lesson plans → the class’s plans'],
      show: ['Switch "Menu and home page" to Teacher; open the 3 Genius Matem journal', 'For two months of entries, open the seeded 0 London in Demo Yunusobod as the Super Admin'],
    }),
    F('Rating exams in grades 0–4', {
      what: 'Off by default. When the Super Admin turns them on, rating subjects of grades 0–4 get the exam column.',
      steps: ['Super Admin: School setup → Settings → **Rating exams in grades 0–4** → Turn on → reason'],
      show: ['Before and after: the 3 Genius Matem journal gains the Rating column'],
    }),
    feedback,
  ],
};
