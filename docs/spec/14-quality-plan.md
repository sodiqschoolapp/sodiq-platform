# Quality plan

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

The timetable and the journal must not have mistakes. Each of the two is protected by several layers, so that one missed case in the code cannot reach a user.

## Timetable

| Layer | What it does |
| --- | --- |
| Database rules | The database refuses two lessons for one teacher, one room or one class at overlapping times. This holds even if the application code has a fault or two people save at the same moment. |
| One rule engine | The same checking code runs in the browser while dragging and on the server when saving. The two can never disagree. |
| Generated tests | Thousands of random timetables and random edits are generated automatically; after each, the tests check that no teacher, room, class or student is in two places and that lessons with data were not lost. |
| Scenario tests | Named cases with expected results: parallel groups, shortened days, a holiday inside a week, a version starting mid-week, substitution, cancel and restore, a student in a class lesson and a group lesson. |
| Publish preview | Before a version is published the system shows exactly which dated lessons will be created, changed or left alone. |
| Generator | The generator's output passes through the same rule engine and database rules as a hand edit, so it cannot introduce a conflict. It is tested on the school's real teaching load with names replaced: that load must produce a complete timetable with no errors. |

## Journal

| Layer | What it does |
| --- | --- |
| One calculation module | Every result on every page comes from the same code. It uses exact fractions (whole-number numerator and denominator), never floating point and never fixed-precision decimals. Rounding happens once, at the end. |
| Reference journals | A set of journals with results worked out by hand and signed off by the academic team is kept as a fixed test set. It includes real rows from 2025–26 where last year's rule and the new rule are the same. Every code change must reproduce them to the last point. |
| Rule tests | Each calculation rule in the Journal section has its own tests, including the edges: no classwork in a quarter, several classworks in one lesson, homeworks with no classwork, all lessons exempt, a mid-quarter transfer, a weight changed mid-quarter, totals of 1, 5, 30 and 100, a number equal to the total, a total changed after numbers were typed, the 49.5 and 83.5 boundaries. |
| Stored inputs, repeatable results | Raw marks and weights are stored; results can be recalculated at any time and must match. A nightly job recalculates every open journal and reports any difference. |
| Closed quarters | Final results are stored when a quarter closes and no longer depend on later changes to settings. |
| Saving | Every cell save is one transaction and can be repeated safely, so a retry after a lost connection never doubles or loses an entry. |

## Whole system

- **Automated tests on every change.** Unit tests, API tests, and browser tests that act as each role and walk the main paths: build and publish a timetable, take attendance, enter scores, close a quarter, transfer a student.
- **Permission tests.** For every role and every API address, a test checks what is allowed and what is refused.
- **Code review.** There is one developer, so no change reaches production without passing the automated tests and an independent automated review. A change to permissions or to the calculation module also needs the owner's sign-off on a written checklist.
- **Speed tests.** The targets in User experience standards are measured automatically with a full-size data set: all branches, a full year of lessons, 1,000 simulated users.
- **Test environment.** Each release is first installed on a test copy and checked by the Academic Vice Principal's team against a written checklist.
- **Pilot.** Before the full switch, run the new system with one grade for two to three weeks alongside the present way of working, and compare results.
- **Monitoring.** Errors and slow pages raise alerts for the developers at once. A feedback button on every page sends a report with the page and role attached.
- **Recovery.** Backups are restored every month to a separate restore server inside the live environment, under the same access rules. The audit log allows any single change to be traced and reversed.
- **Releases.** Small and frequent, outside lesson hours, with the ability to return to the previous version in minutes.
