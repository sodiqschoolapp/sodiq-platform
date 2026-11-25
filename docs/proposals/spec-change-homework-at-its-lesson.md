# Spec change proposal: homework is graded at the lesson where it was given

Requested by the owner, 25 November 2026. Status: **approved by the owner, 25 November 2026, and applied** (`docs/spec-changes.md`). On question 2 the owner chose the simpler rule, not the recommendation: a student not expected at the lesson where the homework was given does not get it, and a number already saved for them leaves the averages and stays in history. The applied wording, not section 4 below, is the one in force.

## 1. Every place that states the rule

| # | File, heading | Current text (the part that changes) |
| --- | --- | --- |
| A | `07-journal.md`, Layout, row "Lessons" | "one homework column for each homework **checked at it**" … "U for **uy vazifasi** in Uzbek" |
| B | `07-journal.md`, Entering data, "Classwork and homework" | "any number of **homeworks given**" … "any number of classworks and of **"homework given"** in the journal" |
| C | `07-journal.md`, Entering data, "Homework column" | "The homework numbers in a lesson's homework columns are for the homeworks checked at that lesson, which are the tasks given at the previous lesson: one column for each homework given there. An empty homework column is never shown. So the first lesson of the year has none, and neither does a lesson after one where no homework was given. Homework given at the last lesson of a quarter is checked, and counted, in the next quarter." |
| D | `07-journal.md`, Closing a quarter | "Homework given at the last lesson of the quarter is not an open item; it belongs to the next quarter." |
| E | `09-lesson-plans.md`, What a plan contains, row "Homework" | "Each homework is a task given at this lesson and becomes a homework column of the next lesson. A lesson can have no homework; then the next lesson has no homework column." |
| F | `09-lesson-plans.md`, In the journal | "one homework column for each homework of the previous lesson's plan item" … "If a planned work was not done or not checked" |
| G | `09-lesson-plans.md`, In the journal | "The lesson card shows two homework lines: "given today", the homeworks of this lesson's plan item, and "checked today", the homeworks given at the previous lesson, which are what the homework numbers of this lesson refer to." |
| H | `09-lesson-plans.md`, In the journal | "can add classworks and **"homework given"** in the journal at any time" |
| I | `edge-cases/journal.md`, Entering | "Homework given on Monday is not checked on Wednesday but on Friday. → At the check lesson the teacher chooses, for each homework, "not checked" or "check at the next lesson" (once). Carried homework appears at the next lesson as its own column…" |
| J | `edge-cases/journal.md`, Entering | "A student was exempt, or not yet in the group, when the homework was given. → That student's homework cell is optional: not waited for, no reminder. A number typed there counts." |
| K | `edge-cases/journal.md`, Entering | "The lesson where homework should be checked is cancelled. → The homework columns move to the next held lesson, each as long as it has no numbers yet." |
| L | `edge-cases/journal.md`, Entering | "Homework on the last lesson of the year, or of a journal that is closing. → Allowed in the plan with the note "will not be graded". It creates no column." |
| M | `edge-cases/journal.md`, Entering, rows "no plan item", "two graded classworks", "eleventh classwork" | "of **"homework given"**", "any number of **homeworks given**", "at most 10 **homeworks given**" |
| N | `edge-cases/journal.md`, Closing and reopening, "My grade disappeared." | the list of how a value changed (gains the one-time move) |
| O | `edge-cases/lesson-plans.md`, How items stay attached, groups merged | "Homework never carries across journals: the closed journal's last homework is marked "not checked, group closed"." |
| P | `edge-cases/lesson-plans.md`, How items stay attached, double lesson | "Homework on the first of two same-day lessons shows the warning "will be checked today in slot N"." |
| Q | `edge-cases/lesson-plans.md`, Plans and the journal, approved edit | "Removing a homework is refused if the next lesson holds numbers for it." |
| R | `edge-cases/lesson-plans.md`, Plans and the journal, substitute | "…and the next lesson gets no column for a homework not given." |
| S | `edge-cases/00-definitions.md` | "Previous lesson \| For homework: the nearest earlier held lesson of the same journal in the same academic year. Cancelled lessons are skipped; substituted lessons count." |
| T | `edge-cases/academic-year.md`, go-live mid-year, **Journals and plans** | "The first lesson of each journal after the start date has no homework column." |
| U | `10-portal-notifications-release-2.md`, Today | "the homework still to hand in, the nearest first;" |
| V | `10-portal-notifications-release-2.md`, Homework | "Tasks by date and subject" (which date is now unambiguous) |
| W | `16-open-questions.md`, rows 17 and 36 | "17 … On the day it is checked." / "36 … any number of homeworks given" |

