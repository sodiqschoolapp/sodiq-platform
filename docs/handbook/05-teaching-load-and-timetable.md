# Teaching load and timetable

Not written yet for most of the teaching load and the timetable: task 3.7 describes what is built so far. This page holds the parts that later tasks added.

## Teacher absences

<!-- Sources: spec 06 (Teachers who work in several branches, Absence; How surprises are prevented), edge/timetable (After publishing: "A teacher is ill for weeks", "The lesson time passes and nobody was assigned"; Versions and drafts), edge/00-definitions (Held lesson); task 5.7a-1, decisions 1 to 13 and plan review corrections 1 and 2 -->

**What it is.** When a teacher cannot come, the Academic Vice Principal enters an absence once. It covers every branch the teacher works in. The teacher's lessons in those days stay in the timetable with the teacher's name, but need a teacher: before they start they are marked "Needs a teacher", and once they start with nobody recorded they are "Unresolved". They are never counted as held.

**Who can use it.**

| Role | What the role may do | Where |
| --- | --- | --- |
| Super Admin | Enter, change and withdraw absences; see the lists | Every branch |
| Academic Vice Principal | Enter, change and withdraw absences of the people of the branch; see the lists on the home page | Own branch (the absence covers every branch of the person) |
| Principal | See the absences and their lessons | Own branch |

**How it works.**

1. Timetable → Absences → Add an absence. Choose the person, the first day, the last day or "No return date yet", and a reason.
2. The Academic Vice Principals of every branch where the person works, or has lessons in those days, get a notice. The one who entered it does not.
3. Each branch's home page shows "Lessons that need a teacher" and "Unresolved lessons", one row for each absence, vacancy or lesson with nobody recorded, with the number of lessons, the dates and a link to the day.
4. In the absence's side panel the branch sees its own lessons inside the absence. "Change the dates" shortens or lengthens it; "Withdraw" removes it while it has not started.

**Rules.**

- An absence starts today or later. One entered today starts at that moment: lessons that started earlier today keep their state.
- Setting the last day to yesterday ends the absence at that moment: lessons that started before stay "Unresolved", later ones go back to the teacher.
- An absence that has ended cannot be changed; enter a new one. A withdrawn absence cannot be changed again.
- Two absences of one person never overlap.
- A vacancy cannot be absent: its lessons already need a teacher.
- After 10 school days of the branch the row on the home page suggests a new timetable version.
- A new version published over the days keeps the absence: its new lessons of the teacher need a teacher too. The publish preview lists it.

**What happens if…**

- *The teacher came after all and taught a lesson.* Correct the past lesson: "Someone else taught it" and choose the same teacher. The lesson is held.
- *The absence is shortened.* Its later lessons go back to the teacher at once, in every branch.
- *The teacher works in two branches.* Each branch sees its own lessons; the absence is the same record.

**Messages.** "This person already has an absence on some of these days." "This change would touch a day before today or a lesson that has already started." "This absence was withdrawn and cannot be changed." "A vacancy cannot be absent."

## A teacher inactive, left or locked

<!-- Sources: spec 06 (How surprises are prevented, "No lesson without a teacher or room"; Teachers who work in several branches, "Leaving or going inactive"), edge/people-roles-accounts (Staff over time), edge/timetable (Exams, "an invigilator falls ill"); task 5.7a-2a, decisions 1 to 10 and plan review corrections 1 to 4 -->

**What it is.** When a teacher's status is set to inactive or left from a date, or the teacher's account is locked, the teacher's lessons from then on stay in the timetable with the teacher's name but need a teacher, in every branch the teacher works in. Before they start they are marked "Needs a teacher", and once they start with nobody recorded they are "Unresolved". Nothing is rewritten: setting the teacher active again, taking back a planned status or unlocking the account gives the later lessons back at once.

**Who can do it.** The status is changed on the staff record, and the account is locked from the staff record's account section, by the people who could already do so. The lists are on the Academic Vice Principal's home page.

**How to do it.**

