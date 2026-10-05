# Lesson plans

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

Every teacher must have a lesson plan for each class or group they teach, for each quarter. A plan is a list of lessons in teaching order. Each item is attached to a dated lesson from the timetable, so the plan and the journal always show the same thing.

## What a plan contains

| Field | Notes |
| --- | --- |
| Lesson number | Order within the quarter. Given by the system. |
| Date | The date of the dated lesson this item is attached to. Taken from the timetable, never typed. |
| Topic | Required. |
| Classwork | Optional. The graded work done in class. Becomes the title of the classwork column in the journal. A lesson with no classwork has no classwork column. |
| Homework | Optional. The task given at this lesson. A lesson can have no homework; then the next lesson has no homework column. |
| Objectives and materials | Optional: short text, files, links. |

- One plan for each class or group, subject and quarter. The form shows one row for every dated lesson of the quarter, with number and date already filled; the teacher fills in the rest.
- A teacher who teaches the same subject to several classes of one grade (7 Oxford and 7 Princeton) can share one plan between them, if the classes have the same language of instruction. It is written once, and each class has its own dates. A shared plan can be separated later.
- A group of two grades (Classes, groups and subjects, "Group") has its own plan like any group. Where a plan rule names a grade, both of its grades count: the plan can be copied from a master or a plan of either grade, can be shared only with groups of the same two grades and language, is readable by teachers who have the subject and either grade in their profile, and appears under both grades in the Head Teacher's side-by-side view.
- A plan can be copied from another class, from another teacher of the same subject and grade, or from last year.
- A plan is complete when every lesson of the quarter has a topic. Classwork and homework can be left empty for any lesson.
- A plan is required for every graded subject. Attendance-only subjects, which are the Homework slot and Ma'naviyat soati, have no plan. This is not a setting.

## Master plans

A Head Teacher can keep a master plan for one of their subjects, a grade, a language of instruction and a quarter: the same list of topics, classwork and homework, in order, but with no dates. A Senior Head Teacher can keep one master for all branches. For subjects with no Head Teacher, the Academic Vice Principal can keep it.

- **Starting from the master.** A teacher creates a plan as a copy of the master. Its items fill the rows of the class in order.
- **Different number of lessons.** If the class has more lessons than the master has items, the last rows stay empty for the teacher to fill. If it has fewer, the items left over are listed for the teacher to merge during the window.
- **Independent copy.** After copying, the teacher's plan is their own. Changing it does not change the master, and a master changed later does not change existing plans.
- **Master updated.** Teachers who copied it see "master updated" with a side-by-side comparison. Taking the changes is free inside the window and needs an edit request after it.
- **Not tied to the window.** The Head Teacher can edit the master at any time; its history is kept.
- **Optional.** Teachers may start from the master, from a copy, or from an empty plan.
- **Parallel classes.** The Head Teacher sees all classes of a grade side by side with the item each has reached.
- **New year.** Masters are copied into the new academic year.

## The plan window

- The Academic Vice Principal opens a window for a quarter: a start date and an end date. It can be opened only when the timetable covering that quarter is published, because the lessons need dates.
- Inside the window teachers create and edit their plans freely.
- Teachers are reminded when the window opens, three days before it ends, and on the last day if the plan is incomplete.
- When the window ends, every plan is locked.
- A plan that is incomplete at that moment is locked like the others and listed as overdue. The teacher completes it through an edit request.
- A missing plan never blocks the journal. Attendance and grades can always be entered.
- The Academic Vice Principal can extend the window for one teacher, for example after illness or for a new teacher.

## Editing after the window

1. The teacher sends an edit request: which lessons, and the reason.
2. The Head Teacher of the subject in that branch approves or refuses it. The Senior Head Teacher of the subject and the Academic Vice Principal can approve any such request, and are the only approvers for subjects with no Head Teacher and for a Head Teacher's own plans.
3. When approving, the approver sets how many days the chosen lessons stay open for editing. After that they lock again.
4. Every change after the window is kept in history: old text, new text, who approved. If the item of a lesson already held is changed, it carries an "edited after the lesson" mark.

