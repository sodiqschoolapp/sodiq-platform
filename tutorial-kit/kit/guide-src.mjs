// Builds guide.html, the one page to follow: node guide-src.mjs
// Sessions in order; each step names the deck and the slides to film.
// guide.css, guide.js and guide-steps.json hold the page style, the tick script
// and the build-step texts. At the end the script checks that every feature
// slide of every deck is filmed in some session (or listed as not filmable).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const here = path.dirname(new URL(import.meta.url).pathname);
const css = fs.readFileSync(path.join(here, 'guide.css'), 'utf8');
const js = fs.readFileSync(path.join(here, 'guide.js'), 'utf8');
const K = JSON.parse(fs.readFileSync(path.join(here, 'guide-steps.json'), 'utf8'));
// Exact clicks per step (clicks/*.json): { id: { clicks: [...], check, before } }, written from
// the web app's own English texts and browser tests. A step with clicks shows them as a numbered
// list; its older summary moves under "What this step is for".
const CLICKS = Object.assign(
  {},
  ...fs
    .readdirSync(path.join(here, 'clicks'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(here, 'clicks', f), 'utf8'))),
);
const inline = (t) =>
  String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
const clicksHtml = (c) => {
  const items = [];
  let n = 0;
  for (const line of c.clicks) {
    const divider = /^[—–-]{1,2}\s*(.+?)\s*[—–-]{1,2}$/.exec(line.trim());
    if (divider) items.push(`<li class="part">${inline(divider[1])}</li>`);
    else items.push(`<li><span class="n">${++n}</span><span>${inline(line)}</span></li>`);
  }
  return (
    (c.before ? `<p class="before">${inline(c.before)}</p>` : '') +
    `<ol class="clicks">${items.join('')}</ol>` +
    (c.check ? `<p class="check"><b>You should see:</b> ${inline(c.check)}</p>` : '') +
    (c.unsure?.length
      ? `<details class="about"><summary>Check during the rehearsal (${c.unsure.length})</summary><ul>${c.unsure.map((u) => `<li>${inline(u)}</li>`).join('')}</ul></details>`
      : '')
  );
};

const DECKS = {
  plan: ['Recording plan', 'QKMf388eTYYyjQdvwLg7Qb', 'd00-plan.mjs'],
  sa: ['Super Admin deck', 'V8fBAkvnhG8Hkep8nx1bSP', 'd01-sa.mjs'],
  avp: ['AVP deck', 'N5db8jb2oU3AEW9F4o91A2', 'd02-avp.mjs'],
  t: ['Teacher deck', '3wwKm5Zqh8dypgpLCn4QPJ', 'd03-teacher.mjs'],
  tu: ['Tutor deck', 'WB6TWkLz8j2Wm26Vx9ETAV', 'd04-tutor.mjs'],
  ct: ['Class teacher deck', 'Vim8fuNim8d1QyKGr9WGsL', 'd05-classteacher.mjs'],
  ht: ['Head Teacher deck', 'E1iTC3DoPPPMcANJ5vZDAD', 'd06-ht.mjs'],
  sht: ['Senior Head Teacher deck', 'Neo8vLLMWCB4TpVGTXFkBK', 'd07-sht.mjs'],
  p: ['Principal deck', 'LpSgFnxs1Ejj7y1sfsqZn2', 'd08-principal.mjs'],
  svp: ['Spiritual and Moral VP deck', 'XF5fQSz32SPRt8sYbc3qN8', 'd09-svp.mjs'],
  htu: ['Head Tutor deck', 'Jh7xkBKqhxWENAX9eCW5VH', 'd10-headtutor.mjs'],
};
const url = (k) => `https://claude.ai/artifact/${DECKS[k][1]}`;
const link = (k) => `<a href="${url(k)}" target="_blank" rel="noopener">${DECKS[k][0]}</a>`;

// A step: id (keeps old tick ids), title, tag, body html, decks [[key, 'slides', 'note']]
const TAG = {
  cam: ['cam', 'On camera'],
  off: ['offc', 'Off camera'],
  mixed: ['mixed', 'Mixed'],
  later: ['offc', 'Later'],
};
const st = (id, title, tag, body, decks = []) => ({ id, title, tag, body, decks });

