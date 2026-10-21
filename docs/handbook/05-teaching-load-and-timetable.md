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

## Room closures

<!-- Sources: edge/timetable (After publishing, "A laboratory is under repair for three weeks"; Versions and drafts; Exams, "An exam room is closed"), spec 06 (How surprises are prevented, "No lesson without a teacher or room"), spec 03 (the room row); task 5.7a-2b, decisions 1 to 15 and plan review corrections 1 to 3 -->

**What it is.** When a room cannot be used for some days, for example a laboratory under repair, the Academic Vice Principal closes it from a first day to a last day, with a reason. The room's lessons in those days stay in the timetable in that room, but before they start they are marked "needs a room" and listed on the home page under "Lessons that need a room". "Move all to another room" puts every one of them into another room for those days only. After the closure the lessons are in their own room again. A room whose status is "under repair" or "closed" has its lessons listed the same way, until it is back in use.

**Who can do it.** The Super Admin and the Academic Vice Principal close a room, change the days, withdraw a closure and move its lessons. The Principal sees the closures and the lists.

**How to do it.**

1. Open Timetable, then "Room closures", and press "Close a room". Choose the room, the first and last day, and write the reason.
2. The home page shows the room under "Lessons that need a room", with the number of lessons and their days. "Open the closure" opens it.
3. In the closure, press "Move all to another room", choose a room in use and save. The reason is the closure's unless you change it. Each moved lesson is a one-day room change, and its teacher is told once.
4. To end a closure early, change its last day. To take back a closure that has not started, withdraw it.

**Rules.**

- A closure starts on today or a later day. One that starts today starts at the moment it is saved: a lesson that already started is not touched.
- Two closures of one room cannot overlap.
- "Move all" moves every lesson or none: if one lesson cannot go to the chosen room, nothing moves and the dates of those lessons are shown. Move them one by one on the Day changes page, or choose another room.
- A room closed at a time cannot take a lesson or an exam by a one-day change, a restore or an exam save at that time. A publish still writes the timetable's lessons into it, and they need a room again; the publish preview lists the closure among the kept changes.
- A lesson that has started is history: it is no longer listed, and its correction is not refused because of the closure.
- A closure moves no plan item: the lessons keep their date and slot.

**What happens if…**

- *An exam is in the closed room.* It is listed under "Exams that need a room". Change the exam's rooms to settle it.
- *A lesson has no room at all.* It is not listed: nothing closed it.

## Filling a vacancy

<!-- Sources: spec 06 (Changes after publishing, "Filling a vacancy"; How surprises are prevented, Impact preview, Start date, Withdraw), spec 04 (Vacancy), edge/timetable (After publishing, the vacancy rows); tasks 5.7a-3a and 5.7a-3b, their decisions and plan review corrections -->

**What it is.** When a teacher is hired for a vacancy, the Academic Vice Principal fills the vacancy with that person from a date. The person takes the vacancy's lessons from that date in the timetable in force and in every later published version. Lessons before the date stay as they were. A vacancy with no rows left is closed from the date.

**Who can do it.** The Super Admin and the Academic Vice Principal fill a vacancy. The Principal sees the vacancy, its fills and its planned close, but has no **Fill** button.

**How to do it.**

1. Open People, then Vacancies, and open the vacancy. Press **Fill** (**Toʻldirish**).
2. Choose the person. People with a subject of the vacancy come first. People admitted from a later day are listed too. People who left or are inactive are not.
3. Choose the date. It starts on next Monday. The first day of each coming quarter and the start of each later published version are offered as buttons. Tomorrow is the earliest date.
4. Keep "All rows", or untick it and tick the rows to fill.
5. The dialog shows each row: "goes to the person", or why it stays with the vacancy and on which dates. It also shows everything a publish shows: what cannot be published, the warnings, the later versions the change is carried into, the one-day changes already made, and the impact preview with the transition week. Last, it says whether the vacancy will be closed from the date.
6. Tick the transition week if it is shown, and decide each one-day change that needs a decision. Press **Fill** and confirm. The confirmation names the rows.
7. The dialog shows what was done. The vacancy's record lists the fill under "Fills".

**Rules.**

