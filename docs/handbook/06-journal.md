# Journal

Not written yet for most of the journal: the journal grid, attendance, marks, works and totals, exemptions, locks and unlock requests (tasks 6.1a to 8.6) have no page here yet; where they are written is the owner's to decide (issue #42). This page holds the parts that task 8.7 added.

## The title and the column labels

<!-- Sources: spec 07 (Opening a journal; Layout, Lessons row and the table of short labels; Calculation rules, rule 3); spec changes of 18 and 24 November 2026 -->

**What it is.** A journal is titled by its class or group and its subject, for example "5 Oxford · Ingliz tili", so a teacher with several classes sees at once which journal is open. The page's name, **Sinf jurnali** (**Классный журнал**, **Class journal**), is in the line above the title. The short labels over the lesson columns are in the language of the screen, with the full word when the pointer rests on them:

| Column | Uzbek | Russian | English |
| --- | --- | --- | --- |
| Attendance | Dav | Пос | Att |
| Classwork | SI | Кл/р | CW |
| Homework | UV | Д/з | HW |
| Total (of 30) | Soni 30 | из 30 | of 30 |

The exported and printed journal uses the same labels, under the heading **Sinf jurnali** in its language.

There is no lesson score column (Oʻrt / Ср. / Avg) and a subject has no daily distribution: a lesson's attendance and works count only in the quarter averages and the quarter result, on screen, in the exported and printed journal and in the support view (owner, 24 November 2026).

## Today's lesson and the short headers

<!-- Sources: spec 07 (Opening a journal; Layout, Lessons row: "A lesson with no classwork and no homework is one narrow attendance column"); design-system (--today); the owner's request of 20 November 2026 -->

**What it is.** In the journal grid, today's lesson stands out from the others: its header is orange and says **Bugun** (**Сегодня**, **Today**), and its whole column is in the light "today" colour. A lesson with attendance only is one narrow column, so its header is short: the weekday and the date, "Du, 16.11", over the lesson of the day, "3-dars", with the status as a small sign: a tick for Complete, a clock for In progress, a lock for Locked incomplete and an empty circle for Nothing entered.

**How it works.**

1. The journal opens at the lesson nearest to today, as before; today's lesson is the orange one.
2. Resting the pointer on a short header shows its whole text: date, weekday, lesson of the day, status, lesson number and topic. A screen reader reads the whole text too.
3. A lesson with classwork or homework keeps its long header, "16-noyabr, Dushanba · 3-dars", with the status in words.

## The journal on a phone

<!-- Sources: spec 07 (Lesson mode), spec 12 (Devices: "Phone: lesson mode for the journal"), spec 06 (Views and outputs: teacher home page); the owner's request of 20 November 2026 -->

**What it is.** On a phone, the journal shows one lesson at a time, as a list of students (lesson mode). The selectors (class, subject, year, quarter, month, search and filter) are folded under one line, **Sinf, fan va davr**, so the lesson is near the top of the screen.

**How it works.**

1. The arrows beside the lesson's date go to the lesson before and after. Today's lesson says **Bugun** in place of the weekday.
2. A lesson with classwork or homework is entered one column at a time, in this order: attendance, then each classwork, then each homework. The buttons above the list choose the column: **Davomat**, then each work by its tag and title.
3. In **Davomat**, each student has the four large buttons 1, 0, 2 and 3, and **Hammasi keldi** marks every student not yet marked. A mark being saved makes only that student's buttons wait; the next student can be marked at once.
4. In a work's column, each student has one large number field, with the student's attendance mark under the name and the percent beside the field once it is saved. The button above the list shows the work's total and opens the work to set or change it. The keyboard's **Next** (Enter) saves the number and goes to the next student. A number may have up to two digits after a point, for example 7.5 or 8.25. A phone's number pad may have no point, or a comma in its place, so the small **.** button beside the field types a point. A number above the total, with a comma, with more than two digits after the point, or with letters stays in its field outlined in red, with the reason, and is not saved until it is corrected.
5. **Keyingisi: …** at the end of the list goes on to the next column.
6. A lesson the person may only read shows each student's mark and numbers on one row.