const SESSIONS = [
  {
    n: 0,
    title: 'Get ready',
    when: 'Any day · about an hour · off camera',
    lede: 'Nothing is recorded yet.',
    steps: [
      st(
        'p1',
        'Read the Recording plan once',
        'off',
        `<p>It explains why the demo branch looks the way it does. You do not follow it step by step: this page is the order. Remember slide 4: features that are not built yet never go on camera.</p>`,
        [['plan', '1–25']],
      ),
      st('a1', 'Reset the test site with the demo school', 'off', K.a1),
      st('a2', 'One phone with an authenticator app', 'off', K.a2),
      st(
        'a3',
        'Browsers ready',
        'off',
        K.a3 +
          `<p>Keep this page and the deck of the session open on a second screen, a tablet or the phone.</p>`,
      ),
      st(
        'p2',
        'Choose the two recording weeks',
        'off',
        `<p><b>Week 0</b>: a Thursday and a Friday (Sessions 2–4). <b>Week 1</b>: the following Monday to Friday (Sessions 5–6). Both inside a quarter: quarter 2 runs 9 November–26 December 2026; avoid 8 December, the day off you add in step 3.4.</p>`,
      ),
    ],
  },
  {
    n: 1,
    title: 'Rehearsal',
    when: 'A few days before Week 0 · off camera',
    lede: 'A dry run, so the real takes go smoothly.',
    steps: [
      st(
        'r1',
        'Do Sessions 2, 3 and 4 without recording',
        'off',
        `<p>Follow them exactly as written, decks open. Write down every place where the screen differs from this page or a deck, and send the list to Claude: the page and the decks get fixed before the real take.</p>`,
      ),
      st(
        'r2',
        'Wipe the rehearsal',
        'off',
        `<p>Run step 0.2 again (the demo workflow): it deletes the rehearsal branch. Then press <b>Clear ticks</b> at the top of this page and start the real take at Session 2.</p>`,
      ),
    ],
  },
  {
    n: 2,
    title: 'Video: Super Admin',
    when: 'Week 0, Thursday morning · Chrome profile “SA” (step 2.9 in “AVP”, step 2.8 in “Principal”)',
    lede: 'Open the Super Admin deck. Show its slides 1–2 first (title and “The role in one slide”).',
    steps: [
      st(
        's2a',
        'Sign-in and the screen',
        'cam',
        `<p>Sign in with the Super Admin login from the demo run’s <b>Summary</b>. Film slides 4–9 as the deck says. Slide 3 needs a fresh slip: it is filmed in step 2.8.</p>`,
        [['sa', '4–9']],
      ),
      st('b1', 'Create the branch', 'cam', K.b1, [['sa', '11–12']]),
      st(
        'b2',
        'Building, floors, rooms',
        'mixed',
        K.b2 + `<p>Slide 14: add a spare room, delete it for good, then restore it.</p>`,
        [['sa', '13–14']],
      ),
      st('b3', 'Departments', 'cam', K.b3, [['sa', '15']]),
      st('b4', 'Academic year', 'cam', K.b4, [['sa', '16']]),
      st('s2b', 'School-wide settings', 'cam', `<p>As slide 17 shows.</p>`, [['sa', '17']]),
      st(
        'b5',
        'Subjects',
        'mixed',
        K.b5 + `<p>No deck slide: film one subject as an extra clip.</p>`,
      ),
      st(
        'b7',
        'Office staff, by hand',
        'mixed',
        K.b7 +
          `<p>Then, in the Chrome profile “Principal”, sign in with Rustam’s slip: that is slide 3 of the Super Admin deck (every first sign-in looks the same).</p>`,
        [
          ['sa', '20–21'],
          ['sa', '3', 'with Rustam’s slip'],
        ],
      ),
      st('b8', 'Second step for the AVP', 'cam', K.b8, [
        ['avp', '4–5', 'the opening of AVP video part 1'],
      ]),
      st('b9', 'Staff import', 'cam', K.b9, [['sa', '19']]),
      st('b10', 'Roles the import cannot give', 'mixed', K.b10, [['sa', '21–22']]),
      st(
        'b6',
        '“Rating exams in grades 0–4”',
        'later',
        `<p>Leave it off. It is turned on in step 5.7, while the Class teacher films.</p>`,
      ),
      st(
        's2c',
        'The rest of the Super Admin deck',
        'cam',
        `<ul><li>Slide 23: lock and unlock Ahmedov Javlon; reset a teacher’s password; the email reset for Rahimov Aziz.</li><li>Slide 24: add a spare test teacher by hand (no lessons) and plan “Left” for Friday of Week 1. Never use a teacher who has lessons.</li><li>Slides 25, 29, 30 as the deck says.</li></ul>`,
        [['sa', '23–25, 29–30']],
      ),
    ],
  },
  {
    n: 3,
    title: 'Video: AVP part 1 · Prepare the year',
    when: 'Week 0, Thursday afternoon · Chrome profile “AVP” (step 3.10 in “SA”, step 3.15 in “Yunusobod AVP”)',
    lede: 'Open the AVP deck. Show its slides 1–3 first; slide 3 explains the three AVP videos.',
    steps: [
      st(
        's3a',
        'Sign-in and the screen',
        'cam',
        `<p>The AVP signed in at step 2.9. Film slides 6–9 now.</p>`,
        [['avp', '6–9']],
      ),
      st(
        's3b',
        'Quarters',
        'cam',
        `<p>The Super Admin dated them in step 2.5. The AVP opens Quarters and shows them; the AVP may change a date too.</p>`,
        [['avp', '11']],
      ),
      st('b11', 'Slot types, day templates, where they apply', 'cam', K.b11, [['avp', '12–13']]),
      st(
        'b12',
        'Calendar',
        'cam',
        K.b12.replace(
          'More calendar scenes come after publishing',
          'The working Saturday and the shortened day come after publishing (step 4.7)',
        ),
        [['avp', '14', 'first half']],
      ),
      st(
        'b13',
        'Settings and weights',
        'mixed',
        K.b13.replace(
          /<b>Edit days<\/b> 7 \(1 if you use the compressed year\)/,
          '<b>Edit days 1</b>, so a lesson locks on the second night and Session 6 can show locks without waiting a week',
        ),
        [['avp', '15–16']],
      ),
      st('b14', 'Vacancies', 'cam', K.b14, [['avp', '17', 'vacancies']]),
      st('b15', 'Working hours', 'mixed', K.b15, [['avp', '17', 'availability: Rahimov Aziz']]),
      st(
        'b16',
        'Classes, Tutors and Class teachers',
        'mixed',
        K.b16 +
          `<p>Also plan <b>Komilov Sanjar</b> as acting Tutor of 5 Melbourne for Thursday and Friday of Week 1 (step 6.5 films the result).</p>`,
        [['avp', '22']],
      ),
      st('b17', 'Student import', 'cam', K.b17, [['avp', '18']]),
      st('b18', 'Merge the duplicate', 'cam', K.b18, [['sa', '27']]),
      st(
        's3c',
        'A student, the family, a leaving',
        'cam',
        `<ul><li>Slide 19: open a student record.</li><li>Slide 20: the prop “one phone, two families” (a 5 Tokyo student, another family’s mother’s phone, a new name → “A different person: the number has a new owner”).</li><li>Slide 21: schedule a 5 Tokyo student to leave on Friday of Week 1.</li></ul>`,
        [['avp', '19–21']],
      ),
      st(
        's3d',
        'Students with no class',
        'cam',
        `<p>Home tile “Students with no class”: everyone imported is placed. IS26902 comes later (step 6.9).</p>`,
        [['avp', '23']],
      ),
      st('b19', 'Groups and group placement', 'mixed', K.b19, [['avp', '24']]),
      st(
        's3e',
        'Scheduled moves',
        'cam',
        `<p>Both from <b>Wednesday of Week 1</b>:</p><ul><li>a class move: a 5 Melbourne student to 5 Tokyo (same grade-5 groups, same PE group, so nothing else changes);</li><li>a group move: a student from Matematika 5B to 5A (Aziz’s group, so his journal shows the newcomer).</li></ul>`,
        [['avp', '25']],
      ),
      st(
        's3f',
        'Move a student to another branch',
        'cam',
        `<p>Release one 5 London student to Demo Yunusobod from Monday of Week 1. In the Chrome profile “Yunusobod AVP”, sign in as the Demo Yunusobod AVP (login on the Summary) and accept.</p>`,
        [['avp', '26']],
      ),
    ],
  },
  {
    n: 4,
    title: 'Video: AVP part 2 · The timetable',
    when: 'Week 0, Friday · Chrome profile “AVP” (“SA” for “Take over”)',
    lede: 'Same AVP deck, slides 27–38, then the changes for Week 1.',
    steps: [
      st(
        'b20',
        'Teaching load',
        'mixed',
        K.b20 +
          `<p>Prop: Ahmedov Javlon, “Lessons per week by contract” 4 → Weekly totals “Over by 2”.</p>`,
        [['avp', '28']],
      ),
      st(
        'b21',
        'Builder steps and the board',
        'mixed',
        K.b21 +
          `<p>Slide 31: “Take over” needs the Super Admin open on the same draft. Then the practice draft: mark the 3 Genius Arab tili split “Mixed block”, show the board, delete the draft.</p>`,
        [['avp', '29–31']],
      ),
      st('b22', 'Publish', 'cam', K.b22, [['avp', '32']]),
      st(
        's4a',
        'Versions',
        'cam',
        `<p>Copy version 1 into a draft for next month; leave it unpublished.</p>`,
        [['avp', '33']],
      ),
      st('s4b', 'Timetable views and print', 'cam', `<p>As slide 38 shows.</p>`, [['avp', '38']]),
      st(
        's4c',
        'Changes for Week 1',
        'cam',
        `<p>Every date here is in Week 1, never its Monday (Monday stays a normal day for Session 5):</p><ul><li>Slide 34: Tuesday, move Tarix to lesson 7; Friday, cancel lessons 6–7 for a school event.</li><li>Slide 35: a grade-5 Matematika exam on Thursday.</li><li>Slide 36: Hamidova Feruza ill on Thursday and Friday; choose substitutes.</li><li>Slide 37: close room 209 on Wednesday.</li></ul>`,
        [['avp', '34–37']],
      ),
      st(
        's4d',
        'Calendar after publishing',
        'cam',
        `<p>A working Saturday and a shortened day, each with its preview. Choose dates after Week 1.</p>`,
        [['avp', '14', 'second half']],
      ),
      st(
        'b23',
        'Exemptions',
        'cam',
        K.b23 + `<p>Also excuse one 5 Melbourne girl from PE for Monday to Friday of Week 1.</p>`,
        [['avp', '44']],
      ),
      st(
        's4e',
        'Plan window',
        'cam',
        `<p>Open the plan window for quarter 2, ending on <b>Wednesday of Week 1</b>.</p>`,
        [['avp', '47']],
      ),
      st(
        's4f',
        'Rating exam on for Matematika',
        'off',
        `<p>Subjects → Matematika → Rating exam on from this quarter. The Teacher enters scores in step 5.7.</p>`,
      ),
    ],
  },
  {
    n: 5,
    title: 'The first school day',
    when: 'Week 1, Monday · every role’s Chrome profile',
    lede: 'The timetable is live today. Several decks at once: each step says which.',
    steps: [
      st(
        's5a',
        'Before 09:00: first sign-ins with the slips',
        'cam',
        `<ul><li>“Teacher”: Rahimov Aziz.</li><li>“Tutor”: Rashidova Umida.</li><li>“Class teacher”: Nurmatova Kamola.</li><li>“Head Teacher”: Ergasheva Madina.</li><li>“Senior HT”: the seeded Senior Head Teacher (Summary).</li><li>Off camera: Rasulova Shahnoza (Ingliz 5B) in “Spare 1” and Qosimova Zarina (PE girls 5AB) in “Spare 2”; you need them on Tuesday to Thursday.</li></ul>`,
        [
          ['t', '3–7'],
          ['tu', '4–8'],
          ['ct', '4–8'],
          ['ht', '4–8'],
          ['sht', '3–7', 'slide 3: any fresh slip, the screen is the same'],
        ],
      ),
      st(
        's5b',
        'Home pages before the bell',
        'cam',
        `<p>Each role’s home and own timetable. The Senior Head Teacher switches branches.</p>`,
        [
          ['t', '9–10'],
          ['tu', '10–11'],
          ['ct', '10–11'],
          ['ht', '3, 10'],
          ['sht', '8, 10'],
        ],
      ),
      st(
        's5c',
        '09:00 Lesson 1: attendance',
        'cam',
        `<p>Aziz takes attendance in Matematika 5A, lesson mode; two 5 Melbourne students absent. Film one phone-width shot. Then Umida’s home shows “Absent now”.</p>`,
        [
          ['t', '11'],
          ['tu', '10', '“Absent now”'],
        ],
      ),
      st(
        's5d',
        'During the day: the Teacher',
        'cam',
        `<p>Classwork, homework and numbers; comments; the lesson card; print and export; fill a week of Matematika group A in the plan; share, copy, masters.</p>`,
        [['t', '12, 14, 16, 20–22']],
      ),
      st(
        's5e',
        'During the day: Tutor and Class teacher',
        'cam',
        `<p>Absence reasons: “A parent phoned” → Illness for one of this morning’s absent students. The class in the journals; the students. Kamola switches to Teacher for her own class. (Kelajak soati and the Homework slot are on Tuesday: step 6.1.)</p>`,
        [
          ['tu', '13–15'],
          ['ct', '13–15, 17'],
        ],
      ),
      st(
        's5f',
        'During the day: Head Teacher and Senior Head Teacher',
        'cam',
        `<p>Journals, plans, master plans, students and groups, timetables of their subjects. Prop: Madina schedules a group move Ingliz 5B → 5A.</p>`,
        [
          ['ht', '14–18'],
          ['sht', '14–18'],
        ],
      ),
      st(
        's5g',
        'Rating exams',
        'cam',
        `<p>Aziz enters rating scores in Matematika. Then “Rating exams in grades 0–4”: Kamola opens the 3 Genius Matematika journal, the Super Admin turns the setting on, the journal gains the Rating column (before and after).</p>`,
        [
          ['t', '15'],
          ['ct', '18'],
        ],
      ),
      st(
        's5h',
        'During the day: the AVP',
        'cam',
        `<p>The AVP home page, reading any journal, student absences.</p>`,
        [['avp', '40–41, 45']],
      ),
      st(
        's5i',
        'After 16:05',
        'cam',
        `<p>Lesson statuses: Complete and Not started. The home page reminders.</p>`,
        [['t', '17']],
      ),
    ],
  },
  {
    n: 6,
    title: 'The days that need time',
    when: 'Week 1, Tuesday to Friday, and 1 December',
    lede: 'Edit days is 1, so locks come quickly. Each step says its day.',
    steps: [
      st(
        's6a',
        'Tuesday: Tutor lessons and the first exemption',
        'cam',
        `<ul><li>Umida: Kelajak soati of 5 Melbourne, from the home page; take its attendance.</li><li>Kamola: the Homework slot of 3 Genius.</li><li>Zarina (lesson 7, PE girls): “Exempt today” for the girl from step 4.8.</li></ul>`,
        [
          ['tu', '12'],
          ['ct', '12'],
          ['t', '19', 'exempt part'],
        ],
      ),
      st(
        's6b',
        'Wednesday: Monday is locked',
        'cam',
        `<ul><li>Aziz asks to unlock a Monday cell; the Senior Head Teacher approves for 1 day; Aziz enters it: “Entered after the edit period”.</li><li>The AVP: corrects a wrong number (Aziz’s bell shows old and new); the discipline report and the branch export.</li><li>The scheduled moves happened: History “Moved from … to …”; the newcomer in Aziz’s 5A journal.</li></ul>`,
        [
          ['t', '18–19'],
          ['sht', '11–12'],
          ['avp', '25', 'after the date'],
          ['avp', '42, 46'],
        ],
      ),
      st(
        's6c',
        'Thursday: Tuesday is locked, the plan window has closed',
        'cam',
        `<ul><li>Shahnoza asks to unlock her Tuesday Ingliz 5B cell; Madina approves.</li><li>Aziz and Shahnoza each send a plan edit request; the Senior Head Teacher approves Aziz’s, Madina Shahnoza’s, the AVP shows the list and parallel classes.</li><li>Then the Super Admin changes Madina’s subjects as the Head Teacher deck shows, and gives them back.</li></ul>`,
        [
          ['ht', '11–13, 20'],
          ['t', '23'],
          ['sht', '13'],
          ['avp', '48'],
        ],
      ),
      st(
        's6d',
        'Thursday: the day changes',
        'cam',
        `<ul><li>Lesson 1: Aziz checks the homework given on Monday.</li><li>Feruza is ill: her substitute (“Spare 1”) and Feruza (“Spare 2”) open one cell: the “two people on one cell” dialog.</li><li>The grade-5 exam is on the timetables.</li></ul>`,
        [
          ['t', '12', 'homework checked'],
          ['t', '13'],
        ],
      ),
      st(
        's6e',
        'Thursday: the acting Tutor',
        'cam',
        `<p>Sanjar’s home now shows 5 Melbourne too; Umida’s bell: “tutor_changed”.</p>`,
        [['tu', '17']],
      ),
      st(
        's6f',
        'Friday: results after a week',
        'cam',
        `<p>Results and rating of each role, “Provisional: the quarter is open”. The AVP’s results page here; early warnings need more history (Session 7).</p>`,
        [
          ['t', '24'],
          ['tu', '16'],
          ['ct', '16'],
          ['ht', '19'],
          ['sht', '19'],
          ['avp', '51', 'demo branch part'],
        ],
      ),
      st(
        's6g',
        'Friday: the scheduled leavings',
        'cam',
        `<p>The 5 Tokyo student’s “Leaves the school” and the spare teacher’s “Left” happen today: show both in History and the staff list.</p>`,
        [
          ['avp', '21', 'after the date'],
          ['sa', '24', 'after the date'],
        ],
      ),
      st(
        's6h',
        'Any morning: the nightly check',
        'cam',
        `<p>Usually nothing to show: say that a clean night shows no line.</p>`,
        [['sa', '33']],
      ),
      st(
        's6i',
        '1 December 2026: IS26902 starts',
        'cam',
        `<p>“Students with no class” shows her → put her into 5 London and into its groups (Matematika, Ingliz, PE 5D6D).</p>`,
        [['avp', '23', 'second time']],
      ),
    ],
  },
  {
    n: 7,
    title: 'Video: AVP part 3 · Journals, plans and the quarter',
    when: 'Any day, even now · Chrome profile “Yunusobod AVP”',
    lede: 'Filmed in the seeded Demo Yunusobod: it has two months of history, and its quarter 1 ended on 31 October. A reset (step 0.2) never undoes a video already recorded.',
    steps: [
      st(
        's7a',
        'Journals and requests with history',
        'cam',
        `<p>The seeded unlock request “I was ill that day…”; the ended PE exemption; absences in a row; master plans.</p>`,
        [
          ['avp', '43'],
          ['avp', '44–45, 48', 'better takes with history'],
        ],
      ),
      st(
        's7b',
        'Close quarter 1',
        'cam',
        `<p>Closing checklist of quarter 1, decide the flags, close, reopen for a day, close again: “Quarter closed: read only”, files “Final”.</p>`,
        [['avp', '49–50']],
      ),
      st(
        's7c',
        'Results, rating, early warning, reports',
        'cam',
        `<p>With a full quarter behind them.</p>`,
        [['avp', '51']],
      ),
    ],
  },
  {
    n: 8,
    title: 'Videos: the roles that look',
    when: 'A school day after Week 1, from 10:00 · Chrome profiles “Principal”, “Spiritual VP”, “Head Tutor”, “Senior HT”',
    lede: 'Principal, Spiritual VP, Head Tutor, and the last Senior Head Teacher slide. There is a week of data to look at by now.',
    steps: [
      st(
        's8a',
        'Principal',
        'cam',
        `<p>First sign-in with Rustam’s slip already happened in step 2.8; sign in again. Slides that name Demo Yunusobod: the seed has no Principal there, so show the demo branch and say a full quarter looks the same.</p>`,
        [['p', '3–16']],
      ),
      st(
        's8b',
        'Spiritual and Moral VP',
        'cam',
        `<p>Valiyeva Shoira. The home page at 10:00: one class “below”.</p>`,
        [['svp', '3–12']],
      ),
      st(
        's8c',
        'Head Tutor',
        'cam',
        `<p>Tojiboyev Ulugʻbek. The home page at 10:00. Attendance by Tutor: Week 1 of the demo branch.</p>`,
        [['htu', '3–12']],
      ),
      st(
        's8d',
        'Senior Head Teacher: Head Teachers of my subjects',
        'cam',
        `<p>As slide 20 shows.</p>`,
        [['sht', '20']],
      ),
      st(
        's8e',
        'Send feedback, once per role',
        'cam',
        `<p>Each role sends one test report at the end of its video (at most 20 in 24 hours per person).</p>`,
        [
          ['sa', '34'],
          ['avp', '52'],
          ['t', '25'],
          ['tu', '18'],
          ['ct', '19'],
          ['ht', '21'],
          ['sht', '21'],
          ['p', '17'],
          ['svp', '13'],
          ['htu', '13'],
        ],
      ),
    ],
  },
  {
    n: 9,
    title: 'Cut into clips',
    when: 'After recording',
    lede: '',
    steps: [
      st(
        's9a',
        'One clip per slide',
        'off',
        `<p>Every take was filmed against one deck slide. Name each clip after its slide title and put the role’s clips in the deck’s order. The deck’s dividers are the chapters.</p>`,
      ),
    ],
  },
];

