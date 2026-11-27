# Spec change proposal: period numbers in place of lesson numbers

Requested by the owner, 27 November 2026. Status: **proposed; waiting for the owner.** Nothing under `docs/spec/` is changed by this file; the owner runs `/spec-change` when they agree.

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

The Kotlin solver does not exist yet (`apps/solver` is task 5.10, deferred). The "solver" today is the TypeScript rule engine. 5.10 gets a From line for this change (section 6).

## 2. Every place the number is shown, typed, stored or used

`L` means the place uses the lesson number today and **changes to the period**. `P` means it shows a slot position (breaks counted) today, and will **show the period** instead; the stored position stays.

### 2.1 Stored

| # | Table, column | Today | After |
| --- | --- | --- | --- |
| S1 | `bulk_cancels.lesson_numbers smallint[]` (0086:36) | L: one array for the whole cancel, read in each class's own day | Periods, recomputed (section 3) |
| S2 | `bulk_cancel_spans.lesson_number` (0086:75, in the primary key) | L: that class's number on that date, beside its `starts_at`/`ends_at` | Period, recomputed from its own clock time |
| S3 | `timetable_version_days.position, kind` (0091) | The day of a published version, stored as positions and kinds; lesson numbers are recounted from it | Gains `counts_as_period`; set again whenever the setting changes (section 3) |
| S4 | `pattern_blocks.slot_position`, `timetable_pins.slot_position`, `timetable_day_keeps.slot_position`, `day_template_slots.position`, `exams.first_slot/last_slot` | Positions, breaks counted | **Unchanged.** A position does not depend on which breaks count. |
| S5 | `past_attendance.lesson_number`, `past_works.lesson_number` | Subject's lesson that day | **Unchanged** (not a slot number) |
| S6 | `lessons`, `exams.starts_at/ends_at`, `calendar_group_blocks`, `bulk_cancel_blocks`, `staff_availability_ranges` | Clock times only | Unchanged |
| S7 | `audit_log`, `request_keys` payloads (bulk cancel `lessonNumbers`, one-day move `lessonNumber`) | Numbers as sent | **Not rewritten** (append-only history). Entries before the switch keep the old numbers. |

### 2.2 Derived, checked, typed and imported on the server

