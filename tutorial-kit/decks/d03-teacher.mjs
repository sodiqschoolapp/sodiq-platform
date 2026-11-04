import { F, T, D, K, S, BRANCH, signIn, shell, feedback } from './common.mjs';

export const teacherCore = (who) => [
  F('Home: today and this week', {
    what: 'Your lessons in time order, from every branch, each with a button to its journal.',
    steps: ['**Home** → **Today** / **This week**', 'Status summary ("3 of 5 lessons complete")', '**Reminders**: No attendance, Numbers missing, No topic, Rating exam, About to lock → **Open**', '**My journals**, **Early warning: my journals**'],
    show: [`Morning of the first school day as ${who}`],
  }),
  F('My timetable', {
    what: 'Your own week, with changes marked.',
    steps: ['**Timetable** → Teacher view → Day / Week → **Print** / **Excel**', 'Marks: Changed, Exam, Cancelled, Busy in …'],
    show: ['The week of Aziz Rahimov; a moved lesson marked "Changed"'],
  }),
  F('Take attendance', {
    what: 'Four marks: 0 Absent from school, 1 Present, 2 Late, 3 At school, missed the lesson.',
    steps: ['Home → lesson → journal, or **Journal** → the class', '**All present**, then change the few', '**View** → **Lesson mode**: large buttons for a tablet or phone', 'Hint: "Was at school at an earlier lesson today…"'],
    show: ['Lesson mode on the phone during lesson 1', 'Mark one student 3: the hint about the earlier lesson'],
    time: 'Entry opens at the lesson’s start time, never before.',
  }),
  F('Classwork, homework and numbers', {
    what: 'Works of a lesson with a total ("Soni"); each student gets a whole number from 0 to the total.',
    steps: ['Under the lesson’s A → **Works of the lesson** → **Add classwork** / **Add homework given** → **Set total**', 'Type numbers in CW / HW columns', '**Not graded** (dash), **Not held**, **Check at the next lesson**', 'Homework is checked at the next lesson: "Given on …, checked at this lesson"'],
    show: ['Classwork total 10, type the numbers', 'Give homework Monday, check it Tuesday (time machine)'],
  }),
  F('Saving, and two people on one cell', {
    what: 'Every cell saves at once and says so.',
    steps: ['States: **Saving** → **Saved** / **Not saved** → **Send again**', '"Someone changed this cell": **Keep the saved value** / **Use mine**', '**Undo** (Ctrl+Z)', '**Copy attendance from the first lesson** (second half of a double)'],
    show: ['Two browsers on one cell (teacher and substitute): the dialog', 'Note: another person’s entry shows after a reload'],
  }),
  F('Comments', {
    what: 'A note on a mark, a number, the lesson or the rating exam.',
    steps: ['Cell → **Comment on …** → Who sees it: **Staff only** / **Visible to parents**'],
    show: ['A comment on a late mark; the corner marker'],
    time: 'Parents read comments from Release 2.',
  }),
  F('Rating exam', {
    what: 'A quarter exam column when the subject has a rating exam.',
    steps: ['Rating column → **Exam date** (or from the exam in the timetable) → **Save the date**', 'Per student: **Score**, **Did not sit**, **Exempt**'],
    show: ['Turn on Rating exam for Matematika first (AVP), then enter scores'],
    time: 'Reminders in the last 14 days of the quarter; the column locks like the lesson of its date.',
  }),
  F('The lesson card and plans in the journal', {
    what: 'The plan item of each lesson sits on its header.',
    steps: ['Header "No. n" + topic → **Lesson card**: Topic, Classwork, Homework given and checked, Objectives, Materials', 'Tick **Topic not delivered**: the item goes to "Not covered" and a request is prepared', 'Tick **Not given** for a homework'],
    show: ['Mark one topic not delivered; open the prepared request'],
  }),
  F('Lesson status', {
    what: 'Not started → In progress → Complete, or Locked incomplete if the lock comes first.',
    steps: ['Seen in the lesson header, the timetable and Home'],
    show: ['Jump to the evening: one lesson Complete, one Not started'],
    time: 'Worked out from the clock on every read; nobody sets it.',
  }),
  F('The lock and the unlock request', {
    what: 'Each lesson stays open for the branch’s edit days, then locks.',
    steps: ['Journal → **Edit period** panel → **Show n locked lessons**', 'Locked cell: "This lesson is locked…" → **Request unlock** → Reason → **Send**', 'Approved: "Unlocked until … by …"; **Withdraw the request** while waiting'],
    show: ['Jump past the lock; request; the Senior Head Teacher or the AVP approves (Matematika has no Head Teacher in this branch); enter; "Entered after the edit period, approved by …"'],
    time: ['Locks at 00:00 after lesson date + edit days (7 by default)', '"About to lock" notice at 07:00 in the last 48 hours'],
  }),
  F('Exempt and moved students in the journal', {
    what: 'The journal shows why a cell is not a normal mark.',
    steps: ['4 / 5: Temporarily / Fully exempt; folded "Exempt: n students"', '"Left the subject on …", "carried in", "Optional until …"', 'Folded "Left or moved: n students"'],
    show: ['The PE exemption from the AVP video, seen from the teacher’s side; Home cards "Exempt today", "Back from exemption"'],
  }),
  F('Print and export a journal', {
    what: 'The month or the quarter, stamped Provisional or Final.',
    steps: ['Journal → **Print** / **Excel** (PDF on production)'],
  }),
  F('My lesson plan', {
    what: 'One row per lesson of the quarter; the plan follows the timetable when it changes.',
    steps: ['**Lesson plans** → Classes / Groups → the plan', 'Row → **Fill in**: Topic, **Add classwork**, **Add homework**, **Add file**, **Links**', '**Same topic as the previous lesson**, **Clear row**'],
    show: ['Fill a week of Matematika group A'],
    time: 'Editable while the plan window is open; reminders 3 days before and on its last day.',
  }),
  F('Share, copy and masters', {
    what: 'Less typing for parallel classes.',
    steps: ['**Share plan** → Class or group (same subject, grade, language, owner; empty plan)', '**Copy from a plan** (All items / Only lessons not yet held)', '**Copy from a master**; "Master updated" → **Compare** → **Take the changes** / **Keep my plan**'],
    show: ['Feruza shares her 5 Melbourne Ona tili plan with 5 Tokyo (she teaches both)', 'Aziz copies from Bahodir’s group B plan (different owner: copy, not share)'],
  }),
  F('After the window: ask to edit', {
    what: 'A locked plan changes only by an approved request.',
    steps: ['Plan → **Ask to edit** → Kind: Text / Re-plan / Window extension → Reason → **Send request**', '"Edit request prepared" banners after a timetable change → send it', 'Approved: edit, then **Finished**', '**Not covered** items: **Merge into a lesson** / **Carry to next quarter**'],
    show: ['Jump past the window; send a request; the Senior Head Teacher or the AVP approves'],
    time: 'A prepared request not sent reminds you on days 1, 3, 7, then weekly.',
  }),
  F('My students, results and rating', {
    what: 'The students you teach (Basic fields), their results in your journals, and the rating.',
    steps: ['Student list opens by its address (no People menu): only your students', 'Results → **Rating** → In a subject (own journals)', 'Results → **Early warning** → **Mark handled** with a Staff note'],
    show: ['Rating in Matematika of grade 5, "Provisional: the quarter is open"'],
  }),
];

export default {
  title: 'Teacher tutorial',
  footer: 'Sodiq platform tutorials · Teacher',
  slides: [
    { kind: 'cover', kicker: 'Tutorial · Teacher', title: 'Teacher', sub: 'Your timetable, your journals and your lesson plans. Every teacher, Head Teacher and Class teacher needs this video.', meta: `Demo: Aziz Rahimov, Matematika 5 Melbourne, "${BRANCH}" · Firefox` },
    K('The role in one slide', [
      { title: 'Sees', body: ['Own timetable (all branches)', 'The students you teach, Basic fields only', 'Own journals, and a lesson you substitute'] },
      { title: 'Does', body: ['Attendance, works, numbers, comments, rating exam', 'Lesson plans and requests to edit them', 'Unlock requests for locked lessons', 'Marks early warnings handled'] },
      { title: 'Does not', body: ['Change the timetable or another teacher’s journal', 'See phones, contracts or relatives', 'Approve own requests'], tone: 'warn' },
    ]),
    ...signIn('Teacher', false),
    shell('Teacher', 'Home, Timetable, Journal, Lesson plans, Results'),
    D('1', 'The school day', 'Record on the first day of the published week.'),
    ...teacherCore('Aziz Rahimov'),
    feedback,
  ],
};
