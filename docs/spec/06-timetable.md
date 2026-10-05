# Timetable

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

The timetable is generated automatically and then edited by hand in a grid, all inside the platform. It is a weekly pattern with versions, turned into dated lessons. Every rule is checked on screen, on the server and in the database, so a double booking cannot be saved by any route, whether the lesson was placed by the generator or by a person.

## Model

| Term | Meaning |
| --- | --- |
| Teaching load | For each class or group and subject: the teacher, or the vacancy that stands for a teacher not yet hired, and the lessons per week. A lesson has one teacher or one vacancy. The timetable is built from the load and checked against it. |
| Version | One weekly pattern for a branch. It is valid from a start date until the next version starts. States: draft, published, archived. |
| Pattern entry | Weekday, slot, class or group, subject, teacher, room. Repeats every week. |
| Dated lesson | A real lesson on a real date, generated from the published pattern using the academic calendar and that day's template. On publishing, dated lessons are created up to the end of the academic year, so every future lesson has a date from the first day. Days off produce no lessons. A dated lesson is one column in the journal. |
| Parallel group lessons | All groups of one subject and grade (7-M-1, 7-M-2 and so on) placed in the same period, each with its own teacher and room. Placed and moved as one block. |
| Slot | A lesson slot of the day template. A lesson always fills exactly one lesson slot. Break and lunch slots cannot hold lessons, and no lesson can have a time typed by hand. |

A timetable is not made for a month or a quarter. A version stays in force until a new version replaces it, and never runs past the end of the academic year. In practice the school publishes one version at the start of the year and a new one only when something changes: a new teacher, a changed load, a new quarter with different hours.

## Building a timetable

The builder is one screen with a checklist of steps on the left, in the manner of the Ziyoly demo but with eight steps instead of twelve. Most of steps 1 to 4 is already filled from setup and people data; the builder shows what is missing and will not generate until the data is consistent.

| Step | What the Academic Vice Principal does | Ready when |
| --- | --- | --- |
| 1. Period and day template | Confirms the day template of each weekday. The start date is chosen at step 8; a version has no end date. | Every school weekday has a template. |
| 2. Teaching load | For each class and group: subjects, lessons per week, teacher. Copied from an earlier version or year. | The weekly lessons of every class fit into the week's lesson slots, and every load has a teacher or a vacancy. |
| 3. Teachers | Availability by day and slot, most lessons per day, school days of part-time teachers. | No teacher has more lessons than free slots. |
| 4. Rooms | Main classroom of each class; special rooms by subject (laboratory, sports hall, robotics). | Every subject that needs a special room has one. |
| 5. Rules | Reviews the fixed rules, sets the weight of each preference, and pins lessons that must stay at a fixed time (for example the Homework slot at the end of the day). | Confirmed. |
| 6. Generate | Starts generation and receives one or more variants, each with a score and a list of anything not placed. | A variant is chosen. |
| 7. Edit in the grid | Drags, swaps, changes rooms and teachers, locks lessons and regenerates the rest. | The conflict panel shows no errors. |
| 8. Review and publish | Reads the impact preview, chooses the start date, publishes. Print and export. | Published. |

A draft can also be started empty or copied from any earlier version, and built entirely by hand.

## Editing in the grid

- A side panel lists what still has to be placed, from the teaching load: for example "7 Oxford, Mathematics, 4 of 6 placed".
- Lessons are dragged onto the grid, or added by clicking an empty lesson slot and choosing subject, class or group, teacher and room.
- While dragging, each slot shows free, warning or blocked, with the reason. The room picker lists only rooms that are free in that slot, best fit first.
- "Suggest a place" on a selected lesson shows the best free slots, or a swap of two or three lessons that makes room for it.
- A conflict panel lists every error and warning in the draft, with a button that jumps to the lesson.
- Undo and redo. The draft saves by itself. Several people can view a draft; one edits at a time.
- Publish: choose the start date (next Monday by default). The system shows the impact preview, then creates dated lessons from that date. A draft with errors cannot be published.

## Auto-generation