// Slides that cannot be filmed yet, with the reason
const NOT_FILMABLE = {
  sa: {
    28: 'Restore a graduate: graduation comes with Close the year, not built',
    32: 'Decide the AVP’s own requests: the AVP has no lessons in this branch; ask Claude before filming it',
  },
};

if (process.env.DUMP) { fs.writeFileSync(process.env.DUMP, JSON.stringify(SESSIONS.map((x) => ({ n: x.n, title: x.title, when: x.when, steps: x.steps.map((t, i) => ({ num: `${x.n}.${i + 1}`, id: t.id, title: t.title, decks: t.decks, body: t.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() })) })), null, 1)); process.exit(0); }
// ---- checks: every feature slide is filmed somewhere ----
const expand = (s) =>
  s.split(',').flatMap((p) => {
    const [a, b] = p.trim().split('–').map(Number);
    return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
  });
const covered = {};
const where = {};
for (const ses of SESSIONS)
  for (const step of ses.steps)
    for (const [k, slides] of step.decks) {
      covered[k] ??= new Set();
      expand(slides).forEach((n) => covered[k].add(n));
      ((where[k] ??= {})[ses.n] ??= []).push(slides);
    }
let problems = 0;
for (const [k, [, , file]] of Object.entries(DECKS)) {
  if (k === 'plan') continue;
  const deck = (await import(pathToFileURL(path.join(here, '../decks', file)).href)).default;
  deck.slides.forEach((s, i) => {
    const n = i + 1;
    if (s.kind !== 'feature') return;
    if (!covered[k]?.has(n) && !NOT_FILMABLE[k]?.[n]) {
      console.error(`not filmed: ${k} slide ${n} ${s.title}`);
      problems += 1;
    }
  });
}

