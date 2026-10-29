# Sodiq platform: where we are and what you do, step by step

29 October 2026. For you, the owner. Plain words; the details are in the files named.

## 1. The picture in one minute

- **The platform** is built by a loop of Claude sessions:
  - a **start routine** begins the next task of `docs/build-plan.md` and writes a plan;
  - a **review routine** reviews the plan and later the code;
  - the builder builds;
  - the reviewer merges.
- **You are needed only** when a pull request gets the label `needs-owner`, for secrets, accounts, money, production, permissions, `packages/calc`, migrations that change existing rows, or the loop's own rules. You answer in your own words on that pull request.
- **Every merge** goes to the test site `https://app-test.sodiqschool.uz` by itself.
- **The live site** `https://app.sodiqschool.uz` gets a release only when you run **Deploy production**, in the evening.
- **Release 1** is the academic core: setup, people, classes, timetable (with automatic generation), journal, results, lesson plans.

## 2. Where we are today

**Done:**
- Phases 0 to 10, except two tasks.
- Production is live and you have your Super Admin account.
- The permission checklist is signed.

**Being built:**
- **10.2b**, an automatic check every 5 minutes that signing in and saving a mark still work, in a hidden "Monitoring" branch ([#261](https://github.com/sodiqschoolapp/sodiq-platform/pull/261)).

**Next, by itself:**
1. **10.1b, speed.** Today, at three times the school's size:
   - the Academic Vice Principal's home takes about a minute (the target is 1 second);
   - most reports take 4 to 10 seconds (the target is 2 seconds).

   10.1b makes them meet the targets.
2. **Then the deferred list**, in this order:
   - 5.10 timetable solver and 5.11 automatic generation;
   - 3.7 handbook;
   - 5.7c free-now board;
   - 8.3b live updates and 8.3c offline entry;
   - 9.5a to 9.5c, year end;
   - 9.6 role guides.

**Not done yet, and only you can do it:**
- the backups and alerts;
- the go-live checklist;
- the pilot checklist;
- entering the school's data.

These are steps B to E below.

**One release behind:** production runs the code of 28 October evening. 9.3b-2 (the five new reports) is merged but not deployed. Your next evening deploy brings it.

## 3. Step A: move the loop to the other account (today)

Do these in order. Don't skip step A5.

**A1. GitHub must stay `abbosc`.** In the other claude.ai account, connect GitHub (Settings, Connectors, GitHub, or `https://claude.ai/connect-github`) and sign in as **`abbosc`**, the same GitHub user as now. The loop only trusts comments by `abbosc`. With another GitHub user, every review the new routines post is ignored and the loop stops.

**A2. The Claude GitHub App** must have access to `sodiqschoolapp/sodiq-platform`. Check at `https://github.com/apps/claude/installations/select_target`.

**A3. Check the two cloud environments** (claude.ai/code, the cloud icon): `sodiq-platform`, and `sodiq-review` with `SODIQ_REVIEW_ONLY=1`. Their network list, variables and setup script are in `docs/cloud-loop.md` section 2. You said they exist; compare them once.

**A4. Check or create the two routines** at claude.ai/code/routines in the new account:
- **Review pull requests:**
  - environment `sodiq-review`, repository `sodiqschoolapp/sodiq-platform`;
  - schedule hourly at minute 8, the strongest Opus model;
  - the prompt from `handover/routine-prompts.md`.
- **Start the next task:**
  - environment `sodiq-platform`, same repository;
  - schedule hourly at minute 5, the strongest Opus model;
  - the prompt from `handover/routine-prompts.md`.
- **Triggers:** each needs an **API** trigger (Edit, Add another trigger, API). Remove any **GitHub** trigger if one is there.

**A5. Update the four GitHub secrets** (the screenshot you sent). GitHub, the repository, Settings, Secrets and variables, Actions, Repository secrets. For each routine, open its API trigger in the new account:
- the address goes into `REVIEW_ROUTINE_URL` (or `START_ROUTINE_URL`);
- click **Generate token** and paste it straight into `REVIEW_ROUTINE_TOKEN` (or `START_ROUTINE_TOKEN`).

Use the pencil icon to update each one. The token is shown once; don't put it anywhere else.

**A6. Turn off the two old routines in this account,** right after A5: "Review pull requests" and "Start the next task". Use the toggle, or delete them. Leave the two "Procurement" routines alone, because they belong to another project. If old and new both run, two reviewers meet and post conflicting verdicts.

**A7. Do it while #261 is quiet.** Its builder runs in this old account. Switch when #261 is waiting for a review, not in the middle of a build. After the switch, the new start routine takes #261 over by itself and posts "Resumed by the start routine.". That is normal.

**A8. Check it works.** After the next pull request event, open GitHub, Actions, **Routines**. The run should be green and print a session address. Open the address: it should be in the new account. Or press **Run now** on the new start routine.

**A9. Give the other account's Claude** `handover/HANDOVER.md` and `handover/routine-prompts.md`, and ask it to read them first.

## 4. Step B: make production safe before real marks go in (most urgent)

Today production has **no daily backup and no alerts**. The only backup is Neon's 7-day restore. Do `docs/monitoring.md`, in its order:

1. **Grafana Cloud:** create the stack and its token.
2. **Sentry:** the source maps and the issue emails.
3. **Render:** the production variables for Grafana and Sentry.
4. **Grafana:** import the alert rules, and set the contact point and your email.
5. **Cloudflare R2:** create the backup bucket `sodiq-backups`.
6. **GitHub:** the environment `backup` and its secrets.
7. **UptimeRobot:** the outside check of the site, `/api/health` and the certificate.
8. **The first restore drill** (`docs/restore.md`), noted in `docs/go-live/restore-drills.md`.

**When #261 (10.2b) is merged**, step 6 changes. You will:
- create a read-only login `sodiq_backup` and a **read replica** in Neon's console;
- point the backup at the replica.

The replica uses a little Neon compute, so a small cost. The new steps will be in `docs/monitoring.md`.

**After 10.2b**, you also run one command on the production server, once, to create the hidden Monitoring branch. Then you set up the Grafana sign-in-and-save check. Both will be in `docs/monitoring.md`.

Ask Claude to walk you through any step. Never paste a password or token into the chat.

## 5. Step C: quick checks on production (30 to 60 minutes, once)

`docs/go-live/checklist.md`, section 3:
- Print and PDF of a page with Uzbek letters (oʻ, gʻ) and Cyrillic come out readable.
- A photo is stored and shown.
- A live notice reaches a second signed-in browser.
- The feedback button sends a report.
- Sentry shows nothing strange in the first hour.
- Time how long the home page takes after a reload, and tell Claude.

Then tick what passed and write the date on "Approved by the owner on" in that file, or ask Claude to do it in a pull request.

## 6. Step D: evening releases to production

Whenever you want what's on `main` live:
1. Check that the newest CI run on `main` shows `deploy-test` green (Actions, CI).
2. After **18:00 Tashkent time**, or at the weekend: Actions, **Deploy production**, **Run workflow**, branch `main`, leave "Only build the image" unticked.
3. When the yellow **Review deployments** button shows, tick `production`, then **Approve and deploy**.
4. Wait for green, about 10 minutes, then sign in and look.

If it fails, give Claude the name of the failed step. To roll back, open Render, the service, Deploys, the previous deploy, **Rollback**, for both `sodiq-api` and `sodiq-worker`.

Once real people use it, walk `docs/go-live/release-checklist.md` on the test site before each release.

## 7. Step E: start the pilot

1. **Fill in `docs/go-live/pilot.md`:** which branch, which classes or groups, which subjects keep journals in the platform. Use names of classes only, never a person's name. Approve it with a date.
2. **Enter the branch on production**, in this order (`docs/go-live/checklist.md` section 4):
   1. the branch, rooms and departments;
   2. the academic year, its four quarters and the **go-live date** (a school day);
   3. slot types, the default day template and the calendar;
   4. subjects with their weights;
   5. staff with subjects, grades and availability, and their accounts and roles;
   6. classes with Tutors, all students of the branch, and groups;
   7. the teaching load of the **whole** branch;
   8. the timetable, built **by hand** on the board (automatic generation is not built yet), checked and published from the go-live date;
   9. open the plan window **before** the go-live date;
   10. each pilot teacher signs in once and changes their first password.
3. **The paper journal stays official.** Each week the Academic Vice Principal compares ten students' figures with paper. One full quarter of two or three journals is compared before any switch.

Expect days of data entry, mostly the school's staff.

## 8. Step F: when the loop asks you something

- **The phone notification** says `@abbosc`, or a pull request has the label `needs-owner`. Open it, read the question, and answer **in your own words** in a comment on that pull request. You can ask Claude to explain the question and suggest wording, but post it yourself: the builders refuse an answer relayed by Claude.
- **Then remove the `needs-owner` label** from that pull request (the gear next to Labels), or the loop waits.
- **Most mornings**, read issue #42 for the decisions the loop made without you, "Look first" items first, and reply `1 confirmed` or `2 change: …`.

## 9. Step G: what is left until Release 1 is 100%

| Task | What it is | What it needs from you |
| --- | --- | --- |
| 10.2b | Automatic sign-in-and-save check | The Neon login and replica, one command on the server, the Grafana check (`docs/monitoring.md`) |
| 10.1b | Every speed target met at three times the size | Probably one answer: may it change the Speed workflow file (`.github/workflows/speed.yml`) to fit its time? Say yes on its pull request when it asks |
| 5.10 | Timetable solver (a separate service) | Hosting it costs money (a new Render service): it will ask you |
| 5.11 | Automatic timetable generation in the app | Nothing expected |
| 3.7 | Handbook of what is built | Nothing expected |
| 5.7c | Free-now board | Nothing expected |
| 8.3b | Live updates of the journal | Nothing expected |
| 8.3c | Offline entry of marks | Nothing expected |
| 9.5a, 9.5b, 9.5c | Closing the year, rollover, a new year | Needed by June 2027 |
| 9.6 | Role guides; the handbook in Uzbek and Russian | Read the texts |

**Release 1 is 100% done when:**
- every task above is merged;
- the Speed run is green at three times the size, alone and with many users;
- backups, alerts and the monthly restore drill work;
- the go-live and pilot checklists are approved;
- one full quarter of pilot journals matches the paper journal;
- you have read the "Look first" decisions on #42.

## 10. Known problems to keep in mind

- **A browser test (`pages.spec.ts`) sometimes stalls**, about one run in three on busy days. A re-run fixes it, but it can block a merge or a deploy for 15 minutes. Ask Claude to fix it properly.
- **Some reviewer merges get refused** by its own safety check. You then merge by hand.
- **The security headers were never tried in real browsers** (you skipped the hand check). If something in the app stops working in one browser, look for a "Content Security Policy" message in that browser's console and tell Claude.
- **The speed problems affect the live site** as data grows over the year. 10.1b is the fix. The first weeks of the pilot are fine, because there is little data.

## 11. If something goes wrong

- **Nothing happens after a merge or a review:** GitHub, Actions, **Routines**. A red run with "401" means a routine token was regenerated, so update its secret (step A5).
- **A pull request waits more than an hour with no review:** open the review routine at claude.ai/code/routines and press **Run now**.
- **A task seems stuck:** the start routine resumes it within about an hour. If it doesn't, open the builder session and write "read the review on the pull request and proceed".
- **Anything else:** `docs/cloud-loop.md`, "When something goes wrong", or ask Claude with the pull request number.
