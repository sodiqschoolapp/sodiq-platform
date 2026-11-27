# Spec change proposal: period numbers in place of lesson numbers

Requested by the owner, 27 November 2026. Status: **proposed, revised after the spec review of the plan (section 8); waiting for the owner.** Nothing under `docs/spec/` is changed by this file; the owner runs `/spec-change` when they agree.

## 0. The request, in short

Today a lesson's number is its place among the day's **lesson slots**; breaks and lunch get no number. Teachers at Istirohat count lunch as a period: the day has 8 periods of 40 minutes from 9:00 to 15:30, and lunch takes one of them. It is period 4 for grades 0–4, period 5 for grades 5–8 and period 6 for grades 9–11; on Friday it is periods 5–6 for grades 5–11. So "the 7th lesson" is 14:00–14:40 for every grade. The platform numbers it 6 for most grades.

The rule asked for: a slot type gets a setting **counts as a period** (on for Tushlik, off for Tanaffus). The **period number** of a slot is its place among the day's lesson slots and counted slots. It replaces the lesson number everywhere. A period that is not a lesson slot (lunch) never holds a lesson, and is refused wherever a number is typed or chosen. A branch with no counted slot type (Labzak) sees no change.

## 1. What the code does today

There are two different numbers in the code. Only the first one is the "lesson number" the request means.

| Number | Meaning | Where it lives |
| --- | --- | --- |
| **Lesson number** | Place among the day's lesson slots, breaks skipped; `null` for a break | Worked out on read by `dayTimes()` (`packages/timetable-rules/src/day.ts:48-66`, line 62), wrapped by `dayOf()` (`apps/api/src/modules/setup/day-template-state.ts:199-234`). A second copy is in `readVersionDays()` (`apps/api/src/modules/timetable/version-days.ts:66-100`, line 90). |
| **Slot position** | Place in the day template **with every break counted** (1..20) | Stored in `pattern_blocks.slot_position`, `timetable_pins.slot_position`, `timetable_day_keeps.slot_position`, `timetable_version_days.position`, `exams.first_slot/last_slot` |

Three other numbers are called "lesson number" but are **not** slot numbers, and this change leaves them alone:

- **Past marks** (`past_attendance.lesson_number`, `past_works.lesson_number`, 0190). This is the number of *that subject's* lesson on that day: 1, 2, 3 (`10`, Past marks: "the lesson, the number of that subject's lesson on that day"). The rows have no time, so there is nothing to recompute them from, and nothing to recompute.
- **The journal's "No."** (`journal.grid.lessonNumber`, `lessonNumbersOf`). This is the lesson's place in the quarter.
- **The lesson plan's "lesson number"** (`09`). This is its order within the quarter.

Slot kinds are only `lesson` and `break` (0017). Lunch is "a break named Lunch" (decision 9 of 1.3–1.6), so today nothing tells lunch apart from a short break.

The Kotlin solver does not exist yet (`apps/solver` is task 5.10, deferred). The "solver" today is the TypeScript rule engine. 5.10 gets a From line for this change (section 6, decision 11).

## 2. Every place the number is shown, typed, stored or used

`L` means the place uses the lesson number today and **changes to the period**. `P` means it shows a slot position (breaks counted) today, and will **show the period** instead; the stored position stays.

### 2.1 Stored