// ---- render ----
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const chip = ([k, slides, note]) =>
  `<p class="deck">${link(k)} <span class="sl">slide${/[–,]/.test(slides) ? 's' : ''} ${slides}</span>${note ? ` <span class="dn">· ${esc(note)}</span>` : ''}</p>`;
const stepHtml = (ses, step, i) => {
  const [cls, label] = TAG[step.tag];
  return `<li class="step" data-id="${step.id}"><label><input type="checkbox" id="c-${step.id}"><span class="box"></span></label>
  <div class="head"><span class="num">${ses.n}.${i + 1}</span><h3>${step.title}</h3><span class="tag ${cls}">${label}</span></div>
  <div class="body">${step.decks.length ? `<div class="decks">${step.decks.map(chip).join('')}</div>` : ''}${CLICKS[step.id] ? `${clicksHtml(CLICKS[step.id])}<details class="about"><summary>What this step is for</summary>${step.body}</details>` : step.body}</div></li>`;
};
const sessionHtml = (ses) => `<section id="s${ses.n}">
  <div class="ses"><span class="snum">Session ${ses.n}</span><h2>${ses.title}</h2><p class="when">${ses.when}</p>${ses.lede ? `<p class="lede">${ses.lede}</p>` : ''}</div>
  <ol class="steps">${ses.steps.map((s, i) => stepHtml(ses, s, i)).join('\n')}</ol>
</section>`;

