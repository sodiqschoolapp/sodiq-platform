# Spec change proposal: past marks from before go-live

Requested by the owner, 25 November 2026. Status: **approved by the owner, 25 November 2026, and applied** (`docs/spec-changes.md`).

## 1. Every place that states the rule

The rule being changed: nothing from before a branch's go-live date is in the platform.

| # | File, heading | Current text |
| --- | --- | --- |
| A | `edge-cases/academic-year.md`, "The school goes live in the middle of the year" | "No dated lessons exist before it, and the first timetable version starts on it." … "**Earlier quarters.** Quarters that ended before the start date are marked "not in the system" and left out of the year result…" |
| B | `10-portal-notifications-release-2.md`, What parents see | the table rows Today ("the latest scores (see Grades)"), Homework, Grades ("Each score with the work's name and the lesson date…"), Attendance ("The child's marks by day and lesson.") |
| C | `10-portal-notifications-release-2.md`, The parents' digest, What it holds | "covering what was saved since the parent's previous digest" (would include imported marks, saved after go-live) |
| D | `13-technology.md`, Moving from myss.uz | "Nothing is moved from myss.uz at the start. Students and staff are imported from the system's Excel template (`04`); other imports are added feature by feature, in the formats the school will give." |
| E | `16-open-questions.md`, row 14 | "What should be moved from myss.uz? \| Nothing now. Import is done later, on request." |
| F | `02-roles-and-access.md`, Academic Vice Principal | the list of what the role does (gains the import) |
| G | `edge-cases/developer-rules.md` | no row for where past marks are stored (one is added, like the row for exams) |
| H | `edge-cases/people-roles-accounts.md`, personal data report | "The Super Admin can produce a personal data report per person." (does it include past marks? see decision 8) |

Unchanged: `07` (no rule of the journal or of the calculation changes; past marks are never lessons, cells or works), `08`, `edge-cases/calculation.md`.

## 2. Side effects and what could go wrong

1. **Parents see scores that are not in the average next to them.** On the Grades page of the start quarter, the list shows past scores and the platform's own, with no label, while the average and the quarter result (labelled "from" the start date) use only the platform's own. A parent may add the list up and get a different figure. The owner chose no separate label; the "from" label is the only hint.
2. **Never counted.** The safest way to keep them out of every average, result, report and staff screen is to store them in their own tables, never as lessons, journal cells or works, so no existing query can pick them up by accident. This is the same approach the spec already takes for exams (`edge/developer-rules`, Exams). Proposed as a developer rule (G).
3. **Size.** A branch of 2,000 students, 40 school days and 8 subjects a day is over 600,000 rows. One file of that size makes the preview slow and an all-or-none save heavy. Proposed: at most 50,000 rows a file; a branch imports several files (for example one per class), each its own upload (decision 1).
4. **The go-live date moves.** If the go-live date is later moved earlier, an imported mark could fall on a day the platform holds real lessons. Proposed: such a change is refused until the uploads in the way are withdrawn (decision 6).
5. **The calendar before go-live.** Rows are checked against the calendar's school days, so the days off before go-live must be entered in the calendar first, or rows on them fail.
6. **Exempt marks without an exemption.** A 4 or 5 in the file is shown as exempt; no exemption record is created, and none is needed, since nothing is calculated.
7. **What a row lacks.** A past mark has no teacher, slot or time, only a date and the lesson's number that day; the Attendance page shows it by date, subject and that number.
8. **The stop list.** The task adds routes, so a new permission area for them (stop item 5 on the live system), and new tables only (no existing row changes). The percent uses the existing function of `packages/calc`; no change there is expected.
9. **The assistant.** It acts only through the role's screens and routes, so it can run the import (preview and confirm, as for any import) and never reads past marks otherwise.

## 3. Decided without the owner (proposed; the owner confirms or changes)

