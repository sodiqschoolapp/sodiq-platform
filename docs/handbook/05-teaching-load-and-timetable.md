# Teaching load and timetable

Not written yet for most of the teaching load and the timetable: task 3.7 describes what is built so far. This page holds the parts that later tasks added.

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