Nothing opens without an approved request, also when the school itself caused the change. To keep this from becoming a chore:

- **Requests prepared by the system.** When a change leaves a plan needing work (items not covered, empty rows after lessons were added, a new teacher taking over), the system prepares the edit request for the teacher with the affected lessons and the reason already filled in. The teacher only sends it.
- **Approving together.** The approver can approve all requests caused by one event, for example a new day off, in one step and set the number of days once.

## In the journal

- The header of each lesson shows the lesson number and the topic, shortened to fit. Clicking it opens the lesson card: number, date, slot, topic, classwork, homework, objectives, materials.
- Columns follow the plan. A lesson has a classwork column only if its plan item has a classwork, and a homework column only if the previous lesson's plan item has a homework. A lesson with neither shows attendance only; no empty columns are shown. The titles come from the plan, so to grade a work the teacher only sets the total and types the numbers. If a planned work was not done or not checked, the teacher marks it "not held" and its column is removed from that lesson; this is kept in history. A work that was not in the plan is added through a plan edit request.
- The lesson card shows two homework lines: "given today", from this lesson's plan item, and "checked today", the task given at the previous lesson, which is what the homework numbers of this lesson refer to.
- Future lessons are shown as columns with number and topic, so the teacher sees what comes next. Nothing can be entered in them.
- In lesson mode on a phone, topic, classwork and homework are at the top of the screen.
- The plan is read only in the journal. It is changed only in the plan, inside the window or through an approved request.
- Students and parents see the topic and the homework from Release 2.

## When something else changes

One rule: plan items follow the lessons in order. The items of lessons already held never move.

| What changes | What happens to the plan |
| --- | --- |
| A future lesson is cancelled: one-day cancel, bulk cancel, a new day off | Its item moves to the next lesson of that class and the following items move one step. This happens by itself and is not an edit. Items that no longer fit in the quarter go to a "not covered" list at the end of the plan, and the system prepares an edit request for the teacher. The teacher and the Head Teacher are told. |
| A lesson is cancelled after its date | Its item moves to the next lesson not yet held; later items move from there. Lessons already held keep their items. |
| An extra lesson is added | Nothing moves, unless the extra lesson is marked as replacing a cancelled lesson of the same quarter. An unmarked extra lesson has a topic typed by the teacher; using it to catch up on the plan needs an edit request. |
| A lesson moves to another day or slot | Only the dates change. Items stay in date order. |
| Lessons per week or quarter dates change | Fewer lessons: the last items go to "not covered". More lessons: empty rows appear at the end. In both cases the plan stays locked and the system prepares an edit request for the teacher. |
| The teacher of the class changes | The plan stays with the class and the new teacher becomes its owner. It stays locked; the system prepares an edit request so that the new teacher can adjust the future lessons. The part taught earlier stays readable. |
| A substitute takes one lesson | The substitute sees the item of that lesson and cannot edit it. |
| One class of a shared plan loses a lesson | Each class has its own dates, so the classes stand at different items. The plan screen shows where each class is. |
| A group is split or merged, or a new group is formed | The new group gets a copy of the plan it came from, attached to its own lessons. The old group's plan is archived with its journal. |
| A subject is removed from a class | The remaining items are marked "not covered" and the plan is closed with the journal. |
| The timetable is replaced before the quarter starts | Items are attached to the new dated lessons in the same order. |
| A student is transferred or exempt | No effect. |
| A new academic year starts | Plans stay with their year and can be copied into the new one. |

"Not covered" items are never dropped silently. With an approved edit request the teacher merges them into other lessons or carries them into the next quarter's plan.

## Reports

- **Completeness.** For each teacher, department and branch: complete, incomplete (with the number of lessons that have no topic), not started, overdue.
- **Progress.** Lessons planned against lessons held; classes behind the plan; items not covered.
- **Edit requests.** Number per teacher, who approved, what was changed.
