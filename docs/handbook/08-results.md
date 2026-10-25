# Results

This page holds the parts that tasks 9.1 to 9.2b added. Reopening a quarter, the nightly check, ratings, the results table and subject mastery are not built yet (tasks 9.2c to 9.4).

## A student's results and attendance

<!-- Sources: spec 08 (Student results), spec 04 (Profile tabs), spec 07 (Calculation rules, Effect on totals, Transfers), edge/calculation, edge/academic-year (start quarter), edge/00-definitions (Result states, Held lesson); task 9.1, decisions 1, 4, 6, 8, 9 and 10 -->

**What it is.** A student's profile has a **Results** (**Natijalar**) tab and an **Attendance** (**Davomat**) tab. Results shows, for each subject and quarter, the attendance average, the classwork average, the homework average, the rating exam, the quarter result and the grade. Attendance shows the attendance average of each subject with the count of each mark. Every figure is the journal's own: nothing is typed twice.

**Who can use it.**

| Role | Results | Attendance | Which students and subjects |
| --- | --- | --- | --- |
| Super Admin, Principal, Academic Vice Principal | Yes | Yes | Every student and subject of the branch |
| Head Teacher, Senior Head Teacher | Yes | Yes | The students whose profile they open, own subjects only |
| Tutor | Yes | Yes | Own class, every subject (a group subject too, for the students of own class) |
| Teacher | Yes | Yes | The students taught, the subjects of own journals only |
| Head Tutor, Vice Principal for Spiritual and Moral Education | No | Yes | Every student of the branch |

A subject the person may not read is not shown at all. A tab with nothing the person may read is not offered.

**How it works.**

1. People → Students, open a student, choose **Results** or **Attendance**.
2. Choose the quarter. With more than one academic year, choose the year too.
3. Click any figure: a window lists the lessons behind it, with the date, the class or group, the mark and what it counts, and each classwork and homework with its number, its total and its percent. The result shows every part, and the rating exam entry.

**Rules.**

- The figures follow the student across classes and groups: a student who moved in week 6 sees the lessons of both, each named with its class or group.
- A result shows its state: a number, "Exempt", "Not assessed" or "No result" (nothing was entered). Only a number has a grade.
- "provisional" is shown while a part with a weight has no data yet; "left out" names the parts that had none.
- "based on 8 of 40 lessons" is shown on a result with fewer than one third of the lessons, and on a result at leaving.
- The flags the Academic Vice Principal decides at closing (few lessons, attendance alone, left the subject) are shown on the result until then.
- In the quarter the branch started using the platform, the result says "from" and the date. A quarter that ended before that date says "Not in the system".
- The year result is shown once the academic year is closed: the mean of the quarter results as shown, rounded once more, "based on 3 of 4 quarters" when a quarter has no number. A quarter "Not in the system" is left out.
- A subject that is attendance only in a quarter is in Attendance for that quarter, not in Results.

**What happens if…**

| Case | What happens |
| --- | --- |
| The subject has no held lesson yet in the quarter | The subject is not listed for that quarter. |
| A Teacher opens a student taught in two subjects, one of them by another teacher | Only the Teacher's own subject is listed. |
| A Tutor opens a student of another class | The profile is refused, as any record of another class. |
| The student left the school | The results up to the last day are shown, labelled "result at leaving". |

## Changing weights or the late and skipped values

<!-- Sources: edge/calculation ("Quarterly weights are changed in week 7", "The value of 'late' is changed from 50 to 75"), spec 05 (weights); task 9.1, decisions 2, 3, 5 and 11 -->

**What it is.** A change of a quarter's weights, of the copy of quarter 1 to the other quarters, or of a quarter's late and skipped values first shows how many grades change in each journal and asks for a reason.

**Who can use it.** The people who may already change these values: weights in Setup → Subjects, late and skipped values in Setup → Settings.

**How it works.**

1. Change the values and press **Save**.
2. When the change alters values already stored, a window "This change alters results" lists each journal whose grades change, with the number of grades, and asks for the **Reason** (**Sabab**).
3. **Save the change** saves it with the reason; **Back** keeps what was typed and saves nothing.

**Rules.**

- Setting a quarter's weights for the first time, and a save that changes nothing, ask no reason.
- A quarter that has not started lists no journal, but a change of stored values still asks its reason.
- The teachers of the subject's journals in the quarter are told of a weights change, with the reason. A change of late and skipped values tells nobody.
- The journal legend shows "changed on" with the date of the last weights change.

**What the person sees.** Without a reason: "This change alters stored results. Give a reason for it."

## The closing checklist

<!-- Sources: spec 07 (Closing a quarter; Exemptions, Effect on totals), edge/journal (Closing and reopening), edge/calculation; task 9.2a, pull request #229, decisions 1 to 13 -->

**What it is.** One page that lists everything still unfinished in a quarter, before the quarter is closed: what blocks closing, and what is only a warning. The Academic Vice Principal decides here the results that are flagged.

**Who can use it.** The Academic Vice Principal and the Super Admin decide, end plan periods and remind teachers; the Principal reads it. Open it from Journal → **Closing checklist**.

**How it works.**

1. Choose the quarter. The list opens two weeks before the quarter's last day; before that the page says on which day it opens.
2. Each line names the item, whether it blocks closing, the teacher, the class or group and the subject. Open a line to see its students or lessons and a link to the journal.
3. A flagged result ("few lessons", "attendance only", "left the subject") is decided per student with **Keep the number**, **Exempt** or **Not assessed**, or for the whole journal at once.
4. **Remind teachers** sends each teacher concerned a notice with their own unfinished items.
5. **End plan periods** ends every open plan editing period of the quarter.

**Rules.**

