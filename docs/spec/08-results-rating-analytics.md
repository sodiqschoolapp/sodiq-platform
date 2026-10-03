# Results, rating, analytics and stipend

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

Everything in this section reads from the journal. Nothing is typed twice, and every figure is produced by the same calculation rules as the journal.

## Student results

A student's page shows, for each subject and quarter: attendance average, classwork average, homework average, rating exam, quarter result and grade. Clicking a figure opens the lessons behind it. The year result is shown when the fourth quarter is closed.

## Rating

| Rating | How it is built | Who sees it |
| --- | --- | --- |
| Students in a class or group, for one subject | Ordered by quarter result. | Teacher of the subject, Head Teacher, Tutor of the class, management. |
| Students in a class, all subjects | Ordered by the mean of quarter results across subjects. | Tutor, Head Tutor, management. |
| Classes in a grade and in the branch | Ordered by the mean result of their students. | Management. |
| Own position | The student's own place and the class average, without other students' names. | Student and parent (Release 2). |

Students with equal results share a place. During a quarter the rating is marked provisional.

## Analytics in Release 1

| Report | Content | Filters |
| --- | --- | --- |
| Attendance | Present, absent, late, skipped, exempt and unmarked, as counts and percent. Daily attendance of a class as a percent. | Date range, branch, grade, class, subject, teacher, period of the day. |
| Results table | Each student against each subject for a quarter, with result and grade. | Class, quarter. Export to Excel. |
| Subject mastery | Share of students in each grade band for a subject. | Grade, class, teacher, quarter. |
| Journal discipline | For each teacher: lessons held, lessons with attendance not marked, lessons with no topic (graded subjects only), works with scores missing, unplanned works, entries made after the edit period. | Department, date range. |
| Timetable load | Hours per teacher against planned load, room use, free periods. | Branch, department, week. |

Every report opens in under 2 seconds. Totals are prepared in the background when journal data changes, so no report reads the whole journal at the moment it is opened.

## Early-warning list

A list of students who need attention while there is still time in the quarter to act.

| A student is listed when | Threshold (default; the Academic Vice Principal can change it) |
| --- | --- |
| The provisional quarter result in a subject is low | Below 50 |
| The result in a subject has dropped | 15 points lower than four weeks ago, or than the previous quarter |
| Attendance is low | Below 80 percent in the quarter, or three absences in a row |

- **Who sees it.** A teacher for own journals; a Tutor for own class in all subjects; a Head Teacher for own subjects; a Senior Head Teacher for own subjects in every branch; the Head Tutor and the Vice Principal for Spiritual and Moral Education for attendance; the Academic Vice Principal and Principal for the branch.
- **Each entry** shows the reason, the figures and the trend, with a link to the journal.
- **Not too early.** A subject is judged only after five graded works in the quarter, so one bad mark in the first week lists nobody.
- **Exemptions.** Exempt lessons are left out, and a result flagged "based on few lessons" is not listed as a drop.
- **Transfers.** A transferred student is judged on their own results, which follow them.
- **Handled.** A Tutor or teacher can add a staff-only note ("spoke to the parents") and mark the entry as handled. It returns only if the figures get worse.
- **No automatic message to parents.** The list is for staff.

## Home pages by role

| Role | First screen |
| --- | --- |
| Teacher, Head Teacher, Senior Head Teacher | Today's lessons with their status ("3 of 5 complete"), reminders, quick entry to each journal, early-warning list for own journals. A Head Teacher and a Senior Head Teacher also see the requests waiting for them. |
| Tutor | Own class: today's timetable, who is absent now, attendance percent for the day and week, early-warning list for the class. |
| Head Tutor, Vice Principal for Spiritual and Moral Education | Attendance of all classes today, classes below a set percent. |
| Academic Vice Principal | Lessons today and their status, substitutions needed, the free now board, timetable conflicts, quarter progress and the closing checklist, early-warning list for the branch. |
| Principal, Super Admin | Branch summary: students, staff, attendance today, results by grade. |

## Quarterly stipend (Release 2)

The stipend is a cash reward for students who studied well in a quarter. It is separate from the scholarship, which is a discount recorded on the student's profile.

1. The Super Admin sets the rule for the academic year: who qualifies and the amounts.
2. After a quarter is closed, the system makes the list of students who qualify, with the figures that qualified them.
3. The Super Admin reviews the list, can remove or add a student with a reason, and confirms.
4. Each award is written to the student's stipend history: quarter, amount, date, who confirmed.

The platform records awards. It does not make payments.

The scholarship is stored on the profile as type and amount, with the date it was given. Only the Super Admin and Academic Vice Principal edit it.