| # | Place | Today | After |
| --- | --- | --- | --- |
| A1 | `dayTimes()`, `day.ts:48-66`; `DaySlot` type `:26-38` | Counts `kind === 'lesson'` | Adds `period` (lesson slots and counted breaks) and `lessonOrder` (the old count, used by rules only, never shown) |
| A2 | `dayOf()` and its callers: `lessonSlotsOf`, `tableOn`, `day-templates.service.ts:561`, `template-cells.ts:81`, `gradeSlotsOn` → `classSlotsOn`, `longestDayOn`, `views.service.ts:569`, `slotNumbers` (`journal-grid.query.ts:301`), `firstLessonStartOn`, `template-lessons.ts:265/339`, `template-retime.ts:120-130`, `pattern-facts.ts:278` | Lesson number | Reads the slot type's setting; each caller says which of `period` / `lessonOrder` it needs (below) |
| A3 | `readVersionDays()` `version-days.ts:66-100`, and `storeVersionDays()` `:34-60` | Recounts lesson numbers itself | Uses `dayTimes()`, and stores and reads `counts_as_period` |
| A4 | Rule engine: `dated.ts:253` `weeklyNumber`, `:278-353` `classOn` (shortened day), `:418`; `check.ts:424` `lessonNumberAt`, `:459` doubles `b === a + 1`, `:853` free period; `templates.ts:126-170` `usedSlotProblems`; `pattern-place.ts:255` `pairAt`; `pattern-import.ts:182-230`; `two-grades.ts:15-40`; `totals.ts:54`; `day.ts:78` `lessonSlotProblem` | Lesson number | Order rules (doubles, free period, shortened-day matching, used slots) keep `lessonOrder`. Every number a person types or sees is a `period`. Decision 3. |
| A5 | Bulk cancel: `bulk-cancels.service.ts:226` (key), `:326`, `:351`, `:400-403` (answer, audit), `:658-684` `scopeOf`; `bulk-cancels-kept.ts:333`; `template-retime.ts:278-340` | Lesson numbers | Periods; a period that is a break for a class is skipped for it; refused when it is a lesson slot for no chosen class (decision 7) |
| A6 | One-day move: `day-changes.service.ts:311` (key), `:845-849`; `stored-day.ts:276-314` `slotMomentsOn`; `longestDayOn` `:1377` | Lesson number | Period; a break period is refused (`period_not_lesson`) |
| A7 | Exams: `exams.service.ts:606-617`, `:1680-1681`; `calendar-exams.ts:285-289` | Lesson number in, position stored | Period in, position stored. Fix the mix-up at `exams.service.ts:1344-1345`, where `firstSlot: body.firstLesson` puts a lesson number into a position field |
| A8 | Timetable import: `pattern-import-read.ts:151-158`, `pattern-imports.service.ts:470-497`; `shared/pattern-import.ts:15-22, 47-91` (column "Lesson number", "Dars raqami", "Номер урока") | Lesson number | Period; a break period is a problem of the row |
| A9 | Exports and prints: `pattern-file.ts` (lines 22-40, 160-314), `version-export.service.ts:224-270`, `views-file.ts` (190-454), `views-export.service.ts:25`, `views.service.ts:579, 610-623`, `journal-export.ts:168-174`; headings in `shared/timetable-prints.ts:69, 133, 194, 255` | Lesson number | Period; the row of a counted break is printed with its slot type's name |
| A10 | Journal and plans `slot`: `journal-grid.service.ts:464, 1207`, `plan-read.ts:206, 219` | Lesson number | Period |
| A11 | Portal and teacher home: `portal-timetable.service.ts:116`, `teaching-home.controller.ts` → views | Lesson number | Period |
| A12 | Template changes: `template-lessons.ts:82, 175-177` ("Lesson slot N of grade G…"), `:255-391` | Lesson number | Period in the message; the used-slot rule stays on order (A4) |
| A13 | Schemas: `shared/bulk-cancels.ts:19, 34-37`; `day-changes.ts:75` (max 30, the database allows 20), `:163`; `exams.ts:79-80, 111, 291-292`; `day-templates.ts:279, 301, 359`; `template-changes.ts:114`; `timetable.ts:866, 1956`; `timetable-views.ts:96`; `portal.ts:60, 300`; `journal.ts:149`; `plans.ts:264`; `journal-plans.ts:33` | Lesson number | Same field names, now holding the period (decision 4); every upper bound becomes 20 |
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
| W9 | Slot types page and form | Kind and length | A "Counts as a period" switch on breaks, with the preview (section 4) |
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

Locale keys that change text or value: `timetable.views.lessonNumber`, `timetable.day.slotLabel`, `timetable.bulk.slot(s)`, `timetable.exams.firstLesson/lastLesson`, `timetable.publish.shortened.lesson`, `setup.dayTemplates.lessonNumber`, `setup.templateTable.slotsInUse.line`, `journal.grid.slot`, `journal.card.slotOfDay`, `plans.plan.slot`, `portal.timetable.lesson`, `assistant.fields.*`, `timetable.grid.slotNumber`, `timetable.builder.pins.slotOption/slotMissing/pinText`, `timetable.history.place/leftLine`, `timetable.publish.chain.change.entry_room`, `timetable.outOfDate.slot/noSlot/doubleWith`; new keys for the setting, the preview and `period_not_lesson`.

## 3. Stored rows that change, per branch

