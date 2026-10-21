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
- *The absence is shortened.* Its later lessons go back to the teacher at once, in every branch, also those that had a substitute for this absence (see "Substituting a lesson", From an absence or a vacancy).
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

Its lessons are substituted per journal from the vacancy's record (see "Substituting a lesson", From an absence or a vacancy).

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
- The period counts only on the days the vacancy holds the journal. When the vacancy is filled, the hired teacher owns the journal from the fill date, and the record says "until" that date, "when the vacancy no longer holds the journal". If the fill is taken back, the acting teacher owns it again.
- If the acting teacher leaves or becomes inactive, the journal has no teacher on those days.
- Naming an acting teacher does not put them on the lessons. The lessons still need a teacher until a substitute is set: **Substitute per journal** on the vacancy's record chooses the acting teacher first.

**What happens if…**

| Case | What happens |
| --- | --- |
| The journal already has an acting teacher on a day of the period | Refused: "The journal already has an acting teacher on a day of this period." |
| The journal is filled or has another teacher on the first day | Refused: "This journal is not under the vacancy on that day." |
| The subject for the class's grade is not in the person's profile | Refused, with that reason. |
| The period has started | It can be ended, not withdrawn. |

**What the person sees.** "Yusupova Nodira, from 12 October 2026, open-ended, planned." "No acting teacher: the journal has no teacher."

Not built yet: what the acting teacher does in the plan and the journal (tasks 7.1b, 8.1, 8.2, 8.7) and the closing checklist's "no teacher" (task 9.2a).

## Substituting a lesson

<!-- Sources: spec 06 (Changes after publishing, Substitution; How surprises are prevented), spec 05 (Substitution), edge/timetable (After publishing: "No teacher of the subject is free", "A substitute wants to finish the numbers two days later"; Structure, "Double lessons"), spec 10 (Substitution assigned); task 5.7b-1, decisions 1 to 12, plan review corrections 1 and 2 -->

**What it is.** A substitution is the one way to put another teacher on a lesson. The Academic Vice Principal picks a substitute for one lesson from the class's day. The substitute becomes the lesson's teacher, so the lesson no longer needs a teacher, and a record keeps who was replaced, by whom, for which lessons and why.

**Who can do it.** The Super Admin and the Academic Vice Principal. The Principal sees the day and the marks, but no buttons.

**How to do it.**

1. Open Timetable, then Day changes, and choose the date and the class.
2. On a lesson that has not started, press **Substitute** (**Oʻrinbosar**).
3. Choose the substitute. The list holds only teachers who can take the lesson: teachers of the subject first, then the same department, then the others. Teachers who cannot teach in the class's language come last, marked.
4. Type the reason and press **Save the substitution**. If the dialog lists warnings, check them, tick the box and save again.
5. The lesson now shows the substitute, with "substitute for" the teacher replaced. **Withdraw the substitution** gives the lesson back while it has not started.

**Rules.**

- Both halves of a double lesson take the same substitute. One group of a split class can be substituted alone.
- The substitute must be free at that time in every branch, with the travel time, and not absent, inactive, left or locked.
- While a teacher of the subject is free, only teachers of the subject can be chosen. When none is, another teacher can take the lesson: the missing subject, grade or hours are warnings that need a tick. A teacher busy at that time is never offered.
- A teacher who cannot teach in the class's language needs a tick too.
- A vacancy is never a substitute. A substitute can be set on a vacancy's lesson; the record names the vacancy as replaced.
- A substitution of a substitution keeps the first teacher replaced. The teacher replaced cannot be chosen as the substitute: withdraw the substitution instead.
- The substitute receives a notice "You are the substitute for a lesson on …" with the week before and after. The teacher replaced receives the usual notice of a one-day change.
- A lesson that has started is not substituted: correct it ("Someone else taught it"). That correction is kept as a substitution record too.
- A room change, a move, a cancel and its restore keep the substitute.

**What happens if…**

| Case | What happens |
| --- | --- |
| The teacher replaced has another lesson at that time when the substitution is withdrawn | Refused: "The teacher replaced has another lesson or exam at that time." |
| The teacher replaced is absent when the substitution is withdrawn | The lesson goes back to them and needs a teacher again. |
| A new timetable version, a vacancy fill or a calendar change rewrites the lesson | The preview lists the substitution as kept, needing a decision or dropped (see "After a new timetable is published" below). |

**What the person sees.** "Aliyev Bekzod · substitute for Geometry vacancy 2". "The substitution was saved."

### From an absence or a vacancy

<!-- Sources: spec 06 (Changes after publishing, Substitution; Teachers who work in several branches, Absence), edge/timetable (After publishing: "A teacher is ill for weeks with no return date", "A vacancy lasts a quarter: who writes the plan and grades?"); task 5.7b-2, decisions 1 to 13, plan review corrections 1 and 2 -->

**What it is.** When a teacher is absent, their lessons can be substituted from the absence itself: one lesson at a time, or one substitute for every lesson of a class's subject (a journal) for the whole absence in one action. A vacancy's journal can be substituted the same way for a period. Shortening or withdrawing an absence gives its future substituted lessons back to the teacher.

