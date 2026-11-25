# Spec change proposal: decimal scores for classwork and homework

Requested by the owner, 25 November 2026. Status: **waiting for the owner's approval**. Nothing under `docs/spec/` is changed yet.

## 1. Every place that states the rule

| # | File, heading | Current text |
| --- | --- | --- |
| A | `07-journal.md`, The total | "The number typed is a whole number. Decimals are not accepted." |
| B | `07-journal.md`, The total, table of examples | three rows (30 / 12 / 40%, 5 / 4 / 80%, 100 / 85 / 85%), all whole |
| C | `07-journal.md`, Entering data, Keyboard | "Arrows, Tab and Enter move between cells; digits type; a key opens the comment." |
| D | `edge-cases/journal.md`, Entering, "The teacher types "1" then "2" for 12." | "Letters, decimals and numbers above the total are refused in the cell." |
| E | `16-open-questions.md`, row 18 | "Can the number typed for a work have a decimal? \| No. Whole numbers only." |
| F | `13-technology.md`, Database | "typed numbers, totals and exact results stored as whole numbers" |
| G | `edge-cases/developer-rules.md`, Calculation | "Exact fractions (integer numerator and denominator) from typed number and total to the result." (true still; gains how a decimal score is held) |
| H | `14-quality-plan.md`, Rule tests | the list of edges (gains decimal scores) |
| I | `edge-cases/calculation.md`, Calculation | no row for a decimal score (one is added) |

Already true and unchanged: `07` rule 2 (percent = number typed ÷ total × 100), "The percent is shown as a whole number … The exact value is kept and used in every average", rule 10 (rounded once, at the end); "The total is a whole number, 1 or more"; "The number typed is from 0 up to the total"; the rating exam "Whole numbers from 0 to 100" (`edge/calculation`, The rating exam; `07`, Rating exam); `14` "exact fractions … never floating point and never fixed-precision decimals" (a score of 8.25 is the exact fraction 825/100, so no decimal arithmetic is needed).

Outside the spec, the same rule is written in the loop's own files (not changed by `/spec-change`; see section 3): `CLAUDE.md` ("Typed scores and totals are whole numbers." under Exact arithmetic; "Money, marks and totals are integers." under Conventions), `.claude/rules/journal.md` ("Typed scores and totals are whole numbers."), `.claude/rules/calc.md` ("Exact fractions … from typed numbers to the final result", still true).

## 2. Side effects and what could go wrong

1. **Calculation.** No result changes for scores already typed: a whole number is a decimal with no digits after the point. A score like 7.5 enters as 75/10, so results stay exact fractions and are rounded once, at the end. `packages/calc` must accept a score that is not a whole number: a change of `packages/calc`, which stops the code task for the owner (stop item 4).
2. **Storage.** Scores are stored as whole numbers today, checked by the database from 0 to the total. They must be held exactly with two decimal places (for example as a whole number of hundredths, 7.5 as 750, or as an exact SQL decimal), never as floating point. Turning the existing scores into the new form may change existing rows on the live system (stop item 3). The form is chosen in the code plan.
3. **Point or comma.** Uzbek and Russian write 7,5; English writes 7.5. The teacher may type either. Shown back, the score follows the person's language (7,5 in Uzbek and Russian, 7.5 in English), without trailing zeros (7.50 shows 7,5). This is the reading proposed below; it touches the grid, lesson mode on a phone (the keypad must offer the point or comma), the cell history, the support view, exports and prints, the portal and the digest.
4. **Excel exports.** A score is written as a number cell, so Excel shows it in the reader's own format and it can be summed.
5. **Third parties.** Integration keys read scores through the API: a score can now be 7.5, which the integration guide must say. Any program reading scores as whole numbers would break; none is known.
6. **Mistakes.** 7.555 (three digits after the point), 7,5,1, 1.000.5 and letters are refused in the cell. "8." or "8," with nothing after the separator is read as 8.
7. **The rating exam stays whole.** Its cell keeps refusing decimals, so the two kinds of cells behave differently; the cell's refusal names the reason.
8. **Changing the total.** Unchanged: the total stays whole, and a change is refused if a score is above the new total (9.5 with a new total of 9 is refused).

## 3. New wording

**A** `07-journal.md`, The total (replaces the bullet):
> - The number typed may have up to two digits after the decimal point, for example 7.5 or 8.25, typed with a point or a comma (owner, 25 November 2026). It is kept exactly as typed and enters every calculation as an exact fraction. It is shown in the person's language, 7,5 in Uzbek and Russian and 7.5 in English, without trailing zeros.

**B** `07-journal.md`, The total, a fourth row in the table of examples:
> | Give half points | 10 | 7.5 | 75% |

**C** `07-journal.md`, Keyboard:
> - **Keyboard.** Arrows, Tab and Enter move between cells; digits, a point and a comma type; a key opens the comment.

**D** `edge-cases/journal.md`, "The teacher types "1" then "2" for 12.", last sentence:
> Letters, numbers above the total and more than two digits after the point or comma are refused in the cell; "8." is read as 8. A rating exam score takes whole numbers only.

**E** `16-open-questions.md`, row 18 answer:
> Yes, up to two digits after the decimal point, typed with a point or a comma (owner, 25 November 2026; until then, whole numbers only). The total and the rating exam score stay whole.

**F** `13-technology.md`, Database, the rules the database enforces:
> typed scores (with at most two digits after the decimal point), totals and exact results stored exactly, never as floating point;

**G** `edge-cases/developer-rules.md`, Calculation:
> | Calculation | Exact fractions (integer numerator and denominator) from typed number and total to the result; a score with decimals enters as its exact fraction (8.25 is 825/100). Stored per final result: the inputs, the exact result, the rounded result, the grade, the settings used and the calculation module's version. |

**H** `14-quality-plan.md`, Rule tests, the list of edges gains:
> …a number equal to the total, scores with one and two decimals (7.5 and 8.25, typed with a point and with a comma), a total changed after numbers were typed…

**I** `edge-cases/calculation.md`, a new row after the boundary row:
> | A score with decimals: 8.25 out of 11, and 7.5 and 9.75 out of 10 in one quarter. | Each enters as an exact fraction: 8.25 ÷ 11 is exactly 75%, and the mean of 75% and 97.5% is exactly 86.25. Nothing is rounded before the end. |

**Loop files, if the owner agrees** (changed with this spec change, in the same commit, since they restate the spec rule):
- `CLAUDE.md`, Exact arithmetic: "Typed scores and totals are whole numbers." → "Totals are whole numbers; a typed score has at most two digits after the decimal point and enters as an exact fraction."
- `CLAUDE.md`, Conventions: "Money, marks and totals are integers." → "Money, marks and totals are integers; a typed score is exact with at most two decimal places, never floating point."
- `.claude/rules/journal.md`: "Typed scores and totals are whole numbers." → "Totals are whole numbers; a typed score has at most two digits after the decimal point, held exactly, never as floating point."

## 4. After approval

The spec edits, the entry in `docs/spec-changes.md`, then the list of code and tests (the journal is built), whose plan waits until the owner says the spec changes are done.