Nothing in the migration rewrites a row. The migration only adds columns (section 5). Stored numbers change **when a branch's Academic Vice Principal (or the Super Admin) turns "counts as a period" on or off for a slot type**. That change recomputes, in the same transaction, from clock time and the template in force on each row's date. Numbers are never shifted. This has to live in the route anyway, because the setting can change again later. Decision 2 offers the other way: a one-off data migration for Istirohat.

| Branch | Rows that change when Tushlik is switched on |
| --- | --- |
| **Labzak** (no counted break) | **None.** Every period equals today's lesson number. |
| **Istirohat** | `slot_types`: the Tushlik row(s), the setting itself. `bulk_cancel_spans.lesson_number`: every span whose class had a Tushlik slot before it that day. Its period is read from its own `starts_at` in that class's day on that date. `bulk_cancels.lesson_numbers`: every cancel with such a span. It becomes the sorted, distinct set of its spans' periods (decision 5). `timetable_version_days.counts_as_period`: the rows at Tushlik's positions in every version of the branch. |
| **The third branch** | As Labzak, unless one of its break types is switched on |

**Counts.** No session may read production (`CLAUDE.md`), so this file cannot give the numbers. They are shown in two ways:

- The **preview of the switch** shows them before anything is written: "N bulk cancels and M class spans are renumbered; K version days are marked", with each cancel's date and before and after.
- The owner can run this read-only query on production himself:

```sql
-- Per branch: bulk cancel spans that sit after a Lunch-type break in their class's day.
select b.name as branch,
       count(distinct s.bulk_cancel_id) as cancels,
       count(*) as spans
from bulk_cancel_spans s
join branches b on b.id = s.branch_id
where exists (select 1 from slot_types t
              where t.branch_id = s.branch_id and t.kind = 'break'
                and lower(btrim(t.name)) in ('tushlik', 'lunch', 'обед'))
group by b.name;
-- and, for the version days at stake:
select b.name, count(*) from timetable_version_days d join branches b on b.id = d.branch_id
where d.kind = 'break' group by b.name;
```

The first query over-counts: it counts every span in a branch that has a lunch type. The preview gives the exact figure.

**What is not rewritten.** The audit log and the request keys stay as written, as history. The audit entry of the switch lists every renumbered row with its before and after values, so the old numbers in earlier entries can be read against it.

## 4. Proposed `/spec-change` wording

**A. `03-school-setup.md`, Slot types and day templates.** Replace "A slot type has a name, a kind (lesson or break) and a length in minutes: for example Lesson 45, Break 15, Long break 20, Lunch 40." with:

> A slot type has a name, a kind (lesson or break), a length in minutes and, for a break, whether it counts as a period: for example Lesson 40, Break 10, Lunch 40 (counts as a period). Each slot of a day template that is a lesson slot or a counted break has a **period number**: its place among those slots, from 1; a break that does not count has none (`06`, Model, Period). Whether a break counts holds for every date, past ones included, and changes no time; switching it shows first which stored numbers change, and recomputes them from their clock times in the same step.

**B. `06-timetable.md`, Model.** A new row after Slot:

> | Period | The number of a slot in its day: its place among the lesson slots and the counted breaks of that day's template (School setup). Where lunch counts, a period number is the same clock time for every grade whatever the grade's lunch, so "the 7th lesson" is one time for the whole branch. A lesson is named by its period wherever a number is shown, typed, chosen, imported, printed or stored. A counted break is a period that never holds a lesson: a number that names it is refused wherever a lesson is placed, moved, imported or chosen for one class or group, and a choice over several classes skips the classes for which it is a break. Rules that depend on order (a double lesson, a free period, the first slots of the day, a shortened day) count lesson slots only. A branch with no counted break numbers its lessons as before. |

**C. `06-timetable.md`, Importing, The timetable import.** Replace "weekday, slot number of the day template in force on the draft's start date" with:

> weekday, period of the day template in force on the later of the draft's start date and today (Model, Period); a period that is not a lesson slot of the row's grades is a problem of the row