1. Change the status or lock the account as before.
2. Each branch's home page shows its own lessons of the teacher under "Lessons that need a teacher" and "Unresolved lessons", one row for the teacher with the reason: inactive, has left, or account locked.
3. An exam that has not started, with an invigilator who is absent, inactive, has left or is locked, is listed under "Exams that need an invigilator". Change the exam's invigilators to settle it.

**Rules.**

- A status saved for today starts at that moment: lessons that started earlier today keep their state. A status from a later date starts at the start of that day.
- A lock starts at the moment of the lock. A lesson that started while the account was locked stays "Unresolved" after the unlock.
- When several reasons hold, the row names one: has left first, then inactive, then account locked, then absent.
- A status or a lock moves no plan item, since no lesson is cancelled or moved.

**What happens if…**

- *A locked teacher taught a lesson after all.* Correct the past lesson: "Someone else taught it" and choose the same teacher. The lesson is held.
- *An inactive teacher or one who has left taught it.* That person cannot be recorded for that day; record who taught it, or cancel the lesson with a reason.
- *The teacher works in two branches.* Each branch sees its own lessons on its own home page.

## Exams after a publish or a withdraw

<!-- Sources: spec 06 (Changes after publishing, Exam), edge/timetable (Exams: "An exam is stored on its own like a one-day change and kept after a later publish"; Versions and drafts: "The preview sorts them into kept, needs a decision and dropped. Publish waits until every 'needs a decision' item is settled"); task 5.6c-3a, decisions 2 to 9 and plan review correction 1 -->

**What it is.** An exam stays when a new timetable version is published over its date, or when a version is withdrawn. The new lessons of its classes in its slots are cancelled for the exam, as when the exam was made. The publish preview and the withdraw question list every exam of the dates they change, and ask a decision where the new timetable does not fit the exam.

**Who can use it.**

| Role | What the role may do | Where |
| --- | --- | --- |
| Super Admin | Publish or withdraw a version and decide for its exams | Every branch |
| Academic Vice Principal | Publish or withdraw a version and decide for its exams | Own branch |
| Principal, Senior Head Teacher | See the publish preview and the withdraw question | Own branch; the Senior Head Teacher every branch |

**How it works.**

1. Timetable → the draft → step 8, **Publish**, or the teaching load of a published version → **Withdraw**.
2. Under **One-day changes**, each exam of the dates written is listed with its title, date, time and the number of lessons cancelled for it: under **Kept** when nothing needs deciding, under **Needs a decision** otherwise.
3. For an exam that needs a decision, choose one:
   - **Cancel the clashing lessons**: the new lessons of an invigilator, or in an exam room, at the exam's time are cancelled for that day. Type the **Reason**.
   - **Cancel the exam**: the exam is cancelled and its classes keep their lessons.
4. For a block of lessons shared with classes that do not sit the exam, choose **Cancel the whole block** or **Keep it for the other classes**.
5. Press **Publish** or **Withdraw**. The button stays off until every exam that needs a decision has one.

**Rules.**

- An exam keeps its date, its slots, its rooms and its invigilators after a publish. A publish never cancels an exam by itself.
- The new lessons of the classes that sit the exam, in its slots, are cancelled for the exam. Both halves of a double lesson go together.
- A block shared with classes that do not sit keeps the choice made for it before, when the new version has exactly the same lessons there. A block whose lessons changed is asked again.
- A new lesson of an invigilator, or in an exam room, at the exam's time needs a decision. The clash is found by the clock, also when the invigilator teaches a grade with other lesson times.
- **Cancel the clashing lessons** needs a reason. It is offered only when every clash is a lesson of the branch.
- A group that sits the exam sits it only in its own lesson. When the new version moves that lesson, only **Cancel the exam** is offered.
- A withdraw that leaves the exam's date without a timetable offers only **Cancel the exam**.
- Cancelling the exam gives its lessons back when they fit. A lesson that cannot come back (its room or teacher was given to another lesson for that day) stays cancelled; the preview names it, and the choice then needs a reason.
- Another branch's exam is not listed: an invigilator busy there is a clash of the publish itself, as any lesson in another branch.