**The teaching home on a phone.** Today's lessons are a list of cards: the lesson of the day and the time, the class or group and the subject, the room, the status, and **Jurnalni ochish** across the card. The lesson happening now has the light "today" colour, and its button is orange and pulses gently. The week is a list by day.

## Lesson status

<!-- Sources: spec 07 (Lesson status, Exemptions), edge/journal (Entering, rows 1 to 3 and 15; Locks), edge/00-definitions (Held lesson, Data on a lesson, Expected student, Lock moment); task 8.7, decisions 2, 7 and 8 -->

**What it is.** Every lesson that has been held shows one of four statuses: Nothing entered (**Hech narsa kiritilmagan**), In progress (**Jarayonda**), Complete (**Toʻldirilgan**) and Locked incomplete (**Toʻldirilmay yopilgan**). The status is worked out each time a page opens, from what is entered.

**Who can use it.** Everyone who may open a journal, the timetable or the teaching home sees the status there. Nobody sets it by hand.

**How it works.**

1. A lesson that was held with nothing entered yet is **Nothing entered**.
2. As soon as anything is entered (a mark, a number, a total, "not held", or a comment), the lesson is **In progress**.
3. It is **Complete** when every expected student has an attendance mark, and every work of the lesson has its total and a number, or "not graded", for each student marked present or late.
4. When the edit period ends before the lesson is complete, it is **Locked incomplete**. It needs an unlock; while the unlock is open it stays Locked incomplete until the missing entries are made.
5. The status shows in the header of each lesson in the journal, beside the lesson on the teaching home and on the timetable. The teaching home sums up today: "3 of 5 lessons complete".

**Rules.**

- Future, cancelled and unresolved lessons have no status.
- Students marked absent (0) or "did not come to the lesson" (3) are not waited for: their empty number cells do not keep the lesson in progress.
- Exempt students are not waited for.
- A cell opened for a few days after a late move or a shortened exemption is optional: it never changes the status.
- A homework is a work of the lesson where it was given: the cell of a student who was exempt, or not yet in the class or group, at that lesson is closed, like every cell of that lesson.
- A lesson with no work is complete as soon as attendance is marked.
- Every work of the lesson counts: those of the plan, and those added by hand at a lesson with no plan item. A work marked "not held" does not count.

**What happens if…**

| Case | What happens |
| --- | --- |
| A mark is changed from absent to present after the numbers were typed | The student's empty cells are waited for again: the lesson can go back to In progress. |
| Numbers are typed before attendance | The lesson stays In progress until attendance is marked. |
| Every student of the lesson is exempt | The lesson is Complete: there is nothing to mark. |
| A total is set and nothing else | The lesson is In progress. |

## Codes in the journal

<!-- Sources: spec 09 (Codes), 07 (Layout); task 11.27 -->

