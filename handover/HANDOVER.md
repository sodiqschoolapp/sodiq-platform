# Handover: Sodiq School platform

Written 29 October 2026, about 13:40 UTC. It is for the Claude Code session in the owner's other claude.ai account. You take over from a session that watched the loop, unblocked it, fixed CI and speed problems, and brought the owner's questions to them. Read this file, then `CLAUDE.md`, `docs/cloud-loop.md`, `docs/build-plan.md` (Phase 10 and the deferred list) and the top of `docs/progress.md` before you act.

The owner is GitHub `abbosc`. They follow along from the Claude app and often answer in short messages.

## 1. How the owner wants answers

- Never use em dashes. Never flatter, never sugarcoat, be honest. Be short when it matters little and detailed when it matters.
- Give a recommendation, not a survey. When a choice is theirs, name your pick first and say why.
- Give them paste-ready text when they must write something themselves (a PR comment, an answer to the loop).
- Steps they do by hand go in numbered lists with the exact names of buttons and fields.

## 2. The project in one paragraph

A school management web platform for Sodiq School in Uzbekistan: three branches, about 200 staff, 2,000 students. Release 1 is the academic core: setup, people, classes and subjects, the timetable (with automatic generation), the journal, results, lesson plans. TypeScript everywhere (React and Vite, NestJS, PostgreSQL with Kysely, pg-boss), a Kotlin solver service still to be built. The spec in `docs/spec/` is the source of truth and is read only. One developer, the owner, runs it. The code is built by an autonomous loop of Claude sessions (section 4).

## 3. Where it stands

### Code

