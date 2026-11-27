# Lesson plans

Not written yet for most of the plans: plans and their items, shared plans, the window, edit requests and master plans (tasks 7.1a to 7.3) have no page here yet. This page holds the parts that tasks 5.19, 8.8, 9.2d, 10.3a and 11.27 added.

## Switching plan windows off

<!-- Sources: the owner, 20 November 2026 ("a toggle for the admin to turn it off completely so that anyone can fully edit their plans anytime"); migration 0174 -->

**What it is.** A switch in **Setup → Settings → Lesson plan windows** (**Dars rejasi oynalari**), for each branch. **On** (the default) keeps the windows and edit requests as described below. **Off** makes plans independent: every teacher changes their own plan at any time while the quarter is open.

**Who can use it.** The Academic Vice Principal and the Super Admin change it; the Principal sees it.

**When it is off.**

- No window is needed: the plan page says "off, the plan can be changed at any time".
- No edit request is asked, prepared or reminded of; the request part and the window extension are not shown.
- No plan is "overdue", and none shows "window not opened".
- No reminder of a window ending or missing is sent.
- The **Plan windows** page says the windows are off, with a link to Settings.
- When lessons move (a day off, a cancellation), items still move along by themselves and the teacher is told, but no request is prepared.

**Rules.**

- Nothing stored is lost: windows, extensions and requests stay, and switching back on brings them back as they were.
- A closed quarter stays closed: switching off never opens the plans of a closed quarter.
- Each switch is in the audit log.

## Codes for topics and works

<!-- Sources: spec 09 (What a plan contains; Codes; In the journal), 05 (Subject; Excel import of subjects), 02 (Super Admin; Academic Vice Principal; Integration keys), 07 (Layout; Classwork and homework), edge/journal (a lesson with no plan item), edge/lesson-plans (Plans and the journal); spec change of 25 November 2026; task 11.27 -->

**What it is.** A subject can have codes: a short label of the topic of a lesson, and of each classwork and homework (for example "T4.2" for a topic, "Q3" for a quiz). A code is shown first, with the full name beside it. Where there is little room (the journal's column headers, the lesson header, lesson mode on a phone) the code is shown alone; the full name shows on hover, or on a tap on a phone.

**Who can use it.** The Super Admin switches codes on or off for a subject, in **Setup → Subjects**, in the subject's panel (**Codes for topics and works**), or through the assistant. The Academic Vice Principal and the Principal see whether it is on, and cannot change it. Codes are off for every subject at the start, and the subject import does not carry the switch. Once a subject's codes are on, the teacher types the codes where the topic and the titles are typed: in the plan, in master plans, on the lesson card and when a work is added in the journal.

**How it works.**

1. The Super Admin ticks **Codes on** for the subject.
2. In the plan (and a master plan), a **Topic code** field stands beside the topic, and a **Code** field beside the title of each classwork and homework.
3. A code has at most 20 characters; spaces at either end are dropped. It need not be unique, and it is never required: a plan is complete with topics alone.
4. A code is changed under the same rules as the topic or title beside it: freely while the row is open, through an edit request after the window, with "edited after the lesson" on a lesson already held, never in a closed quarter. Each change is in the plan's history.
5. Codes are copied with a plan (from another class, another teacher or last year) and from a master plan, and a changed code shows as "master updated".

**Switching off.** Switching a subject's codes off hides every code of that subject: in the journal, the lesson card, the plan, reports, exports and prints, the parent portal, the Audit log, the assistant and integration keys. The codes are kept, and switching on again shows them unchanged. While a subject's codes are off, no code can be set in it. Other subjects are not affected.

**Edge cases.**

| Case | What happens |
| --- | --- |
| A code of 21 characters | Refused: "At most 20 characters." |
| A code sent while the subject's codes are off (by the assistant or an integration key) | Refused: codes are off for this subject. |
| The topic is changed while codes are off | Saved; the hidden code stays and comes back when codes are switched on. |
| A plan is copied while codes are off | The codes are copied, hidden, and show once codes are on. |
| Two works with the same code | Allowed; the full title tells them apart. |
| A work added by hand before 7 November 2026 | Has no code (it is not in the plan). |
| Past marks from before go-live, the parents' Telegram digest, notices | Show the names alone. |

## A quarter whose timetable starts in the middle

<!-- Sources: 09 (The plan window), edge/lesson-plans (The window and requests, "A branch's first timetable is published from the eighth school day of quarter 2"), edge/academic-year ("The school goes live in the middle of the year"); spec change of 18 November 2026; task 5.19 -->

**What it is.** A branch whose first timetable starts inside a quarter can open that quarter's plan window. The days before the timetable have no lessons, so nothing is missing for them.

**Rules.**

- The window of a quarter can be opened once a published timetable covers the quarter from the start of the branch's first timetable of the year. Lesson plans → Plan windows shows "Timetable from" with that date under such a quarter.
- The plans of that quarter begin at the first lesson of the timetable. The days before have no plan rows and count nowhere: not in completeness, not in "not covered", not in the lessons held without a plan.
- The window can be opened before the timetable starts. The teachers of the timetable own the plans from then on, write them and are told the window opened.
- A quarter that ends before the branch's first timetable starts has no lessons and no window.
- If that first timetable is withdrawn before it starts, a window already opened stays as it is.

## Who sees an extension of the window

<!-- Sources: 09 ("The Academic Vice Principal can extend the window for one teacher, for example after illness or for a new teacher"); task 10.3a, pull request #241 -->

**What it is.** When the Academic Vice Principal extends the plan window for one teacher, the window page lists that extension with the teacher and the new end date.

**Rules.**

- The Super Admin, the Principal and the Academic Vice Principal see every extension of the branch.
- A teacher sees an extension only if it is their own. A Head Teacher or a Senior Head Teacher sees only their own extension too: the reason for an extension can be personal, such as an illness.

## A work added after the lesson

<!-- Sources: edge/lesson-plans (Plans and the journal: "Adding a work is allowed, and the approval also opens that journal column for the same days"); task 8.8, decision 3, plan review correction 2 -->

**What it is.** When an approved edit request adds a classwork or a homework to a lesson already held, the journal column of that work opens for the request's days, also after the lesson's edit period.

**Rules.**

- The column opens for the lesson's teacher only, until the request's period ends or the teacher presses **Finished**.
- A homework added to a lesson is graded at that lesson, where its column is (owner, 25 November 2026).
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