and "Two rows of one double lesson are two consecutive slots" with "two consecutive lesson slots (a counted break between them does not part them)".

**D. `06-timetable.md`, Changes after publishing.** Bulk cancel: "chosen classes, date and slots" becomes "chosen classes, date and periods". Exam: "one or more consecutive lesson slots of the day template (the breaks between them included)" becomes "the lesson slots from a first period to a last, each a lesson slot (the breaks between them included, counted or not)".

**E. `06-timetable.md`, Views and outputs.** Add:

> Every timetable view, print and export numbers its rows by period; a counted break shows its slot type's name in its row.

**F. `09-lesson-plans.md`, line 73.** "number, date, slot" becomes "number, date, period".

**G. `edge-cases/time-dates-calendar.md`, shortened day.** After "Lessons are matched by their order in the day", add "(their order among the lesson slots; the numbers shown are the date's periods)".

**H. `edge-cases/00-definitions.md`.** A new row:

> | Period | The number of a slot in the day: its place among lesson slots and breaks that count as a period (`03`, Slot types). The number of a lesson everywhere it is shown, typed or stored. Not the lesson's place in the quarter (journal "No.", lesson plans) and not the number of a past mark's lesson (`10`). |

**I. `edge-cases/developer-rules.md`, Lesson times.** Add:

