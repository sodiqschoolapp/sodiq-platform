# The Sodiq School platform handbook

This handbook says what the platform does: every feature, who may use it, how it works, and what happens in each special case. It is written for the school, not for developers: the owner, the administration, the people who train staff and answer their questions. It describes the platform as it is built and merged, nothing planned and nothing technical.

The owner asked for it on 15 October 2026: "everything about what features exist, how they work, how they behave, what happens in X case, Y case, but not the tech stack."

## The pages

One page per area, in the order a school meets them:

| Page | What it covers |
| --- | --- |
| `01-signing-in-and-roles.md` | Accounts, signing in, passwords and the second step, roles, branches, who may see and do what |
| `02-school-setup.md` | Branches, buildings and rooms, divisions and departments, academic years and quarters, lessons, breaks and day templates, the calendar, subjects and weights, settings |
| `03-people.md` | Staff, vacancies and working hours, students, relatives and parents, Head Teachers, search, exports, the personal data report |
| `04-classes-and-groups.md` | Classes and Tutors, groups, putting students in classes and groups, moves, leaving and returning, moving to another branch, merging two records, the History tab |
| `05-teaching-load-and-timetable.md` | The teaching load, the timetable and its versions, the board, generation, publishing, one-day changes, absences and substitutions, exams |
| `06-journal.md` | Journals, attendance, marks, works and totals, exemptions, locks and unlock requests, closing a quarter |
| `07-lesson-plans.md` | Lesson plans, windows and requests |
| `08-results.md` | Lesson scores, quarter and year results, grades, ratings and reports |
| `09-notices-and-the-log.md` | Notifications, reminders and the audit log |

A page is created by the first task that builds something in its area.

## How each feature is written

Each feature has its own heading on its page, and under it, in this order, the parts that apply:

1. **What it is.** One or two sentences.
2. **Who can use it.** A table: role, what the role may do, and in which branches or for which classes or subjects. Roles not in the table cannot use it.
3. **How it works.** Numbered steps, naming the menu, page, button and field exactly as the screen shows them in English, with the Uzbek words in brackets the first time: Classes and subjects → Classes → **New class** (**Yangi sinf**).
4. **Rules.** One rule per bullet, each one something a person could check on the screen: "A class name is used once per grade and year. «7 Оxford» typed with a Cyrillic О counts as the same name."
5. **What happens if…** A table with two columns, *Case* and *What happens*, for every special case: refusals, dates in the past or future, a person with several roles, another branch, archived records, two people at the same moment.
6. **What the person sees.** The exact words of the important messages and refusals, in English.

## How to write

- Plain words. No technical terms: no database, server, route, API, migration, job, table name, field name or code name. Say "the system refuses" or "the platform keeps", never how.
- Present tense, short sentences, one fact per sentence. "The Tutor sees…", not "The Tutor will be able to see…".
- Exact numbers, dates, limits and names. Examples use the invented test people: Aziz Rahimov, Nilufar Saidova, Bahodir Qodirov, Jasur Karimov, Malika Karimova, Bekzod Aliyev, the classes 7 Oxford, 7 Princeton and 5 Yale. Never a real person.
- Describe what the platform does today. A part that a later task brings is written as one line, "Not built yet: … (task 6.2)", and replaced when that task is merged.
- One rule is described in one place. Another page that needs it links to it.
- Under each feature, an HTML comment lists its sources for the reviewers, invisible on the rendered page: `<!-- Sources: spec 05 (Class), edge/students-classes-groups; tasks 3.1a, 3.1b; #42 answers of 15 October 2026 -->`.

## Role guides

The pages above are the reference: every rule and case once, by feature. On top of them come short role guides in `docs/handbook/roles/`, one per role of `02` (Teacher, Tutor, Head Tutor, Head Teacher, Senior Head Teacher, Academic Vice Principal, Spiritual and Moral Vice Principal, Principal, Super Admin, and the others). Each guide has:

1. **What you can see and do.** One list, taken from the "Who can use it" tables of the reference.
2. **Your work, step by step.** The daily, weekly and quarterly tasks of the role ("Mark attendance", "Ask to unlock a lesson", "Close the quarter") as short numbered steps.
3. **Links** into the reference for every rule and "What happens if…" case. A guide never restates a rule; it points to it.

The guides are written once, by task 9.6, when the features are finished; until then the reference alone is kept.

## Paused

On 16 October 2026 the owner paused the handbook until the release: tasks do not update it, and the pages are written after 25 October 2026 from the finished platform (tasks 3.7 and 9.6, now under "Deferred until after 25 October 2026" in `docs/build-plan.md`). The rest of this file describes how it will be written.

## How it stays true

Every task that adds or changes what a person can see or do updates the handbook pages of that behaviour in its own pull request (`CLAUDE.md`, Definition of done). The spec reviewer checks the pages against the diff. A behaviour without its page, or a page that says something the platform does not do, is a finding like a missing test.

## Languages

The handbook is written in English. The role guides and the Uzbek and Russian versions of the reference and the guides are made from it by task 9.6, before the go-live review. The role guides are for training the staff.