The generator is a constraint solver: a program that searches for a timetable that breaks no fixed rule and satisfies as many preferences as possible. It is not a chat-style AI model, and this is deliberate, because a solver can guarantee that no fixed rule is broken.

- **Input.** Teaching load, day templates, teacher availability, rooms, groups and splits, pinned lessons, rules.
- **Output.** A draft in the grid. The generator never publishes.
- **Same rules.** The generator and the grid use one rule engine. Whatever the generator produces is checked again by that engine before it is shown.
- **Variants.** It can produce several variants. Each has a score and a short comparison: free slots for teachers, demanding subjects late in the day, room changes.
- **Locks.** A lesson, a class, a teacher or a day can be locked. "Regenerate" changes only what is not locked, so a hand-edited timetable can be improved without losing the edits.
- **Part of the timetable.** "Generate for these classes only" and "Place the remaining lessons" work on a part and leave the rest untouched.
- **When not everything fits.** It places what it can, lists each lesson not placed and names the rule that blocks it, for example "Teacher has 26 lessons and 24 free slots". The readiness checks of steps 1 to 4 catch most such cases before generation starts.
- **Time.** It runs in the background with a progress bar: a first complete draft within about a minute, then it keeps improving until stopped or until the time limit of 5 minutes.

Preferences, each with a weight set by the Academic Vice Principal:

| Preference |
| --- |
| A class has no empty lesson slot between its first and last lesson. |
| A teacher has few empty slots between lessons. |
| Lessons of one subject are spread over the week, and not twice in a day unless a double lesson is allowed. |
| Demanding subjects (marked on the subject) are in the first slots of the day. |
| A class has a similar number of lessons each day. |
| A class stays in its main classroom when the subject needs no special room. |
| A part-time teacher's lessons fall on as few days as possible. |
| A teacher's preferred days and slots are respected. |

Later and optional (Release 2): an assistant that takes a request in plain words, such as "free Friday for this teacher", turns it into a proposed change, has it checked by the same rule engine and shows it for approval.

## Rules

| Type | Rule |
| --- | --- |
| Blocked | A teacher cannot be in two lessons at the same time. |
| Blocked | A room cannot hold two lessons at the same time, unless the room is marked as shared (for example a sports hall). |
| Blocked | A class cannot have two lessons at the same time. No student can be in two lessons at once; this covers a class lesson against a group lesson, and two groups that share a student. |
| Blocked | A teacher cannot be placed outside the days and hours in their availability. |
| Blocked | No lesson on a day off, outside the academic year, or outside that day's lesson times. |
| Blocked | The teacher must have that subject and grade in their profile. Inactive teachers, subjects and rooms cannot be used. |
| Blocked | The teacher must be able to teach in the language of the class or group, unless the subject is outside the language rule. |
| Blocked | A vacancy is bound by every blocked rule that binds a teacher: one place at a time, availability, subject and grade, language. The warnings on contract load and lessons per day apply to it as to a teacher. A vacancy is never offered as a substitute and never shown as free. |
| Blocked | Between a teacher's lesson in one branch and their next lesson in another branch there is at least the travel time set for those two branches. |
| Blocked | A lesson fills exactly one lesson slot of the day template. It cannot be placed in a break or lunch slot, across two slots, or at a time typed by hand. |
| Blocked | All groups or parts of one split are in the same slot, so that every student of the class has a lesson at that time. |
| Warning | Room capacity is smaller than the class or group. |
| Warning | Teacher's weekly lessons exceed the contract load. |
| Warning | A class has more lessons in a day than the daily maximum in settings. |
| Warning | The same subject twice in one day for a class; a free period in the middle of a class's day. |
| Warning | Lessons placed per week differ from the teaching load. This is a warning while editing a draft and blocks publishing, unless the load row is marked "deliberately short" with a reason. |

## Teachers who work in several branches