| # | Table, column | Today | After |
| --- | --- | --- | --- |
| S1 | `bulk_cancels.lesson_numbers smallint[]` (0086:36) | L: the numbers as typed; read nowhere after the save (only `bulk-cancels.service.ts:326` writes it) | **Unchanged rows.** New cancels store the periods as typed; old ones keep what was typed then |
| S2 | `bulk_cancel_spans.lesson_number` (0086:75, in the primary key) | Lesson order of that class on that date: the key `retimeStored` follows when a template changes (decisions 5.6b-4b, "a span moves to the times of its own stored lesson number") | **Unchanged rows and meaning**: it stays the lesson order, never shown (decision 2) |
| S3 | `timetable_version_days.position, kind` (0091) | The weekly day of a version, written once at publish | Gains `counts_as_period`, written at insert like the rest; old rows default to false, which is what their templates said |
| S4 | `pattern_blocks.slot_position`, `timetable_pins.slot_position`, `timetable_day_keeps.slot_position`, `day_template_slots.position`, `exams.first_slot/last_slot` | Positions, breaks counted | **Unchanged.** A position does not depend on which breaks count. |
| S5 | `past_attendance.lesson_number`, `past_works.lesson_number` | Subject's lesson that day | **Unchanged** (not a slot number) |
| S6 | `lessons`, `exams.starts_at/ends_at`, `calendar_group_blocks`, `bulk_cancel_blocks`, `staff_availability_ranges` | Clock times only | Unchanged |
| S7 | `audit_log`, `request_keys` payloads (bulk cancel `lessonNumbers`, one-day move `lessonNumber`) | Numbers as sent | **Not rewritten** (append-only history). Entries keep the numbers as sent. |
| S8 | `assistant_proposals.steps` (0179) | A move's `lessonNumber`, for up to 15 minutes | A move proposal also carries the start and end it showed; confirming refuses when the period now has other times (section 5) |

### 2.2 Derived, checked, typed and imported on the server