Checked and unchanged: `02` (roles), `05` (weights), `08` (homework average), `14` (rule tests), `edge-cases/calculation.md`, `edge-cases/developer-rules.md` (cells unique on lesson, student, work: still true), `edge-cases/exemptions.md`, `edge-cases/timetable.md` (the "Homework slot" is a Tutor lesson, a different thing).

## 2. Side effects and what could go wrong

1. **Within a quarter no figure changes.** Every work counts equally in the quarter average whatever lesson holds it (rule 6), so moving a homework from the check lesson back to the lesson where it was given changes nothing, except in the three cases below.
2. **Quarter boundary.** Homework given at the last lesson of quarter 1 and graded at the first lesson of quarter 2 moves into quarter 1. If quarter 1 is open, quarter 1 and quarter 2 results change. If quarter 1 is **closed**, moving it changes a final result: the nightly check would find a difference and block. → Owner question 1. **Owner, 25 November 2026: no quarter is closed (the journal started a few days ago), so only open quarters change.**
3. **Students not expected at the lesson where it was given.** A student exempt at that lesson, or not yet in the group, has closed cells there, and "works given in exempt lessons are left out". A number they got at the check lesson (it counted under row J) would land in a closed cell. → Owner question 2.
4. **Lessons that turn "locked incomplete".** Homework given at a lesson now locked, whose check lesson has not come yet or whose column was never touched, becomes a column with no total at a locked lesson: that lesson becomes "Locked incomplete" and shows in the discipline report through no fault of the teacher. → Owner question 3. **Owner: no lesson is locked yet.**
5. **Weekly subjects and the edit period.** A homework is graded at its own lesson, under that lesson's lock. In a once-a-week subject the homework is handed in 7 days later, the same day the 7-day edit period ends; after a holiday week it is already locked and needs an unlock. The owner chose this; the Academic Vice Principal can lengthen the edit period (a setting). Not a spec change, but the teachers should be told. **Owner: the edit period is 30 days now, so a weekly homework has room.**
6. **Closing a quarter.** Homework given at the last lesson of a quarter now belongs to it: its missing numbers appear under "Planned works with numbers missing" (a warning), and the last lessons' edit period still blocks closing until they lock. In practice the last homework of a quarter must be handed in before closing.
7. **"Not held" and "not given" stay.** A homework not done or not graded is marked "not held" at its own lesson. "Not given" (topic not delivered) now simply means that homework has no column at its lesson.
8. **Plan items moving.** When a future lesson is cancelled its plan item, with its homeworks, moves to the next lesson (`09`, When something else changes); the homework columns go with the item, so no separate column move is needed.
9. **Stop list.** The data move is a migration that changes existing rows on the live system (stop item 3 since 28 October). The code task's pull request therefore waits for the owner even though the owner asked for the change. `packages/calc` is not expected to change (stop item 4): the quarter of a work comes from its lesson, which the API passes in; the code plan will confirm this.

## 3. Owner questions (with the recommendation)

1. **Closed quarter.** Settled by the owner (25 November 2026): no quarter is closed. The rule needs no case for it; the code move refuses to run, and reports, if it ever finds one.
2. **Student not expected at the lesson where it was given** (exempt, or not yet in the group): **recommended: the number moves with the column and keeps counting**, marked, so no score a family has already seen disappears. Alternative: it leaves the averages and stays in history.
3. **Homework with no data at a locked lesson.** Settled by the owner: no lesson is locked (the journal started a few days ago, and the edit period is 30 days). No rule is needed; the code move refuses to run, and reports, if it finds one.

The wording below follows the recommendation for question 2, marked ⟨Q2⟩.

## 4. New wording

**A** `07-journal.md`, Layout, row "Lessons", Row 2:
> Row 2: the attendance column, then one classwork column for each classwork of the lesson and one homework column for each homework given at it, each with its title and, in front of the title, a small coloured tag with the letter of its kind (S for sinf ishi and U for uyga vazifa in Uzbek, К and Д in Russian, C and H in English; the full word on hover).

**B** `07-journal.md`, "Classwork and homework": "any number of homeworks given" → "any number of homeworks"; "any number of classworks and of "homework given" in the journal" → "any number of classworks and homeworks in the journal".

**C** `07-journal.md`, "Homework column" (replaces the whole bullet):
> - **Homework column.** A homework is graded at the lesson where it was given (owner, 25 November 2026). Each homework of a lesson's plan item is a homework column of that lesson: the teacher sets its total and types the numbers there, as for a classwork. No other lesson has a column for it. A homework column follows the edit period, locks and unlocks of its lesson and counts in that lesson's quarter, so homework given at the last lesson of a quarter belongs to that quarter, and homework given at the last lesson of the year has a column like any other.

**D** `07-journal.md`, Closing a quarter, last bullet:
> - Homework given at the last lesson of the quarter belongs to that quarter, like every work of that lesson.

