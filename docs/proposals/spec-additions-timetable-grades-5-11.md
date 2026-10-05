# Spec additions from the grades 5–11 timetable (Istirohat, variant 13)

Proposal as submitted. The spec and docs/spec-changes.md hold the final wording; sections were amended while being applied.

Five changes to `docs/spec/`, decided by the owner on 5 October 2026 after reading the
higher-grade timetable and discussing versions and availability. Each section gives the
exact wording. Apply each with `/spec-change` on the branch `spec/timetable-grades-5-11`,
one commit per section, in this order. Where a sentence is quoted as "old", replace it
word for word.

Build-plan edits (not spec) are listed at the end and go in the same pull request.

---

## 1. Vacancies: a load row for a teacher not yet hired

**Why.** The school places lessons for teachers it has not hired yet ("Vakant (Eng)",
"ENG VAKANT 2"). One vacancy name stands for one future person, so its lessons must
not overlap. Today the spec refuses to generate until "every load has a teacher".

### `docs/spec/04-people.md`, section "Teacher and staff record"

Add this bullet after the bullet that starts "In Release 1 the Super Admin creates staff accounts":

- **Vacancy.** A vacancy is a staff record that stands for a teacher not yet hired: a name such as "English vacancy 2", one branch, subjects with the grades taught, languages of instruction, availability and contract load, and nothing personal. It has no account, no category and no roles; it cannot be a Tutor, a Head Teacher or hold any assignment. The Academic Vice Principal of the branch creates, edits, fills and closes it. The teacher list shows vacancies in a section of their own, and exports leave them out unless asked. Status: open, filled (with the date and the person), closed. A vacancy that never held a load can be deleted; one that did is closed and kept.

### `docs/spec/05-classes-groups-subjects.md`, table row "Teaching load"

Fields column, old: "Class or group, subject, one teacher, lessons per week, the room or room type if a special one is needed, whether double lessons are allowed."
New: "Class or group, subject, one teacher or one vacancy, lessons per week, the room or room type if a special one is needed, whether double lessons are allowed."

Rule column, add at the end: "A vacancy can be chosen under the same conditions as a teacher: subject, grade and language."

### `docs/spec/06-timetable.md`

Model table, row "Teaching load", old: "For each class or group and subject: the teacher and the lessons per week. A lesson has one teacher. The timetable is built from the load and checked against it."
New: "For each class or group and subject: the teacher, or the vacancy that stands for a teacher not yet hired, and the lessons per week. A lesson has one teacher or one vacancy. The timetable is built from the load and checked against it."

Building table, step 2, "Ready when", old: "The weekly lessons of every class fit into the week's lesson slots, and every load has a teacher."
New: "The weekly lessons of every class fit into the week's lesson slots, and every load has a teacher or a vacancy."

Rules table, add a Blocked row after "The teacher must be able to teach in the language…":
"| Blocked | A vacancy is bound by every rule that binds a teacher: one place at a time, availability, subject and grade, language, contract load. A vacancy is never offered as a substitute and never shown as free. |"

Section "How surprises are prevented", bullet "No lesson without a teacher or room", add at the end: "A dated lesson of a vacancy is "needs a teacher" from the day it is created; the Academic Vice Principal arranges substitutes for it as for an open-ended absence."

Section "Changes after publishing", add a bullet after "Extra lesson":
"- **Filling a vacancy.** When the teacher is hired, the Academic Vice Principal fills the vacancy with the person from a date, tomorrow at the earliest, for all of its load rows or the chosen ones. It is a permanent change: the system prepares and publishes a version that differs from the live one only in the teacher of those rows, with the impact preview and every rule of publishing. The person must have the subject, grade and language of each row and be free at each of its times in every branch; a row that fails is left with the vacancy and listed. Lessons from the date go to the teacher as in "Teacher changed"; lessons already held under a substitute stay recorded under the substitute. A vacancy with no load left is closed."

### `docs/spec/edge-cases/timetable.md`, section "After publishing", add three rows

"| A class needs English from September; the teacher is hired in October. | The load row names a vacancy (People, "Vacancy"). The generator and every clash rule treat it as a teacher, so its lessons never overlap and lie within its availability. Its dated lessons are "needs a teacher" from creation, substitutes are arranged as for an open-ended absence, and a lesson whose time passes with nobody assigned stays "unresolved". Publishing with vacancies is allowed; the impact preview and the load report show the lessons per week under each vacancy. |"

"| The teacher is hired for half of the vacancy's rows. | Filling takes the chosen rows and leaves the rest with the vacancy. A second vacancy for the same subject is a second placeholder with its own name; the two never share a lesson. |"

