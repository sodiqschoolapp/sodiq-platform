# Journal

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

There is one journal for each class or group and subject in an academic year. Its columns are the dated lessons from the timetable, and all results are calculated by one set of rules written below.

## Opening a journal

- From the teacher's timetable: clicking a lesson opens the journal already scrolled sideways to that date. Opened any other way, it scrolls to the lesson closest to today.
- From the Journals page: tabs Classes and Groups, then the subject.
- Header, in this order: "Sinf jurnali", then Class · Subject · Quarter · Month, then "Teacher: name".
- Selectors: class or group, subject, academic year, quarter, month. Student search. Filter.

## Layout

| Part | Content | Behaviour |
| --- | --- | --- |
| Student list | Number, surname and name in alphabetical order, UID. | Fixed on the left. Filled by the system. |
| Quarter results | Attendance average, classwork average, homework average, rating exam (rating subjects only), quarter result, grade 2–5. | Fixed next to the names. Calculated by the system; a switch shows the same figures for the selected month. |
| Lessons | One block per dated lesson. Row 1: date, weekday, slot. Row 2: A, then CW and HW with their titles where the lesson has them, then AVG. Row 3: "all present" button; under classwork and under homework, the label "Soni" and the total set by the teacher (for example 30, 5 or 100). A lesson with no classwork and no homework is one narrow attendance column. | Scrolls sideways. Cancelled lessons are grey with the reason. |
| Lesson cells | Attendance mark; for classwork and for homework, the number typed by the teacher and next to it the percent; lesson score. | The teacher types the attendance mark and the numbers. The system calculates the percents and the lesson score. |
| Bottom row | Class or group averages: attendance, classwork, homework, rating exam, quarter result. | Calculated. |
| Legend | Attendance marks, grade bands, and the weights in force for this subject and quarter. | Always visible under the grid. |

Students who left or moved are shown in a folded section at the bottom with their data intact.

## Entering data

| Mark | Meaning |
| --- | --- |
| 1 | Present |
| 0 | Absent from school |
| 2 | Late |
| 3 | At school but did not come to the lesson |
| 4 | Temporarily exempt. Set by the system from an exemption; the teacher cannot type it. |
| 5 | Fully exempt. Set by the system from an exemption; the teacher cannot type it. |

- **Attendance.** "All present" marks 1 for every student who is not yet marked and not exempt; the teacher then types the exceptions: 0, 2 or 3. This takes seconds.
- **Classwork and homework.** The columns come from the lesson plan, so a lesson shows only the works it really has. The teacher sets the total of a work, then types a number for each student. The system shows the percent next to the number. The rules are under "The total" below. In an extra lesson, or a lesson held while its plan item is missing, the teacher can add one classwork and one "homework given" by hand. These are the only columns that do not come from the plan.
- **Homework column.** The homework numbers in a lesson's column are for the homework checked at that lesson, which is the task given at the previous lesson. The column exists only when the previous lesson's plan item has a homework; an empty homework column is never shown. So the first lesson of the year has none, and neither does a lesson after one where no homework was given. Homework given at the last lesson of a quarter is checked, and counted, in the next quarter.
- **Topic.** Taken from the lesson plan and read only in the journal. Only an extra lesson has a topic typed here.
- **Rating exam.** One score from 0 to 100 per student per quarter, only in rating subjects.
- **Comments.** A comment can be attached to any attendance mark or score, and a general note to a student for a lesson. Each comment is either "staff only" or "visible to parents".
- **Saving.** Every cell saves by itself and shows a saved sign. There is no Save button. If the connection drops, entries wait on the device and are sent when it returns; the page warns before closing with unsent entries.
- **Keyboard.** Arrows, Tab and Enter move between cells; digits type; a key opens the comment.
- **Lesson mode.** On a phone, one lesson is shown at a time as a list of students with large buttons: attendance, then scores, then homework.

## The total: one flexible way to grade

