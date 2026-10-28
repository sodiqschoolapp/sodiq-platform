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

## Speed (task 10.1)

`12`, Speed targets: "These targets are tested automatically before each release."

- [ ] The newest **Speed** run (Actions → Speed; by hand or Sunday night) is green, on the release's commit or on an older one with no change since under `apps/api`, `apps/web`, `packages` or `db`. When it is red or too old, start it by hand (about 4 hours) and deploy after it; its report (the run's artifact `speed-report`) says which target was missed.
- [ ] On the test environment, on a phone on mobile data and on a laptop on the school Wi-Fi (or the browser's network throttling "Fast 4G" and "No throttling"), the home page, a journal and the timetable of a class each open in under 2 seconds on mobile data and under 1 second on Wi-Fi. The Speed run times the server's answer only, not the download and drawing (task 10.1, decision 3).
- [ ] On the oldest classroom computer of the school, in its browser (the current or the previous version of Chrome, Edge, Firefox or Safari), a journal opens and a cell saves.

Print and PDF are not available on the test environment (no Chromium there); they are checked on production after the deploy (`checklist.md`, section 3).

## Timing

Production is deployed after 18:00 or at the weekend, Tashkent time. **On a working Saturday** (one that runs a weekday's timetable) deploy after 18:00 only: the workflow allows the whole Saturday, but lessons run.