1. **File size:** at most 50,000 rows per file.
2. **Name check:** surname and first name compared after removing spelling differences (Oʻ, O', Cyrillic), as the duplicate check of students does; another person under the UID is a problem of the row.
3. **Repeats inside the file:** a lesson (student, date, subject, lesson number) has at most one attendance mark, and a work (the same lesson, kind and title) appears once. The repeat check against earlier uploads also covers a lesson's attendance, not only works.
4. **Decimals:** as in the journal, a point only (7.5), at most two digits after it; an Excel number cell is read as its value. A total that is not a whole number is a problem.
5. **Withdrawal keeps the rows.** A withdrawn upload stays stored with its reason, hidden from parents ("archive, do not delete"). The same file is refused only while an upload of it stands; after withdrawal it may be imported again.
6. **The go-live date:** a change that would put an imported mark on or after the go-live date is refused, naming the uploads to withdraw first.
7. **The student's life:** past marks belong to the student. A merge carries them to the surviving record, a branch move keeps them, and a student who left is not shown in the portal (as today). In the next academic year they stay with their year, like the platform's own marks.
8. **Personal data report (Look first):** it includes past marks, because it is a copy of everything held about a person; this is the one staff output that shows them.
9. **Staff see the upload, not the marks:** the import page lists each upload (file name, who, when, number of rows, standing or withdrawn) and shows the preview while importing. The audit entry records the upload with its row count and the withdrawal with its reason.

## 4. New wording

**New section in `10-portal-notifications-release-2.md`, after "What parents see":**

> ## Past marks from before go-live
>
> A branch that went live in the middle of the year (`edge/academic-year`) can import the attendance, classwork and homework of its lessons before its go-live date, so that parents see them in the portal (owner, 25 November 2026). They are history for parents only: nothing is calculated from them and staff do not see them.
>
> - **The file.** The system's Excel template, downloaded from the import page, with its column headings in Uzbek, Russian and English. One row is one student, one date, one subject: the UID; the student's name, checked against the UID; the date; the subject, by its name in any of the three languages; the lesson, the number of that subject's lesson on that day (1, 2, 3 and so on; empty means 1); the attendance mark (0, 1, 2 or 3, 4 or 5 for exempt, or empty); the classwork title, total and score; the homework title, total and score. A file holds at most 50,000 rows; a branch can import several files.
> - **The rules of a row.** A work's three cells are filled together or left empty. The title is at most 60 characters, the total is a whole number of 1 or more, and the score is from 0 to the total with at most two digits after the decimal point. A second work of one kind in the same lesson is a further row for the same student, date, subject and lesson, with the attendance empty. Homework stands on the date it was given. The date is before the branch's go-live date, in the current academic year, on a school day of the calendar. The student is a student of the branch of the import. An attendance-only subject takes attendance only.
> - **The upload.** By the Super Admin, and by the Academic Vice Principal for their own branch. The upload first shows a preview of every row with its problems. Nothing is saved until every row is clean; confirming checks everything again and saves all rows or none, and the same file is not imported twice while its upload stands. A row that repeats one already imported (the same student, date, subject and lesson, with the same work title, or a second attendance mark) is a problem of the row. The import page lists the uploads: file name, who, when, the number of rows, and whether it stands or was withdrawn.
> - **Withdrawal.** The same roles can withdraw an upload whole, with a reason; its rows are kept, hidden from parents, and a corrected file can be imported again. The upload and the withdrawal are each an entry in the audit log.
> - **What parents see.** On the Grades, Attendance and Homework pages, the imported marks, scores and homework titles stand in the same lists and the same form as the platform's own, with no separate label. The percent of a score comes from `packages/calc`, as for any score. A past mark has no teacher, slot or time: it is shown by date, subject and the lesson's number that day.
> - **Where they never appear.** Averages, quarter and year results (the start quarter stays labelled "from" its start date, and quarters before it stay "not in the system"), the rating, reports, the early-warning list, the Today page's latest scores, the parents' digest, and every staff screen and export. The one exception is the personal data report (`edge/people-roles-accounts`).

**B** `10`, What parents see, table:
- Today: "the latest scores (see Grades)" → "the latest scores saved in the platform (see Grades; never past marks)".
- Homework: "Tasks by the date of the lesson where they were given and by subject, …" gains at the end: "Past homework from before go-live is listed with the rest (Past marks from before go-live)."
- Grades: gains after the first clause: "past scores from before go-live stand in the same list (Past marks from before go-live), and are in no average or result;".
- Attendance: "The child's marks by day and lesson, past marks from before go-live included. An exempt lesson shows as exempt, never as an absence."

**C** `10`, The parents' digest, after "A button opens the portal.":
> Past marks from before go-live are never in a digest.

**A** `edge-cases/academic-year.md`, go-live row: "No dated lessons exist before it, and the first timetable version starts on it." → "No dated lessons exist before it, and the first timetable version starts on it. The marks of its lessons before it can be imported for parents to see, and are never lessons and never counted (`10`, Past marks from before go-live)."

New section at the end of `edge-cases/academic-year.md`:

> ## Past marks from before go-live
>
> | Case | Rule |
> | --- | --- |
> | A whole term of a large branch is several hundred thousand rows. | A file holds at most 50,000 rows. The branch imports several files, for example one per class or per month; each is its own upload, previewed and saved all or none. |
> | The name in the file is spelled differently from the record: Oʻtkir, O'tkir, Ўткир. | Surname and first name are compared after removing spelling differences, as the duplicate check of students does (`edge/students-classes-groups`). Another person under the UID is a problem of the row. |
> | One lesson's attendance stands on two rows, or a work appears twice. | A lesson (student, date, subject, lesson number) has at most one attendance mark, and a work (the same lesson, kind and title) appears once, in the file and across the uploads that stand. Each repeat is a problem of the row. |
> | A score is typed 7,5, or a total 10.5. | As in the journal: a point only, at most two digits after it; an Excel number cell is read as its value. A total that is not a whole number is a problem of the row. |
> | An upload is withdrawn and the same file is imported again. | A withdrawn upload is kept with its reason and hidden from parents. The same file is refused only while an upload of it stands. |
> | The go-live date is changed after past marks were imported. | A past mark always lies before the go-live date: a change that would put one on or after it is refused, naming the uploads to withdraw first. |
> | A student with past marks is merged with another record, moves to another branch, or leaves. | Past marks belong to the student: a merge carries them to the surviving record, a branch move keeps them, and a student who left is not shown in the portal. |
> | The next academic year starts. | Past marks stay with their year, like the platform's own marks of that year. |
> | Days off before go-live are not in the calendar. | A row on a day the calendar does not hold as a school day is a problem; the days off are entered in the calendar first. |

**D** `13-technology.md`, Moving from myss.uz:
> Nothing is moved from myss.uz at the start. Students and staff are imported from the system's Excel template (`04`). A branch that went live in the middle of the year can import the marks of its lessons before go-live, for parents to see (`10`, Past marks from before go-live). Other imports are added feature by feature, in the formats the school will give.

**E** `16-open-questions.md`, row 14 answer:
> Nothing now. Import is done later, on request. On 25 November 2026 the owner added one: the attendance and scores of a branch's lessons before its go-live, for parents only (`10`, Past marks from before go-live).

**F** `02-roles-and-access.md`, Academic Vice Principal, after "Closes quarters.":
> Imports and withdraws the past marks of the branch's lessons before go-live, for parents (`10`).

**G** `edge-cases/developer-rules.md`, a new row after "Exams":
> | Past marks | Marks imported from before go-live are stored in their own tables, each row with its branch and its upload, never as lessons, journal cells or works, so no query that counts, lists or calculates lessons, cells or results sees them. The portal's Grades, Attendance and Homework reads and the personal data report are their only readers. A withdrawn upload's rows are kept and marked withdrawn. |

**H** `edge-cases/people-roles-accounts.md`, personal data report: "The Super Admin can produce a personal data report per person." → "The Super Admin can produce a personal data report per person, past marks from before go-live included."

## 5. After approval

The spec edits, the entry in `docs/spec-changes.md`. The code plan joins the others when the owner says the spec changes are done.