In a subject whose codes the Super Admin switched on, a column header shows the work's code alone, with the full title on hover or a tap, and the lesson header shows the topic's code; lesson mode on a phone does the same. A work added in the journal, and the lesson's topic in the lesson's editor, take a code beside the title. Everything about codes is in [Lesson plans](07-lesson-plans.md#codes-for-topics-and-works).

## Numbers with decimals

<!-- Sources: spec 07 (Entering data, Keyboard; The total), edge/journal (Entering), edge/calculation (a score with decimals); spec changes of 25 November 2026 (decimal scores, decimal totals); task 11.25b -->

**What it is.** A classwork or homework number, and a work's total, may have up to two digits after a point: a teacher can give half points (7.5 out of 10 is 75%) or use a total of 7.5. The point is the same in every language; a comma is refused. A number is kept exactly as typed and shown without trailing zeros (7.50 shows 7.5), on screen, in the cell's history, in the support view, in printed and exported journals and on the parents' pages and messages. Every percent and result is worked out exactly and rounded once, at the end, as before. The rating exam score stays a whole number from 0 to 100.

**Who can use it.** Whoever may type numbers and totals in the lesson.

**How it works.**

1. Type the number with a point: 7.5, 8.25. "8." is read as 8.
2. In lesson mode on a phone, and in the total of a work, the small **.** button beside the field types a point: a phone's number pad may have none, or a comma in its place.
3. A number with a comma, with three or more digits after the point, with letters, or above the total stays in its cell outlined in red with the reason, and is not saved until it is corrected.

**Edge cases.**

| Case | What happens |
| --- | --- |
| 7,5 is typed | Refused in the cell: "Use a point, not a comma." |
| 7.555 is typed | Refused in the cell: "At most two digits after the point." If it still reaches the server, it is refused and the support view shows it as sent. |
| 6 out of a total of 7.5 | 80%. |
| The total is changed to 9 while a student has 9.5 | Refused, and that student is listed. |
| A rating exam score of 7.5 | Refused: whole numbers only. |

## Not graded

<!-- Sources: spec 07 (Lesson status), edge/journal (Saving and working together); task 8.7, decision 3; the owner, 20 November 2026 -->

**What it is.** A dash (**-**) typed in a classwork or homework cell means "not graded" (**Baholanmagan**): the student was not graded for that work. The cell counts in no average, like an empty cell, and the lesson no longer waits for it.

**Who can use it.** Whoever may type numbers in the lesson: the lesson's teacher or substitute inside the edit period or an unlock; the Academic Vice Principal and the Super Admin as a correction, with a reason.

**How it works.**

1. In the journal, click the cell and type **-**, then Enter or move on, as with a number.
2. In lesson mode on a phone, type **-** in the field, or press the small **-** button beside it (a phone's number pad may have no minus).
3. To undo, type a number or clear the cell.

**Rules.**

- A "not graded" cell shows a dash. Every change is kept in the cell's history.
- The dashes a keyboard may give in its place (–, —, −) count as a dash too.
- The **Baholanmagan** button that filled every empty cell at once is gone (owner, 20 November 2026).
- The attendance marks and the dash are listed right above the grid, in full screen too.

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

## Editing a lesson

<!-- Sources: spec 09 (In the journal), spec 07 (Entering data); the owner, 20 November 2026 ("make lesson editing inside the journal very simple") -->

**What it is.** One window holds everything about a lesson: its topic, its classworks and its homeworks with their totals, and the plan's objectives and materials. It replaces the lesson card's **Bu dars rejasini oʻzgartirish** button, the **Dars ishlari** window, the window of a single work, and the **Oʻtkazilmadi**, **Tekshirilmadi**, **Keyingi darsda tekshirish**, **Mavzu oʻtilmadi** and **Berilmadi** buttons.

**How to open it.**

- The **Lesson card** (**Dars kartasi**) button under the attendance column (**Dav**) of a lesson.
- The **…** of a classwork or homework header: the window opens with that work's total ready to type.
- In lesson mode on a phone: **Edit lesson** (**Darsni tahrirlash**).

**Who can use it.**

| Role | What the role may do |
| --- | --- |
| The lesson's teacher, or the substitute on the day | Change everything listed below while the lesson can be entered: from its start, inside its edit period (or an open unlock) |
| Academic Vice Principal, Super Admin | The same as a correction, with a reason |
| Everyone else who reads the journal | Sees the window read only |

**What the teacher can do.**

- **Topic**: type it and press **Save topic**. It is written into the lesson's row of the plan (the plan and its row are made if there is none).
- **Classwork**: **+ Add classwork**, type a title (at most 60 characters), **Add**. Type its total in **Soni** and press Enter. A total is from 1 to 1000 and may have up to two digits after a point (7.5); the **.** button beside the field types a point. Rename with the pencil, delete with the bin.
- **Homework** (**Uyga vazifa**): **+ Add homework**, type a title (at most 60 characters), **Add**. It is a column of this lesson and is graded here, like a classwork: type its total in **Soni**, then the numbers. Rename with the pencil, delete with the bin.
- As many works as needed, up to 10 of each kind per lesson.

**Deleting a work.**

- A work with no total and no numbers is deleted at once, from the plan too.
- A work with a total or numbers asks first and says how many numbers it holds. It then leaves the journal and every average; its numbers stay in the history (records with data are archived, never deleted).

**Rules.**

- A homework is graded at the lesson where it was given (owner, 25 November 2026). No other lesson has a column for it: homework handed in on Friday for Monday's lesson is typed in Monday's column, while Monday's lesson can still be edited (inside its edit period, or under an unlock of that lesson). Homework given at the last lesson of a quarter counts in that quarter.
- Homework numbers saved before 25 November 2026 at a later lesson (the next lesson, the one after a cancelled lesson, or the one it was moved to) were moved once to the lesson where the homework was given, with their totals, "not held", numbers and comments. Each cell's history shows the move as **Homework move of 25 November 2026**, with no author. A number of a student who was exempt, or not yet in the group, at the lesson where the homework was given did not move: it left the averages and stays in the cell's history.
- The header of each lesson shows its number among the quarter's lessons that are not cancelled and its topic, shortened; the whole topic shows on hover.
- Objectives, links and files of the plan are read here and changed on the plan page.
- A future lesson is read only here; plan ahead on the plan page.
- Every change is in the audit log and in the plan's history (who, when, the old and the new text).

## Exporting a journal

<!-- Sources: spec 07 (last paragraph), edge/journal ("A results table is exported in week 6"), edge/system-behaviour ("A whole branch's journals are exported to PDF during lessons"); task 8.9, decisions 1, 3 to 6, 9 and 10 -->

**What it is.** A journal can be printed or saved as a PDF or an Excel file, for the month on screen or the whole quarter. The Principal, the Academic Vice Principal and the Super Admin can also export all the journals of the branch at once.

**How it works.**

1. Open a journal. Choose the month in the selector, or leave it on the quarter.
2. Press **Print**, **PDF** or **Excel** (**Chop etish**, **PDF**, **Excel**). The file holds what the journal shows you, nothing more.
3. For the whole branch: on the Journals page open **Export of the branch** (**Filial eksporti**), choose the format, the quarter and a month or the whole quarter, and press **Ask for the export**. The file is made in the background; press **Refresh** after a few minutes, then **Download**.

**Rules.**

- Every file says "Provisional" with the date and time it was read. ("Final" comes with the closing of quarters.)
- A Tutor's file has the rows of their own class only; the Vice Principal for Spiritual and Moral Education and the Head Tutor get attendance only.
- An exempt student's cell shows 4 or 5. The reason, the category and the document of the exemption are never in a file. Comments and reasons of absence are not in the file either.
- Excel cells hold real numbers and dates: the number typed and its percent are two columns. A number with decimals is a number cell too (7.5).
- A teacher who only substituted a lesson, or completes an orphan lesson, cannot export that journal.
- One export of the branch at a time per person. Its link works for 24 hours after the file is ready, and the server checks again at the download that the person still may export the branch.
- Every export and every download is written to the audit log.

**What happens if…**

| Case | What happens |
| --- | --- |
| The link is opened 25 hours after the file was made | It is refused: "The link of this export worked for 24 hours and has expired. Ask for a new export." |
| The person lost the role between the request and the download | The download is refused. |
| The export was not finished within 20 minutes | It is shown as failed, and a new one can be asked for. |

## The support view

<!-- Sources: edge/journal ("My grade disappeared"); task 8.9, decisions 2, 7, 13 to 15 -->

**What it is.** When a parent or a teacher says "my grade disappeared", the Academic Vice Principal (or the Super Admin) opens one page for one student, one journal and one date that lists everything that happened to those cells, in time order, and how the result was calculated.

**How it works.**

1. From a cell's history choose **Support view** (**Yordam koʻrinishi**), or open it from the Journals page and choose the journal, the date and the student.
2. The page shows the lessons of that date with the mark and numbers as the journal shows them, the values stored, and what hid a value (an exemption).
3. Below, every line in order: each save (who, how: entry, late entry with the approver, correction with its reason, exemption, transfer, leaving, cancellation, "not held", offline entry, undo), each refused save with the value sent and the reason, each clear by an exemption and its give-back, each value voided by a move or a leaving and its give-back, and the work and rating exam lines.

**Rules.**

- For the Academic Vice Principal and the Super Admin only. Each opening is written to the audit log.
- A student who has since left for another branch is still found.
- The figures are the journal's own; the page calculates nothing.
