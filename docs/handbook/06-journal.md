# Journal

Not written yet for most of the journal: the journal grid, attendance, marks, works and totals, exemptions, locks and unlock requests (tasks 6.1a to 8.6) are described by task 9.6. This page holds the parts that task 8.7 added.

## Lesson status

<!-- Sources: spec 07 (Lesson status, Exemptions), edge/journal (Entering, rows 1 to 3 and 15; Locks), edge/00-definitions (Held lesson, Data on a lesson, Expected student, Lock moment); task 8.7, decisions 2, 7 and 8 -->

**What it is.** Every lesson that has been held shows one of four statuses: Not started (**Boshlanmagan**), In progress (**Jarayonda**), Complete (**Toʻldirilgan**) and Locked incomplete (**Toʻldirilmay yopilgan**). The status is worked out each time a page opens, from what is entered.

**Who can use it.** Everyone who may open a journal, the timetable or the teaching home sees the status there. Nobody sets it by hand.

**How it works.**

1. A lesson with nothing entered is **Not started**.
2. As soon as anything is entered (a mark, a number, a total, "not held", or a comment), the lesson is **In progress**.
3. It is **Complete** when every expected student has an attendance mark, and every work of the lesson has its total and a number, or "not graded", for each student marked present or late.
4. When the edit period ends before the lesson is complete, it is **Locked incomplete**. It needs an unlock; while the unlock is open it stays Locked incomplete until the missing entries are made.
5. The status shows in the header of each lesson in the journal, beside the lesson on the teaching home and on the timetable. The teaching home sums up today: "3 of 5 lessons complete".

**Rules.**

- Future, cancelled and unresolved lessons have no status.
- Students marked absent (0) or "did not come to the lesson" (3) are not waited for: their empty number cells do not keep the lesson in progress.
- Exempt students are not waited for.
- A cell opened for a few days after a late move or a shortened exemption is optional: it never changes the status.
- A homework cell of a student who was exempt, or not yet in the class or group, when the homework was given is optional.
- A lesson with no work is complete as soon as attendance is marked.
- Every work of the lesson counts: those of the plan, those added by hand at a lesson with no plan item, and homework carried from an earlier lesson. A work marked "not held" does not count.

**What happens if…**

| Case | What happens |
| --- | --- |
| A mark is changed from absent to present after the numbers were typed | The student's empty cells are waited for again: the lesson can go back to In progress. |
| Numbers are typed before attendance | The lesson stays In progress until attendance is marked. |
| Every student of the lesson is exempt | The lesson is Complete: there is nothing to mark. |
| A total is set and nothing else | The lesson is In progress. |

## Not graded

<!-- Sources: spec 07 (Lesson status), edge/journal (Saving and working together: "All present" and "not graded"; Undo); task 8.7, decision 3 -->

**What it is.** One click sets the empty number cells of the students marked present or late to "not graded". The lesson is then complete, and those cells are left out of the student's average.

**Who can use it.**

| Role | What the role may do | Where |
| --- | --- | --- |
| Teacher, Tutor | Set "not graded" in a lesson they may enter | Own lessons, inside the edit period or an unlock |
| Academic Vice Principal, Super Admin | The same as a correction, with a reason | Every lesson of the branch |

**How it works.**

1. In the journal, open the works of the lesson (the button under the A of the lesson).
2. Press **Not graded** (**Baholanmagan**). The question names how many empty cells will change.
3. Confirm. The answer says how many cells were set, and how many were typed by someone meanwhile and kept.

**Rules.**

- Only empty cells change; a number typed meanwhile is kept and reported.
- A "not graded" cell shows a dash. Typing a number in it replaces it; clearing the cell makes it empty again.
- **Undo** gives the cells back as they were, if nobody changed them since.
- "Not graded" counts in no average, like an empty cell.

## Reminders

<!-- Sources: spec 07 (Reminders); task 8.7, decisions 9 to 13 -->

**What it is.** A panel that lists what a teacher still has to do: lessons with no attendance, works whose numbers are missing, lessons with no topic (graded subjects only), rating exam scores missing in the last two weeks of a quarter, and lessons about to lock.

**Who can use it.** The teacher sees their own reminders on the teaching home, for the branch in use. The journal shows the reminders of that journal, folded under **Reminders**, to the readers of the whole journal and to a teacher of some of its lessons.

**How it works.**

1. Each line names what is missing and the lesson (date, class or group, subject), with **Open** to go to the journal at that date.
2. A lesson counts for the substitute on a day of a substitution, and for the acting teacher of a vacancy. A lesson of a vacancy with no acting teacher counts for nobody.

**Rules.**

- "About to lock" means an incomplete lesson that locks within the next 48 hours.
- Rating exam scores are reminded from 14 days before the quarter's last day to that day. A score that is "pending" (exempt on the exam day) is the Academic Vice Principal's to decide and is not reminded.
- "No topic" means the plan row of the lesson has no item or an empty topic.
- Reminders cover every lesson of the year held so far, also of a quarter that has ended: a lesson of the last week of a quarter locks in the next one.
- Optional cells and exempt students are never reminded.

## Journal discipline

<!-- Sources: spec 07 (Lesson status), 08 (Journal discipline), edge/journal (the Head Tutor sees the Tutors' journal discipline); task 8.7, decisions 1, 6 and 14 with review correction 1 -->

**What it is.** The counts of each teacher over a date range: lessons held, not started, in progress, complete and locked incomplete, lessons with attendance not marked, lessons with no topic, works with scores missing, unplanned works, and entries made after the edit period.

**Who can use it.**

| Role | What the role may do | Where |
| --- | --- | --- |
| Super Admin, Principal, Academic Vice Principal | See every teacher | Own branch |
| Head Teacher | See the lessons of own subjects | Own branch |
| Senior Head Teacher | See the lessons of own subjects | Every branch |
| Head Tutor | See the lessons of the Tutor subjects (Ma'naviyat soati and the Homework slot), read only | Own branch |

**How it works.** Journal → **Journal discipline** (**Jurnal intizomi**). Choose the dates and, if wanted, a department. The table has one row per teacher.

**Rules.**

- At most 92 days, inside one academic year.
- The department filter takes the lessons of that department's subjects.
- "Entries made after the edit period" counts the entries a teacher made under their own unlock. A correction by the Academic Vice Principal, an entry in an optional cell and an entry of an assigned orphan lesson do not count against anyone.
- Not built yet: the report with prepared totals and its export (task 9.3b).

## Orphan lessons

<!-- Sources: edge/journal (Locks: "A teacher leaves the school with incomplete lessons"); task 8.7, decisions 4 and 15 -->

**What it is.** The incomplete lessons of teachers who left the school. The Academic Vice Principal assigns another teacher to complete each one, with a reason.

**Who can use it.**

| Role | What the role may do | Where |
| --- | --- | --- |
| Academic Vice Principal, Super Admin | See the list, assign a teacher, withdraw an assignment | Own branch |
| Principal | See the list | Own branch |

**How it works.**

1. Journal → **Orphan lessons** (**Oʻqituvchisiz darslar**). Open a lesson.
2. Choose the teacher, the number of days (1 to 7) and the reason, and press **Assign**.
3. The assigned teacher enters that lesson as its own teacher would, until 00:00 of the day after the last day. After the edit period the entries are marked "entered after the edit period".
4. **Withdraw** ends the assignment at once.

**Rules.**

- A lesson is listed while it is held, not complete, and counts for a teacher who left the school.
- Only a person working in the branch today can be assigned.
- A new assignment of the same lesson replaces the open one.
- The assigned teacher gets no other right: only that lesson, only until the end of the assignment.
