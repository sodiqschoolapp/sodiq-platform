# No lesson score in the journal, and a red asterisk on every required field

Proposal of 24 November 2026, approved and applied the same day with the row of `15` added from its review, from the owner, in chat: "we don't need daily o'rtacha score for journals. Academic director requested it to be removed because we don't need it", and "for every input based forms, for required inputs put * in red". Apply each section with `/spec-change`, one commit per section, in this order. Where a sentence is quoted as "old", replace it word for word; "remove" takes the whole row or line out. The build-plan edits (not spec) are at the end and go in the same pull request.

## What is removed, and what is not

- **Removed: the lesson score**, the column "Oʻrt / Ср. / Avg" after each lesson's works, and the **daily distribution** of a subject (attendance, classwork, homework) that only it used.
- **Not touched: every result.** The spec already says "The lesson score is for display only and never enters a quarter figure" (`edge/calculation`). The quarter averages, quarter result, grade, year result, rating, early-warning list, reports and the parent portal stay exactly as they are. Task 11.17 proves this with a test: the quarter results of the demo school are the same before and after.

## Needs the owner (stop list)

1. **A change to `packages/calc` (item 4).** The function of the lesson score and its daily weights are taken out of `packages/calc`. No other function of the module changes.
2. **No migration changes existing rows (item 3).** The daily distributions already stored stay in the database untouched and are simply no longer read; dropping them is left for later, if ever.

## Decided in this proposal (the owner confirms or changes them)

- **Calculation rule 3 keeps its number** ("3. There is no lesson score…"), so that references to rules 5 to 11, such as `07`, rule 11 in `CLAUDE.md`, stay right.
- **The tests of the lesson score are removed with it.** This is allowed because the requirement changed (`CLAUDE.md`), never to make code pass; the reason is named in the task's report and on issue #42 (Look first).
- **The subject import template loses its daily-distribution columns.** A file made from the old template is refused as "not the template", as any other file that does not match, and the message says a new template can be downloaded.
- **The red asterisk marks what must be filled.** The red is the danger colour of `docs/design-system.md`, and it also reads in dark mode. A screen reader says "required" in the person's language. Fields without a mark may be left empty, so no "optional" label is added.

---

## 1. `docs/spec/01-overview.md`, section "Decisions at a glance", row "Grading"

Old: "Each subject has a daily distribution (attendance, classwork, homework) and a quarterly distribution (attendance, classwork, homework, rating exam)."
New: "Each subject has a quarterly distribution (attendance, classwork, homework, rating exam). There is no lesson score (owner, 24 November 2026)."

## 2. `docs/spec/05-classes-groups-subjects.md`

Opening table, row "Subject", old: "journal type (graded or attendance only), daily distribution, quarterly distribution,"
New: "journal type (graded or attendance only), quarterly distribution,"

Bullet "Excel import of subjects", old: "and for a graded subject the daily distribution and the quarterly distribution of the branch of the import;"
New: "and for a graded subject the quarterly distribution of the branch of the import;"

Section "Grading weights on a subject", table: remove the row that starts "| Daily | Attendance, classwork, homework | The score of one lesson for one student |".

## 3. `docs/spec/07-journal.md`

Layout table, row "Lessons", old: "the full word on hover), then the lesson score column. Row 3:"
New: "the full word on hover). Row 3:"

Layout table, row "Lesson cells", old: "Attendance mark; for each classwork and each homework, the number typed by the teacher and next to it the percent; lesson score. | The teacher types the attendance mark and the numbers. The system calculates the percents and the lesson score. |"
New: "Attendance mark; for each classwork and each homework, the number typed by the teacher and next to it the percent. | The teacher types the attendance mark and the numbers. The system calculates the percents. |"

Table of short labels: remove the row "| Lesson score | Oʻrt | Ср. | Avg |".

Section "Calculation rules", rule 3: replace the whole rule, which starts "3. Lesson score = the subject's daily distribution applied to", with:
"3. There is no lesson score (owner, 24 November 2026). A lesson's attendance and works count only in the quarter averages of rules 5 and 6. This rule keeps its number so that the numbers of the rules after it do not change."

## 4. Edge-case files

`docs/spec/edge-cases/calculation.md`: remove the row that starts "| The lesson score of a lesson where one student has no classwork number".

`docs/spec/edge-cases/calculation.md`, row "Ma'naviyat soati and the Homework slot.", old: "Attendance-only subjects have no weights, no lesson score, no result and no grade."
New: "Attendance-only subjects have no weights, no result and no grade."

`docs/spec/edge-cases/journal.md`, row "A teacher wants two graded classworks in one lesson, or gives three homeworks and no classwork.", old: "Each counts once in the quarter averages; the lesson score takes the mean of each kind (Calculation rules, rule 3)."
New: "Each counts once in the quarter averages."

`docs/spec/edge-cases/academic-year.md`, row "The timetable is published on 1 September while a subject has no weights.", old: "if it is graded, its daily distribution and its quarterly distribution for each quarter the version touches."
New: "if it is graded, its quarterly distribution for each quarter the version touches."

`docs/spec/16-open-questions.md`, question 4, old: "| Set in the settings of each subject. No system default. | Decided |"
New: "| Set in the settings of each subject. No system default. Removed on 24 November 2026: there is no daily distribution and no lesson score. | Decided |"

`docs/spec/15-conflicts-resolved.md`, row "Grading weights", resolution, old: "Daily and quarterly distributions per subject, the quarterly one set for each quarter."
New: "A quarterly distribution per subject, set for each quarter. The daily distribution was removed on 24 November 2026: there is no lesson score."
(Added from the review of pull request #380, correction 1.)

## 5. `docs/spec/12-ux-standards.md`, section "No lost work"

Add this bullet after the bullet "Forms check each field as it is typed and say in plain words what to fix.":

- A field that must be filled is marked with a red asterisk (*) after its label, on every form and in every language, and a screen reader announces it as required. A field without the mark may be left empty (owner, 24 November 2026).

---

## Build-plan edits (not spec)

Two tasks after 11.16, above the gate of 15 November:

- **11.17**: the lesson score and the daily distribution removed.
- **11.18**: the red asterisk on required fields.

Their text is in `docs/build-plan.md` in this pull request.