**E** `09-lesson-plans.md`, row "Homework":
> | Homework | Optional, any number. Each homework is a task given at this lesson and becomes the title of its own homework column at this lesson, where it is graded. A lesson with no homework has no homework column. A homework can carry its own files; from Release 2 students and parents see them with the homework. |

**F** `09-lesson-plans.md`, In the journal, "Columns follow the plan":
> - Columns follow the plan. A lesson has one classwork column for each classwork of its plan item, and one homework column for each homework of its plan item. A lesson with neither shows attendance only; no empty columns are shown. The titles come from the plan, so to grade a work the teacher only sets the total and types the numbers. If a planned work was not done or not graded, the teacher marks it "not held" and its column is removed from that lesson; this is kept in history. A work that was not in the plan is added on the lesson card or in the plan, under the rules below.

**G** `09-lesson-plans.md`, In the journal (replaces the "two homework lines" bullet):
> - The lesson card lists the homeworks of this lesson's plan item, which are this lesson's homework columns.

**H** `09-lesson-plans.md`, In the journal: "can add classworks and "homework given" in the journal" → "can add classworks and homeworks in the journal".

**I** `edge-cases/journal.md`, Entering (replaces the row):
> | Homework given on Monday is handed in on Friday. | It is graded in Monday's homework column while Monday's lesson can be edited: inside its edit period, or under an unlock of that lesson. No other lesson has a column for it. |

**J** `edge-cases/journal.md`, Entering (replaces the row):
> | A student was exempt, or not yet in the group, at the lesson where the homework was given. | The homework is that lesson's work, so the student's cell is closed and the homework is left out of their averages (`07`, Effect on totals). Numbers saved before 25 November 2026 are the one exception (row below). |

**K** `edge-cases/journal.md`: the row "The lesson where homework should be checked is cancelled" is removed.

**L** `edge-cases/journal.md`, Entering (replaces the row):
> | Homework on the last lesson of the year, or of a journal that is closing. | It has a column at that lesson like any homework and is graded under that lesson's edit period. |

**M** `edge-cases/journal.md`: "of "homework given"" → "of homeworks"; "any number of homeworks given" → "any number of homeworks"; "at most 10 homeworks given" → "at most 10 homeworks".

New row in `edge-cases/journal.md`, Entering, after L:
> | Homework numbers were saved before 25 November 2026 at a later lesson than the one where the homework was given (the next lesson, the next held lesson after a cancelled one, or the lesson it was carried to). | Once, on the change, each such homework column moves with its total, "not held", numbers and comments to the lesson where the homework was given, and counts in that lesson's quarter. Each move writes an audit entry and a line in each cell's history. ⟨Q2⟩ A number of a student who was exempt, or not yet in the group, at the lesson where the homework was given moves with the column, keeps counting and is marked. |

**N** `edge-cases/journal.md`, "My grade disappeared.": "(teacher, late entry, correction, exemption, transfer, cancellation, "not held", offline entry)" → "(teacher, late entry, correction, exemption, transfer, cancellation, "not held", offline entry, the homework move of 25 November 2026)".

**O** `edge-cases/lesson-plans.md`, groups merged, last sentence:
> Each homework is graded at the lesson where it was given, so nothing carries across journals: the closed journal keeps its last homework at its own lesson.

**P** `edge-cases/lesson-plans.md`, double lesson:
> | A double lesson. | Two rows. The second offers "same topic as the previous lesson". |

**Q** `edge-cases/lesson-plans.md`, approved edit: the sentence "Removing a homework is refused if the next lesson holds numbers for it." is removed ("A work that has numbers cannot be removed, only marked "not held"" already covers it).

**R** `edge-cases/lesson-plans.md`, substitute: "…and the next lesson gets no column for a homework not given." → "…and a homework not given has no column."

**S** `edge-cases/00-definitions.md`: the row "Previous lesson" is removed (nothing else uses it).

**T** `edge-cases/academic-year.md`: the sentence "The first lesson of each journal after the start date has no homework column." is removed.

**U** `10-portal-notifications-release-2.md`, Today:
> | Today | The child's lessons of the day with the mark of each one marked, or the next school day of the week when the day has none; the latest scores (see Grades). Each part links to its page. It is the first page a parent opens (owner, 19 November 2026). |

**V** `10-portal-notifications-release-2.md`, Homework: "Tasks by date and subject" → "Tasks by the date of the lesson where they were given and by subject".

**W** `16-open-questions.md`, row 17 answer: "On the day it is given, at the lesson where it was given (owner, 25 November 2026; until then, on the day it was checked)." Row 36: "any number of homeworks given" → "any number of homeworks".

## 5. After approval

The spec edits above, the entry in `docs/spec-changes.md`, then the list of code and tests and a plan for the code change (the feature is built: tasks 8.1, 8.8, 7.x plans in the journal, the portal), which waits for approval too.