Every classwork and homework has a total, set by the teacher in the column header. The teacher types a number for each student and the system turns it into a percent of the total. The school does not prescribe a scale: each teacher chooses for each work, and every choice ends as a percent.

| The teacher wants to | Sets the total to | Types for a student | System shows |
| --- | --- | --- | --- |
| Count completed questions | 30, the number of questions given | 12 | 40% |
| Grade on a 5 scale | 5 | 4 | 80% |
| Grade in percent | 100 | 85 | 85% |

- The total is a whole number, 1 or more. Numbers cannot be typed for a work until its total is set.
- The number typed is from 0 up to the total. A number above the total is refused.
- The number typed is a whole number. Decimals are not accepted.
- The percent is shown as a whole number: 13 out of 30 shows 43%. The exact value is kept and used in every average.
- Each work has its own total. A teacher can use 30 for one homework and 5 for the next. The last total the teacher used in that journal is offered for the next work.
- The teacher can change a total inside the edit period. All percents of that work are recalculated at once. If a number already typed is above the new total, the change is refused and those students are listed.
- Only the percent goes into averages, results, rating and reports. The number and the total stay visible in the journal and in the cell history.

## Exemptions

An exemption is granted by the Academic Vice Principal; it is not a mark the teacher chooses. While it lasts, the student is out of the journal: their cells are closed, and the teacher works only with the students who are expected in the lesson.

| Field | Notes |
| --- | --- |
| Student | One student per exemption. |
| Kind | Temporary: from a date to a date. Full: from a date to the end of the academic year, or until cancelled. |
| Scope | All subjects, or chosen subjects (for example physical education only). |
| Dates | Whole days, or chosen lesson slots of one day: for example a competition in the afternoon, or a student who falls ill and is allowed to leave after the third lesson. |
| Reason and document | A reason is required. A file such as a medical certificate can be attached. |
| Granted by | The Academic Vice Principal of the branch, and the Super Admin, who can do everything any role can. No other role can create, change or request an exemption in the platform. |

In the journal:

- Cells of exempt lessons show mark 4 (temporary) or 5 (full), set by the system, and are closed. The teacher types only 0, 1, 2 and 3.
- "All present" skips exempt students. Reminders about missing attendance or missing numbers do not count them.
- A student who is exempt for the whole month on screen is moved to a folded "Exempt" section at the bottom, with the dates. A student exempt for part of the month stays in the list, with the closed cells grey.
- The teacher sees the kind and the dates, not the reason or the document.
- The exemption belongs to the student, so it stays in force through a class or group transfer.

### Effect on totals

One rule covers every figure: a student is measured only on the lessons they were expected at.

| Figure | Effect of an exemption |
| --- | --- |
| Student's attendance, classwork and homework averages | Exempt lessons, and works given in them, are left out. |
| Quarter result | Calculated from the remaining lessons. If none remain, the result is "Exempt": no number and no grade. If fewer than one third of the quarter's lessons remain, the result is calculated and flagged with the count, for example "based on 8 of 40 lessons". When closing the quarter, the Academic Vice Principal decides each flagged case: keep the number, or set "Exempt". The quarter cannot be closed while a flagged result is undecided. |
| Rating exam | If the exemption covers the exam date, the student is exempt from the exam (that part is left out and the other weights are scaled up), or sits it later and the score is entered then. |
| Year result | The mean of the quarters that have a result. |
| Class and group averages, subject mastery | Exempt lessons and "Exempt" results are not counted. |
| Rating | In one subject, a student with "Exempt" is not ranked. Across subjects, the mean covers the subjects that have a result, and the student is marked as having fewer subjects. |
| Stipend list | A candidate with an "Exempt" or flagged result is marked for the Super Admin's decision. |
| Attendance reports and daily percent | Exempt is its own category. It is never counted as absent, and exempt students are taken out of the number expected that day. |
| Journal discipline report | Exempt cells do not count as unmarked. |
| Notices to parents (Release 2) | No absence notice is sent for an exempt lesson. |