- A row goes to the person only if the person teaches its subject, grades and language, and is free at every one of its lessons from the date, in every branch. Any other row stays with the vacancy and is listed with the reason. The rest of the fill goes ahead.
- The vacancy is closed from the fill date when no row and no lesson is left under it from that date. Until the date it is still open, and its record and the list say "Open, closes on" the date.
- A vacancy that is closed, or whose close is already planned, has no **Fill** button.
- Lessons already held stay recorded under whoever taught them.
- When a version starts on the fill date, that version is changed and no new version is made. Otherwise a new version is published from the date.
- The fill is taken back by withdrawing the version it changed or published, before that version starts.

**What happens if…**

| Case | What happens |
| --- | --- |
| The person does not teach in the class's language | That row stays with the vacancy, marked "does not teach this subject, grade or language". |
| The person already teaches at that time | That row stays with the vacancy, with the dates the person is busy. |
| No row can go to the person | **Fill** stays off, with "No row can go to this person from this date." |
| Someone changed the rows or the person after the check | The fill is refused: "The rows to fill changed since you checked them. Check again." The dialog checks again. |
| Every row is unticked | The dialog asks "Choose at least one row." and checks nothing. |
| A chosen row is not a row of the vacancy on the new date | It is dropped from the choice; when none of the chosen rows is left, "All rows" is back. |
| The vacancy is reopened before its planned close | The planned close is cancelled. The vacancy stays open. |

**What the person sees.** "The vacancy will be closed from 19 October 2026." "The vacancy stays open." "To take it back, withdraw the version before 19 October 2026." "This person cannot take the vacancy from that date. Choose a staff member who is active on it."

Not built yet: substitutes for its lessons (task 5.7b).

## The acting teacher of a vacancy's journal

<!-- Sources: edge/timetable (After publishing, "A vacancy lasts a quarter: who writes the plan and grades?", "The plan, the journal and the reports of a vacancy's subject"), spec 06 (Substitution), spec 07 (Who can do what); task 5.7a-3c, its decisions and plan review corrections -->

**What it is.** While a vacancy waits for a teacher, the Academic Vice Principal can name an acting teacher for one of its journals for a period. For that period the acting teacher owns the journal: the plan, the works, the rating exam and the discipline report count for them. Nothing is ever counted against the vacancy. Without an acting teacher, the journal has no teacher.

**Who can do it.** The Super Admin and the Academic Vice Principal name, end and withdraw acting teachers. The Principal and others who read the vacancy see the periods, but no buttons.

**How to do it.**

1. Open People, then Vacancies, and open the vacancy. The "Acting teachers" section lists each journal the vacancy holds from today, with its periods.
2. Press **Name an acting teacher** (**Vaqtincha oʻqituvchi tayinlash**).
3. Choose the journal and the person. People with a subject of the vacancy come first.
4. The first day starts on the journal's first day under the vacancy from today. Today is the earliest. Leave "Hands the journal back on" empty for an open-ended period, or choose the first day without the acting teacher.
5. The dialog checks the choice. If the person does not teach in the class's language, tick that you name them all the same. Press **Name**.
6. The period appears under its journal. **End** sets the day the person hands the journal back (today at the earliest). **Withdraw** takes back a period that has not started; it stays in the history.

**Rules.**

- One acting teacher per journal on a day.
- The person must be active in the branch and teach the subject in the class's grade. A vacancy cannot be an acting teacher.
- The period counts only on the days the vacancy holds the journal. When the vacancy is filled, the hired teacher owns the journal from the fill date, and the record says "until the vacancy is filled on" that date. If the fill is taken back, the acting teacher owns it again.
- If the acting teacher leaves or becomes inactive, the journal has no teacher on those days.
- Naming an acting teacher does not put them on the lessons. The lessons still need a teacher until a substitute is set (task 5.7b).

**What happens if…**

| Case | What happens |
| --- | --- |
| The journal already has an acting teacher on a day of the period | Refused: "The journal already has an acting teacher on a day of this period." |
| The journal is filled or has another teacher on the first day | Refused: "This journal is not under the vacancy on that day." |
| The subject for the class's grade is not in the person's profile | Refused, with that reason. |
| The period has started | It can be ended, not withdrawn. |

**What the person sees.** "Yusupova Nodira, from 12 October 2026, open-ended, planned." "No acting teacher: the journal has no teacher."

Not built yet: what the acting teacher does in the plan and the journal (tasks 7.1b, 8.1, 8.2, 8.7) and the closing checklist's "no teacher" (task 9.2a).

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