- **One person, one account.** The staff record lists a main branch and the other branches where the person works. The Teacher role is given per branch.
- **Home page.** Today's lessons from all branches appear together in time order, each labelled with its branch. Teaching needs no branch switching.
- **Availability per branch.** For each branch: the days and hours the teacher is there. Hours in two branches cannot overlap. Each branch's Academic Vice Principal edits the hours of own branch and sees the others read only.
- **Travel time.** The Super Admin sets the travel time between each pair of branches. A lesson in one branch and the teacher's next lesson in another must be at least that far apart. This is blocked in the grid, in the generator and on the server.
- **One clash check.** A teacher cannot be in two lessons at once, counted across all branches by clock time, also when the branches use different day templates.
- **Busy elsewhere.** In a branch's timetable the teacher's lessons in other branches show as grey blocks marked with the branch. They cannot be moved from here, and the generator treats them, and the travel time around them, as fixed.
- **Two drafts at once.** When two branches prepare drafts that use the same teacher at the same time, each grid warns that the teacher is also planned in a draft of the other branch. The first to publish stands; the second cannot publish the clashing lessons until they are moved.
- **Weekly load.** Each Academic Vice Principal sets the load in own branch. The teacher's total across branches is shown to both and compared with the contract load.
- **Absence.** An absence is entered once for the person and covers every branch. Each branch's Academic Vice Principal gets the list of own affected lessons and arranges substitutes; the other is told.
- **Leaving or going inactive.** The system lists the future lessons in every branch, and each Academic Vice Principal settles own.
- **Journals, plans and quarters.** A journal belongs to one branch. Plan windows, edit periods and quarter closing follow the branch of the lesson, so the teacher may have different dates in each.
- **Days off.** A day off in one branch does not cancel the teacher's lessons in another.
- **Reports.** A branch's reports count only what was taught in that branch. The teacher's own profile shows all branches.
- **Notices.** Every notice to the teacher names the branch.

## Changes after publishing

- **One-day change.** Replace the teacher, change the room, move to another slot or day, or cancel. Every one-day change needs a reason, applies to that date only and passes the same rules. Replacing the teacher is not a separate action: it is always done as a substitution, described next.
- **Substitution.** The one way to put another teacher on a lesson. It can be started from a single lesson (pick a substitute for it) or from a teacher (mark them absent for one or more dates). In the second case the system lists all their lessons in the period and, for each, suggests teachers who are free in that slot: same subject first, then same department. Teachers who cannot teach in the class's language are listed last and marked. Either way one substitution record is kept: who was replaced, by whom, for which lessons and why. The substitute can enter and edit that lesson's column for the normal edit period. The rule check has one exception, described under Edge cases: when no teacher of the subject is free.
- **Bulk cancel.** For an event: chosen classes, date and slots, with a reason.
- **Extra lesson.** A one-day lesson added on a date; it appears in the journal like any other.
- **Filling a vacancy.** When the teacher is hired, the Academic Vice Principal fills the vacancy with the person from a date, tomorrow at the earliest, for all of its load rows or the chosen ones. It is a permanent change: the system prepares and publishes a version that differs from the live one only in the teacher of those rows, with the impact preview and every rule of publishing. Every later published version that still names the vacancy is changed in the same way from its own start date, in the same step and the same preview; an open draft is marked out of date. The person must have the subject, grade and language of each row and be free at every dated lesson of the row from the fill date, in every branch, by the rules of publishing; a row with a blocked date stays with the vacancy and is listed, and the fill goes ahead for the rest. Lessons from the date go to the teacher as in "Teacher changed"; lessons already held under a substitute stay recorded under the substitute. A vacancy with no load left is closed.
- **Permanent change.** Prepared in a draft, by hand or by regenerating, and published as a new version from a start date.

## What a change does to existing data

The rule behind every row: the past is never rewritten, and a journal belongs to a class or group and a subject, not to a time or a teacher.

| Change | Lessons already held | Lessons from the start date | Journal and results |
| --- | --- | --- | --- |
| Lesson moved to another day or slot | Unchanged | Created at the new time | Same journal. Only the dates of future columns differ. |
| Room changed | Unchanged | Updated | No effect. |
| Teacher changed | Stay recorded under the teacher who taught them | Given to the new teacher | Same journal. The new teacher may edit any lesson not yet locked. The earlier teacher can edit the lessons they taught until those lock, while the account is active, and keeps read access afterwards. |
| Lessons per week changed | Unchanged | More or fewer columns | Same journal. Averages are means, so the number of lessons does not distort results. |
| Subject added to a class during the year | None | Created from the start date | A new journal starts on that date. |
| Subject removed from a class | Kept | Removed, if they hold no data | The journal is closed and stays readable. The quarter result uses the lessons that were held. |
| Group or split membership changed | Unchanged | New members from the transfer date | Handled as a transfer: results follow the student. |
| Day template changed (lengths, breaks, order) | Keep the times they were held at | Take the new times | No effect. |
| Earlier version restored | Unchanged | Created again from the earlier pattern | Lessons that already hold data are kept and listed. |

