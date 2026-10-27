# Go-live checklist

What is done, by whom and in which order, to bring production up at `https://app.sodiqschool.uz` and open it to the school (task 10.4, `docs/build-plan.md`). The owner approves this checklist and ticks it; the pilot that follows has its own, `pilot.md`. How the production deploy works and how each provider is set up is in `docs/deploy.md`, Production.

Nothing here asks for a secret in a chat or a file. No real name goes into the repository: the people and groups of the school are entered in the app, never here.

Approved by the owner on: ____________________ (pending)

## 1. Before the first deploy

- [ ] **The permission and security checklist is signed** (`docs/security/permission-checklist.md`, the line "Signed by the owner on"; task 10.3a, decision 4). Production is not started without it.
- [ ] **Security headers by hand on the test environment** (task 10.3a): in the current Chrome, Edge, Firefox and Safari, at `https://app-test.sodiqschool.uz`, with the browser's console open: sign in, open a journal grid and type a mark, drag a lesson on the timetable board, receive a live notice, and use Print. Nothing is blocked and the console shows no "Content Security Policy" refusal. Note the browser versions here: ____________________
- [ ] **Encryption at rest confirmed** (`13`, Security: "Personal data is encrypted in transit and at rest"): Neon (its security page: storage encrypted at rest) and Cloudflare R2 (objects encrypted at rest). Note where it was read: ____________________
- [ ] **The keys kept**: the two production database passwords and the production `SECOND_STEP_KEY` are in the password manager, apart from the test ones.
- [ ] **The environment `production` protected** in GitHub: the owner as required reviewer, `main` only (`docs/deploy.md`, Production, step 6).
- [ ] **The image proved**: Deploy production with "Only build the image" is green on the commit to deploy.

## 2. The first deploy (after 18:00 or at the weekend, Tashkent time)

- [ ] Deploy production is green: window, release check, migrations, deploy, smoke test.
- [ ] `https://app.sodiqschool.uz` shows the sign-in page, with a valid certificate.

## 3. Right after the deploy

- [ ] **The first Super Admin** created on the server (`docs/deploy.md`, Production, step 9), signed in, password changed, second step set up. At most 3 Super Admins (answer 17); the others are given the role in the app.
- [ ] **Print and PDF**: a Print and a PDF of a page with Uzbek Latin (oʻ, gʻ) and Cyrillic text come out readable.
- [ ] **A photo** stored and shown (the R2 bucket `sodiq-files` answers).
- [ ] **A live notice** reaches a second signed-in browser.
- [ ] **No permanent developer account** in the live system (`docs/security/permission-checklist.md`): the Super Admins are people of the school; anybody else, a developer included, gets an ordinary account with a role, audited, ended when the work is done.
- [ ] **The feedback button** sends a report.
- [ ] **Email is off** (answer 16): the administrators know that they reset a password from the account in the app; the link "Forgot your password?" writes to the log only.
- [ ] **Sentry** `sodiq-production` receives nothing unexpected in the first hour.

## 4. The branch, before the first lesson in the platform

For each branch that starts (`edge/academic-year`: setup in a fixed order; the platform switches off an action whose step before it is missing):

- [ ] Branch and its working weekdays, time zone Asia/Tashkent.
- [ ] Rooms; departments.
- [ ] The academic year and its **four dated quarters**.
- [ ] **The go-live date** of the branch: a school day (Setup, the branch, Go-live; `PUT /api/setup/branch/go-live`). No dated lessons exist before it and the first timetable version starts on it.
- [ ] What the go-live date means, read once by the Academic Vice Principal (`edge/academic-year`, the row "The school goes live in the middle of the year"):
  - quarters that ended before it are "not in the system", and the year result says "based on n of 4 quarters";
  - the quarter that contains it counts its lessons from that date; its result is labelled "from" with the date, on screen, in prints and in exports;
  - when the start quarter closes, the Academic Vice Principal chooses for the whole branch: keep the platform results as the quarter results, or mark the quarter "not official" (then its official results are produced the old way);
  - the first lesson of each journal after the go-live date has no homework column;
  - the plan window is opened **before** the go-live date, and a plan in the start quarter begins at a lesson number the teacher types (1 by default).
- [ ] Slot types, the default day template; the calendar (days off, special days).
- [ ] Subjects, with the journal type and the daily and quarterly weights of every graded subject for each quarter the timetable touches (publishing is refused otherwise).
- [ ] Staff with their subjects, grades and availability; their accounts and roles.
- [ ] Classes with their Tutors, students, groups.
- [ ] The teaching load of the **whole branch**, then the timetable, built by hand on the board and published from the go-live date. Automatic generation is not available yet (the solver service, tasks 5.10 and 5.11, is not built).

Then the pilot: `pilot.md`.

## 5. Every release after go-live

- [ ] Tried on the test environment first and walked by the Academic Vice Principal's team (`release-checklist.md`).
- [ ] Deployed by Deploy production, after 18:00 or at the weekend; on a working Saturday after 18:00 only.
