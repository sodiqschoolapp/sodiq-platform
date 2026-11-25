/** Task 11.19: the descriptions of the map of the platform, pages. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'page:/':
    "The first screen after signing in, filled for the active role: today's lessons, own journals, early warnings, requests waiting, lessons that need a teacher or a room, or the branch summary. A button opens the announcements and events.",
  'page:/account':
    "The person's own account: photo, language, password, the open sessions with sign out everywhere, the sign-in history, the trusted devices and the second step at sign-in.",
  'page:/account/password':
    "Changes the person's own password: type the current password, then the new one twice. Other sessions are signed out and this device is no longer trusted. After a one-time password, the new password must be chosen here before going on.",
  'page:/announcements':
    'Shows the announcements and events published for the person this month, as a list or on a calendar, with buttons to move between months. A link leads to writing announcements where that is allowed.',
  'page:/announcements/manage':
    'Lists the announcements and events of the branch with their audience, publish date and the delivery of messages to parents. Here one adds a new announcement or event, edits one, and archives or restores it.',
  'page:/assistant':
    "The full-page assistant: the list of the person's own conversations, a new conversation, and the chat where one asks how to do things on the platform or asks it to prepare changes that are confirmed before they run.",
  'page:/assistant-conversations':
    "Lists every conversation people had with the assistant, with person, role, branch and last activity. Opening one shows it; a removed conversation can be restored to its person's list.",
  'page:/audit':
    'Searches the audit log: every recorded change, sign-in and export, filtered by dates, kind, branch scope and person. Opening an entry shows before and after values; hidden values can be shown on purpose.',
  'page:/classes':
    'Lists the classes of the branch with year, language, Tutor or Class teacher, main classroom, students, average and attendance. Here one adds a class, opens its record to edit it, archives it, and goes to the groups.',
  'page:/feedback-reports':
    'Lists the reports people sent with the feedback button of any page: the text, sender, roles, page and time. Each report can be marked handled or back to new.',
  'page:/forced-deletes':
    'Lists lessons, buildings, floors and rooms deleted for good in the last 30 days, with the reason and who deleted them. A record can be restored from here while its 30 days run.',
  'page:/groups':
    'Lists the groups of the branch: subject, classes drawn from, language, students, teacher, average and attendance. Here one adds a group, edits or archives it, and opens the placement of students.',
  'page:/groups/placement':
    'Places students into groups in bulk: choose a subject, grades and a date, tick the students not yet in a group of the subject and put them into a chosen group, or place them automatically.',
  'page:/integration-keys':
    'Lists the integration keys that let a department platform work for chosen people. Here one creates a key (its secret is shown once), changes its end date or people, and revokes it.',
  'page:/journal':
    'Lists the journals of the branch by class or by group for an academic year; opening one shows the class journal. Links lead to absences, unlock requests, exemptions, discipline, orphan lessons, closing, exports and the support view.',
  'page:/journal/$journalId':
    'The class journal of one class or group and subject for a quarter: attendance, marks and work scores in a grid or in lesson mode, with the quarter results and grades worked out by the platform. Cells are entered and undone here while the lesson is open.',
  'page:/journal/discipline':
    'Shows per teacher, for a date range and department, how journals were kept: lessons held, nothing entered, in progress, complete, locked incomplete, attendance not marked, no topic, missing scores and late entries. Each count opens what is counted; it exports to Excel.',
  'page:/journal/exemptions':
    'Lists the exemptions of students from subjects or whole days, with their dates and reasons. Here one enters new exemptions, ends or voids them, attaches documents, and acts on absences with a reason and exemptions offered by a branch move.',
  'page:/journal/exports':
    "Asks for an export of the branch's journals for a quarter or month as Excel or PDF, made in the background, and lists the exports asked for with their status and a download link.",
  'page:/journal/orphans':
    'Lists incomplete lessons of teachers who have left the school. Here one assigns another teacher to complete a lesson for some days with a reason, or withdraws that assignment.',
  'page:/journal/student-absences':
    'Lists, by student and day, the absences of a class in a date range. Here one sets or clears the reason of an absence, adds a note and attaches or removes a supporting file.',
  'page:/journal/support':
    "Shows, for one journal, date and student, every save, refusal and exemption event of the student's cells in order, with how the result was calculated. Used to answer questions such as a mark that disappeared.",
  'page:/journal/unlocks':
    'Lists the requests to unlock locked lessons and rating exams, with reason and status. Here one decides or withdraws a request, opens the journal, and extends the edit period for a range of days.',
  'page:/people':
    'The entry to the people lists: staff, students, parents, vacancies, Head Teachers and accounts never used.',
  'page:/people/classes/$classId/parent-slips':
    'Lists the parents of a class with portal access and prints their sign-in slips with a login and one-time password, in a chosen language. A slip can be printed again, which replaces the earlier password.',
  'page:/people/digest-log':
    'Lists the daily digests sent to parents through Telegram for a chosen date, with status, send time and attempts, filtered by status and paged newer or older.',
  'page:/people/head-teachers':
    'Lists the Head Teachers of the branch with the subjects they oversee and from and until when. Appointments are made on the account of a staff record.',
  'page:/people/never-used':
    'Lists the accounts of the branch that were never used, with login, creation date, whether the first password ran out and lock state. A name opens the staff record, where sign-in access is changed.',
  'page:/people/parent-accounts':
    'Lists the parent accounts whose printed slip was never used to sign in, with children, print date and whether the password expired. The list can be exported.',
  'page:/people/parents':
    "Lists the parents and relatives of the branch's students with main phone and students. Opening one edits the record; filters find parents with no valid phone. Links lead to parents never signed in and the digest log.",
  'page:/people/report/$kind/$id':
    'Produces the personal data report of one student, staff member or relative: every stored detail, history, marks and attendance. The report is logged as an export and can be printed.',
  'page:/people/reset-entries':
    'Lists the password resets of the branch in a date range, each with the journal entries made in the 48 hours after it, so that entries made after a possibly misused reset can be checked.',
  'page:/people/staff':
    'Lists the staff of the branch with category, department, subjects, grades and status. Here one adds a person, opens a record to edit it and its account, and imports staff from Excel.',
  'page:/people/staff/import':
    "Imports staff from an Excel file: download the template, upload the filled file, see each row's problems and decisions, then confirm. The new passwords are shown once for printing slips.",
  'page:/people/students':
    'Lists the students of the branch with UID, class, groups, Tutor and status. Here one adds a student, edits a record, puts students into a class or group, records leaving school, and imports from Excel.',
  'page:/people/students/import':
    "Imports students from an Excel file: download the template, upload the filled file, check each row's problems and possible duplicates, then confirm to create the students.",
  'page:/people/vacancies':
    'Lists the vacancies of the branch: posts for teachers not yet hired, with department, subjects, grades, languages and weekly lessons. A vacancy can take teaching load. Here one adds and edits them.',
  'page:/plans':
    'Lists the lesson plans of the year by class or group and subject, with warnings such as a master updated or too few works. Opening one shows the plan. Links lead to windows, reports and edit requests.',
  'page:/plans/$journalId':
    'The lesson plan of one class or group and subject for a quarter: one row per lesson with topic, classworks, homeworks and files. Rows are edited here; the page shows rows without a topic and works below the minimum.',
  'page:/plans/masters':
    'Lists the master plans: one list of topics for a subject, grade, language and quarter that classes copy into their plans. Here one adds a master plan and opens one.',
  'page:/plans/masters/$masterId':
    'One master plan: its rows of topics with objectives, links, classworks and homeworks. Here one adds, edits, reorders and removes rows, renames the master, and archives or restores it.',
  'page:/plans/parallel':
    'Compares the classes and groups of one grade side by side for a subject and quarter: the lesson and topic each has reached and its next topic.',
  'page:/plans/reports':
    'Reports on lesson plans for a quarter: completeness by teacher or by plan, progress against the plan, and edit requests, filtered by department. Each part exports to Excel.',
  'page:/plans/requests':
    'Lists the requests to edit lesson plans after their window, with kind and status. Here one decides a request, opens the plan, or approves together the requests caused by one change.',
  'page:/plans/windows':
    "Shows each quarter's window in which teachers write their lesson plans, and opens or changes a window's first and last day. When plan windows are off in Settings, it says so.",
  'page:/results/attendance':
    'The attendance report for a date range: expected lessons and attendance by class or by Tutor, with daily attendance, filtered by grade, class, subject, teacher and period.',
  'page:/results/closing':
    'The closing checklist of a quarter: everything unfinished, by teacher and class, with what blocks closing and what only warns. Here one reminds teachers, decides items, closes the quarter, and reopens it.',
  'page:/results/early-warning':
    'Lists the students who need attention in a quarter, by subject, with reasons such as a low result, a drop, low attendance or absences in a row. The side panel shows the trend; a reason can be marked handled with a note.',
  'page:/results/load':
    'The timetable load report for a week: teachers against their planned and contract load, classes and groups against the load, rooms in use and free periods.',
  'page:/results/mastery':
    'Subject mastery for a quarter and subject: how many students fall in each grade band, filtered by grade, class and teacher. Provisional while the quarter is open.',
  'page:/results/rating':
    'The rating of students in a subject, of a class across subjects, or of classes, for a quarter or year, with places and results. Provisional while the quarter is open; exports to Excel.',
  'page:/results/reports':
    'The entry to the reports: attendance, results table, subject mastery, journal discipline and timetable load.',
  'page:/results/table':
    "The results table of one class for a quarter: each student's result and grade in every subject. Provisional while the quarter is open.",
  'page:/setup':
    'The entry to school setup: branches, buildings, rooms, divisions, years, slot types, day templates, calendar, settings, subjects, and the system pages such as deleted records, feedback, keys and status.',
  'page:/setup/branch':
    'Shows and edits the chosen branch: name, address, phone, email, working weekdays and time zone, and sets its go-live date.',
  'page:/setup/branches':
    'Lists the branches of the school with address, working weekdays, buildings and rooms. Here one adds a new branch.',
  'page:/setup/buildings':
    'Lists the buildings of the branch with their floors and rooms. Here one adds a building, edits its floors, archives or restores it, and deletes one for good with a reason.',
  'page:/setup/calendar':
    'Lists the days off and special days of the branch, with dates, kind, grades and day template. Here one adds and edits entries and checks what any date is for each grade.',
  'page:/setup/day-template-settings':
    'Shows which day template applies on a date to each weekday and grade, and the settings by level. Here one sets a template from a date for the branch, a weekday or a range of grades, after seeing the changes.',
  'page:/setup/day-templates':
    'Lists the day templates of the branch: a start time and the lesson and break slots in order. Here one adds and edits them and archives or restores them.',
  'page:/setup/assistant':
    'The Super Admin\u2019s settings of the assistant: switched on for the school and each role, the limits, which personal data may reach the model, and every action of each role by area, each switched on or off for the assistant. Heavy actions such as publishing, closing, password resets and roles start off.',
  'page:/setup/demo-clock':
    'Moves the demo time of the test environment forward to a chosen date and time. Every rule of the platform then follows demo time. Demo time never moves back.',
  'page:/setup/divisions':
    'Lists the divisions of the school with their departments and staff. Here one adds a division and its departments, renames them, and archives or restores them.',
  'page:/setup/rooms':
    'Lists the rooms of the branch as a list or by floor, with building, type, capacity, status and whether shared. Here one adds and edits rooms, sets the status of several, and deletes one for good.',
  'page:/setup/settings':
    'The settings of the branch and school: edit days, most lessons of a class per day, plan windows, early-warning thresholds, attendance values per quarter, languages of instruction, grade bands and the assistant.',
  'page:/setup/slot-types':
    'Lists the slot types: the kinds of lesson and break with their length in minutes, including planned changes of length. Here one adds, edits, archives and restores them.',
  'page:/setup/subjects':
    'Lists the subjects of the school with department, grades, journal type, rating exam, quarter weights and switches. Here one adds and edits subjects, archives or restores them, and imports from Excel.',
  'page:/setup/subjects/import':
    "Imports subjects from an Excel file: download the template, upload the filled file, see each row's problems, then confirm to create the subjects.",
  'page:/setup/travel-times':
    'Sets the travel time in minutes between the chosen branch and every other branch, used for teachers who work in several branches.',
  'page:/setup/years':
    'Lists the academic years with start, end, status and quarters. Here one adds a year, changes its dates and quarters, and starts it as the current year.',
  'page:/system-status':
    'Shows the health of the platform: background jobs, failed jobs and exports, refused saves, nightly checks per branch, feedback, and the uptime, alerts and errors of outside services over a chosen period.',
  'page:/timetable':
    'The entry to the timetable: views, teaching load, draft builder, day changes, exams, absences, room closures and version history.',
  'page:/timetable/absences':
    "Lists the absences of the branch's staff with first and last day and reason. Here one enters an absence when a teacher cannot come; it covers every branch they work in.",
  'page:/timetable/builder':
    'The draft builder of a timetable version: a checklist of steps from day templates, teaching load, teachers, rooms and rules to generation, editing in the grid and publishing, each shown ready or not ready.',
  'page:/timetable/day':
    'Shows the lessons of a class on a date and makes one-day changes: cancel, move, change the room, substitute a teacher, restore, correct a past lesson, see the history, or delete a lesson for good.',
  'page:/timetable/exams':
    'Lists the exams of a date with time, rooms and classes and invigilators. Here one adds an exam, which cancels the lessons of its classes in its slots, changes it or cancels it.',
  'page:/timetable/load':
    'The teaching load of a timetable version: rows giving a class or group a subject, a teacher, lessons per week and a room need, with their problems. Here one starts a draft, adds and edits rows, imports from Excel and withdraws a version.',
  'page:/timetable/load/import':
    "Imports teaching load rows from an Excel file into the open draft: download the template, upload the filled file, check each row's problems, then confirm.",
  'page:/timetable/pattern/import':
    "Imports a weekly timetable from an Excel file into a draft: download the template, upload the filled file, check each row's problems and warnings, then place the lessons.",
  'page:/timetable/room-closures':
    "Lists the closures of the branch's rooms with first and last day and reason. Here one closes a room for some days, for example during repairs.",
  'page:/timetable/versions':
    'Lists the timetable versions of a year by start date, with status and source. Here one compares two versions and restores an older one as a new draft.',
  'page:/timetable/views':
    'Shows the timetable read-only by school, class, teacher or room, for a day or a week, with every one-day change, substitution, exam and cancellation marked.',
};