- `main` is at `956edc0` (merge of #262).
- Every task of Phases 0 to 10 is ticked except two:
  - **10.2b** (the sign-in-and-save check in a hidden Monitoring branch) is being built in [#261](https://github.com/sodiqschoolapp/sodiq-platform/pull/261). The plan was approved at 10:45 UTC on 29 October, after the owner answered its two questions in their own words:
    - only the Super Admin sees the Monitoring branch, and the Senior Head Teacher is refused;
    - the daily export reads through a new read-only `sodiq_backup` login on a Neon read replica.

    The builder posted progress at 11:02 UTC. The builder session lives in the **old** account.
  - **10.1b** (every speed target of `12` at three times the size) was added by #262 on 29 October. It runs right after 10.2b.
- After those comes the deferred list, in this order: 5.10 Solver service, 5.11 Generation in the product, 3.7 Handbook, 5.7c Free now board, 8.3b Live updates, 8.3c Offline entry, 9.5a Closing the year, 9.5b Rollover, 9.5c Starting a year, 9.6 Role guides. The Phase 10 owner gate was lifted on 26 October, so the start routine goes straight on into that list.

### Environments

- **Test**: `https://app-test.sodiqschool.uz` on Render. Every merge to `main` deploys it by itself (the `deploy-test` job of `ci.yml`).
- **Production**: `https://app.sodiqschool.uz` on Render in Frankfurt (Docker, two API servers and a worker) with Neon (Launch plan, 7 days of restore).
  - It was deployed by the workflow **Deploy production**, [run 40750242754](https://github.com/sodiqschoolapp/sodiq-platform/actions/runs/40750242754), at `8448e27`, green at 20:42 UTC on 28 October.
  - `main` has moved since, with 9.3b-2 (#260, migration 0141) and #262 (documents only), so production is one release behind.
  - The owner starts a production deploy by hand, after 18:00 or at the weekend, Tashkent time (UTC+5). It needs `deploy-test` green on the head of `main`, and the owner approves it in the `production` environment (required reviewer `abbosc`, branch `main` only).
- **The first Super Admin** of production exists (the owner signed in as `s.admin`).
- **The GitHub environment `production`** holds:
  - the secrets `DATABASE_MIGRATION_URL` and `RENDER_API_KEY`;
  - the variables `RENDER_API_SERVICE_ID` (`srv-dbg66nfb9u1s73ccttog`), `RENDER_WORKER_SERVICE_ID` (`srv-dbg66nfb9u1s73ccttkg`) and `PRODUCTION_URL`.

  The bypass box "Allow administrators to bypass" was recommended off; the owner may not have changed it yet.

### Checklists

- **The permission and security checklist** is signed (issue #42, [comment 6494166619](https://github.com/sodiqschoolapp/sodiq-platform/issues/42#issuecomment-6494166619); recorded by #262).
  - The two hand checks were not done by the owner.
  - The security headers were confirmed from the code and its tests only. Real browsers were not checked.
  - Encryption at rest was confirmed from Neon's and R2's documentation.
- **The go-live checklist** (`docs/go-live/checklist.md`) and **the pilot checklist** (`docs/go-live/pilot.md`) are not approved yet.
- **Monitoring (`docs/monitoring.md` steps 1 to 8) is not set up.** So there is no daily export yet and no alerts. Production's only backup is Neon's 7-day restore. Treat this as the most urgent owner step before real marks go in.

### Speed

The third Speed run ([run 40741961067](https://github.com/sodiqschoolapp/sodiq-platform/actions/runs/40741961067), `SPEED_SIZE=triple`, after 9.3b-1's prepared totals) timed:

| What | Target | Measured |
| --- | --- | --- |
| Academic Vice Principal's home (9 reads, `/api/results/closing` the likely cost) | 1 s | 57 to 60 s |
| Head Tutor's home | 1 s | 5.3 to 5.7 s |
| Results page | 1 s | 2.0 s |
| Counts per teacher, quarter 4 | 2 s | 10.2 s |
| Attendance today | 2 s | 5.7 s |
| Early-warning list | 2 s | 4.3 to 6.6 s |
| Rating of the classes, of a class | 2 s | 3.5 to 5.8 s |
| Branch summary | 2 s | 3.9 to 5.9 s |
| Personal-data report | 2 s | 4.0 s |
| Saved move on the board | 1 s | 1.3 to 1.4 s |

- The data build took about 3 hours, and the test hit its own 5-hour limit in branch 3. So the search, the saves and the load of 1,000 users were never measured, and no report artifact was written.
- All of this is 10.1b's work. Its owner line lets `speed.yml` change "for the run's time only", but the reviewer noted that line is not the owner's own words. 10.1b will stop with `owner decision needed` if it touches `.github/`, unless the owner writes the permission themselves.
- At the real size (a third of the triple run), expect the Academic Vice Principal's home at roughly 15 to 20 s by the end of a year if nothing is done. That is an estimate, not measured.

## 4. The loop, and what changes when it moves to your account

### How it works

`docs/cloud-loop.md` is the full description.
- **The start routine** ("Start the next task") runs `/next-task` on the first unticked task: a `task/<id>-<name>` branch, a draft PR with the plan, then a wait for the plan review. It also resumes stalled tasks.
- **The review routine** ("Review pull requests") runs `.claude/skills/review-pr`. It posts `[review] approved`, `changes needed`, `owner decision needed` or `ready to merge`, each with the sha it read, and it merges `task/` PRs at `ready to merge` when `checks` and `e2e` are green.
- **The bridge** `.github/workflows/routines.yml` fires both routines through their API triggers, using four repository secrets: `REVIEW_ROUTINE_URL`, `REVIEW_ROUTINE_TOKEN`, `START_ROUTINE_URL`, `START_ROUTINE_TOKEN`. It fires on PR events, merges of `task/` PRs, and `[review] approved` or `changes needed` comments.
- **Both routines also run hourly**, as a second net.

### The one thing that must not change: the GitHub account `abbosc`

Every session, routine and the bridge must act on GitHub as **`abbosc`**. This is hard-coded in:
- `.github/workflows/routines.yml`: `wake-builder` fires only for a comment whose author is `abbosc`, and the `review` job reads the newest `[review]` by `abbosc`;
- `.claude/skills/review-pr/SKILL.md`, `finish-task/SKILL.md` and `next-task/SKILL.md`;
- both routine prompts;
- `docs/cloud-loop.md`.

The repository is public, and this check is its defence against forged verdicts. So the new claude.ai account must connect GitHub as the user `abbosc` (claude.ai Settings, Connectors, GitHub, or `https://claude.ai/connect-github`). If it connects another GitHub user, every `[review]` the new routines post is ignored and the loop stalls. Changing the hard-coded name is a change to the loop's own rules (stop-list item 2): a PR the owner merges by hand.

### Moving the loop: the owner's steps, which you guide

1. **GitHub as `abbosc`** in the new account, and the Claude GitHub App with access to `sodiqschoolapp/sodiq-platform` (`https://github.com/apps/claude/installations/select_target`).
2. **Two cloud environments**, as `docs/cloud-loop.md` section 2 says. The owner says they already exist; check them:
   - `sodiq-platform`:
     - network: Custom, the default package-manager list, plus `apt.postgresql.org`, `www.postgresql.org` and `nodejs.org`;
     - variables `TURBO_TELEMETRY_DISABLED=1` and the `PATH` with `/opt/node24/bin` first;
     - setup script: the whole of `scripts/cloud-setup.sh`.
   - `sodiq-review`: the same, plus `SODIQ_REVIEW_ONLY=1`.
3. **Two routines**, matching the ones live in the old account. The live prompts are newer than the copies in `docs/cloud-loop.md` and are given word for word in `handover/routine-prompts.md`.

   | Routine | Environment | Schedule (UTC) | Model | Repository |
   | --- | --- | --- | --- | --- |
   | Review pull requests | `sodiq-review` | `8 * * * *` | the strongest Opus | `sodiqschoolapp/sodiq-platform` |
   | Start the next task | `sodiq-platform` | `5 * * * *` | the strongest Opus | `sodiqschoolapp/sodiq-platform` |

   Each needs an **API trigger** and no GitHub trigger: the owner removed those on 11 October because they double-reviewed.
4. **The four repository secrets.** In the new routine: Edit, Add another trigger, API. The address goes into `…_URL`; **Generate token** shows the token once, and it goes straight into `…_TOKEN`. The secrets are at GitHub Settings, Secrets and variables, Actions, Repository secrets. The owner types the values; you never see or handle them.
5. **Turn off the old account's two routines right after**. In the old account they are:
   - "Review pull requests", `trig_01TAaSDzVny6XxvhG8J5PJZL`;
   - "Start the next task", `trig_012M8ydWscdYZN8zcKzYS9E4`.

   Old and new must never both run hourly, or two reviewers meet on one head and post conflicting verdicts (it happened on #140). The old account also has two "Procurement" routines for another repository; they are not this project's, so leave them alone.
6. **Prove it.** After the next PR event, open Actions, **Routines**: the run is green and prints a session address of the new account. Or press **Run now** on the new start routine and read what it says.

### The task in flight when you start

- **#261's builder session belongs to the old account.** Once the secrets point at the new routines, a `[review]` on #261 fires the new start routine. It cannot wake the old session, so after 5 minutes it resumes #261 itself and posts "Resumed by the start routine.". That is expected.
- **The old builder may also still be working.** If both act on #261, they can push over each other. Ask the owner to switch the secrets when #261 is idle, waiting for a review, or to stop the old session from its page (claude.ai/code).

## 5. Rules that bind you, beyond `CLAUDE.md`

- **Never handle a secret's value.** No secret goes into a file, a PR, a chat or a session, and the owner types every secret into the provider or GitHub themselves.
- **Never connect to the production database.** Never read production logs or data. Production is reached only by the deploy job the owner starts.
- **The owner's decisions count only in their own words.** The builders refuse an approval that a Claude-authored comment relays. When the owner explicitly asks you to post for them, quote their words verbatim and say plainly that it is relayed, as #42 comment 6494166619 does. Never write an approval they did not give.
- **Since the pilot of 28 October, five things stop a task for the owner:**
  1. secrets, provider accounts, money and production;
  2. changes to the loop's own rules (`.claude/`, `CLAUDE.md`, `.github/`, `scripts/hooks/`, `docs/cloud-loop.md`);
  3. a migration that changes or removes existing rows;
  4. any change to `packages/calc`;
  5. any change to permissions.

  The owner pre-approved items 1 and 2 for 10.2 and 10.4 only, as the build plan's From lines say. Help the owner answer those questions; never answer them yourself.
- **Merges:**
  - The reviewer merges only `task/` branches.
  - Any PR you open (a `claude/` branch) is merged by the owner.
  - Force push is refused by the permission classifier; use fast-forward pushes and merge commits.
  - Create a PR only when the owner asks.
- **Commits:** the task id first, imperative (`10.1 Fix …`), ending with the attribution lines your system gives you. No model name in commits or PRs. Comments end with the Claude Code footer.
- **No real personal data anywhere.** Invented names only.

## 6. Mechanics that saved time

- **GitHub** is reached through the GitHub MCP tools; the `gh` CLI is not available.
- **Job logs:**
  - `mcp__github__get_job_logs` with `return_content: true` returns at most the last 5,000 lines.
  - The end of every CI log is a PostgreSQL container dump, so the Vitest or Playwright output of a long job is often out of reach.
  - Use a subagent to read a log, so it does not fill your context.
  - The log URLs and artifact downloads (`*.blob.core.windows.net`) are blocked by the session's proxy, and so is `app-test.sodiqschool.uz`.
- **The Speed workflow** (`speed.yml`) runs only from `main`, by `workflow_dispatch` or on Sundays at 17:00 UTC, with a 340-minute limit. A triple run currently takes 5 hours and fails at the test's own limit.
- **A failed CI job** can be re-run with `mcp__github__actions_run_trigger` (`rerun_failed_jobs`). Re-run only once to confirm a failure that isn't the PR's own, and say so in a comment.
- **For waiting**, use `send_later` check-ins rather than polling, and subscribe to your own PRs.
- **Local checks:**
  - after a pull, run `pnpm --filter @sodiq/shared build` before API tests that read the permission table, or the checklist test compares against a stale build;
  - the database runs locally (the session start hook migrates it);
  - `pnpm test:changed` is the usual local test run.

## 7. Open threads, most important first

1. **No backups and no alerts on production yet.** The owner must do `docs/monitoring.md` steps 1 to 8. After #261 merges, the backup steps change: the owner creates `sodiq_backup` and a Neon read replica, which costs a little compute.
2. **The speed misses (10.1b).** Real users will feel the Academic Vice Principal's home within weeks.
3. **`e2e/pages.spec.ts:204` stalls at random.** It waits 5 s for a page heading after `page.goto` ("Students", "Classes") about 2.5 minutes into the walk. It failed three times on 28 October (#255, #260, `main` after #259), and each time it blocked a merge or a deploy until a re-run. The cause is not found; the trace is in the `playwright-traces-2` artifact of the failing run, which this session could not download. It is worth a proper fix as its own small PR, which the owner merges.
4. **One unexplained `tests (api 1/3)` failure** on `main` at `ac8d316` (28 October), which passed on the next commit. The Vitest output was beyond the 5,000-line tail.
5. **The reviewer's merges** were sometimes refused by its own permission classifier ("Merge Without Review"), and the owner then merged by hand. The routine prompt now carries the owner's standing authorization (26 October).
6. **The go-live and pilot checklists** await the owner's approval. The pilot data entry (`docs/go-live/checklist.md` section 4) is the school's work and gates the real pilot.
7. **A cosmetic line:** `docs/build-plan.md`, 10.3b, still says "checklist signed: pending". The reviewer of #262 said a later docs change can drop it.
8. **5.10, the solver**, needs a new hosted service (a Kotlin service on Render), which costs money, so it will stop for the owner (stop-list item 1).

## 8. Files to know

- `CLAUDE.md`: the rules.
- `docs/cloud-loop.md`: the loop and its setup.
- `.claude/skills/*`: next-task, finish-task, review-pr, spec-change.
- `docs/build-plan.md`: the tasks, in order, with From lines.
- `docs/progress.md`: the newest first, with "The next sessions must know".
- `docs/decisions.md`: the standing decisions, and "Decided ahead for Phase 10".
- `docs/deploy.md`: the test and production deploys, and the one-time setup.
- `docs/monitoring.md`, `docs/restore.md`: alerts, the daily export, the restore drill.
- `docs/go-live/checklist.md`, `pilot.md`, `release-checklist.md`.
- `docs/security/permission-checklist.md`.
- Issue #42: the decisions made without the owner, with "Look first" items first. The owner confirms them there.
