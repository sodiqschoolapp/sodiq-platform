# Spec index

This folder is the product spec for the Sodiq School platform. It is the single source of truth for what the system must do. It was split from one document on 3 October 2026 (revision 88) so that only the files a task needs are read.

## How to use it

1. Find the task in `docs/build-plan.md`. It names the spec files to read.
2. Read those files in full before planning or writing code. Do not work from memory of them.
3. If two files disagree, the edge-case file wins over the module file, because it is more specific and was written later.
4. If the spec does not answer a question, stop and ask the owner. Do not invent a rule.
5. The spec changes only through the `/spec-change` skill, with the owner's approval. Each change is logged in `docs/spec-changes.md`.

## Module files

| File | Covers |
| --- | --- |
| `01-overview.md` | Priorities, decisions at a glance, the three releases, how data flows |
| `02-roles-and-access.md` | The 15 roles, Head Teachers by subject, Senior Head Teacher, permission rules, accounts and sign-in |
| `03-school-setup.md` | Branches, rooms, divisions, departments, academic year, quarters, calendar, slot types and day templates, grade bands |
| `04-people.md` | Student record, UID sets, close relatives (shown as "Parent"), staff record, movements |
| `05-classes-groups-subjects.md` | Classes (grade and name), groups and splits, subjects, teaching load, language of instruction, grading weights |
| `06-timetable.md` | Model, builder steps, grid editing, auto-generation, rules, several branches, changes after publishing, views, Free now board |
| `07-journal.md` | Layout, entering data, totals, exemptions, calculation rules, locks, closing a quarter, lesson status |
| `08-results-rating-analytics.md` | Student results, rating, analytics, early-warning list, home pages, stipend (Release 2) |
| `09-lesson-plans.md` | Plans, master plans, the window, edit requests, link to the journal, what happens when the timetable changes |
| `10-portal-notifications-release-2.md` | Student and parent portal, sign-in, notifications (Release 2) |
| `11-later-modules.md` | Release 3 modules and what is not planned |
| `12-ux-standards.md` | Page patterns, no lost work, languages, devices, speed targets |
| `13-technology.md` | Stack, structure, security, hosting, running cost |
| `14-quality-plan.md` | Tests and checks required for timetable, journal and the whole system |
| `15-conflicts-resolved.md` | Where the source documents disagreed and what was decided (record) |
| `16-open-questions.md` | Question log. Only question 12 (student UID details) is open |
| `17-sources.md` | Source documents |

## Edge-case files

Each file lists what can happen outside the normal flow and the rule that settles it.

| File | Read together with |
| --- | --- |
| `edge-cases/00-definitions.md` | Every task. Defines "held lesson", "data", "edit period" and other words used everywhere |
| `edge-cases/time-dates-calendar.md` | Setup, timetable, journal |
| `edge-cases/timetable.md` | Timetable |
| `edge-cases/journal.md` | Journal |
| `edge-cases/calculation.md` | Calculation module, results, closing |
| `edge-cases/students-classes-groups.md` | People, classes, transfers |
| `edge-cases/close-relatives.md` | People |
| `edge-cases/exemptions.md` | Journal, calculation |
| `edge-cases/lesson-plans.md` | Lesson plans, journal columns |
| `edge-cases/people-roles-accounts.md` | Roles, sign-in, staff, audit log, personal data |
| `edge-cases/academic-year.md` | Setup, rollover, go-live |
| `edge-cases/system-behaviour.md` | Jobs, releases, failures, exports, monitoring |
| `edge-cases/developer-rules.md` | Every task that touches the database. Lists the database constraints that must exist |

## Reading lists by area

| Area of work | Read |
| --- | --- |
| Foundations, sign-in, roles | `02`, `12`, `13`, `14`, `edge-cases/00-definitions`, `edge-cases/people-roles-accounts`, `edge-cases/developer-rules`, `edge-cases/system-behaviour` |
| School setup | `03`, `edge-cases/time-dates-calendar`, `edge-cases/academic-year` |
| People | `04`, `edge-cases/students-classes-groups`, `edge-cases/close-relatives`, `edge-cases/people-roles-accounts` |
| Classes, groups, subjects, load | `05`, `edge-cases/students-classes-groups`, `edge-cases/timetable` (Structure) |
| Calculation module | `07` (Calculation rules, Exemptions), `08`, `edge-cases/calculation`, `edge-cases/exemptions`, `edge-cases/developer-rules` |
| Timetable | `06`, `03` (slot types, calendar), `edge-cases/timetable`, `edge-cases/time-dates-calendar`, `edge-cases/developer-rules` |
| Journal | `07`, `edge-cases/journal`, `edge-cases/exemptions`, `edge-cases/00-definitions` |
| Lesson plans | `09`, `edge-cases/lesson-plans` |
| Results, closing, reports | `08`, `07` (Closing a quarter), `edge-cases/calculation`, `edge-cases/academic-year` |

## Scope reminder

Build Release 1 only, in the order of `docs/build-plan.md`. Release 2 and Release 3 items appear in the spec so that the data model leaves room for them; they are not built now unless a task says so.