### Problem cases

| Case | Solution |
| --- | --- |
| The exemption is entered after the fact, for example a certificate arrives a week later. | Before saving, the system lists the lessons in the range that already hold data. Absent, skipped and empty cells become exempt automatically. Each lesson with a "present" or "late" mark, or any number, needs a choice by the Academic Vice Principal: leave it as attended (the exemption skips it) or exempt it and clear the numbers. Earlier values stay in the cell history. |
| The student returns early, or the exemption must be longer. | The Academic Vice Principal changes the end date. Cells open or close from that date. |
| Two exemptions would overlap. | Refused only when both cover all subjects, or both name the same subject. A year-long exemption from one subject and a short all-subjects exemption can exist together. The system offers to extend an existing one where that is what is meant. |
| The dates fall in a closed quarter. | The part inside a closed quarter is refused until that quarter is reopened, because final results would change. The part in an open quarter is applied. |
| A teacher finds a student missing for a reason that deserves an exemption. | The teacher marks what happened (absent). When the exemption is granted, the mark changes to exempt automatically. |
| An exempt student takes part in the lesson anyway. | Nothing is recorded. If the student should be graded again, the exemption is ended from that date. |
| Exemptions are used too freely. | An Exemptions page lists all of them with filters (class, kind, subject, in force, ending this week), each with its reason, document and who granted it. Every change is in the audit log. |
| An exemption ends. | Cells open by themselves from the next day. The student's Tutor and teachers see "back from exemption" on that day. |
| A student leaves during the day for a competition, or falls ill and is allowed to go home. | The Academic Vice Principal exempts the remaining lesson slots of that day. Lessons already held keep their marks and numbers. |

## Calculation rules

1. Attendance value of a lesson: present 100, late 50, skipped lesson 0, absent 0. The values for late and skipped can be changed in settings. Exempt lessons (marks 4 and 5, set by the system from exemptions) are left out of all that student's averages.
2. Classwork percent = number typed ÷ total of that work × 100. Homework percent is calculated the same way. Whatever total the teacher chose, only this percent is used from here on.
3. Lesson score (AVG) = the subject's daily distribution applied to the attendance value, classwork score and homework score of that lesson. If the lesson had no classwork or no homework, that part is left out and the other weights are scaled up to 100.
4. An empty score is not counted. For work not done the teacher types 0. Reminders show lessons where some present students have no score.
5. Quarter attendance average = the mean of the attendance values of all the student's lessons held in the quarter, without exempt and cancelled lessons.
6. Quarter classwork average = the mean of the student's classwork scores in the quarter; each work counts equally. The homework average is calculated the same way.
7. Quarter result = attendance average × its weight + classwork average × its weight + homework average × its weight + rating exam × its weight, using the weights of that subject and quarter.
8. While a part has no data, the result is shown as provisional: calculated on the parts that exist, scaled to 100, and marked. A quarter cannot be closed in a rating subject until every student has a rating exam score, "did not sit" (counts 0) or "exempt" (the part is left out).
9. Grade = the band of the rounded quarter result: 0–49 is 2, 50–66 is 3, 67–83 is 4, 84–100 is 5.
10. Numbers are kept exact and rounded only for display: to a whole number, halves up.
11. Year result = the mean of the four quarter results. A quarter whose result is "Exempt" is left out.

Worked example with weights 20 · 20 · 20 · 40: attendance 100, classwork 50, homework 30, rating exam 49 give 20 + 10 + 6 + 19.6 = 55.6, shown as 56, grade 3. This matches a real row in last year's journal on myss.uz.

## Editing rules and locks

