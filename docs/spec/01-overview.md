# Overview, decisions and scope

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

This is the build spec for the new Sodiq School platform (lms.sodiqschool.uz): one web system for all branches, in Uzbek, Russian and English. The timetable and the class journal are the core and are specified down to the rule; everything else is built around them or after them.

## Decisions at a glance

Where the sources disagree, the file "lms.sodiqschool.uz / Spec / latest" wins. After it come your message of 3 October, the Ziyoly integration notes and tracking list, Texnik topshiriq REV02, and last what the Ziyoly demo and myss.uz do today.

| Topic | Decision |
| --- | --- |
| Priority | Academic department first. Timetable and journal must have no mistakes; they get the deepest rules, tests and database guarantees. |
| Languages | Uzbek, Russian, English. Every screen complete in all three. |
| Scope | All branches in one system. Each user works inside their branch; Super Admin sees all. |
| Roles | 15 user types: the 14 of the main file and the Senior Head Teacher. Principal is view only. |
| Grading | 100-point scale. Each subject has a daily distribution (attendance, classwork, homework) and a quarterly distribution (attendance, classwork, homework, rating exam). |
| Journal columns | Come from the timetable. A teacher never creates a lesson by hand. |
| Removed | Homework debt (qarzdorlik) and the payment debtors list from myss.uz. Finance, admissions, chat, tasks, gamification and surveys are not in the first releases. |
| Taken from Ziyoly | Look and page patterns, role home pages, global search, rooms by floor, the timetable builder with auto-generation, conflict panel and versions, lesson mode for phones. |
| Taken from myss.uz | The journal model: six attendance marks, flexible grading (the teacher sets the total of each work and the system shows a percent), 2–5 bands, subject groups, movement history. |
| Fixed from myss.uz | Slow pages, the very wide always-editable grid, two "active" academic years, pages opening on the wrong year, blank-page crashes. |
| Later | HR, nurse, psychologist, librarian, mobile apps. |

Items marked "proposed" below are my choice where no source decides. They are listed again under Open questions.

## Scope and releases

Release 1 is the academic core and contains everything the timetable and journal need. Nothing in later releases changes how those two work.

| Release | What it contains | Roles that go live |
| --- | --- | --- |
| 1. Academic core | Sign-in, roles and permissions. Branches, buildings, floors, rooms. Divisions and departments. Academic year, quarters, calendar, slot types and day templates. Students, relatives, contracts. Teachers and staff records. Classes, groups, subjects with grading weights. Teaching load. Timetable with auto-generation and grid editing. Journal. Transfers, archive, year rollover. Lesson plans. Rating. Attendance and results analytics. Excel export. Audit log. Imports are added later, feature by feature, in the formats the school gives. | Super Admin, Principal, Academic Vice Principal, Vice Principal for Spiritual and Moral Education, Head Tutor, Tutor, Senior Head Teacher, Head Teacher, Teacher |
| 2. Family and rewards | Student and parent portal (web, phone friendly). Notifications in the app and by SMS. Homework shown to families. Quarterly stipend and scholarship records. Announcements and events. Automatic student UIDs from a pool of free UIDs per grade. Plain-language assistant for timetable changes (optional). | Student, Parent |
| 3. Services | HR, medical office, psychologist, library. iOS and Android apps. Import of marks from TestBor and Mock24. | HR, Nurse, Psychologist, Librarian |
| Not planned | Admissions and CRM, payments and finance, task manager, chat, gamification and shop, surveys. Each can be added later as a module; Texnik topshiriq REV02 already describes them. | — |

Student and parent accounts are created in Release 1 with the student record, so Release 2 only switches their access on.

## How the parts fit

The data flow, in order: 1. school setup, 2. people, 3. classes, subjects and teaching load, 4. timetable, 5. dated lessons, 6. journal, 7. quarter and year results, 8. rating, analytics and reports.

Data is entered once and flows one way. Setup, people and the teaching load feed the timetable; a published timetable produces dated lessons; each dated lesson is one column of a journal; journal entries produce quarter results; results feed rating, analytics and the stipend list. Nothing downstream is typed by hand, so a figure in any report can be traced back to the lesson it came from.