"| The plan, the journal and the reports of a vacancy's subject. | The journal belongs to the class or group and the subject and opens at publish as usual. Nobody writes its plan until the vacancy is filled: the plan window lists it as "vacancy", not as overdue against anyone, and the hired teacher becomes the plan's owner. Lessons taught by substitutes count for the substitutes. Nothing is ever counted against a vacancy, and a vacancy never appears in a journal, a notice or the Free now board. |"

### `docs/spec/edge-cases/developer-rules.md`, row "Teacher in one place"

Add at the end of the How column: "A vacancy is a staff record, so the same constraint covers it."

### Checked against

- "A lesson has one teacher" (06 Model): kept; a vacancy takes the teacher's place in the row.
- "Archive, do not delete": a vacancy with a load is closed and kept.
- Substitution and "needs a teacher", "unresolved", open-ended absence: reused, not duplicated.
- "The live load is read only; it changes only in a draft": filling publishes a version.
- "The past is closed": filling starts tomorrow at the earliest.
- Lesson plans "The teacher of the class changes": the hired teacher becomes the owner.
- Roles: a vacancy has no account and no assignment, so no permission row changes.
- No personal data: a vacancy carries none.

---

## 2. A group across two consecutive grades

**Why.** Physical education joins a grade-9 and a grade-10 class ("Jismoniy (9T+10F)").
The spec allows a group "from several classes of one grade" only.

### `docs/spec/05-classes-groups-subjects.md`, table row "Group"

Fields column, old: "Subject, grade, name (7-M-1), language, teacher, maximum size."
New: "Subject, grade or two consecutive grades, name (7-M-1), language, teacher, maximum size."

Rule column, old sentence: "A group across classes takes students from several classes of one grade (7-M-1, or a third English group made from 1 Oxford and 1 Princeton)."
New: "A group across classes takes students from several classes of one grade (7-M-1, or a third English group made from 1 Oxford and 1 Princeton), or of two consecutive grades (physical education for 9 Edinburgh and 10 Brown together)."

### `docs/spec/06-timetable.md`

Model table, row "Parallel group lessons", old: "All groups of one subject and grade (7-M-1, 7-M-2 and so on) placed in the same period, each with its own teacher and room."
New: "All groups of one subject and grade, or pair of consecutive grades, (7-M-1, 7-M-2 and so on) placed in the same period, each with its own teacher and room."

Rules table, Blocked row, old: "The teacher must have that subject and grade in their profile. Inactive teachers, subjects and rooms cannot be used."
New: "The teacher must have that subject and every grade of the class or group in their profile. Inactive teachers, subjects and rooms cannot be used."

### `docs/spec/edge-cases/timetable.md`, section "Structure", add one row after "The sports hall holds two classes at once"

"| Physical education joins a grade-9 and a grade-10 class. | A group may take students of two consecutive grades. Its block is placed like any other, so both classes are free in those slots. The two classes must share the day template on every school day, and the subject must be taught in both grades; otherwise the load step refuses the group, because a slot of one template is not a slot of the other. The teacher's profile must have the subject in both grades. |"

### Checked against

- The block rule ("every student of its classes is in exactly one of its lessons"): unchanged and sufficient.
- "Every clash check uses real clock time": the shared-template condition keeps a block in one set of slots.
- Results follow the student; grade bands are fixed for the whole school; subject weights belong to the subject: a cross-grade journal needs no new calculation rule.
- Year rollover: groups belong to a year and are made again.
- Membership constraint "one group per student per subject per date": unchanged.

---

## 3. Which day template wins

**Why.** The spec allows a template for a weekday and a template for a range of grades
but not how they combine. At the school, Friday is one template for every grade, while
Monday to Thursday differ by grade.

### `docs/spec/03-school-setup.md`, table row "Slot types and day templates"

Old last sentence: "A branch has a default template; another template can be set for a weekday, for a special date in the calendar, and for a range of grades inside the branch."
New: "A branch has a default template; another template can be set for a range of grades inside the branch, for a weekday, for a weekday and a range of grades together, and for a special date in the calendar. For a class on a date, the first of these that applies wins: the special date, then weekday with grade range, then weekday, then grade range, then the default. Grade ranges set at one level may not overlap."

### `docs/spec/edge-cases/time-dates-calendar.md`, add one row after "A slot type's length or a day template is changed mid-year"

"| Friday is the same for every grade, but Monday to Thursday grades 9–11 have lunch one slot later. | The Friday template is set for the weekday and the senior template for grades 9–11. On Friday the weekday template wins for every grade; on the other days grades 9–11 take theirs and the rest take the default (School setup, day templates, gives the full order). A template set at any level follows the rule for a change mid-year above. |"

### Checked against

