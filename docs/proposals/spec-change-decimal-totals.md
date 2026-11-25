# Spec change proposal: decimal totals

Requested by the owner, 25 November 2026 ("can we make it accept decimal numbers as well", of the total a teacher sets for a work). Status: **waiting for the owner's approval**. Nothing under `docs/spec/` is changed yet.

It follows the decimal scores change of the same day, which kept the total whole.

## 1. Every place that states the rule

| # | File, heading | Current text |
| --- | --- | --- |
| A | `07-journal.md`, The total | "The total is a whole number, 1 or more." |
| B | `edge-cases/journal.md`, Entering, "A total of 3000 is typed…" | "A total is from 1 to 1000." |
| C | `16-open-questions.md`, row 18 | "The total and the rating exam score stay whole." |
| D | `10-portal-notifications-release-2.md`, Past marks, The rules of a row | "the total is a whole number of 1 or more" |
| E | `edge-cases/academic-year.md`, Past marks, "A score is typed 7,5, or a total 10.5." | "A total that is not a whole number is a problem of the row." |
| F | `13-technology.md`, Database | "typed scores (with at most two digits after the decimal point), totals and exact results stored exactly" |
| G | `edge-cases/developer-rules.md`, Calculation | "a score with decimals enters as its exact fraction (8.25 is 825/100)" |
| H | `14-quality-plan.md`, Rule tests | "scores with one and two decimals (7.5 and 8.25) and a comma refused" |
| I | `CLAUDE.md`, Exact arithmetic and Conventions; `.claude/rules/journal.md` | "Typed totals are whole numbers…", "Money, marks and typed totals are integers…", "Totals are whole numbers…" |
| J | `docs/build-plan.md`, 11.25 and 11.26 | "the total and the rating exam score stay whole"; "the whole total"; the approval of item 4 "for decimal scores only" |

## 2. Side effects

1. **Calculation.** A total of 7.5 enters as 75/10, so the percent (score ÷ total) is still an exact fraction. No result of totals already set changes. `packages/calc` takes a decimal total in the same change as the decimal score (11.25), so the approval of item 4 for 11.25 should say "decimal scores and totals".
2. **Storage.** The work's total is stored as a whole number today, like the score; it changes form in the same two steps as the score in 11.25.
3. **The same entry rules as a score.** A point only, at most two digits after it, shown without trailing zeros. The limits stay: from 1 to 1000. A total below 1 (0.5) stays refused.
4. **Unchanged.** The score is from 0 to the total (9.5 out of 9.5 is allowed). A change of total is refused when a score is above the new one. The last total used is offered for the next work. The rating exam score stays whole.

## 3. New wording

- **A** `07`: "The total is a whole number, 1 or more." → "The total is a number of 1 or more, with up to two digits after the decimal point, for example 30 or 7.5, typed and shown like a score (owner, 25 November 2026)."
- **B** `edge/journal`: "A total is from 1 to 1000." → "A total is from 1 to 1000, with up to two digits after the point."
- **C** `16`, row 18: "The total and the rating exam score stay whole." → "The total may have two decimals as well; the rating exam score stays whole."
- **D** `10`, Past marks: "the total is a whole number of 1 or more" → "the total is from 1 to 1000 with at most two digits after the decimal point".
- **E** `edge/academic-year`, Past marks: the case "A score is typed 7,5, or a total 10.5." becomes "A score or a total is typed 7,5." and its rule "As in the journal: a point only, at most two digits after it; an Excel number cell is read as its value."
- **F** `13`: "typed scores (with at most two digits after the decimal point), totals and exact results stored exactly" → "typed scores and totals (with at most two digits after the decimal point) and exact results stored exactly".
- **G** `edge/developer-rules`: "a score with decimals enters as its exact fraction (8.25 is 825/100)" → "a score or a total with decimals enters as its exact fraction (8.25 is 825/100)".
- **H** `14`: "scores with one and two decimals (7.5 and 8.25) and a comma refused" → "scores and totals with one and two decimals (7.5 and 8.25) and a comma refused".
- **I** `CLAUDE.md`, Exact arithmetic: "Typed totals are whole numbers; a typed classwork or homework score has at most two decimal places and is read as an exact fraction." → "A typed total, classwork score or homework score has at most two decimal places and is read as an exact fraction; the rating exam score is whole." Conventions: "Money, marks and typed totals are integers; a typed classwork or homework score has at most two decimal places and is read as an exact fraction." → "Money, attendance marks and grades are whole numbers; a typed total, classwork score or homework score has at most two decimal places and is read as an exact fraction." `.claude/rules/journal.md`: "A typed total or score has at most two digits after the decimal point, held exactly, never as floating point; the rating exam score is whole."
- **J** `docs/build-plan.md`: 11.25 takes decimal totals with the scores (the database, `packages/calc`, entry, display, the API), the approval of item 4 reads "for decimal scores and totals only", and its Done when gains "a total of 7.5 with a score of 6 shows 80%"; 11.26 reads "the total with at most two decimals".
