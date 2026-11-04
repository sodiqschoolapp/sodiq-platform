import { F, T, D, K, S, BRANCH, signIn, shell, feedback } from './common.mjs';

export default {
  title: 'Super Admin tutorial',
  footer: 'Sodiq platform tutorials · Super Admin',
  slides: [
    { kind: 'cover', kicker: 'Tutorial · Super Admin', title: 'Super Admin', sub: 'Builds the school: branches, rooms, years, staff, accounts and roles. Sees every branch and can do everything the Academic Vice Principal does.', meta: `Demo: builds "${BRANCH}" from nothing · Chrome profile "SA"` },
    K('The role in one slide', [
      { title: 'Only the Super Admin', body: ['Creates branches, buildings, floors, rooms, divisions, academic years', 'Creates accounts and gives every role, Head Teachers included', 'Imports staff from Excel', 'Forced delete, with a reason, and its restore', 'Merges two student records; restores a graduate', 'Turns "Rating exams in grades 0–4" on or off', 'Moves a subject or teacher to another department', 'Reads the whole audit log and the personal data report'] },
      { title: 'Also, like the AVP', body: ['Everything of the Academic Vice Principal video, in every branch', 'Decides the Academic Vice Principal’s own requests', 'Applies a nightly-check difference with a reason'] },
      { title: 'Limits', body: ['At most 3 Super Admins; the last one cannot be removed or locked', 'Nobody acts on their own account or approves their own request', 'Second step required; idle sign-out after 15 minutes'], tone: 'warn' },
    ], { notes: 'The Super Admin is the builder of the school. This video sets up a whole new branch; the daily academic work is in the Academic Vice Principal video, and the Super Admin can do all of it too.' }),
    ...signIn('Super Admin', true),
    shell('Super Admin', 'Home, School setup, People, Classes and subjects, Timetable, Journal, Results, Lesson plans, Audit log', [
      '**Branch** dropdown: the Super Admin works in every branch; unsaved typing is asked about before a switch',
      '**Menu and home page: …** appears when the person holds two or more roles; rights stay those of all roles',
    ]),
    F('Home page', {
      what: 'The branch at a glance, and warnings only a Super Admin gets.',
      steps: ['**Home**: tiles **Students**, **Staff**, **Attendance today**', 'Table **Results by grade** (Provisional or Final)', 'Banners: "Fewer than two Super Admins are active…", "No active Academic Vice Principal in: …"'],
      show: ['Switch the branch and watch the tiles change', 'The banner about a branch with no Academic Vice Principal (before Nodira is appointed)'],
    }),

    D('Part 1', 'Build the branch', 'School setup in the order of the Setup checklist.'),
    F('The setup checklist', {
      what: 'Twelve items, each "Done" or "Missing", in the order a branch is built.',
      steps: ['**School setup** → **Setup checklist**', 'Branch and working weekdays → Rooms → Departments → Academic year → Four quarters dated → Lesson slot types → Default day template → Calendar → Subjects and weights → Classes → Groups → Teaching load'],
      show: ['Open it on the empty branch: all Missing', 'Come back at the end of the AVP video: all Done'],
      notes: 'The checklist is the map of the set-up. It updates itself as data is added; nothing is ticked by hand.',
    }),
    F('New branch', {
      what: 'A branch has its address, working weekdays and time zone. The time zone decides "today" for every rule.',
      steps: ['School setup → **Branches** → **New branch** (side panel)', 'Name, Address, Phone, Email, **Working weekdays** (Mon–Fri), **Time zone**', 'Branch page → **Go-live date** (needs a year first)', 'School setup → **Travel time**: minutes between branches (up to 180)'],
      show: [`Create "${BRANCH}"`, 'Set 20 minutes of travel to Demo Yunusobod'],
      who: 'Only the Super Admin creates and edits. Principal and AVP view the Branch page.',
      notes: 'Travel time matters for teachers who work in two branches: the board will refuse a lesson they cannot reach in time.',
    }),
    F('Buildings, floors and rooms', {
      what: 'Rooms are added floor by floor. Status replaces deleting: In use, Under repair, Closed.',
      steps: ['**Buildings and floors** → **Add building** → **Add floor**', '**Rooms** → **Add room**: Name or number, Building, Floor, **Type**, **Capacity**, **Shared** + Lessons at the same time, **Status**', 'Bulk: tick rooms → **Mark under repair** / **Mark closed**', '**View**: **List** or **By floor** (room cards by floor)'],
      show: ['Home rooms of the eight classes: 105, 212, 204, 207, 208, 209, 407, 408 (Classroom)', 'Sport zal 1 and Sport zal 2: Sports hall, Shared, 2 lessons at once', 'Oshxona: Hall; the By floor view'],
      who: 'Super Admin creates and edits; Principal and AVP view and export.',
    }),
    F('Delete for good, and restore', {
      what: 'Only something nothing uses can be deleted for good, with a typed reason. Anything used is archived or closed instead.',
      steps: ['Room panel → **Delete for good** → **Reason** → **Delete for good**', 'School setup → **Deleted for good**: What was deleted, Reason, State, "Can be restored until" → **Restore**', 'Same page later holds force-deleted lessons (Timetable → Day changes → **Delete for good**)'],
      show: ['Add a room by mistake, delete it for good, restore it'],
      time: 'Restore within **30 days**; a job at 02:00 empties older ones (State "Past 30 days").',
      who: 'Super Admin only.',
    }),
    F('Divisions and departments', {
      what: 'School-wide. "Academic" is built in. Subjects need a department in Academic; Tutor subjects live in the "Tutors" department.',
      steps: ['**Divisions and departments** → **Add division** / **Add department** (names in Uzbek, Russian, English)', '**Rename**, **Archive** / **Restore**'],
      show: ['Add department "Robotics and STEM" for Robototexnika and PBL'],
      who: 'Super Admin edits; Principal and AVP view.',
    }),
    F('Academic year', {
      what: 'A branch’s year is Planned, then Current after **Start year**, never switched by a date alone.',
      steps: ['**Academic years** → **Add year** (Planned, four undated quarters)', '**Change quarters**: Quarter 1–4 start and end (the AVP can do this too)', '**Start year** → "Start the year …?"', 'Edit the year’s own dates later with **Edit**'],
      show: ['Add the year, date the quarters, Start year', 'The top bar now shows the year and quarter'],
      time: ['Nothing starts a year by itself on its date', 'Quarter dates touching published lessons open a preview: "What the new quarter dates change"', 'For the compressed demo year (recording plan, B): four one-week quarters'],
      who: 'Super Admin creates years and starts them.',
    }),
    F('School-wide settings', {
      what: 'One setting is the Super Admin’s alone: "Rating exams in grades 0–4".',
      steps: ['School setup → **Settings** → **School settings** → **Turn on** / **Turn off**', '**Apply to every open quarter** → **Reason** (always required)'],
      show: ['Turn it on with a reason; show the refusal when it cannot be turned off ("It cannot be turned off yet.")'],
      time: 'Acts on open quarters of every branch; a closed quarter keeps its results; a new quarter takes the school’s value.',
    }),

    D('Part 2', 'Staff, accounts and roles', 'People → Staff. Every account and every role comes from here.'),
    F('Import staff from Excel', {
      what: 'Many teachers at once, each with a record, an account, a role and a first-password slip.',
      steps: ['People → **Staff** → **Import from Excel** → **Download the template**', 'One row per person; subjects as "Matematika: 5-7" (up to 8); Role: Teacher, Tutor or none', '**Upload the filled file** → **Rows of the file** with Problems → fix the file and upload again', '**Save all N people** → **First-password slips** → **Print the slips** (four per A4 page)'],
      show: ['Upload a file with one deliberate error (a "Super Admin" role): nothing is saved, the row and reason are listed', 'Fix it, save the teachers of the eight classes, print the slips'],
      time: 'Slips are valid 7 days. Uploading the same file again creates nothing.',
      who: 'Super Admin only.',
      notes: 'This is the fastest way to bring in a school’s teachers. Availability and further branches are added by hand afterwards.',
    }),
    F('Add one staff member by hand', {
      what: 'The full staff record with its duplicate warning.',
      steps: ['People → Staff → **Add person**: names, Sex, Date of birth, Phone, Email, JSHSHIR, Admission date, Contract, "Lessons per week by contract", "Most lessons per day", Main division, Department in Academic', '"Possibly the same person" → **Save anyway** only if it is truly another person', 'Panel: **Subjects and languages**, **Branches** (main and further)'],
      show: ['Add the Principal Rustam Yoʻldoshev', 'Type a parent’s phone: the record is marked "Also a parent"'],
      who: 'Super Admin creates; the AVP edits name, phone, email, subjects, languages and availability.',
    }),
    F('Create an account and give roles', {
      what: 'An account is a login on a staff record. Roles carry a branch, dates and, for Head Teachers, subjects.',
      steps: ['Staff panel → **Account and roles** → **Create account** → Login → slip **First password** → **Print**', '**Give a role** → New role, Branch, **From** (and **Subjects** for Head Teachers)', '**End role** → **Ends from**', '**Change subjects** → **New subjects from**'],
      show: ['Account for Nodira; role Academic Vice Principal from today', 'Madina: Head Teacher of Ingliz tili, Rus tili, Arab tili, Ona tili', 'Tutor role: Umida, Sanjar, the other Tutors; Class teacher role: Kamola, Ozoda'],
      time: 'A role can be planned for a later date; once its end date has come, the end cannot be taken back.',
      who: 'Super Admin only. At most 3 Super Admins.',
    }),
    F('Head Teachers list', {
      what: 'Every Head Teacher and Senior Head Teacher with subjects and dates. One per subject per branch.',
      steps: ['People → **Head Teachers**: Role, Person, Subjects, From, Until, State'],
      show: ['Madina in force; the seeded Senior Head Teacher across branches'],
      who: 'Super Admin, Principal, AVP see all; Head Teachers see their own subjects.',
    }),
    F('Locks and resets', {
      what: 'Stop an account at once, or give a forgotten password back.',
      steps: ['Staff panel → **Sign-in access**: **Lock now** (Reason), **Unlock**, **Reset password** (slip valid 24 hours), **Reset second step**', 'People → **Accounts never used**: Password "Valid until…" / "Ran out on…"', 'People → **Entries after a reset**: journal entries within 48 hours of a reset'],
      show: ['Lock a teacher; their browser is signed out at the next click', 'Reset a password and print the slip'],
      who: 'Super Admin on any account. The AVP may lock, unlock and reset Teachers, Tutors, Class teachers, Head Teachers and the Head Tutor of the branch, never the second step.',
    }),
    F('Staff status and department moves', {
      what: 'Dated changes that act on their day.',
      steps: ['Staff panel → **Change status** → Active / Inactive / Left → **From** → **Set status**', 'Record form → "Department in Academic" + **Moves to the department on**', 'Subjects → a subject’s **Moves on** (to another department)'],
      show: ['Plan "Left" for next Friday: the list shows "Planned: Left from …"'],
      time: ['"Left": every role ends that day and sign-in stops; a re-hire gets a password valid 7 days', 'A department move shows "Moves to … on …" until its date'],
      who: 'Super Admin.',
    }),
    F('Your own staff record', {
      what: 'The Super Admin can link a staff record to their own account, for a photo and a name in the log.',
      steps: ['People → Staff → your record → **Link to my account**'],
      show: ['Account → Photo works after the link'],
    }),

    D('Part 3', 'Students, records and the log', 'What only the Super Admin does with student records and the audit trail.'),
    F('Merge two student records', {
      what: 'A child entered twice becomes one record. The older UID stays. It cannot be undone.',
      steps: ['Student panel → **Merge with another record** → **UID of the other record** → **Show the merge**', 'Preview: Stays / Merged into it and removed, Values that differ', '**Reason** → **Merge**'],
      show: ['Import a duplicate on purpose, then merge'],
      time: 'Refused while a move or release of either record lies ahead.',
    }),
    F('Restore a graduate', {
      what: 'A graduated student comes back to active, from a date, into a class.',
      steps: ['Student panel → **Restore this student** → **Restore to active** → **Active from**', 'May be dated the first day of next year'],
      show: ['Note: graduation itself comes with Close the year (not built), so film this in a later release'],
    }),
    F('Audit log', {
      what: 'Every sign-in, change, archive and export, kept forever and editable by nobody.',
      steps: ['Menu → **Audit log**: From, To, **Kind**, About whom, Person', '**Log**: This branch / All branches / School-wide only (Super Admin only)', 'Entry panel: Before / After, **Show hidden values** (logged), **All entries of this record**', 'Any Staff, Student or Parent panel → **Change log**'],
      show: ['Find the role you gave Nodira; open Before/After', 'Filter Kind = Exports'],
      time: 'Default range 30 days, at most 366.',
    }),
    F('Personal data report', {
      what: 'Everything the platform holds about one person, for a data request.',
      steps: ['Staff, Student or Parent panel → **Personal data report** → **Print**'],
      show: ['Open it for an invented student'],
      who: 'Super Admin only. Each opening is logged as an export.',
    }),

    D('Part 4', 'Above the Academic Vice Principal', 'The Super Admin also does every task of the AVP video.'),
    F('Decide the AVP’s own requests', {
      what: 'Nobody approves their own. The AVP’s unlock and plan requests come to the Super Admin.',
      steps: ['Journal → **Unlock requests** → **Waiting for me** → **Decide** → **Approve** (Days open 1–7) or **Refuse**', 'Lesson plans → **Plan edit requests** → **Decide**'],
      show: ['Second browser: the AVP requests an unlock of her own Tutor lesson; the Super Admin approves'],
    }),
    F('Nightly check differences', {
      what: 'Every night the platform recalculates results and compares. A difference blocks closing that journal.',
      steps: ['Journal → **Closing checklist** → "Nightly check of …: n differences"', '**Recalculate and compare** → **Apply with a reason** (Super Admin only)'],
      time: 'Runs at 02:00; a second notice at 07:00 if it did not run.',
      show: ['Usually nothing to show: say that a clean night shows no line'],
    }),
    feedback,
    S('Next: the Academic Vice Principal', 'The branch exists, the staff can sign in. The AVP now builds the classes and the timetable.'),
  ],
};