> Period numbers are worked out from the template and the slot types when read. A stored lesson number (a bulk cancel's choice) is a period; a change of which breaks count recomputes every such number from its clock time in the same transaction. A position in a template (pattern, pins, keeps, exams) is stored with every break counted and never depends on the setting.

**Unchanged:**

- `02` and `06`, the assistant example "cancel lessons 4 to 8": after B, these are periods.
- `edge/exemptions`, "Slots 5–7": stored as times.
- `10`, past marks: a subject's lesson that day.
- `07`, "No." and `09`, lesson number: the order in the quarter.

## 5. Plan

**What exists when done.** A break slot type can be marked "counts as a period". Every lesson number the platform shows, takes, imports, prints or stores is the period number. Lunch periods are refused wherever a lesson number is typed or chosen. Switching the setting previews and recomputes the stored numbers in one audited step. Labzak sees no change.

**Database** (one migration, `0192_period_numbers`, add-only):

- `slot_types.counts_as_period boolean not null default false`, granted for update, with a check `not counts_as_period or kind = 'break'`. A constant default adds no rewrite and takes no long lock.
- `timetable_version_days.counts_as_period boolean not null default false`, granted for insert and update.
- The checks of `bulk_cancels.lesson_numbers` already allow 1..20. A check is added on `bulk_cancel_spans.lesson_number` between 1 and 20 (`not valid`, then `validate`).

**Shared and engine:**

- `DaySlot` gains `period` and `lessonOrder`. `dayTimes()` takes `countsAsPeriod` per slot.
- `period ↔ slot` helpers: `slotOfPeriod`, `periodOfTime`.
- The engine keeps order rules on `lessonOrder` (decision 3).
- Schemas: bounds to 20, descriptions to "period".
- Write the failing tests first: a fast-check property that the period of a lesson slot is unchanged when no break counts (Labzak), and that the same period has the same clock time across Istirohat's three grade templates.

**API:**

- The switch: `PATCH /api/setup/slot-types/:id/period` with `@Requires('day_templates', 'edit')`, the same as renaming a slot type, so no permission change. It has a preview route and a confirm with `@RequestKey`, the recompute of S1–S3 in the transaction, and one audit entry.
- Every place in section 2.2 changes.
- The `exams.service.ts:1344` mix-up is fixed.
- `pnpm api:client` and `pnpm security:checklist` are run again.

**Web:**

- Every place in section 2.3.
- The switch with its preview table: every weekday and grade with period → time, plus the stored rows that change.
- Keys in uz, ru and en.

**Tests:**

- Engine tests for each A4 function on the Istirohat shape (three grade templates, Friday with two lunch periods).
- Route tests for each refusal `period_not_lesson`: move, exam, import, a bulk cancel with no chosen class having a lesson there. Allow and refuse tests for the switch and its preview, with 404 tests for another branch's slot type, and `rowsOf` over the slot types, the bulk cancels, the spans and the version days.
- The recompute against stored rows on dates with two different templates in force.
- Labzak unchanged: a snapshot of every API answer on the Labzak fixture before and after.
- Playwright: switch Tushlik on, and see period 7 at 14:00 for grades 3, 7 and 10 in the views, the journal header and the bulk cancel dialog.

**Split.** Planned as one task. If one session cannot hold it, then **a**: database, engine, API, imports, exports, the switch route; **b**: the web places of 2.3, the switch screen, the locale texts, e2e. Decision 12.

## 6. Decided without the owner (proposed)

1. **Look first.** The setting has no date. It holds for every date, past ones included, and changes no time. Past journal columns and printouts made afterwards show periods. It is a way of counting, not a change of lesson times, so it does not follow "from tomorrow".
2. **Look first.** The migration is add-only. Stored numbers are recomputed by the switch route, in the same transaction, with a preview, an audit entry and tests in CI. The Istirohat switch is then made on the setup screen after deploy. **The alternative**, if the owner prefers it, is a data migration `0193` that turns the setting on for the break types named Tushlik at Istirohat and runs the same recompute. That migration changes existing rows, so it is stop item 3 and needs the owner's approval on the pull request.
3. **Look first.** Order rules stay on the order of lesson slots, not periods. Periods 4 and 6 around a counted lunch are still a double lesson. Lunch is not a "free period in the middle of the day". A shortened day still matches lessons by their order. This keeps every generated and published timetable valid as it is.
4. **Look first.** API and file field names stay (`lessonNumber`, `lessonNumbers`, `slot`, `firstLesson`, `lastLesson`); their meaning becomes the period, and the integration guide says so. Integration clients do not break, and the change is smaller in the area where a mistake costs most.
5. **Look first.** A stored bulk cancel's `lesson_numbers` becomes the sorted, distinct periods of its own spans. One stored list cannot stand for different periods in different grades; the spans already hold the times each class was cancelled.
6. **Look first.** This is a spec text that should change: the `/spec-change` wording is section 4.
7. A choice over several classes (bulk cancel) skips a period for the classes where it is a break. It is refused (`period_not_lesson`) when it is a lesson slot for none of them. This matches decision 2 of 5.6a-3: "a number a day lacks is skipped for that class".
8. Only a break can count; a lesson slot always has a period (a check constraint).
9. Wording: English "Lesson N" becomes "Period N". Uzbek "N-dars" and Russian "Урок N" / "N-й урок" stay, because teachers already say "7-dars" for period 7. The import column headings stay in uz and ru, and become "Period" in en.
10. The views show the row of a counted break with its name, greyed, so that period numbers never jump.
11. The places that showed a template position (builder grid, pins, version compare, copies, publish chain, out-of-date) show the period. This also fixes their uz and ru texts, which call a position a lesson today.
12. **Split, Look first, only if needed** (section 5).
13. The Friday lunch of grades 5–11 is two periods only if the Friday template has **two** Tushlik slots. A single 80-minute Tushlik counts as one period. The switch preview shows the period → time table for every weekday and grade, so this is seen before saving.
14. Solver (5.10, not built): a From line, "the solver's input names slots by position and carries `lessonOrder` for its rules; its output is checked by the engine as today".
15. Past marks, the journal's "No." and the plan's lesson number are not touched (section 1).

## 7. Needs the owner

- **Decision 2:** switch on the screen (recommended), or a data migration for Istirohat (stop item 3). Approval goes on the pull request.
- The third branch's name and whether any of its breaks count.
- Whether Istirohat's Friday template for grades 5–11 has two Tushlik slots (decision 13).