**Who can do it.** The Super Admin and the Academic Vice Principal. The Principal sees the absence's lessons with their substitutes, but no buttons.

**How to do it.**

1. Open Timetable, then Absences, and open the absence. Its lessons in this branch are listed with their state and substitute.
2. On a lesson that has not started, press **Substitute** for that lesson alone, or **Substitute for the whole absence** for every lesson of that class's subject in the absence.
3. Choose the substitute. Each teacher shows on how many of the dates they are free; the dates a teacher cannot take are listed under the choice.
4. Type the reason and press **Save the substitution**. If the dialog lists warnings by date, check them, tick the box and save again.
5. The answer lists the dates saved, the dates not saved with the reason, and the lessons that already had a substitute.

For a vacancy: open the vacancy in People, then Vacancies. Each journal under "Acting teachers" has **Substitute per journal**: choose the period (from, and until the first day without the substitute, or no end), then the teacher. The acting teacher in force is chosen first; any other teacher can be chosen.

**Rules.**

- Every date is checked on its own, as for one lesson. A date where the substitute is busy, absent or blocked by a rule is not saved and is listed; the other dates are saved.
- "No teacher of the subject is free" is decided for each date: on a date where a teacher of the subject is free, a teacher without the subject is refused for that date.
- A lesson that already has a substitute is left as it is.
- Shortening the absence, or withdrawing it before it starts, gives back to the teacher every lesson substituted for this absence that has not started and that the absence no longer covers, in every branch of the teacher. A lesson that has started keeps its substitute. A lesson substituted before the absence was entered is not given back.
- A lesson whose return would clash with another lesson of the teacher keeps its substitute and is listed after the save.
- In another branch, the lessons are given back in the same step, and that branch's audit log records it.
- The substitute receives one notice "You are the substitute for lessons from … to …" with the week before and after. A substitute who loses lessons by a shortening receives the usual notice of a one-day change.

**What happens if…**

| Case | What happens |
| --- | --- |
| No date can take the chosen substitute | Refused: "No lesson of the journal in this period can take this substitute." with the dates and their reasons. |
| The absence is shortened while a substitution is being saved | One waits for the other: a lesson the absence no longer covers is either not substituted or given back. |
| The teacher is not linked to the other branch any more | The lessons there are given back to nobody and need a teacher. |

**What the person sees.** "Saved for: 19 October, 26 October". "Not saved on these dates: 2 November: The substitute cannot teach at that time."

Not built yet: the substitute in the journal and the plan (tasks 6.3, 7.1b, 8.4, 8.7, 8.8); the Free now board (task 5.7c).

### After a new timetable is published

<!-- Sources: edge/timetable (Versions and drafts: "A substitution and a one-day move are already recorded for a date after the new version starts. One-day changes, absences, room closures and exams are stored on their own and applied again after a publish. The preview sorts them into kept, needs a decision and dropped. Publish waits until every 'needs a decision' item is settled."), spec 06 (Changes after publishing, Filling a vacancy); task 5.7b-3, decisions 1 to 13 -->

**What it is.** A substitution stays when a new timetable version is published, a version is withdrawn, a vacancy is filled, or the calendar, a day template or the quarter dates change, as long as the lesson is still there with the same teacher. The preview of each of these lists every substitution of the dates it rewrites under **Kept**, **Needs a decision** or **Dropped**.

**Who can do it.** Whoever may publish, withdraw, fill or change the calendar: the Super Admin and the Academic Vice Principal. The Principal sees the previews.

**How it works.**

- **Kept**: the new timetable has the lesson at the same time, with the teacher who was replaced, and the substitute can still take it. The substitute stays on the lesson, with the same record and reason; a shortening of the absence it was made for still gives it back. Nobody is told, since nothing changed.
- **Needs a decision**: the lesson is still there, but the substitute now has another lesson at that time, is away, or no longer passes a rule. Choose **Give the lesson to the teacher of the new timetable** (offered when that teacher is free) or **Cancel the lesson that day** (type a reason). The save waits for a choice.
- **Dropped**: the new timetable moves or removes the lesson, cancels it, or gives it another teacher. The lesson goes to the teacher of the new timetable; the substitution ends.

**Rules.**

- A vacancy filled from a date gives its later substituted lessons to the hired teacher: they are dropped. Lessons already held stay recorded under the substitute.
- Both halves of a double lesson are one line and are decided together.
- A teacher replaced on one lesson who substitutes on another at the same time is counted once: both substitutions are kept.
- A substitution saved under "no teacher of the subject is free" is checked the same way again.
- A substitution on a lesson that another line under "Needs a decision" may cancel says so; if that line is cancelled, the substitution is dropped.
- If a substitution is saved or withdrawn after the preview was read, the save is refused: read the preview again.

**What the person sees.** "7 Oxford, Mathematics, 19 October 2026 08:00–08:45: Aliyev Bekzod in place of Karimova Aziza. Reason: The teacher is ill".

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

## Version history

