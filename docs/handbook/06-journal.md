# Journal

Not written yet for most of the journal: the journal grid, attendance, marks, works and totals, exemptions, locks and unlock requests (tasks 6.1a to 8.6) have no page here yet; where they are written is the owner's to decide (issue #42). This page holds the parts that task 8.7 added.

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
- Rating exam scores are reminded in the last 14 days of the quarter, its last day included. A score that is "pending" (exempt on the exam day) is the Academic Vice Principal's to decide and is not reminded.
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
2. Choose the teacher, the number of days (1 to 7) and the reason, and press **Save**.
3. The assigned teacher enters that lesson as its own teacher would, until 00:00 of the day after the last day. After the edit period the entries are marked "entered after the edit period".
4. **Withdraw** ends the assignment at once.

**Rules.**

- A lesson is listed while it is held, not complete, and counts for a teacher who left the school.
- Only a person working in the branch today can be assigned.
- A new assignment of the same lesson replaces the open one.
- The assigned teacher gets no other right: only that lesson, only until the end of the assignment.

## The lesson card

<!-- Sources: spec 09 (In the journal), edge/lesson-plans (Plans and the journal, "Who may read a plan?", "A double lesson"); task 8.8, decisions 6 and 16, plan review correction 1 -->

**What it is.** The header of each lesson in the journal shows the lesson's number in the quarter and its topic from the plan, shortened to fit; the whole topic shows when the pointer rests on the header. The **Lesson card** (**Dars kartasi**) button under the A of a lesson opens the card: number, date, slot, topic, classworks, the homework given today, the homework checked today, objectives and materials.

**Who can use it.**

| Role | What the role may do |
| --- | --- |
| The lesson's teacher (the plan's owner on that day, or the substitute while the substitution is in force) | Sees the whole card and sets "Topic not delivered" and "Not given" |
| Readers of the plan (Academic Vice Principal, Principal, Super Admin, Head Teachers of the subject, teachers with the subject and grade in their profile) | See the whole card |
| Tutor, Head Tutor, Vice Principal for Spiritual and Moral Education | See the topic and the homework titles only |

**Rules.**

- The number is the lesson's place among the quarter's lessons that are not cancelled.
- The plan is read only in the journal; it is changed only on the plan page.
- "Homework checked today" lists the homework given at the previous lesson: the numbers of this lesson's homework columns refer to it.
- Homework given at the first of two lessons on one day says "Will be checked today in slot N".
- In lesson mode on a phone, the topic, the classwork and the homework stand at the top.
- The **Works** button inside the card opens the works of the lesson (totals, "not held", works added by hand).

## Topic not delivered and homework not given

<!-- Sources: edge/lesson-plans ("A substitute supervises the class", "On Thursday it is recorded that Monday's lesson did not happen"), spec 09 (In the journal); task 8.8, decisions 4 to 9 and 18 -->

**What it is.** When the planned topic was not taught, or a planned homework was not given, the lesson's teacher marks it on the lesson card. This is not a plan edit.

**How it works.**

1. Open the lesson card of a held lesson.
2. Tick **Topic not delivered** (**Mavzu oʻtilmadi**). A copy of the lesson's item goes to "Not covered" on the plan of this class, and an edit request is prepared for the plan's owner.
3. Tick **Not given** (**Berilmadi**) beside a homework. The next lesson has no column for it.
4. Untick to undo, inside the same edit period.

**Rules.**

- Only for a held lesson with a plan item, of a graded subject, inside the edit period or under an unlock of that lesson.
- A homework cannot be marked "not given" once its column has a total, numbers, a carry or "not held". Mark it "not held" instead.
- The copy in "Not covered" belongs to the class of that lesson only, also in a shared plan.
- Undoing "Topic not delivered" removes the copy while it is unchanged and still not covered; once it was edited or placed in a row, the undo is refused.
- When the substitute sets "Topic not delivered", the plan's owner gets a notice.

**What happens if…**

| Case | What happens |
| --- | --- |
| The lesson is later recorded as not having happened (cancelled after its date) | Both marks are taken back by themselves, and an unchanged copy leaves "Not covered"; the item moves on as after any cancellation. |
| A homework was marked "not given" and the next lesson's teacher tries to set its total | It is refused: "This homework was marked "not given", so nothing is entered for it." |
| Two people mark and grade the same homework at the same moment | One wins: either the mark is refused because the column has a total, or the total is refused because the homework is "not given". |

**What the person sees.** "This homework already has a total, numbers, a carry or a "not held" mark in the journal, so it cannot be marked "not given". Mark it "not held" instead."
