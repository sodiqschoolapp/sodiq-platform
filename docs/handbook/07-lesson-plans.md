# Lesson plans

Not written yet for most of the plans: plans and their items, shared plans, the window, edit requests and master plans (tasks 7.1a to 7.3) have no page here yet. This page holds the parts that tasks 8.8 and 9.2d added.

## A work added after the lesson

<!-- Sources: edge/lesson-plans (Plans and the journal: "Adding a work is allowed, and the approval also opens that journal column for the same days"); task 8.8, decision 3, plan review correction 2 -->

**What it is.** When an approved edit request adds a classwork or a homework to a lesson already held, the journal column of that work opens for the request's days, also after the lesson's edit period.

**Rules.**

- The column opens for the lesson's teacher only, until the request's period ends or the teacher presses **Finished**.
- A homework added to a lesson is graded at the next lesson, where its column is.
- Entries made this way are late entries; they count against nobody.
- Other works of the same lesson stay locked.

## Minimum works per quarter

<!-- Sources: edge/lesson-plans ("A plan has 40 topics and not one graded work"); task 8.8, decision 11 -->

**What it is.** The Academic Vice Principal sets for each subject how many classworks and homeworks a plan must hold in a quarter. Lesson plans → Plan windows → **Minimum works per quarter**.

**Rules.**

- 0 is no minimum. A minimum is a whole number from 0 to 100.
- The count is every classwork and homework of the items on the plan's rows, "not held" ones included.
- A plan below the minimum shows "Below the minimum works" on the plans list, the plan page and the completeness report once its window has ended.

## Items not covered at the end of the quarter

<!-- Sources: edge/lesson-plans ("Items are still 'not covered' at the end of the quarter"); 09 ("'Not covered' items are never dropped silently"); 07 (Closing a quarter); task 9.2d, decisions 1 to 14 -->

**What it is.** An item that no longer fits in the quarter is listed under **Not covered** on the plan page. Each such item gets one outcome: merged into a lesson, carried into the next quarter, or dropped with a reason.

**Rules.**

- **Merge into a lesson** (the plan's teacher): choose a lesson of the quarter. An empty lesson takes the item. A lesson with an item takes its topic (joined with "; "), objectives, links and works. A lesson already held gets the "edited after the lesson" mark. Inside the window this is free; after it, it needs an approved edit request.
- **Carry to next quarter** (the plan's teacher, the same window or request): the item waits under **Carried in** on the next quarter's plan of the same class or group. From there the teacher places it at a lesson with **Place at a lesson**; the items after it move one lesson on, up to the first empty one. A carried-in item that is never placed counts as not covered of that quarter too.
- **Drop** (the approver of the teacher's edit requests only: the subject's Head Teacher, the Senior Head Teacher or the Academic Vice Principal): a reason is required. Nobody drops in their own plan. Removing a not-covered item any other way (the order of the rows, "Clear") is refused.
- In a shared plan the outcome is per class: an item not covered in one class keeps its place in the other. It cannot be merged into a lesson that holds an item while the other class still has it at a lesson.
- **At closing**: items still without an outcome are carried into the next quarter automatically, by the branch close and by a journal's re-close. In the last quarter of the year (and when the next quarter is already closed) nothing can be carried: the checklist lists "Plan items not covered, nothing can be carried" as blocking until each is merged or dropped. A journal that ended inside the quarter (a subject removed from the class) is closed with its plan: its items are neither carried nor blocking.
- Every outcome is kept, with who decided and when, under **Outcomes of items not covered**, in the plan export and in the audit log.

## Plan reports

<!-- Sources: spec 09 (Reports), edge/lesson-plans; task 8.8, decisions 1 and 12 to 17 -->

**What it is.** Lesson plans → **Plan reports** (**Rejalar hisobotlari**): completeness, progress and edit requests for one quarter, with an Excel export.

**Who can use it.**

| Role | What the role may do |
| --- | --- |
| Super Admin, Principal, Academic Vice Principal | Every plan of the branch |
| Senior Head Teacher, Head Teacher | The plans of their subjects |

**How it works.**

- **Completeness**: per teacher, and per plan: complete, incomplete with the number of lessons without a topic, not started, overdue, window not opened, below the minimum, and the share of complete plans; the branch total above.
- **Progress**: per plan: lessons planned (rows with a topic), lessons held, topics delivered, items not covered, and "Behind" when fewer topics were delivered than lessons were held or items are not covered. Per teacher: the planned works of the lessons they taught, how many were marked "not held", and that share.
- **Edit requests**: each request of the quarter with its teacher, kind, status, who decided it and when, and what was changed.

## Exporting a plan

<!-- Sources: edge/lesson-plans ("A wrongly copied plan must be removed; an inspector asks for a printout"); task 8.8, decision 2 -->

**What it is.** The plan page has **Print**, **PDF** and **Excel**. The file holds every row (number, date, topic, works, objectives, materials) with its marks: moved from, edited after the lesson, topic not delivered, homework not given, works not held, the items not covered, the items carried in from the quarter before, and the outcomes of the quarter's items not covered.

**Rules.**

- Everyone who may read the plan may export it. Every export is in the audit log.
