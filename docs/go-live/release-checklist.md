# Release checklist of the test environment

Walked by the Academic Vice Principal's team on the test environment, `https://app-test.sodiqschool.uz`, before a release goes to production (`14`, Whole system, Test environment: "Each release is first installed on a test copy and checked by the Academic Vice Principal's team against a written checklist"). The test environment holds invented data only.

The release is the newest commit of `main` deployed to the test environment (`deploy-test` green, `docs/deploy.md`). The owner deploys it to production only after the team's "checked", written in the approval of the Deploy production run ("checked by the team on <date>").

## Each release

- [ ] Sign in as each role the pilot uses: Teacher, Tutor, Head Teacher, Academic Vice Principal. Each home page opens.
- [ ] A teacher opens a journal of their own, marks attendance, types a score and saves; the cell keeps the value after a reload.
- [ ] The daily result of that student changes as expected, and the same figure shows in the student's results.
- [ ] A Tutor opens their class; a Head Teacher opens a journal of their subjects.
- [ ] The timetable of a class and of a teacher opens; a change on the board is refused when it double-books a teacher or a room.
- [ ] The feedback button sends a report.
- [ ] Anything named in the release's pull request under "What to look at" is tried.

Print and PDF are not available on the test environment (no Chromium there); they are checked on production after the deploy (`checklist.md`, section 3).

## Timing

Production is deployed after 18:00 or at the weekend, Tashkent time. **On a working Saturday** (one that runs a weekday's timetable) deploy after 18:00 only: the workflow allows the whole Saturday, but lessons run.