| # | Place | Today | After |
| --- | --- | --- | --- |
| A1 | `dayTimes()`, `day.ts:48-66`; `DaySlot` type `:26-38` | Counts `kind === 'lesson'` | Removes `lessonNumber` and adds `period` (lesson slots and counted breaks) and `lessonOrder` (the old count, for rules only, never shown), so the compiler finds every reader |
| A2 | `dayOf()` and its callers: `lessonSlotsOf`, `tableOn`, `day-templates.service.ts:561`, `template-cells.ts:81`, `gradeSlotsOn` → `classSlotsOn`, `longestDayOn`, `views.service.ts:569`, `slotNumbers` (`journal-grid.query.ts:301`), `firstLessonStartOn`, `template-lessons.ts:265/339`, `template-retime.ts:120-130`, `pattern-facts.ts:278` | Lesson number | Reads the slot type's setting; each caller says which of `period` / `lessonOrder` it needs (below) |
| A3 | `readVersionDays()` `version-days.ts:66-100`, and `storeVersionDays()` `:34-60` | Recounts lesson numbers itself | Uses `dayTimes()`; writes `counts_as_period` at insert and reads it |
| A3b | Places that read `lessonNumber !== null` as "is a lesson slot": `lessonSlotsOf` (`day-template-state.ts:236`), `template-retime.ts:125`, `template-lessons.ts:264`, `dated.ts:293-295`, `same-day.ts:63` (first lesson of today, `06` Start date) | Lesson number | `kind === 'lesson'`; no change of behaviour |
| A3c | Reports: the "period of the day" filter (`shared/reports.ts:58`, by start minute) and the load report's `periods` / `freePeriods` (`reports.ts:382-387`) | Free periods = empty lesson slots | Unchanged: a counted lunch is not a free period (decision 3) |
| A4 | Rule engine: `dated.ts:253` `weeklyNumber`, `:278-353` `classOn` (shortened day), `:418`; `check.ts:424` `lessonNumberAt`, `:459` doubles `b === a + 1`, `:853` free period; `templates.ts:126-170` `usedSlotProblems`; `pattern-place.ts:255` `pairAt`; `pattern-import.ts:182-230`; `two-grades.ts:15-40`; `totals.ts:54`; `day.ts:78` `lessonSlotProblem` | Lesson number | Every rule of order keeps `lessonOrder`: doubles, free period, shortened-day matching, the used-slot check, and the weekly-to-dated matching (`weeklyNumber`, `blockOn`). Every number a person types or sees is a `period`. Decision 2. |
| A5 | Bulk cancel: `bulk-cancels.service.ts:226` (key), `:326`, `:351`, `:400-403` (answer, audit), `:658-684` `scopeOf`; `bulk-cancels-kept.ts:333`; `template-retime.ts:278-340` | Lesson numbers | The ticked numbers are periods; `scopeOf` finds each class's lesson slot of that period, and a period that is a break or missing for a class is skipped for it; an empty scope stays `bulk_cancel_empty`. Spans keep storing the lesson order, and `template-retime.ts` keeps following it (decision 2) |
| A6 | One-day move: `day-changes.service.ts:311` (key), `:845-849`; `stored-day.ts:276-314` `slotMomentsOn`; `longestDayOn` `:1377` | Lesson number | Period; a period that is not a lesson slot is refused with the existing `no_such_lesson_slot` |
| A7 | Exams: `exams.service.ts:606-617`, `:1680-1681`; `calendar-exams.ts:285-289` | Lesson number in, position stored | Period in, position stored. Fix the mix-up at `exams.service.ts:1344-1345`, where `firstSlot: body.firstLesson` puts a lesson number into a position field |
| A8 | Timetable import: `pattern-import-read.ts:151-158`, `pattern-imports.service.ts:470-497`; `shared/pattern-import.ts:15-22, 47-91` (column "Lesson number", "Dars raqami", "Номер урока") | Lesson number | Period; a period that is not a lesson slot is a problem of the row, as a missing number is today |
| A9 | Exports and prints: `pattern-file.ts` (lines 22-40, 160-314), `version-export.service.ts:224-270`, `views-file.ts` (190-454), `views-export.service.ts:25`, `views.service.ts:579, 610-623`, `journal-export.ts:168-174`; headings in `shared/timetable-prints.ts:69, 133, 194, 255` | Lesson number | Period; the row of a counted break is printed with its slot type's name |
| A10 | Journal and plans `slot`: `journal-grid.service.ts:464, 1207`, `plan-read.ts:206, 219` | Lesson number | Period |
| A11 | Portal and teacher home: `portal-timetable.service.ts:116`, `teaching-home.controller.ts` → views | Lesson number | Period |
| A12 | Template changes: `template-lessons.ts:82, 175-177` ("Lesson slot N of grade G…"), `:255-391` | Lesson number | Period in the message; the used-slot rule stays on order (A4) |
| A13 | Schemas: `shared/bulk-cancels.ts:19, 34-37`; `day-changes.ts:75` (max 30, the database allows 20), `:163`; `exams.ts:79-80, 111, 291-292`; `day-templates.ts:279, 301, 359`; `template-changes.ts:114`; `timetable.ts:866, 1956`; `timetable-views.ts:96`; `portal.ts:60, 300`; `journal.ts:149`; `plans.ts:264`; `journal-plans.ts:33` | Lesson number | Same field names, now holding the period (decision 3); every upper bound becomes 20 |
| A14 | Assistant: generated tools `BulkCancelsController_save/_check` `lessonNumbers` (`tools.generated.ts:17625, 17737`), `DayChangesController_move` `lessonNumber` (`:18305`); `access/assistant-change-routes.ts:864` | Lesson numbers | Periods (field descriptions regenerated); the system instruction gets one line: "a lesson's number is its period; lunch has a period and holds no lesson" |
| A15 | Load report `load-report.service.ts:383, 505` | Counts lesson slots | Unchanged (a count, not a number) |
| A16 | Integration guide (`docs/integration-guide.md:417, 464, 569, 882, 2380`) | `lessonNumber`, `slot` | Same fields; the description says "period" |

### 2.3 Shown, typed and chosen in the web app