<!-- Sources: spec 06 (Protection, "Version history shows every version in the order of their start dates, names the version in force on the first day of each quarter, compares two versions, and can reopen an old one as a new draft"), edge/timetable (Versions and drafts, "A published version must be taken back"), edge/academic-year ("An old timetable version with an archived teacher and a closed room is copied as a draft"); task 5.8a, decisions 1 to 10 and plan review corrections 1 and 2 -->

**What it is.** One page lists every timetable version of a year, in the order of the dates they start from: drafts, published versions and archived ones. Beside each published version it says on the first day of which quarters it is the timetable in force. Any two versions of the year can be compared, and any version can be restored as a new draft.

**Who can do it.** The Super Admin, the Principal and the Academic Vice Principal open the history and compare versions. The Super Admin and the Academic Vice Principal restore a version.

**How to do it.**

1. Open Timetable, then "Version history". Choose the year when the branch has more than one.
2. Open a version. "Compare with" shows what changed from the version chosen to the one opened, by class or group and subject: a row added or removed, its teacher, lessons per week, room or other settings, a lesson added, removed or moved to another slot, a lesson's room or clock time, and a lesson joined to or parted from a double lesson.
3. "Restore as a new draft" asks for the start date of the new draft and opens it in the builder, on its grid.

**Rules.**

- The version in force on a day is the published version with the latest start on or before that day. An archived version is never in force: a version is archived only before it starts (a withdraw, or a later publish that replaces it). A draft is never in force.
- Only two versions of the same year are compared; their classes and groups are the year's own.
- A restore is a copy into a new draft; the version restored, the published versions and their lessons do not change. Only a version of the same year can be copied.
- Every copy of a version, not only a restore, takes its weekly pattern: each lesson at the same weekday and slot, with the times of the day template in force on the new draft's start date. A double lesson is copied with both halves or not at all.

**What happens if…**

- *A lesson's teacher, subject, class or group is no longer active.* Its load row is not copied (it is listed under the rows the copy left on the Teaching load page) and its lessons are listed in the grid's "To place" under "Not copied from version N", with the reason.
- *A lesson's room is closed.* The lesson is not copied and is listed in "To place" with the reason "its room is closed". Its row is copied, so it shows under the row's entry too.
- *The new start date's day template has no such slot, or the lesson would clash with another one copied before it (a class's new Tutor, a template that moved its times).* The lesson is not copied and is listed with that reason. A lesson of a block of several groups is copied only with the whole block.
- *The person dismisses the rows the copy left.* The lessons listed under "Not copied" are dismissed with them.


## Deleting a lesson for good, and the history of a lesson

<!-- Sources: spec 06 (Protection: "A dated lesson that already has attendance or marks cannot be deleted and cannot change its class, group or subject. Its teacher, room and time can change, with a log entry." "Forced delete is for Super Admin only, with a typed reason. The attendance and marks are kept for 30 days and can be restored." "Every change records who, when, the value before and the value after."), edge/00-definitions (Data on a lesson), edge/timetable (After publishing, "Every rule is checked again"); task 5.8b, decisions 1 to 12 and plan review corrections 1 and 2 -->

**What it is.** A dated lesson is never moved to another class, group or subject, and a lesson that holds attendance or marks is never removed by a new timetable. Only the Super Admin can delete a lesson for good, with a typed reason; the lesson is kept for 30 days on the page "Deleted for good" and can be restored there. Every change of a lesson's teacher, room, time or cancel is written in the lesson's history: who, when, before and after.

**Who can do it.** The Super Admin deletes a lesson for good and restores it. The Super Admin, the Principal and the Academic Vice Principal read the history of a lesson.

**How to do it.**

1. Open Timetable, then the day of a class. "History" on a lesson lists its changes.
2. As the Super Admin, "Delete for good" on a lesson asks for the reason and deletes it. The lesson's teacher, the Academic Vice Principal and the Principal of the branch are told, also for a past lesson; they are told again when it is restored.
3. School setup, then "Deleted for good": open the lesson and press "Restore" while its 30 days last.

**Rules.**

- One lesson is deleted at a time. The other half of a double lesson stays.
- A restore brings the same lesson back, with its teacher, room and cancel, and a substitute it had with the same substitution. A lesson taught together with others comes back at the times of that block now. Every timetable rule is checked again.
- A lesson of a closed year cannot be deleted or restored.
- The history is written by the database for every change, whatever page or job made it; a change made by the system (a job) shows "The system".

**What happens if…**

- *The 30 days have passed.* The lesson stays listed but can no longer be restored.
- *A new timetable is in force on the lesson's date now.* The lesson cannot come back; add it in that timetable.
- *Its room or teacher was taken by another lesson meanwhile.* The restore is refused and the rule is named; change the other lesson first.
- *The exam that cancelled the lesson was cancelled or moved since.* The lesson cannot come back as it was.
- *Its substitution was withdrawn since, or the absence it covered was withdrawn.* The lesson cannot come back as it was.
- *The lessons it was taught together with are gone since.* The lesson cannot come back; restore them first if they were deleted for good too.
- *A new timetable or a withdraw would remove a lesson that holds attendance or marks.* It is refused for now; when the journal arrives (task 6.1) such a lesson is kept and listed instead.