## How surprises are prevented

- **Draft, then publish.** The live timetable is never edited in place. A permanent change is prepared in a draft and published in one step, so nobody sees a half-changed timetable.
- **The past is closed.** Publishing or regenerating cannot change any lesson dated today or earlier. Today's lessons change only through a one-day change with a reason. A past lesson can only be corrected one at a time by the Academic Vice Principal, with a reason.
- **Impact preview.** Before publishing, the system lists the teachers, classes and rooms affected, the lessons that will be created, moved and removed, any lesson holding data that blocks a removal, and who will be notified.
- **Start date.** A permanent change starts on a chosen date, next Monday by default and tomorrow at the earliest. A change for today goes through a one-day change with a reason.
- **Out-of-date draft.** If the live timetable changed after a draft was started, the draft must be brought up to date before publishing; the differences are shown.
- **Everyone is told.** Each affected teacher receives a notice showing before and after. Changed lessons carry a "changed" mark on every timetable view for a week. Students and parents are told from Release 2.
- **No lesson without a teacher or room.** When a teacher's status is set to inactive or left from a date, or a room is closed, the system lists the future lessons that depend on them and asks for a replacement, or marks them "needs a teacher" or "needs a room" on the Academic Vice Principal's home page. An account can always be locked at once, whatever lessons remain. A dated lesson of a vacancy keeps the vacancy as its teacher and is "needs a teacher" from the day it is created; a substitute is recorded on it as for an absence.
- **One source.** The platform always shows the timetable in force on the date being viewed. Printed and exported timetables carry the version number and "valid from" date, so an old printout can be recognised.
- **Lesson plans follow.** Topics stay attached to lessons in order when lessons move.
- **Withdraw.** A published version can be withdrawn only before its start date. After that, a correction is a new version.

## Protection

- A dated lesson that already has attendance or marks cannot be deleted and cannot change its class, group or subject. Its teacher, room and time can change, with a log entry.
- Forced delete is for Super Admin only, with a typed reason. The attendance and marks are kept for 30 days and can be restored.
- Version history shows every version, compares two versions, and can reopen an old one as a new draft.
- Every change records who, when, the value before and the value after.

## Views and outputs

- Teacher home page: today's lessons as a list (period, time, class or group, subject, room, button to open the journal) and the week as a table.
- Views by class, by teacher, by room and the whole school; by day and by week.
- Tutors see their class; Head Teachers and Senior Head Teachers the teachers of their subjects; Principal and Vice Principals the whole branch; students and parents their own week in Release 2.
- Print, PDF and Excel for one class, one teacher, one room or the whole school.
- Load report: lessons per week for each teacher against contract, lessons per subject for each class against the load, room use in percent, free periods.
- When a published timetable changes, the affected teachers are notified at once; students and parents from Release 2.

## Free now board

A board for one date, today by default, showing for each lesson slot which teachers and which rooms are free. The Academic Vice Principal acts from it. Head Teachers and Senior Head Teachers see it read only, for the teachers of their subjects.

- **Free teacher.** At school that day by their availability, not in a lesson in that slot, and not marked absent. The board can be filtered by department and subject.
- **Free room.** In use status, with no lesson in that slot. It can be filtered by type and capacity.
- **Acting from the board.** Clicking a free teacher on a lesson that needs one assigns a substitute. Clicking a free room moves a lesson there for that day. Both are one-day changes, ask for a reason and pass the same rules.
- **Different day templates.** Where ranges of grades have different slot times, "free" means no overlap in real time.
- **Fair load.** Beside each free teacher the board shows how many substitutions they have taken this month.