| # | Place | Today | After |
| --- | --- | --- | --- |
| W1 | Class, teacher and room week grid, row headers: `views-page.tsx:462-501`. The web works out the number itself for exams and busy items (`:467-471`). | L | Period; a counted break row shows "Tushlik", greyed |
| W2 | School day view columns: `views-page.tsx:554-622` | L | Period |
| W3 | Teacher home: table `teaching-home.tsx:236, 299`; phone cards `:408-411` | L | Period |
| W4 | Journal grid header "date · lesson N": `journal-grid.tsx:970, 1349`; lesson mode `journal-page.tsx:859`; lesson card "Slot N of the day" `lesson-editor.tsx:117-120` | L | Period ("No. N" and "Lesson N · date" are the quarter count: unchanged) |
| W5 | Lesson plan rows: `plan-page.tsx:52`, `plan-row-panel.tsx:78` | L | Period |
| W6 | Portal timetable: `portal-lessons.tsx:84` | L | Period. Portal attendance of past marks (`portal-attendance-page.tsx:142-144`): unchanged (S5) |
| W7 | Day template panel "lesson N": `day-template-panel.tsx:180-190` | L | "period N" on lesson slots and counted breaks |
| W8 | Day template editor `OrderedListField`, `index + 1` (`field.tsx:609-616`) | Place, breaks counted | The period beside each slot; "place" stays only in screen-reader labels |
| W9 | Slot types page and form | Kind and length | A "Counts as a period" choice when a break type is created, fixed afterwards like the kind; a column in the list |
| W10 | Template table "slots in use" line: `template-table.tsx:141-165` | L | Period |
| W11 | Builder grid rows "Slot N": `grid-step.tsx:715-718`, from `board.positions` | P (shows 1, 2, 3, 5…) | Period; the row of a counted break shows its name and takes no drop |
| W12 | Pins: `pins-section.tsx:194, 214-219, 302-313`; clash list `builder-page.tsx:380-388`. The web works out lesson numbers at `:41-55`. | P | Period shown, position sent |
| W13 | Version compare `versions-compare.tsx:44-48`; left out of a copy `grid-left.tsx:43-48` | P | Period |
| W14 | Publish chain `publish-chain.tsx:84-90`; out-of-date `out-of-date-panel.tsx:375-379, 424-430, 472-478`. Today uz and ru call a position "-dars"/"урок", which is wrong already. | P | Period; the uz and ru wording is fixed with it |
| W15 | Shortened-day ticks: `publish-shortened.tsx:89-112`, `calendar-shortened.tsx:95-120` (`index + 1` over the class's lessons: wrong when the class has a gap) | Own count | Period of the slot |
| W16 | Bulk cancel ticks `bulk-cancel-dialog.tsx:150, 276-306` (`1..longestDay`) | L | Periods `1..longestDay`; a period that is a break for every chosen class is shown disabled with its name |
| W17 | One-day move select `day-page.tsx:657-817` | L | Period; lesson slots only |
| W18 | Exam from and to `exam-form.tsx:391-397, 582-592` | L | Period; lesson slots only |
| W19 | Timetable import preview `pattern-import-page.tsx:54-72` | L | Period |
| W20 | Assistant proposal field labels `proposal-card.tsx:174-188` (`assistant.fields.lessonNumber(s)`, `firstLesson`, `lastLesson`) | L | "Period(s)", "From period", "To period" |

Locale keys that change text or value: `timetable.views.lessonNumber`, `timetable.day.slotLabel`, `timetable.bulk.slot(s)`, `timetable.exams.firstLesson/lastLesson`, `timetable.publish.shortened.lesson`, `setup.dayTemplates.lessonNumber`, `setup.templateTable.slotsInUse.line`, `journal.grid.slot`, `journal.card.slotOfDay`, `plans.plan.slot`, `portal.timetable.lesson`, `assistant.fields.*`, `timetable.grid.slotNumber`, `timetable.builder.pins.slotOption/slotMissing/pinText`, `timetable.history.place/leftLine`, `timetable.publish.chain.change.entry_room`, `timetable.outOfDate.slot/noSlot/doubleWith`; new keys for the setting and its column. No new refusal code.

## 3. Stored rows that change, per branch

**None, in any branch.** The design (decision 1) needs no rewrite of a stored row:

- **The migration only adds columns.** The setting is chosen when a break slot type is created, and is fixed afterwards like its kind (0017: "a lesson slot never turns into a break under a template").
- **The day templates switch Istirohat over.** The Academic Vice Principal adds a new break type, say "Tushlik", 40 minutes, counts as a period. Then they change each template from a date, tomorrow at the earliest, swapping the old lunch slot for the new one. This is the dated template change that exists today, with its preview of the table for every weekday and grade, its retime, its checks and its audit entry. A break swapped for a break of the same length moves no time, so nothing is retimed. Dates before the switch keep the numbers they had, as every template change keeps history (`03`). From the switch date on, every number is a period.
- **The stored numbers do not need recomputing:**
  - `bulk_cancel_spans.lesson_number` stays the lesson order: an inner key that no screen shows (decision 2).
  - `bulk_cancels.lesson_numbers` has no reader, so it keeps what was typed.
  - Positions do not depend on which breaks count.
  - Past marks are not slot numbers.

| Branch | Stored rows changed by the deploy | Rows changed when the branch switches |
| --- | --- | --- |
| **Labzak** (no counted break) | None | It does not switch: every period equals today's lesson number |
| **Istirohat** | None | Only what any template change writes today: one new `slot_types` row and its `slot_type_lengths` row, the new `day_template_versions` and `day_template_slots` from the switch date, each cut predecessor's `valid_until`, and audit entries. No lesson, cell, span, pin, pattern or past mark changes, because no time changes. |
| **The third branch** | None | As Labzak, unless it adds a counted break |

So this change is **not stop item 3** (a migration that changes or removes existing rows). If the owner still wants the switch made by a migration rather than on the setup screen, that migration would insert template versions on production: it would be stop item 3, and it is not proposed.

## 4. Proposed `/spec-change` wording

The word used is **period number**, because "period" alone already means a date range in `06` ("1. Period and day template") and in edge/timetable, and "free period" means an empty lesson slot.

**A. `03-school-setup.md`, Slot types and day templates.** Replace "A slot type has a name, a kind (lesson or break) and a length in minutes: for example Lesson 45, Break 15, Long break 20, Lunch 40." with:

> A slot type has a name, a kind (lesson or break), a length in minutes and, for a break, whether it counts as a period; the kind and that choice are fixed when the type is created. For example: Lesson 40, Break 10, and Lunch 40, which counts as a period. Each slot of a day template that is a lesson slot or a counted break has a **period number**: its place among those slots, from 1. A break that does not count has none (`06`, Model, Period number). A branch starts counting lunch by putting a counted break type into its templates from a date, as any template change.

**B. `06-timetable.md`, Model.** A new row after Slot:

> | Period number | The number of a slot in its day: its place among the lesson slots and the counted breaks of that day's template (School setup). At Istirohat, where lunch counts, period 7 is 14:00–14:40 for every grade, whichever period its lunch takes. A lesson is named by its period number wherever a number of it is shown, typed, chosen, imported, printed or stored. A counted break never holds a lesson: a number that names it is refused wherever one class's or group's lesson is placed, moved, imported or set as an exam's first or last, and a choice over several classes (a bulk cancel) skips the classes for which it is no lesson slot. Rules of order (a double lesson, a free period, the first slots of the day, a shortened day, a lesson following a template change) count lesson slots only. A branch with no counted break numbers its lessons as before. |

**C. `06-timetable.md`, Importing, The timetable import.** Replace "slot number of the day template in force on the draft's start date" with "period number of the day template in force on the draft's start date (Model, Period number); a number that is not a lesson slot of the row's grades is a problem of the row". This keeps "start date" as the spec has it today. Its pending **Look first** reading, "the later of the start date and today" (`docs/decisions.md`, 15 November 2026, task 5.14), stands on its own and is not repeated here. Also replace "Two rows of one double lesson are two consecutive slots" with "two consecutive lesson slots (a counted break between them does not part them)".

**D. `06-timetable.md`, Changes after publishing.**
- Bulk cancel: "chosen classes, date and slots" becomes "chosen classes, date and period numbers".
- Exam: "one or more consecutive lesson slots of the day template (the breaks between them included)" becomes "the lesson slots from a first period number to a last, both lesson slots (the breaks between them included, counted or not)".

**E. `06-timetable.md`, Views and outputs.** Add:

> Every timetable view, print and export numbers its rows by period number; a counted break shows its slot type's name in its row.

**F. `09-lesson-plans.md`, line 73.** "number, date, slot" becomes "number, date, period number".

**G. `edge-cases/time-dates-calendar.md`, shortened day.** After "Lessons are matched by their order in the day", add "(their order among the lesson slots; the numbers shown are the date's period numbers)".

**H. `edge-cases/00-definitions.md`.** A new row:

> | Period number | The number of a slot in the day: its place among lesson slots and breaks that count as a period (`03`, Slot types). The number of a lesson everywhere it is shown, typed or chosen. Not the lesson's place in the quarter (journal "No.", lesson plans), and not the number of a past mark's lesson (`10`). |

**I. `edge-cases/developer-rules.md`, Lesson times.** Add:

> Period numbers are worked out from the day template in force on the date when read. A position in a template (pattern, pins, keeps, exams) is stored with every break counted. The lesson order that a stored change follows across a template change (one-day changes, bulk cancel spans) counts lesson slots only. A bulk cancel's typed numbers are kept as typed and are never applied per class.

**Unchanged:**
- `02` and `06`, the assistant example "cancel lessons 4 to 8": after B, these are period numbers.
- `edge/exemptions`, "Slots 5–7": stored as times.
- `10`, past marks: the subject's lesson that day.
- `07`, "No." and `09`, lesson number: the order in the quarter.
- `edge/academic-year`, prints of closed periods: kept, since past dates keep their numbers.

## 5. Plan

**What exists when done.**
- A break slot type can be created as "counts as a period".
- Every lesson number the platform shows, takes, imports, prints or offers is the period number of the day template in force on that date.
- A period number that is not a lesson slot is refused for one class or group, and skipped across several.
- Istirohat switches by a dated template change on the setup screen. Labzak sees no change.

**Database.** One migration, `0192_period_numbers`, add-only:

- `slot_types.counts_as_period boolean not null default false`.
  - A check: `not counts_as_period or kind = 'break'`.
  - Granted for insert only, not update, like `kind`.
  - A constant default adds no table rewrite and takes no long lock.
- `timetable_version_days.counts_as_period boolean not null default false`, granted for insert. No update grant, and the draft trigger is untouched.

**Shared and engine.**
- `DaySlot` and `TimedSlot` lose `lessonNumber` and gain `period` and `lessonOrder`, so the compiler finds every reader. `dayTimes()` takes `countsAsPeriod` per slot. Helpers: `slotOfPeriod` and `periodAt(time)`.
- Every rule of order in A4 uses `lessonOrder`. Each number in or out uses `period`.
- Schemas: the bounds become 20 (the move had 30), and the descriptions say "period number".
- Failing tests first:
  - A fast-check property: with no counted break, `period === lessonOrder` for every slot (Labzak).
  - Istirohat's shape (lunch at 4, 5 and 6 by grade; Friday with two lunches for grades 5–11): the same period number has the same clock time in every grade's template.

**API.**
- `createSlotType` takes `countsAsPeriod` (the `day_templates.create` route as today). Every place of section 2.2 changes.
- Fix the mix-up at `exams.service.ts:1344-1345`: the check gets the slots' positions, not the numbers typed.
- A move proposal of the assistant also stores the start and end shown. Confirming refuses when the period now has other times, with a new `outdatedCodes` entry on the move route (`assistant-change-routes.ts:841-847`).
- Run `pnpm api:client` and `pnpm security:checklist` again.

**Web.**
- Every place of section 2.3.
- The slot type form's "Counts as a period" choice, and a column in the list.
- The template table and preview show period numbers, so the switch is seen before it is saved.
- Keys in uz, ru and en.

**Tests.**
- Engine tests of each A4 function on the Istirohat shape.
- The template switch itself: at Istirohat, a template change from a date swaps an uncounted lunch for a counted one, with a stored bulk cancel and a stored one-day move on a later date. Assert:
  - every lesson, span and move keeps its clock time;
  - the numbers shown before the date are unchanged, and those from it are periods.
- A template change from a date that *moves* the counted lunch, with a stored bulk cancel and one-day move: both follow their lessons (the order key).
- Route tests of the refusals through the routes: move (`no_such_lesson_slot`); exam (`exam_slots`); import (a problem of the row); a bulk cancel whose only period is lunch for every chosen class (`bulk_cancel_empty`); a lunch period for some classes is skipped for them.
- The exam fix: a check of a standing exam where the typed lesson numbers differ from the positions.
- The assistant: a move proposal confirmed after the period's times changed is refused as outdated.
- Labzak unchanged. On the Labzak fixture, these answers are the same before and after:
  - the class, teacher and room views and their Excel export;
  - the teacher home;
  - the journal grid's lesson headers;
  - the bulk cancel and move day choices;
  - the exam slot options;
  - the timetable import of a sample file.
- Playwright, at Istirohat after the switch: period 7 at 14:00 for grades 3, 7 and 10 in the class views, the journal header and the bulk cancel dialog; lunch shows as "Tushlik" and cannot be chosen.
- `slot_types` insert with the setting gets a new audit detail. There is no new audit action, because creating a slot type is already one.

**Split.** Planned as one task. If one session cannot hold it, then:
- **a.** Database, engine, API, imports, exports.
- **b.** The web places of section 2.3, the slot type form, the locale texts, e2e.

## 6. Decided without the owner (proposed)

1. **Look first.** The setting is fixed when a break type is created, and a branch switches by a dated template change. Dates before the switch keep their numbers, as every template change keeps its history (`03`; edge/academic-year: prints of closed periods). Nothing stored is rewritten, so no grant or trigger is widened, and no lock beyond those of a template change is needed.
   - The alternative: a setting changeable at any time and valid for all dates, renumbering history. It was dropped after the spec review: it needs update grants on rows that are insert-only today, a weaker version-days trigger, its own locks against concurrent saves, and a recompute of stored rows.
2. **Look first.** The rules of order keep counting lesson slots only. These are:
   - the double lesson;
   - the free-period warning, and the free periods of the load report;
   - "demanding subjects in the first slots";
   - the shortened-day matching;
   - the used-slot check of a template change;
   - the weekly-to-dated matching (`weeklyNumber`);
   - the retime of stored one-day changes and bulk cancel spans.

   So periods 4 and 6 around a counted lunch are still a double, lunch is never a free period, and a stored change follows its lesson. Every published timetable stays valid as it is.
3. **Look first.** API and file field names stay (`lessonNumber`, `lessonNumbers`, `slot`, `firstLesson`, `lastLesson`), and their meaning becomes the period number. The integration guide says so (`docs/integration-guide.md`). Integration clients keep working, and the change stays smaller where mistakes cost most. `bulk_cancel_spans.lesson_number` keeps its name and stays the lesson order (decision 2).
4. **Look first.** A spec text that should change: the `/spec-change` wording of section 4.
5. **No new refusal code.** A period number that is not a lesson slot gets the existing refusal of a number the day lacks: `no_such_lesson_slot` for a move, `exam_slots` for an exam, a problem of the row for the import. A bulk cancel skips it per class, and an empty scope is `bulk_cancel_empty`, as for a number a day lacks today (decisions, 5.6a-3, decision 2).
6. Only a break can count, enforced by a check constraint. A lesson slot always has a period number.
7. Wording:
   - English "Lesson N" becomes "Period N".
   - Uzbek "N-dars" and Russian "Урок N" / "N-й урок" stay, because teachers already say "7-dars" for period 7.
   - The import column becomes "Period" in English and stays in uz and ru.
8. The views show a counted break's row with its name, greyed, so period numbers never jump.
9. The places that showed a template position (builder grid, pins, version compare, copies, publish chain, out-of-date) show the period number. This also fixes their uz and ru texts, which call a position a lesson today.
10. Istirohat's Friday lunch for grades 5–11 is two period numbers only if the Friday template holds **two** counted 40-minute slots. One 80-minute slot is one period number. The template preview shows the period-to-time table for every weekday and grade, so this is seen before saving.
11. Solver (5.10, not built): a From line, "slots are named by position; rules of order use `lessonOrder`; period numbers are only for what people see".
12. Past marks, the journal's "No." and the plan's lesson number are not touched (section 1).
13. **Split, Look first, only if needed** (section 5).

## 7. Needs the owner

- **Stop item 5 (permissions).** The task adds no route and no permission; `createSlotType` takes one more field. I read this as no change to what a role may do, but the stop list names "what a route lets a role do", so the owner confirms on the pull request.
- **Not stop item 3.** No migration changes an existing row (section 3). The switch at Istirohat is made on the setup screen after deploy, by a template change from a date.

**Facts to confirm, not decisions:**
- The name of the third branch, and whether any of its breaks count.
- Whether teachers want past dates (before the switch) renumbered too. Decision 1 keeps them as they were.

## 8. What the spec review of this plan found, and what changed

The first version made the setting changeable at any time and recomputed stored numbers. The `spec-reviewer` found that design unsound. The changes:

| Finding | Change |
| --- | --- |
| `timetable_version_days` has no update grant, and its draft trigger refuses updates on published versions (0091:63-72, 0089) | No update. The column is written at insert only. |
| Lessons follow a template change by lesson order (`weeklyNumber`) while spans and moves would have followed periods, so they could part | Every rule of order, the retime included, stays on lesson order (decision 2). The spans are not renumbered. |
| The recompute needed new update grants, risked primary key collisions on `bulk_cancel_spans`, and left spans that match no slot | No recompute (decision 1). |
| Nothing locked the switch against bulk cancel saves, publishes and template changes | No switch: the setting is fixed at creation, and the template change already takes its locks. |
| Wording B stated as a rule something only true of Istirohat's templates | Now written as an example. |
| The new route was a stop item 5 matter | No new route; the remaining field is put to the owner (section 7). |
| `bulk_cancels.lesson_numbers` has no reader; the union rule changed what was typed | Kept as typed. Wording I forbids applying it per class. |
| `period_not_lesson` duplicated `no_such_lesson_slot`, `exam_slots` and `bulk_cancel_empty` | Existing codes reused (decision 5). |
| Inventory gaps: `same-day.ts:63`, `lessonNumber !== null` readers, the "period of the day" report filter and free periods | Added as A3b and A3c. `lessonNumber` is removed from the types. |
| "Period" clashes with "1. Period and day template" and "free period" | The term is now "period number". |
| Wordings B and I disagreed about what is stored | B now names numbers shown, typed and chosen; I says what is stored. |
| Wording C repeated the pending "later of the start date and today" item | Cited, not repeated. |
| Tests: the exam fix, the Labzak snapshot, the span check, the audit | Named tests; the answers compared are listed; no new span check; no new audit action. |
| Pending assistant move proposals (`assistant_proposals.steps`) | They carry the times shown and refuse as outdated (S8). |