const sessionNames = Object.fromEntries(SESSIONS.map((s) => [s.n, s.title]));
const deckRows = Object.keys(DECKS)
  .filter((k) => k !== 'plan')
  .map((k) => {
    const cells = Object.entries(where[k] ?? {})
      .map(([n, list]) => `<a href="#s${n}">Session ${n}</a>: ${list.join(', ')}`)
      .join('<br>');
    const nf = Object.entries(NOT_FILMABLE[k] ?? {})
      .map(([n, why]) => `<br><span class="dn">Slide ${n} not yet: ${esc(why)}</span>`)
      .join('');
    return `<tr><td>${link(k)}</td><td>${cells}${nf}</td></tr>`;
  })
  .join('\n');

const html = `<title>Tutorial Recording Guide</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bitter:wght@600;700&family=Golos+Text:wght@400;500;600;700&display=swap">
<style>${css}
section[id] { scroll-margin-top: 72px }
.how { display: grid; gap: 10px }
.how table td:first-child { white-space: nowrap; font-weight: 600 }
.toc { display: flex; flex-wrap: wrap; gap: 6px 8px; font-size: .9rem }
.toc a { text-decoration: none; background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; color: var(--ink) }
.ses { display: grid; gap: 4px; border-top: 3px solid var(--accent); padding-top: 14px }
.snum { font-size: .78rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--accent) }
.when { color: var(--muted); font-size: .95rem; font-weight: 500 }
.decks { display: grid; gap: 4px; padding: 8px 10px; background: var(--cam-bg); border-radius: 8px }
.deck { font-size: .92rem }
.deck a { font-weight: 600; color: var(--cam) }
.sl { font-variant-numeric: tabular-nums; font-weight: 600 }
.dn { color: var(--muted); font-weight: 400 }
.clicks { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px }
.clicks li { display: grid; grid-template-columns: 26px 1fr; gap: 8px; align-items: baseline }
.clicks .n { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--accent-ink); background: var(--accent); border-radius: 50%; width: 22px; height: 22px; display: inline-grid; place-items: center; font-size: .78rem }
.clicks li.part { display: block; margin-top: 6px; font-size: .8rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--muted) }
.clicks code { white-space: normal }
.before { font-size: .92rem; color: var(--muted) }
.check { background: var(--ok-bg); color: var(--ok); border-radius: 8px; padding: 8px 12px; font-size: .92rem }
details.about { font-size: .9rem; color: var(--muted) }
details.about summary { cursor: pointer; font-weight: 600 }
details.about > *:not(summary) { margin-top: 6px }
</style>

<main>
<header class="top">
  <h1>Tutorial Recording Guide</h1>
  <p class="lede">The only page you follow. Go down it from top to bottom: ten sessions, each with its day and its Chrome profiles. Every step names the deck and the slides to film while you do it. Tick each step as you go; the ticks stay in this browser.</p>
</header>

<div class="bar" role="status">
  <div class="track" aria-hidden="true"><div class="fill" id="fill"></div></div>
  <span id="count">0 of 0 steps done</span>
  <button type="button" id="reset">Clear ticks</button>
</div>

<section>
  <h2>How it fits together</h2>
  <div class="panel how tw">
    <table>
      <tr><th>What</th><th>What it is for</th></tr>
      <tr><td>This page</td><td><b>What to do, and in which order.</b> Follow it.</td></tr>
      <tr><td>The role decks</td><td><b>What to show and say.</b> When a step names “Teacher deck slides 9–10”, open those slides: their <i>Steps</i> are the clicks, <i>Show on camera</i> is the shot, the speaker notes are the narration. Film each slide as its own take.</td></tr>
      <tr><td>Recording plan</td><td><b>Why.</b> Read once in Session 0, then only to look something up.</td></tr>
      <tr><td>The five Excel files</td><td>Used in Sessions 2 and 3, in the steps that name them.</td></tr>
    </table>
  </div>
  <nav class="toc" aria-label="Sessions">${SESSIONS.map((s) => `<a href="#s${s.n}">${s.n} · ${s.title.replace(/^Videos?: /, '')}</a>`).join('')}<a href="#decks">Every deck</a></nav>
</section>

${SESSIONS.map(sessionHtml).join('\n\n')}

<section id="decks">
  <h2>Where each deck is filmed</h2>
  <p class="lede">The same plan the other way round: each deck and the sessions its slides are filmed in. Every feature slide of every deck is on this page.</p>
  <div class="panel tw"><table><tr><th>Deck</th><th>Sessions and slides</th></tr>
${deckRows}
  </table></div>
</section>

<section>
  <h2>The five files</h2>
  <div class="panel tw">
    <table>
      <tr><th>File</th><th>Used in</th><th>What it is</th></tr>
      <tr><td><span class="file">1 Xodimlar importi - xatolar bilan.xlsx</span></td><td>Step 2.10</td><td>Staff import with 3 planted mistakes (4 rows refused).</td></tr>
      <tr><td><span class="file">2 Xodimlar importi - toza.xlsx</span></td><td>Step 2.10</td><td>The same 52 teachers and Tutors, clean.</td></tr>
      <tr><td><span class="file">3 Oʻquvchilar importi - xatolar bilan.xlsx</span></td><td>Step 3.9</td><td>Student import with 3 planted mistakes (4 rows refused) and one duplicate warning.</td></tr>
      <tr><td><span class="file">4 Oʻquvchilar importi - toza.xlsx</span></td><td>Step 3.9</td><td>The same 130 students, clean, still with the duplicate warning to tick.</td></tr>
      <tr><td><span class="file">5 Demo filial maʼlumotlari.xlsx</span></td><td>Sessions 2–4</td><td>The cheat sheet: subjects, rooms, day templates, classes, groups and members, teaching load, a timetable sheet per class, working hours, planted props.</td></tr>
    </table>
  </div>
  <p class="note">Already planted in the files, nothing to do: siblings (IS26003 in 3 Genius and IS26052 in 5 Tokyo share both parents), a teacher who is a parent (IS26085 in 6 Imperial, father Otabek Normatov), eight students with no consent date, two scholarships per class. Sheet <b>9 Planted props</b> lists each one.</p>
</section>

<section>
  <h2>Things to know</h2>
  <div class="panel">
    <ul style="margin:0;padding-left:20px;display:grid;gap:6px">
      <li>Everything happens on the test site. Every person and phone is invented.</li>
      <li>Cross-branch scenes and anything that needs months of history are filmed in the seeded Demo Yunusobod and Demo Chilonzor (Session 7, and the steps that say so).</li>
      <li>6 Imperial: its real grade-6 Matematika and English blocks are not built, so they are whole-class rows. Say so on camera.</li>
      <li>3 Indigo is entered as a Russian-language class. If it is not, set its language to Uzbek; nothing else changes.</li>
      <li>If a demo clock is built later, Session 6 shrinks to one sitting; nothing else on this page changes.</li>
    </ul>
  </div>
</section>
</main>

<script>${js}</script>
`;
fs.writeFileSync(path.join(here, 'guide.html'), html);
console.log(
  problems ? `${problems} feature slides not filmed` : 'every feature slide is filmed somewhere',
);