- Attendance and scores can be entered from the lesson's start time, not before.
- A teacher can change a lesson for 7 days after it; the number is a setting of the Academic Vice Principal. After that the lesson is locked and can be unlocked for a limited time by the Head Teacher or Academic Vice Principal.
- The Academic Vice Principal closes a quarter, using the checklist described under Closing a quarter. Journals of that quarter become read only and the results are stored as final. Reopening needs a reason and is logged.
- Every cell keeps its history: old value, new value, who and when. It opens from the cell.
- Two people can work in one journal. Changes appear live for both. If both change the same cell, the second person is told and sees both values.
- A student's cells start on the date they joined the class or group and end on the date they left. Other cells are closed.

## Closing a quarter

The Academic Vice Principal closes a quarter from one checklist screen. It lists everything unfinished, grouped by teacher and class, with a link to each item and a "remind" button that sends the list to the teachers concerned.

| Item | Effect |
| --- | --- |
| A rating exam entry is missing: no score, "did not sit" or "exempt" | Blocks closing |
| A result flagged "based on few lessons" is undecided | Blocks closing |
| A graded subject has weights that do not total 100 for this quarter | Blocks closing |
| A lesson is temporarily unlocked for editing | Blocks closing until it locks again |
| Lessons with no attendance | Warning |
| Planned works with numbers missing | Warning |
| Lesson plans incomplete, or items "not covered" | Warning |
| Students with no result in a subject and no exemption | Warning |

- With no blocking item left, the quarter can be closed. Warnings must be acknowledged; they are stored with the closing record.
- A quarter cannot be closed before its last day. The checklist opens two weeks earlier so problems can be fixed in time.
- Closing is never automatic. After the last day the Academic Vice Principal is reminded until the quarter is closed.
- The whole branch is closed in one step.
- Homework given at the last lesson of the quarter is not an open item; it belongs to the next quarter.

## Transfers

Results follow the student. The quarter result in a subject uses all of the student's lessons in that subject during the quarter, from the old and the new class or group. The new journal shows the carried-in averages with a marker; the old journal keeps the student in the folded section.

## Reminders

A panel on the journal and on the teacher home page lists: lessons with no attendance, planned works whose numbers are missing, lessons with no topic (graded subjects only), rating exam scores missing in the last two weeks of a quarter, and lessons about to lock.

## Lesson status

Every lesson that has been held shows a status, on the teacher's home page, on the timetable and in the journal header. The home page sums it up, for example "3 of 5 lessons complete".

| Status | Meaning |
| --- | --- |
| Not started | The lesson was held and nothing is entered. |
| In progress | Attendance is marked, but a planned work still lacks its total or some numbers. |
| Complete | Attendance is marked for every expected student, and every planned work is graded or marked "not held". |
| Locked incomplete | The edit period ended before the lesson was complete. It needs an unlock. |

- A lesson with no classwork and no homework is complete as soon as attendance is marked.
- Exempt and absent students are not waited for. A present student left without a number keeps the lesson in progress; the teacher can set those cells to "not graded" in one click, which completes the lesson and leaves them out of the average.
- Future and cancelled lessons have no status and are not counted.
- A substituted lesson counts for the substitute on that day.
- Head Teachers and the Academic Vice Principal see the same counts per teacher; they feed the journal discipline report.

## Who can do what

| Role | Journal access |
| --- | --- |
| Teacher | Enters and edits in own journals inside the edit period. |
| Substitute teacher | Enters for the substituted lesson only. |
| Head Teacher, Senior Head Teacher | View all journals of their subjects, a Head Teacher in own branch and a Senior Head Teacher in every branch; unlock lessons. |
| Academic Vice Principal | Views all journals; corrects with a reason; unlocks; grants exemptions; closes quarters. |
| Principal, Vice Principal for Spiritual and Moral Education, Head Tutor | View only (the last two see attendance). |
| Tutor | Views journals of own class. Enters attendance in own Ma'naviyat soati and Homework slot journals. |
| Student, Parent | Own results in the portal (Release 2). |

Export to Excel and PDF, and print, for a month or a quarter.