**What happens if…**

| Case | What happens |
| --- | --- |
| The new version has no lesson of the exam's classes at its time | The exam stays, with nothing to cancel. |
| The new version takes away a block that a class was kept out of for the exam | The block goes; the exam stays. |
| Someone saves an exam while the publish preview is open | The publish is refused: the preview has changed. Open it again. |
| The exam is saved after the publish | It is checked against the new lessons. |
| The version is withdrawn and the exam is saved after it on a date with no timetable | The exam is refused: no timetable is in force on that date. |
| A block kept for the other classes is taught by an invigilator of the exam | The publish is refused as busy. Choose **Cancel the whole block**. |

**What the person sees.**

- In the notifications, a teacher whose week changed sees the week before and after. When the publish or withdraw cancelled an exam the teacher invigilated or taught under, the notice also says: "Exam cancelled by this change: Quarter exam in maths, 19 October 2026." An invigilator whose week did not change gets the notice with this line alone.

## Exams under a calendar change: the invigilators are told

<!-- Sources: edge/timetable (Exams: "A special template for its date moves the exam with its slots and rechecks it ... a day off removes the exam"; "One notice per person per event"); task 5.6b-2c-1, decision 4; task 5.6c-3b, decision 3 -->

**What it is.** A calendar entry or a change of the day templates can move an exam with its lesson slots, or cancel it for a day off. The exam's invigilators are told in the same notice that tells teachers about their week.

**Rules.**

- An invigilator of an exam that moved is told the new time and room: "Exam moved by this change: Quarter exam in maths, 19 October 2026. You invigilate 09:00–09:45 in Hall."
- An invigilator of an exam cancelled for a day off is told: "Exam cancelled by this change: …". The Academic Vice Principal still gets the notice that the day off cancelled the exam.
- An invigilator whose week did not change gets the notice with the exam line alone. One notice per person per change.
- An exam the change leaves where it was tells nobody. A preview tells nobody.
- An invigilator who teaches no lesson of the timetable is checked at the exam's new time like any other: another exam of that person at the new time refuses the change.

## The rating exam of the quarter

<!-- Sources: edge/timetable (Exams: "The exam is the quarter's rating exam"); edge/calculation ("The rating exam": one column per rating journal and quarter); task 5.6c-3b, decisions 1, 2 and 4 to 9 -->

**What it is.** An exam of a subject with a rating exam can be marked as the quarter's rating exam. It is then linked to the journals of that subject whose students all sit it; the journals' rating exam date is the exam's date (entered in the journal from task 8.2).

**Who can do it.** The Academic Vice Principal of the branch and the Super Admin, in the exam form; everyone who can see exams sees the journals in the exam's panel.

**How.**

1. In the exam form, choose the subject. When the subject has a rating exam, tick **Rating exam of the quarter**.
2. Press **Check**. The check lists **Journals linked to this rating exam** and, if any, **Journals not linked: their teacher sets the date by hand**.
3. Save. The exam's panel shows the same two lists.

**Rules.**

- A class journal of a class that sits the exam is linked.
- A group journal is linked when every student of the group on the exam's date comes from a class that sits, or when the group itself sits the exam in its own lesson. A group with a student from a class that does not sit is listed as not linked.
- Students are read on the exam's date. A student who joins after it does not count. Each save of the exam reads them again.
- A journal has one rating exam per quarter. Saving a second rating exam for the same journal in the same quarter is refused; cancel or change the first one, or take the tick off.
- New quarter dates that would bring two rating exams of one journal into one quarter are refused, and the preview lists them.
- A cancelled exam is no longer the rating exam: its panel shows no journals (the list is kept in the audit log).

**What happens if…**

| Case | What happens |
| --- | --- |
| The subject has no rating exam | The tick is not offered; a save that sends it is refused. |
| No journal is linked | The exam saves; the list says no journal is linked. |
| The tick is taken off in a change | The journals are no longer linked. |