- Calendar entries "apply to the whole branch or to a range of grades": a special date stays first and may itself be per grade range.
- "A template change mid-year … rechecked from a chosen date": applies to every level.
- The Free now board and clash checks by clock time: unchanged.

---

## 4. Exams in the timetable

**Why.** The school holds English, mathematics and other exams in the middle of the week in
place of regular lessons. Today the spec can only cancel the lessons; the exam itself, its
rooms and its invigilators would live on paper, unchecked for clashes.

### `docs/spec/06-timetable.md`

Section "Changes after publishing", add a bullet after "Bulk cancel":
"- **Exam.** A timetabled exam on one date: a title, a subject if it has one, one or more consecutive lesson slots of the day template (the breaks between them included), the classes that sit it, and one or more rooms, each with its invigilators. It replaces the regular lessons of those classes in those slots: they are cancelled with the reason "exam" in the same save and come back if the exam is cancelled. An exam passes every blocked rule as a lesson does: an invigilator cannot be in a lesson or another exam at that time, a room cannot hold a lesson or another exam at that time unless shared, and a class cannot have a lesson at that time. Availability and subject of an invigilator are warnings with a tick, as for a one-day change. It is shown on every timetable view and printout, marked "exam", and the affected teachers are notified as for a one-day change. It has no journal column and no plan item. The Academic Vice Principal creates, changes and cancels exams, from today on and only in slots that have not started; a past exam is kept as history."

Rules table, add a Blocked row at the end:
"| Blocked | An exam counts as a lesson for its invigilators, its rooms and its classes in the rules above. |"

### `docs/spec/edge-cases/timetable.md`, add a section "Exams" after "After publishing"

"## Exams

| Case | Rule |
| --- | --- |
| An English exam for the grade-10 classes on Wednesday in slots 3 and 4. | The Academic Vice Principal adds an exam with the date, the slots, the classes, and the rooms with their invigilators. The classes' own lessons in those slots are cancelled with the reason "exam" as part of the same save, so their plan items shift as after any cancellation and their teachers are freed. Lessons of other classes in the chosen rooms, and lessons of the invigilators, are not touched: they are listed, and the exam is refused until they are moved or cancelled. |
| A group sits an exam. | A group sits an exam only in the slots of its own lesson, which the exam replaces; the other groups of the block keep their lessons, so every student still has one place. At any other time an exam names whole classes. |
| Classes on different day templates sit the same exam. | All classes of one exam share the day template of that date; otherwise two exams are made. The exam's start and end are those of its slots, never typed. |
| An exam room is closed, an invigilator falls ill, the date becomes a day off. | A room closure, an absence and a day off act on an exam as on a lesson: "needs a room" and "needs an invigilator" on the Academic Vice Principal's home page, settled from the Free now board with no journal involved; a day off removes the exam and tells the Academic Vice Principal. An exam is stored on its own like a one-day change: a later publish keeps it, and the preview lists it. |
| The exam is the quarter's rating exam. | An exam can be linked to the rating exam of the journals of its classes and subject; their rating exam date is then the exam's date. Attendance at an exam is not recorded in Release 1; "did not sit" in the rating column stays the teacher's entry. |
| Who sees exams, and what they count for. | Every timetable view and print shows exams for its class, teacher or room; students and parents see their own from Release 2. Invigilations are listed in the load report apart from lessons and count for no journal, no plan and no discipline figure. |"

### `docs/spec/edge-cases/developer-rules.md`, add a row after "Class in one block"

"| Exams | An exam sitting is stored with the same start, end, room, teacher and class columns as a lesson, in the same tables, so the exclusion constraints for teacher, room and class cover exams without a second rule. |"

### Checked against

- "Bulk cancel" and "A lesson that already has attendance must be cancelled": an exam cancels only lessons in slots that have not started, so no held lesson is touched.
- "A cancelled lesson is restored … every rule is checked again": cancelling an exam restores lessons by that rule.
- Lesson plans: "A future lesson is cancelled … its item moves to the next lesson": an exam's cancellations shift plans by the existing rule.
- Journal: "Future and cancelled lessons have no status": an exam adds no column.
- The rating exam (calculation edge cases): its date "set by the teacher or the Academic Vice Principal" is what the link sets.
- One-day changes "stored on their own and applied again after a publish": exams join that list.
- "No lesson on a day off": an exam is removed by a day off.
- Shared rooms: an exam counts towards the room's maximum like a lesson.
- Notices: "as for a one-day change", so the one-notice-per-person rule holds.

---

## 5. Versions by quarter, and availability that changes mid-year

**Why.** The school plans a timetable per quarter, sometimes all four at once, and a
teacher's hours can change from a date in the middle of a version. The chain of versions
already does this; two things make it reliable: quarter shortcuts with a view of which
version is in force at each quarter, and a clear rule for availability entries that begin
after a version's start date, so versions can be published in any order.