- Blocking: a rating exam entry missing (also "exempt on the exam day, pending"), a flagged result undecided, a decision that no longer fits the data ("decision outdated"), a subject with no weights for the quarter, a lesson unlocked or an edit period extended, lessons still inside the edit period, open plan editing periods.
- Warnings: lessons with no attendance, planned works with numbers missing, lesson plans incomplete or items not covered, students with no result and no exemption, a part with a weight and no data in the whole journal, a journal with no teacher.
- "Exempt" is offered only when "few lessons" is the one flag and an exemption explains it.
- A decision shows at once in the journal, the student's results and the files: "Not assessed" and a decided "Exempt" have no number and are left out of the class averages.
- A student who left the school or the branch is not on the list.
- The quarter is closed from this page, from its last day (see Closing a quarter).

**What the person sees.** When the data changed since the list was read: "This result is not flagged any more, so there is nothing to decide. Reload the checklist."

## Closing a quarter

<!-- Sources: spec 07 (Editing rules and locks; Closing a quarter; Exemptions, Problem cases), edge/journal (Closing and reopening), edge/academic-year (Start quarter; names as they were), edge/calculation; task 9.2b, pull request #230 -->

**What it is.** The close of a quarter for the whole branch in one step. From then on the quarter's journals are read only and every result is kept as final, as it was on the day of the close.

**Who can use it.** The Academic Vice Principal and the Super Admin, from the closing checklist.

**How it works.**

1. On the quarter's last day or later, with nothing left that blocks, press **Close the quarter** on the closing checklist.
2. Tick that you have looked at the warnings: they are kept with the close.
3. When lessons are still inside their edit period, or a lesson is unlocked, tick **Lock now and close**: those lessons lock at the moment of the close, and their teachers get a notice.
4. In the branch's start quarter, choose **Keep the platform results** or **Not official**.
5. The page then shows when the quarter was closed, by whom, the version and the warnings kept.

**Rules.**

- Quarters close in order: quarter 2 waits until quarter 1 is closed.
- A closed quarter takes no mark, number, comment, correction, unlock, reason of absence, plan change, cancel of a lesson, forced delete, move of a student, leaving or return dated in it, and no change of its weights, its late and skipped values or its dates.
- An exemption that reaches into a closed quarter is applied to the days after it only; the days in the closed quarter stay as they are.
- Plan requests still waiting become void.
- The student's results show a closed quarter as it was kept, and the year result once quarter 4 is closed. A "not official" start quarter is left out of the year result.
- A journal file of a closed quarter says "Final" with the closing date and version, and keeps the class, subject and teacher names of the day of the close.
- If anything fails during the close, the quarter stays open and nothing is kept.
- A closed quarter can be reopened (see Reopening a quarter).

**What the person sees.** A save in a closed quarter: "This quarter is closed: its journals and results are final, so this change is not made."

## Reopening a quarter

<!-- Sources: spec 07 (Editing rules and locks: "Reopening needs a reason and is logged"), edge/journal (Closing and reopening), edge/exemptions (The range starts in a closed quarter), edge/calculation (A bug is found after results were closed and exported); task 9.2c, pull request #231 -->

**What it is.** Opening a closed quarter again for a few days, to fix a mistake, for the whole branch or for one journal. The results kept at the close stay kept; closing again keeps a new version beside them.

**Who can use it.** The Academic Vice Principal and the Super Admin, from the closing checklist of the closed quarter.

**How it works.**

1. Press **Reopen**, choose the whole branch or one journal, the number of days (1 to 14) and write the reason.
2. While it is reopened, lessons stay locked: only the Academic Vice Principal's corrections and unlocks approved from then on change the journal.
3. The checklist lists every result that changed since the close, with what it was and what it is now.
4. When the days end, entries stop again; the decisions of the checklist and the close stay possible.
5. Close again: the whole branch with **Close the quarter**, a reopened journal with **Close again** in its panel. Each close keeps a new version of the results; the earlier one stays.

**Rules.**

- A journal reopened opens that journal only; the whole branch reopened opens the quarter for every change a closed quarter refuses, except its late and skipped values and its dates.
- An exemption reaching into a reopened quarter is applied there only when every journal it reaches is reopened, or the whole branch.
- One reopening at a time for a journal, and none of the whole branch while a journal is reopened.
- A closed year is never reopened.
- The results of a reopened journal are shown as they are now, provisional, until it is closed again.

## Recalculate and compare, and the nightly check

<!-- Sources: edge/calculation (A bug is found after results were closed and exported), edge/system-behaviour (The nightly check); task 9.2c, pull request #231 -->

**What it is.** Two checks that the kept results are right. "Recalculate and compare" on the closing checklist of a closed quarter lists every kept result the current calculation would give otherwise; nothing changes. Every night the platform also checks each branch.

**Who can use it.** Everyone who reads the closing checklist sees the list; only the Super Admin applies it.

**How it works.**

1. Press **Recalculate and compare** on a closed quarter.
2. The Super Admin may **Apply with a reason**: a new version of those results is kept, the old ones stay, and the teachers of the journals concerned get a notice.
3. Each night at 02:00 the check compares every mark with its history and every kept result with the calculation and with its marks. A difference is shown on the checklist, blocks closing that journal, and the Super Admins get a notice; the next night's check clears it once it is repaired. A night without a check also sends the Super Admins a notice.

**Rules.**

- The Academic Vice Principal is reminded each morning of a quarter whose last day has passed and that is not closed.
- Teachers are reminded three days before their lesson plan window ends and on its last day when the plan is incomplete; the Academic Vice Principal daily when no window is open 14 days before a quarter; a teacher of a prepared edit request on days 1, 3 and 7, then weekly; a teacher of a lesson that locks within 48 hours with data missing, once.
- The kept data of a lesson deleted for good is removed 30 days after the delete, and a summary stays in the audit log.