### `docs/spec/06-timetable.md`

Section "Editing in the grid", bullet "Publish", old: "Publish: choose the start date (next Monday by default). The system shows the impact preview, then creates dated lessons from that date. A draft with errors cannot be published."
New: "Publish: choose the start date — next Monday by default, the first day of a coming quarter as a shortcut, or any date. The system shows the impact preview, then creates dated lessons from that date. A draft with errors cannot be published."

Section "How surprises are prevented", bullet "Start date", old: "A permanent change starts on a chosen date, next Monday by default and tomorrow at the earliest. A change for today goes through a one-day change with a reason."
New: "A permanent change starts on a chosen date, next Monday by default and tomorrow at the earliest, with the first day of each coming quarter offered as a shortcut. A change for today goes through a one-day change with a reason."

Section "Protection", bullet "Version history", old: "Version history shows every version, compares two versions, and can reopen an old one as a new draft."
New: "Version history shows every version in the order of their start dates, names the version in force on the first day of each quarter, compares two versions, and can reopen an old one as a new draft."

Rules table, Blocked row, old: "A teacher cannot be placed outside the days and hours in their availability."
New: "A teacher cannot be placed outside the days and hours in their availability. A draft is checked against the availability entry in force on the version's start date; dates on which a later entry applies are checked at publish and listed as warnings by date, because a version from that date is expected."

### `docs/spec/edge-cases/timetable.md`

Section "Versions and drafts", row "The pattern is valid but one date is not…", old rule: "Publish, a calendar change and a template change each test every affected date with the full rule set. A blocked conflict on any date stops the save and is listed by date."
New: "Publish, a calendar change and a template change each test every affected date with the full rule set. A blocked conflict on any date stops the save and is listed by date. The one exception is availability on dates covered by a later availability entry, which is a warning (see "A part-time teacher stops working Fridays from December")."

Section "After publishing", row "A part-time teacher stops working Fridays from December.", old rule: "Availability carries a start date. Future lessons outside it are flagged for the Academic Vice Principal; they are not removed."
New: "Availability carries a start date, so a teacher has a list of entries, each from a date, and history shows which applied when. Future lessons outside a new entry are flagged for the Academic Vice Principal; they are not removed. A publish whose dates run into a later entry lists those dates as warnings, not as a block, so a version for September and a version for November can be published in either order."

Section "Versions and drafts", add one row after "A version is published to start on 1 December…":
"| The Academic Vice Principal publishes the four quarters in one afternoon. | Four versions, one per quarter start date, each drafted from the one before so unchanged lessons keep their identity. They form the chain. A later fix published from a mid-quarter date asks the question of the row above: run until the next version starts, or replace the versions that follow. |"

### Checked against

- "A version is valid from a start date until the next version starts" and "a version has no end date": unchanged; nothing here gives a version an end date.
- "Published versions form a chain ordered by start date … run until that version starts, or replace it": reused for the mid-quarter fix.
- "A new version leaves most future lessons unchanged … keeps its identity": why each quarter draft starts from the previous version.
- "Hours in two branches cannot overlap" and travel time: unchanged; each entry is checked the same way.
- "Teacher in one place" (developer rules): unchanged; availability is not a database constraint.

---

## Build plan edits (same pull request, not spec)

- **1.5 Slot types and day templates**: add "the order in which a special date, weekday with grade range, weekday, grade range and the default decide the template of a class on a date".
- **2.2 Staff records**: add "vacancies (a staff record for a teacher not yet hired; no account, no roles)".
- **3.2 Groups and splits**: add "a group across two consecutive grades, refused unless the classes share the day template".
- **3.4 Teaching load**: add "a load row may name a vacancy".
- **5.1 Data model and database constraints**: add "exam sittings share the lesson tables and constraints".
- New task after 5.6b: **5.6c Exams in the timetable** — Read: `06` (Changes after publishing, Exam), `edge/timetable` (Exams). Build: create, change and cancel an exam; cancellation of the classes' lessons in the same save; refusal while other lessons hold the rooms or the invigilators; the rating-exam link; exams on every view and print; notices. Done when: an exam cannot be saved with a double-booked invigilator or room, and cancelling it restores the lessons.
- **5.6a One-day changes** or **5.7a Teacher absence**: add "filling a vacancy publishes a version that changes only the teacher of its rows".
- **5.3 Draft builder, steps 1 to 5**: add "availability as dated entries; a draft checks the entry in force on its start date".
- **5.5a Publish: preview and checks**: add "quarter shortcuts for the start date; dates under a later availability entry are warnings by date".
- **5.8 Protection and version history**: add "the version in force on the first day of each quarter".
