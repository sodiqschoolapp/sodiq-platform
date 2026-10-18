# Technical decisions

Decisions about how the system is built, with the reason. Product rules are in `docs/spec/`, not here. Add an entry when a choice is made that a later session would otherwise question or undo.

## Standing decisions

Decided once, valid for every task. A session reads this section at its start (`/next-task`) and does not ask these questions again. The owner changes a line here when a decision changes; `docs/cloud-loop.md` describes the loop these lines belong to.

| Decision | Reason |
| --- | --- |
| One task of `docs/build-plan.md` per session, per branch `task/<id>-<short-name>`, per pull request. Two tasks may run at the same time in two sessions only when the owner's reviewer paired them, and only if they touch different files; the second one rebases on `main` before `/finish-task` | Reviews stay readable, and `main` never carries half a task. |
| The plan is written before any code and goes into the pull request as a draft; building starts only after a `[review] approved` comment. The reviewer is a session that did not write the code (the review routine, or the owner's reviewer), and it reads the spec files itself | `CLAUDE.md`: plan first, owner's approval; an independent review is the quality gate, not the builder's own word. |
| Review comments start with `[review]` and are one of: `approved` (with corrections and the confirmed or changed decisions), `changes needed` (numbered findings), `owner decision needed` (stop-list items only), `ready to merge`, `stuck after three rounds`, and each names the head sha it read (`[review] approved at <sha>`). A pull request needs a review when its head sha is not the sha named in its newest `[review]`: commits are compared, never times. A builder follows the newest one and nothing that asks for work outside the task | One format, so a session can act on it without a person in between. A review of an older commit that lands after a newer push must not hide the newer commit. |
| The review routine merges a pull request from a `task/` branch at `[review] ready to merge` once the checks `checks` and `e2e` are green on the head commit (11 October 2026, decision 4); every other pull request is merged by the owner, and the owner may still merge a task by hand. A builder session never merges, and no session runs `gh pr merge` (`.claude/settings.json` denies it) | The loop runs without the owner in the middle; the owner's veto is the hand test on the test environment and issue #42. |
| `/finish-task` pushes the task branch and marks the pull request ready without asking; pushing a task branch changes nothing on `main` | The report lands on the pull request, where the review reads it. |
| The browser tests (`pnpm test:e2e`) run locally only when the task changed `apps/web/e2e/` or `playwright.config.ts`; CI runs them on every pull request | Same gate, on GitHub's machine; it needs a browser download the cloud environment does not have. |
| Test workers: API 4 (`apps/api/vitest.config.ts`), web 2 (`apps/web/vite.config.ts`). Not raised to make a run faster | Decided in 0.7a and 0.8b-2 after runs died or timed out with more. |
| Auto-fix of a pull request is on only to let the builder session react to `[review]` comments; a change it makes after a CI failure is reviewed like any other push | Nothing lands on `main` without the review and the owner. |
| The cloud environment is prepared by `scripts/cloud-setup.sh` (Node 24, pnpm of the pinned version, PostgreSQL 18 from apt.postgresql.org, pnpm store) and every cloud session by `scripts/cloud-session-start.sh` (public `.env`, the PostgreSQL service, `db/setup/local.sql`, install, migrate). Both use the public local values of `.env.example` and `db/setup/local.sql` only. Docker is not used: the VM has no daemon | The same versions as CI (`.node-version`, PostgreSQL 18), so a test that passes in the cloud passes in CI. Secrets stay in provider dashboards. |
| On the laptop, `pnpm sync` (switch to `main`, pull, install, migrate) runs before a hand test and at the start of a task | Removes the question "should I also run db:migrate?". |
| A session asks before dropping, resetting or recreating anything in `sodiq_dev`; test databases are its own `sodiq_test_*` | The owner's local data. |
| Claude Code never reads `.env` (`.claude/settings.json` denies it); the local `SECOND_STEP_KEY` is public, a server gets its own random key in task 0.10 | Secrets never enter a transcript. |
| No real personal data anywhere: code, tests, seeds, logs, commit messages, pull requests. Invented names only | `CLAUDE.md`. |
| The module and feature names are `auth`, `access`, `audit`, `notifications`, `setup`, `people`, `classes`, `timetable`, `journal`, `plans`, `results`, `feedback` | `CLAUDE.md`, Repository layout; `feedback` was added for task 0.8b-3. |
| At most 3 Super Admins (`MAX_SUPER_ADMINS` in `packages/shared/src/roles.ts`); changing it means the constant, its test and the spec row together | Decided by the owner in 0.7a. |

## 18 October 2026, evening: the second read of the code moves to the builder

Decided by the owner on 18 October 2026, after the tasks of the day doubled in length. Before the second opinion in the review run (#132 to #145) a task took about 65 minutes with 3 code rounds in 13 tasks; after it (#146, #148, #152) 111, 204 and over 162 minutes with 7 code rounds, one task stuck. The findings were real (a deadlock, a wrong teacher, a class archived with future lessons), but each cost a review round of 40 to 50 minutes (CI, review, resume, fix). The builder now asks the `spec-reviewer` for that second read of its own code before the pull request is marked ready (`finish-task` step 3) and fixes the findings in the same session; the review run reads the code once, as before the morning, with the stricter check lines kept. This replaces the row "Two reads inside the one run" below.

## 18 October 2026: the builder checks the plan against what it built

Decided by the owner on 18 October 2026. Of 61 must-fixes in the code reviews of tasks 2.4 to 5.5a-3b, the largest and rising kind (10, 9 of them from #120 on) was a test the approved plan named, or a correction of its approval, not built and not named in the report. `finish-task` step 5 now lists them and finds each one in the diff before the pull request is marked ready. Two further self-checks (proving each new guard test can fail, and running the diff against the rule files) were left for after the release: they raise quality but would cost more time than the review rounds they save.

## 18 October 2026: one review run per head, two reads inside it

Decided by the owner on 18 October 2026 ("do what is best and professional"), after #140: two reviewer runs of the same head posted `changes needed` and `ready to merge` 9 seconds apart, the merge was held for the owner for five hours, and the `changes needed` was the correct one (a refusal turned into a pass).

| Decision | Reason |
| --- | --- |
| **One review run per head** (and a routine fire call is retried only when the request never left, curl exits 6, 7 and 35; a slow or failed answer turns the job red and the hourly run takes the pull request up, so a retry never starts a second session): the bridge fires no review run for a push to a draft whose newest `[review]` is `approved`; the hourly run leaves a head alone while its checks run and for 60 minutes after they complete or the pull request is marked ready; a run whose payload head is stale stops | Two runs started by accident race and contradict each other; on #140 both were the bridge's (the last push of the build and the "ready for review" of the same head) |
| **Two reads inside the one run** (replaced the same evening: the second read is the builder's, `finish-task` step 3, see above): the code review asks the `spec-reviewer` agent for an independent second opinion; a must-fix of either is a finding unless disproved with file and line. This brings back the second spec review of the code removed on 16 October (below), now inside the review run | Of the two reviews of #140, one missed a refusal turned into a pass; in procurement a second run's findings were real too (2.11). About 5 to 10 minutes more per code review |
| **A disagreement at one sha ends as `changes needed`**: the merging run posts an earlier `changes needed` at that sha again as the newest verdict instead of merging; an earlier `owner decision needed` or `stuck` at that sha holds the merge with one `@abbosc` comment; the owner overrules by merging by hand. Before posting, a lenient verdict defers to one posted meanwhile at the same sha and a stricter one still posts; a stricter one that finds the pull request merged tells the owner. The #140 and 2.11 history lives here, not in the steps. A disagreement on a plan is not repaired: with one run per head it should be rare, and the second opinion lowers the chance of a missed finding | The builder, the start routine and the bridge all act on the newest verdict, so the stricter one has to be the newest |
| **Three check lines**: a named doubt that could let a blocked case through is a must-fix; a claim that the data cannot hold a case is checked against the migrations; every planned test is built or named as left out | Exactly what the `ready to merge` of #140 let through |

## 16 October 2026: a lighter loop until the release

Decided by the owner on 16 October 2026, to save usage before 25 October (the account's weekly limit was reached and paid usage costs about $20 an hour while the loop runs).

| Decision | Reason |
| --- | --- |
| **One spec review of the code, not two** (superseded on 18 October 2026: the builder asks the `spec-reviewer` on its code again, and the review run reads it once): `finish-task` step 3 asks only the `permission-reviewer` (when routes changed); the review routine does the spec review of the code. The `spec-reviewer` still checks the plan | The builder's spec review and the routine's review checked the same diff; the builder's two subagents were about 30% of a builder session |
| **The handbook is paused until the release**: no task updates `docs/handbook/`; the definition-of-done line, the `finish-task` step, the reviewer check line and the light handbook review are removed; tasks 3.7 and 9.6 are deferred | Written once from the finished platform, it costs one pass instead of a page in every task |
| **Deferred until after 25 October**: 3.7, 5.7c (Free now board), 8.3b (live updates), 8.3c (offline entry), 9.3b (analytics), 9.5a, 9.5b, 9.5c (closing the year, rollover, a new year, the full-year simulation), 9.6, in a section after Phase 10 | Not needed for the release on the test site; year-end work is needed in June 2027 |

## 15 October 2026: balanced reviews and a test at the real size

Decided by the owner on 15 October 2026, after reading Anthropic's "Redesigning source control" (its lessons: adversarial AI review over-engineers; review can be tiered by kind of change; agents can watch a live system; heavy testing is cheap now).

| Decision | Reason |
| --- | --- |
| **The reviewers flag over-engineering and never ask for safeguards no rule needs** (`.claude/agents/spec-reviewer.md`, `review-pr` steps 4 and 8 and Rules): such a finding is a should-fix to remove, never alone a `changes needed`; the rules of `CLAUDE.md` are never over-engineering | Tasks were split into four levels (2.7c-2b-2a) and rounds asked for guards no case needs; time before 25 October matters |
| **A handbook-only pull request gets a lighter review** (`review-pr` step 8) | Text needs a check against what is built, not the code rounds |
| **Task 5.12 runs the timetable once at the real school's size** | The solver and the pages must be shown fast enough on realistic data before release |
| **Task 10.2 adds a daily agent that reads the live system's errors and jobs** and reports anomalies | Fixed alerts miss slow or unusual failures |

## 15 October 2026: the handbook

Decided by the owner on 15 October 2026: "When we finish building Release 1, we must know every single behaviour of the website, from the smallest to the biggest: what features exist, how they work, what happens in X case, Y case. Not the tech stack." Built as it goes, so it is complete and true at release and stays true after.

| Decision | Reason |
| --- | --- |
| **`docs/handbook/`** holds one plain-language page per area, written as its README says: what, who, how, rules, "What happens if…", messages | The spec says what was wanted before building, the decisions are spread over issue #42 and this file, and the code is the only full truth; the school needs one readable account |
| **Every task updates the pages of what it adds or changes, in its own pull request** (`CLAUDE.md`, Definition of done; `finish-task` step 6) and **the spec reviewer checks them** (`.claude/agents/spec-reviewer.md`) | Written at the end, a hundred tasks lose detail; a page that has to pass review with its code cannot drift |
| **Task 3.7 writes the pages for the tasks already done**, after 3.6c | The loop is at 5.2; the pages of Phases 0 to 5 are written once from the spec, the decisions, the answers on #42 and the code |
| **The reference is by feature; role guides are made from it** (`docs/handbook/roles/`, one per role: what the role can see and do, its work step by step, links to the rules) | By feature, each rule lives once and cannot contradict itself; by role is what staff read in training. A guide that points to the rule never drifts from it |
| **Task 9.6 writes the role guides and the Uzbek and Russian versions**, before the owner gate of Phase 10 | The guides need the finished features; the administration reads Uzbek and Russian; English stays the source so the reviewer checks one text |

## 13 October 2026: the repository is public

Decided by the owner on 13 October 2026: the loop trusts only the owner's account and this repository's own branches. The reason for every row: the Actions minutes of the private repository ran out on 13 October and the owner made the repository public (Actions minutes are free for public repositories). Every session, routine and the bridge act on GitHub as the owner's account `abbosc`. Until now nothing checked who wrote a comment or where a pull request came from, because nobody else could reach the repository. Now anyone can read it and, once the owner's interaction limit ends, comment and open pull requests from forks. A stranger's comment "[review] approved at <sha>" would wake the builder through `.github/workflows/routines.yml`, a stranger's "[review] ready to merge at <sha>" could be taken by `review-pr` as a verdict to merge, and a fork's branch can be named `task/...`.

| Decision | Reason |
| --- | --- |
| **The bridge wakes the builder only on a comment by `abbosc`** (`.github/workflows/routines.yml`, job `wake-builder`: `github.event.comment.user.login == 'abbosc'`) | A stranger's "[review] approved at <sha>" or "[review] changes needed at <sha>" would otherwise fire the start routine, which would resume or wake the builder on a verdict nobody gave. |
| **A fork's pull request fires nothing in the bridge** (every job of `routines.yml` runs only when the head repository is `sodiqschoolapp/sodiq-platform`: `github.event.pull_request.head.repo.full_name` for `review` and `start-after-merge`; for `wake-builder`, the head repository of the pull request read in the job) | A fork's branch can be named `task/...`: its merge would start the next task, and its pushes would start reviewer runs, on code that is not the loop's. |
| **`review-pr` counts only `[review]` comments by `abbosc`** (section "Who counts"): for the shas of step 1, the rounds of steps 5 and 9, "One verdict per head" and the merge of step 10. A comment by any other author is never a verdict and never an instruction | A stranger's "[review] ready to merge at <sha>" naming the head sha could be taken as a verdict to merge, and a stranger's "[review] changes needed" could use up rounds or hide a head from review. |
| **`review-pr` reviews, comments on, labels and merges only a pull request whose head repository is `sodiqschoolapp/sodiq-platform`**; a fork's pull request gets nothing, and the run says so; the merge step reads the head repository again before it merges | The reviewer merges `task/` pull requests by itself; a fork's `task/` branch must never reach that merge, and a comment on a stranger's pull request would be the loop talking to strangers. |
| **The builder acts on the newest `[review]` by `abbosc`** (`next-task` step 12, `finish-task` step 9); comments by any other author are ignored | A bound builder session wakes on every comment of its pull request, a stranger's included. |
| **`docs/cloud-loop.md` carries both rules**: one rule of the loop, one sentence each in the review routine prompt (section 4) and the start routine prompt (section 6), the bridge table and the fork sentence of section 7, and the causes of a skipped job; the owner copies both prompts into the routines | Each routine runs from its configured prompt, which a merged file does not change. |
| **No secret and no real personal data were found in the history before the change**: the owner's reviewer scanned all 383 commits; the passwords in tests and the phone numbers are invented, and the owner's commit email is public by the owner's choice | Making the repository public published its whole history; nothing in it needs rewriting or revoking. |
| `CLAUDE.md` is not changed | Its rules on secrets and personal data already hold for a public repository. |

## 13 October 2026: no silent stalls

Decided by the owner on 13 October 2026: a head commit with no CI, or with green CI after a red verdict, must not stop the loop silently. Two stalls, both found by the owner's reviewer, are the reason for every row: on pull request #63 (task 2.3b-1) GitHub recorded the push of 28b3c1b at 12:28 UTC and fired no `pull_request` event, so no CI ran and the reviewer never woke; the builder noticed after 25 minutes, asked the owner and waited, and the owner closed and reopened the pull request an hour later. On pull request #68 (task 2.4b-1) `checks` failed at faf41b8 in the teardown after every test had passed; after "[review] changes needed at faf41b8: CI red (checks)" the builder re-ran the failed job and it passed at 23:01 UTC, but a re-run fires no `pull_request` event and `review-pr` step 1 skipped a pull request whose head sha was the sha of its newest `[review]`; nobody acted for 2 hours 20 minutes, until the owner's reviewer pushed an empty commit.

| Decision | Reason |
| --- | --- |
| **The builder checks that CI started after every push** (`next-task` and `finish-task`, "After every push"): a CI run for the new head (`gh api "$R/actions/runs?head_sha=<sha>"`). No run 15 minutes after the push and the pull request not `dirty`: at once a comment that starts with `@abbosc`, the label `needs-owner`, and the builder stops; the owner pushes an empty commit or closes and reopens the pull request (option (a) of the review of #69, chosen by the owner) | Pull request #63: GitHub fired no event for 28b3c1b, the builder noticed after 25 minutes and asked without the owner's phone buzzing, and the task waited more than an hour. The builder's own session rules forbid an empty commit or a close and reopen to start CI (review of #69, finding 1), so the call to the owner is immediate and loud. |
| **A failure outside the code is re-run once, and nothing is pushed after a green re-run** (`finish-task` step 9): on a `CI red` verdict whose failure is outside the tests while the same suite is green locally and on `main`, the builder may re-run the failed job once; when it passes, one comment and no commit, and the review routine picks the head up (next row); when it fails, the failure is root-caused as any red CI | Pull request #68: the re-run passed at 23:01 UTC and woke nobody, because a re-run fires no `pull_request` event. An empty commit is forbidden to the builder by its session rules, and beside the next row it would let the reviewer spend two code rounds on one change (review of #69, findings 1 and 2). |
| **The reviewer reviews a head whose checks passed after a CI red verdict** (`review-pr` step 1 and Rules): a pull request whose newest `[review]` is a `CI red` verdict at its head sha needs a review once every check run of that sha has completed with success (`checks` and `e2e` `success`, none running, failed, cancelled or timed out; a `routines.yml` job that did not apply is `skipped`). It is reviewed from step 2, and the CI red verdict is still no round | Pull request #68: step 1 skipped the pull request because its head sha was the sha of its newest `[review]`. The hourly run now picks such a pull request up with no commit at all. |
| **The start routine counts such a head as waiting for the reviewer** (`docs/cloud-loop.md` sections 5 and 6, both conditions): a pull request whose newest `[review]` is a `CI red` verdict at its head sha and every check of that sha has since passed on a re-run is not stalled, and after three hours of waiting (from the end of the re-run) it gets the one "No review for three hours" comment | Review of #69, finding 3: otherwise the start routine would resume the builder of a pull request that only waits for the reviewer, and would never flag a review routine that stopped running. |
| **`docs/cloud-loop.md` names both stalls** under "When something goes wrong" ("CI never started on a push", "CI green after a re-run, no review"), and the review routine prompt of section 4 and the start routine prompt of section 6 carry the new case; the owner copies both prompts into the routines | Pull requests #63 and #68: the owner and the owner's reviewer must find the cause and the remedy without reading the skills; each routine runs from its configured prompt, which a merged file does not change. |

## 12 October 2026: the loop does not wait for decisions until go-live

Decided by the owner on 12 October 2026. Until go-live (task 10.4) nothing the loop builds is used by real people, holds real data or spends money, so every mistake can be corrected afterwards. The two stops of pull request #53 (the split of 2.2, and personal data across branches) were both answered with what the reviewer had already proposed. The owner's words, the reason for every row below: "Even if you made a wrong decision, I could always see the decision at the end of the day and correct you. So we need to make it more automatic and non stopping."

| Decision | Reason |
| --- | --- |
| **Two things stop a task** (`CLAUDE.md`, "Stop and wait for the owner"): (1) secrets, accounts with a provider, anything that costs money, and production (the live system, its data, its address); (2) a task pull request that changes the loop's own rules beyond the added check lines `review-pr` allows. Replaces the five-item stop list of 11 October 2026 (decision 2) | Owner: "Even if you made a wrong decision, I could always see the decision at the end of the day and correct you." |
| **Two brakes stay**: three review rounds without agreement, and three red CI runs in a row. They are failures, not decisions | Owner: "we need to make it more automatic and non stopping." A loop that cannot agree with itself has failed; that is not a decision to flag. |
| **Look first.** Everything else is decided, confirmed or changed by the reviewer, and posted on issue #42. The weightiest decisions carry the mark **Look first** and come first in the task's #42 comment: a test, constraint, index or trigger deleted or weakened, or a pinned list widened (only when a requirement or decision changed, never to make failing code pass, reason named; a merged migration is still never edited); a reading of a `packages/calc` or journal calculation rule (the exact-arithmetic rule is never broken); a new dependency (free licence, maintained, no audit finding, all three checked by the reviewer); widening an existing role; personal data readable across branches; a spec contradiction or a spec text that should change (with the proposed `/spec-change` wording); a task split into a, b, c. Issue #42's body says to read them first | Owner: "we need to make it more automatic and non stopping." |
| **A rule that should change no longer stops.** The builder follows the most reasonable reading, flags it Look first with the wording a `/spec-change` should give, and goes on; the owner runs `/spec-change` when they agree. Sessions still never change `docs/spec/`. When following the spec is impossible, the builder takes the nearest reading that keeps the rules that are never broken (`next-task` step 13); the reviewer decides a contradiction like a silence (`review-pr` step 5) | Owner: "we need to make it more automatic and non stopping." |
| **A wrong test is fixed, not asked about**, when a requirement or a decision changed: the reason goes in the report and the decision is Look first. Never skip, delete or weaken a test to get to green; the reviewer accepts a weakened test or constraint only when a Look first decision names the requirement that changed (`review-pr` step 8) | Owner: "we need to make it more automatic and non stopping." |
| **A task too large is split by the builder** into a, b, c in `docs/build-plan.md`, in the task's own pull request; the first part is planned and built, the split is Look first. Replaces "split it … and ask the owner to confirm" of the build plan and "propose a split … and stop" of `next-task` | Owner: "we need to make it more automatic and non stopping." The split of 2.2 on #53 waited for an answer that was the reviewer's proposal. |
| **One gate left, before Phase 10.** The gate lines before Phases 3 to 9 are deleted. The owner's reviewer prepares each phase's decided-ahead questions while the phase before runs; answers merged before the phase starts are used; where none came, the loop decides and flags. The Phase 10 gate (the live system, real data and secrets start there) is lifted after a go-live review of every Look first decision, at which the owner tightens the stop list for the live system. Replaces 11 October 2026, decision 8 (gates part) | Owner: "we need to make it more automatic and non stopping." |
| **A merge conflict wakes the builder.** `finish-task` merges `origin/main` before it pushes (step 8.1), keeping both sides of `docs/progress.md`, `docs/decisions.md` and `docs/build-plan.md`, the task's entry first; the reviewer answers a head with no check runs and `mergeable_state` `dirty` with `[review] changes needed at <sha>: CI red (no checks: merge conflict with main)` (no code round), and `next-task` step 12 merges, checks and pushes | On 12 October task 2.2a's last push and its "ready for review" got no CI run and no review: the pull request conflicted with `main` in `docs/progress.md`, GitHub runs no `pull_request` workflow then, and nothing woke anyone until the owner's reviewer posted the notice by hand. |

## 11 October 2026: the loop runs without the owner

Decided by the owner on 11 October 2026, after tasks 1.1 and 1.2 (issue #41: 32 hours for 1.1, of which about 30 waiting for a human relay; 1 hour 45 minutes for 1.2 with the owner at the keyboard). From now on the loop does not stop when the spec is silent; the owner touches a task in the morning. `docs/cloud-loop.md` describes the loop these decisions shape.

| Decision | Reason |
| --- | --- |
| **Decide and flag instead of stopping.** When the spec is silent or unclear, the planning session takes the most reasonable reading (the spec's own lines, the standing decisions, the way the school works), writes it in the plan under "Decided without the owner" with the reason, and goes on. The reviewer confirms or changes each decision when it approves the plan. The owner confirms or changes them afterwards on issue #42; a changed decision becomes a line under "The next sessions must know" in `docs/progress.md` and, when code must change, a fix task `<id>b` placed first among the open tasks of the build plan | A question that waits for a person cost 1.1 a day; a wrong reading costs one fix task, and the reviewer and the owner both see every reading. |
| **Five things still stop a task, even when nobody is watching** (replaced on 12 October 2026 by two: secrets, provider accounts, money and production; and a task pull request that changes the loop's own rules; the rest became Look first decisions, see "12 October 2026: the loop does not wait for decisions until go-live"): (a) secrets or deployment; (b) deleting or weakening a test, a constraint, an index, a trigger or a migration; (c) any text under `docs/spec/`; (d) a rule in `packages/calc` or the exact-arithmetic rule; (e) a new dependency. For these the session posts `[review] owner decision needed` (or says what it needs in the pull request) and stops. Widening what an existing role may already do in an existing permission area also stops; a new permission area for new routes is decided and flagged like any other decision | These are the changes a fix task cannot undo, or that the spec and `CLAUDE.md` reserve for the owner. |
| **Three rounds on the plan, three on the code.** The reviewer counts the `[review] changes needed` posted before the pull request was first marked ready (the plan) and those posted after (the code) apart, by distinct head sha: several at one sha are one round (owner, 12 October 2026, after pull request #46 got three `changes needed` at one sha from reviewer runs that met). After the third of one kind it posts `[review] stuck after three rounds at <sha> @abbosc`, adds the label `needs-owner`, and the task waits for the owner (counted apart since the second review of pull request #43). A `[review] changes needed at <sha>: CI red (<check>)` is no round: a flaky check must not use up the rounds, and the builder's own cap of three red runs in a row applies | A fourth round means the builder and the reviewer disagree on something neither can settle; the owner settles it, not another round. A plan revised twice must not leave the code a single round. Two reviewer runs that meet on one sha are one review, not two rounds. |
| **The reviewer merges task pull requests only.** On `[review] ready to merge` with the required checks (`checks`, `e2e`) green on the head commit, the review routine merges a pull request from a `task/` branch (merge commit, as the history so far). Every other pull request (a `process/` change, a `/spec-change`, one the owner opens, such as a gate line deleted) is reviewed, its `ready to merge` is for the owner, and the hourly run posts nothing more on it. The owner may still merge a task by hand. The start routine starts the next task on the merge | The merge was the one step that still needed a person on every task; the hand test on the test environment and issue #42 keep the owner's veto. A change to the loop, the spec or a gate is the owner's to merge. |
| **CI is the gate for the full suite.** A session runs lint, type-check and the tests related to its change (`pnpm test:changed`); the pull request's CI runs everything (4 minutes on GitHub against 10 to 15 on the laptop). A red CI is fixed before a review is asked for. The code review waits for CI on the head commit (every 30 seconds, up to 15 minutes); on a red `checks` or `e2e` it posts only `[review] changes needed at <sha>: CI red (<check>)` and reviews no code (added at the third review of #43) | The full suite ran twice per round (the session and CI), and the slower run decided nothing CI does not. A review of code that CI already refused is wasted. |
| **The text rule** of issue #39 lives in `.claude/rules/web.md` from today; the review checks it | Two of the three must-fixes of the last reviews were text; a rule the builder reads before the screen exists is cheaper than a review round. |
| **The reviewer's checklist grows.** Every must-fix of a code review that is a general pattern becomes a line in `.claude/agents/spec-reviewer.md` or in `.claude/rules/` in the same fix commit, so the same thing is never found twice | The lock-and-aggregate race and the `returning` order of 1.2 are patterns, not one-offs. |
| **Order and gates.** 1.5 is built before 1.4 (the calendar points at day templates). (Gates replaced on 12 October 2026: one gate is left, before Phase 10, and decided-ahead questions are prepared while the phase before runs; see "12 October 2026: the loop does not wait for decisions until go-live".) An owner gate line in `docs/build-plan.md` before every phase from Phase 2 on stops the start routine until the owner deletes the line, after a decided-ahead round of five minutes with the owner's reviewer for that phase (the review of pull request #43 widened the one gate before Phase 4 to every phase) | A special day names a template, so templates must exist first; a wrong decision must not cascade across a phase overnight, and within a phase the loop runs without stopping. |
| **The hand test** in a report is "what to look at" (three to five things only a person can judge) plus one line on what the browser test already proved; the owner tests on the test environment after the merge | The browser test already clicks through the steps; a person is needed for the wording and for how a screen reads, not for whether a button works. |
| **Measurement.** Issue #41 holds the cycle time per task; issue #42 the decisions to confirm. The owner's reviewer fills #41 after each merge | A change to the method is judged by the numbers before and after it, not by feel. |
| **The reviewer merges the commit it reviewed** (added at the review of pull request #43, the owner's second audit of the method). Every `[review]` verdict names the head sha it read, and a pull request needs a review when its head sha is not the one named in its newest `[review]` (since the third review of #43; commits are compared, never times); the merge call carries `-f sha=<that sha>`; a head that moved is reviewed again; no auto-merge; a check still running is read again every 30 seconds for up to 15 minutes; an open `task/` pull request whose newest `[review]` is `ready to merge` is picked up by the next run. Just before it posts a verdict, the reviewer reads the comments again and posts nothing when a `[review]` naming the same head sha was posted meanwhile; just before a merge it reads the pull request again and stops when it is already merged (owner, 12 October 2026) | Auto-merge, or a merge of "whatever is green later", would merge a push nobody reviewed. Two reviewer runs for one event posted the same verdict two or three times on 11 October (#46). |
| **One start per task.** `next-task` stops when a `task/<id>-*` branch exists on origin ("task `<id>` is already started"). The start routine looks at the task branches on origin as well as the open pull requests. A branch of the first unticked task with no pull request and no commit for two hours is deleted when it holds only empty commits (`git diff --quiet origin/main...origin/<branch>`), and the task starts in the same run; when it holds work, the routine opens one issue, `Loop stopped: <branch>`, starting with `@abbosc`, and waits | A session can die between the push of the branch and the pull request; two sessions on one task are two pull requests, and a dead branch must not block the loop until the morning. |
| **Three red CI runs in a row** on a builder's own pushes stop the task: a comment that starts with `@abbosc`, the label `needs-owner` | Review rounds were capped at three; CI rounds were not. |
| **The loop may not loosen its own rules.** On a pull request with a task id, a change under `.claude/`, `CLAUDE.md`, `.github/`, `scripts/hooks/` or `docs/cloud-loop.md` is `[review] owner decision needed at <sha> @abbosc` with `needs-owner`. Two exceptions (decided by the owner's reviewer at the second review of #43): added lines in `.claude/agents/*.md` or `.claude/rules/*.md` that add a check or a fact (an added "except", "unless", "may skip" or "need not" is a loosening), and added lines inside the Commands block of `CLAUDE.md` that each name a script of a `package.json` in the same pull request. Only `task/` pull requests are merged by the reviewer | The reviewer that merges must not be able to merge a weakening of its own checklist or of the loop; `CLAUDE.md` itself asks for a new command to be listed. |
| **A stalled task is resumed, not noted.** A woken builder's first act on an `approved` or `changes needed` is the line "Acting on the review.". The start routine's hourly run treats a task pull request without `needs-owner` whose newest `[review]` is `approved` or `changes needed` as stalled when (a) nothing (no commit, no comment) came after that review for 30 minutes, or (b) nothing happened for two hours, commits after the review or not; a pull request whose head sha is not the sha named in its newest `[review]` waits for the reviewer and is not stalled, unless it is a draft whose newest `[review]` is `approved` (that one is being built). The run checks out the branch, posts "Resumed by the start routine." and continues from step 12 of `next-task` (a draft) or step 9 of `finish-task` (a ready pull request). A live builder also posts a progress comment at least once an hour and ends a plan revision with an empty commit. A pull request that has waited three hours for the reviewer gets one comment, `@abbosc No review for three hours; the review routine may not be running (its runs: claude.ai/code/routines).`, once per head commit (since the third review of #43; it replaced "the builder session may have stopped", which named the wrong party) | A session that died after a review, or after a push, would otherwise block the loop until the morning; a missed wake now costs at most an hour, and a builder still at work never gets a second session on its task. A review routine that stopped running is the owner's to restart. |
| **`forceRerunTriggers` name the shared sources**: `**/packages/*/src/**` in the API's Vitest config, `**/packages/shared/src/**` in the web's | The apps import the built `dist` of a package, so Vitest's import graph never links a source file of `packages/shared` to an app test; `test:changed` ran no API test when the permission table changed. Proved by hand at the review of pull request #43. |
| **`finish-task` starts with `pnpm format`**; the hook stays | Most writes of a session go through the shell (`cat <<EOF`, `sed -i`, `node -`), which the hook does not see. |
| **CI refuses an edited migration**: the `checks` job fails when `git diff --name-status --diff-filter=a origin/main...HEAD -- db/migrations` lists anything (a status other than added) | "Never edit a merged migration" was prose; 0014 was edited once after it was applied. |
| **CI audits the dependencies**: `pnpm audit --prod --audit-level=high` after the install | A new dependency is a stop-list item (a Look first decision since 12 October 2026, checked by the reviewer for licence, maintenance and audit); an advisory in an existing one still needs an eye. |
| **A progress entry is at most 15 lines** (three on what was built, the left-out items with their task, "The next sessions must know"); `next-task` reads the two newest entries, not the file; the file inventory lives in the pull request body | The reading cost of every session grew with every task (`progress.md` 1,060 lines, `decisions.md` 542 at the review of #43). |
| **GitHub Actions fires the routines** (decided by the owner later on 11 October 2026; in part superseded on 18 October 2026: the `review` job reads a draft's comments and fires nothing for the build of an approved plan, fire calls no longer retry on every error, and two runs can post, see above). `.github/workflows/routines.yml` calls the routines' API triggers: the review routine on a pull request against `main` opened, pushed to, reopened or marked ready (`Pull request #<n> (<action>, head <sha>)`); the start routine on a merged `task/` pull request (`Merged #<n>`) and on a `[review] approved` or `[review] changes needed` comment on a `task/` pull request (`Review on #<n>: <first line>`), after which it waits ten minutes for "Acting on the review." and resumes a builder that did not wake. Plain `curl`, `permissions: {}`, the four routine URLs and tokens as repository secrets; the hourly schedules stay as a second net. The routines have no GitHub triggers of their own: the owner removed them on 11 October 2026 (recorded on 12 October), because they ran a second reviewer for every event the bridge already fires | On 11 October the routines' GitHub triggers never fired although the app was installed correctly, and a `[review]` comment did not wake the bound builder of #44; GitHub Actions runs on every pull request. A duplicate run (the hourly run meeting a bridged one) finds nothing to do, because reviews compare shas and the reviewer reads the comments again before it posts. |

## 12 October 2026: one design for both apps, one sign-in later

| Decision | Reason |
| --- | --- |
| `docs/design-system.md` is shared with the procurement app (`sodiqschoolapp/procurement`): everything above its last section, "This app", is the same text, word for word, in both repositories, and a change to it is a process change made in both in the same week. The logo files are the same. At phone width the menu becomes a bottom tab bar in both apps. | Owner: "Design codes of both platforms should be exactly the same." |
| After both apps are live, they share one sign-in: a member of staff signs in once and uses both. Nothing of it is built now; it is planned when both are live, with a spec change in both apps. | Owner: "we will merge the platforms after both are live. We just join the logins." |

## Decided ahead for tasks 2.2d and 2.7 (owner, 12 October 2026)

The owner's answers for the design tasks, from the design board "Sodiq Platform design directions" (page "Final") approved on 12 October 2026 with the owner's reviewer. `next-task` reads this section for the task's id; these are answers, not open questions. Written verbatim.

**Approvals (stop-list items approved in advance)**

1. Fonts: the Fontsource packages of Golos Text and Bitter (`@fontsource-variable/golos-text`, `@fontsource-variable/bitter`; the static `@fontsource/…` packages with weights 400 to 700 where a variable one is not published) replace `@fontsource-variable/geist`, which is removed. Both fonts are under the SIL Open Font License. The PDFs made on the server later (`13`, Exports) use the same Golos Text files.
2. Icons: Material Symbols Rounded, filled (Apache 2.0) replace Lucide; `lucide-react` is removed. Approved: one package of the `@material-symbols` family that ships the SVG files, and `vite-plugin-svgr` if the plan needs it to import SVG files as React components. The plan names the package and the weight (500 as on the board, 400 accepted). Icons are drawn from SVG, never from a font ligature: the icon's name would be text in a component.

**Design**

3. `docs/design-system.md` is the owner's design system. The builder checks every screen against it before the report and the reviewer checks it on every pull request that changes a screen. A screen of a later task follows it from the start.
4. The 12 subject colours of task 2.1 stay (keys and values).
5. The menu is navy in both themes. It collapses to a rail of icons by the person's choice, kept in the browser (`localStorage`, key `sodiq.menu`), like the theme.
6. Counts in the menu are plain numbers; there is no notification dot.
7. The sign-in page: the slogan "Taʼlim tarbiyadan boshlanadi" is a text of the three languages (uz as written; ru "Образование начинается с воспитания"; en "Education begins with upbringing").
8. Brand moments (Bitter, the hexagon drawing, the letterhead strip) are only the sign-in page, empty pages, full-page errors and printouts.
9. The design board also shows the journal, the timetable, the phone lesson mode and a teacher's Today page; they are built by their own tasks and follow the design system then. 2.2d restyles what exists; it builds no new page.
10. The branch phone (issue #39, item 3): "+998" and nine digits, stored as typed digits and shown grouped as "+998 71 123 45 67"; any other text is refused with a message that shows the format.
11. The Branches list (issue #39, item 1) is built in 2.7 after the owner's spec change of 12 October 2026 adds it to `03`; until that change is merged the item is reported as waiting for it, not built.

## Decided ahead for tasks 2.1 to 2.6 (owner, 12 October 2026)

The owner's answers to the questions the plans of these tasks would ask. `next-task` reads this section for the task's id; these are answers, not open questions, and a plan does not ask them again. Written verbatim.

**Approvals (stop-list items approved in advance)**

1. ExcelJS may be added as a dependency of the API for the Excel exports of the staff and student lists (`13-technology.md` names it).
2. Photos of staff and students: `@aws-sdk/client-s3` may be added to store them in the R2 bucket, and one upload route per photo kind may take a file instead of JSON (a declared exception in `apps/api/src/http/json-only.ts`). JPEG or PNG, at most 5 MB as chosen by the user; the browser shrinks the photo to at most 800 pixels on the long side before upload (canvas, no library), so stored photos are small. The connection comes from four environment variables with exactly these names: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, declared in `render.yaml` with `sync: false` for the API service and listed in `.env.example` without values. The owner sets their values in Render himself; a session never asks for them, never reads them and never writes them anywhere. Tests and CI never reach R2: they use an in-memory store behind the same interface. When the variables are not set, the upload route answers a refusal of its own ("photos are not configured yet") and everything else works, so the task does not stop for them.

**2.1 Subjects**

3. One subject list for the whole school (a school-wide table): names in three languages, department, grades, colour, journal type, switches. The weights (daily distribution and quarterly distribution per quarter) are per branch and are set by that branch's Academic Vice Principal.
4. The Super Admin and every Academic Vice Principal create, rename, edit and archive subjects; every change is audited.
5. No built-in subjects. A subject's journal type (graded or attendance only) is chosen when it is created; the school creates Ma'naviyat soati and the Homework slot itself, as attendance-only subjects in the Tutors department.
6. A graded subject cannot be saved without a daily distribution that totals 100. Its quarterly distributions may stay empty until publishing (the publish check of `edge/academic-year` requires them). A button copies quarter 1's distribution to the other quarters of the year.
7. Colour: one of 12 fixed colours that pass the contrast test in both themes.
8. Grades of a subject: any of 1 to 11, ticked.

**2.2 Staff**

9. Staff ID S-YYNNNN as in the spec change of 12 October 2026 (S-260001): assigned on save from a counter per year of first hire, kept for good, never reused.
10. Availability: per branch, per weekday, one or more time ranges (for example Monday 08:00–13:00), each set of entries valid from a date (`06`, Availability per branch).
11. The staff record has the contract load now: lessons per week by contract and most lessons per day (`edge/timetable`, "Rules refer to settings that no record has").
12. Education level: secondary, specialised secondary, bachelor, master, PhD, other.
13. Staff names are typed in Latin as the main spelling; the login is made from it.

**2.3 Accounts**

14. Login suggestion, in this order, the first that is free: first letter of the first name + "." + surname (a.karimov); the full first name + "." + surname (akmal.karimov); full first name + "." + first letter of the father's name + "." + surname (akmal.b.karimov); then akmal.karimov2, 3, … Lowercase ASCII: apostrophes and ʻ dropped, oʻ → o, gʻ → g, sh/ch kept as letters. The Super Admin sees the suggestion in the form and may change it before saving. A login never changes after it is given, even when the name changes, and is never reused.
15. First-password slips: a printable page from the browser, one slip per person.
16. Password reset by email: built now; until go-live (task 10.4) emails are written to the log only, never sent.

**2.4 Students**

17. A student is created with the grade they join (1 to 11) and a start date; the class comes with task 3.1, and until then every student shows "No class". The UID is typed by hand (7 digits) in Release 1; a UID whose first four digits are not the set of that grade warns and may be confirmed (`04`, UID sets).
18. Names are typed as on the student's document, Latin or Cyrillic. Search and the duplicate check treat look-alike spellings as the same (Oʻtkir, O'tkir, Ўткир).
19. Region: a fixed list of the 14 regions of Uzbekistan (12 regions, the Republic of Karakalpakstan, Tashkent city), plus "Other".
20. Diagnostic test score: optional, a whole number 0 to 100.
21. Scholarship: type is one of not a scholarship student, Merit, Financial aid, Gift. Merit, Financial aid and Gift each have coverage full or partial; a partial one has an amount in so'm as a whole number (not a percentage). Scholarship fields belong to the Financial group of readers (Super Admin, Academic Vice Principal, Principal).
22. The contract number is unique across the whole school, archived students included.
23. Enrolment consent: "consent signed" with its date, optional when the student is created; a list shows active students without it.

**2.5 Parents**

24. The "cannot receive SMS" warning shows for a number that is not a Uzbek mobile number (+998 followed by 9 and eight digits) and for any foreign number.

**2.6 Audit log and personal data**

25. The personal data report is shown on screen as a printable page (no PDF library).
26. No support account (spec change of 12 October 2026). The rest of the rule stays: no permanent developer account in the live system.

## Decided ahead for tasks 1.3 to 1.6 (owner, 11 October 2026)

The owner's answers to the questions the plans of these tasks would ask. `next-task` reads this section for the task's id; these are answers, not open questions, and a plan does not ask them again. Written verbatim.

**1.3 Academic year and quarters**

1. The year's name is derived from its dates ("2026–2027"); nothing is typed.
2. Years belong to a branch (one current year per branch, `03`); each branch creates its own; no "copy from another branch" yet.
3. Permissions: area `academic_years` — Super Admin view, create, edit; Principal and Academic Vice Principal view. Area `quarters` — Super Admin and Academic Vice Principal view, edit; Principal view.
4. A new year is created with four quarters without dates; the Academic Vice Principal dates them; the checklist item is "four dated quarters".
5. Database rules: every quarter inside its year; quarters in order; no overlap; gaps between quarters are allowed (they are the vacations, `edge/time-dates-calendar`).
6. The years of a branch do not overlap. Statuses: planned → current → closed. "Start year" (Super Admin) works for a branch's first year or when the previous year is closed; the database refuses a second current year of a branch.
7. The go-live start date is one per branch, on the branch record, set by the Super Admin; it must fall inside a planned or current year; editable until the first timetable version exists (phase 5 enforces that).
8. The top bar shows the current year and quarter, or "Vacation, quarter 2 starts on 10 November", or "Quarter 1 starts on …", and labels a planned year — computed from the clock in the branch time zone. Built in 1.3.

**1.5 Slot types and day templates**

9. Slot type: name unique per branch, kind lesson or break (lunch is a break named Lunch), length 5 to 180 whole minutes; archived when unused, never deleted.
10. Template: name, one typed start time (the only typed time), 1 to 20 ordered slots with at least one lesson slot; reordering by up and down buttons; drag and drop is not built now.
11. Where a template applies: the default; a grade range; a weekday; a weekday with a grade range (special dates come with the calendar, 1.4). Each setting takes effect from a chosen date, tomorrow at the earliest, and its history is kept; grade ranges at one level may not overlap (database).
12. Changing a slot type's length or a template's slots creates a new version from a chosen date, tomorrow at the earliest, history kept; the recheck against existing lessons comes with phase 5.
13. The result table: working weekdays × grades 1 to 11 for the chosen date, changed cells marked; shown as the preview on every save.
14. Permissions: area `day_templates` (slot types and templates together) — Super Admin and Academic Vice Principal view, create, edit, archive; Principal view.

**1.4 Calendar**

15. An entry has a kind (day off or special day), a first and a last date, a scope (whole branch or grades from–to), and one typed name (branch data such as "Navruz", not a three-language term). A special day names a template and, on a non-working weekday, the weekday it follows. An exam week says "regular lessons on this template" or "no regular lessons" (the bulk cancel comes with phase 5).
16. Only dates from tomorrow on (branch time zone) can be created or changed; past dates are read-only. Entries fall inside a planned or current year.
17. Same date and overlapping grades: a day off beats a special day; two entries of the same kind are refused (database constraint).
18. Permissions: area `calendar` — Super Admin and Academic Vice Principal view, create, edit, archive; Principal view.

**1.6 Settings and the setup checklist**

19. Per-branch settings in one typed table: edit days 1 to 30 (default 7); early-warning thresholds (low result 50, drop 15, attendance 80 percent, 3 absences in a row) — Academic Vice Principal. "Five graded works" stays fixed in code.
20. Attendance values for late (50) and skipped (0) are stored per quarter and editable by the Academic Vice Principal while the quarter is not closed.
21. Travel time between branches: per pair, symmetric, 0 to 180 minutes, Super Admin.
22. Languages of instruction are fixed to Uzbek and Russian (`05`) and shown read-only; grade bands are shown read-only.
23. The checklist per branch (Super Admin, Academic Vice Principal, Principal): branch and weekdays; rooms (at least one in use); departments (school-wide, shown as "whole school"); a year exists; four quarters dated; at least one lesson slot type; a default template in force; calendar (shows the count of entries, never blocks).
24. Permissions: area `settings` — Super Admin and Academic Vice Principal view, edit; Principal view. Travel time is under `branches` edit (Super Admin only).

## 18 October 2026: notices and the changed mark of a publish and a withdraw (task 5.5c-3a)

Plan approved on pull request #158 with corrections 1 to 3; decisions 1 to 10 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (a task split). 5.5c-3 is split into 5.5c-3a (publish, its replace and carries, withdraw) and 5.5c-3b (a Tutor change, every path of `followTutors`) | Decision 1 |
| **Look first** (a Build line moved). Showing the "changed" mark on the views goes to 5.9, which builds them; this task stores the mark (`lesson_changes`, 0084) and the reader `isMarkedChanged` | Decision 2 |
| Both sides are the stored lessons of the branch over the event's dates, read by the preview's reader (`storedLessonRows`, `cancelled: 'one_day'`): a lesson the expansion cancelled is on neither side, a one-day cancel is a lesson held. The side before is read `for update` after the publish lock and before the first write, in the writer's order (blocks, then lessons) | Decision 3; spec review must-fix 1, should-fixes 2 and 4 |
| "Changed": a lesson after the event with no equal before it by date, start, end, class or group, subject, teacher and room; one created again equal keeps the earlier mark | Decision 3 |
| **Build decision.** No mark in a **week** (Monday to Sunday) with no stored lesson of the branch before the event, the days before the start included; the plan said a date, which left a lesson moved to a weekday that had none unmarked | Decision 4, read by the week at the build |
| One notice per affected teacher with an account (never a vacancy) per event: `timetable.published` (with its replace and carries) or `timetable.withdrawn`, the version's number and the whole week of the teacher's earliest change, both sides sorted, at most 100 lessons each, no teacher field, a one-day cancel marked `cancelled` | Decisions 5 to 7 and 9; corrections 2 and 3 |
| The mark in a table of its own (composite key to the lesson's branch, cascade with the lesson) so that `lessons_claims` does not run; seven days from the transaction's moment, compared on each read | Decision 8; spec review should-fix 3 |
| No route or permission; the publish and withdraw audit entries carry `notices: { notified, marked }` | Decision 10 |
| **Build decision.** The notice's week is drawn as two short lists (before, after), one line per lesson, "changed" and "cancelled" in words; the plan named the design system's table and badge parts. A table does not fit the notification dialog, and `docs/design-system.md` ("What we never do", 4 and 12) asks for words, not badges or dots | Code review should-fix 8 |
| **Build decision.** Each lesson of a notice carries `changed`, set by the server's pairing (`weekChanges`), so the browser never compares display names again | Code review should-fix 7 |
| **Build decision.** The days of the last week after the event's last written date (a withdraw whose run ends mid-week) are read once for both sides, like the days before its start | Code review should-fix 4 |

## 18 October 2026: "Classes taught" and the vacancy kept (task 5.5c-2b)

Plan approved on pull request #157 with corrections 1 to 4; decisions 1 to 9 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (a trigger narrowed by a requirement; the spec read against its own text). `staff_statuses_vacancy_load` (0055) refuses only while a row of a draft, or of a published version that can still run, names the vacancy, or a lesson dated after today is under it (0083) | Decision 1: read literally, "cannot be closed while a load row names it" would make "one that did is closed and kept" impossible; `/spec-change` wording on issue #42 |
| **Look first** (a pinned list changed). The `SECURITY DEFINER` allow-list entry `vacancy_load_rows(uuid)` is replaced by `vacancy_close_holders(uuid,uuid,date)`, which takes the branch as a parameter and refuses an application caller a branch outside its transaction or a record that is not a vacancy of it | Decision 9, correction 1 |
| A published version holds until a later version of its chain has started or its year has passed; the close day bounds the lessons only | Decision 2, correction 3 |
| The delete answers `vacancy_in_load` on every path; `vacancy_delete` is unchanged | Decision 3 |
| A future lesson is dated after today, cancelled or not, as 0080 | Decision 4 |
| "Classes taught": in the branch of the request, for every reader of the record, by year not closed, with subjects | Decisions 5 to 7 |
| No audit kind is added | Decision 8 |

## 18 October 2026: publish, withdraw (task 5.5c-2a)

Plan approved on pull request #156 with corrections 1 to 4; decisions 1 to 13 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (a task split). 5.5c-2 is split into 5.5c-2a (withdraw) and 5.5c-2b ("Classes taught", the vacancy kept) | Decision 1 |
| **Look first** (a pinned list widened by a requirement). `timetable_version_out_of_date_causes_action_check` (0082) and the shared `OUT_OF_DATE_ACTIONS` gain `timetable_version.withdraw`, kind `withdraw` | Decision 2 |
| The version that runs again is the latest published start before the withdrawn one, a tie to the higher number, until the next published start or the year's end | Decision 3 |
| Its lessons are written by `writeDatedLessons`; an unchanged lesson keeps its identity | Decision 4 |
| The full rule set on its pattern and dates refuses (`withdraw_blocked`); a teacher out, and a Tutor lesson, are decided per date as "needs a teacher"; the version is read as if it started on the withdrawn start | Decision 5; spec review must-fix 2 of the plan; code review must-fix 1 |
| Every draft of the branch and year gets a withdraw cause; bringing it up to date is a publish cause's; with no published version left, an archived source (withdrawn, or replaced) is no longer named | Decision 6; code review should-fix 4 |
| No reason, no preview; notices with 5.5c-3; no column, the audit entry `timetable_version.withdraw`; permission timetable edit | Decisions 7 to 10 |
| With no earlier version, the stored lessons of the run are deleted | Decision 11 |
| A shortened day with no stored choice is read as a publish reads it | Decision 12 |
| A carry or replace made by the withdrawn version's publish stays | Decision 13 (review correction 2) |

## 18 October 2026: publish, journals at publish (task 5.5c-1)

Plan approved on pull request #155 with corrections 1 to 3; decisions 1 to 10 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (a task split). 5.5c is split into 5.5c-1 (journals at publish), 5.5c-2 (withdraw, "Classes taught", the vacancy kept) and 5.5c-3 (notices and the changed mark) | Decision 1 |
| **Look first** (a From line moved). The per-quarter journal type and rating exam switch go to 8.2, which names the readers that move from the school-wide values (the publish check, 6.2, 6.3, 9.1) | Decision 2 with correction 3 |
| A journal's `runs` (`datemultirange`) are the days the published chain's load has it, gaps kept; closed on a day outside them | Decision 3 |
| Every load row's class or group and subject gets a journal, Tutor subjects, attendance-only subjects and vacancies' rows included | Decision 4 |
| Lessons have no journal column | Decision 5 |
| No route, screen or permission | Decision 6 |
| Audit `journal.open` and `journal.runs` in the `timetable` group | Decision 7 |
| A journal no run has keeps its row with empty runs | Decision 8 |
| The sync reads the whole chain of the year; a tie on a start goes to the higher number | Decision 9, correction 1 |
| The last run has no upper bound | Decision 10 |

## 18 October 2026: publish, the preview from the stored lessons (task 5.5b-2)

Plan approved on pull request #154 with corrections 1 to 3; decisions 1 to 7 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| The "before" side is the stored lessons of the branch on the dates, read as the writer reads them; lessons the expansion created cancelled are left out, a one-day cancel (`exam`, `reason`) is kept as a lesson held | Decision 1; 5.5a-2b-1 decision 4, 5.5b-1 decision 8 |
| A published version with no stored lesson block (published before 0079) is read from its pattern, without needs-a-teacher marks | Decision 2; `docs/progress.md`, 5.5b-1 |
| A stored lesson's weekday is its pattern block's, its classes its unit's, its minutes the writer's (`storedPairOf`) | Decision 3; spec review should-fixes 2 and 3 |
| The transition week counts no cancelled stored lesson, of any cause | Decision 4; 5.5a-2b-1 decision 10 |
| The "after" sides, the draft's and each carried version's, take the teacher the publish writes (`writtenTeacherOf`) | Decision 5; 5.5b-1 decision 7 |
| The lessons holding data that block a removal come with 6.1 | Decision 6; 5.5b-1 decision 9 |
| No route, permission or migration changes | Decision 7 |

## 18 October 2026: publish, the dated lessons written (task 5.5b-1)

Plan approved on pull request #152 with corrections 1 to 3; decisions 1 to 13 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (a task split). 5.5b is split into 5.5b-1 (the dated lessons written at publish, the chain, the database guards) and 5.5b-2 (the preview from the stored lessons) | Decision 1 |
| **Look first** (a grant widened by a requirement). Delete on `lessons` and `lesson_blocks` and an update of their version, pattern block, load row and entry are granted (0079); a delete or a re-point dated today or earlier, or with no moment of the transaction, is refused, and a re-point is checked at the commit as an insert is (`lesson_repoint`); `lessons.database.test.ts` no longer expects the delete refused for want of a grant | Decision 2; 5.1a decision 12 left both to this task |
| **Look first** (a Build line moved). Stored one-day changes applied again after a publish go to 5.6a, exams kept after a publish to 5.6c: neither can be stored before them; a kept lesson keeps a cancel of cause `reason` or `exam` | Decision 8 |
| **Look first** (a test changed by a requirement). `tutor-lessons.test.ts`, "a give that waited for a lesson write": the write at the same moment is a teacher set on a stored lesson, no longer a new lesson, since only a publish writes one and it holds the year's versions that a follow now locks first | Decision 11 |
| An unchanged lesson is re-pointed to the new version, its block with it | Decision 3 |
| The same lesson: class or group, subject, date, start and end, paired one to one as `publishImpact` pairs; a lesson created cancelled pairs only with one cancelled with the same cause at the same pattern times | Decision 4, spec review must-fix 1 |
| A new dated block reuses the stored block holding most of its kept lessons, the smaller id on a tie, each stored block once | Decision 5, spec review must-fix 2 |
| A cancelled lesson takes its pattern block's times | Decision 6 |
| "Needs a teacher" is a null teacher; a vacancy always keeps its id | Decision 7 |
| A lesson holding data cannot exist before 6.1 | Decision 9 |
| The guards a change at the same moment can raise, a deadlock and a failed serialization answer `timetable_busy` with the code only; the guards only a fault of the code raises stay 500 | Decision 10 |
| `followTutors` locks every version of its classes' years `for no key update` (once for all the classes of `followTutorEnds`) | Decision 11 |
| **Build decision** (in place of decision 11's `lockPerson` `for no key update` and review correction 2). A person's record stays `for update` under a status change: `department-moves.test.ts` shows a department move must wait for a load row in flight that names the person, which `for no key update` lets pass. The publish instead takes the people of its branch `for key share` before the versions, so it waits for a status change before it holds them, or the change waits for the publish | Spec review must-fix 5; found by `pnpm test:changed` |
| The audit keeps every removed lesson with its fields and every changed lesson's teacher and room before and after; created lessons are counted | Decision 12 |
| The write runs after every check and the status update, its commit checks deferred for its length | Decision 13, spec review must-fix 3 |
| A carried version's lessons are written inside its savepoint, from the carry's own check | Spec review must-fix 4 |
| The publish takes the classes of its branch and year `for key share` before the versions, as it takes the people: an archive holds its class `for update` and then takes the versions in `followTutors`. No holder of a group, room, subject or quarter `for update` reaches `followTutors` | Code review of #152, finding 1 |
| A lesson of a Tutor row created cancelled takes the class's Tutor of its date at its block's start, `null` with none (`DatedFindings.cancelledTeacher`) | Code review of #152, finding 2; edge/timetable, Structure |
| `lesson_double_pair` is a fault of the code (500), never `timetable_busy`: the writer makes the pair ids and the publish lock serialises publishes | Code review of #152, second opinion |
| **Look first** (a merged test changed by a requirement). A class is not archived while it has a lesson dated after the day of the archive in the branch's time zone: `classes_lessons_guard` (0080), 409 `class_has_lessons`, under the class's `for update` lock that a publish's `for key share` meets. Every lesson of the class counts, a cancelled one too; a lesson later today does not. Group lessons do not count: a group is archived on its own. The archive no longer follows the Tutor lessons (3.6c-2, spec review must-fix 5, written while the archive did not refuse future lessons); `tutor-lessons.test.ts` "follows the archive of the class" now expects the refusal | Code review of #152, round 2, finding 1; edge/timetable, After publishing: "A class cannot be archived while it has future lessons or members" |
| The 0058/0066 guards of a lesson against its block, unit and version rows (`lesson_block_date`, `lesson_block_version`, `lesson_unit_year`, `lesson_group_subject`, `lesson_load_row`, `lesson_pattern_entry`) are faults of the code for a carry (500, not "left"): a published version's rows are fixed, and a class's year and a group's subject are never updated. `lesson_block_quarter` stays a check refusal: a quarter's dates change | Code review of #152, round 2, second opinion |
| `time_claims_room_excl`, `time_claims_class_excl`, `room_shared_full` and `room_shared_capacity` stay `timetable_busy`: today no writer meets a publish on them, but the one-day changes of a room (5.6, 5.7a) will write lessons outside the publish lock | Code review of #152, round 2, second opinion |

## 18 October 2026: bringing a draft up to date after a publish (task 5.5a-3b-2)

Plan approved on pull request #148 with corrections 1 to 3; decisions 1 to 14 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (a trigger widened by a requirement). `timetable_versions_fixed` (0055) lets a draft's `from_version_id` change (0078, with its update grant); the source of a published or archived version stays fixed; the route names a published version only, under the publish lock | Decision 1, review correction 1; "the draft then names the published version as the one it started from" |
| **Look first** (tests changed by a requirement). The test that expected `draft_out_of_date_by_publish` now brings the draft up to date; `teaching-load.database.test.ts` no longer expects `from_version_id` refused on a draft or ungranted | Decision 2; 5.5a-3b-1 decision 5 held that refusal "until 5.5a-3b-2" |
| The version compared is the published version in force on the later of the draft's start and tomorrow in branch time, else the year's earliest published version, else none; a publish cause of a later version is cleared with the others | Decision 3, spec review must-fix 1 and should-fix 3 |
| The base is the draft's source as stored now; it sets labels and defaults only, every difference is listed and picked | Decision 4 |
| An item is the rows of one subject whose classes meet, or that share a block on either side, taken whole: load fields, lessons in the week (with the double pairing) and pins | Decision 5, spec review must-fix 2 |
| A Tutor row's teacher is never a difference; a Tutor row added takes the draft's Tutor | Decision 6 |
| The default pick is the side that changed, none when both did; every item needs a pick (`up_to_date_pick_missing`) | Decision 7 |
| The picks are checked in memory before any write: a new blocked result, a slot the draft's template lacks, or a new load problem of a row taken refuses `up_to_date_blocked` with the list | Decisions 8 and 12 |
| The start date, step 5's rules and weights, left rows, shortened-day choices and class, teacher and day locks stay the draft's; a block lock goes with its block | Decision 9 |
| The publish lock first, then the draft's | Decision 10 |
| The key covers the causes, the version compared and every item; a pick of an item not listed is `out_of_date_changed` | Decision 11 |
| One audit entry `timetable_version.up_to_date` holds the picks and every row, block, entry, pin and cascaded block lock removed and added; `writeBlock` writes blocks without the grid's own entry | Decision 13, review correction 2 |
| A draft may name a version that names it; the publish's chain walk stops on a version seen | Decision 14 |

## 18 October 2026: out-of-date drafts after a change of the setup (task 5.5a-3b-1)

Plan approved on pull request #146 with corrections 1 to 4; decisions 1 to 12 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** 5.5a-3b is split into 5.5a-3b-1 (the marks from templates, calendar, availability and rooms, and bringing a draft up to date after them) and 5.5a-3b-2 (bringing a draft up to date after a publish: both sides, the person picks) | Decision 1 |
| **Look first** (a column and a trigger column removed because the requirement changed). The mark is its causes (`timetable_version_out_of_date_causes`, 0077): a draft is out of date while it has a cause; `timetable_versions.out_of_date_at` is dropped and `timetable_versions_mark_draft` guards `edit_holder_id` and `edit_seen_at` only; the fixtures of `publish.database.test.ts` and `publish.test.ts` read and write causes. No trigger guards a cause: every reader, a copy included, counts the causes of drafts only | Decision 7, review correction 2; `06`: "the differences are shown" |
| **Look first** (a lock narrowed, no rule weakened). The `for update` locks of version rows (`lockDraft`, publish, Tutor rows) are `for no key update`: they still exclude one another and a copy's `for share`, and no longer block the `for key share` of a cause's foreign key. A setup writer then never waits on a version row; the tests check that nothing waits on a version or a cause row and that both sides commit | Decision 8, review correction 1 |
| The writes that mark: every calendar entry write but a new name alone; a slot length, a template version, a template set or ended; availability set, or ended by a branch removed from a person (the removed branch's drafts); a room edit of its type, capacity, status, sharing or simultaneous lessons. Creates, renames, archives and restores of slot types and templates, room creates and renames, buildings and floors do not mark | Decision 2 |
| A change marks the drafts of its own branch in years not closed that it touches: a calendar entry the years of its dates (before and after an edit), a template change the years ending on or after its date, availability the years of the entry's dates, a room every year not closed | Decision 3 |
| Bringing a draft up to date after a change of the setup is a confirmation after the causes and the check of the draft are shown; nothing on the setup side is picked | Decision 4 |
| A draft with a publish cause is refused `draft_out_of_date_by_publish` until 5.5a-3b-2; a publish adds its cause to every other draft of its branch and year whose chain of sources does not hold it, marked or not | Decision 5, spec review must-fix 2, review correction 3 |
| The drafts marked before 0077 carry one publish cause with no record | Decision 6 |
| A copy takes the causes its transaction reads, only from a draft | Decision 9, review correction 2 |
| `POST up-to-date` takes no request key; it deletes exactly the causes it read when the key of their ids matches (`out_of_date_changed` otherwise), and a draft with no cause is answered as it is | Decision 10 |
| A change of the year's or the quarters' dates does not mark | Decision 11 |
| The panel is in the builder only; it names each cause by its audit action's label, its record and moment in branch time, counts the check of the draft and links to step 8 | Decision 12 |

## 18 October 2026: publish, the chain (task 5.5a-3a)

Plan approved on pull request #145 with corrections 1 and 2; decisions 1 to 11 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** 5.5a-3 is split into 5.5a-3a (the chain) and 5.5a-3b (out-of-date drafts) | Decision 1 |
| **Look first** (a trigger widened by a requirement). `timetable_versions_status` allows published → archived for a version whose start is after the branch's today (`app.now`), in a year not closed (`version_archive_started`); `publish.database.test.ts` no longer expects that transition refused | Decision 2; replace now, withdraw (5.5c) later |
| **Look first** (two guards widened by a requirement). On a published version that has not started, a load row may change only its teacher and room and a pattern entry only its room (its teacher by the cascade); pins, locks, day keeps, blocks, inserts and deletes stay draft-only | Decision 3 with correction 1; "the same changes are made in every later version" |
| Carry is offered when the draft names a source and differs from it only in rows' teachers or rooms and entries' rooms, rows matched by class or group and subject, entries by row, weekday and slot position; a Tutor row is never a difference | Decision 4 |
| A later version takes a change only where it still has the before value; a version where a change brings a blocked result or a load problem the unchanged version has not is left whole | Correction 2, decision 8 |
| A start on a published version's start is allowed with "replace" only (`chain_start_taken`) | Decision 5 |
| An answer counts only with the key of the later versions shown (`laterKey`, `chain_changed`); with no later version it is ignored | Decision 6, spec review should-fix 2 |
| The preview reads each date from the version in force on it; under carry it adds the carried versions' lessons over their runs | Decision 7, spec review must-fix 1 |
| No column records a replace or carry; the audit entries `timetable_version.replace` and `timetable_version.carry` do | Decision 9 |
| Notices of a carry come with 5.5c; dated lessons of changed versions with 5.5b | Decisions 10 and 11 |

## 18 October 2026: publish, the readers that follow the published version (task 5.5a-2c)

Plan approved on pull request #144 with corrections 1 to 4; decisions 1 to 8 confirmed there (6 changed by correction 1, 7 marked Look first). Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (a trigger narrowed by a requirement). On the days a published version runs, `class_memberships_need_groups` and `class_memberships_regained` read its group rows instead of the active groups; before the year's first published version the active groups still bind | Decision 1; 3.4b decision 1; `edge/timetable`, Versions and drafts, "takes effect on that version's start date"; `05`, Group |
| **Look first** (a refusal narrowed by a requirement). A department move leaves out a published version once a later published version of its branch and year starts on or before the move's start date; drafts count as before | Decision 7; the From line of 3.4c |
| A run lasts from a published version's start to the next published start of the branch and year; a tie goes to the higher number; withdrawn versions never run | Decision 2; as `timetable_busy_elsewhere` reads "in force" |
| A published group row binds only while its group is not archived and draws from the class | Decision 3 |
| On a published run the automatic placement offers only that run's groups; adjacent stretches with the same groups are one | Decision 4 |
| The branch move accept offers the union of the groups of the runs from the release's date and writes the chosen group only over the runs that list it; other days are covered automatically | Decision 5 |
| No new lock between a publish and a class path; earlier class rows missing the draft's group subject block the publish as `load_group_gaps` | Decision 6 with correction 1 |
| No route, permission, screen or text changes | Decision 8 |

## 18 October 2026: publish, the lessons kept on a shortened day (task 5.5a-2b-2)

Plan approved on pull request #143 with corrections 1 and 2; decisions 1 to 12 confirmed there (1 changed by correction 1). Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| A kept lesson keeps the slot of its own lesson number when the date has it; the other kept lessons fill the remaining lesson slots in their order in the day | Decision 1 with correction 1: "matched by their order in the day"; a saved choice of the default ticks changes nothing |
| A choice is stored per version, date and class, one row per kept lesson, named by the slot position of the weekday the date follows (`timetable_day_keeps`, 0074) | Decision 2; as pins name a slot |
| A choice applies only where the day is shortened for the class; elsewhere it is unused and listed with Remove | Decision 3 |
| A lesson of several classes is kept only when each class keeps it at the same time; otherwise cancelled "not in the day's template" | Decision 4 |
| A lesson not kept is cancelled "not in the day's template" | Decision 5 |
| Refused: a day not shortened (`day_keep_not_short`), a position that is not a lesson of the class (`day_keep_lessons`), more lessons than slots (`day_keep_over_slots`), today or earlier (`day_keep_date_passed`, the branch's today from the clock); fewer allowed; an empty list always removes | Decisions 6 and 10, correction 2, spec review must-fix 1 |
| The two halves of a double lesson are not forced together | Decision 7 |
| `timetable` `edit` with the edit lock; no new area | Decision 8 |
| The preview's "before" side uses the published version's own choices | Decision 9 |
| A stored position with no lesson of the class is ignored and shown as changed; a choice with none is unused | Decision 11 |
| A copy carries the choices of the classes its load still has; the others are named in its audit entry | Decision 12 |
| The refusal of too many lessons is `day_keep_over_slots`, not the plan's `day_keep_too_many`: the locale types read a key ending in `_many` as a plural form | Build decision 13 |

## 18 October 2026: publish, the impact preview and the transition week (task 5.5a-2b-1)

Plan approved on pull request #142 with corrections 1 and 2; decisions 1 to 13 confirmed there (10 changed by correction 2). Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** 5.5a-2b is split into 5.5a-2b-1 (the impact preview and the transition week) and 5.5a-2b-2 (the lessons kept on a shortened day) | Decision 1 |
| The preview compares the draft with the published version in force before its start, expanded by `datedPattern` over the same dates; a first publish has every lesson created; from 5.5b the stored lessons | Decision 2 |
| The same lesson: same class or group, subject, date, start and end; a different teacher or room is "changed"; the rest are paired as "moved" per class or group, subject and week; the others are created or removed | Decision 3 |
| Lessons created as cancelled are left out of both sides | Decision 4 |
| One line per kind, class or group, subject and both slots, with the count and the first and last date | Decision 5 |
| Affected: the teachers, classes and rooms of every lesson not unchanged, on either side | Decision 6 |
| Notified: affected persons with an account; never a vacancy; sending stays with 5.5c | Decision 7 |
| Every vacancy of the draft's pattern with its lessons per week | Decision 8 |
| No lesson can hold data before 5.5b and 6.1: the list of removals blocked by data comes with 5.5b | Decision 9 |
| The transition week is the Monday-to-Sunday week of the start, shown when a date of it before the start has lessons; each date before the start from the published version in force on it; every class or group and subject listed, differences marked; cancelled lessons not counted | Decision 10 with corrections 1 and 2 and spec review must-fix 1 |
| A differing transition week is published only with the key of its differing rows (SHA-256 of the start and the rows), else `transition_unacknowledged`; it narrows "Warnings never stop a publish" of 5.5a-1 for this warning only | Decision 11 |
| The preview names records of the branch only | Decision 12 |
| No route is added and none changes who may call it | Decision 13 |
| The transition key is the SHA-256 of the draft, the start date and the differing rows, so a key shown for one draft never acknowledges another | Build decision 14 (permission review, should-fix 4) |

## 17 October 2026: publish, the dated check of every date (task 5.5a-2a)

Plan approved on pull request #140 with corrections 1 and 2; decisions 1 to 11 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** 5.5a-2 is split into 5.5a-2a (the dated check), 5.5a-2b (the impact preview and the transition week) and 5.5a-2c (`class_group_subjects` and `department_move_loads` from the published version) | Decision 1 |
| The other branches on each date are their stored claims (`teacher_claims_elsewhere`, 0067); the own branch's stored lessons and exams are not read | Decision 2; the claims hold another branch's one-day changes and exams |
| One `checkTimetable` per date with that date's facts; only blocked results and `teacher_unavailable_later` are taken | Decision 3 |
| A two-grade group on a date off for one grade is listed cancelled "day off" until 5.6b stores the choice | Decision 4 |
| A dated refusal that repeats a pattern refusal (rule, own entries, other branches, detail without the date) is not listed again | Decision 5 with correction 1 |
| A lesson outside the availability entry of its date is a warning by date only under another entry than the start date's | Decision 6 |
| Lessons the day cannot hold are listed and never refuse | Decision 7 |
| A dated result names the own pattern entries, its date and another branch by its id only | Decision 8 |
| "Needs a teacher", listed, not refused: a worked weekday the teacher is not available on; a teacher out from a date after the start; a Tutor row with no Tutor on the date or whose Tutor of the date clashes by time or travel | Decisions 9 to 11 |
| "Not available on the real day" is decided per lesson: only a lesson whose grades follow another weekday on its date (`DatedLesson.followsWeekday`) becomes "needs a teacher"; a lesson of a grade that keeps its own weekday stays `date_blocked` | Review of #140 (owner, 18 October 2026): a calendar entry can cover a range of grades |
| A Tutor of a date who is not the entry's teacher is checked by time and travel only (`checkTeacherTime`, as `followTutors`) | Build decision 13 |
| Step 8 names a branch the start date's busy-elsewhere does not name "another branch" | Build decision 14 |

## 17 October 2026: publish, the route, its checks and one at a time (task 5.5a-1)

Plan approved on pull request #139 with corrections 1 and 2; decisions 1 to 15 confirmed there, decision 16 added by correction 1. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** 5.5a is split into 5.5a-1 (the route and its pattern checks, the lock), 5.5a-2 (the dated check of every date and the impact preview) and 5.5a-3 (out-of-date drafts and the chain question) | Decision 1 |
| **Look first** (a test changed by a requirement). `teaching-load.database.test.ts` no longer expects the status of a version to have no update grant: publish writes it, and `timetable_versions_status` lets a draft only be published (`publish.database.test.ts`). Two fixtures that put a published version back to a draft (`readiness.test.ts`, `teaching-load.test.ts`) go through `LoadKit.setVersion`, which writes `draft` and `archived` past the trigger | 0073; the requirement that only drafts are written ended with publish |
| One publish at a time for the whole school (an advisory lock taken first), stricter than one per branch | Decision 2; "The first to publish stands" (`06`, Two drafts at once) holds at the same moment |
| A publish on or before the start of a published version of the year is refused `version_later_published` until 5.5a-3 asks its question | Decision 3 |
| A publish marks every other draft of the branch and year out of date unless the published version is in its chain of sources; a copy of a marked draft carries the mark | Decisions 4 and 14 |
| Steps 1 to 4 and 7 are required, not step 5; the rows and the conflicts refuse by their own codes | Decision 5 with spec review should-fix 5 |
| The start is tomorrow at the earliest, read on the moment of the saving transaction; a changed date is saved in the publish with the Tutor rows following, and a refused publish keeps the old date; the default is the later of next Monday and the year's first day | Decisions 6, 7 and 15 |
| "Deliberately short" is `short_reason` (1 to 500 characters) on the load row, copied with the row | Decision 8 |
| The weights count as `quarterWeightsMissing` counts (`subject-weights.ts`, one function for both); the quarters touched end on or after the start | Decision 10 |
| Warnings never stop a publish; one 409 `publish_blocked` lists every refusal; the check is a `view` route | Decisions 11 to 13 |
| A repeat that waits for the first request with the same key has no time limit of its own: it waits until the first commits or rolls back, then gets the stored answer or runs again | Decision 16 (review correction 1); the publish lock and the draft locks already order the waits |

## 17 October 2026: the grid, mixed pairings (task 5.4c-3b)

Plan approved on pull request #138 with corrections 1 to 4; decisions 1 to 10 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (tests changed by a requirement). The tests that refused a mixed half with `pattern_mixed_block` are rewritten: a mixed half alone is placed as its whole split, and each case keeps a refusal test (`pattern_mixed_partner`); the code `pattern_mixed_block` is removed. `pin_mixed_block` stays | Decision 1; the task makes a mixed half placeable |
| **Look first.** `subject_twice` counts per student (a double pair once; a lesson with no members stands for its class or group). Proposed `/spec-change` for `06`, Rules, Warning row: "The same subject twice in one day for a student of a class (the halves of a mixed split placed in two slots count once each); a free period in the middle of a class's day." | Decision 2 with review correction 3; `edge/timetable`, Structure: "the reverse in another slot" can be the same day |
| A pairing is one pattern block of two lessons, chosen slot by slot, not stored on the load; a mixed half alone takes its whole split | Decisions 3 and 4; "A mixed block is allowed" is a permission |
| Partners (`partnersIn`): rows marked mixed whose groups are splits of the same class, of another subject; coverage and overlap stay `split_apart` and `student_double`; "Paired with" lists the halves sharing no student first | Decision 5 |
| A block that is neither one block of the load nor a pairing of partners is `split_apart` with the detail `rows` and a text of its own; the load edit that causes it is not refused | Decision 6 with review corrections 1 and 2 |
| `pattern_mixed_partner` (409) for a partner that cannot pair; a partner outside the version is 404 | Decision 7 |
| A double of a pairing is two pairing blocks of the same two rows in consecutive slots; "To place" has an entry per mixed half; no audit kind is added | Decisions 8 to 10 |

## 17 October 2026: the grid, double lessons (task 5.4c-3a)

Plan approved on pull request #137 with corrections 1 to 3; decisions 1 to 12 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** 5.4c-3 is split into 5.4c-3a (double lessons) and 5.4c-3b (mixed pairings) | Decision 1; each changes every write path of the grid and its undo on its own |
| **Look first.** New blocked rule `double_not_allowed` in `FIXED_RULES` and `RULE_ORDER`: a double of a row without "double lessons allowed". Proposed `/spec-change` for `06`, Rules: add "Blocked: A double lesson of a teaching load row that does not allow double lessons." | Decision 2; `05`, Teaching load, Fields; fills a silence of `06`, Rules |
| A double is two blocks sharing `double_pair_id`, each the whole block of its rows; `double_apart` checks each load row's two lessons | Decision 3; `edge/timetable`, Structure |
| The second half goes in the next lesson slot (a break between allowed); a move names either half, which takes the slot, the other beside it (`pairAt`) | Decisions 4 and 5 |
| Swap and rearrange never move a half alone (the engine's `double_apart`); "Suggest a place" on a double offers its free slots only, applied by the move route; a removal of either half removes both; no join or split route | Decision 6, plan review finding 9 |
| A room change of a lesson of a double changes that row's lesson in both halves (`roomLessons`) | Decision 7 |
| A lock on either half holds the pair; no database constraint for consecutive slots, teacher and room; the existing audit kinds carry `doublePairId` | Decisions 8 to 10 |
| `pattern_double_pair` (0058, at the commit) maps to `pattern_clash` | Plan review, should-fix 2 |

## 17 October 2026: the grid, undo and redo (task 5.4c-2)

Plan approved on pull request #136 with no corrections; decisions 1 to 11 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** A step whose blocks changed since (the board read again just before) is dropped with a message and nothing is sent; a step refused by the rules is shown and kept | Decision 3; the journal's undo rule (`edge/journal`, Undo: "applies only to cells nobody changed since") read onto the timetable, and the task's Done when |
| Steps are the grid changes of the page only (place, move, swap, room, remove, applied suggestion); locks, the load and steps 1 to 6 are not steps | Decision 1; `06` puts Undo under "Editing in the grid" |
| A step is taken back by a new write through the route of its kind, audited as that write, with no undo mark | Decisions 2 and 5; build plan line ("each step taken back through the routes and the rule engine") |
| An undone removal places the block again with a new id and its rooms; its lock does not come back | Decision 4; a lock is not a step |
| Locks bind the undo of a suggestion (rearrange) and not the undo of a hand move, room change or removal | Decision 5, with 5.4c-1 decision 8 |
| The history is per builder page and version, at most 50 steps (a default), cleared on reload, another version and a takeover | Decisions 6 and 10 |
| The room route and the `rooms` of place and rearrange accept `null` so that an undo gives back "no room"; the picker never offers it | Decision 7; a lesson may have no room (`roomOfNew`); 5.4b-2a decision 5 stays for the picker |
| Ctrl+Z undo, Ctrl+Shift+Z and Ctrl+Y redo (Cmd on a Mac), not inside a field or an open dialog | Decision 8 |
| The read before an undo and its write are two transactions; the edit lock keeps other accounts out, a second tab of the same account is accepted | Decision 9 |
| The rearrange route leaves a removed block out of the check of the moved blocks and writes the removal in the same transaction | Plan review finding 1; a block must go back into the slot of the block the suggestion created |

## 17 October 2026: the grid, the edit lock and locks (task 5.4c-1)

Plan approved on pull request #135 with corrections 1 to 5; decisions 1 to 12 confirmed there, 13 removed by correction 2. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** 5.4c is split into 5.4c-1 (the edit lock and locks), 5.4c-2 (undo and redo) and 5.4c-3 (double lessons and mixed blocks) | Decision 1; three write paths of their own |
| The edit lock covers every write of the draft, steps 1 to 7, publish and generation included (From lines on 5.5a and 5.11), and is held by an account | Decision 2, review correction 5; `06`: "one edits at a time" |
| Activity is a write, or the holder's "still here" after a key or pointer, at most once a minute; a reader's activity never takes the lock | Decision 3, review correction 1 |
| Take over only once the lock is free (5 minutes); no release route; the first write takes a free lock; the earlier holder's next write is refused `draft_edit_locked` | Decisions 4 and 5 |
| The notice goes on a takeover from another account only, to that account | Decision 6 |
| Locks are per draft, not copied, and a block lock goes with its block (named in the removal's audit entry) | Decision 7 |
| A lock binds Regenerate, "Suggest a place" and the rearrange route (`pattern_locked`); a hand move, room change or removal of a locked lesson is allowed; no suggestion moves a block into a locked day | Decision 8 |
| A teacher lock covers that teacher's or vacancy's rows of this draft; load edits are not refused by locks | Decisions 9 and 10 |
| Viewers read the draft again after a key or pointer, at most every 30 seconds, never on a timer alone | Decision 11 with `.claude/rules/web.md` ("Nothing calls the API on a timer without asking") |
| Audit kinds `timetable_version.edit_lock` (each change of holder), `timetable_lock.create`, `timetable_lock.delete` | Decision 12 |
| The holder is named as the audit log names actors (`audit_names`); an account with no staff record by its login | Found in the build: the notice needs a name |

## 17 October 2026: the grid, "Suggest a place" (task 5.4b-2b)

Plan approved on pull request #134 with corrections 1 to 3; decisions 1 to 10 confirmed there (4 changed by correction 1). Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| "Suggest a place" is on a lesson of the class board and on a "To place" entry, and moves or places the whole block | Decision 1; `edge/timetable`, Structure: blocks are placed and moved whole |
| Best free slots: no blocked result, then fewest warnings (week counts left out), then slots that keep their rooms, then weekday and slot; at most 5. Step 5's weights are the solver's | Decision 2; `06` says "best" without a measure |
| Rearrangements only when no slot is free, at most 3, fewer blocks first; at most three blocks change, the selected one included | Decision 3; `06`, "or a swap of two or three lessons" |
| The search runs in the browser on the grid's facts, bounded only by a budget of 2,000 checks; every trial is the route's check (`checkCandidates` of the changed blocks among `checkedPlacements`), and the route checks again | Decision 4, review correction 1; `14`, One rule engine |
| A suggestion changes a room only through `roomChoices` of the rule engine, when room rules alone block the slot, each lesson's room chosen with the earlier choices in place | Decision 5, plan review findings 3 to 5 |
| A busy-elsewhere lesson and a block holding a pin of step 5 are never moved by a suggestion; the grid answer carries `pins`. The pin rule belongs to the search only: the rearrange route accepts a pinned block as the move route does, since a person may move a pinned lesson by hand (5.4a) | Decisions 6 and 9; permission review, should-fix 2 |
| Route `POST …/pattern/rearrange`, one transaction, clash constraints deferred; audit `pattern_block.rearrange` per moved block and `pattern_block.create` for a new one, each with `rearrangedWith`; a change at its own slot and rooms writes nothing | Decision 7, plan review findings 10 and 11 |
| Undo of a suggestion and locks are 5.4c's (From 5.4b-2b line) | Decision 8 |
| The search lives in `packages/timetable-rules`, not in `cellStatus`; a web test holds the two equal; `newBlockOf` moved into the engine as the one builder of a new block | Decision 10, review correction 2 |

## 17 October 2026: the grid, "to place", the room picker and the conflict panel (task 5.4b-2a)

Plan approved on pull request #133 with corrections 1 to 3; decisions 1 to 12 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** 5.4b-2 is split into 5.4b-2a ("to place", the room picker, the conflict panel and step 7's mark) and 5.4b-2b ("Suggest a place" and a route that applies a rearrangement of up to three blocks) | Decision 1; the suggestion is a search and a write route of its own |
| "To place" lists one entry per block with a row short of its load, by class, the chosen class first; placed by drag or a Place button with the slot list; a half of a mixed split is listed and not placeable | Decisions 2 and 11 of the plan review; `06`, Editing in the grid, bullets 1 and 2 |
| The "to place" entries of a reopened old version come with 5.8 (a copy takes the load and the pins only) | Decision 3 |
| A room is offered and saved when `roomChange` of the rule engine adds no blocked result the lesson did not already have; best fit is the row's room, its room type, the main classroom, then the smallest spare capacity, then rooms with a warning, then name; the picker never clears a room | Decisions 4 and 5; one function for the picker and the route |
| The numbers of a result have keys of their own (`timetable.conflict.<rule>`) with plural forms | Decision 6 |
| Step 7 is ready with no blocked result; its mark is computed by `GET …/readiness` only (`TimetablePattern.readiness`), never in `readinessOf` or the gate of generation | Decision 7 |
| "Show" opens the class board of the first lesson of this branch and focuses its tile; a result with no lesson opens its row's "To place" entry; another branch's lesson is named by its branch, with no button | Decision 8 |
| A teacher is changed from the tile by a link to the row in step 2; the load route checks the row's placed lessons with the new teacher by the rule engine (`teacherChangeBlocked`, `pattern_blocked`) and maps `pattern_entries_teacher_excl` to `pattern_clash` | Decision 9, review correction 1 |
| The room route is `POST …/pattern/:blockId/room` with `{ lessonId, roomId }`, audit `pattern_entry.room`; it and the place route run in the refusal map of the pattern | Decision 10, review correction 2 |
| `PatternFactsData.rooms` holds every room of the branch with its type; rows carry `roomType` | Decision 12 |

## 17 October 2026: the grid, other branches and the views (task 5.4b-1)

Plan approved on pull request #132 with corrections 1 to 3; decisions 1 to 12 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** 5.4b is split into 5.4b-1 (other branches and the views) and 5.4b-2 (the "to place" and conflict panels) | Decision 1; the cross-branch facts change what every pattern check returns |
| **Look first.** A reader of a branch's grid gets, for the teachers of its load, the weekday and times of their lessons in other branches' published patterns and drafts, with the branch id and name, and nothing else of the other branch | Decision 2; `06`, Busy elsewhere and Two drafts at once |
| **Look first.** `SECURITY_DEFINER_FUNCTIONS` is widened by `timetable_busy_elsewhere` and `timetable_drafts_elsewhere` (0071), on the model of `teacher_load_elsewhere` | Decision 3; the row filter hides other branches' patterns |
| Busy elsewhere is the other branch's published version in force on the draft's reading date, of the year that holds it; later versions and one-day changes are checked by date at publish (5.5a's From 5.4b-1 line) | Decision 4 |
| The drafts counted for `other_draft` start on or before this draft's end and belong to a year that does not end before its reading date | Decision 5 |
| Teacher and room views always use the clock axis; they are read only, with a button to the class board | Decisions 6 and 9 |
| Grey busy-elsewhere blocks are in the teacher view; on the class board they show as a blocked slot while moving | Decision 7 |
| No time-zone conversion; `branchIds` stays this branch | Decisions 8 and 12; `branches.time_zone` is not writable, and `branchIds` is read only for placements that are not fixed |
| Busy-elsewhere lessons count in a teacher's week and day load; a vacancy is never busy elsewhere | Decisions 10 and 11 |
| A Tutor lesson elsewhere (`tutor_lesson` of 0071) makes the load step list a Tutor whose pin meets it; a pin conflict carries `elsewhere` | Found in the build: the From 5.3b-2 line ("a Tutor of classes in two branches is listed too"), without naming the other branch's class |
| Every check of the pattern passes `checkedPlacements` (the blocks and the busy-elsewhere lessons) | Found in the build: one helper for the grid, the routes and the pins' check |
| A busy-elsewhere or other-draft lesson carries the other branch's pattern entry id (`busyElsewhere[].id`, `otherDrafts[].id`, and in `lessonIds` of results) | Permission review, should-fix 1: a result must name its lessons by a stable id; the id is not personal data, and a move, swap or remove naming it answers 404 (tested) |

## 17 October 2026: the grid, board and drag (task 5.4a)

Plan approved on pull request #130 with corrections 1 to 3; decisions 1 to 17 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** New dependency `@atlaskit/pragmatic-drag-and-drop` 4.0.0 (Apache-2.0, Atlassian), the core package only | Decision 1; `13`, Timetable board |
| **Look first.** The grid answer carries the engine's input as data (`PatternFactsData`: member ids with no names, availability, profiles, rooms of the branch); one converter, `patternModel`, builds `Facts` in the browser and on the server | Decision 2; `14`, Timetable, One rule engine |
| **Look first.** Busy-elsewhere lessons of other branches and `other_draft` are not in the facts yet; 5.4b adds them to `pattern-facts.ts` | Decision 12 of the plan (3 of the review); departs for now from `.claude/rules/timetable.md`, "counts all branches", as 5.3b-2 decision 1 |
| The board shows one class at a time on its own slots; a block occupies a cell by clock time, a group block on the board of every class it draws from | Decision 3, review correction 2 |
| Only blocked results refuse; warnings are saved and shown; a write checks the changed blocks' lessons only (`checkCandidates`) | Decisions 4 and 5 |
| More lessons than the load is the `load_mismatch` warning, never a refusal; the add form lists rows with lessons left first | Decision 6; `06`, Rules, last row |
| A new lesson takes its row's room, else a class row's main classroom, else none; the room picker and "Suggest a place" are 5.4b's | Decision 7 |
| A group row is placed and moved with its whole block; a half of a mixed split is refused `pattern_mixed_block` (5.4c); a two-grade row takes its lowest grade's slot and the engine names `two_grade_slot` | Decisions 8 and 9 |
| No route writes a double pair; pins are not checked against placed lessons; step 7 opens for any draft and its mark comes with the conflict panel; undo and the edit lock are 5.4c; two writes are kept apart by `lockDraft` | Decisions 10 to 14 |
| The 0.2-second target is measured at the real size by 5.12; a published or archived version is read only | Decisions 15 and 16 |
| The clash constraints map to `pattern_clash`, a deadlock to `timetable_busy`; a swap defers the clash constraints to the commit | Decision 17 |
| A slot position past the day, or a day with no lessons, is `pattern_no_slot`; a break is placed for the engine, which names `break_slot` | Found in the build: as pins read a slot (`slotAt`), so the grid and the API give the same answer |
| `teacher_week_load` and `load_mismatch` are left out of a slot's status while dragging (`WEEK_COUNT_RULES`); they still show on the board and are saved | Found in the build: a row short of its load would warn on every slot alike |
| The generated test of `14` runs 200 random sequences of up to 30 places, moves and swaps through `blockPlacements` and `checkCandidates` | Review correction 1 |
| The Move button of a tile lists every slot with the drag's marks, by keyboard and tap; at phone width the grid is view only | Review correction 3; `12`, Devices |

## 17 October 2026: the draft builder, step 5: pinned lessons (task 5.3b-2)

Plan approved on pull request #129 with corrections 1 to 3; decisions 1 to 11 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** The pins are checked among themselves in one branch for now; busy-elsewhere lessons of other branches and the travel time around them join through `pattern-facts.ts` in 5.4b (From lines on 5.4b, 5.10, 5.11). Only blocked results stop step 5 | Decision 1; departs for now from `.claude/rules/timetable.md` ("counts all branches"); `edge/timetable`, Generator and editing |
| A pin is a load row, a weekday and a slot position (breaks counted, as `pattern_blocks.slot_position`), with no room and no time of its own; its room is the row's one room, its time read from the template in force on each check | Decision 2; `06`, Model, Slot |
| A create refuses only a wrong row (404), a duplicate (`pin_taken`), a block over its lessons per week (`pin_over_load`) and a half of a mixed split (`pin_mixed_block`); a clash and a break are saved and listed with the engine's rule, a weekday with no lessons or a position past the day's end as `pin_no_slot` | Decision 3 with review correction 1 |
| A pin of a group row holds its whole block in that slot; a mixed split is not pinned here (5.4c) | Decision 4; `edge/timetable`, Structure |
| A block has at most as many distinct pinned slots, over all its rows, as its lessons per week; a later load edit that leaves more is a problem of step 5 | Decision 5 |
| Pins are added and removed under `timetable` `edit` | Decision 6 |
| `rules_confirmed` holds the sorted pin ids under `pins`; the confirm carries the pins shown and is refused `pins_changed` otherwise; a confirmation with no `pins` reads as none | Decision 7 |
| The Tutor of two classes is listed in the load step from the same `teacher_double` result, which blocks only step 5 | Decision 8 |
| A copy takes the pins of the rows it takes, listed in its audit entry, not the confirmation | Decision 9 |
| A two-grade group's pin takes its time from the lowest grade's template | Decision 10 |
| `timetable_pins_slot_key` includes `branch_id`; `teaching_load_rows_version_key` is added in one step | Decision 11 |
| The pattern facts pass the load rows, so `load_mismatch` warns for a row not fully pinned and blocks nothing | Review correction 3 |
| The 5.3b-1 confirm tests send `{ weights, pins }` and expect the pins in the answer and the stored confirmation; every 5.3b-1 assertion is kept | Review correction 2: the requirement grew |
| The table of step 1 in the readiness answer carries the slots of each template (position, kind, times), so the form offers only the lesson slots of a row's grades | Found in the build: the form needs the positions; the two-grade filter is `sharedLessonSlots` of the rule engine |
| The add form is in the step 5 panel, not in a side panel | Found in the build: the weights form of step 5 sits there too; a pin has three fields |
| A pin id of another branch or an unknown one in the confirm body answers 409 `pins_changed`, not 404: the ids are a snapshot compared with the stored pins, never looked up | Permission review, should-fix 2 |
| The row delete and the copy keep their 404 tests with pinned rows in both branches, `timetable_pins` in their `rowsOf` | Permission review, must-fix 1 (`.claude/rules/api.md`, the widening rule) |

## 17 October 2026: the draft builder, step 5: rules, weights and the gate (task 5.3b-1)

Plan approved on pull request #128 with corrections 1 and 2; decisions 1 to 9 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Task 5.3b split into 5.3b-1 (step 5's fixed rules, weights, confirmation and the gate) and 5.3b-2 (pinned lessons, their check on their own, the Tutor-of-two-classes list, the pins in the confirmation), with its own Done when | Decision 1: pins need the engine's whole pattern input read from the database, which no API code builds yet |
| Step 5 is ready while the weights confirmed equal the weights stored now; only the confirmation is stored (`rules_confirmed`) | Decision 2; `06`, step 5: "Confirmed"; as 5.3a decision 3 |
| A weight is a whole number from 0 (not used) to 10, starting at 5 | Decision 3; `06` names no scale |
| The fixed rules shown are `FIXED_RULES`: the blocked codes a weekly pattern can break, less the dated-only, one-day-change and exam-only codes; each text states the rule in the words of its row in `06`, Rules, with no numbers | Decision 4 and review correction 2 |
| A copy takes its source's weights, not their confirmation | Decision 5 |
| The gate is `requireReady` (409 `draft_not_ready`, one detail per step) and step 6 kept closed; 5.11's run route calls it first | Decision 6 |
| The weights and the confirm are draft writes under `timetable` `edit`, audited, none when nothing changes | Decision 7 |
| Eight `weight_<code>` columns of `timetable_versions` (0069), each with a range check, and `rules_confirmed`, guarded by a new update trigger running `timetable_versions_draft()`; a new version may insert the weights, never a confirmation | Decision 8 |
| Confirm carries the weights the person sees and is refused with `preferences_changed` when the stored ones differ; the page keeps Confirm off while a weight is not saved | Decision 9 |
| The 5.3a readiness assertions confirm step 5 in their setup and still assert each of steps 1 to 4 ready on its own | Review correction 1: the requirement grew, the test is not weakened |
| `requireReady` locks the draft as a write does (`lockDraft`), so no save commits between the check and the run, and refuses a version that is not a draft | Permission review, should-fix 1 |
| A stored confirmation is read loosely: a preference added after it counts as changed, never as a fault | Permission review, should-fix 2 |

## 17 October 2026: the draft builder, steps 1 to 4 (task 5.3a)

Plan approved on pull request #127 with corrections 1 to 3; decisions 1 to 13 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Task 5.3 split into 5.3a (the builder screen, steps 1 to 4, the readiness route) and 5.3b (step 5, pins, the Tutor-of-two-classes list, the gate); each From line moved to the part that builds it | Decision 1; the split rule of the build plan |
| **Look first.** One reading of the dates for a draft, the engine's (`placement.ts`): templates weekday by weekday on each weekday's first date on or after the later of the start date and today (`weekDaysOf`), in step 1, step 2 and the totals; availability from the one entry in force on that date, for every weekday, in step 3 and the totals (changes 3.4b decision 7, which read hours weekday by weekday). Proposed `/spec-change` for `06`, Building a timetable, step 1: "… and confirms the day templates of each weekday in force on that weekday's first date on or after the start date, per grade range where they differ, from the table in School setup." | Decision 2 with review correction 2; `06`, Rules, availability row |
| Readiness is computed on each read; only the confirmed table is stored (`timetable_versions.templates_confirmed`, 0068, guarded by `timetable_versions_draft()`), compared on template id and the kind, start and end of each slot, never on its dates or the template's name | Decision 3 with review correction 1; `CLAUDE.md`, State from stored moments |
| The table has the working weekdays and the grades of the year's active classes; every cell needs a template | Decision 4 |
| Step 1 is not ready while the start date is before today | Decision 5 |
| A coming quarter: one of the draft's year whose first day is on or after today, offered by the web only | Decision 6 |
| Step 2: no row problem but the room problems, at least one row, the rows a copy left dismissed, each class's lessons within its lesson slots | Decisions 7 to 9 |
| Step 3: every teacher and vacancy has an hours entry in force and no more lessons than free slots in the branch; contract, daily maximum and other branches shown only | Decision 10 |
| Step 4: every row's room type has a room of the branch that is not closed (under repair counts); no row names a closed room (`load_room_closed` moves from step 2 to step 4); classes with no main classroom listed, not blocking | Decision 11 |
| The confirm is a draft write under `timetable` `edit`, one audit entry per change of the stored table; readiness is read under `timetable` `view` | Decision 12 |
| The builder is its own page; the load page and the staff record stay the places of their edits, linked from steps 2 and 3 | Decision 13 |
| The checklist marks are one component, `StatusMark` (`apps/web/src/components/status-mark.tsx`), used by the setup checklist and the builder | Spec review of the plan, should-fix 8 |

## 17 October 2026: Tutor lessons follow the Tutor (task 3.6c-2)

Plan approved on pull request #125 with corrections 1 to 6; every decision confirmed there. Flagged on issue #42. 3.4a decision 2 ("a Tutor of the class, or anyone with the profile row, takes a Tutor subject") no longer applies.

| Decision | Reason |
| --- | --- |
| **Look first.** A Tutor row (a Tutor subject on a class row) holds the class's Tutor and nobody else; the database refuses any other teacher (`load_tutor_row_teacher`) and a class with no Tutor (`load_no_tutor`); a group row of a Tutor subject keeps the profile rule. The tests of 3.4a's rule are turned round, none removed without a replacement: `load.test.ts` (the Tutor cases), `check.test.ts` (the Tutor takes it, a substitute needs the profile), `teaching-load.database.test.ts` (`load_teacher_subject` becomes `load_no_tutor` or `load_tutor_row_teacher`; the main Tutor while an acting one is set; a passed start date; a row written by 3.4a's rule), `teaching-load.test.ts` (the teacher list answers the Tutor alone; no create or edit takes a teacher), `department-moves` tests (rows of another teacher written as 3.4a let them be, `LoadKit.rowAsBefore`; the edit of a row to the Tutor is refused, the follow takes its place in the same-moment test) | Decision 1, correction 1; answer 2 of 15 October |
| **Look first.** Migration 0067 replaces the row trigger of 0055 and `department_move_loads` of 0057 (neither edited); the dated lessons follow by one application function, `followTutors`, called by every path that changes `class_tutors` (give, end, archive, role end and its taking back, `left` and its taking back), each naming what it moved in its own audit entry (`tutorLessons`) | Decision 2 |
| **Look first.** One reading of the Tutor: `tutorAt` (the acting row in force, else the main one); a lesson at its start, a version at the last moment of the later of its start date and today; `class_tutor_on` is the same in SQL | Decision 3 |
| **Look first.** A Tutor lesson that follows a change goes to "needs a teacher" when the Tutor is elsewhere at that time or the travel time between branches is not kept (`checkTeacherTime` of the rule engine); availability, profile and contract load are not read | Decision 4; answer 1 of 16 October |
| **Look first.** Drafts follow: their Tutor rows are re-pointed under a savepoint each; an entry the Tutor holds the time of in the draft is removed; a row the database refuses stays and is listed | Decision 5 |
| **Look first.** Published versions keep their rows and entries; only their dated lessons follow. Proposed `/spec-change` of `edge/timetable`, the Homework slot row, added sentence: "A Tutor change is not a permanent change of the timetable: no version is prepared or published; the class's dated Tutor lessons from the change take the Tutor in force at their start, and a published version's load keeps the Tutor of its start date." | Decision 6, correction 3; `06`, "The live timetable is never edited in place" |
| **Look first.** A change of Tutor dated today does not move today's Tutor lessons; the follow starts at 00:00 of tomorrow at the earliest. Proposed `/spec-change` of `edge/timetable`, the Homework slot row: "...go to the new Tutor from that date, from tomorrow at the earliest (today's lessons change by a one-day change), and held lessons keep the person who held them." | Decision 7 (12 of the plan); `06`, "The past is closed" |
| **Look first.** `teacher_claims_elsewhere` (SECURITY DEFINER, on the allow-list) gives the start, end and branch of a teacher's lessons and exams in every branch, for a teacher linked to the branch of the request; the preview names only the branch of a clash elsewhere | Decision 8 (13 of the plan), correction 4 |
| Cancelled Tutor lessons are not changed; lessons are taken in the order of `starts_at, id`; no notice yet (5.5c's line with the "changed" mark); one preview route, for the give | Decisions 9 to 12 |
| An edit of a load row sends `teacherId: null` to keep its teacher, for every row; `load_teacher_needed` refuses only a new row without one | Build: the form cannot know a Tutor row before the server answers |
| The preview gives school dates and clock times in branch time (`date`, `start`, `end`), not moments | Build: the browser does not know the branch's time zone |
| `department_move_loads` compares the Tutor with `is not distinct from` | Build: the department-move tests found that a class with no Tutor left its rows out |
| The draft follow locks the rows' subjects FOR KEY SHARE before the re-point, as a load write does | Build; 3.4c decision 6 |

## 16 October 2026: the year result and no extra lessons (task 3.6c-1)

Plan approved on pull request #124 with corrections 1 and 2; decisions 1 to 10 confirmed there. Flagged on issue #42. The earlier entries of 4.1 to 4.3 on extra lessons and their "counts for attendance" switch no longer apply.

| Decision | Reason |
| --- | --- |
| **Look first.** 3.6c is split in two: 3.6c-1 (the year result, no extra lessons) and 3.6c-2 (Tutor lessons follow the Tutor) | Decision 1; the Tutor answer reaches 3.1a, 3.4a and 5.1a with a preview and a clash path of its own |
| **Look first.** The year result rounds each quarter that is a number with the module's own `roundHalfUp` (the quarter's `shown`), means the whole numbers exactly and rounds once more; quarters that are not numbers are left out with `basedOn` | Decision 2; `07` rules 10 and 11, L210 |
| **Look first.** The calc tests of the extra lesson and its switch, the year tests of 49.475, 66.45 and "not in the system", the two database tests of extra blocks and `lesson_blocks_source_check` are removed or turned round; four guard tests got fixtures that still reach their guard first | Decision 3; the requirement changed (answer 1, L210) |
| **Look first.** Migration 0066 drops `lesson_blocks.kind`, its check, `lesson_blocks_source_check` and `lessons_source_check`, and makes the version, pattern block, load row and pattern entry of every dated lesson `not null`; nothing is deleted | Decision 4; a dated lesson only comes from a pattern (`06`, "No extra lessons") |
| `CALC_VERSION` 1 → 2; the reference journal `year-50-50-49-50.json` (a sample) replaces `year-49-475.json` | Decisions 5 and 6 |
| A database test writes a dated block on a version of its own with `LessonsKit.source`: draft for its rows, pattern block and entries, then published; a fixture teacher per load row, entries without rooms | Decision 7; `pattern_rows_draft` and `lesson_block_version` fix the order |
| Merged 0058 keeps its comments; stored-record format 1 loses `countsForAttendance` in place, and a stored lesson carrying it is refused (`record_shape`) | Decisions 8 and 10; no format-1 record is stored yet |

## 16 October 2026: the year's dates and the return in August (task 3.6b-2)

Plan approved on pull request #120 with corrections 1 to 5; decisions 1 to 12 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** A stay that runs to the year's last day is not in the way of a shorter year and follows the new last day; a longer year carries it to the new last day. Only a stay that starts in the days cut off, or ends in them (or on their first day) by a dated leaving or move, is in the way. Proposed `/spec-change` of "The academic year is extended or shortened": "…or a class or group stay that starts or ends in them; a stay that runs to the last day of the year ends on the new last day, and a longer year carries it to the new last day." | Decision 1; every row with days ends at the year's end + 1 (3.1b), so the literal reading would refuse every shortening |
| **Look first.** `academic_years_has_members` (0045) dropped, replaced by `academic_years_dates_guard` and `academic_years_dates_follow`; the route and database tests that expected it changed with L128 | Decision 2 |
| **Look first.** `class_memberships_only_shrink` and `group_memberships_only_shrink` (0062) let a row move its own end in the exact shape of the follow: depth 2, mark `app.year_follow` with the year id and both ends, the year's end as it now stands, `valid_until` moving only where it equalled `own_until`, nothing else changing | Decision 3, correction 2; a longer year keeps its students in their classes |
| **Look first.** A cancelled return or restore empties the future active row and writes a row of the earlier status from its date with cause `cancel`; the planners and the History tab read the two as one stay | Decision 4; status rows only shrink |
| A longer year keeps the year's own refusals (closed, overlap, order, quarters, go-live date, calendar entries) | Decision 5 |
| An earlier start changes no stay | Decision 6 |
| "The next planned year" is the branch's earliest planned year starting after today; its first day is the only future date a return or restore may take | Decision 7 |
| A scheduled return or restore is cancelled until its date by the holders of the route that wrote it (a restore: the Super Admin), with the student's version; the cancel gives the grade back from the audit entry and keeps the contract row (reused by a later return with the same number) | Decision 8 |
| The refusal list holds at most 50 lines and the count of the rest; the code is `year_cut_holds`, `academic_year_has_members` is gone | Decisions 9 and 10 |
| Lessons, exams, marks and attendance in the days cut off are handed to 5.6b and 8.1; the handbook pages to 3.7; a "From 3.6b-2" line on 9.5b | Decisions 11 and 12 |
| The audit entry `academic_year.edit` gains `rowsFollowed` (table, id, old and new ends); `student.return_cancelled` is a new people entry using existing keys; no key is added to the pinned list | Correction 3 (checked: none needed) |

## 16 October 2026: the same-person mark by phone, one phone for one adult (task 3.6b-1)

Plan approved on pull request #119 with corrections 1 to 5; decisions 1 to 9 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** 3.6b split in 3.6b-1 (L81, the answer of 16 October), 3.6b-2 (L128, L170) and 3.6b-3 (L195) | Decision 1 |
| **Look first.** A new relative with the phone of a staff member of another branch is marked, keeps the typed name and email, and is shown as "a staff member of another branch" to every reader of the relative, unnamed | Decision 2; `edge/close-relatives` is silent on another branch |
| **Look first.** The stored mark (`relatives.staff_id`, `relatives_staff_idx`, `relatives_same_person_check`, the staff half of `relatives_merged_empty_check`) dropped in 0063; the mark is read from the phones; the tests that pinned the hand mark changed with the requirement | Decision 3; L81 |
| **Look first.** `staff_phone_idx`: a staff phone is unique, left and archived records included; 0063 stops with the ids on a phone held twice | Decision 4; `edge/people-roles-accounts`, re-hire row |
| **Look first.** "Different person, the number has a new owner" is refused `phone_is_staff` for a staff member's current phone | Decision 5; the answer of 16 October |
| **Look first.** A new staff member with a parent's main phone takes the parent's email when none is typed; the names are typed | Decision 6 |
| **Look first.** The parent's email that a new staff member takes (decision 6) is read on the staff panel as a staff email, plainly, where the Principal reads a relative's email behind a logged show | Permission review of the build; the same person's own address, the staff record's field groups apply to it |
| **Look first.** `staff_phone_elsewhere(text)`, a SECURITY DEFINER boolean, tells the check before Save and the phone match that a staff record of another branch holds a phone; `staff_duplicate_elsewhere` keeps its signature and no longer reads the phone | Built; correction 2 |
| An edit that makes two existing records equal on the phone changes the mark only | Decision 7 |
| The main phone only is compared; a relative with no phone, a merged record and a student's phone never | Decision 8 |
| The staff page asks before saving a staff member whose phone is a parent's, naming the parent | Built; decision 6 |
| The Parent panel's choices for a taken phone offer no "new owner" when the phone is also a staff member's, with the line to correct the staff record first, as the student form and Add relative do | Spec review of the build; the answer of 16 October |
| `staff_phone_taken` says "Check the number." only: the record is named under the phone field in the branch, and a record of another branch cannot be opened | Spec review of the build; `.claude/rules/web.md`, a text true on every path |
| The Same person section has no line under it: the title, the name and the staff number say it | Spec review of the build; `.claude/rules/web.md`, Text on screens |
| The handbook pages come with 3.7 ("From 3.6b-1" line) | Decision 9 |

## 16 October 2026: who sees what, the owner's answers of 15 October (task 3.6a)

Plan approved on pull request #118 with corrections 1 to 4; decisions 1 to 16 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** The Head Teachers list names a holder whose staff record is in another branch through the allow-listed `audit_names` (first and last name only, for the holders the list answers); no new definer, no migration | Decisions 1 and 3; L32 |
| **Look first.** The tests that pinned the old answers changed with the requirement (head teachers 883, students 649/663/894, search 691, exports 188–205 and 525–540, tutor scope 337, group members 595, relatives 490, statuses 461, the web Parents and Ctrl+K tests); none removed | Decision 2 |
| **Look first.** A Teacher's students are the members, in force or planned, of the classes and groups of the teacher's rows in the **published** version in force of each year not closed, on `greatest(today, the year's start)`, latest start, ties by number; a draft never counts; until 5.5 publishes a Teacher sees nobody. Groups are read from every group row with days not ended (correction 1) | Decision 4; L48 |
| **Look first.** Widened: the Teacher `students` view; the Head Tutor `student_identity`, `student_financial` view and `students` export; the Head Teacher and the Senior Head Teacher `students` export; the Tutor the Contact columns of own class | Decision 5; L48, L59, L136 |
| **Look first.** `student_diagnostic` is a new area for the diagnostic score (view: Super Admin, Principal, Academic VP, Head Tutor, Head Teacher, Senior Head Teacher, Tutor of own class); no route declares it, not in `CLASS_SCOPED_AREAS` | Decision 6; L50 |
| **Look first.** The Parents list's phone search for every reader of `relatives`, the Principal included | Decision 7; the 3.6a line of the build plan |
| The Head Teachers read the score of every student they read; their file is Basic only, never the score; the Principal's file gains the score as its own group; a Tutor's file holds Basic, Contact (relatives included) and the score | Decisions 8 to 11 |
| A Teacher alone lists the taught rows only and is refused the "No class" counter and the identity show; a Teacher-only reader gets Basic, the groups, the status today and the start date, nothing else of the record | Decisions 12 and 14, correction 3 |
| Ctrl+K asks no class, group or staff search of a Teacher | Decision 13 |
| Export groups per role and per row: a Tutor who is also a Head Teacher writes Contact and the score in own-class rows only | Decision 15 |
| The handbook pages come with 3.7 ("From 3.6a" line) | Decision 16 |
| Built: the audit entry of a student file names the columns withheld from some rows (`partly`), so the log says what a Tutor who is also a Head Teacher left out beyond own class | Spec review of the build, must-fix 2; decision 15 |
| Built: the list answers `taughtOnly`, which chooses the Teacher's empty state ("Your students are those of the classes and groups you teach in the published timetable. None is given to you yet."), never the role shown | Spec review of the build, should-fix 1 |
| Built: the Parents list answers `searchesPhone: true` to every reader the route lets in; the refusal left in the route could not be reached | Permission review of the build, should-fix 1 |

## 16 October 2026: one stay in a class and the History tab (task 3.5c)

Plan approved on pull request #117 with corrections 1 to 7; decisions 1 to 5 marked Look first and confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** 3.1b decision 8 is reversed: a take-back (the cancel or undo of a leaving, the cancel, change or undo of a class or group move) grows the row it cut back, to its own end, to a leaving that stands, or to the move that wrote the next row given back; both `only_shrink` triggers and the end triggers of 0051, 0053, 0054 are replaced with paths added, none taken away; the days given back pass every check of an insert at the commit (`*_regained`) | Issue #105, H36: "a cancel or an undo gives the stay back as it was before, not as a new planned stay" |
| **Look first.** `class_memberships_one_stay` and `group_memberships_one_stay`: two adjoining rows of one student in one class or group cannot be stored (deferred exclusion on closed ranges); the end `joined` with `joined_into_id` and `joined_xact`; a row emptied `joined` is held by the row it names at the commit (correction 3) | The done-when; H36, "one stay everywhere" |
| **Look first.** The tests that pinned split rows (`class-transfers`, `group-transfers`, `class-groups`, `class-members`, `group-members`, `student-statuses`, `student-merges`, `membership-plan`, `student-moves.database`) now assert the one row; the grants tests read `own_until` as refused by the shrink rule (it has an update grant for the join) | The requirement changed with H36 |
| **Look first.** Migration 0062 joined the rows already split on the test site, pair by pair, with an entry `student.stays_joined` per student and branch, and filled `replaces_move_id` from the entries of the changes | H36, "the stays already split on the test site are joined" |
| **Look first.** A join changes no day: it passes in a closed year and an archived class and runs no seat check | The merge and the migration join rows of past years |
| A changed move is a cancel plus a new move naming it (`replaces_move_id`, insert only for the application); History draws the chain as one move with its changes | H34; `effective_on` is never updated |
| A return after a gap of a day or more is a new stay | `return_too_early` keeps the gap; the journal's "one row" is 8.6's |
| `studentVersion` (one function, five readers and checkers) also counts the class moves taken back | "Student changed, reload" now that a cancel writes no class row (correction 1) |
| History: `until` is the first day after on every line; a stay is `null` while it has no end and reaches past today; a stay that begins after today reads "from <date>" | H35; correction 4 |
| Group stays are History lines, one per stay | H36, "the same for group stays" |
| `stay_continues` answers a same-day move back into the class or group left | Every constraint maps to a code |
| Status rows keep their shape | H34 to H36 name class and group stays |
| (Build) A grown row ends at a leaving only while that leaving stands (`membership_leaving_stands`) | A grow must not name a leaving taken back |
| **Look first.** (Build) An automatic group row that ends where a row given back of the same group begins takes that row's days (`joinCoverRows`): the days before a planned group row a leaving emptied and that row are one stay. Its consequence: a planned placement by a person (no review tag) comes back inside an automatic row tagged "placed automatically, review", and the placement row stays emptied | `group_memberships_one_stay`; the 3.2c fill met the planned row; spec review of the build, should-fix 2 |
| (Build) The carry of a merge moves a row ended `withdrawn`, `undone` or `joined` to the kept record too, nothing else of it changing | A merge of a record with an emptied row was refused by the shrink rule |
| (Build) 0062 runs `set constraints all immediate` before it adds the two constraints | The joins left deferred checks pending; found by the migration test |
| (Spec review of the build, must-fix 1) A join holds the row it grows to exactly the joined rows' days: at the commit the row ends where the joined row ended, with its end and own end, or where a further row joined into it in this transaction ends (a chain); the commit check of the days given back skips only the update of the join itself | A join waived every check while some row was joined into it in the transaction, so the row could take any end |
| (Spec review of the build, must-fix 2) A row of the same class or group that a cancel or an undo wrote before 0062 (cause `cancel` or `undo`) continues the stay: a take-back grows the row before it over its days and leaves it as it is (`continuesStay`); 0062 joins only rows that hold days, so such an emptied row stays | Code before 0062 left such rows emptied by a later leaving or move; their take-back answered 500 |
| (Spec review of the build, must-fix 4) The commit check of the days given back keeps the student's branch check of the insert guard although no legal path reaches it (status rows cannot change before a move to another branch, and the rows a move cut are final); the leaving a row names is checked by the shrink rule before the write, so the commit check no longer repeats it | A check no path reaches has no test; one the shrink rule makes first is dead code |
| (Spec review of the build, should-fix 3) A group move taken back whose cut row no longer ends where the target began names the days not given back (`notGiven`) in its audit entry | Every path that cannot give rows back names them |
| (Permission review of the build) `student_moves_replaces_idx` is on `(branch_id, replaces_move_id)`; `student_rows_elsewhere` answers no `ownUntil`; its keys are pinned by a test | `.claude/rules/database.md`, unique constraints on a branch table; nothing answered that History does not read |

## 15 October 2026: the hand-test fixes of forms, refusals and messages (task 3.5b)

Plan approved on pull request #116 with correction 1; decisions 1 to 11 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Changing a scheduled class move with the same class left and the same target does not ask the language question again; the classes are compared, not their languages. Proposed `/spec-change` of `edge/students-classes-groups`, row "A transfer or a leaving is set for a future date": "Changing only the date of a scheduled transfer, with the same class left and the same target, does not ask again about a different language of instruction." | Decision 1; H27 |
| **Look first.** A Save pressed before the relative's phone lookup answered waits for it and links the person found with the default "same person"; a failed lookup does not hold the Save, and the server's `relative_phone_exists` stays the guard | Decision 2; H26; `edge/close-relatives`, row 2 |
| **Look first.** Ctrl+K finds relatives by name and main phone, and a student by a live-linked relative's main phone, for the readers of `relatives` in the branch of the request (Super Admin, Principal, Academic Vice Principal); extra phones are not searched; the Parents list's phone search is unchanged | Decision 3; H33; `edge/people-roles-accounts`, the Ctrl+K row; L157 |
| **Look first.** An Uzbek phone is "+998" and exactly nine digits (a number of another country "+" and 7 to 15 digits); nine digits alone are Uzbek, "00" is "+", spaces, dashes, brackets and dots are dropped, and a number pasted after the prefilled "+998 " is read; a bare "+998" is an empty field. A stored Uzbek number of another length is refused with the format text at its next edit | Decision 7, confirmed as a changed decision (pull request #53 decision 11, task 2.5a decision 9); H25 |
| The seats of the Add student choice come from `GET /api/classes/seats` (`students` `create`); a full class stays selectable with its mark; `fullFrom` is the first day of the stay's days (`[from, until)`) with fewer free seats than the students placed, read with `class_members_peak`; the class move checks seats before its write | Decision 4 and correction 1; H24 |
| Archive is off from the members answer (current and planned), the rows the archive guard counts; while it loads or fails the server's refusal stays | Decision 5; H23 |
| One Give Tutor text for every role that may open it, saying the Super Admin gives roles, with a link to Staff for a role that may open it | Decision 6; H22 |
| The teaching load gives the first reason of each teacher or vacancy with the subject (not active, a grade, the language, another part of the block), a Tutor subject on a class with no Tutor its own line, and the subject in nobody's profile otherwise | Decision 8; H30 |
| The merge preview lists the start date, the grade and the scholarship (the later life's), the contracts (all kept) and the relatives (stays, added, already linked) beside the personal fields; the digest covers them | Decision 9; H29 |
| A branch switch asks `useLeave()` first, then removes `open` from the address of any page, then chooses the branch | Decision 10; H32 |
| The handbook pages for people, classes and the teaching load are written by task 3.7 from its "From 3.5b" line | Decision 11 |
| Built: a relative found in Ctrl+K shows the main phone and the number of the branch's students linked; the children themselves are listed under Students by the same typed phone (the spec's "lists the relative's children") | H33; permission review of the build, should-fix 2 |
| Built: the refusal of several students for a full class names the class, the day and how many students, not a number of free seats (the fewest over the range could belong to another day) | H24; spec review of the build, should-fix 6 |
| Built: the Ctrl+K line of a child found by a relative's phone reads uz "Qarindoshi: <name>", ru "Родственник: <name>", en "Relative: <name>" (any relationship, not only a parent) | H33; spec review of the build, should-fix 7 |

## 15 October 2026: the hand-test fixes of wording and small screens (task 3.5a)

Plan approved on pull request #113 with corrections 1 and 2; decisions 1 to 13 confirmed there, decision 10 changed by correction 1. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Names are surname first under "Surname and name" in the Students, Staff, Never used and Parents lists and their exports; the `/spec-change` of `04`, Student record, is the one 2.7b-1 decision 3 proposed, with the Staff header added | Decision 1; issue #105, H6 (decided by the owner) |
| **Look first.** A relative's name stays one "Full name" field stored as typed; its label asks "Surname, name, patronymic" and the seed is written so; names already typed stay | Decision 2; `04`, Close relatives; H7 |
| **Look first.** The role switch is a menu button "Menu and home page: <role>" whose menu says the rights stay; `docs/design-system.md`, This app, Top bar, says so | Decision 3; H11b; `02` and `edge/people-roles-accounts` unchanged |
| An active student whose start date is ahead reads "From <date>" (`startsLater`) in the list, the record, Ctrl+K, the merge preview and the export; the status filter still counts the student active; "Starts later" stays for no status row | Decision 5; H13; #42 task 2.4a |
| A scheduled leaving reads "Leaves the school (last day <the day before from>)" until its first inactive day, on the record and the History tab | Correction 2; `04`, Movements; H3 |
| The Class filter offers every class of the branch not archived and of a year not closed, plus the rows' classes; while the list loads or fails, the rows' classes, the failure said with a retry | Decision 4; H18; `.claude/rules/web.md` |
| Below 640 px two or more filters fold behind "Filters · <number in use>"; the open state is not in the address | Decision 6; H17 |
| Short labels for the phone tab bar only (`menu.short`), the full name its accessible name | Decision 7; H16 |
| A tab row that scrolls has no scrollbar and fades its cut edge with a mask (`.scroll-row`), not a gradient fill | Decision 12; H15 |
| The department move refusal's lines carry the class's grade (`unit.grade`, null for a group), sorted by grade then name | H8 |
| The changed behaviours are handed to task 3.7 with a "From 3.5a" line of `docs/build-plan.md`; `docs/handbook/02-school-setup.md` has nothing to change | Correction 1 (decision 10 changed) |
| H20: nothing in the source hides the refusal list; only the modal "Leave without saving?" hides it while open, which is right | Plan, H20; browser test |
| Built beyond the plan: the phone tab labels that are cut at 360 px are shorter: School setup is "Maktab" / "Школа" (not "Sozlamalar" / "Настройки"), and the Russian Timetable "Уроки"; a browser test draws every short label of every item in the three languages at 360 px | H16; the issue's labels were examples ("e.g.") |
| Built beyond the plan: the right group of a list's toolbar (columns, "Also export", "Export") wraps, because in Uzbek it pushed the Students page 4 px sideways at 375 px | `12`, Devices; the task's Done when (no sideways scroll at 375 px) |
| Built beyond the plan: the export writes the date of "From <date>" as "19.10.2026" (a text cell; the school's files write dates so), the rest of the text as the screen's key | Decision 5; `export-texts.test.ts` ties the texts |
| The merge preview reads a side's status as the list does: active before the start date, so a later start reads "From <date>" | H13; permission review of the build |

## 15 October 2026: the rule engine (task 5.2)

Plan approved on pull request #109 with corrections 1 to 5; decisions 1 to 18 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** An unset travel time between two branches blocks a teacher's lesson and their next lesson that day in the other branch (`travel_time_not_set`), whatever the gap | Decision 1; `06`, Rules; 1.6 decision 4: "never 0 minutes" |
| **Look first.** A class's most lessons per day is one branch setting, `branch_settings.class_daily_lessons` (0061), 1 to 12, null not set; proposed `/spec-change` of `edge/timetable`, Structure: "a class's most lessons per day (one value in the branch's settings)" | Decision 2; `06`, Rules: "the daily maximum in settings" |
| **Look first.** `room_shared_capacity` blocks for a shared room, `room_capacity` warns for a room that is not shared, as the database does | Decision 3; 5.1a decision 2 |
| One call, one axis: `day` and clock minutes in branch time; the caller converts; `placement.ts` names the date each fact is read on | Decision 4, correction 5 |
| A result is rule, severity, day, every placement involved and numbers; no text in the engine | Decision 5 |
| Two lessons of one block at once are no class clash; a teacher, room or student in two of them is | Decision 6 |
| Exams: one place at a time, rooms and `room_capacity` only; an exam in a shared room is one use, its students not counted against the shared capacity; invigilator vacancy and inactive block, availability and subject warn | Decisions 7, 16, correction 2 |
| Availability of a pattern from the entry in force on the intended start date; later entries up to the version's end as warnings by date | Decision 8 |
| A double pair counts once for `subject_twice`; a split block once for `class_day_load`; free periods read the class's own template | Decision 9 |
| `teacher_week_load` and `teacher_day_load` count every branch | Decision 10 |
| `load_mismatch` is a warning; publish (5.5a) stores "deliberately short" and refuses | Decision 11 |
| `noSubjectTeacherFree` turns `teacher_subject`, `teacher_grade`, `teacher_unavailable` into warnings; `substitute_language` warns, `substitute_vacancy` blocks | Decision 17, correction 3 |
| A day in no quarter is `vacation`, outside the year `outside_year`; a room under repair warns, a closed one blocks | Corrections 1 and 4 |
| `fast-check` 4.10.2 as a devDependency of `packages/timetable-rules` for the property test of the sweep | Decision 14; the version the workspace already pins |
| `noSubjectTeacherFree` relaxes only a substitute's own lesson in a dated call | Spec review of the build, must-fix 2; `edge/timetable`: "For a one-day change only" |
| All parts of a block in one slot: parts at other times are `split_apart`; travel time compares a lesson with the one that ends last before it | Spec review of the build, must-fix 1 and should-fix 2 |
| A placement whose teacher, unit, subject or room is missing from the facts throws: a caller's fault, never a free slot | Spec review of the build, should-fix 1 |
| A result is told apart by its rule, day, placements and detail: two later dates, two load rows, two invigilators or rooms of one exam, two free periods are each listed | Review of the build, must-fix 1: a conflict list that drops entries is not correct |
| The setting has its own route, `PUT /api/setup/settings/class-daily-lessons`, area `settings`, as each settings section has | Found in the build: the settings controller has one PUT route per section |

## 15 October 2026: exams and later changes against the claims (task 5.1b)

Plan approved on pull request #108 with corrections 1 and 2; decisions 1 to 14 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** `time_claims_kind_check` replaced in 0060 to add `exam_group_class` (holder the group's own block); nothing allowed for the five earlier kinds changes | Decision 1; `edge/timetable`, Exams, "A group sits an exam" |
| **Look first.** An exam room is one use of a shared room; an exam's students are not counted against capacity | Decision 2; `06`, Exam, "room capacity is a warning" |
| **Look first.** A room's switch is not copied again onto pattern entries | Decision 3; 3.4a decision 3, 5.1a decision 9 |
| **Look first.** One 5.1a test fixture changed: in "refuses a mixed block with a student in both groups", the second group row starts on 24 October and the refused block is on 26 October, because the new membership re-check refuses the old setup (a membership that put the student twice into a future block) by itself | Build review, should-fix 6; a stronger rule, not a weaker one; the test still proves what it was written for |
| A group sits only over one block of its lessons or the two of a double pair, with those lessons cancelled; a class sitting whole while its shared block runs on is out of that block (`lesson_block_class_outs`) while the exam stands and overlaps it | Decisions 5, 6, correction 1 |
| "Future" for a re-check: starts after `app.now` (group classes, memberships), not ended (a room); a started block keeps its class claims | Decision 8 |
| An exam's cancel (`cancel_cause`) is final; no delete; invigilators reach a person only, by the key `(staff_id, staff_kind)` | Decisions 7, 9 |
| `exam_claims` writes only what differs and locks the exam row first | Found in the build: two writers of one exam left a claim of a removed invigilator |
| A write of an exam's rows gives up the claims the exam no longer holds first, then rewrites the blocks its out rows name, then writes its new claims | Build review, must-fix 1: an out row counts only while the exam seats the class |
| A write to an exam that has started (a title) rewrites its claims from today's group classes and rooms; routes never change a past exam (decision 10) | Build review, nit 8 |
| A block that has started and already claims classes keeps exactly those, also when a lesson is added to it; a block inserted after its start writes its claims | Build review, nit 9; decision 8 |

## 15 October 2026: lessons, pattern and time claims (task 5.1a)

Plan approved on pull request #107 with corrections 1 to 6; decisions 1 to 19 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** 5.1 split into 5.1a (pattern, dated lessons, time claims) and 5.1b (exams on the claims; the re-check of claims when group classes, memberships or a room's switch change) | Decision 1; the build plan's split rule |
| **Look first.** A shared room is refused over its number of lessons at once and, for the students of those lessons together, over its capacity; a room that is not shared keeps capacity as a warning | Decision 2; `edge/developer-rules`, Room in one use, and `edge/timetable`, Structure, over the `06` warning; proposed `/spec-change` of the `06` capacity row |
| Claims and pattern block classes are written only by the database's triggers (`pg_trigger_depth()` guard), `TEMPORARY` revoked, no `TRUNCATE`, no SECURITY DEFINER; each test database copy gets the revoke too | Decision 3; a database's rights are not copied from its template |
| A claim exists only for a lesson that is not cancelled; the time lives on the block and cascades to every lesson row and claim | Decisions 4 and 5 |
| Exclusion constraints deferrable, initially immediate; the counting triggers deferred, each behind an advisory lock | Decision 6 |
| The pattern is checked by the clock minutes stored on its blocks, per version and weekday, with no student check and no cross-branch check | Decisions 7, 8 and 18 |
| A block stores its quarter; the quarter changes only for a block dated after today and never with the date | Decision 10, correction 4, spec review of the build (0059) |
| A pattern entry's teacher is the load row's, by a cascading key; a deleted draft load row deletes its entries | Decision 19 |
| No delete on `lessons` and `lesson_blocks`, no update of their version columns, still no grant on `status`: each later task adds its own | Decision 12, correction 6 |
| The fixes of the spec review of the build are migration 0059, not an edit of 0058 | 0058 was already applied in working databases; the migration runner refuses a changed file |

## 15 October 2026: exemptions, flags and special outcomes (task 4.3)

Plan approved on pull request #104 with corrections 1 to 4; decisions 1 to 12 marked Look first and confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** "Exempt" when the student has lessons and every one is exempt, whatever the rating entry | Decision 1; `07`, Effect on totals: "If none remain, the result is 'Exempt'" |
| **Look first.** Few lessons when n × 3 < N; unmarked and off-attendance extra lessons are expected | Decision 2; `edge/calculation`, "A student joined late…" |
| **Look first.** One decision covers every flag; `exempt` only when the few-lessons flag is the one flag raised and (n + e) × 3 ≥ N; a not-allowed decision is stale, never thrown | Decision 3; the "one flag" part from the spec review of the code (the attendance-only and "left the subject" rows offer keep or Not assessed only) |
| **Look first.** Attendance alone: no classwork number, no homework number, no rating score; "did not sit" does not clear it | Decision 4; `edge/calculation`, the row's own "absent all quarter" example |
| **Look first.** "Left the subject" is a flag with keep or Not assessed and blocks closing | Decision 5; an inference from "decides at closing" |
| **Look first.** A result at leaving raises no flag and is stored as `at_leaving` in an open quarter; a closing record with a leaving date is refused | Decision 6; the refusal from the spec review of the code |
| **Look first.** No date filter for the start quarter; "from <date>" on every outcome | Decision 7; `edge/academic-year`: no dated lessons before the start date |
| **Look first.** A closing record is refused for an open quarter, an undecided or stale flag, a missing rating entry | Decision 8, correction 1 |
| **Look first.** Every row of the two tables is a test here or names its owning task; `spec-rows.test.ts` pins case and rule | Decision 9 |
| **Look first.** N counts, per school day, the journal the student belonged to; before and in a gap the next one | Decision 10 |
| **Look first.** `CALC_VERSION` is raised with every change of the module's source, a refactor included | Decision 11, correction 4 |
| **Look first.** With both a leaving date and a "left the subject" date, the result at leaving applies | Decision 12, correction 4 |
| Records are JSON format 1 with fractions as decimal strings; a refused recalculation is listed with its code, not thrown | Decision 13; spec review of the code |
| `Date` is refused in the module's source; dates are `YYYY-MM-DD` strings checked with whole numbers | Decision 14, correction 2 |

## 15 October 2026: quarter and year results (task 4.2)

Plan approved on pull request #103 with corrections 1 to 3; decisions 1 to 7 marked Look first and confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** The quarter attendance average leaves out lessons not yet marked and extra lessons with "counts for attendance" off | Decision 1; `07` rule 4; `edge/calculation`, "An extra Saturday lesson"; as 4.1 decisions 2 and 7 |
| **Look first.** `provisional` only while the quarter is open and a weighted part has no data; "exempt" and "not held" rating exams are left out without it; in a closed quarter `leftOut` is the "part left out" marker | Decision 2; `07` rule 8; `edge/calculation`, "A part has a weight but no data" |
| **Look first.** "Exempt on exam day, pending" is passed as no rating entry | Decision 3; `edge/calculation`, "A student is exempt on the exam day" |
| **Look first.** Works of an exempt lesson, the homeworks checked there included, are left out; a number there throws | Decision 4; `07`, Effect on totals |
| **Look first.** `no_result` when no part has data; a number on attendance alone (its flag is 4.3) | Decision 5; `edge/calculation` |
| **Look first.** The year result is the mean of the exact quarter results that are numbers, of exactly four quarters, "based on n of 4"; Exempt, Not assessed, No result, not in the system and not official are left out | Decision 6; `edge/calculation`, the year row; `edge/academic-year` |
| **Look first.** The Settings test of the locale band texts is replaced by one against `GRADE_BANDS`; the two tests with the literal values stay | Decision 7; build plan 4.2 |
| `@sodiq/calc` is a workspace dependency of `apps/web`; `forceRerunTriggers` names its sources | Decision 8 |
| Reference journals in `packages/calc/reference-journals/`, JSON with exact figures, parsed with `bigint` only | Decision 12, correction 1 |
| `yearResult` refuses a quarter result outside 0 to 100 | Correction 3 |

## 15 October 2026: exact fractions and the lesson score (task 4.1)

Plan approved on pull request #102 with corrections 1 and 2; decisions 1 to 7 marked Look first and confirmed there, decision 14 changed by correction 2. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** `fast-check` 4.10.2 is a dev dependency of `packages/calc` (MIT, maintained, no audit finding, the version of `apps/api`); `manifest.test.ts` still refuses any runtime dependency | Decision 1; `13`, Tests: "property tests for the calculation module" |
| **Look first.** An attendance mark not yet typed leaves the attendance part out of the lesson score; it is never read as absent | Decision 2; `edge/calculation`, "A part with no number is left out"; `edge/journal`, Entering |
| **Look first.** Marks 4 and 5 give `exempt` and no score; a number with them throws `number_on_exempt_lesson` | Decision 3; `07` rule 1 and Exemptions, Problem cases |
| **Look first.** "Halves up" is floor(x + ½), refused below 0; the whole percent shown next to a number uses it too, for display only | Decision 4; `07` rule 10 and The total |
| **Look first.** The classwork and homework parts are means of the exact percents; `null` (empty or "not graded") is left out, a 0 counts | Decision 5; `07` The total and rule 4 |
| **Look first.** The score is Σ weight × part over the parts present ÷ Σ their weights; the daily distribution is refused unless three whole parts of 1 to 100 total 100 | Decision 6; `07` rule 3; the 2.1 rule |
| **Look first.** An extra lesson with "counts for attendance" off leaves the attendance part out of the lesson score; its works count | Decision 7; `edge/calculation`, "An extra Saturday lesson" |
| Inputs are safe whole JS numbers turned into `bigint` at the boundary (`input.ts`); every input is checked on every call, a wrong one throws `CalcInputError` with a code, no text | Decision 8; the API validates with `packages/shared` first |
| `lessonScore` is the "daily result" of the build plan, the AVG of `07` | Decision 9 |
| A work is passed only with its total; `workPercent` takes any whole total of 1 or more, and the 1000 limit of `edge/journal` is the journal's schema rule (8.x); a "not held" work is not passed | Decision 10, correction 1 |
| The homeworks checked at a lesson are the journal's to choose (8.x) | Decision 11 |
| `Fraction` is an immutable, frozen class, always reduced, with no float or string conversion | Decision 12 |
| Attendance-only subjects have no daily distribution and are never passed to `lessonScore` | Decision 13 |
| The lesson score is for display only and never enters a quarter figure; its `parts` are kept for the tests and the support view of `edge/journal` ("how the result was calculated"), not for a journal cell | Decision 14 as changed by correction 2 |
| `no-float.test.ts` refuses `Math.`, `parseFloat`, `toFixed`, `toPrecision`, `Number(` and decimal and exponent literals in the module's source, comments stripped; a division of two numbers is left to the review and the property tests | Build, spec review suggestion 1 |

## 15 October 2026: the department move against the load (task 3.4c)

Plan approved on pull request #101 with corrections 1 to 5; decisions 1, 2 and 3 marked Look first and confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** A draft's row counts as "a teaching load": every row of a version that is not archived, of a year not closed and ending on or after the start date, drafts of every branch included | Decision 1; row 15 writes the refusal with no exception for drafts, and decision 3 of pull request #99 reserved this one refusal |
| **Look first.** The department changes on the record when the move is saved; the profile is not part of the move (the old subjects leave first, `staff_subject_department` of 0024 at the commit); the start date is today or later in the request's branch time and no later than the end of the branch's latest year, with no upper bound in a branch with no year; a version counts when its year ends on or after the start date (5.5a gets the line for a published version's own end). Proposed `/spec-change` for `edge/people-roles-accounts`, row 15: "Both changes carry a start date and are made by the Super Admin. The department changes on the record when the change is saved, and the teaching load must follow it from the start date: the change is refused while a teaching load of a version that runs on or after the start date would have a teacher outside the subject's department; those loads are listed for reassignment first. Open requests move to the new Head Teacher." | Decision 2 with correction 5 |
| **Look first.** `department_move_loads` SECURITY DEFINER: the rows of the request's branch (a branch of the transaction, and the teacher's branch on a teacher move) by id and version, one count per other branch, never a row, a name or a subject of another branch | Decision 3 with correction 2; row 14 |
| A vacancy's row counts on a subject move, named `load.<id>` like a teacher's; a vacancy's own department change is not a move and is not refused | Decision 4 with correction 1 |
| The 409 `department_move_loads` carries in each `load.<id>` detail what its line shows (version id, number and start, class or group, subject, teacher or vacancy); the web names the subject from the subject list | Correction 2 |
| A teacher move is a change of the department of the Academic division, main or further, to another or to none; adding Academic or swapping main and further is not a move, and `department_since` survives every path of `writeDivisions` that keeps the division | Decision 5, correction 4 |
| No database constraint for the refusal; the person and the subject FOR UPDATE against the load writes' KEY SHARE (the create, the teacher edit and the copy lock the row's subject in a statement before the write), and `DEPARTMENT_MOVE_LOCK` for two moves | Decision 6 |
| The Tutor rows of the class Tutor stay outside the rule on both sides of a move, read after the move, on the later of the version's start, the move's start and today | Decision 7; row 13 |
| `staff_changed` and `subject_changed` answer an edit whose locked read finds another department than the read before the lock, in either direction | Decision 9 |
| The teacher-move same-moment test asserts what each order gives (the create `load_teacher_subject`, the move 200), with the create waiting for the person's lock and a held create refused under a savepoint | Correction 3: the profile rule stands on both sides |
| The start date field starts empty on both forms; the server answers `required` on a move without it | Build: the subject list carries no today of the branch, and the device's clock is not used for a date (`edge/00-definitions`, Branch time) |
| **Look first** (tests changed by a requirement). The move tests of `subjects.test.ts` and `staff.test.ts` send `departmentStartsOn`; the web fixtures of a subject and of a division carry `departmentSince` | Build: the start date and the date shown are new requirements of 3.4c |

## 15 October 2026: splits, groups and weekly totals (task 3.4b)

Plan approved on pull request #100 with corrections 1 and 2; decisions 1, 2, 8 and 12 marked Look first and confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Within a version the load is the source of the split and group subjects of a class (the split-or-whole rule, the blocks, the students not placed, the totals); `class_group_subjects` keeps reading the active groups until 5.5a makes it read the published version in force on the date | Decision 1; `edge/timetable`, Versions and drafts: a draft binds nobody, and the membership check must not be dropped |
| **Look first.** A block is every group row of one subject in a version linked by a shared class, or by being groups across classes of the same grade or pair of grades; its parts have equal lessons per week and different teachers | Decision 2; `06`, Model, Parallel group lessons; `edge/timetable`, Structure |
| **Look first.** `teacher_load_elsewhere` SECURITY DEFINER: counts and branch ids only, for records linked to the branch of the request, which must be a branch of the transaction; another branch's version running on the day is its published one in force, else its draft with the latest start on or before the day, else its earliest later draft, marked draft | Decision 8 with correction 1; `06`, Weekly load |
| **Look first.** `mixed_block` on the rows of a split: one teacher may take both halves, equal lessons still bind; the pairing of two subjects' halves is 5.4c's. Proposed `/spec-change` for `05`, Teaching load, Fields: add "for a split, whether it is part of a mixed block" | Decision 12; `edge/timetable`, Structure: "A mixed block is allowed" |
| **Look first.** The commit check takes a transaction-level advisory lock of the version (`pg_advisory_xact_lock`), not a lock of the version row in a before trigger as the plan said: PostgreSQL locks the row being updated before its triggers run, so two writers of two rows deadlocked (the build's same-moment test). The API takes the version FOR UPDATE first (`lockDraft`), as in 3.4a | Build; `.claude/rules/database.md`, the lock-upgrade rule |
| **Look first** (tests changed by a requirement). The 3.4a database test "is one per class and subject, and one per group" puts its group on another class; the load page tests read the new block column and the `mixedBlock` of the create; the 3.4a browser test finds its row by "Geometry" (the totals have a row of 7 Oxford too); `pages.spec.ts` opens the first record of a table not marked `data-totals` | Build: the split-or-whole rule, the block column, the field and the totals section are new requirements of 3.4b |
| The planned test "a room edit followed by a lessons edit against another writer (no deadlock)" is not written: with the lock trigger gone, a write that bypasses the API takes no lock of the version before its rows, so there is no lock to upgrade; the advisory lock of the commit check is proved by the same-moment tests of `load-blocks.database.test.ts`, each of which fails without it | Build; spec review of the build, should-fix 1 |
| The mixed mark on a class row is refused by a check of the table (`load_mixed_not_split`), the engine and the API | Spec review of the build, must-fix 1 |
| The totals read the templates, the hours and the other branches on the later of the start date and today (`statusOn`), as the students not placed | Spec review of the build, should-fix 5 |
| A lessons or mixed-mark edit is written to every part of the block (the halves of the split for the mark) in one `teaching_load.edit` entry with `parts`; each block rule is checked only when its own field changed, in the API and at the commit | Decision 3; 3.4a decisions 3 and 7 |
| "Students not placed" (`load_group_gaps`, with the count): a gap of `group_placement_gaps` from the start date or today, or a student of the block's classes in a group of the subject with no row in the version; listed, never refusing | Decision 4; spec review of the plan, must-fix 3 |
| The totals are shown and marked with the danger token, never refusing; a weekday is read on its first date on or after the start date (templates and hours); free slots are the most non-overlapping lesson slots by clock time of the templates of the teacher's grades inside the hours, per branch, not capped by most lessons per day; no hours entry gives "No hours set" | Decisions 5 to 7 with correction 2 |
| The group card and panel show the published row's teacher to every reader, a draft's (marked) only to readers of the area `timetable` | Decision 9 |
| A copy leaves every part of a block that breaks a block rule, and the group rows beside a copied class row with `load_split_and_whole` | Decision 10 |
| The teachers offered for a group row leave out the other parts' teachers, except for the halves of a mixed split | Decision 11 |
| A class and a subject whose group switch is on: the row form says so and offers the class's groups of the subject; a class row is still allowed | Decision 13 |

## 15 October 2026: draft versions and load rows (task 3.4a)

Plan approved on pull request #99 with corrections 1 to 6; decisions 1, 2, 3 and 15 marked Look first and confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Task 3.4 split into 3.4a (draft versions, load rows, the blocked rules of one row, the copy, the vacancy refusals, the load page), 3.4b (splits, groups, weekly totals) and 3.4c (the department move against the load), each inherited line moved to the part that builds it | Decision 1: eight rule groups, two outside changes and a screen |
| **Look first.** A Tutor subject is a subject of the department marked `departments.tutors` (the seeded Tutors department, at most one row, no grant; the migration fails when the row is not found); on a class row a Tutor of that class whose row overlaps the start date (00:00 to 00:00 in the branch's time zone, found through the assignment's account), main or acting, takes it without the profile row; the language rule and the subject's grades still apply | Decision 2, corrections 4 and 5; `edge/people-roles-accounts` row 13; `edge/timetable`, "the class Tutor by default" |
| **Look first.** A later change elsewhere (profile, status, room, archive, language rule) is not refused because a draft's row needs it; the row shows the problem, and readiness (5.3) and publish (5.5a) block on it. Only the vacancy close and delete refuse here, the department move in 3.4c | Decision 3; `05` and `06` word the rules as rules of choosing |
| **Look first.** A minimal `timetable_versions` now (branch, year, number, status with no grant, `starts_on`, `from_version_id` of the same branch and year, `left_rows`), which 5.1 to 5.5 extend | Decision 15; `edge/timetable`: "The load belongs to a timetable version" |
| **Look first.** The menu item "Timetable" now follows the area `timetable` of the same name, so the Vice Principal for Spiritual and Moral Education, the Head Tutor, the Tutor, the Head Teachers and the Teacher do not see it until their views of lessons come (5.9); the menu test of `access.test.tsx` expects the row of each role less "Timetable" for those six roles, written out by hand | Build: decision 4 gives the area to three roles; `visibleMenu` lets the permission table win, as for `classes` and `audit_log` |
| A new area `timetable`: the Super Admin and the Academic Vice Principal view, create, edit, archive; the Principal view | Decision 4; `02` |
| The start date of a draft on or after today and inside the year, next Monday by default (the year's first day when later); `version_start_past` and `version_start_outside_year`, 422 on `startsOn` | Decision 5 |
| A draft's row is deleted (`archive`), the whole row in the audit entry; a vacancy "held a load" while a row of any version names it | Decision 6 |
| A create runs every rule; an edit the version and year always, the teacher rules on a teacher change, the room rule on a room change | Decision 7 |
| The two-grade slot rule from the templates in force on the start date, by the API only | Decision 8 |
| Every constraint of 0055 maps to a code; the database's `load_teacher_subject` stands for a subject or a grade, the API names which (`load_teacher_grade`) | Decision 9 |
| A copy of a version of the same branch and year; the rows that no longer pass stay on the draft (`left_rows`, with their problems) until dismissed; a version of another year answers `version_copy_year` | Decision 10; build: a code of its own for the year |
| A status is read on the start date, or on today when the start date has passed (the same in the trigger, from `app.now`, and in the API), no row counting as in; lessons per week 1 to 40; a room, a room type or neither, `under_repair` passing; the checklist item `teachingLoad` | Decisions 11 to 14; spec review of the build, should-fix 3: a draft whose start date passed still takes writes and must not name a teacher out today |
| The new draft names its academic year (`academicYearId`) | Build: the plan's schema named `startsOn` and `copyFrom` only; an empty draft needs a year |
| A closed year answers `timetable_year_closed`, not `year_closed`, whose text names the year's dates and quarters | Build; `.claude/rules/web.md`: the text of a code is true on every path |
| The row trigger leaves a version, class, group or room of another branch, a missing teacher and a unit that is neither or both to the keys and checks of the table | Build: a before trigger runs before the keys; its own refusal would name the wrong rule |
| The trigger and the API lock the teacher's record FOR KEY SHARE before reading its status, so a vacancy close waits for a row being written or is waited for | Build: the key's own lock comes after the before trigger, too late for the status read |
| The engine's "every grade and language" property is tested over every grade set of one and two grades and both languages, not with fast-check | Build: `packages/timetable-rules` has no fast-check, and an exhaustive loop is stronger here; no dependency added |
| The form's room need is one field: no special room, any room of a type, or one room not closed | Build; decision 13 |
| A copy locks the teachers of the source rows FOR KEY SHARE in the order of their id before reading their statuses; a vacancy deleted after a copy left its row is shown as a vacancy with no name | Spec review of the build, should-fix 6; permission review, should-fix 1 |
| The seeded vacancy of the pages branch teaches Geometry in grade 7 and holds the seeded load row | Build: `e2e/pages.spec.ts` opens every list with a record |

## 15 October 2026: the move to another branch (task 3.3c)

Plan approved on pull request #97 with corrections 1 to 3; decisions 1 to 6 marked Look first and confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Three `SECURITY DEFINER` functions on the allow-list (`branch_moves_incoming`, `branch_move_sending`, `student_rows_elsewhere`), each given the branch of the request; the accept and the decline add the sending branch to their own transaction (`Transactions.joinSendingBranch`), once, after `branch_move_sending` found an open release to the request's branch | Decision 1; the receiving side cuts the old branch's rows and writes its entry; the `enterCreatedBranch` precedent |
| **Look first.** The receiving branch's readers of `branch_moves` see the UID, name and grade of a student released to it before the accept, nothing else | Decision 2; `edge`: "the receiving one accepts, choosing class and groups" |
| **Look first.** The History tab of the new branch reads the old branch's class rows, group rows and moves past the filter (names, dates, causes, ids); the Academic block names the branch and date of the latest move into the branch | Decision 3; `edge`: "history stay[s] ... readable in the new branch" |
| **Look first.** `students.branch_id` has an update grant, guarded by `students_branch_move`: it changes only with a move accepted in the same transaction; the 2.4a, 2.5a and 3.1b database tests that moved a branch by hand use `moveStudentBranch` of `members-kit.ts` and the two that pinned "no right" pin the guard (`students_branch_move`) instead, nothing weakened | Decision 4; decision 15 of pull request #67 |
| **Look first.** Replaced in 0053, a value or path added and none taken away: the `ended_by` and `cause` checks of both membership tables, `group_memberships_withdrawn_check`, both `only_shrink` triggers; new beside them: `memberships_branch_move` (ends and new rows only by a move accepted in the transaction) and `student_statuses_branch_move` (no status dated before an accepted move) | Decision 5, correction 1 |
| **Look first.** The accept from the move's date on, never before; a late accept cuts back to the date; the receiving class's seat is not held before the date | Decision 6 |
| The release row is a branch table of the student's branch, carried by the cascade (`on update cascade`) | Decision 7 |
| A new area `branch_moves`: `view` and `edit` for the Super Admin and the Academic Vice Principal, `view` for the Principal | Decision 8, correction 3 |
| The state trigger checks the side: an accept or a decline only by a transaction whose filter holds the receiving branch, a cancel only by one that holds the sending branch | Correction 2 |
| The date: tomorrow offered, today allowed, a past date in an open year; the closed quarter with 9.2b | Decision 9 |
| A leaving cancels an open release (`cancelled_by_leaving_id`), named in its entry (`branchMoveCancelled`); its cancel or undo does not bring it back | Decision 10 |
| A release is refused while a move is scheduled or begun on or after its date, or a status change is scheduled after it (`status_scheduled`), checked again at the accept; class and group transfers are refused while a release is open (`branch_move_open`) and before the arrival in the branch (`before_branch_move`) | Decisions 11 and 12 |
| The accept names the class and may name a group per subject (`branch_move_group` when not offered); the others get the smallest suitable group, tagged | Decision 13 |
| The receiving branch declines with a reason (logged in both branches); no undo of an accepted move | Decision 14 |
| The language of the class left is confirmed (`branch_move_language_differs`) | Decision 15 |
| No notice; the incoming list sits above the student list | Decision 16 |
| The old branch's audit entries stay in its log | Decision 17 |
| A route of its own lists the other branches for the release form (`GET people/branch-moves/targets`, `branch_moves` `edit`): the list of branches is the Super Admin's | Build: the Academic Vice Principal has no list of branches |
| The accept form sits in the incoming list's row, not in the side panel; the class is chosen first, then a group per subject | Build: the record is not of the branch before the accept |
| The record is read after the accept in a new transaction of the request's branches alone | Build: the joined filter would count the old branch's rows into the `version` |
| The History route of a student checks the branch explicitly: the Super Admin's transaction sees every branch | Build; `.claude/rules/api.md`, the Super Admin's 404 |
| A release dated in no year or in a closed year of the sending branch answers codes of its own (`branch_move_outside_year`, `branch_move_year_closed`) | Spec review of the build, should-fix 2: the class codes' texts name a class |
| The accept and the decline ask a confirmation naming the student (and the branch and class), as an action that cannot be undone | Spec review of the build, must-fix 5; `.claude/rules/web.md` |
| An account that is the Academic Vice Principal of both branches may release and accept the same move, as the Super Admin may; no "own request" rule | Spec review of the build, should-fix 7: `edge` lets the Super Admin do both; the account holds both roles in force |
| The accept reads the target class again after its lock; the class left and the moves read on the return path and the record are of the request's branch | Spec review of the build, should-fix 1; permission review, should-fix 1 |
| A table that references the student is named carried or kept in a test; the 2.4a, 2.5a and 3.1b database tests that changed a branch by hand use `moveStudentBranch` | Build: the branch changes only with an accepted move |

## 15 October 2026: return and graduate restore into a class (task 3.3b)

Plan approved on pull request #96 with correction 1; decisions 1 to 6 and 10 marked Look first and confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** The 2.4b-1 return tests, and those of the relatives and the student export, send a class; the restore tests send one too; nothing is weakened | Decision 1; `04`, Movements: "is placed in a class from the return date" |
| **Look first.** "Into another class: handled like a transfer" is the language confirmation of `05` (`return_language_differs`, asked against the class left) and the journal side of 8.6 (a line added); no `student_moves` row; the restore asks no confirmation | Decision 2 with the review's addition |
| **Look first.** `class_memberships_cause_check` replaced in 0052 with `return` and `restore` added, nothing taken away | Decision 3 |
| **Look first.** `classMembershipId`, `languageConfirmed` and `groupsPlaced` join `NOT_IDENTITY_KEYS` | Decision 4 |
| **Look first.** A return into the class left offers each subject the group the leaving cut first, inside `planClassGroups` (`preferredOf`), with the same seat book and offered groups; otherwise the smallest suitable group; every row automatic and tagged | Decision 5 with correction 1 |
| **Look first.** The restore takes the grade of the class it names | Decision 6 |
| **Look first.** A return or a restore dated outside the class's year is `return_outside_year` (path `from`); a graduate restored by mistake in the summer waits for the next year's first day | Decision 10 |
| No permission change; a pin test that the returners and the restorer edit classes and groups, and the restorer students | Decision 7 |
| The class rules are checked again by `planPlacement` after the status rows, under the student and class locks, the class re-read after its lock; lock order student, class, groups | Decision 9 |
| The refusals of the class rules answer at `classId` or `from` (`atClassFields`) | Decision 11 |
| The record answers `classLeft` (the class the inactive student left, by the service's own rule) to a reader who may return the student; the return form offers it first | Build: the form needs it; nothing new is readable |
| The class select shows the fewest free seats of the class chosen under the field, not a count on each option | Build: one read of the Students tab for the class chosen, not one per class |
| Plan tests not written: a cut group "no longer drawing from the class" (`group_classes_members` keeps the class while the cut row exists); the guard's `class_memberships_full` reached by a race (the class lock comes before the count, a unit test of `atClassFields` instead); a restore refused by `students_grade_class` (a graduate holds no class row after today) | Build; accepted by the spec review of the build |

## 14 October 2026: class and group transfers, the History tab (task 3.3a)

Plan approved on pull request #95 with corrections 1 to 4; decisions 1, 2, 9 and 12 marked Look first and confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Task 3.3 split into 3.3a (class and group transfers, History tab), 3.3b (return and graduate restore into a class), 3.3c (move to another branch) and 3.3d (merge of two student records), written into `docs/build-plan.md` with each later part keeping the 3.3 lines that name it | Decision 1; the 3.2 split precedent |
| **Look first.** A new area `group_transfers`, `edit` for the Super Admin, the Academic Vice Principal, the Head Teacher (own subjects in own branch) and the Senior Head Teacher (own subjects in every branch), the scope checked in the route on both groups (`inGroupScope`) | Decision 2; `02`, Head Teacher: "Moves students between groups of those subjects" |
| **Look first.** A new area `student_history`, `view` for the Super Admin, the Principal, the Academic Vice Principal, the Tutor (own classes), the Head Teacher and the Senior Head Teacher; `CLASS_SCOPED_AREAS` gains it, a pinned list widened | Decision 9 as changed by correction 3; `02`: the tabs of the Spiritual VP and the Head Tutor have no History |
| **Look first.** Replaced in 0050 because the requirement changed with the causes `transfer` and `undone`: `group_memberships_withdrawn_check`, both `only_shrink` triggers (paths added, none taken away), the `cause` and `ended_by` checks of both membership tables, the insert rule of both guards (a row inserted already cut by a scheduled move, correction 1); the 3.2c test that pinned `transfer` as an unknown cause now uses another; nothing named in `edge/developer-rules` changes | Decision 12, correction 4 |
| **Look first.** The audit keys of the move entries join `NOT_IDENTITY_KEYS`, and the student's groups (`studentGroupSchema`) gain `membershipId`, the row a group move names | Build; the 3.2b precedent (decision 5 there) |
| Class transfers are `classes` `edit` | Decision 3; `04`: "class transfers are done by the Academic Vice Principal" |
| The date offers tomorrow; today is allowed; a date before today only for the Super Admin or the Academic Vice Principal of the branch, decided from every current assignment (`move_in_past`, the assignment named in the entry as `pastAssignmentId`), in an open year; the journal checks with 8.6, the closed quarter with 9.2b (lines added there) | Decision 4 |
| A class transfer keeps a group row whose group also draws from the new class, cuts the others at the date and places the new class's uncovered subjects (`coverClassRows`), all or none | Decision 5 |
| "Student changed, reload": the class routes take the student's `version`; the group transfer names the row it moves (`memberId`) | Decision 6 |
| A move is a row of `student_moves`; the rows it cut and wrote name it in two columns; cancel and undo are moments written once | Decision 7 |
| A leaving whose first inactive day is on or before the date of a scheduled move cancels it (`cancelled_by_leaving_id`); its cancel or undo gives the old rows back to their own end and never the move's rows | Decision 8, must-fix 1 of the plan review |
| An undo only while every row the move wrote still ends at its own end, the class or group it left is in service and, for a class move, no group row over the days it gives back lies in a group that does not draw from the class it gives back; a reason is required | Decision 10 with correction 2 |
| A class transfer stays inside one grade and one academic year (`membership_outside_year`) | Decision 11 |
| A planned class or group row that a scheduled move wrote or cuts is not withdrawn on its own (`move_scheduled`): the move is changed or cancelled | Build: a withdraw of the target row would leave the student without a class |
| A class row of the same class that starts where the one shown ends (given back by a cancel) continues it: the record and the list show no planned class for it | Build: a cancelled move showed "7 Oxford from tomorrow" |
| The group move is made from the student's record (the Academic block's groups, "Move to another group"), not from the group panel's member rows | Build: one form for every reader who moves; the Head Teachers open the record from the student list |
| A cancel or an undo of a class move refused by the old class (archived, full) answers the guard's code, nothing is given back | Build; the reviewer's remark on the give-back branches |
| A leaving whose first inactive day is the date of a scheduled move names the rows that move cut on that day, so its cancel gives them back | Spec review of the build, must-fix 1; a line added to `.claude/rules/api.md` |
| Migration 0051 adds a trigger beside the shrink triggers: a row ends by a move only on the move's date while the move is live, or empty on or after it, and is undone only by a move undone first; the reason of a move only with its undo | Spec review of the build, should-fix 1; a new guard, nothing weakened |
| A move dated before a later move of its kind (and subject) that has begun is refused (`move_before_later`, a code of its own); the cancel of a class move is refused while a group move inside it is scheduled (`move_scheduled`) | Spec review of the build, should-fixes 2 and 3 |
| The Head Teacher undoes a group move of own subjects that has begun, with no limit of age beyond the rule of decision 10; the open quarter comes with 9.2b | Permission review of the build, should-fix 3: the spec says nothing on who undoes |
| A group move's audit entry names the assignment whose scope fits both groups | Permission review of the build, should-fix 1 |
| The History tab orders lines of one date by the id of the row or move that wrote them (uuidv7, in the order written), not by a moment: status, class and group rows carry no moment a rule reads | Spec review of the build, should-fix 4 |

## 14 October 2026: search over records (task 3.2d)

Plan approved on pull request #94 with corrections 1 to 3; decisions 1 and 2 marked Look first and confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Ctrl+K lists for the Tutor only the students of own classes (in force or planned), although the student list shows the branch: the rule of `GET people/students/:id` | Decision 1; `edge/people-roles-accounts`, the Ctrl+K row: "only records the person may open" |
| **Look first.** The query is compared with a student's document number, JSHSHIR and own phone and a person's phone and JSHSHIR only for the Super Admin and the Academic Vice Principal of the branch of the request (`superAdminOf ?? viceOf`), never by an action of the table; a document number and a JSHSHIR match only as a whole, a phone from 4 digits; the answers carry none of them | Decision 2; the Ctrl+K row; permission review of the build (a test pins the branch of `viceOf`) |
| **Look first.** The staff status of an answer is today in the main branch's time zone only when the row filter shows that link, else in the zone of the branch of the request, as the staff list on main reads it; a person-wide zone through a SECURITY DEFINER function, for both, is a decision of its own (the allow-list of `catalog.test.ts`) | Spec review of the build, must-fix 3; every branch is on Asia/Tashkent today |
| Four read routes `GET api/search/{students,staff,classes,groups}?q=`, each under the record route's `@Requires` and scope; no new area, no role widened; in `people` and `classes` | Decisions 3 and 12 |
| The web asks only the kinds the active role views; the server answers from every current assignment | Decision 4 |
| Classes and groups not archived, of a year that is not closed; students and staff of every status, with the status shown (a student before the start date "active", as the list) | Decision 5 with correction 1 |
| At most 8 a kind, `more` when a ninth matched, the scope before the limit; "More on the list" opens the list with the typed text, which after a phone or document search finds nothing there (the list searches name and UID) | Decision 6; spec review of the build, should-fix 3 |
| From the second character after a 100 ms pause; "Nothing matches" only once every kind answered for the text typed now | Decision 7 as changed; spec review of the build, must-fix 1 |
| No audit entry, no index, no migration | Decisions 8 and 9 |
| Names by every `spellingKey` word (paternal name too); classes and groups also by `classNameKey`; a group by its subject in any of three languages; the UID from 3 digits as a prefix; the staff ID from its letter and 3 digits, with or without the dash | Decisions 10 and 11; built |
| Classes ordered by grade, then the class-name fold, then id (the fold of the display name would put 10 before 7); students by `name_key`, staff by folded surname and first name, groups by the fold of the name, each then id | Built; the Classes list's own order |

## 14 October 2026: groups on every class membership path (task 3.2c)

Plan approved on pull request #93 with corrections 1 and 2; decisions 1 to 4 marked Look first and confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** "Cannot be saved without a group ... from the same date" is checked by the database at the commit of every insert of a class row, over every day it holds (`class_memberships_need_groups`, 0049); a group created in a later transaction, a class added to a group, an archive and the withdraw of a planned group row refuse nothing: those students are "not yet placed" | Decision 1; `edge/students-classes-groups`, first row; `edge/developer-rules`; `05`: "the screen lists students not yet placed" |
| **Look first.** Fixtures of 3.1b and 3.2b that wrote class rows into a class already feeding a group are reordered (the group in a later transaction), and the browser seed's groups of 7 Oxford and 7 Harvard move to a later transaction; the 3.2b test "a cancel gives no group row back" now expects the rows given back | Decision 2 with correction 1; the requirement changed with the 3.2c line |
| **Look first.** No suitable group with a seat on every day refuses the whole change (`class_group_no_seat`, each student and subject named): "Put into a class", the create with a class, a cancel, an undo, the replace of a scheduled leaving; a cancel of a student who had no group of a subject before the leaving places them or is refused | Decision 3 |
| **Look first.** `group_memberships_cause_check` gains `cancel` and `undo`; the guard lets a row given back keep its review tag | Decision 4; the 0048 comment on `cause` |
| Until 3.4 the split or group subjects of a class are those of the active groups that draw from it (`class_group_subjects`) | Decision 5; pull request #91, decision 18 |
| A cancel or an undo gives back the rows the leaving cut, inside the class row given back, never past the next row of the subject given back, cut by a new leaving, with its own tag; a group out of service or without a seat gives nothing back and the days go to the smallest suitable group | Decision 6 |
| One "smallest suitable group" (`smallestGroup`, `SeatBook`) for the placement screen and the class paths; an automatic row stops where the next group row of the subject begins, its own end that day | Decision 7; spec review of the plan, must-fix 1 |
| `group_placement_gaps` and the commit check share `class_row_gaps`; the TypeScript reader refuses a class it cannot see | Decision 8; should-fixes 1 and 7 of the plan review |
| Lock order of a class path: students, the classes of the rows FOR UPDATE, then every group it may touch in one `lockClassGroups` call, then the writes | Decision 9 |
| "Put into a class" answers `groupsPlaced`; the create answers the record; `student.group_joined` for each automatic row, `groupMemberships.written` (with `cause` and `review`) in the leaving entries | Decision 10 as changed (correction 2) |
| No permission changes; a test pins that every writer of class rows edits groups | Decision 11 |
| A line on 3.3: the transfer, a return and a graduate restore place groups | Decision 12 |
| Same-moment tests of two real routes in a fixed order hold the group row in a third transaction and start the routes one after the other, so the lock queue decides (`inOrder` of `class-groups.test.ts`): a cancel and an undo write status, class and group rows that a held transaction would only imitate | Build; `.claude/rules/api.md`, the held side writes what its route writes |

## 14 October 2026: group membership (task 3.2b)

Plan approved on pull request #92 with corrections 1 and 2; decisions 1 to 5 marked Look first and confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** The student list's `groups` column, the record's Academic block and the group card's count show the groups to every reader of the list, as part of the class | Decision 1; `04`, Student list: "class …, groups, tutor"; Academic: "Class, groups, tutor"; the 3.1b Tutor precedent |
| **Look first.** Pinned lists widened because the requirement changed: `STUDENT_EXPORT_COLUMNS` gains `groups` (the 2.4b-2 line), `GROUP_EXPORT_COLUMNS` gains `students`; the web tests that pinned `groups` as not exported, the list row, the export columns, the Academic block and the student list row of `students.test.ts` change with them | Decision 2 |
| **Look first.** The tag "placed automatically, review" is the column `review`, cleared by "Mark reviewed" (a route and `student.group_reviewed`), true to false only | Decision 3; `edge/students-classes-groups`, first row |
| **Look first.** The Tutor reads the members of own classes in a group and a count of the others; in the branch-wide student list the `groups` cell and the group filter hold groups only on the rows the Tutor opens | Decision 4; the 3.2b line; `02`, Tutor |
| **Look first.** The audit actions `student.group_joined`, `student.group_withdrawn`, `student.group_reviewed` and the keys of their entries in `NOT_IDENTITY_KEYS` | Decision 5; `CLAUDE.md`, every change is audited |
| Placing, withdrawing, "Mark reviewed" and the placement screen are `groups` `edit`; the Students tab `groups` `view` in the 3.2a scope | Decision 6 |
| A group row runs from its date to the end of the class row that holds it, cut at the same scheduled leaving; `own_until` is the class row's own end | Decision 7 |
| A group row lies inside a class row of its group's classes: a deferred constraint trigger fired from `group_memberships`, `class_memberships` and `group_classes`, reading without a lock; the cut of the group rows is the application's (`cutGroupRows`, `withdrawGroupRows`), in the same transaction and named in the audit entry (`groupMemberships`) | Decision 8 |
| A cancel, an undo and the replace of a scheduled leaving by a later date give no group row back in 3.2b (3.2c does); the replace by an earlier date re-names the group rows the old leaving withdrew | Decision 9; spec review of the plan, should-fix 3 |
| One rule for the screen's list and the placement: no group of the subject on or after the date (`student_has_group`) | Decision 10; spec review of the plan, must-fix 2 |
| The student's `version` does not count group rows | Decision 11 |
| "Smallest suitable group": among the screen's groups (correction 1), one that draws from the student's class with a seat on every date of the row, the fewest members on the date first, ties by name then id; students by surname, first name and UID; all or none | Decisions 12 and 13 |
| The screen shows, for one subject, one grade or a pair and a date, the groups drawing only from classes of those grades and their students not yet placed; the list is a `ListPage` (correction 2); the first subject and its first grades are chosen until the person chooses (build) | Decision 14 |
| The date of a placement defaults to the latest of today, the year's start and each ticked student's class row start | Decision 15 |
| A class leaves a group only while the group holds no row with days of its students, past rows included; the archive is refused with members in force or planned, a lower maximum below the members of a date from today on | Decision 16; spec review of the plan, must-fix 3 |
| Lock order: students FOR UPDATE by id, then every group the change touches FOR UPDATE by id (`lockGroups`), then the writes; a leaving and a class withdraw take the student, its classes, then its groups | Spec review of the plan, must-fix 1; same-moment tests of both directions |
| Lines added to 3.3 (a release and a class transfer end group rows; the Head Teachers' moves need a permission of their own) and 9.5a (the graduation ends group rows) | Spec review of the plan, should-fix 1; permission review of the build, should-fix 3 |
| The seat count of a placement and of a run is the guard's, date by date (`peakWith`): a row that ends at a scheduled leaving takes no seat after it | Spec review of the build, should-fix 1 |
| A run that finds no seat for a student answers `placement_no_seat` (a code of its own: the person chose no student); a run of a date in a closed year `group_year_closed` | Spec review of the build, smaller points; `.claude/rules/web.md`, a text true on every path |
| A withdraw of a row with no day (withdrawn, or emptied by a leaving) answers it as it is: an empty range keeps its cause, so 3.2c can give it back | Spec review of the build, should-fix 8 |
| "Put into {group}" on the placement screen asks first: a placement that has begun is changed only by a transfer | Spec review of the build, should-fix 9 |
| The Students tab decides a Tutor's members by the class on the first day of each row; the student list by the classes of today and planned (`studentClasses`); both keep to own classes, and a planned move into the Tutor's class shows in the list before the tab | Permission review of the build, should-fix 4 |

## 14 October 2026: groups and splits (task 3.2a)

Plan approved on pull request #91 with corrections 1 to 4; decisions 1, 2, 11, 12, 15 and 16 marked Look first and confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Task 3.2 split into 3.2a (groups), 3.2b (group membership), 3.2c (groups on every class membership path) and 3.2d (Ctrl+K over records), written into `docs/build-plan.md`; the inherited 3.1b line and the "done when" to 3.2c, the groups part of the 3.3 leaving line to 3.2b, two lines to 3.4 | Decision 1 and correction 2 (the search handed to 3.2 by 3.1a and 3.1c is a task of its own) |
| **Look first.** Area `groups`: the Super Admin and the Academic Vice Principal view, create, edit, archive, export; the Principal views and exports; the Spiritual VP and the Head Tutor view; the Head Teacher views the groups of own subjects in own branch, the Senior Head Teacher of own subjects in every branch; the Tutor views the groups that draw from own classes (`group-scope.ts`) | Decision 2 with correction 4: the view rows of the Spiritual VP, the Head Tutor and the Tutor are a reading of `02` |
| **Look first.** `CLASS_SCOPED_AREAS` gains `groups`; the Groups list is reached from the Classes item (a link on the Classes page, the Ctrl+K index `CLASS_PAGES`), so the menu table is unchanged: every role that views groups already has the item | Decision 11; built: the item is "Classes and subjects" |
| **Look first.** `subject_group_grades` (0046) and `subject_groups_elsewhere` (0047) SECURITY DEFINER, grades and counts only: a subject cannot lose a grade nor be archived while an active group of any branch needs it, and the refusal names the groups of the branch (`group.<id>`) and counts the others (`elsewhere`) | Decisions 12 and 16 with the review's note; 0047 because `subject_group_grades` counts a group of two grades twice |
| **Look first.** The group has no teacher field; the card and panel show "—" for the teacher until 3.4. Proposed `/spec-change` for `05`, Group, Fields: "Subject, grade or two grades, name (7-M-1), language, maximum size. The teacher (or a vacancy) of a group is the teacher of its teaching load row." | Decision 15 |
| **Look first.** The database refuses a group whose subject does not list every grade of its classes (`group_subject_grade`), earlier than the spec's load step | Decision 16 |
| A split is a group of one class; the kind is derived; `group_classes` link rows may be deleted by the application, the sets in the audit entry | Decisions 3 and 4 |
| One planned or current year and one subject, fixed (`groups_fixed` for every user); a name of 1 to 40 letters, digits, spaces, hyphens and Uzbek apostrophes, a digit allowed first, unique per branch and year among archived groups too by `class_name_key`; size 1 to 60 | Decisions 5 to 7, correction 3 |
| The language: the classes' when they share one (`group_language`), chosen when they differ, with `confirmMixedLanguage` for a subject under the language rule (in the audit entry); a class language change moves its one-language groups in the same transaction (`groupsMoved` in the class's entry) and needs `confirmMixedGroups` for a group it makes mixed (`class_language_mixes_groups`, the groups named) | Decision 8 |
| The two-grade slot rule is shown, never refused, at the save: `sharedLessonSlots` and `twoGradeSlots` of `packages/timetable-rules` compare clock minutes, from the later of `branch_today` at `transactionMoment` and the year's first day; `GET api/groups/slot-check` under `groups` `create` | Decision 9 |
| Archive is the only removal; an archived group is not checked again; a restore runs every rule | Decision 10 |
| A class feeding an active group cannot change grade nor be archived (`class_grade_groups`, `class_in_groups`) | Decision 16 |
| Checklist item `groups` after `classes` | Decision 14 |
| Lock order: every group write takes its class rows (old and new set) FOR SHARE in the order of their id, then the group row FOR UPDATE, then writes; a class edit takes its class FOR UPDATE, then the group rows | Correction 1; tested both directions |
| A subject edit waits for a group create that names it (the foreign key's key share lock against the edit's FOR UPDATE), then sees the group and refuses | Build: the same-moment test of a create and a grade removal |
| A class language change locks the class and every class of its active groups FOR UPDATE in the order of their id before its own row or a group (`lockClassesOfGroups`); a `group_language` refusal of the class edit after it is a fault (`request_refused`) | Spec review of the build, must-fix 1 (two classes of one group deadlocked) and should-fix 3 |
| A restore takes the classes' shared language (the change in its audit entry) and refuses with codes of its own, `group_restore_class` and `group_restore_subject`, whose texts say what can be done | Spec review of the build, must-fix 4: a group archived before its class changed language could never come back |
| The subject panel names the groups of the branch and counts those of other branches (`GroupsOutside`, the `TeachersOutside` precedent); the error texts speak of "active groups" so they are true in either case | Spec review of the build, must-fix 5 |
| A class language change writes a `group.edit` entry on each group it moves; the export keeps to the reader's scope (`inScope`) | Permission review of the build, S1 and S2 |
| `ClassesKit.schoolClass` names its classes by a letter count (`Oxford a`, `Oxford ba`): the old digits-to-q names repeated after seven classes | Build |

## 14 October 2026: the class scope of Tutors (task 3.1c)

Plan approved on pull request #90 with corrections 1 to 3; decisions 1 to 15 confirmed there, 1 to 5 marked Look first. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** `classes` `view` for the Tutor, own classes only | Decision 1; `02`, the Tutor row: "Own class or classes" |
| **Look first.** `student_contact` `view` for the Tutor, students of own classes only | Decision 2; `edge/people-roles-accounts`: Contact readers include "the class Tutor" |
| **Look first.** `students` `export` for the Tutor, own classes and Basic columns only | Decision 3; `edge`: "Tutors export their own class"; 2.4b-2 decision 1 |
| **Look first.** The Tutor's menu gains "Classes" | Decision 4; the 3.1c line of the build plan; the menu of 0.8c was the owner's |
| **Look first.** A Tutor's export drops the rows of the branch outside the scope and counts them (`rowsLeftOut` in the audit entry and the header `X-Export-Rows-Left-Out`); 404 for an id outside the branch first; 403 when no row is left | Decision 5; "A Tutor ticks every student of the branch and exports"; the `leftOut` precedent of 2.2c-1 |
| **Look first.** The 2.4a test "refuses the record to a Tutor until the class scope" becomes "refuses the record to a Tutor of no class", and the 3.1a test "a Tutor is refused the classes" lists none for a Tutor of no class; the rule itself is tested in `tutor-scope.test.ts` | Correction 3; the requirement changed with the 3.1c line of the build plan |
| The permission guard reads the classes of every Tutor assignment of the request's branch from `class_tutors` rows in force at `transactionMoment`, through the branch filter, on every request; not of an archived class or a closed year; `classIds` is in no answer | Decisions 6 and 14, correction 1 |
| A student is of a class with a class row in force today or planned; a former member is not | Decision 7 |
| The list rows carry `opens`, decided by the rule of the record (`studentReaderOf` over `studentClasses`) | Decision 8 |
| 404 for an unknown or another branch's id first, then 403 outside the scope | Decision 9 |
| An acting Tutor in force has the scope; a planned row gives nothing until it begins | Decision 10 |
| The Head Teacher and the Senior Head Teacher are class-wide (`CLASS_WIDE_ROLES`) | Decision 11 |
| The student photo stays readable by every `students` reader; the Tutor's home is unchanged | Decisions 12, 13 |
| The scope is read at the guard's moment; a route that writes on the strength of the class scope reads the Tutor row again in its own transaction (doc comment of `inClassScope`) | Decision 15, correction 2 |
| The guard reads the Tutor classes only for a route of an area with class scope (`CLASS_SCOPED_AREAS`: `classes`, `students`, `student_contact`, pinned by a test); within them, for every Tutor assignment of the branch whether it permits the route or not (decision taken in the build, narrowing decision 6) | Every other request of a Tutor costs no read; the route harness ran past its 120-second limit under the full suite with a read on every request (permission review, should-fix 4) |
| A file of the whole branch for an account that is Tutor and a class-wide exporter (the Principal) names the class-wide assignment in its audit entry (decision taken in the build) | `.claude/rules/api.md`: the entry names the assignment that allowed that part (spec review, should-fix 4) |
| The Tutor's empty Classes page says "You are not the Tutor of a class yet." when every assignment that reads classes in the branch is a Tutor one, as the server decides it, not by the role shown (decision taken in the build) | `.claude/rules/web.md`: one short line on an empty page; `.claude/rules/api.md`: the screen follows the server (spec review, should-fix 5) |

## 14 October 2026: class membership (task 3.1b)

Plan approved on pull request #89 with corrections 1 to 4; decisions 1 to 4, 12 and 16 marked Look first and confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** The leaving's effect on classes is built here: a leaving cuts the class rows at its first inactive day (a planned row is withdrawn, an empty range) and names itself on them (`ended_by = 'leaving'`, `leaving_id`); a cancel, an undo and the replace of a scheduled leaving give the cut rows back as new rows (causes `cancel`, `undo`) through every check of the guard; a row of a class archived meanwhile or of a closed year is named in the answer (`classesNotRestored`) and not given back | Decision 1; `04`, Movements: "taken out of classes and groups from that date" |
| **Look first.** A student who starts today or earlier (branch time zone) is created with a class (`student_needs_class`, 422); a later start may wait; a return and a graduate restore make a student active without a class until 3.3 | Decision 2; `edge/students-classes-groups`, "A student is enrolled in August" |
| **Look first.** The dates of a year cannot change while a class of the year holds a row with days in it, past rows included (`academic_year_has_members`) | Decision 3 with correction 4 |
| **Look first.** The grade rule from both sides in the database: a class of another grade is refused (`class_grade_differs`), the grade of a class with members (`class_grade_members`) and of a student in a class now or planned (`student_grade_class`) cannot change | Decision 4 |
| **Look first.** The class rows go with a student deleted as created twice (`on delete cascade`), kept in the delete's audit entry (`memberships`) | Decision 12 |
| **Look first.** A class row carries its class's branch; the student key has no branch, so the move of 3.3 leaves the old rows with their classes; the overlap constraint holds across branches | Decision 16; correction 3 put its consequences into the 3.3 line |
| **Look first.** The student list, record and file name the Tutor of the class (and the acting one) for every reader of the list, as part of the class: the Basic group is "name, class, photo, UID" | Build; the permission review of the build, note 2: the view-only readers of students see the Tutor's name |
| **Look first.** Pinned lists widened because the requirement changed: the student file's Basic group gains `tutor` (2.4b-2: "join once they hold data"), the class file `students`; the audit keys outside Identity gain the class keys; the earlier route tests count a class row in `version`, read the class instead of "Grade 7, no class", and change the grade of a student without a class | Build; the text `gradeNoClass` is gone |
| Each row keeps its own end (`own_until`, the day after the year's end), written at the insert and never changed; a cancel gives a row back from the later of the leaving's first inactive day and the row's own start | Correction 1 |
| A placement of a student with a scheduled leaving is written already cut at that leaving (`ended_by`, `leaving_id` in the insert grant) | Should-fix 9 of the plan review: the size counts the seat free from the leaving |
| The replace of a scheduled leaving by an earlier date cuts again the rows the old one cut and takes over its withdrawn planned rows; by a later date the rows come back cut by the new one. The only-shrink trigger lets a leaving re-cut a row a leaving ended; a withdrawn row is final | Build: decision 1's replace with correction 1; no row grows |
| "Put into a class" is all or none: refused students are named in `details` (`students.<n>`, the student's id), the answer's code is the first one's; a full class answers `class_full` with `freeSeats` (a new optional field of the error detail) | Decision 5; build |
| The withdraw of a planned placement has no body; a withdrawn one is answered as it is; an ended one is `membership_not_planned` (a code of its own) | Decision 10; `.claude/rules/web.md`: a code's text is true where it is sent |
| The free seats are counted by `class_members_peak` (0045), the function the guard compares: today, and the fewest from today on | Decision 11 |
| The audit entries: `student.class_joined` (class, row, from, until, cause) and `student.class_withdrawn` on the student record; the leaving, cancel and undo entries name the rows they cut, wrote and could not give back (`memberships`) | Decision 14; correction 2 (the create's entry beside `student.create`) |
| The "No class" filter is the counter's rule: active (before the start date included) with no class now or planned; the class filter offers the classes the rows name, a language filter reads the class's language | Should-fix 8; `.claude/rules/web.md` (a filter that predicts the server uses its whole rule) |
| The date of "Put into a class" defaults to the latest of today, the class year's start and the start date of each student ticked, and follows them while no other date is typed, in the class panel and in the bulk action | Decision 6 as approved (spec review of the build, must-fix 2) |
| The list cell of the Tutor shows the Tutor and the acting Tutor; the file's cell the Tutor, else the acting one | Build |
| A graduation (9.5a) that begins inside the class year will end the class rows too; a line was added to 9.5a | Build: `class_memberships_active` checks every status change |
| A change that gives class rows back locks those classes FOR UPDATE in the order of their id before the guard does; a withdraw is refused by the database on or after the row's first day (`class_memberships_withdraw_planned`), and the lower-maximum check counts every date when no moment is set | Spec review of the build, must-fix 1 (two cancels in one class deadlocked) and should-fixes 2 and 3 |
| A row given back stops where the next row given back begins (its own end becomes that day), and the replace of a scheduled leaving by the same date names the old rows instead of writing empty ones | The leaving browser test of the build (leave, cancel, an earlier leaving, undo wrote two overlapping rows); spec review, should-fix 7 |
| The class field of a new student offers the classes of the grade in the year that holds the start date, and drops a choice no longer offered | Spec review of the build, should-fix 1 |
| Tests: `postStudent` of `day-templates-kit.ts` gives a student a class of its grade when the test names none; the browser seed gives the student branches a "Seeded" class of grades 7 and 8 and adds the `members` account | Build |

## 14 October 2026: classes and their Tutors (task 3.1a)

Plan approved on pull request #88 with corrections 1 to 7; decisions 1, 2, 5, 8 and 19 marked Look first and confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Task 3.1 split into 3.1a (classes and Tutors), 3.1b (membership) and 3.1c (Tutor class scope), with the inherited lines of 2.4a and 2.4b-2 moved to 3.1b and 3.1c and the "done when" split | Decision 1: three rule sets and two modules; the 2.3 and 2.4 precedents |
| **Look first.** `assignments_class_tutors_end()` is SECURITY DEFINER: the end of a Tutor role is written on its class rows (`end_cause = 'role'`), a row the role end shortened returns to the earlier of its own end (`own_until`) and the role's when the end moves later or is emptied, and rows ended by the Academic Vice Principal or an archive stay ended | Decision 2 with corrections 2 and 3; the `assignments_subjects_end` precedent |
| **Look first.** Area `classes`: the Super Admin and the Academic Vice Principal view, create, edit, archive and export; the Principal views and exports; the Vice Principal for Spiritual and Moral Education, the Head Tutor, the Head Teacher and the Senior Head Teacher view; the Tutor gets nothing until 3.1c | Decision 5; `02`; the Senior Head Teacher reads classes and their Tutors' names in every branch, each request in its branch |
| **Look first.** The Super Admin gives the Tutor role; the Academic Vice Principal names the classes of a Tutor of the branch under `classes` `edit`. Proposed `/spec-change` for `edge/people-roles-accounts`, Who can act: "The Super Admin creates staff accounts and gives all roles. The Academic Vice Principal names the class or classes of a Tutor of his branch, with dates." | Decision 8 |
| **Look first.** `tutor_teaches_language` (a yes or no, after a share lock on the record) and `tutor_classes_of_language` (class ids of the transaction's branches, a count of the others) are SECURITY DEFINER | Decision 19 with correction 4; `05`: "blocked, not a warning" from the staff side across branches |
| **Look first.** `fast-check` 4.10.2 (MIT, maintained, no audit finding) is a dev dependency of `apps/api`: the property test of `class_name_key` against `classNameKey` | Correction 6 asks for generated names; `13` names fast-check in the stack |
| The name is unique per branch, year and grade among archived classes too, by its folded key (look-alike Cyrillic letters, case, spaces), computed by the database; the name is stored as typed | Decisions 3 and 4 with correction 6 |
| A class belongs to one planned or current year, chosen at the create and fixed; no such year: `class_needs_year`, "New class" switched off with "Add an academic year first" | Decisions 6 and 12; the plan's `no_academic_year` speaks of a student's start date, so the class create has a code of its own (`.claude/rules/web.md`) |
| The main classroom is optional, not closed when chosen; a room closed later stays, shown "closed" | Decision 7 |
| A Tutor row begins now or at 00:00 of a later date, never before its role, and ends now or at 00:00 of a later date, never after its role; the end route only moves an end earlier (`tutor_ends_by_then`), a planned row is withdrawn | Decision 9; the codes `tutor_outside_role`, `tutor_date_past`, `tutor_ended` and `tutor_ends_by_then` added in the build so that each text is true where it is sent |
| Archive ends the Tutors in force and withdraws the planned ones in its audit entry; a restore gives none back | Decision 10 |
| "No Tutor" mark on the row, the card and the panel, and a Tutor filter, for every reader; no home tile | Decision 11 |
| Checklist item `classes` after `subjects`: an active class in a planned or current year | Decision 12 |
| Students, average and attendance show "—" until 3.1b and the journal | Decision 13 |
| Maximum size 1 to 60; class name 2 to 40 characters beginning with a letter | Decisions 14 and 17 |
| An acting Tutor is a second dated row of kind `acting`, one at a time, under the language rule | Decision 15 |
| A language leaves a staff record only while no class the person tutors, now or planned, needs it (`tutor_language_held`, its own code; the refusal of a give or a class language change is `tutor_language`) | Decision 16 with correction 5 |
| In a closed year a class and its Tutors are history (`class_year_closed`) | Decision 18 |
| A role end, a `left` and its taking back name the Tutor rows they move in their own audit entry (`tutorRows`); the archive names them in `tutorsEnded` | Decision 20 |
| The edit is `PUT api/classes/:id`, not PATCH | Build: the convention of the record routes (rooms, students) |
| The class detail answers `today` in the branch's time zone, the first date its forms take | Build: the account section's precedent; the browser never decides "today" |
| `SelectField` options may be `disabled`: a Tutor candidate who does not teach in the class's language is shown with the reason and cannot be chosen | Build: the plan's "shown disabled with the reason" |
| The give and the end of a Tutor are audited on the class (`class.tutor_given`, `class.tutor_ended`), in a new Audit log group "Classes" | Build: the class's history is where they are read |
| The class list shows archived classes too, with a Status column and filter | Build: as the subject list |
| Migration 0043 (in this pull request, 0042 being applied locally): a withdrawn row keeps its cause when a role end is set, and a role end moved later brings back only rows of an active class in an open year; a withdrawn row is final for the application | Spec review of the build, must-fix 1: decisions 2 and 10 ("stay ended", "a restore gives none back"); a new file rather than an edit, so that no local database is reset |
| A class name holds letters, digits, spaces, hyphens and the Uzbek apostrophes only (0043 and `classNameSchema`) | Spec review of the build, should-fix 3: the two folds then see the same white space |
| The role-end routes answer `role_tutor_taken` and `role_tutor_language`, and the class edit `class_language_tutor`, not the codes of a give | `.claude/rules/web.md`: a code's text is true on every path that sends it (spec review of the build, should-fix 1) |
| A list column may give `searchFold`; the class name searches with `classNameKey`, so a look-alike Cyrillic letter finds the class | Correction 6 ("the list search of classes compares the same key"); `spellingKey` transliterates instead |
| The staff record's language refusal names the class of the branch ("Tutor of 7 Oxford, a class of that language"), read by its id, or says "a class of another branch" | Correction 5; spec review of the build, must-fix 2 |
| `tutorRowsIn` joins `assignments` on the row's own branch | Permission review of the build, must-fix 1 (`.claude/rules/database.md`, reads of `assignments`) |

## 14 October 2026: the Super Admin's own staff record (task 2.7d)

Plan approved on pull request #87 with corrections 1 to 5; decisions 1 to 9 confirmed there; none marked Look first. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| The link takes the account of the session only; no account id is read from the request | Answer 37 of #39; decision 1 |
| `accounts` `create`, for the branch of the request: the Super Admin only; no new permission area | Decision 2 |
| Refused for an inactive or left status in force or planned (`own_link_status`), read as `super_admin_active_count` reads them; an ended period and a taken-back plan do not refuse | Decision 3; correction 2; spec review of the build |
| The link is final, as every account link (`staff_account_link_guard`); the dialog says so | Decision 4 |
| A Super Admin without a record sees one line as the empty state of the Account page's Photo section | Decision 5; correction 4 |
| No check that the record's name fits the login | Decision 6 |
| One audit entry `account.linked`, group `accounts`, school-wide, record the account, person the record; in the person's report | Decision 7 |
| "Given by" and "Locked by" show the name only where the reader may read the record | Decision 8 |
| A record whose employment begins after today is refused, and `canLinkOwn` follows the route's whole rule | Decision 9; correction 3 |
| The route takes no body, as `unlock` does, instead of a strict empty schema | Build: the convention of the routes without a body |
| The statuses are read in the route's transaction, which holds every branch for a Super Admin, not through a SECURITY DEFINER function | Build: only a Super Admin reaches the read (spec review, should-fix 1) |

## 14 October 2026: Rooms "By floor", the Branches list and the category of every role (task 2.7c-3)

Plan approved on pull request #86 with corrections 1 to 3; decisions 1 to 16 confirmed or changed there; 1 to 4 marked Look first. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (a pinned list widened). `STAFF_CATEGORY_ROLES` is the nine roles of `04` in the order of `ROLES`, pinned by a test of `packages/shared` | Spec change of 13 October 2026, item A2; correction 1 |
| **Look first** (tests changed by a requirement). The "New branch" tests and browser step moved from the Branch page to the Branches list with the same body, switch and close assertions; the Branch page asserts the button is gone | `03`, Branch: "A new branch is added from this list" |
| **Look first** (the design system). Room types take `subject-blue`, `subject-cyan`, `subject-indigo`, `subject-violet`, `subject-pink`; the status dot `success`, `warning`, `destructive`; the type and the status are always written | Decision 9 as changed by correction 2 |
| **Look first** (the design system). Building rows as menu items (`--accent` fill and weight 600 when chosen), floor tabs with the classes of `PeopleTabs`, a room card a bordered tile (1 px border, corner 8, padding 12, no shadow) | Decision 12; correction 3 |
| `GET /api/setup/branches` needs `branches` `create` with `branch: 'none'`: the Super Admin only; every branch id is read first for the row filters; no audit entry | Decisions 2 and 16 |
| Buildings not archived; every room of the branch whatever its status, as the Buildings list sums them; in By floor the number beside a building counts its cards | Decision 3 |
| Opening a branch switches to it and opens its Branch page; "New branch" is on the list only; the Branch page's empty state and breadcrumbs lead to the list for the Super Admin | Decisions 4 and 7 |
| The category is the roles held in the branch of the request for every reader, school-wide roles without a branch counting in each, in `STAFF_CATEGORY_ROLES` order | Decision 5 |
| `ListPage` gains `onOpenRow` (rows that open elsewhere, `creating` without `panel`) and `view` (every matching row, the list's order, no checkboxes, ticked rows cleared) | Decision 8; plan review findings 1 and 7 |
| By floor keeps `view`, `building`, `floor` in the address; the building and floor filters are not offered there and a chosen one becomes the view's; it shows its own loading and failure of the buildings, never the table | Decisions 8 and 15; spec review of the build |
| The search (Ctrl+K) offers a setup page only to a role that may open it (`area`, `action` in `SETUP_PAGES`) | Decision 13 |
| The Branches list writes the working weekdays in full, as the Branch page does | Build (the plan said "short … as the Branch page writes them"; the Branch page writes them in full) |
| A room card is named by all it shows (no `aria-label`), so a screen reader hears the type, seats, status and "shared" | Spec review of the build |

## 14 October 2026: record actions at the bottom of the student and parent panels (task 2.7c-2b-2b)

Plan approved on pull request #85 with correction 1; decisions 1 to 15 confirmed there; 1, 2 and 3 marked Look first. The decisions after 15 came from the build. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (tests changed by a requirement). Page and browser tests that type into a student, relative or parent form press its opener first; a form saved twice is opened again; "Saved." is read in the bottom row; bodies, prompts and refusals stay asserted. The UID test now reads "Saved." in the bottom row and an empty reason when the form opens again | Decision 1; build |
| **Look first** (a pinned list). `PANEL_ACTIONS_LATER` is empty | Decision 2 |
| **Look first** (a pinned list removed). The list and `checkPage`'s `panelActionsLater` are removed: no side panel can skip the check | Decision 3 |
| The student's read view gains the father's name; Edit is the one primary; Leave school and Delete are danger, the other status actions and "Correct the UID" secondary; the openers reuse their forms' titles | Decisions 4 to 6 |
| The record's actions sit under every tab; a record form takes the place of the tabs; a tab change asks and closes an open form | Decision 7 |
| The parent panel has Edit alone; with its form open "Give the number" is secondary, Merge danger, the choices' Cancel is "Close the choices" | Decisions 8, 9 |
| A relative row keeps "Change the link" and "Unlink" (only with another relative linked); the main contact's Unlink opens the choice first (`UnlinkChoiceForm`, named "Unlink <name>", `people.relatives.unlinkLabel`) | Decision 10; build |
| The photo, the mark's Remove and the identity Show stay in their parts; the photo, Remove and the row actions give way while a form is open | Decision 11 |
| `usePanelEditing().point(key)` moves the focus with no form open; the status heading after a status change (the panel returns to Overview), "Add relative" after an unlink, the "deleted" line after a delete | Decision 12 |
| The staff picker's Cancel is quiet; it opens through the panel with the search field drawn at once, the matches waiting on the staff list inside the form; a form of the panel that is not a `RecordForm` carries `data-slot="panel-form"` and takes the focus as it opens | Decision 13; correction 1 |
| A status form is drawn only while its action is allowed, keyed by `version`; after "student changed" the re-read closes a form whose action is gone (in the form's `onStale`, not an effect) and the refusal shows in the bottom row; a form whose action is gone by any other re-read is not drawn and the panel reads as with none open | Decision 14; build |
| The test helper `edit` looks for its button in the bottom row first: "Edit" and the mark's "Change" are both "Изменить" in Russian | Build |
| "Cancel the leaving" declined says nothing (the mutation is reset); "Saved." follows an at-once action that saved (an unlink without a choice, the mark removed: `point(key, { saved: true })`), as "Cancel the leaving" and the vacancy's close | Spec review of the build |
| A delete refused with "student changed" closes like the other status forms when the re-read takes it away; the focus goes to the status heading; the mark's Remove gives the focus to "Mark as staff member"; the parts of the student panel see a form not drawn as no open form | Spec review of the build |

## 14 October 2026: record actions at the bottom of the staff and vacancy panels (task 2.7c-2b-2a)

Plan approved on pull request #84 with no correction; decisions 1 to 13 confirmed there; 1, 2 and 3 marked Look first. The decisions after 13 came from the build and its spec review. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (a task split). 2.7c-2b-2 is 2.7c-2b-2a (the staff and vacancy panels) and 2.7c-2b-2b (the student and parent panels, `PANEL_ACTIONS_LATER` empty) | Decision 1 |
| **Look first** (tests changed by a requirement). Page and browser tests that type into a staff, account, availability or vacancy form press Edit or the section's button first; a form saved twice in one test is opened again; "Saved." is read in the bottom row after the form closes; bodies, prompts and refusals stay asserted | Decision 2; build |
| **Look first** (a pinned list). `PANEL_ACTIONS_LATER` shrinks to `people-students` and `people-parents` | Decision 3 |
| The staff read view shows every field of the record with its form's label; Edit is the primary for `rights.contact`; "Change status" is secondary at the bottom, with no danger action | Decisions 4, 5 |
| The photo and sign-in access actions stay in their parts and give way (`quiet`) while any form of the panel is open; the openers of the other sections stay drawn, as the floor rows of 2.7c-2b-1, and ask `useLeave()` first | Decision 6; build, spec review |
| The vacancy: Edit, Close or Reopen, Delete; a form's "Saved." goes once a close, a reopen or a delete starts, and a form opened resets them (`AvailabilitySection`'s `onOpen`) | Decision 7; build, spec review |
| "Give a role" behind its button; the role rows' "Change subjects" and "End" open their form in the section | Decision 8 |
| `AvailabilitySection` takes `panel`, its Cancel and "Saved." are the shared ones, `people.availability.cancel` is gone; Cancel also takes the last refusal away | Decision 9; build |
| `SECTION_FILES` in the source check; a wrapper (`CreateAccount`) holds its form only when every element of it in the file is held | Decision 10 |
| `usePanelEditing().stop({ focus })`: a save that takes its own button away (an account created, a role ended, a role's subjects changed) gives the focus to the account section's heading; the first-password slip has it while open | Decision 11; build |
| The status form is drawn below the status and its history, in the read view's place | Build |
| The Branches section holds its title and "Change branches"; the teaching opener is "Change subjects and languages", switched off with its reason without an Academic department | Decisions 12, 13 |

## 13 October 2026: record actions at the bottom of the side panel (task 2.7c-2b-1)

Plan approved on pull request #83 with corrections 1 and 2; decisions 1 to 12 confirmed there; 1, 2 and 3 marked Look first. The decisions after 12 came from the build. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (a task split). 2.7c-2b is 2.7c-2b-1 (the parts, the browser check, the School setup panels and the sample) and 2.7c-2b-2 (the People panels: staff with its Save buttons and account parts, students, parents, vacancies) | Decision 1 |
| **Look first** (tests changed by a requirement). Page and browser tests that type into a panel form press Edit or the section's button first; a form's "Saved." is read in the bottom row after the form closes, and the focus after a save is on the opener (the sample's "focus stays in the field" test now reads that) | Decision 2; build |
| **Look first** (a pinned list). `PANEL_ACTIONS_LATER` exempts the four People lists from the panel check of `checkPage` until 2.7c-2b-2 | Decision 3 |
| A panel reads first; one form open at a time (`usePanelEditing`); record actions in the bottom row, a part's actions in its section; the sections give way while the record's own form is open | Decisions 4 to 6 |
| Archive is danger at the bottom, Restore secondary; Cancel is in `RecordForm` and asks about that form only; after a save the read view with "Saved." and the focus on the opener | Decisions 7 to 9; build |
| `data-variant` on the Button part; the Room panel has no danger action; the template setting's one action keeps "End from a date" | Decisions 10 to 12 |
| A form of the record (a new length, new slots) takes the read view's place like Edit, so its Save and Cancel are the panel's last part | Build |
| `usePanelEditing` finds the opener and the first field in the open side panel (`[data-slot="side-panel"]` of `SidePanel`), not through a ref: a ref in its state made every read of it during drawing a lint error | Build; spec review |
| A late save closes only its own form (`stop({ saved: true, key })`); a form whose state the panel keeps is reset as it opens again, so it never shows the "Saved." of its last save | Spec review |
| **Look first** (a test changed by a requirement). `feedback.test.tsx` finds the side panel behind the open feedback dialog by its element: the panel reads first and no longer holds the live region of a form, so the modal dialog hides it from the accessibility tree, as it should | Build |
| The openers "Add floor" and "Add department" reuse `setup.buildings.addFloor` and `setup.divisions.addDepartment` (also the title of their form) instead of the new keys the plan named | Build |
| The e2e seed adds to the pages branch a weekday template setting, a day off a month ahead and the division "Pages division", so each panel's form is opened in the browser check | Build |

## 13 October 2026: new records in the side panel (task 2.7c-2a)

Plan approved on pull request #81 with correction 1; decisions 1 to 11 confirmed there, 10 changed by the correction; 1 and 2 marked Look first. The decisions after 11 came from the build. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (a task split). 2.7c-2 is 2.7c-2a (new records and the bulk leaving in the side panel, checkboxes at phone width) and 2.7c-2b (the side panels' actions at the bottom, the staff panel's five Save buttons) | Decision 1 |
| **Look first** (tests changed by a requirement). The page tests find the new form in the side panel instead of above the list; request bodies, prompts and refusal tests stay | Decision 2 |
| The new record is page state (`useNewRecord`), not the address; "New …" over an open record replaces it after `useLeave()`; a record that the address brings (a row, Back, a link) replaces the new record | Decisions 3, 5, 11 |
| After a save the panel shows the saved record: the list's query is read again first, then `saved(id)` writes `open` through the list | Decision 4 |
| The consent filter of Students is turned off only when the saved student has consent; no other filter or search is touched | Correction 1 |
| The bulk "Leave school" is in the side panel; its title names how many, the names stay in the confirmation; "Restore this student" opens the holder in the panel in place of the new form, after `useLeave()` | Decision 6; build |
| The quiet "Cancel" stays under each new form; the focus goes to the panel's heading when it opens and back to "New …" after a close without a save | Decision 7; build |
| Every checkbox sits in a label with `CHECKBOX_TARGET` (44 × 44 below 640 px); the box stays 16 px | Decision 8 |
| The header's "New …" stays primary on the list pages | Decision 9 |
| The browser check of the Super Admin's new records runs in the pages test's branch: the floor of its own test's branch is archived by then and "Add room" needs one | Build |

## 13 October 2026: the page sweep (task 2.7c-1)

Plan approved on pull request #80 with corrections 1 to 3; decisions 1 to 15 confirmed there; 1, 3, 9 and 10 and the tests changed by a requirement marked Look first. The decisions after 15 came from the build. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (a task split). 2.7c is 2.7c-1 (this sweep), 2.7c-2 (new records and record actions in the side panel, checkboxes at phone width) and 2.7c-3 (Rooms "By floor", the Branches list) | Decision 1 |
| **Look first** (tests changed by a requirement). `access.test.tsx` and `e2e/access.spec.ts` read the new short `home.*` lines, one per kind; the "No class" tile test asserts the tiles only, without the line; the template-table test reads "11 cells change." and the info tint; `branch-page.test.tsx` finds the form in the side panel | #39 item 4, finding 12, decision 5 |
| **Look first** (`12`, Look and feel). Home is the empty page with one short line per kind and no action until its tasks fill it; the Academic Vice Principal's home shows its tiles, and the empty page once both count 0. Proposed `/spec-change` of `12`: "Empty pages say what the page is for and offer the first action where there is one." | Decision 3, correction 1 |
| **Look first** (the owner's design system). The People tabs stay underline tabs; line the owner may add to Layout shell: "Sections of one page are tabs: a 2 px navy line under the chosen one, Control type, 44 high at phone width." | Decision 9 |
| **Look first** (the owner's design system). The audit page keeps its labelled date and select fields and its "Clear"; "Reset" and `list.clearSearch` are left to the owner | Decision 10 |
| Every h2 and h3 under `features/` and `components/` is `SECTION_TITLE`, every h4 `SUBSECTION_TITLE`, also in the personal data report and its printout; only `page-header.tsx`, `states.tsx` and the first-password slip draw their own | Decisions 6, 12; build |
| Large buttons only on the sign-in frame (`sign-in-page.tsx` among its files); `password-page.tsx` and `second-step-set-up.tsx` take the size from where they are drawn (`FRAME_BUTTON_SIZE`, a `size` property); on the frame their fields are 48 high and a quiet button under the large one is large too | Decision 13; build |
| Small buttons only in tables and the selection bar: the panel actions, the photo buttons, "Add phone", the retries and "Change availability" are the default size; a floor's and a department's "Archive" are the danger kind | Plan item 2; build |
| Panel padding 24 at every width; 24 between panels, between a list and its side panel and between the Home tiles | Decision 4, correction 2 |
| The changed cell of the template table is the info tint with the `edit` icon, a hidden word and the legend "Changes with this save" (the preview is of any change, not only a template); the count reads "11 cells change." | Decision 5; build |
| An account with no role sees the empty page with "Your account has no role yet." | Build |
| A list's column may shrink below its table (`grid-cols-1`) and a segmented control wraps: the browser check found the student panel pushed past the page at 1440 px; the read-only travel-time table scrolls inside its panel (`min-w-0`) | Build, browser check |
| The browser check measures the Button part (`[data-slot="button"]`): 32 or 40 high on a desktop, 44 at phone width, 48 only on the sign-in frame; a link drawn as a button and the name button of a row are not measured | Build; spec review |
| The e2e branch of `pages` holds a vacancy and its log entry, so the Vacancies and Audit log lists open a record too | Spec review |
| The e2e account `pages` is an Academic Vice Principal and a Teacher of a branch of its own; the Super Admin's pages are checked at the end of the first Super Admin test; its second sign-in uses a recovery code | Decision 8; build |

## 13 October 2026: smaller UX (task 2.7b-2)

Plan approved on pull request #79 with corrections 1 to 3; decisions 1 to 10 confirmed there; 1, 2 and 4 marked Look first. The decisions after 10 came from the build and its review. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (tests changed by a requirement). The sample-list and list tests of a bar with disabled actions and "0 rows selected." were replaced by tests of no bar until a tick; `patterns.spec.ts` reads the count from the bar's own element; the checklist and weekday tests read the new words; every replaced assertion has one for the new behaviour | Decision 1; findings 13, 17, 21 |
| **Look first** (spec text, `12`, No lost work). A checkbox group that must hold one choice says so on Save, not as it is ticked; typed fields still check as typed. Proposed `/spec-change`: "Forms check each field as it is typed and say in plain words what to fix; a choice that must hold at least one item says so when the form is saved." | Decision 2; the owner's confirmation of 13 October |
| **Look first** (the owner's design system). Below 1280 px the search and feedback buttons of the top bar are icons named by their words; `docs/design-system.md` is not edited. Line the owner may add to Top bar: "Below 1280 px the search and any button with a word become icon buttons." | Decision 4 |
| A list leaves out its `narrow` columns below 1280 px unless ticked in the column chooser (kept in `sodiq.list.<id>.shown`); they stay in the export and the side panel. Only Rooms (Building, Floor) has them | Decision 3 |
| `photo_invalid` reads "Choose a JPEG or PNG photo, up to 5 MB." | Decision 5 |
| On a phone the Super Admin's alerts are one line with Show/Hide, open only while the tab lives | Decision 6 |
| A form keyed by the record follows a new `initial` while nothing is typed (`followInitial`); typing is never overwritten | Decision 7, correction 3 |
| Closing and reopening a vacancy ask nothing; they show "Saved." | Decision 8 |
| Cancel in the phone-taken choices keeps the edit's phone and asks before dropping a typed previous phone | Decision 9 |
| A group with too few choices says "Choose at least one."; the grades of a staff or vacancy subject "Choose at least one grade." under that subject; the subjects of an appointment "Choose at least one subject." | Decision 10, correction 2 |
| The e2e account `topBar` is an Academic Vice Principal and a Teacher of two branches, not a Super Admin: the seed already holds the three Super Admins allowed. The alerts line is proved by the unit tests | Build |
| A `checkedOnSave` field shows its message only when it was drawn and wrong at a press of Save; one that turns wrong later, or is taken away and drawn again, waits for the next Save. The languages of the teaching and vacancy forms are such a group ("Choose at least one.") | Spec review of the build |
| The search and feedback icon buttons are 40 × 40 from 640 to 1279 px (44 below 640), so the top bar stays 64 high; the role select may be 288 px wide | Spec review of the build; `docs/design-system.md`, Top bar and Buttons |
| Cancel in the phone-taken choices is off while a merge or a new owner is on its way | Spec review of the build |
| The Show/Hide of the phone alerts line is a plain button in the alert's own colour, as the branch names of the vice principal alert: a quiet button would add a hover colour on the warning tint with no checked contrast pair | Spec review of the build |

## 13 October 2026: formats (task 2.7b-1)

Plan approved on pull request #78 with corrections 1 to 5; decisions 1 to 10 confirmed there; 1 to 3 marked Look first. The decisions after 10 came from the build and its review. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (split). 2.7b is split into 2.7b-1 (formats, this) and 2.7b-2 (smaller UX) | Decision 1 |
| **Look first** (spec text, `04`). Grades are shown as ranges ("5–11; 1–4, 7"); people are surname first in every list, picker and export | Decisions 2 and 3; findings 19 and 27, the owner's answer to 27 |
| **Look first** (tests changed by a decision). The expected names, grades, phones, the rooms export's Shared cells and "Quarters not set" texts of the web, API and browser tests became the new formats; no assertion was removed | Owner's answer to 27, findings 15, 19, 20, 24 |
| A phone is grouped only when it is "+998" and nine digits; any other is shown as stored | Decision 4 |
| A branch phone is "+998" and nine digits; migration 0041 rewrote the stored ones (cleared what was not a number) with a `branch.edit` entry of the system each, then a valid `branches_phone_format` | Decision 5, "Decided ahead for tasks 2.2d and 2.7", item 10 |
| Browser names come from a small function, no library; the raw string when neither part is known | Decision 6 |
| The UID set comes from the server as `expected` on the `uid_set` detail; the year rule is `uidYearOf` in `packages/shared` | Decision 7 |
| Exports keep real numbers: "Quarters not set" stays a number, the rooms' lessons at once a number column beside Shared (Yes/No) | Decisions 8 and 10 |
| A time after midnight reads "00:15 (next day)"; the form refuses such a day before sending, with the rule engine's `dayEndsAfterMidnight` | Decision 9 |
| `ListPage` takes `panelName`: the side panel and the sentences inside it keep "First name Surname" while the row is surname first | Spec review of the build |
| Relatives' names are not reordered: one "Full name" field, stored as typed | Decision 3 |

## 13 October 2026: "Fix first" findings, dates in the app, accessibility and wording (task 2.7a)

Plan approved on pull request #77 with corrections 1 to 3; decisions 1 to 11 confirmed there; 1 and 2 marked Look first. The decisions after 11 came from the build and its review. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (split). 2.7 is split into 2.7a (this), 2.7b (formats and smaller UX), 2.7c (pages against the design system, the Branches list, "By floor", screenshots of every page) and 2.7d (the Super Admin's own staff record) | Decision 1; 40 findings and a sweep of every page do not fit one session |
| **Look first** (spec text). The Branches list waits for its `/spec-change` of `03`; #39 item 6 (forced delete of an unused room, floor or building) goes with 5.8 after its own `/spec-change` | Decision 2; "Decided ahead for tasks 2.2d and 2.7", item 11 |
| **Look first** (tests changed by a decision). The expected English dates of six web tests became day-first (answer 38); the undo's line in `student-statuses.test.ts` became one joined line, its reason asserted in the stored row and the audit entry | Correction 1 and 3 of the review of the plan |
| Every date and time of the web app comes from `apps/web/src/lib/dates.ts`; a lint rule refuses `Intl.DateTimeFormat` and `toLocale…String` elsewhere in `src` | Decisions 3, 4 and 10; finding 3 |
| Uzbek month and weekday names are i18n keys (`dates.months`, `dates.weekdays`); English is `en-GB` with the 24-hour clock and its short month from the app's names ("Sep", never "Sept") | Decisions 3 and 4; answer 38; spec review of the build |
| A page of one area opens only when an assignment of the person permits it in the branch of the tab, read as the server reads it; otherwise the full-page "no access" inside the layout. A refused part of a page says "Your role may not see this." | Decision 5; spec review of the build |
| A leaving taken back (cancel, undo) is one line in the status history of the record; the rows, the reason and the audit entry keep it; the personal data report keeps the raw rows | Decision 6, correction 3 |
| The sign-in slogan steps 28 / 34, 40 / 44, 56 / 58 by the room of its panel; the hexagon column is 48 wide below 1280 px and hidden below 768 px | Decision 9 as changed by correction 2 and the spec review of the build; differences from the shared `docs/design-system.md` named in the report |
| "Save failed" ends when the refused form changes, saves, resets or closes; a save the person stopped before it was sent is "not saved", not "failed" | Finding 10 |
| A switched-off checkbox is greyed and never changes the form | Finding 2 |

## 13 October 2026: the personal data report per person (task 2.6b)

Plan approved on pull request #76 with corrections 1 to 3; decisions 1 to 11 confirmed there (7 changed by correction 1); 1 and 2 marked Look first. The decisions after 11 came from the build and its reviews. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (personal data across branches). A staff member's or relative's report produced in one branch holds their data of every branch (availability and roles; links to students of other branches with name, UID and branch) | Decision 1; `edge`: "a personal data report per person", "The Super Admin reads all" |
| **Look first** (security definer). `personal_data_relatives(student)` answers every relative ever linked to a student, live link or not, called only after the student is found in the branch of the request; the relative with no live link has no report of their own | Decision 2; `edge`: "a copy of everything held about their child" |
| New area `personal_data_report`, `export` for the Super Admin only; the routes also require a current Super Admin assignment, which the entry names | Decision 3; permission review of the build |
| The path id is checked against the branch of the request (a student of it, a staff member linked to it, a relative live-linked in it), 404 otherwise, a vacancy included | Decision 4 |
| The report's entry is in the branch's `audit_log` with the person's record and `person_id`; details hold the parts and the entry counts, not the content | Decision 5 |
| Every field and history of the record, ended links and roles, dated subjects of an appointment, last sign-in and "never used"; no hash, secret, recovery code or token; sessions and trusted devices left out | Decision 6; spec review of the build |
| Entries about the person: `person_id`, the person's record, a staff member's account and assignments, their own `auth.*`, and the person's id in the values (`VALUE_MATCHES`); not the entries where they are only the actor | Decision 7 as changed by correction 1 |
| In a relative's report, an entry whose record is another relative shows neither that relative's values nor their name | Permission review of the build: the report is handed to the person |
| One open of the page, one report and one entry; the answer in no cache and outside the offline queue | Decision 8 |
| A4, the letterhead in the header group of the sheet's table, repeated on each printed page; Golos Text, navy | Decision 9 |
| The language of the page; moments in the time zone of the branch of the request | Decision 10 |
| At most 2,000 entries, newest first, with the count and the oldest moment of the rest | Decision 11, correction 2 |
| The browser test runs as the second half of the first setup test's session | The seed holds at most three Super Admins (`MAX_SUPER_ADMINS`), all taken by setup tests (as `createAccountAndSignIn`) |

## 13 October 2026: the audit log screen, its reading rights and the own sign-in history (task 2.6a)

Plan approved on pull request #75 with corrections 1 to 4; decisions 1 to 13 confirmed there; 1, 3 and 12 marked Look first. The decisions after 13 came from the build and its reviews. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Task 2.6 is split: 2.6a (the log screen, its rights, hidden fields, own sign-in history, export rules) and 2.6b (the personal data report per person) | Decision 1; the report draws on every people record |
| **Look first** (personal data across branches). The Principal and the Academic Vice Principal read the branch's `audit_log`, the `audit_log_school` entries whose `details.branchId` is the branch, and the record entries of a relative made while a link of that relative to a student of the branch was live; not sign-ins, school-wide account events or school setup. Proposed `/spec-change` for `edge/people-roles-accounts`, "Who may read the audit log": "… the Principal and Academic Vice Principal read their branch, including the changes of a relative made while the relative is linked to a student of the branch; sign-ins and school-wide settings are read by the Super Admin" | Decision 3 with correction 1; `edge/close-relatives`, row 1 |
| **Look first** (personal data across branches). `audit_names(uuid[])`, security definer, answers first and last name only for an account or staff id of any branch; the route calls it with the actor and person ids of the entries it answers | Decision 12; `13`: "who, when" |
| New area `audit_log`, view for the Super Admin, the Principal and the Academic Vice Principal; menu item `audit_log`, icon `history` | Decisions 2 and 9 |
| The Super Admin chooses the log (this branch, all branches, school-wide) from a current Super Admin assignment; the answer says `chooseScope` and the page follows it, not the role on display; dates read in the time zone of the branch of the request | Decision 4; spec review of the build |
| Search by person: a staff member as actor or person, a student or relative by record or person; by record; by school dates, at most 366 days, last 30 by default, the limit checked also when one end is left out | Decision 5; permission review of the build |
| Identity inside an entry is hidden from a reader whose current assignments in the branch do not read `student_identity`, failing closed (every key not known to be outside Identity, nested and snake_case included), and an export's typed search; a Show is logged as `audit.entry_shown` with the shown entry's record and person; nothing is logged when nothing was hidden | Decision 6 |
| The free-text `reason` of an entry is shown to every reader of the entry | An administrator's note, not an Identity field; the Principal already reads the reason of a student's status (permission review of the build) |
| The Show is held to the branch of the request for every reader, the Super Admin included (404 otherwise) | Permission review of the build; `.claude/rules/api.md` |
| Values are shown field by field with the label of the record's form, and stored codes (a sex, a role, a relationship, a status) in the language of the page; keys with no label (ids, technical keys) as stored | Decision 7 as changed by correction 2; spec review of the build |
| Paging: 50 entries, newest first, keyset on `(occurred_at, id)`, "Load more" (`more` of `ListPage`); the list's own search and sorting work on the pages loaded; reading the log is not logged | Decision 8 |
| The own sign-in history reads both logs through `own_sign_in_history`: `auth.*` by actor or account record, `account.*` by account record only; 25 events; the administrator's name but not a lock's reason; refused while a sign-in step is owed | Decisions 10 and 11, correction 3 |
| Every export route is pinned in `exports-logged.test.ts` (routes that require `export` and paths ending in `/export`) and proved to write one entry | Decision 13, correction 4 |
| `AuditEntry.action` is typed `AuditAction` (and `test.*` for the tests of the log, which a test keeps out of the application's code) | Plan review; spec review of the build |

## 13 October 2026: extra phones, the same person and relatives in the export (task 2.5b-2)

Plan approved on pull request #74 with corrections 1 and 2; decisions 1 to 9 confirmed there; 1, 4 and 9 marked Look first. The decisions after 9 came from the build. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first** (a pinned list widened). The student file gains five Contact columns: the main contact's name, relationship, phone and extra phones, and `otherRelatives` (one line per other live relative); written only through a Super Admin or Academic Vice Principal assignment, named in the Principal's `leftOut`; workplace and email not exported | Decision 1; build-plan line; `edge/people-roles-accounts` (Contact is "phones of student and relatives") |
| **Look first.** The mark is `relatives.staff_id`, one relative per staff record (`relatives_staff_idx`), set and removed under `relatives` edit when both records are visible in the branch of the request; the trigger `relatives_same_person_check` refuses a vacancy and a staff record the transaction does not see | Decision 4; `edge/close-relatives`, row 8 |
| **Look first** (personal data across branches). A mark whose staff member is not of the branch is neither shown nor changed there: 409 `same_person_elsewhere` to all but the Super Admin, whose `PUT` and `DELETE` run with every branch in the transaction and name the Super Admin assignment; `same_person_taken` names the holder only when it is linked live in the branch | Decision 9, correction 1 of the review |
| Extra phones are a `text[]` on the record: at most three, the phone shape, none twice, never unique, not read by `relative_by_phone`, `relative_release_phone`, the Parents phone search or a merge's choice of phone; one equal to the main phone is allowed | Decision 2; `edge`, row 5 |
| A change of extra phones only is logged (`relative.edit`) and tells no other branch | Decision 3; `edge`, row 1 tells of "a change of name or phone" |
| A merge keeps the kept record's extra phones and mark, each filled from the other when the kept has none; the merged record is emptied (`relatives_merged_empty_check`); two different marks 422 `merge_marks_differ`; a mark to move whose staff record the transaction does not see 403 `merge_needs_super_admin`; `relative.merge` and `relative.merged` carry `extraPhones` and `staffId` | Decision 5 |
| Each record shows the other: the Parent panel to `relatives` view readers when the staff member is of the branch; the staff panel ("Also a parent") to readers who also hold `relatives` view, when the relative is linked live in the branch | Decision 6 |
| The edit requires `extraPhones` (the whole list); a missing field is 400, never a silent clear | Plan review; the earlier tests of the edit send the list |
| The merge locks the staff row of a mark after both relatives, as the routes of the mark lock the relative, then the staff rows in id order, then the branch link `for share` (decision taken in the build) | A mark and a merge of one staff member wait on each other instead of deadlocking |
| **Look first** (a test changed). The test "refuses the second of two merges sharing a record" sent both merges at once and answered 404 or 409 by timing (CI of the plan commit); it became "refuses a later merge of a record already merged" (404, nothing changed); the concurrent case stays proved by the lock pair "a merge that waited on another merge of the same record" | Decision taken in the build; a test must not depend on timing |
| The Super Admin's detail of a relative carries `samePersonElsewhere` (no name) when a mark names a staff member not of the branch, and the Parent panel offers Change and Remove for it (spec review of the build) | Correction 1: the Super Admin can remove such a mark from the screen, so the Academic Vice Principal's text "ask the Super Admin" names a step that works |
| A staff member marked with a relative not linked in the branch is refused 409 `same_person_held_elsewhere`, with no holder named; `same_person_taken` names a holder of the branch with its real count of students (spec review of the build) | An error text is true on every path (`.claude/rules/web.md`) |
| A merge refuses 403 `merge_needs_super_admin` before `merge_marks_differ` when a mark names a staff member not of the branch, and names the Super Admin assignment for that part (permission review) | Nothing of another branch's mark is told; the entry names the assignment that allowed the part |
| The routes of the mark read the staff member's branch link after locking the staff row, `for share`; the body's staff id is checked against the branch before its row is locked (permission and spec reviews) | `.claude/rules/database.md`; `.claude/rules/api.md` |
| The staff picker lists every person of the branch's staff list, whatever the status, but the one already marked; the section is left out for a reader who may not edit when nothing is marked; an added but empty extra phone is refused, not dropped (decisions taken in the build) | A mark records a person, not an employment; nothing to show; nothing typed is lost silently |

## 13 October 2026: phone owners, merge and the notice to the other branch (task 2.5b-1)

Plan approved on pull request #73 with corrections 1 to 3; decisions 1 to 11 confirmed there; 1, 2, 5 to 9 marked Look first. The decisions after 11 came from the build. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Task 2.5b split into 2.5b-1 (new owner, no valid phone, merge, the notice) and 2.5b-2 (extra phones, the same person, relatives in the export) | Decision 1; each is a flow of its own; 2.5b-1 carries the whole done-when |
| **Look first.** `relative_release_phone` (definer) gives the holder of an exact phone, visible to the branch or not, a new phone or "no valid phone", and nothing else of the record; it answers the notice targets; the branch of the request must be one of the transaction's | Decision 2, correction 3; `edge`, row 2 |
| **Look first.** `relative_notice_accounts` (definer) names a current Academic Vice Principal of each other branch where the relative is linked live, ids only, compared with the branch of the request | Decision 5; `edge`, row 1 |
| **Look first.** The record whose phone stays stays (id and Parent account); the name is chosen; workplace and email filled from the other when empty; links moved as an unlink and a new link with the same fields; a student linked to both keeps the kept link, the main mark on it; the merged record emptied, `merged_into`, archived, its account off, never linked again; the kept phone must be a phone | Decision 6, corrections 1 and 2; `edge`, row 3 |
| **Look first.** A merge is across branches when either record has a live link outside the branch of the request: only the Super Admin, with every branch in the transaction; each moved link's entry in its own branch's log | Decision 7; `edge`, row 3 |
| **Look first.** On a refused phone change: "Merge" when the holder is linked live in the branch and neither record has a live link outside it (code review 1, finding 2; any branch for the Super Admin), and always "the number has a new owner"; proposed `/spec-change` for `edge/close-relatives`, row 3: "When a phone change is refused because the number exists, 'Merge' is offered while the holder is linked to a student, and 'different person, the number has a new owner' always." | Decision 8 |
| **Look first.** `student_relatives_not_merged` (definer trigger) locks the relative, then reads `merged_into`; a merge that meets a link of a student it did not lock, or a phone other than shown, is refused `relative_changed` | Decision 9 |
| **Look first** (personal data across branches). The merge notice carries the names both records had and the name that stays (`keptName`, `mergedName`, `fullName`), also to the Academic Vice Principal of a branch where only the kept record is linked, which could not open the merged record (spec review of the build; code review 1, finding 6) | The other branch knew the kept record by its old name. The spec's row 1 tells the other branch of "a change of name or phone" of its relative; a merge changes both of the kept record (its name may become the merged one's, and its phone may be the merged one's). The merged record's name is the one thing that lets that branch see who its parent was joined with and catch a wrong merge of two different people; no phone, student or other field of the merged record is sent |
| "No valid phone" is `phone_invalid_since` with an empty phone, set only by the definer function and cleared by a trigger when a phone is written; listed (Parents filter, home tile) while a student of the branch is active today | Decision 3; `edge`, row 2 |
| The new-owner choice is for the holders of `relatives` create; the entry names that assignment | Decisions 4 and 11 |
| The new owner runs after the student's lock; the earlier relative's new number is claimed before the matched one; a deadlock is answered 409 `relative_changed` | Decision 10 |
| Three notification kinds (`relative.renamed`, `relative.phone_changed`, `relative.merged`) instead of one kind with a list of what changed (decision taken in the build) | A kind's data are the `{{names}}` of its text and choose no text (`NOTIFICATION_KINDS`); one notice per change says what changed in every language |
| The id of the holder for a merge or a new owner on a refused edit is read by the phone match on the screen (decision taken in the build) | The refused change gives the id only when the holder is visible in the branch (2.5a, correction 7) |
| The answer of a Super Admin's merge counts the students of other branches against the branch of the request (decision taken in the build) | Its transaction holds every branch |
| The record of the path of a merge must be linked live in the branch of the request, also for the Super Admin; only the other record may be elsewhere (permission review) | `.claude/rules/api.md`: a path id outside the branch of the request is 404 |
| A new owner given on an edit needs the phone it takes; otherwise 422 `request_refused` (permission review) | A release that did not happen is never shown |
| The plan's names changed in the build: the list query is `filter=no_valid_phone` (not `noValidPhone=true`), the answer field `phoneInvalidSince` (not `phoneInvalid`), and `student_relatives_not_merged` locks `for update` (not `for share`) | A filter of the shape of the student list's; the moment says since when; a share lock then the update lock of `relatives_follow_links` would deadlock two links of one relative |
| A merged record's Parent account is held off by a trigger of its own (`relative_accounts_merged_off`), and the check that a merged record has no live link reads every branch (definer) (spec review of the build) | Correction 2 must outlive the check of 0036 that Release 2 drops; a check of a rule must not depend on the row filter |
| Every link a merge ends is in the log: `relative.link_moved` for a moved one, `relative.unlink` with `mergedInto` for the merged record's link of a student linked to both (spec review of the build) | Every change is audited |

## 13 October 2026: close relatives, their links and the Parents list (task 2.5a)

Plan approved on pull request #72 with corrections 1 and 2; decisions 1 to 16 and 18 confirmed there, decision 17 changed by correction 1; 1 to 6 marked Look first. The decisions after 18 came from the build. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Task 2.5 split into 2.5a (record, links, Parents list) and 2.5b (new owner of a phone, merge, the notice to the other branch, extra phones, the same person, relatives in the export) | Decision 1; each is a flow of its own; the precedents of 2.2, 2.3c and 2.4 |
| **Look first.** `relatives` and `relative_accounts` have no branch and are filtered by membership through the live links of the branch table `student_relatives` (policy `relative_membership`); the pinned check of `MEMBERSHIP_FILTERED_TABLES` names a policy per entry, the staff entries unchanged | Decision 2; `edge`: "Staff can open a relative only if a student of their own branch is linked" |
| **Look first.** `relative_by_phone` answers the id, name and count of linked students of the holder of an exact phone in any branch (archived included), `relative_links_elsewhere` a count, `relatives_follow_links` archives and restores; a departure from correction 2 of #53, limited to the exact phone in routes held by `relatives` create or edit | Decision 3; `04`: "the system shows the person"; "that relative is shown" |
| **Look first.** New area `relatives`: Super Admin and Academic Vice Principal view, create, edit; Principal view; the links under `students` edit, the tab under `student_contact` view; the phone search refused to the Principal | Decision 4; `edge/people-roles-accounts`; `04`; `02` |
| **Look first.** A relative's workplace and email are read as Identity (the Principal with a logged show); proposed `/spec-change` for `edge/people-roles-accounts`: "Identity (document numbers, address, date of birth, relatives' workplaces and emails)" | Decision 5; the row names "relatives' workplaces" among what a Principal must not simply see |
| **Look first.** A change of name or phone of a relative linked in another branch is saved and logged now; the notice to that branch's Academic Vice Principal comes with 2.5b | Decision 6 |
| The Parents list shows the main phone; the student list still shows none | Decision 7 |
| "No phone of their own" is an empty phone: no sign-in and no notices (`receivesNotices` of packages/shared reads the switch and the phone); 2.5b's "no valid phone" is a column of its own | Decision 8 |
| One phone shape for people (`^\+[0-9]{7,15}$`, +998 offered); the "cannot receive SMS" warning of answer 24 is a warning only | Decision 9 |
| A link is unlinked once and kept (`student_relatives_unlink_once`); the delete of a student created twice removes its links by cascade and archives a relative left with none | Decision 10 |
| A student of 2.4a with no relative is refused only the edit of the record (`student_needs_relative`) until one is linked; a photo, a status, a UID correction and the branch move pass | Decision 11 |
| Exactly one main contact per student; a new main contact moves the mark in one change; unlinking it names the next one in the same request; the only relative is the main contact automatically | Decision 12; `edge` |
| Portal access and "receives notices" on by default, stored only in Release 1 | Decision 13 |
| A link restores an archived relative found by phone | Decision 14 |
| One full-name field, Latin or Cyrillic, folded by `spellingKey` for search (moved with the other name helpers to `packages/shared/src/names.ts`) | Decision 15; answer 18 |
| A relative with no phone of their own may be the main contact, with a warning | Decision 16 |
| The record entries of a relative (`relative.create`, `edit`, `archive`, `restore`) go to `audit_log_school` with the branch of the request in `details`; the link entries and `relative.show` to the branch's log | Decision 17 as changed by correction 1; 0.5a: `audit_log_school` holds "relatives" |
| A link confirmed by phone carries the id the match showed and is refused `relative_phone_changed` when the phone moved | Decision 18 |
| A relative is committed only with its account and a live link (`relatives_complete_check`) | Correction 2 |
| The create form of a student takes one relative, the main contact; more are added on the Relatives tab (decision taken in the build) | The spec needs at least one; one form step keeps the create form short |
| An empty list of relatives is answered 422 `student_needs_relative` by the route; "exactly one main contact" and "no person twice" are schema refusals (decision taken in the build) | The code of the plan for "without one" |
| A `relative_phone_exists` refusal names the holder (id, name, count); the form then offers that person and the next save links them, in place of a `confirmExisting` flag (decision taken in the build) | One way to link: `kind: 'existing'` with the phone it was found by |
| The error detail of a refused phone carries `holder` (name and count of linked students) (decision taken in the build) | "that relative is shown" without an id of another branch |
| The link guard fires on insert and on an update of `main_contact` or `unlinked_at`, not on the branch move's cascade (decision taken in the build) | The move of 3.3 changes no link's state |
| The archive and restore entries are decided by the service under the relative's lock, counting the live links of every branch (decision taken in the build) | The trigger cannot write an audit entry with the actor and request |
| The guard of a student's edit leaves out the grade, which a return also writes; the edit writes every column at once, so it still fires (spec review of the build) | Decision 11: a return of a student of 2.4a passes |
| The delete of a student created twice keeps its links in the `student.delete` entry and writes `relative.archive` for each relative left with none, decided under the relative's lock (spec review of the build) | Every change is audited; decision 10 |
| `receives notices` is shown off and locked for a relative with no phone of their own; the stored switch is sent as it was (spec review of the build) | Decision 8 |

## 13 October 2026: student export, photos, consent list and the "No class" counter (task 2.4b-2)

Plan approved on pull request #70 with corrections 1 to 3; decisions 1 to 10 confirmed there, 3 with correction 3, 8 with correction 1; 1 to 4 marked Look first. The decisions after 10 came from the build. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** `students` gains `export` for the Super Admin, the Academic Vice Principal and the Principal; Tutors with their class scope in 3.1; the Spiritual VP, the Head Tutor and the Head Teachers none | Decision 1; `edge`: "Exports are allowed, without identity documents"; `02`: "view only" |
| **Look first.** Contact, Identity and Financial fields go only into export-only columns, chosen by group under "Also export" and off by default; the list still shows no phone | Decision 2; `04`: "Phone numbers are not shown in the list"; `edge`: "Whole-branch exports with contact or identity fields are for the Super Admin and Academic Vice Principal" |
| **Look first.** Contact and Identity are refused to every exporter but the Super Admin and the Academic Vice Principal on ticked rows too, decided from every current assignment that counts in the branch of the request; proposed `/spec-change` for `edge/people-roles-accounts`: "Exports with contact or identity fields, of the whole branch or of ticked rows, are for the Super Admin and Academic Vice Principal." | Decision 3 with correction 3; 2.2c-1 decision 4 |
| **Look first.** `STUDENT_PHOTO_ROUTE` is the third entry of `FILE_ROUTES` and of the pinned list of `file-routes.test.ts` | Decision 4; answer 2: "one upload route per photo kind" |
| The export follows 2.2c-1: ticked or matching rows, at most 5,000 ids, a synchronous file in the account's language, no request key, the audit entry with filters, columns, `leftOut`, selection and rows | Decision 5 |
| `groups` and `tutor` are `exported: false` until 3.1 and 3.2; the class cell writes the list's "Grade 7, no class" | Decision 6 |
| Student photos as 2.2c-2: set and removed under `students` `edit`, read under `students` `view`, not audited when read; the object stays in the bucket | Decision 7 |
| The consent list is the list filter "Active, no consent" for the Financial readers; the list route answers `consent=missing` to them only and refuses it 403 to others; the page asks the server for it | Decision 8, correction 1 |
| The "No class" counter is `GET people/students/no-class`, the students active today (before the start date included) with no class, on the Academic Vice Principal's home only, hidden at 0 | Decisions 9, 10 |
| The export-only columns are one key per cell (`documentType`, `documentNumber`, `contractNumber`, `contractSignedOn`, `scholarshipType`, `scholarshipCoverage`, `scholarshipAmount`) rather than the plan's grouped `document`, `contract` and `scholarship`; "More basic fields" adds the paternal name, sex, grade and start date (decision taken in the build) | One heading per column ties each heading to the field of the profile in `export-texts.test.ts` |
| The photo `PUT` answers 204 and the page reads the record again, where the staff photo answers the record (decision taken in the build) | The student record is read with the groups of the reader; one read path |
| The audit entry of a file names the assignment of its narrowest group written: Identity, then Contact, then Financial; a file of Basic columns names the route's own (decision taken in the build) | `.claude/rules/api.md`: "the audit entry names the assignment that allowed that part" |
| The panel photo sits above the profile tabs, as the staff panel has it, not inside Overview (decision taken in the build, spec review) | The photo is Basic and names the person on every tab |
| The "Also export" choice counts and sends only the groups offered now; a group no longer offered (another branch) drops out (decision taken in the build, spec review) | `.claude/rules/web.md`: a choice kept in state follows the options of its query |

## 12 October 2026: leaving, return and delete (task 2.4b-1)

Plan approved on pull request #68 with corrections 1 to 3; decisions 1 to 13 confirmed there, decision 14 added by correction 2; 1 to 4 marked Look first. The decisions after 14 came from the build. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** 2.4b split into 2.4b-1 (leaving, return, delete) and 2.4b-2 (export, photos, consent list, "No class" counter), with lines added to 3.3, 6.1, 8.2, 8.5, 9.1, 9.2b and 9.5a | Decision 1; the 2.2 and 2.3c precedents |
| **Look first.** `students` gains `archive` for the Super Admin and the Academic Vice Principal (leave, cancel, undo, return, delete); the new area `student_graduates` gives `edit` to the Super Admin alone (the restore of a graduated student) | Decision 2; `02` "Full edit of students"; `edge`: "may delete a student", "The Super Admin restores the student" |
| **Look first.** `student_uids.student_id` is nullable: the key `on delete set null (student_id)` keeps the UIDs of a deleted student reserved for good, with `released_at` written by the trigger `student_uids_release` from `app.now`; `sodiq_app` has no update right on the table | Decision 3; `developer-rules`, Identifiers: "never used twice"; `04`: "never given to another student" |
| **Look first.** The delete of a student created twice is the one exception to "Archive, do not delete": `delete` on `students` only, held by `students_delete_guard`; the contracts, status rows and account go with the student (keys `on delete cascade`); the audit entry keeps all of them | Decision 4; `edge`: "may delete a student only if there is no ... data" |
| The last day of a leaving is the last day as a student, inactive from the next day; a past last day back to the start of the active time in force (the day before the start for a student who never started); a closed year refused by `student_statuses_closed_year_guard`; the closed quarter with 9.2b. A return is dated today or earlier (a gap: a re-enrolment ahead of term is recorded on the first day) | Decision 5 |
| Cancel takes no reason; undo, the restore and the leaving need one (also a check of the database) | Decision 6 |
| The return carries the grade the student comes back to; the UID never changes | Decision 7 |
| "Undo leaving" only for an inactive row in force written by a leaving and still the last row; `cause` records which action wrote each row | Decision 8 |
| The reason of a status row is read by the Financial readers; status, dates and cause are Basic | Decision 9 |
| Nothing to sign out on a leaving while the student account is switched off | Decision 10 |
| "Restore this student" only for an inactive or graduated holder of the branch | Decision 11 |
| The bulk "Leave school": one change and one audit entry per student, the refused ones named | Decision 12 |
| The delete guard refuses a scholarship, a live status row that is not `active` and a second contract; a cancelled or undone leaving blocks nothing | Decision 14 (correction 2) |
| The closed-year guard checks an insert and a change of `valid_until` only, and finds the year by the row's branch: the move of 3.3 carries rows that end in a closed year | Correction 1 |
| `version` is the number of status rows of the student, not the id of the newest one: every change writes at least one row, and a count does not depend on the order of `uuidv7` across connections (decision taken in the build) | Finding 3 of the spec review of the plan; a change made on an older state is `student_changed` |
| The newest contract is the one with the latest id; `created_at` is bookkeeping (decision taken in the build) | Finding 14 of the spec review of the plan |
| A UID of a deleted student of the branch answers the detail `uid_released`, without a holder; one of another branch answers `held_elsewhere` as before (decision taken in the build) | The other branch's rows are not read |
| The "Inactive from …" badge shows the next change of status after the status shown; an adjacent row of the same status (the fill of a cancel or an undo) is none (decision taken in the build) | Finding 9 of the spec review of the plan |
| After the delete the panel says "This student was deleted." and reads nothing more, instead of closing: closing while the form is still saving would ask "Leave without saving?" (decision taken in the build) | `UnsentGuard` |
| The "Inactive from …" badge beside the status of a scheduled leaving differs from `docs/design-system.md` ("What we never do" 4: no tags for plain status): `edge/students-classes-groups` asks for it ("the student shows the current class with a badge"), so the spec wins and the difference is reported here (decision taken in the build, spec review) | The design system: "the spec wins and the difference is reported"; task 2.7 may draw it as a label of "This app" |
| The refusal codes of the plan changed in the build: `return_in_future` became `status_date_future`, one code for the return and the restore; `restore_before_graduation` was added; the texts of `student_not_active`, `leaving_before_start`, `return_too_early` and `student_has_data` were reworded to be true on every path that sends them (decision taken in the build, spec review) | `.claude/rules/web.md`: the text of an error code is true on every path |
| A return and a graduated restore ask for a confirmation naming the student, as a leaving and a delete do; a bulk leaving that meets a failure other than a refusal stops and says how many went through (decisions taken in the build, spec review) | `12`: "Actions that cannot be undone ask for confirmation and name what will be affected" |
| `student_uids_insert_guard` (0034): a UID row is inserted with its student and without a release, by every user (decision taken in the build, spec review) | Decision 3: a UID is released only by the delete of its student |
| The delete of a student created twice removes their status rows and contracts also when they are dated in a closed year: `student_statuses_closed_year_guard` covers insert and update, not the cascade (decision taken at the code review) | Such a student holds no data; the audit entry keeps the removed rows |
| The test "lets the application delete no student row" of 2.4a became "no UID, contract, status or account row": the requirement changed with decision 4 (decision taken in the build, **Look first**) | `CLAUDE.md`: a test changed because a requirement changed is named |

## 12 October 2026: student record, UID and readers (task 2.4a)

Plan approved on pull request #67 with corrections 1 to 6; decisions 1 to 17 confirmed there, 5 changed (correction 2), 4, 16 and 17 marked Look first. Decisions 18 to 21 came from the build. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** 2.4 split into 2.4a (record, UID, readers) and 2.4b (statuses, photos, export), with lines added to 2.5, 3.1 and 3.3 | Decision 1; the 2.2 split precedent |
| **Look first.** Areas `students` (Super Admin and Academic Vice Principal view, create, edit; Principal, Spiritual Vice Principal, Head Tutor, Tutor, Head Teacher, Senior Head Teacher view), `student_contact`, `student_identity`, `student_financial` (the readers of `edge/people-roles-accounts`); the Senior Head Teacher reads students of every branch, each request in its branch; Teachers have no list | Decision 2; `02` roles table; Personal data and the audit log |
| **Look first.** A taken UID, JSHSHIR, document or contract number names its holder only when the holder is a student of the branch; otherwise "a student of another branch". Proposed `/spec-change` for `edge/students-classes-groups`, the Release 1 UID row: "…the message names that student when they are in the same branch, and says \"a student of another branch\" otherwise." | Decision 3; Branch on every row (`CLAUDE.md`) |
| **Look first.** Groups: date of birth, documents, JSHSHIR, address and region in Identity; phone and email in Contact; previous school, diagnostic score and consent with the Financial readers; sex, grade and start date in Basic | Decision 4; the narrowest group that fits |
| **Look first.** `student_duplicate_elsewhere` on `SECURITY_DEFINER_FUNCTIONS`, a boolean only | Decision 16; the duplicate check "across all branches" |
| **Look first.** Unique indexes without `branch_id` on `student_uids.uid`, `students.uid`, JSHSHIR, document number and contract number: an exception to "A unique constraint on a branch table includes `branch_id`" | Decision 17; `developer-rules`, Identifiers; answer 22 |
| The UID set from `uidSetOf(grade, year)`, the year being the branch's academic year of any status that holds the start date, else the first that begins after it; `no_academic_year` when neither exists; without `confirmUidSet` a mismatch is 409 `uid_set_mismatch`; "SI" is display only | Decision 5 as changed by correction 2 |
| A Tutor reads the list and opens no profile until the class scope of 3.1 | Decision 6 |
| Every UID a student held stays reserved to that student for good in `student_uids` (insert only); the current one must be a row of it (deferred key) | Decision 7; correction 1 |
| One folding, `spellingKey` of `packages/shared`, for the stored `name_key` and every list search; a change to it comes with a migration that rewrites `name_key` | Decision 8; answer 18 |
| The student account is a row of `student_accounts` with `switched_on_at` held empty by a check | Decision 9; phone and SMS sign-in from Release 2 |
| Required: names, sex, birth date, grade, start date, UID, contract number and date; the relative comes with 2.5 | Decision 10 |
| Document number unique whatever its type; JSHSHIR unique when filled; a match blocks | Decision 11 |
| Student phone in international format, `+998` offered | Decision 12 |
| Grade, class ("No class") and status filters now; group and language filters with 3.1 and 3.2 | Decision 13 |
| A branch table; the move to another branch in 3.3 is one update of `students.branch_id`, the child keys `on update cascade` carry the rows; `student_statuses` has its own shrink trigger that lets the branch change | Decisions 14, 15 |
| The start date is fixed at the create: the first status row starts there and rows only shrink; `starts_on` is in no update grant (decision taken in the build, code review) | A correction of a start date belongs with the status changes of 2.4b |
| A taken value is 409 `student_value_taken`, not `already_exists`, whose text speaks of a name; `details[].recordId` (an optional field of the shared error detail) names a holder of the branch, `held_elsewhere` otherwise (decision taken in the build) | `.claude/rules/web.md`: the text of an error code is true on every path that sends it |
| The holder of a taken value is looked up after the refused transaction, in a new one through the branch filter (decision taken in the build) | Correction 6; the refused transaction is aborted |
| The profile tabs are the segmented control of the design system inside the panel; a tab of a group the reader cannot see is not drawn, and one tab draws no control (decision taken in the build, spec review) | `04`, "Profile tabs"; only the tabs that have data so far |
| **Look first.** The audit entries `student.create` and `student.edit` hold the identity fields as typed, as the staff entries do; the audit screen of 2.6 must hide them from a reader without the Identity group, or log a show (decision taken in the build, both reviews) | `edge/people-roles-accounts`: the Principal reads the branch's log and sees identity fields only with a logged show |
| Before its start date a student is active: the status shown is the row in force, else the first row after today (decision taken in the build, spec review) | `edge/students-classes-groups`: "An active student with no class is allowed only before their start date" |
| `spellingKey` also writes every h not after s or c as x (Russian х stands for Uzbek x and h: Рахимов is Rahimov); the Russian у of an Uzbek ў is not folded (Уткир stays apart from Ўткир), so u and o stay apart (decision taken in the build, spec review) | Answer 18 names Oʻtkir, O'tkir, Ўткир; folding u into o would merge distinct names in every search |
| The list shows the grade in the Class column ("Grade 7, no class") until classes exist; no Grade column (decision taken in the build, spec review) | `04`: the column order, and "class (grade and name)" |
| A correction writes `students.uid` before its `student_uids` row, the order of the create (decision taken in the build, spec review) | Both meet first on `students_uid_idx`: the second waits and is refused, never a deadlock |
| `studentId` in the body of the duplicate check is a student of the branch, else 404; an index that refuses a value the write did not name answers `request_refused` (decisions taken in the build, reviews) | `.claude/rules/api.md`, ids in the body; no claim about a holder without its value |
| A refusal naming a holder of the branch whom the list does not hold yet says "another student of this branch" and the list is read again; no link in the field message (decision taken in the build, spec review) | A field message is text; the list search finds the student by the UID shown |
| The student phone has the staff check (`^\+[0-9]{7,15}$`), not the plan's stricter one (decision taken in the build) | One phone shape for people; the shared schema is the staff one |

## 12 October 2026: password reset by email and the own photo (task 2.3c-2)

Plan approved on pull request #66 with corrections 1 to 3; decisions 1 to 19 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** `PUBLIC_ROUTES` gains `POST /api/auth/password-reset` and `POST /api/auth/password-reset/confirm` | Decision 1; `02`, build order: "later password reset by email" is in the short list |
| **Look first.** `FILE_ROUTES` gains `PUT /api/auth/photo`, a second upload route for the staff photo kind, with the same types, size and middleware | Decision 2; the build-plan line from 2.2c-2; answer 2 said "one upload route per photo kind" |
| **Look first.** Four `SECURITY DEFINER` functions: `password_reset_allowed` (yes or no for the public request), `password_reset_address` (named in the mail job only, a test holds it), `own_staff_record` (ids only), `last_email_change` (actor and moment only) | Decision 3, corrections 1 and 2; the request, the job and the confirm run with no branch |
| **Look first.** Nobody changes the email of their own record; the Academic Vice Principal changes an email only where `reachingAssignment` (the rule of 2.3c-1) allows, or on a record with no account; name and phone stay as 2.2a built them | Decision 4; the email opens the account. Proposed `/spec-change`: "Phone, email and name are changed by the Super Admin or Academic Vice Principal; the Academic Vice Principal changes an email only for the accounts whose passwords he may reset, and nobody changes the email of their own record." |
| **Look first.** The exception to `.claude/rules/database.md` of 2.3c-1 has a second caller (the email edit) through one function, `account-reach.ts` | Decision 5 |
| **Look first.** An email change closes the open links; the confirm's entry names the last email change; 6.1's report counts resets by email | Decision 6, correction 1. Proposed `/spec-change` at the end of "An administrator resets a teacher's password ...": "A password reset by email that follows a change of the email by somebody else is listed in the same report." |
| The request is by login; one answer (202, no body) for every login, no entry when nothing is made; the timing of the allowed path is an accepted risk | Decisions 7 and 8 |
| A link works one hour from `sent_at`; a job that runs more than an hour after the request makes none; one link per account per 5 minutes; only the newest works; no new link while the newest is still open (unused, not closed, in its hour) | Decisions 9 and 10; the last part from the permission review of the build: a stranger who knows a login could otherwise close a person's link every 5 minutes |
| A link dies when used, superseded, at any password write (administrator, re-hire, own change, email reset), at an email change and at an account lock (so it does not work again after an unlock), and works only while the account is not locked and the person not inactive or left; the columns are set once (trigger) | Decision 11; the lock from the spec review of the build |
| **Look first.** An account that holds a role outside Teacher, Tutor, Head Teacher and Head Tutor (in force or planned) gets a reset link only when its email was last written (`staff.create` or `staff.edit`) by an account that was Super Admin at that moment (`password_reset_allowed`) | The permission review of the build, must-fix 1: an email the Academic Vice Principal wrote on a record without account, or before a stronger role was given, would otherwise open that account |
| **Look first.** Every other account gets a reset link only when its email was last written by an account that was Super Admin at that moment, or by an account that holds an Academic Vice Principal assignment in force at the moment of the request or confirm in a branch where the account holds one of its roles (in force or planned); an email that no entry names (written by hand in the database) opens nothing until a Super Admin saves it once (decision 22) | Code round 1 of the review of #66, finding 1: an email the Academic Vice Principal of one branch wrote, before the account existed or before it moved to another branch, would otherwise open an account he may not reset (edge, Who can act: "... of his branch") |
| The confirm locks the account, then the link, and reads every condition at the transaction's moment | The spec review of the build, must-fix 1: the other writers lock the account and then close the links; the opposite order could deadlock |
| The email reset sets the typed password, ends every session and trusted device with `password_reset`, forgets the failed sign-ins, keeps the second step; the 0.6a "differs from the current one" rule does not apply | Decision 12 |
| The worker makes the token; it is held only in the mail; the token is checked before any Argon2id hash, which runs outside the transaction | Decision 13; must-fix 3 of the plan review |
| `LogMailer` until go-live; `MAIL_OUTBOX_DIR` for the browser tests, refused with `RENDER_GIT_COMMIT`, `TRUST_PROXY=1` or `WEB_FILES` | Decision 14, answer 16 |
| `WEB_ORIGIN` from config (default `http://localhost:5173`), `https://app-test.sodiqschool.uz` for the test API and worker in `render.yaml`; the token in the fragment | Decision 15 |
| `MAIL_TEXTS` in `packages/shared`, the subject tied to the reset page's title | Decision 16 |
| Bitter on `/forgot-password` and `/reset-password` (the sign-in brand moment) | Decision 17 |
| `/api/auth/photo`, `@AnySignedIn()`, the entry in the main branch read again under the lock (a moved main branch runs the work again), no assignment, 404 without a record | Decision 18 |
| Codes `reset_link_invalid` and `reset_link_expired` | Decision 19 |
| The email reset is a module of its own (`PasswordResetEmailModule`), not part of `AuthModule` | Decided in the build: the first-account command and the e2e seed start `AuthModule` without the job queue and the mailer |

## 12 October 2026: locks and resets by an administrator (task 2.3c-1)

Plan approved on pull request #65 with corrections 1 to 5; decisions 1 to 14 confirmed there (decision 10 changed by correction 2). Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Task 2.3c split into 2.3c-1 (locks, administrator resets, the Academic Vice Principal's limits, the never-used report) and 2.3c-2 (email reset, its public routes and mail service, the sign-in link, the own photo, the email-edit question) | Decision 1; two independent halves, the second with public routes |
| **Look first.** New area `account_access`: Super Admin and Academic Vice Principal view and edit, Principal views, every other role nothing; it widens what the Academic Vice Principal does | Decision 2; Who can act: "He may reset passwords and lock accounts only for Teachers, Tutors, Head Teachers and the Head Tutor of his branch" |
| **Look first.** The Academic Vice Principal acts on an account only when every role of it not ended (current or planned) is Teacher, Tutor, Head Teacher or Head Tutor and at least one is in the branch of the request; otherwise 403 `permission_denied` | Decision 3; one account serves every branch, so a lock or a reset reaches all of them |
| **Exception to `.claude/rules/database.md`** (reads of `assignments` keep to `access.branchIds`): `AccountAccess.actingAssignment` reads the target account's roles in every branch. Only the yes or no leaves the server (403, or `can` false), never another branch's role, branch or assignment; a test checks the 403 bodies and the read. The rule file itself is not changed | Decision 3, correction 4 of the review of #65; the check needs every role of the account, and a line in `.claude/rules/` would loosen the loop's rules |
| The Super Admin locks, unlocks and resets every account but their own, and resets any second step but their own; the own check (409 `own_account`) comes before the role check | Decisions 4 and 11; `02`, Accounts and sign-in, the own refusals of 0.6b and 0.6d |
| Only the lock checks the count of active Super Admins (409 `last_super_admin`), under `lockSuperAdmins`, which every change of these routes takes first, before the staff row and the account row | Decision 5 |
| The second-step reset needs a confirmed second step (409 `second_step_off`, checked on the row read under its lock, before anything is removed) and always resets the password in the same transaction; its answer is the slip | Decision 6, corrections 1 and 5 |
| No password reset for a person who has left for good (409 `staff_left`); the lock stays possible | Decision 7 |
| The audit entries keep `account.locked`, `account.unlocked`, `account.password_reset`, `account.second_step_reset`, and name the acting assignment, the person and the branch of the request (so they go to the branch's log) | Decision 8 |
| The reset answers `firstPasswordSlipSchema`, valid until now + 24 hours, shown under the title "Password reset" | Decision 9; answer 15 |
| **Look first.** "Never used": no session since 00:00, in the main branch's time zone, of the start of the person's current employment period (the `valid_from` of the first `active` or `inactive` status after the latest `left` that has begun, else the first status; that `left` while no return follows it), read through `staff_period_start(record_id, at)` (db/migrations/0030, `SECURITY DEFINER`, on `SECURITY_DEFINER_FUNCTIONS`), so that every reader gets the same answer whichever branch link it sees; a person who has left for good is not listed; the account section of 2.3a uses the same rule | Decision 10, correction 2; State from stored moments; the review of the build found the zone read through the row-filtered `staff_branches` |
| New codes `own_account`, `account_already_locked`, `account_not_locked`, `second_step_off`, `account_missing` (409) | Decision 11; each text true on its path |
| No request key; a repeated lock answers 409, a repeated reset issues a new password | Decision 12 |
| The Principal and the Academic Vice Principal see the access state of every account of the branch; buttons only where `can` allows | Decision 13 |
| Decision 14 (no migration) changed by the review of the build: migration 0030 adds `staff_period_start` only | The person-wide moment must not depend on the reader's branch |
| An Academic Vice Principal does not undo a lock made by an account that holds a Super Admin role now (403 `permission_denied`, nothing written, `can.unlock` false); the Super Admin undoes any lock, and an Academic Vice Principal undoes another Academic Vice Principal's | Decided with the review of the build; the spec gives the Academic Vice Principal "lock accounts", not the override of the Super Admin |
| `account_missing` says "Ask the Super Admin to create it", true for both administrators who meet it | Review of the build; `.claude/rules/web.md`, a code's text is true on every path |
| **Look first.** "Locked by" and "Reset by" show the acting account's login always and its name only when its record is readable, as the account section of 2.3a does (correction 1 of #62): a Principal or Academic Vice Principal of north can see the login of a south administrator who locked or reset a person of both branches, and the lock reason | Permission review of the build, should-fix 3; personal data across branches, kept for one rule across both sections; the owner may prefer to hide the login when the name cannot be read |

## 12 October 2026: Head Teachers list and the Academic Vice Principal alert (task 2.3b-2)

Plan approved on pull request #64 with corrections 1 to 3; decisions 1 to 9 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** `branches_without_vice_principal(at)` (`SECURITY DEFINER`, branch ids and names only) on `SECURITY_DEFINER_FUNCTIONS` | Decision 1; the alert's route is school-wide, where the membership filter hides every `staff` row |
| "Active now" for the alert: the Academic Vice Principal assignment of the branch has begun and not ended (a planned end keeps it), the account is not locked, and the linked record is not inactive or left today by `staff_account_blocked` (the check of sign-in, main branch's time zone); statuses planned later do not count yet; an account with no linked record counts as active | Decisions 2 and 3; Who can act: "is ill for three weeks ... or the post is vacant"; the alert and the server never disagree |
| Branches cannot be archived yet; a database test fails when `branches.archived_at` appears, naming the function | Decision 4; the build-plan's "archived branches never" for when the archive comes |
| The Head Teachers list has no side panel; appointing stays on the account section | Decision 5 |
| The tabs of People show when the role views two or more sections | Decision 6 |
| "People" in the menu lists the areas `staff` and `head_teachers`, so Head Teachers and Senior Head Teachers see it | Decision 7; display only, no route permission changes |
| Each branch name in the alert chooses that branch and opens its staff list; the names are drawn in the alert's own foreground, underlined, so no new colour pair | Decision 8; plan review, finding 7 |
| The alert's query is refreshed by role changes, status changes, a branch create and a branch rename; the list's by appointment changes and status changes | Corrections 1 of #64 and findings 5 and 6 of its plan review |

## 12 October 2026: Head Teacher appointments and subject scope (task 2.3b-1)

Plan approved on pull request #63 with corrections 1 to 4; decisions 1 to 14 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Task 2.3b split into 2.3b-1 (appointments, constraints, subject scope, the scoped list route) and 2.3b-2 (the Head Teachers section of People, the Academic Vice Principal alert) | Decision 1; one migration with three triggers and two exclusion constraints, a guard change and four routes |
| **Look first.** `assignment_subjects` in `SCHOOL_WIDE_TABLES` and `SCHOOL_WIDE_WITH_BRANCH`; `assignments_subjects_end()` in `SECURITY_DEFINER_FUNCTIONS` | Decision 2; read with the assignments before a branch is known; the mirror writes rows the application cannot update |
| **Look first.** An appointment is one assignment with a fixed list of subjects in `assignment_subjects`, with its dates mirrored, so exclusion constraints hold one holder per subject | Decision 3; Who can act: "person, role, branch, and where needed subjects ... with dates" |
| **Look first.** At most one Senior Head Teacher per subject; proposed `/spec-change` of `02`, Senior Head Teacher: "... which can be all subjects. A subject has at most one Senior Head Teacher at a time." | Decision 4; `02` speaks of "the Senior Head Teacher of the subject" |
| **Look first.** An appointment given from today begins at the moment of the give; a later date at 00:00 (differs from decision 10 of #62 for these two roles) | Decision 5; a subject passes at one moment from one holder to the next |
| **Look first.** A Senior Head Teacher whose record is in another branch is listed in a branch by login only | Decision 14; the login is made from the name, so it is personal data read across branches (permission review of #63) |
| "Inserted by this transaction" is `assignments.written_xact` (`xid8 default pg_current_xact_id()`), not `xmin` | Correction 1: `Assignments.give` inserts under a savepoint |
| A change of subjects ends the appointment and gives the next at one moment, the end first; a planned appointment keeps its start; one that ends by then is refused (`appointment_ends_by_then`); a later end carries over; one entry `assignment.subjects_changed` ties the two beside the end and the give | Decision 6, correction 2; code review of #63 |
| Subject scope fits nothing by default: Head Teacher and Senior Head Teacher by their subjects; Super Admin, Principal, both Vice Principals and Head Tutor every subject | Decision 7 |
| Area `head_teachers`, view only: Super Admin, Principal, Academic Vice Principal, Senior Head Teacher and Head Teacher (the last two their subjects); appointing stays in `accounts` `edit` | Decision 8 |
| "All subjects" is a list chosen with "Choose all"; a later subject is not added by itself | Decision 9 |
| Bringing back an appointment (a later end, a `left` taken back) over a holder appointed meanwhile is 409 `head_teacher_taken` | Decision 10 |
| No Teacher role or own subject is needed; a Head Teacher's branch is one of the person's | Decision 11 |
| An archived subject is not added, kept on existing appointments, marked "archived" on the account section and left out of the change form | Decision 12; code review of #63 |
| `head_teacher_taken` names the taken subjects by their place in the list sent, read after the exclusion constraint refused (the other holder's rows are then committed), not by a pre-check under advisory locks | Build; the constraint is the guard, and the read after it sees exactly what refused |

## 12 October 2026: accounts and roles (task 2.3a)

Plan approved on pull request #62 with corrections 1 to 6; decisions 1 to 13 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Task 2.3 split into 2.3a (accounts and roles), 2.3b (Head Teacher appointments and subject scope), 2.3c (locks, resets, email reset, own photo); the 48-hour report after a reset moved to 6.1 | Decision 1; eleven pieces of work over four modules; the report needs journal entries |
| **Look first.** The login check of `accounts` widened in 0027 to `^[a-z]+(\.[a-z]+){1,2}[0-9]*$`, at most 64 characters; unique and unchangeable as before | Decision 2; the owner's answer 14 changed the requirement |
| **Look first.** The end of an assignment is held by `assignments_end_guard`: for `sodiq_app`, an end at or before `app.now` is final, a new end is not before 00:00 of that day (branch time zone, the school's without a branch), and a write without `app.now` is refused; `Transactions.run` sets `app.now` from the injected clock; the migrator is not checked | Decision 3, correction 5; the owner's rule of 0.7a with the injected clock |
| **Look first.** The session answer carries the person's own name and the name of the administrator who reset the password, through `own_person_name` and `reset_by_person_name` (`SECURITY DEFINER`, a first and last name only); the own name only once no sign-in step is owed | Decision 9; pull request #61, decision 6; the resetter's name is the one cross-branch read; code round 1, finding 6 |
| **Look first.** The slip carries no role; proposed `/spec-change` of `docs/design-system.md` (This app, Printouts): "name, the roles held when it is printed (none at a first issue), the three steps …" | Build decision 13: no role exists when a first password is issued |
| **Look first.** One slip per page for one account; proposed `/spec-change` of the same line: "one slip per page for one account; four per A4 page with cut lines when several accounts are printed at once (a staff import)" | The owner's answer 15 ("one slip per person"); the four-per-page sheet needs several accounts at once, which comes with a staff import |
| Who gave or ended a role is named when the actor's staff record is in a branch the request may read, by login otherwise; no function for it | Correction 1 |
| Area `accounts`: the Super Admin views, creates, edits; the Principal views; the Super Admin count asks `create` | Decision 4 |
| The last active Super Admin: a Super Admin assignment begun and without end, an account not locked, a record not inactive or left today or planned; a role end or status change that takes the count from one or more to none is refused (`last_super_admin`); `SUPER_ADMIN_COUNT_LOCK` is taken before any row lock | Decision 5; finding 4 of the plan review |
| Roles given in 2.3a: Super Admin, Principal, both Vice Principals, Head Tutor, Tutor, Teacher | Decision 6 |
| A re-hire (the first change after `left` to `active` or `inactive`, from a date when the record has left, after planned changes are taken back) sets a new first password valid 7 days from the later of now and the re-hire date, answered once as a slip; the return from that leave is no second re-hire; taken back, the password stays; no role comes back. A person still on leave when it runs out gets a reset (2.3c) | Decisions 7 and 8; code round 1, finding 7 |
| "Left: all roles ended" for roles given later too: a role that would begin while a `left` row is in force (a return planned or not) is refused (`staff_left`); one that begins before a planned `left` ends at 00:00 of its date through `Staff.endRoles`, comes back when the `left` is taken back, and its end is not moved past it (`staff_left`) | Decision 12; code round 1, finding 1 |
| The account section shows a reader other than the Super Admin the roles of the branches of the request and the two without a branch (the Super Admin role included); the Super Admin sees every role | Branch on every row; code round 1, finding 2: `assignments` has no row policy |
| An unknown branch id in the body of a role give is refused as one the person is not linked to (409 `role_branch_not_person`), as another branch's | Code round 1, finding 3; one answer for both, so the code tells nothing about which branches exist |
| A role is given in one of the person's branches, from today or later, at 00:00 of that day; "end today" ends it now, a later date at 00:00 of that day; given again the same day it overlaps and is refused | Decisions 10 and 13 |
| The account lives in a section of the staff side panel; the slip is a dialog, printed alone through `body[data-printing='slip']`; the slip carries name, the three steps, login, password, issue date and end, and no role (none is given yet when it is printed) | Decision 11; build |
| The browser test's account flow is the second half of the divisions Super Admin's test | Build: the seed holds at most three Super Admins, all used by the setup tests |

## 12 October 2026: layout shell and brand moments (task 2.2d-2)

Plan approved on pull request #61 with corrections 1 to 4; decisions 1 to 17 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** Tests rewritten where the shell moved: the chevron and `menu.current` of the active item, the own account entry in the item list, and the browser tests' paths to the theme, the language, the account menu and the phone menu | Decision 17; `docs/design-system.md`, Layout shell; what each proved is still asserted |
| **Look first.** The sign-in slogan is the one orange text | Decision 16; a contradiction inside the design system, wording proposed on #42 |
| **Look first.** The empty page's hexagon outlines take the foreground colour in the dark theme | Decision 14; navy fails 3 : 1 on the dark card |
| **Look first.** In the rail the current item is an icon on an orange square | Build; the active fill of the design system on an icon-only item, against What we never do 2; wording proposed on #42 |
| `EmptyState` with a title is the brand moment of an empty page; without one a quiet line | Decision 1 |
| Theme and language in the person menu (radio items that close the menu) and in "More" (the segmented control); feedback stays in the top bar; the sign-in page has a theme button through `useTheme()` | Decisions 2 and 3; correction 1 |
| The side menu from 640 px, fixed to the window with a column of its width; the current item matches its inner pages, Home only itself; "More" is the current tab on a page under it | Decision 5; build |
| The colour logo and shield on white, their on-dark versions in the dark theme | `docs/design-system.md`, Logo: "the on-dark version goes on navy" |
| Slab titles 40/44, 28/34 below 640 px; the slogan 56/58 from 1024 px and 40/44 from 640 to 1023 px | Decision 15; build: 56 px does not fit the narrow panel |

## 12 October 2026: tokens, type, icons and controls (task 2.2d-1)

Plan approved on pull request #60 with corrections 1 to 6; decisions 1 to 13 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** 2.2d split into 2.2d-1 (tokens, type, icons, controls) and 2.2d-2 (layout shell and brand moments) | Decision 1; two independent halves of about 60 files |
| **Look first.** `@fontsource-variable/golos-text` and `@fontsource-variable/bitter` 5.3.0 (OFL-1.1), `@material-symbols/svg-500` 0.48.0 (Apache-2.0), `vite-plugin-svgr` 5.2.0 (MIT, dev); `lucide-react` and `@fontsource-variable/geist` removed. `pnpm audit --prod`: nothing; `pnpm audit`: one high advisory (`braces`, through `kysely-codegen` and `shadcn`), already on `main`, none through the new packages | Decision 2; "Decided ahead for tasks 2.2d and 2.7", items 1 and 2 |
| **Look first.** A small button and a square small one are 44 high below 640 px | Decision 3; proposed wording on #42 |
| **Look first.** Checkboxes are navy in the light theme and the foreground colour in the dark theme (`--checkbox`) | Decision 4; navy on the dark card fails 3 : 1; proposed wording on #42 |
| **Look first.** The contrast pairs of the old class lists left `contrast.test.ts` with their classes; every pair the new class lists draw is checked in both themes at the same thresholds | Decision 5; `docs/design-system.md` approved on 12 October 2026 |
| The theme choice is the segmented control (three values); outline buttons became secondary, or quiet for "Cancel" beside a primary and a toolbar "Reset"; archive buttons of the panels are danger, restore secondary | Decisions 7 and 9; What we never do 6 |
| The dark tints are literal oklch values of the colour at 16% over the card (sRGB mix); `--chart-*` removed | Decisions 10 and 11 |
| The open row of a list is the `--today` fill with its text in bold, never a stripe; a chosen segment carries a check mark | What we never do 3; "no information shown by colour alone" |

## 12 October 2026: staff photos (task 2.2c-2)

Plan approved on pull request #59 with corrections 1 to 3; decisions 1 to 14 confirmed there, 10 changed (the order of the refusals). Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| **Look first.** `@aws-sdk/client-s3` 3.1141.0 pinned in `apps/api`; Apache-2.0, maintained, `pnpm audit --prod` finds nothing | Decision 1; approved in advance by answer 2 |
| **Look first.** The Academic Vice Principal sets and removes staff photos of the branch under `staff` `edit`, as the Super Admin does; the reach is that of the 2.2a contact edit | Decision 2; the photo is in the Basic group (`edge/people-roles-accounts`, Personal data and the audit log) |
| **Look first.** `staff_vacancy_check` dropped and created again in 0026 with `photo_id is null` added; a test compares it with 0024's | Decision 13; tightened, not weakened; 2.2b correction 2 |
| The upload is the raw image as the body of the one declared exception of `json-only.ts` (`FILE_ROUTES` in `apps/api/src/http/file-routes.ts`), read by `fileBodyMiddleware` before the guards and by the handler only through `ValidFile` (built on `Body`, in `apps/api/src/http/`); `file-routes.test.ts` pins the list against the handlers. `.claude/rules/api.md` is unchanged: its line on the input readers is proposed on issue #42 | Decision 3, correction 1; a cross-site form cannot send a raw `image/*` body |
| The server reads the size from the header and refuses more than 800 pixels a side (`photo_invalid`); the file is stored as sent, so a client other than the app keeps its metadata | Decision 4 |
| The browser sends a JPEG at quality 0.85 on white, shrunk to at most 800 pixels; the server takes JPEG and PNG | Decisions 5, 7 (one size) |
| `Cache-Control: no-store` on the photo too; the page keeps it in memory per photo id as a `data:` address | Decision 6 |
| A replaced or removed photo's object stays in the bucket; the audit entry `staff.photo` names the old and new ids, never the bytes | Decision 8; "the platform erases nothing" |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, all four or none, in `render.yaml` with `sync: false`; `PHOTOS_IN_MEMORY=1` for a laptop and the browser tests, refused with the R2 variables | Decision 9; answer 2 |
| 5 MB is 5,000,000 bytes (`PHOTO_MAX_BYTES`); over it 413 `photo_too_large`. Refusals in order: 415 and 413 (before the guards, whoever sends them), 403, 404 (also a vacancy with no store, also with a body that is no file), 503 `photos_not_configured`, 415 for a body that is no file (JSON or nothing: `ValidFile` hands the handler `null`), 400 `photo_invalid`, 503 `photos_unavailable`. An empty body is 415, not the plan's 400 `validation_failed` (decision taken in the build) | Decision 10 as changed by correction 3; correction 2; the spec review of the build |
| No call to the store with a transaction open: the record is read, the object put, then one transaction locks the record, reads its branch link again `for share` and writes the photo and the audit entry; the R2 client has one attempt and a timeout of 10 seconds | Spec review of the plan; `edge/system-behaviour` ("Only that function fails") |
| A photo can be set on an inactive or left person; removing a missing photo is 204 with no audit entry; the photo is not an Excel column (`Column.exported: false`) | Decisions 11, 12, 14 |
| Any role that views staff records reads the photos (`staff` `view`); reading a photo is not audited | `edge/people-roles-accounts`: "Ordinary page views are not recorded" |

## 12 October 2026: exports (task 2.2c-1)

Plan approved on pull request #58 with corrections 1 to 5; decisions 1 to 14 confirmed there, 7 and 9 with the texts in `packages/shared` (correction 3). Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| 2.2c split into 2.2c-1 Exports and 2.2c-2 Photos; the vacancy photo refusal of 2.2b moves to 2.2c-2 | Decision 1; two dependencies and two kinds of infrastructure; the build plan's split rule |
| `export` in `rooms`, `divisions`, `subjects`, `staff`, `vacancies` for the Super Admin, the Principal and the Academic Vice Principal | Decision 2; `02` Rules, `12` Lists, Who can act ("Exports are allowed"); only the roles that view these areas |
| ExcelJS 4.4.0 pinned in `apps/api`, with the pnpm override `uuid@<11.1.1` → `^11.1.1`; `pnpm audit --prod` finds nothing | Decision 3, correction 1; ExcelJS calls only `v4` of uuid, the override clears the moderate finding anyway |
| The Principal's staff file leaves out the phone (`STAFF_CONTACT_EXPORT_COLUMNS`), decided from every current assignment; a request of the phone only answers 403 with no audit entry | Decision 4; Personal data and the audit log ("Whole-branch exports with contact or identity fields are for the Super Admin and Academic Vice Principal") |
| An id the list does not hold answers 404: another branch's, unknown, a vacancy in the staff export, a person in the vacancy export; the Super Admin's staff export too | Decision 5, correction 2; `.claude/rules/api.md`, ids in the body |
| Vacancies only from the Vacancies list | Decision 6; `04` Vacancy, "exports leave them out unless asked" |
| The file in the language of the account; the texts in `EXPORT_TEXTS` of `packages/shared`, tied to the screen's headers by web tests | Decisions 7, 13, correction 3; `12` Language |
| A synchronous file, no job; at most 5,000 ids; `POST` with a JSON body; search and filters logged as sent, the row count counted by the server | Decisions 8, 10, correction 5 |
| `writeWorkbook`, `XlsxFile`, its interceptor and `@ReturnsFile` in `apps/api/src/http/`; `exportList` (rows by id, columns allowed, audit entry, file) in `apps/api/src/modules/audit/export-list.ts`; each route beside its list route, reading with the list's own read in one transaction | Decision 9; the audit entry belongs with the audit module (decision taken in the build) |
| Archived rows exported when ticked or matching; the ticked rows when some are ticked, also those the search hides, else every matching row; the button names the count | Decisions 11, 12, correction 4 (the 0.8b-1 line above points here) |
| No request key | Decision 14; an export changes no school data |
| `filters` is the list's `f`, one value per filter (`Record<string, string>`), at most 20 (decision taken in the build) | The list keeps one value per filter (`ListSearch`) |
| The staff status column writes three cells: the status, a planned status and its first day as a date cell; lists inside a cell are a text joined with ", ", grades named as the screen names them ("Grade 5"; the subject list's plain numbers) (decision taken in the build, grades from the spec review) | `edge/system-behaviour`: real numbers and dates; `04`: "grades (7-sinf, 8-sinf)" |
| The request says whether its rows are the ticked ones or every matching row (`selection`), and the audit entry records it with the columns asked for and not written (`leftOut`) (decision taken in the build, from the reviews) | Ticked rows hidden by the search are exported, so the logged search alone would not explain the file |
| A staff file with the phone names the Super Admin or Academic Vice Principal assignment that allowed it (`assignmentFor` of `exportList`) (decision taken in the build, from the permission review) | `.claude/rules/api.md`: the audit entry names the assignment that allowed that part |
| A date cell is built with `Date.UTC`, tested with the server in Tashkent, UTC and Los Angeles | ExcelJS writes a `Date` by its UTC parts |

## 12 October 2026: availability and vacancies (task 2.2b)

Plan approved on pull request #57 with corrections 1 to 5; decisions 1 to 14 confirmed there. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| Availability routes under `staff_teaching` (same roles and actions); vacancies in a new area `vacancies` (Super Admin and Academic Vice Principal view, create, edit, archive; Principal view); close, reopen and delete are `archive` | Decision 1; `02`, `edge/people-roles-accounts` Who can act |
| An entry is the whole week of one branch from a date; an empty entry means no hours there; ranges half-open in wall-clock minutes, compared across branches as they are | Decisions 2, 3; owner's answer 10; one time zone (`00-definitions`) |
| A new entry is tomorrow at the earliest while one is in force today, today otherwise; ranges on non-working weekdays accepted | Decision 4; today's hours stay as history |
| The overlap refusal `availability_overlap` names the weekdays only (`weekday.<n>`); the exclusion of 0025 is the backstop with empty `details` | Decision 6; the other branch's times never reach the client |
| A vacancy's name unique among the open vacancies of its branch, checked under `for no key update` of the branch row; close and reopen act from today; a reopen re-checks department, subjects, grades and name | Decisions 5, 7, 14; the re-hire rule of `.claude/rules/database.md` |
| Three SECURITY DEFINER functions beyond the 2.2a pattern: `staff_availability_elsewhere` returns rows of hours, `vacancy_delete` writes, `staff_record_kind` returns a text | Decision 8; the membership filter |
| `staff_main_branch_check` returns when its record no longer exists (read through `staff_record_kind`) | Decision 9, confirmed not a weakening |
| Availability and vacancy routes use the branch of the request, also for the Super Admin | Decision 13 |
| A branch removed from a person ends its hours there from tomorrow | Decision 11 |
| The vacancy delete keeps the whole record in its audit entry | Correction 1 |
| Vacancies are a second list at `/people/vacancies` reached by a tab of the staff list (decision taken in the build) | One list per address keeps its own search, filters and open record (`listSearch`) |
| The Principal, who views `staff_teaching`, also reads the other branches' hours read only (decision taken in the build) | `02`: the Principal "views everything in the branch"; working hours only, nothing personal |
| No error code `vacancy_not_deletable`: the service answers 404 first, and the function's refusal maps to `request_refused` (decision taken in the build) | The function refuses only in a race the service already excludes; 3.4 adds the load refusal with a code of its own |
| The vacancy delete answers 204 with no body (decision taken in the build) | `ReturnsNothing` of the API, as for every route that returns nothing |
| The overlap refusal names its weekdays in a line under the form, not on the fields (decision taken in the build) | The refused range may be one of several typed in one field |

## 12 October 2026: staff record and status (task 2.2a)

Split of 2.2 and answer 2 (membership filter) by the owner on pull request #53; plan approved with corrections 1 to 10, decisions 1 to 20 confirmed or changed there. Decisions 21 to 26 came from the build and its reviews. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| One staff record per person; `staff` and the person's tables filtered by membership (`staff_membership`), `staff_branches` a branch table; a third catalog group `MEMBERSHIP_FILTERED_TABLES` | Owner's answer 2; `04` one main and further branches |
| Cross-branch facts through five SECURITY DEFINER functions that return a boolean or a count; the duplicate and subject-side ones read `app_branch_ids()` | Owner's answer 2; corrections 2 and 17 |
| Areas `staff` (Super Admin view, create, edit; Academic Vice Principal view, edit of name, phone and email; Principal view) and `staff_teaching` (Super Admin and Academic Vice Principal view, edit; Principal view) | Decision 2; `edge/people-roles-accounts`, Who can act, Accounts and sign-in |
| Status as dated rows from today on; a planned change taken back, never grown; first row from the admission date; `left` is the archived state; re-hire on the same record | Decisions 4, 5, correction 6 |
| Inactive and left refused at sign-in after the password matched and on every request; `left` ends the roles at 00:00 of its date (or their own later start) and a taken-back `left` puts them back (`staff_status_role_ends`) | Decision 15, corrections 3 and 4 |
| Division archive `archive_refused`, department archive `department_has_staff`, while somebody who has not left is in it; the division list counts the whole school's staff by main division | `03`, Divisions; decisions 6 and 20 |
| A subject's department or removed grade refused while a teacher who has not left has it, checked in the subject edit under the subject's FOR UPDATE lock; a re-hire checks the subjects as they are now, under FOR SHARE (decision 21) | A trigger cannot read the injected clock that "has not left" needs; the spec review closed the re-hire gap |
| The Super Admin's list and record reads and its branches and status routes run with every branch, after a Super Admin assignment and the request-branch link are found; edit and teaching keep `access.branchIds` (decision 22) | `02`: the Super Admin "Sees all branches"; the branches form needs the person's other branches, the status route the main branch's date |
| `staff_status_role_ends` is a child table of a person under the membership filter (decision 23) | Owner's answer 2: "`staff` and its child tables get a row filter through membership" |
| A field the Academic Vice Principal may not change answers 403 `permission_denied`, not a code of its own (decision 24) | It is a permission, decided from the assignments, as every other refusal of a role |
| The People menu item shows only when the role views one of its pages (`areas` of `MenuPage`) (decision 25) | A Tutor would otherwise reach an empty page |
| The browser test is an Academic Vice Principal on a seeded teacher; the Super Admin's create is proved by the API and page tests (decision 26) | At most 3 Super Admins can exist and the setup tests hold them |

## 11 October 2026: subjects and their weights (task 2.1)

Plan approved on pull request #52 (`[review] approved`, decisions 1 to 16 confirmed, corrections 1 to 4 applied). The owner's answers 3 to 8 above were followed as written. Decisions 17 and 18 and migrations 0021 and 0022 came from the reviews of the build; decisions 19 and 20 and migration 0023 from the `[review] changes needed` round. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| Area `subjects`: Super Admin and Academic Vice Principal view, create, edit, archive; Principal view; no export yet | Answer 4; `02`; a new area for new routes |
| `subjects` is school-wide; `subject_daily_weights` and `subject_quarter_weights` are branch tables; a subject is saved with the daily distribution of the branch in use, other branches show "Not set" | Answer 3; the branch filter forbids writing another branch's rows |
| The rating exam switch is school-wide; a quarterly distribution counts only when its rating part fits the switch | `05`: "A subject without a rating exam has no rating part" |
| Per-quarter switches (5.5c), the refusal while scores exist (8.2), the preview, reason and notice of a weights change (9.1), the closed-quarter refusal (9.2b), the publish check (5.5a) and rollover (9.5b) are notes on those tasks | Nothing they read exists yet |
| Archive is the "active switch"; no delete | `05`; as every record so far |
| A subject is in an active department of the Academic division (trigger `subjects_department_guard`, checking only rows that end up active); a department with an active subject is not archived (`department_has_subjects`) | `03`, Department |
| Checklist item "Subjects and weights": an active subject, and every active graded subject has its daily distribution here | Answer 6 lets quarterly ones wait for publishing |
| Every present part weighs 1 to 100, whole numbers, total 100, in the database and the shared schema | A part of 0 would leave `07` rules 3 and 8 a 0/0 (stop-list item 4) |
| The journal type stays editable; becoming graded again starts a new `weights_round` (0021): no weight row of an earlier round counts, in any branch, daily or quarterly (decision 18); the round only grows and a row is written only in the current round (0022) | Decision 14; rows are kept, not deleted; a round going back would revive old weights without an audit entry |
| The daily distribution has its own route; an edit takes `daily` only while the branch has none | Decision 15: no lost update across branches |
| "Copy quarter 1" overwrites quarters 2 to 4 of the year, all or nothing, after a confirmation when one is set | Answer 6 |
| Only the Super Admin moves a subject to another department (`subject_move_super_admin`); its start date and the refusal against the load come with 3.4 | `edge/people-roles-accounts`: "made by the Super Admin" (decision 17) |
| The department move is decided from every current assignment: allowed when one is a Super Admin assignment, which the `subject.edit` entry then names; the list answers `mayMoveDepartment` and the screen follows it, not the role shown (decision 20) | `edge/people-roles-accounts`, "The server allows an action if any current assignment permits it … The audit log records which assignment allowed the action"; the review of #52 |
| A change of the rating exam switch starts a new `rating_round` (0023): no quarterly distribution of an earlier rating round counts, in any branch; the daily distribution stays; the round only grows and a quarterly row is written only in the current one (decision 19) | The review of #52; `05`: the daily distribution has no rating part, and "Each change is logged"; a switch turned off and on again would otherwise revive old quarterly rows without an audit entry |
| The closed-year guard locks the year row whatever its status (0022) | A lock under a status condition locks nothing for an open year |
| 12 subject colours as tokens of `index.css`, the swatch 3:1 on the background and the name on a 15% tint 4.5:1, in both themes | Answer 7; `12` |
| Names unique among active subjects per language (case and outer spaces ignored), at most 100 | As divisions (1.2) |
| New codes: `subject_archived`, `department_not_academic`, `department_archived`, `subject_department_archived` (restore), `department_has_subjects`, `daily_weights_required`, `daily_weights_set`, `attendance_only_no_weights`, `weights_shape_mismatch`, `quarter_one_not_set`, `subject_move_super_admin` | A text must be true on every path that sends it |

## 11 October 2026: settings and the setup checklist (task 1.6)

Plan approved on pull request #49 (`[review] approved`, decisions 1 to 10 confirmed, decision 4's audit place changed by correction 1, corrections 2 and 3 added tests). The owner's answers 19 to 24 above were followed as written. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| Edit days are a plain column of `branch_settings` (1 to 30, default 7), audited; the lock moments of lessons dated after a change are re-stored by task 8.4 | Answer 19, "one typed table"; `edge/00-definitions`: the lock is fixed per lesson and stored as a moment |
| Early-warning thresholds are plain values with bounds 1–100, 1–100, 1–100 percent, 1–30 absences; "five graded works" stays in code with 9.4a | Answer 19; `08` sets no bounds, these keep each threshold meaningful |
| Late and skipped are 0–100 on the quarter row, 50 and 0 by default; "not closed" is "not in a closed year" today (`quarters_closed_year_guard`); the preview and the closed-quarter refusal come with 9.1 and 9.2b | Answer 20; `edge/calculation`; no result and no quarter close exist yet |
| Travel time is one row per unordered pair in the school-wide `travel_times` (lower id first), 0 to 180; an unset pair is "not set", never 0; audited in `audit_log_school` with both branch ids | Answer 21; `06` makes it a blocking rule; correction 1: a pair belongs to two branches equally |
| Grade bands are shown as text of the three locale files, no constant in code; a web test keeps the three languages equal | `packages/calc` holds every grade rule and adding one is stop-list item 4; correction 3 |
| Languages of instruction are `INSTRUCTION_LANGUAGES = ['uz', 'ru']`, read only | `05`, The list; answer 22 |
| The checklist reads the planned and current years together; item 1 done with one working weekday; item 2 a room in use on an active floor of an active building (rooms are never archived); item 3 the Academic division's departments; item 7 a default setting in force today or later; the calendar counts active entries inside those years | `edge/academic-year`; answer 23 |
| The checklist sits at the top of School setup for `settings` view; each item links to its page when the role views that area; the links of the page are a list named "School setup" | Answer 23; two links of one name ("Rooms") must stay apart for the browser test |
| Every branch has its settings row: the migration for existing branches, the branch create in its transaction through `Transactions.enterCreatedBranch`, which enters only a branch inserted by that transaction and only from an empty filter | Correction 2 of the review; a reader never meets a branch without settings |
| Area `settings` as answer 24; travel time under `branches`; new code `travel_time_same_branch`; a closed year answers `year_closed` | Answer 24; a text must be true |
| A save that changes nothing writes nothing, on every write route of the task | As the setup routes since 1.1 |

## 11 October 2026: calendar (task 1.4)

Plan approved on pull request #47 (`[review] approved`, decisions 1 to 7 and 9 to 14 confirmed, decision 8 changed by correction 1, "Check a date" added as decision 15 by correction 2). The owner's answers 15 to 18 above were followed as written. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| An entry covers its first and its last date and every date between (`daterange(first, last, '[]')`) | Answer 15: "a first and a last date"; an entry is a list of school dates |
| A whole-branch entry holds grades 1 to 11: two active entries of one kind never share a date for overlapping grades, so a grade-range special day on a whole-branch one is refused (`calendar_entries_no_overlap`); a day off and a special day may share a date, the day off wins | Answer 17, "(database constraint)"; `templateFor` keeps `03`'s order and never has to choose |
| Only dates after today change: a change of kind-specific fields, grades or template needs the whole entry after today; a moved first or last date adds or removes dates after today only; the name changes while the last date is today or later; an entry wholly in the past is read-only; archive needs the whole entry after today (a started one is shortened) | Answer 16; `edge/time-dates-calendar`, "Today and past dates cannot become a day off" |
| The kind is fixed at creation (not granted for update) | The two kinds carry different fields |
| An entry lies inside one planned or current year; a year edit that would leave an active entry outside is refused (`calendar_outside_year`) | Answer 16; the same rule as the go-live date in 1.3 |
| `dayOn` resolves the calendar, the weekdays and the template settings; vacations (gaps between quarters) are applied by publishing | `edge/time-dates-calendar`, "Vacations between quarters"; quarters may be undated during setup |
| A school day, for the go-live date: some grade has lessons by `dayOn`, or would once a template is set (`isSchoolDay`); refused at the go-live save and by a calendar save or a working-weekday edit that takes it away (`go_live_not_school_day`) | `edge/academic-year`, "Go-live can be on any school day"; the 1.4 Build line asks for both directions; the go-live date may be set before the first template |
| Follows weekday: required by the API when a date of the entry is not a working weekday, and must name a working weekday; `dayOn` applies it to the entry's non-working-weekday dates only, the other dates follow their own weekday; not refused by a later change of the working weekdays | Answer 15, "on a non-working weekday, the weekday it follows"; correction 1 of the review |
| Exam week is a field of a special day: `regular_lessons`, `no_regular_lessons` or empty; the bulk cancel comes with phase 5 | Answer 15 |
| Names: one typed name of 1 to 60 characters, not unique | Answer 15; "Navruz" comes back every year |
| The preview is the save run in a transaction that is rolled back, under `calendar` edit, for every save that can change a date; it answers runs of dates and grades with the day before and after; a name-only edit saves without it | `03`; `edge/time-dates-calendar`, "the impact preview is shown first"; the same pattern as 1.5 |
| The weekday table of School setup stays a table of the regular settings; "Check a date" (`GET /api/setup/calendar-day`, `calendar` view) shows what every grade has on one date | `03`: the table is "for every weekday and grade"; correction 2 of the review |
| Permission area `calendar` as answer 18; new codes `calendar_date_not_in_future`, `calendar_entry_past`, `calendar_entry_archived`, `calendar_outside_year`, `calendar_overlap`, `follows_weekday_required`, `follows_weekday_not_working`, `go_live_not_school_day` | The texts of the older codes speak of other things; a text must be true |
| A special day's template always has a version in force on its dates; proved by a test, not checked on each save | Entries start tomorrow at the earliest; `scheduleFrom` leaves no later date without a version |
| The paths that cannot act on a shared text get codes of their own: a restore (`calendar_restore_started`, `calendar_restore_overlap`, `calendar_restore_outside_year`, `calendar_restore_follows_weekday`, `calendar_restore_template_archived`), an archive of a started entry (`calendar_archive_started`), a year edit (`year_leaves_calendar_entry`), a calendar save or a weekday edit that takes the go-live school day (`go_live_school_day_taken`) | `.claude/rules/web.md`: a text is true on every path; the spec review of the branch |
| An edit that moves only the first or last date judges the followed weekday over the added dates only | Decision 3: a date the save does not change is not judged again; the working weekdays may have changed since; the spec review of the branch |
| The special-date order (grade range, then branch) lives once, in `specialDateFor` of `packages/timetable-rules`, used by `templateFor` and `dayOn` | `.claude/rules/timetable.md`: one rule engine; the spec review of the branch |
| Every calendar write takes the branch row `for update` first; a special day whose last date is today or later keeps its template in use (`templateInUse`) | One lock order with years, templates and go-live; the note of pull request #46 |

## 11 October 2026: slot types and day templates (task 1.5)

Plan approved on pull request #46 (`[review] approved`, every decision confirmed, three corrections applied). The owner's answers 9 to 14 above were followed as written. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| Lengths, template versions and settings are dated rows `[valid_from, valid_until)`: a change from a date cuts the row in force there (a row starting on the date is withdrawn, `valid_until = valid_from`, kept as history) and the new row runs to where the cut row ran, or to the next later row (`scheduleFrom`). Exclusion constraints keep the rows of a key apart; `dated_rows_only_shrink` lets a row only end earlier, for every user; no delete grant | `03`: "takes effect from a chosen date … its history is kept"; answer 11: grade ranges apart "(database)"; half-open ranges (`edge/developer-rules`). An exclusion constraint is race-safe |
| A slot type's length is dated; the times of a date use the lengths in force on it. Its kind is fixed at creation; names change in place, audited | Answer 12; one calculation instead of copies; a kind change would move lessons out of lesson slots without a version |
| The first length and the first version are in force from the day of creation; every change is from tomorrow at the earliest in branch time (`date_not_in_future`) | Nothing can name them before tomorrow |
| The start time is minutes after midnight (`smallint`), typed `HH:MM`; a day ends by 24:00, checked on every date a change reaches, on create, new version, length change and restore (`day_past_midnight`) | Integers in every calculation; a lesson date is one school date |
| A version's slots are written only in the transaction of the version: `created_xact xid8` set at insert and granted to nobody, compared with `pg_current_xact_id()` (`day_template_slots_same_transaction`); 1 to 20 slots without a gap and a lesson slot, checked at the commit | The review's correction 1: `xmin` changes when the version is cut |
| The default can be replaced from a date, not ended (`default_template_required`); ending a planned setting withdraws it; ending one already ended is `already_ended`. A grade range overlapping another in force at its level is refused (`grade_ranges_overlap`); a new row stops before a planned overlapping one. When the database refuses an overlap (two requests at once), it answers `grade_ranges_overlap` at the two grade levels and the general refusal at the default and weekday levels | `03`: "A branch has a default template"; the review's correction 2; nothing changes without its own preview |
| Weekdays 1 to 7 may each get a template; the table shows the branch's working weekdays and grades 1 to 11, and reads the settings in force on its date for every weekday | Answer 13; a working Saturday (1.4) may need one |
| "In use": a slot type while a version from today on of an active template names it; a template while a setting from today on names it. New codes `slot_type_in_use`, `template_in_use`, `slot_type_archived`, `template_archived`, `no_lesson_slot` instead of `archive_refused` and `archived_record` | Answer 9; the texts of the old codes speak of rooms and buildings, and a text must be true (as in 1.3) |
| Every write of the area takes the branch row `for update` first | One lock order, as in 1.3; makes the in-use, overlap and midnight checks race-free |
| The preview is the save run in a transaction that is rolled back (deferred checks made immediate first), under `edit`; shown for a length change, a new version, setting and ending a setting; create, rename, archive and restore save without it | One code path (`03`); those saves change no cell (decision 19 of the review) |
| The rules live in `packages/timetable-rules` (`dayTimes`, `templateFor` with the special-date order, `inForceOn`, `lessonSlotProblem`), a workspace dependency of the API and the web app | `CLAUDE.md`, one rule engine |
| Names: one typed name of 1 to 60 characters, unique per branch among active rows, case and spaces ignored | Branch data, as answer 15's calendar names |
| The three lists answer `today` in branch time; the web app offers tomorrow from it | The device's clock is never used (`edge/00-definitions`) |
| The lists answer every row that is not withdrawn: past rows as history, the row in force and planned rows (a setting ended from 1 November is still listed on 2 November, with its end). Withdrawn rows stay in the database and the audit log but are not listed | A withdrawn row never took effect; the plan's "history included" is read as the history of what was in force (the spec review of the branch; wording corrected by the review of the ready branch) |
| A template restored while a version from today on uses an archived slot type is refused with its own code, `template_uses_archived_slot_type`; an id of another branch or an unknown one answers 404 before any other refusal | A text must be true where the person meets it; the spec review of the branch |
| A cancelled preview throws `SaveCancelled`, which a record form shows as "Not saved: nothing was changed." (`form.notSaved`); the slots are edited with a shared `OrderedListField` (up, down, remove, add) | The form keeps what was typed and tells the truth; no drag and drop (answer 10) |

## 11 October 2026: academic years and quarters (task 1.3)

Plan approved on pull request #44 (`[review] approved`, every decision confirmed, three corrections applied). The owner's answers 1 to 8 above were followed as written. Flagged on issue #42.

| Decision | Reason |
| --- | --- |
| A year starts in one calendar year, ends in the next and lasts less than a year (`academic_years_dates_check`, `academicYearDatesProblem`) | Answer 1's name "2026–2027" then always names two years, and with no overlap two years of a branch never share a name. |
| Quarters are created undated with their year and dated one at a time: both dates or neither, one day at the least, quarter n ends before quarter n+1 starts; gaps are allowed | Answers 4 and 5; `edge/time-dates-calendar`, "Vacations between quarters". The 1.3 Build line's "no gaps" is `03`'s "no gaps inside teaching time". |
| The database keeps: one current year (partial unique index), no overlap of years (exclusion constraint), no overlap of quarters (exclusion constraint, `deferrable initially deferred`: the four are saved together), the deferred check `academic_year_quarters_check` (four quarters, inside the year, in order), `academic_years_guard` (planned → current → closed; no year before one already started; a current year has no open earlier year; a closed year is frozen) and `quarters_closed_year_guard`. Insert grants are column-limited, so a year always begins planned | `edge/developer-rules`, One current year; the build plan's "done when"; the spec review of the plan. |
| Every year write (create, edit, "Start year") takes the branch row `for update`, then the year row; the go-live save takes the branch row and reads the years unlocked; a quarter save takes the year row | The order checks of `academic_years_guard` read other rows without locks: only one current year is race-safe in the database itself, which is all the developer rules ask; the branch lock serialises the rest. Stronger than the plan's `for share` (accepted by the spec review of the branch). |
| Database refusals map to 409 codes by constraint name (`CONSTRAINT_REFUSALS`, `refusingConstraints` around the whole transaction, so a refusal at the commit is no 500); an unmapped one is thrown again. Eight new codes: `dates_overlap`, `outside_year`, `quarters_out_of_order`, `year_closed`, `current_year_exists`, `earlier_year_not_closed`, `year_out_of_order`, `go_live_outside_year`. The two refusals no route reaches (`academic_years_status_order`, `academic_year_quarters_count`) answer `request_refused` | The review's correction 3; a text must be true (`dates_overlap` speaks of years, so quarters got their own code). |
| No lesson-based limits on date edits yet: "a boundary moves only over future dates", shortening with lessons and frozen closed quarters come with 5.6b and 9.2b | No lesson and no closed quarter exists before them, and a school going live mid-year types quarter 1's past dates. |
| "Start year" is built now as the `edit` action of `academic_years` (Super Admin): planned → current when the branch has no current year and every earlier year is closed; dated quarters are not needed; a second start of a current year changes nothing. No route closes a year before 9.5a | Answers 3 and 6; only publishing needs four dated quarters (`edge/academic-year`). |
| The go-live date: `branches.go_live_date`, its own route under `branches` edit (the Super Admin alone, nothing widened), clearable, inside a planned or current year; a year edit that would leave it outside is refused. Its school-day check comes with 1.4 (noted there) | Answer 7. |
| Permission area `current_period`, view for all 15 roles, for the top bar's route | `03` and `12`, Context: always shown; the answer holds no personal data. A Parent's assignment will have no branch in Release 2; the area is revisited then (permission review). |
| The top bar shows the current year, else the earliest planned year that has not ended ("planned"), else "No academic year"; only dated quarters count; a failed call says so | Answer 8; `edge/time-dates-calendar`, "A page is opened on a date that is in no quarter". |
| Dates are typed in the browser's date input (`DateField`) and shown with `Intl.DateTimeFormat` in the chosen language | No date-picker library: a new dependency stops a task. |
| "Start year" and the go-live form are switched off with one line while their prerequisite is missing; "Add year" needs only the branch | `edge/academic-year`, first row. |
| The property test of the top bar's states is a loop over every day of a year for four layouts of the quarters | fast-check is not installed; adding it is the owner's (stop item 5). |

## 10 October 2026: divisions and departments (task 1.2)

Plan approved by the owner on pull request #40 (`[review] approved`, with the answers to the eight questions and one correction). The approval is the owner's approval of the third area of the permission table (`divisions`) and of the two school-wide tables.

| Decision | Reason |
| --- | --- |
| `divisions` and `departments` are school-wide tables (no `branch_id`, no policy), named in `SCHOOL_WIDE_TABLES` | `03`, Divisions: "One list for the whole school ... Divisions are the same in every branch." A row holds names, a position and moments, nothing personal. Owner's answer 3. |
| The eight divisions and fourteen departments of the table of `03` are seeded by migration 0015, Academic with `built_in`. The names the spec does not give (Russian division names, Uzbek and Russian department names) are the owner's starting values (answer 2), corrected later in the app; Academic's are `Oʻquv boʻlimi` / `Учебный отдел` / `Academic` and fixed. Uzbek names use U+02BB as the locale files do; the Tutors department is `Tyutorlar` | `03`: "Each division and department has a name in three languages"; `15`: "Departments are editable"; the owner keeps "Tyutor" in Uzbek (10 October 2026). |
| Academic is guarded by the database: the trigger `divisions_built_in_guard` (plain `language plpgsql`, not `SECURITY DEFINER`) refuses a change of its names or `archived_at` for every user, the migrator included; a migration that must change them disables the trigger for its statement. `sodiq_app` can neither insert nor update `built_in` (column-limited grants), so Academic stays the one built-in division without a rule of its own | `03`: "Academic is built in. It cannot be renamed or archived." The task's "done when". Owner's answer 8; the spec review of the plan (an index on "one built-in row" was an invented rule). |
| The order of both lists is an explicit `position smallint`, unique among active rows of one parent; a new record takes the greatest position of every row, archived ones included, plus one; the routes order by it. No reordering control in this task | The owner's correction: rows of one migration share one `created_at`, and `uuidv7()` within a millisecond is not an order. |
| Archive rules of departments as of buildings and floors: archiving a division archives its active departments at the same moment and restoring it brings back exactly those; a department is not added, renamed or restored in an archived division (409 `archived_record`); no move of a department to another division | Owner's answer 4; `03` says nothing about archiving a department; `edge/people-roles-accounts` moves teachers and subjects, not departments. |
| The refusal "a division with active staff cannot be archived" is built in 2.2 (409 `archive_refused` on the archive route while an active staff member has the division as main or further division), with its test; noted on task 2.2 in the build plan | Owner's answer 1: no staff table exists before 2.2, so the rule cannot be built or tested in 1.2. |
| Permission area `divisions` for the rows Division and Department of `03`: Super Admin view, create, edit, archive; Principal view; Academic Vice Principal view; nothing for the twelve others. A role that later needs the list in a picker widens `view` in its task | `02`: "Only this role creates ... divisions"; the Principal "Views everything"; the department is a column of the teacher list (`04`) and a filter of the timetable board (`06`). Owner's answer 5. |
| Each language's name is unique among active divisions, and among active departments of one division, case and outer spaces ignored (three partial unique indexes each); an archived record keeps its names and is restored only while no active one has them. A database test uses a Cyrillic duplicate that differs in case only | Owner's answer 6; the spec review of the plan: `lower()` on Cyrillic depends on the collation. |
| The Tutors department is plain data; the task that first needs to find it decides whether a marker column is needed | Owner's answer 7; `03` makes only Academic built in. |
| The writing routes are `branch: 'none'` with audit entries in `audit_log_school`; the one reading route (`GET /api/setup/divisions`) is bound to the branch of the request and answers the same list for every branch | The 1.1 decision: a `branch: 'none'` route only for an action whose row names school-wide roles; the Principal and the Academic Vice Principal read. |
| 409 `already_exists` says which language's name is taken: `ApiException` carries optional `details`, and `refusingDuplicates` maps the violated unique index to the field (`names.uz`, `names.ru`, `names.en`); the form shows the refusal beside that field (`ApiFailure.details` in the web app) | `12`, Look and feel: "Error messages say what happened and what to do next" (the spec review of the plan). |
| 409 `built_in` for a rename or an archive of Academic | A refusal with a text of its own, as the 1.1 codes. |
| Every write of the divisions page invalidates the prefix `['setup', 'divisions']`, not one branch's key | The list is the same in every branch; a switch of branch must not show a stale list. |
| The Divisions page follows the owner's text rule of 10 October (issue #39): a title and the content, no sentence under the title; one line under Academic's names (built in) and on an empty department list | Owner's check for the build. |

## 10 October 2026: branches, buildings, floors and rooms (task 1.1)

Plan approved by the owner on pull request #37 (`[review] approved`, with the answers to the nine questions). The approval is the owner's approval of the first two areas of the permission table (`CLAUDE.md`, Ask before).

| Decision | Reason |
| --- | --- |
| The permission table gets its first two areas, `branches` (view, create, edit) and `rooms` (view, create, edit, archive; buildings, floors and rooms together, one row of the table of `03`). The Super Admin has every action, the Principal and the Academic Vice Principal `view`, the other twelve roles nothing. No `export` until the export route of the lists exists (2.2) | `02`, Super Admin: "Only this role creates branches, buildings, floors and rooms"; Principal: "Changes nothing". The Academic Vice Principal's view is an inference from `06`, Building a timetable, steps 1 and 4 (working weekdays and rooms are inputs of the timetable), approved knowingly by the owner (answer 5). |
| The branch record: `address`, `phone`, `email` (the contacts: one phone and one email), all optional and stored as `null` when empty; `working_weekdays smallint[]` as ISO numbers Monday 1 to Sunday 7, at least one, each once in that order, Monday to Friday for a new branch and for the rows that existed; `time_zone` fixed to `Asia/Tashkent`, which `sodiq_app` cannot change and no form shows; branch names unique across the school without case and outer spaces | Owner's answers 1, 2 and 3. `03`, Academic calendar treats a working Saturday as a special day, which only fits a five-day default. `edge/00-definitions`, Branch time. Two branches of one name would be indistinguishable in the switcher. |
| Creating a branch is school-wide work (`branch: 'none'`): its audit entry goes to `audit_log_school` and names the branch as its record. Reading and editing the record act on the branch of the request (`X-Branch-Id`): `GET` and `PUT /api/setup/branch` carry no id | The branch does not exist when the transaction begins; `audit_log` rows need the filter of their branch. The API rule: a branch never comes from the path. |
| No archiving of a branch | Owner's answer 4: no spec file gives it; the three branches are long-lived. |
| `buildings` and `floors` are branch tables with `archived_at` (from the injected clock); `floors (building_id, branch_id)` references `buildings (id, branch_id)` and `rooms (floor_id, branch_id)` references `floors (id, branch_id)`. Unique among active rows: a building's name per branch, a floor's name per branch and building (case and outer spaces ignored). `rooms` has no archive: `closed` is its end state, and its name is unique per branch over every room, whatever the building | `database.md`: an id that arrives in a request is checked against the branch, here by the database too; a unique constraint on a branch table includes `branch_id`. Owner's answers 6 and 7; `edge/academic-year`: "an archived teacher and a closed room". The timetable, the journal and the prints show the room name alone. |
| A building or a floor is archived only once every room on it is closed (409 `archive_refused`); archiving a building archives its active floors at the same moment, and restoring it brings back exactly those floors (same `archived_at`); a floor is not restored while its building is archived, a floor is not added to an archived building, and an archived building or floor is not renamed (409 `archived_record`); an archive or a restore of a record already in that state changes nothing and writes no entry. A room is saved only on an active floor of the branch: an archived floor is refused with 409 `floor_archived`, a floor of another branch or an unknown one is `not_found`. A room on an archived floor can only be moved: every other edit of it is `floor_archived`, and the form says where the room is and asks for an active floor (decided by the owner at the code review) | Owner's answer 7 (a). `12`, No lost work: archived, never deleted; `CLAUDE.md`. An archived floor's rooms are all closed, so a room cannot quietly return to use on it. |
| The floor of a room is read with a share lock (`lockFloor` in `rooms.service.ts`) whenever a room is saved: an archive of the floor or its building takes the floor rows for update, so the two wait for each other and the archive counts the room that was being saved; a room cannot be put on a floor that is being archived | Spec review of the branch (must-fix 1): two unlocked reads could interleave under read committed and leave a room in use on an archived floor. A test holds the lock and shows the other call waits. |
| Refusals with a text of their own: 409 `floor_archived` when a room is put or moved on an archived floor, or a room on an archived floor is edited without being moved to an active floor; 409 `archived_record` when an archived building or floor is renamed, or a floor is restored while its building is archived. The bulk status change names the rooms it could not change and goes on with the others | Spec review (should-fix 1 to 3): `12`, Look and feel: "Error messages say what happened and what to do next"; the partial unique indexes cover active names only, so an archived record keeps its name. |
| A `branch: 'none'` route is declared only for an action whose row of the table names school-wide roles (`branches.create`: the Super Admin); `checkTable` gets no rule for it, because the table does not know which action is school-wide, and the harness proves it per route (`POST /api/setup/branches` allowed for the Super Admin only) | Left open by 0.7b for the first such area. |
| A name that is taken answers 409 `already_exists`, read from the unique index inside the transaction (`refusingDuplicates` in `setup-refusals.ts`), never from a check before the insert; the refused transaction leaves no row and no audit entry. The database check of a shared room says `is not null` | Two requests at the same moment both pass a check; the index refuses one. A check whose result is null passes: found by the database test. |
| The bounds are constants of `packages/shared/src/setup.ts` and the checks of 0014: names 100 characters (a floor's and a room's 50), address 300, phone 40, email 200, capacity 1 to 1000, a shared room 2 to 10 lessons at once | Owner's answer 9. |
| The archive and restore routes are `POST` and answer 200 with the record (`@HttpCode(200)`); a creation answers 201 | NestJS answers 201 to every `POST` unless told otherwise; an archive creates nothing. |
| The web: the menu item "School setup" leads to `/setup`, a page of links (branch; buildings and floors; rooms), each shown when the permission table lets the active role view its area; later tasks add their links there. The three pages join the Ctrl+K index when the menu of the role has the item (`SETUP_PAGES`, `indexedPages` in `page-index.ts`) | `12`, Navigation: one menu item per area, its pages below it. |
| A new record (branch, building, room) is typed in a form above the page or the list, opened by the header's button, not in the side panel: the panel opens a record of the list by its id, and a record that does not exist yet has none. "Cancel" asks through `useLeave` when something is typed | The list pattern of 0.8b-1 as built; no change to `ListPage` for one case. |
| "Add room" is switched off with the text "Add a building with a floor first" while the branch has no active floor, and the empty room list links to the buildings page | `edge/academic-year`: "An action whose prerequisite is missing is switched off and says what is missing" (the plan review's finding 1). |
| The room list has the bulk actions "Mark in use", "Mark under repair", "Mark closed" (one `PUT` per ticked room that is not in that status yet; a room on an archived floor is named and the others go on); the buildings list has "Archive" and "Restore" (one `POST` per ticked row; a room in use at an archive, or a name an active building has now at a restore, is named in the status line and the others go on) | Owner's answer 8; `12`, Lists: checkboxes with bulk actions. |
| `CheckboxField` and `CheckboxGroupField` in `components/field.tsx`, bound to a record form as text: `on` or empty for a switch (`CHECKED`), the ticked values joined by commas for a group (`listValue`, `listValues`). The weekday names come from `Intl.DateTimeFormat` of the chosen language, with a capital first letter | `useRecordForm` holds every field as text. `12`, Language: weekdays follow the chosen language; no locale key. |
| The generated client types the `X-Branch-Id` header as a required parameter of every route bound to a branch: calls pass `params: { header: branchHeader() }` (`api/client.ts`), and the middleware sets the same header | The call stays typed; the middleware is the safety net. |
| The queries of setup carry the branch of the switcher in their keys (`['setup', 'branch' \| 'buildings' \| 'rooms', branchId]`), so a switch of branch is another list; a change of a room invalidates the buildings query too (room counts per floor) | The client sends the branch of the switcher; cached rows of another branch must not show. |
| The browser tests get a seeded `superAdmin` account (role only; the test sets up the required second step itself); `setup.spec.ts` walks through branch, building, floor, room, the refused archive and the archive after closing the room | `02`: the second step is required for the Super Admin; the existing tests set it up the same way. |
| In the API tests a Super Admin's clock moves five minutes, not an hour | The Super Admin's idle limit is 15 minutes (0.6b): an hour ended the session and every later call answered 401. |

## 9 October 2026: test environment and deploy pipeline (task 0.10)

Plan approved by the owner on pull request #35 (`[review] approved`, with the answers to the six questions and six corrections). Answer 1 changes the spec: `13` (Web app row, Hosting bullet, the cost line "Render web app, Static site") says the web app is static files on Render's CDN; the owner corrects it with `/spec-change` after this merge. Answers 2 and 3 add two lines to the cost table (Neon Launch for the test environment, a test worker) with the same spec change.

| Decision | Reason |
| --- | --- |
| The API serves the web app's built files on its own origin (`WEB_FILES`, `apps/api/src/http/web-files.ts`): every path outside `/api` is the web app, hashed assets as `immutable` for a year, `index.html` and the fallback as `no-cache`, GET and HEAD only, nothing served when the variable is unset. No Render static site | Owner's answer 1. The session cookie is `SameSite=Strict`, CORS is off, the cross-site check compares `Origin` with the request's own origin, and the live connection of 0.9 is a WebSocket under `/api/socket`; a Render static site can rewrite `/api/*` to another host but does not carry WebSockets (open request since 2020). One origin with nothing in between. Cloudflare in front was ruled out: the school's DNS is at its registrar and the zone is shared with other projects. Long polling stays out. |
| The test environment is `app-test.sodiqschool.uz` (one CNAME added at the registrar; `test.` and `api.` belong to other projects), declared in `render.yaml` on the API service; the smoke test runs against that name, not the `onrender.com` address. Production is `app.sodiqschool.uz` (10.4) | Owner's answer 1. The `Secure` cookie, the cross-site check and the WebSocket upgrade are proven on the real origin. |
| `TRUST_PROXY` (`0` or `1`): with `1` the first hop's `X-Forwarded-Proto` says the protocol, in one helper `ownOriginOf(request, trustProxy)` (`same-site.ts`) that serves the cross-site middleware and the handshake of the live connection; Express's `trust proxy` is set to the same for its own readings. Unset on a laptop and in CI: a forged header is ignored | Progress 0.9 and decision 0.7c: behind Render's load balancer the connection to the API is plain HTTP and a browser's `Origin` is `https://…`; both checks move together or they drift apart. |
| Error reports go to Sentry (`@sentry/node` 11.5.0 in the API and the worker, `@sentry/browser` 11.5.0 in the web app; 11.6.0 was a day old and refused by pnpm's release-age protection). Every default integration off, no tracing, no breadcrumbs; a `beforeSend` allow-list (`reportedEvent`) keeps exactly: event id, timestamp, platform, level, environment, release, SDK, the exception (type, value, mechanism, frames without `vars`) and the tags `request_id`, `job`, `part`; the web app also the page's path without query and hash. `SENTRY_DSN` and `VITE_SENTRY_DSN` unset: nothing is sent. `@sentry/browser` rather than `@sentry/react`: React 19's root options report render faults | `13`, Monitoring. Decision 0.4a: a fault is logged with the request id and the name, message and stack only; Sentry keeps to the same rule. CLAUDE.md: no personal data in error reports; the list pattern puts the typed search in the address. An allow-list, so that an SDK default can never add a field (spec reviewer's finding 8). The message of a database error is not cut: input validation stops typed values before a query, and the log already keeps the message (owner's answer). |
| `reportFault(error, tags)` is called beside every logged fault: the 500 (`error-response.ts`), a failed job (`job-runner.ts`), the queue's own errors (`job-queue.ts`), the live listener and the socket server. It never awaits the transport; `ReportingModule` calls `Sentry.close(2000)` at shutdown. An uncaught exception or an unhandled rejection is reported and ends the process (`exitEvenIfOtherHandlersAreRegistered`, `mode: 'strict'`), as Node does without a handler | Spec reviewer's findings 2 and 3; `edge/system-behaviour`: a service that is down fails alone; a process in an unknown state does not go on taking requests, Render starts it again. Owner's correction f. |
| The API calls `enableShutdownHooks()` as the worker does; on SIGTERM the listener stops, the sockets close without `session.ended` (tabs reconnect after 5 s to the new instance), the queue finishes a running job, the pool closes, the reports leave last. `maxShutdownDelaySeconds: 30` on Render | `13`, Hosting: releases without stopping the service. |
| The deploy is a job `deploy-test` of `ci.yml`: only on a push to `main`, after `checks` and `e2e`, in the GitHub environment `test`, concurrency group `deploy-test` without cancelling a running deploy. Steps: `pnpm db:migrate` with `DATABASE_MIGRATION_URL` from the environment's secret (job-level `env`; `DATABASE_URL` and `SECOND_STEP_KEY` emptied), then `node apps/api/dist/deploy/cli.js deploy --commit <sha> <services>` (Render's API, `POST /v1/services/{id}/deploys` with `commitId`, a look every 15 s, at most 80 looks; no clock is read), then `smoke <url>` (five checks: health, the web page, a refused session, a refused non-JSON body, a refused WebSocket upgrade with Node's own `WebSocket`). `autoDeployTrigger: off` on both services; no `preDeployCommand` | Task 0.10: migrations before the new version starts, from `main`, with a smoke test; decision 0.3: the deploy depends on the run of `ci.yml` on `main`; decision 0.5a: the migrator's password exists only in the deploy secret (a `preDeployCommand` would put it into the services' environment). Owner's corrections b and c. GitHub keeps one waiting run per group: the next deploy takes the newest commit with every migration up to it (spec reviewer's finding 4). |
| The deploy commands live in `apps/api/src/deploy/` and ship in `dist` like the other CLIs; nothing imports them on the server | They need `@sodiq/shared` (the error shape, the socket path) and the API's test harness; a file under `scripts/` could not be tested with Vitest. |
| `render.yaml` at the root declares both services (web `sodiq-test-api`, 2 × `0.5c-512mb`, `healthCheckPath /api/health`, the domain; worker `sodiq-test-worker`), region Frankfurt, each build `npm install -g pnpm@<packageManager> && pnpm install --frozen-lockfile && pnpm turbo run build …`, start `node --enable-source-maps apps/api/dist/{main,worker}.js`; the secrets `DATABASE_URL`, `SECOND_STEP_KEY`, `SENTRY_DSN` (and `VITE_SENTRY_DSN` on the API) as `sync: false` in each service's own `envVars`, entered once at creation, the same values on both. `render-blueprint.test.ts` keeps the pnpm version equal to `packageManager` and the secrets as `sync: false` | `13`, Running cost (the test size); owner's corrections a and d (`sync: false` is not allowed in `envVarGroups`; Render has no documented pnpm pick-up, and the cloud VM taught that the version must be installed by hand). `--enable-source-maps`: the API's stack traces name TypeScript lines (owner's answer 6); the `.map` files stay on the server, and Vite's production build writes none for the web. |
| Neon: a project of its own for the test environment (`sodiq-test`, Frankfurt, PostgreSQL 18, Launch plan, scale to zero on); the two users created with SQL by `db/setup/server.sql` (passwords asked by `\prompt`, never on the command line or in a file; `sodiq_migrator` without `createdb`; `revoke connect … from public`; `sodiq_app` keeps the temporary-table right); every address with `sslmode=verify-full`; the application and the listener connect to the direct host, not the pooler | Owner's answer 2 (the Free plan would suspend the project after 100 CU-hours; the listener and pg-boss keep the compute awake). Progress 0.4b (console roles have `BYPASSRLS`). `pg` 8.23 verifies the certificate only for `verify-full`. 0.9: `LISTEN` needs a direct connection; the runner holds a session lock. The pools are small (two API instances with 10 + 1, the worker with 5 + 10). |
| Resend: the account only (EU region), no domain, no key, no code; R2: the bucket `sodiq-test-files` (Western Europe), no token; both in `docs/deploy.md` with the task that uses them (2.3; the first task that stores a file) | Owner's answers 4 and 5. |
| The headers of `db/setup/local.sql` and `.env.example`, and the 0.2 line of this file, no longer say the server users are created "in the provider's dashboard" | Spec reviewer's finding 7: no later session creates a console role. |

## 8 October 2026: notifications to staff in the app (task 0.9)

Plan approved by the owner on pull request #32 (`[review] approved`, with the answers to the ten questions). Answer 10: the owner runs `/spec-change` to add reading and marking his own notifications to the Principal's own-account changes (`edge/people-roles-accounts`, "Who can act"), in a pull request of its own that merges before this one; until it is on `main`, the three routes below are ahead of the spec.

| Decision | Reason |
| --- | --- |
| `notifications` (`0013`) is school-wide with a `branch_id` label: in `SCHOOL_WIDE_TABLES` and `SCHOOL_WIDE_WITH_BRANCH` of `catalog.test.ts`. One row per person and event: `account_id`, `branch_id` (empty for an event of the whole school), `kind` (format check only; the list is `NOTIFICATION_KINDS` in `packages/shared`), `data` (jsonb, checked against the kind's schema at write time), `created_at` and `read_at` from the clock. `sodiq_app` may `select, insert` and `update (read_at)`; nothing is deleted | Owner's answers 1, 7 and 8. A person reads their notifications from every branch at once, before any branch is chosen; a Super Admin's or a school-wide event has no branch. A later task adds a kind without a migration. |
| The text is made in the browser from the kind and its data (`notifications.kinds.<kind>` in the three locale files; `locales.test.ts` fails for a kind without texts; a kind the tab does not know shows `notifications.kinds.unknown`); the server stores no text. This task defines the registry and `sample.message` only; no route sends a notification | Owner's answers 2 and 7. One set of texts, in the language of the tab, which is the account's language (0.8d); Release 2 renders SMS on the server from the same registry. |
| `Notifications.send(transaction, { kind, data, branchId, accountIds })` writes one row per account (each once, the branch checked against the transaction's filter) and enqueues one `notifications.deliver` job with the ids and `branchIds: []`, in the caller's transaction. The handler issues `pg_notify('sodiq_notifications', …)` in chunks of 100 ids and changes no row; the request key of the runner is its only write, so a second delivery runs nothing. No audit entry for a notification sent or read | Owner's answers 4 and 5; `13`, Background jobs; `edge/system-behaviour`. A NOTIFY payload of 8000 bytes or more is refused. The change that causes a notification writes its own entry. |
| `GET /api/notifications` (the latest 50, newest first, with the branch name and the unread count), `POST /api/notifications/:id/read` (another account's id is 404; a second mark changes nothing) and `POST /api/notifications/read-all` are `@AnySignedIn()`. A read mark issues `pg_notify` with `{ kind: 'read', ids }`; "read all" with `{ kind: 'read_all' }` and no ids | Owner's answers 9 and 10 (the spec change of the Principal's list is the owner's, pending at the end of this task). Routes of the own account; the payload stays small whatever the count. |
| The live connection is Socket.IO attached by hand to the HTTP server of the API at `/api/socket` (`LiveSockets`; no `@nestjs/websockets`), WebSocket only, `maxHttpBufferSize` 1 KB, no handler for a client message. The handshake refuses, with a code the client reads: another site (`fromOwnSite` of `same-site.ts`, applied whatever the method), `not_signed_in` (no cookie, session over, locked account), or the owed step. It reads the session with `Sessions.peek`, which never writes `last_used_at`. A connection joins the room of its account and gets `notification.state` at once. Before every push `LiveSockets.tell` peeks the sessions of the room's connections in one transaction; a connection whose session ended or owes a step gets `session.ended` and is closed | Owner's answer 3; `13`, Socket.IO and Hosting (two application servers: no long polling, no sticky sessions); `13`, Security (a connection is not use of the session); spec reviewer's findings 2, 3, 6, 7 and 12. |
| `LiveListener` is one dedicated `pg` client per API process with `LISTEN sodiq_notifications`; it reads the rows of a `new` payload (`Transactions.run([])`), groups them by account and pushes; `read` and `read_all` are pushed as they are. It reconnects after a second when its connection drops. The API process starts it in `main.ts`; the worker does not; a test starts it with the address of its database. Log lines hold ids and counts only | `13`, Hosting: NOTIFY reaches every API process alike; what was missed is in the table and comes with the state at the next connection. CLAUDE.md: no personal data in logs. |
| The web keeps the connection outside React, in `createShell` (`liveFollower`): it opens with the first complete session answer, closes at sign-out and when the session is read as ended or owing a step, and feeds `state`, `new`, `read` and `read_all` into the cached list (`['notifications']`, `staleTime` infinite). After the server ends it, or refuses the handshake with a session code or `cross_site_request`, the client stops reconnecting, asks the API about the session once (`refreshSession`, then `router.invalidate()`), and opens nothing again for the same session answer. A network failure is tried again by socket.io-client itself; after any other refusal (`internal_error`: the check failed) or a close by the server without `session.ended`, which socket.io-client does not retry, the tab opens the connection again after 5 s, doubling to 60 s | Spec reviewer's findings 2 and 3; `.claude/rules/web.md`: nothing polls the API. The guards of the pages send the tab to the step it owes, as after a refused call. |
| The bell of the top bar (`NotificationsButton`): the unread count as a badge and in the name of the button; a `Dialog` (not a page) with the latest items newest first, the branch name and the moment, the unread mark as a dot and the word, a click marks one read, "Mark all as read"; a mark asks the list again once. `renderApp` takes a `LiveConnector` (default: none) | Owner's answer 9; `12`, Look and feel (no information by colour alone). The dialog follows the feedback dialog of 0.8b-3. |
| The browser-test API (`testing/e2e/server.ts`) also runs the jobs worker in its process, and `testing/e2e/notify.js <login> <text>` sends a `sample.message`; the Vite proxy forwards WebSockets (`ws: true`) | The browser test of live arrival needs a delivery during the test. |
| Notification settings are deferred: the first task that adds a kind that may be turned off brings them (a section of the account page and the rule which kinds are required); Release 2 adds the channels | Owner's answer 6. `10` names no required events; Release 1 has one channel and no kind to turn off. |

## 7 October 2026: own account page (task 0.8d)

Plan approved by the owner on pull request #30 (`[review] approved`, with the answer to the one question). The owner's six decisions of 7 October are in the plan of that pull request.

| Decision | Reason |
| --- | --- |
| "Sign out everywhere" ends every other session of the account and keeps the asking one; the trust of the asking session ends with it (`trust_ended_at`, entry `auth.trust_ended` with `details.reason: 'sign_out_everywhere'`, the cookie set again without `Expires`), so from then on it has the idle sign-out. After the open sessions of the account are locked it checks that its own session is still open and answers 401 `not_signed_in` otherwise. The entry `auth.sign_out_everywhere` is written at every call, `details.endedSessions` counting the others (0 is possible). This changes the 0.6b line "the asking one included" | Owner's decision 4. `edge/people-roles-accounts`: trust ends at once on "sign out everywhere", the literal reading the owner confirmed for the password change in 0.6d. The same hole as the password change (0.6d): a lock or the removal of this device at the same moment. The log records the action each time the person asks for it (decision 6). |
| The language lives on `accounts.language` (`0012`; `accounts_language_check` with the three values, a test compares the list with `LANGUAGES` of `packages/shared`; `grant update (language)`); a new account is `uz` (`Accounts.create` writes `DEFAULT_LANGUAGE`, the column has the same default). `PUT /api/auth/language` is `@AnySignedIn()` without an `@AllowedBefore...` mark: refused while a step is owed. The same language again writes nothing and no entry; a change writes `account.language_changed` with `oldValue` and `newValue` `{ language }` under a lock of the account row. `language` is in every session answer, also while a step is owed | Owner's decision 1 and `12`, Language. `.claude/rules/api.md`: the marks are for the own sign-in only; `POST /api/feedback` is the precedent. The language is a fact of the account, not something shown, unlike `assignments` and `branches` (0.8c). |
| The web applies the account's language only from an answer whose session owes no step (`followAccountLanguage`, called from the session-query subscription of `createShell`, which now takes `i18n`). The chooser on the pages before sign-in (`AuthPage`) changes the browser and sets a mark per tab (`sessionStorage`, `sodiq.languageChosen`); at the first complete answer the marked language is saved to the account with one `PUT`, and the mark is cleared once the save has succeeded (at once when it is the account's language already); a save that fails keeps the mark, and the next complete answer sends it again; the mark is also cleared when a session answer is `null` after a session was there (sign-out, an ended session); a reload of the sign-in page before any sign-in keeps it. The chooser of the layout and the field of the account page save to the account at once (`useAccountLanguage`); their failure is shown with `FailureAlert`. The browser still remembers the language it shows (`sodiq.language`), so after sign-out the sign-in page stays in the language of the last person | The owner's answer to the plan question: a person who picks a language before the first complete sign-in keeps it, and a tab that merely shows the last person's language sets no mark, so on a shared computer the next person gets their own account's language. A save that fails is not shown there: the tab keeps the chosen language and its mark, and the next complete answer sends it again (asked for by the owner's reviewer). |
| `/password` is the forced change only (step `password`); a complete session that opens it is redirected to `/account/password`, the change by choice inside the layout with the breadcrumb "Account". `PasswordPage` takes its frame from `mustChangePassword` | Owner's decision 3; it closes the open point of 0.8b-3 (the page outside the layout had no feedback button and no search). A bookmark or an old link still lands on the page. |
| "Account" (`/account`) is the entry every role has in the menu, in place of "Change password", and is not a row of `MENU`; the account menu of the top bar has Account, Change password and Sign out; `COMMON_PAGES` has both pages | Owner's decision 4. The `MENU` table and its test stay as approved in 0.8c; the two longest rows reach 10 with the entry, the limit of `12`. |
| The moments of sessions and devices are shown with `Intl.DateTimeFormat` of the chosen language in the time zone of the device | `12`: dates follow the chosen language. An account belongs to no branch, and the branch time zone is a setting of a later task. |
| The sessions and the trusted devices are a plain shadcn `Table` with no search, filters or side panel, not a `ListPage`; the `User-Agent` is shown as stored (cut to 200 characters by the server) | A handful of rows with no record to open and nothing to export; the lists of `12` are record lists. A readable device name needs a parsing library (`CLAUDE.md`: ask first). |
| The three stages of the set-up are the component `SecondStepSetUp`, used by the set-up step (`SetUpPage`) and by the account page; the account page answers `second_step_already_on` by reading the overview again and showing "on", and `second_step_not_on` by starting again. Turning off takes the code of the app in a small form, no further dialog; `second_step_not_on` and `second_step_cannot_turn_off` there read the overview again | Decision of 0.8a for the step page; owner's decision 4 ("no extra confirmation"); the server refuses "off" for the strict roles, the missing button is display only. |
| The note "this device is not trusted" closes for good once the device is trusted, so a trust that ends while the layout stays mounted (a password change by choice, "sign out everywhere") does not show it | Found while building: before 0.8d the password page stood outside the layout, which remounted and re-read the mark; now it does not. |
| In the web tests `sessionOf` answers the language of the last `renderApp` | Tests that render in Russian or Uzbek would otherwise switch to English at the first answer of the session. |

## 7 October 2026: web shell: menus and home pages per role (task 0.8c)

| Decision | Reason |
| --- | --- |
| `GET /api/auth/session` (and the sign-in and code answers, one schema) carries `assignments` (`{ role, branchId \| null }`, in the order of `ROLES`) and `branches` (`{ id, name }` by name): every branch for an account with a Super Admin or Senior Head Teacher assignment, otherwise the branches of its current assignments. Both lists are empty while a step of sign-in is owed (`answerOf`, the only exit). No new route; still `@AnySignedIn()`. The branches are read where an answer is made (`Sessions.answerOf`), not in the session read of every request | The web needs them for the menu and the switchers. The branch list has a source: `branches` has no row filter (not a branch-owned table; names only). Owner, `[review] approved` on pull request #27, answers 5 and 6. The server still checks every request on all current assignments. |
| The menu per role is the table `MENU` in `packages/shared/src/menu.ts`, display only; `visibleMenu` shows an item only when its page is built (`BUILT_PAGES` in `apps/web/src/features/access/menu-pages.ts`) and, once the permission table has an area of the item's name, only when `permits(…, 'view')` allows it. The permission table wins where they differ; a later task corrects the menu table. At the end of 0.8c the menu is Home and Change password | Owner, second `[review] approved` of pull request #27 (the table) and answers 1 and 2. The Head Tutor's Timetable item awaits the owner's spec change (`/spec-change`). |
| Head Teacher and Senior Head Teacher menus have no Teacher items; a person who teaches holds a separate Teacher assignment and uses the role switcher | Owner, answer 7. |
| The role and the branch on display are kept per tab in `sessionStorage` (`sodiq.role`, `sodiq.branch`), never on the account. Default role: the first held in the order of `02`; default branch: the first of the branches that suit the role (a branch-bound role suits the branches of its assignments, the two school-wide roles every branch). A stored choice the account does not hold falls back to the default (the store is not rewritten); sign-out, an ended session (a session read as ended, a call refused as `not_signed_in`) and the next sign-in clear both. Role switch moves the branch when it does not suit the new role. One entry per role even when held in two branches. No "all branches" | `edge/people-roles-accounts`: "Role and branch on display are kept per tab", "every request is checked against one branch". Owner, answers 4 and 5. |
| The API client sends the branch of the switcher as `X-Branch-Id` on every call (`apps/web/src/api/client.ts`, `branch-in-use.ts`); routes that are not bound to a branch ignore it | Decisions of task 0.4b: a branch never comes from the path, the query or the body. Set in a layout effect, before the queries of the page run. |
| Roles without a home page in `08` (Student, Parent, HR, Nurse, Psychologist, Librarian) get Home only, with one line saying their part comes in a later release | Owner, answer 3. |
| The Ctrl+K index is the menu pages of the active role plus the pages every role has (`COMMON_PAGES`); the phone menu is the shared dialog | Plan of 0.8c; no new library. |

## 6 October 2026: web shell: shell tools (task 0.8b-3)

| Decision | Reason |
| --- | --- |
| The Principal may send a feedback report: `POST /api/feedback` is declared `@AnySignedIn()`, the permission table gets no area `feedback`, and the comment of `AnySignedIn` and the `any_signed_in` block of `route-permissions.test.ts` name a report about the own experience of the app beside the own sign-in | The plan review found that the closed list of the Principal's own-account changes (edge cases, "Who can act") refused it while `14` puts the button on every page; the owner changed the spec on 6 October (`docs/spec-changes.md`). `checkTable` keeps the Principal at view and export, which holds. |
| "At most 20 reports a day per account" is the last 24 hours: the reports with `created_at` after now minus 24 hours are counted against the injected clock, the 21st is `429 too_many_attempts` with `Retry-After` in whole seconds rounded up until the oldest of them is 24 hours old, and nothing is stored for it. The row of the account is held (`select … for update`) while the reports are counted and the new one is written | No spec file sets the limit; it is the owner's rule from the plan of 0.8b-2. An account has no branch, so no calendar day (`edge/00-definitions`, "Branch time") belongs to it; developer rules, "Time-based state": stored moments compared with the clock. The limit is application code, not a constraint, so two reports sent at the same moment count each other through the lock (`feedback.test.ts` proves it). The owner overrules with one line if a calendar day was meant. |
| `feedback_reports` is school-wide, insert-only for the application (`grant select, insert`), with checks on the roles (the 15 of 0009, the empty array allowed), the page (`^/[^?#]*$`, at most 500) and the text (1 to 2000 after trimming); the roles are those of the session, written by the application once each in the order of `ROLES` (the constraint checks the names, not the count); no audit entry | Decided by the owner at the plan of 0.8b-2: a school-wide table, roles from the session and never from the body, the page without the query, no audit entry, the owner reads the table until a screen exists. `14`, Monitoring: "with the page and role attached"; an account without a role sends a report with no roles. |
| The feedback dialog (`apps/web/src/features/feedback/`) checks its field with `useRecordForm` and the schema the server checks, and has a Send button of its own: no `RecordForm`, no entry in the store of unsent changes, the sign "sent" in a status region that is always there. A text typed and not sent is kept by the tab while the dialog is closed and opened again, and is lost at a reload or sign-out. After a send the form is new and takes the focus; `too_many_attempts` gets a text of its own with the limit interpolated | A report is sent once, not saved: "Save" and "Saved." would be the wrong words, and the rule of `web.md` about Save buttons is the rule of record forms (0.8b-2: "record forms have a Save button"). `12`, No lost work, is met by the check while typing and by keeping the draft; the owner decided in 0.8b-2 that what is typed is lost when the session ends. The shared text of the code speaks of failed attempts. |
| The theme is `device`, `light` or `dark`, `device` by default, kept in the browser (`localStorage`, key `sodiq.theme`); `ThemeStore` (`apps/web/src/theme/theme.ts`) puts the class `dark` on `<html>` before the first render and follows the device while the choice is `device`; `color-scheme` follows in `index.css`. The switch is a select beside the language chooser, in the layout and on the pages before sign-in; the store is given to `App` like i18n | `12`, Look and feel: "Light and dark themes", and "These rules apply to every page". Decided by the owner: as the device by default, kept in the browser. The same control as the language: it works with a keyboard, a screen reader and a phone without further code. |
| The Ctrl+K search (`apps/web/src/components/search/command-search.tsx`) knows the pages of `PAGE_INDEX` (`apps/web/src/app/page-index.ts`): a combobox over a listbox in the shadcn dialog, matched with `searchKey` and `searchWords` of the lists, the arrows, Enter and Escape; Ctrl+K and Cmd+K open it, and so does a button in the top bar; the active page is marked by a sign as well as by colour | `12`, Search and Speed targets ("Results while typing"); Devices: a tablet or a phone has no Ctrl+K. Decided by the owner: no `cmdk`. 0.8c filters the index by the menu of the role; the records come with their tasks. |
| The shadcn `dialog` and `textarea` components were written by hand after `alert-dialog.tsx` and `input.tsx`, without the close cross of the registry's dialog | The registry (ui.shadcn.com) cannot be reached from the cloud environment's network, and the components are copies in the repository either way. Every dialog names its own closing button with a translated text. |
| `tooling/contrast.test.ts` checks every text and control pair the components draw, with the alpha of the component's class list, to WCAG 2.1 AA (4.5:1 text, 3:1 controls) in both themes. Tokens changed: light `--muted-foreground` 0.556 to 0.54, `--input` 0.922 to 0.65, `--ring` 0.708 to 0.556, `--destructive` 0.577 to 0.53 (chroma and hue as they were); dark `--destructive` 0.704/0.191 to 0.8/0.17, `--muted-foreground` 0.708 to 0.74. light `--sidebar-ring` 0.708 to 0.556 for the menu of 0.8c. `alert.tsx` draws the destructive description at full strength (was 90%); `button.tsx` hovers the default button at 90% instead of 80% (the text had 3.91:1), keeps the destructive tint at 10% in the dark theme with a 60% border on hover instead of a 30% tint, and lets every variant keep the shared focus border `border-ring` (the destructive one had a red border at 40%, 1.49:1). `border` and the 50% focus halo are not checked | Decided by the owner at the plan of 0.8b-2: contrast to WCAG 2.1 AA, brand colour and logo later. Before: light input border 1.26:1, focus ring 2.59:1, muted text on muted 4.34:1, destructive button 4.39:1 and its hover 4.01:1, destructive alert text 3.46:1; dark destructive button 3.16:1 (3.04:1 on a card), its hover 2.49:1, placeholder 4.14:1. No tint of 20% or more passes for a light red text on a dark page whatever its lightness. Dividers and card edges are decorative, and the solid `border-ring` is the focus indicator (1.4.11). |
| The browser tests find the language chooser by its name (`languageChooser` in `apps/web/e2e/steps.ts`) | The theme switch is a second select on every page. |
| A web test may take 15 seconds (`testTimeout` in `apps/web/vite.config.ts`), as an API test may take 30; the 2 workers stay | The first test of a file pays the cold start of its worker, and a page test draws the whole app in jsdom: the first test of the sample list (100 rows, 1.4 s here) ran to 5.26 s on a cold CI worker and failed at the default 5 s, on this branch and before it (pull request #26). The top bar grew by three tools in this task, so every page test draws a little more. The limit of a hook and the number of workers are not changed; nothing the tests assert changes. |

## 5 October 2026: web shell: forms (task 0.8b-2)

| Decision | Reason |
| --- | --- |
| A record form is `useRecordForm` and `RecordForm` (`apps/web/src/components/form/`), with no form library. The fields hold text; `read` turns it into what the schema of `packages/shared` checks, and the schema is the only check. A field says what to fix once something was typed into it, every field after Save was pressed. Save stays on while a field is wrong: pressing it puts the focus into the first wrong field | `12`, No lost work: "Forms check each field as it is typed and say in plain words what to fix." The server checks the same schema, so the two cannot disagree. A Save button that is off does not say why. Decided by the owner: record forms have a Save button. |
| The web app reads a schema through `FormSchema` and `FormIssue` (`form-messages.ts`), written out by hand, and does not import `zod` | `zod` is a dependency of `packages/shared` only; adding it to the web app would be a new dependency. The texts for the kinds of issue (`form.*`) are shared; a feature can give its own per field. |
| A field for a number is a text field with the numeric keyboard, read with `wholeNumber`: digits only, at most 15 | `CLAUDE.md`: typed scores and totals are whole numbers. A number field of the browser changes with the mouse wheel and hides what was typed when it is not a number, so the form could not say what to fix; `Number()` would read `1e3` and `0x10`. |
| The sample form's schema (`sampleRecordSchema`) lives in `packages/shared/src/sample.ts` though no route takes it | The sample must show a form checked by a schema of `packages/shared`. |
| One confirmation dialog for the app (`ConfirmProvider`, `useConfirm()` answers a promise), on the shadcn `alert-dialog`. It writes out the first 10 names of what is affected and counts the rest; the focus starts on the button that changes nothing; Escape answers "no"; the focus returns to where it was. A bulk action of a list asks through it when it has `confirm` | `12`, No lost work: "Actions that cannot be undone ask for confirmation and name what will be affected." |
| What is typed and not saved is held in one store of the tab (`components/unsent/unsent-changes.tsx`). A form puts itself there while it has typed changes or a failed save. `UnsentGuard` (in the layout) asks before a change of page or of the open record (`open` of `ListSearch`); `useLeave()` is for what takes a form away without a change of address (another row, closing the panel, sign-out). Leaving by choice resets the forms. A search, a filter or an order behind an open record does not ask | Decided by the owner: a warning before leaving with typed changes. The list shows its own state before the address follows, so a navigation refused afterwards would have closed the panel and lost the text: the list asks before it changes. |
| The question about leaving waits for a save that is on its way: saved, nothing is asked; refused, the question names the form. One question for the tab, whoever asks (the pending question is held by the store). "Saved" is said only when the fields still hold what was sent; a refused save is over once the fields hold what is saved again | From the review: the question said "will be lost" while the save landed anyway, and "Saved." stood beside text typed after Save was pressed. |
| A question that is open is answered "no" when the layout goes away (`useDismissQuestionsOnLeave`); the focus after a question asked from a menu item returns to the button of the menu; the heading of the side panel takes the focus once per record (`recordKey`), not at every change of its title; the message of a field sits in a polite live region that is always there | From the review: a dialog could outlive its page and run that page's action; a menu item is gone when its dialog closes; saving a changed name threw the focus out of the field; a message that arrived while typing was not read out. |
| The sign of unsaved changes is a button in the top bar, in a status region that is always there | A banner under the top bar would move the page at the first typed letter (`12`: the page never jumps). An icon and words, not a colour. 8.3c adds the journal queue to the same store. |
| When the session has ended, the tab goes to the sign-in page without the warning (`ignoreBlocker`), and what was typed is lost | Decided by the owner: nothing can be saved without a session. The sign-in box over the page is the journal's rule (8.3c) and may later serve record forms too. |
| The Back button and the closing of the tab with typed changes are tested in the browser test only | The memory history of the unit tests asks blockers for a push and a replace only, and has no `beforeunload`. |
| The web tests run at most 2 files at once (`maxWorkers` in `apps/web/vite.config.ts`) | As in the API (0.7a), which takes 4 processors beside them in `pnpm test`. With a further file of page tests, the first test of the sample list (2 s alone, the same with and without this task's code) ran past its 5 seconds in the full run, also with 4 files at once. No limit was raised. The web tests alone now take about 115 s inside `pnpm test`. |

## 5 October 2026: web shell: lists and page states (task 0.8b-1)

| Decision | Reason |
| --- | --- |
| A list loads every row of its branch and searches, sorts and filters in the browser (`matchingRows` in `apps/web/src/components/list/list-state.ts`). The state of a list (`ListSearch`: search, order, filters, open record) lives in the address of its page; a list too long for the browser (the audit log, 2.6) keeps the same state in its address and asks the server | Decided by the owner: the lists of a branch are small (at most a few thousand rows) and the search must answer while typing, under 0.2 seconds (`12`, Speed targets). `12`, Navigation: every page has its own address, so links and the Back button work. |
| "Tick all" ticks every row that matches the search and filters, also rows not drawn yet. Ticked rows stay ticked when the search changes; the bar says how many are ticked and how many of them the search does not show now. A bulk action is given every ticked row | "Tick all" decided by the owner. Keeping the ticks lets a person search for one name after another and tick each (the placing screens of 3.2). The spec does not say what happens to a ticked row that the search hides: the count of rows not shown is my answer to "a person sees what an action will touch"; the owner may decide otherwise. |
| Only 100 rows are drawn at once, with "Show more"; a new search, filter or order starts from the top | A table of thousands of rows redrawn at every key would miss the 0.2 seconds on the school's older computers. No virtual scrolling library. |
| Typing in the search box filters at once; the address follows 0.3 seconds after the last key and replaces the entry of the history. A filter, an order and an opened record add an entry | The router changes an address asynchronously: a box bound to the address loses letters typed quickly. The Back button undoes a filter or closes a record, and does not walk back through every letter. |
| The list keeps its own copy of its state, shows that at once and writes it into the address; it remembers what it wrote (`sent`) until the address arrives. An address that arrives and is not among them was changed by somebody else (the Back button, a link), and the list follows it | From the review: with one remembered value, an older write that landed late put old text back into the search box, and a timer armed against the old address could take back a sort that was just clicked. A write that never arrives (a navigation that was refused) leaves the list ahead of its address until the next change; nothing refuses such a navigation today. |
| The bar of bulk actions is there from the start, with its buttons off while nothing is ticked. "Clear selection" hands the focus to "tick all", "Clear search and filters" to the search box, and a closed panel whose row is not drawn to the search box | From the review: a bar that appeared at the first tick moved the table under the pointer, and a button that removed itself dropped the keyboard to the top of the page (`12`: full keyboard use). |
| Counts in the texts of a list are written by `Intl.NumberFormat` of the chosen language and handed over as `{{n}}`; `count` only chooses the plural form | `12`, Language: numbers follow the chosen language. `{{count}}` of i18next is the bare number. |
| With rows and an error (a later load failed) the list keeps its rows and shows the failure above them; without rows the failure takes the place of the table | From the review: TanStack Query keeps the data of the last good load beside the error. |
| The lint rule for hard-coded text does not see a text inside an object: the `header` of a column, the `label` of a filter, a bulk action or a breadcrumb, `empty.text` | They are not JSX attributes. Added to the list of what the rule cannot see (0.8a). |
| The search ignores case, composed letters, and the difference between the apostrophe of the keyboard and its look-alikes (U+02BB, U+02BC, U+2018, U+2019, the grave and acute accents) | A person types `o'` where the record has `oʻ`, and the other way round. |
| Texts sort with `Intl.Collator` of the chosen language (numbers inside a text by value); a row without a value is last in both directions; rows that sort alike keep the order the list came in | A list sorted by score shows the students with a score first whichever way it is sorted. |
| The hidden columns of a list are kept in the browser (`localStorage`, key `sodiq.list.<list>.hidden`), not on the account. The column that opens the record cannot be hidden | Decided by the owner. Without that column a record could not be opened. |
| The Export button of a list hands the feature the matching rows and the keys of the columns shown; the list makes no file | `CLAUDE.md`: exports follow the role and are logged, so the server makes the file (`13`: ExcelJS). Each list brings its export route (from 2.2). Changed by 2.2c-1: the ticked rows when some are ticked, and the search and filters too ("12 October 2026: exports (task 2.2c-1)"). |
| The side panel is a region beside the list, not a dialog: the list stays usable and a click on another row moves the panel to that record. On a narrow screen (below 1024 px, also a laptop at 200% zoom) the record takes the place of the list, which is hidden until the panel closes; the top bar stays. Its heading takes the focus when it opens; Escape and its button close it and give the focus back to the row. Escape in a field outside the panel (the search box) belongs to that field. The open row carries a bar at its start, not only a background | `12`, Lists: "a side panel that opens a record without leaving the list"; Look and feel: full keyboard use, no information by colour alone. A dialog would lock the list behind it. From the review: a panel laid over the page left the hidden list in the Tab order. |
| Checkboxes of the table are plain HTML checkboxes, the filters plain HTML selects | As in 0.8a: they work with the keyboard, a screen reader and a phone without further code. "Some rows ticked" is the `indeterminate` property of the box. |
| The sample list is the page `/dev/patterns`, with invented rows that live in the page. The route answers "no such page" unless `import.meta.env.DEV` is true, and the bundler leaves the page out of the built app. `?demo=empty`, `loading`, `error` and `many` show the states | "Done when: a sample list uses only the shared pieces." The browser tests and `pnpm dev` run Vite in development mode. Task 0.8b-2 adds the sample form. |
| The table header is not sticky | The table scrolls sideways in its own box on a narrow screen, and a header cannot stick to the page from inside such a box without a fixed height. Decide with the first long list (2.2) whether the list gets a height of its own. |

## 5 October 2026: web shell: sign-in, layout and languages (task 0.8a)

| Decision | Reason |
| --- | --- |
| The texts are one TypeScript file per language in `apps/web/src/i18n/locales` (`uz.ts`, `ru.ts`, `en.ts`). The keys of the English file are the shape: the other two are typed against it (`Texts` in `shape.ts`), and `t` accepts only keys that exist | "A missing translation fails the build" (`12`, Language): a missing key fails `tsc`, which is the first half of the build of the web app, and the type-check. `translationProblems` (`check.ts`, run by `locales.test.ts`) checks what types cannot: empty texts, the same `{{names}}`, the plural forms of each language (Russian has four), a text for every error code of `packages/shared`. |
| A lint rule refuses text written into a component of `apps/web/src`: letters between tags, also behind one choice or join (`on ? 'A' : 'B'`, `on && 'A'`, `name + ' text'`), and a literal in the attributes a person reads or hears: `aria-label`, `aria-description`, `aria-roledescription`, `aria-valuetext`, `placeholder`, `title`, `alt`, and the text properties of our own components `label`, `note`, `text` (`hardCodedText` in `eslint.config.js`, test in `apps/web/tooling`) | `CLAUDE.md`: no hard-coded strings in components. No plugin: selectors of `no-restricted-syntax`. It catches the usual ways, not every way. Not seen: a text built in a variable first, a text two choices deep, a text under a property name that is not listed (also `value` of a submit input, which is left out because most values are not texts), and a text in a `.ts` file. The names of the languages (`LANGUAGE_NAMES`) are such texts on purpose: each language under its own name. |
| Uzbek is written in Latin script, with U+02BB in oʻ and gʻ and U+02BC as the tutuq belgisi. A first visit takes the first language of the browser that is one of the three, else Uzbek. The choice is kept in the browser (`localStorage`, key `sodiq.language`) | Decided by the owner. A language is needed before sign-in, so the browser keeps it; task 0.8d also stores it on the account, which 0.9 needs for notices. |
| `i18next` and `react-i18next` without a language detector and without a loader: the three languages are part of the bundle and the first language is found by a few lines of our own (`preferredLanguage`) | The texts are small, and every screen needs its language at once. No further library. |
| A person sees the translation of the error `code` (`failureText`), never the `message` of the API. An answer that is not the one error shape (no connection, the API is down) is the failure `no_answer` with a text of its own | The decision of 0.4a, now built. A proxy answers 502 with a page of its own when the API is down; that is not an "internal error" of ours. |
| TanStack Router with routes written in code (`apps/web/src/app/router.tsx`), without the file-based generator and its Vite plugin | Web code is grouped by feature (`CLAUDE.md`); pages stay in their feature folder and one file lists the addresses. One build step and one generated file fewer. |
| The session is one TanStack Query (`sessionQuery`). A page opens only for the step its session stands at (`only(...)` in the router), in the order of the server: code, password change, set-up. It is asked again when a page is opened more than a minute after the last answer, never on a timer and not when the window gets the focus | The guard of the router is a convenience; the server refuses every route a session may not call. A call the app makes by itself would count as use and keep an idle session alive (note of 0.6b). |
| When any call is refused with `not_signed_in`, the tab forgets everything it loaded and opens the sign-in page with "your session has ended"; with `second_step_required`, `password_change_required` or `second_step_set_up_required` it reads the session again and goes to that step (`createShell`) | "Rights are read again on every request" (edge cases, "Accounts and sign-in"): the tab follows what the server says, whatever it believed. |
| The set-up of the second step is started by a button, not by opening the page; the recovery codes are left only after "I have saved the codes": until then the router refuses every move away (`useBlocker`: Back button, links, the guards) and the browser asks before a reload or before the tab is closed | Every start makes a new key on the server, and React runs effects twice in development. The codes are shown once; found by the review: after a minute on the page the Back button asked the server again, which said "passed", and the codes were gone. A reload that the person confirms still loses them: the server shows them once. |
| When the set-up or its confirmation is refused with `second_step_already_on`, the page reads the session again and goes where it says | From the review: the answer of a confirmation can be lost, or the set-up was finished in another tab; the person stood on the key with no way on. In the first case the recovery codes were never seen: only a reset of the second step gives new ones (2.3), or turning it off and on where it is optional (0.8d). |
| The forced password change has a sign-out button | From the review: a one-time password can run out while the page is open, and every other address leads back to this page. On a shared computer the person must be able to leave. |
| An error that is not a failure of a call (an answer the app cannot read, a fault while drawing a page) is shown as "something went wrong in the app, reload the page" (`problems.unexpected`), not as a lost connection | From the review; `12`, Look and feel: error messages say what happened and what to do next. |
| The password page asks for the new password twice | The spec does not ask for it. A typing mistake in a hidden field would lock the person out until an administrator resets the password, and no route for that exists before 2.3. |
| `qrcode.react` draws the QR picture of the set-up | Approved by the owner. Without it the person types a key of 32 characters by hand. It has no dependencies and draws an SVG in the browser; the key goes to no other service. |
| The switch "Trust this device" and "I have saved the codes" are plain HTML checkboxes; the language chooser is a plain HTML select | They work with the keyboard, a screen reader and a phone without further code. The shadcn checkbox was not added. |
| The note "this device is not trusted" is shown on the first page after sign-in when the switch was on and the session is not trusted; the tab remembers the switch in `sessionStorage` and forgets it as soon as the session is trusted or the password is changed by choice (the page of that change says that the trust ends) | Trust never begins with a first or reset password (0.6d); the owner decided in 0.6c that the screen says to sign in again. The server does not say whether the switch was on. |
| The browser tests have a database of their own, `sodiq_e2e`, dropped and built again from the migrations at every run, and an API and a web app on ports of their own (3001, 5174). Playwright starts `apps/api/src/testing/e2e/server.ts` (the API as it runs, after building the database) and Vite; its global setup runs `seed.ts`, which creates the accounts and prints them as JSON. Both are compiled by `tsconfig.e2e.json` into `dist-e2e`, which no server build contains | Decided by the owner: `sodiq_dev` stays for hand tests and collects no accounts. No route creates an account before 2.3, and the first-account command works once. The helpers that create and drop databases moved from `test-database.ts` to `database-server.ts`, so the API tests and the browser tests share them; they refuse a host that is not this machine, and the server and the seed of the browser tests check both addresses before anything is dropped, created or started. A deploy must never copy `apps/api/dist-e2e` (0.10). |
| The seeded accounts reach the tests through an environment variable of the Playwright process and are written to no file | First passwords of a database that lives until the next run; nothing to clean up and nothing to commit by mistake. |
| The second step in the browser tests is computed by a small RFC 6238 function of the tests' own (`apps/web/e2e/totp.ts`); the second sign-in uses a recovery code | The test checks the server against the standard, not against its own code. A code of the app counts once, so a second sign-in within 30 seconds needs another proof. |
| Chromium accepts the cookies `__Host-sodiq_session` and `__Host-sodiq_device` with `Secure` on `http://localhost`; a browser test checks the attributes of the session cookie | The open point of 0.6a: name and `Secure` stay fixed and do not become configuration. |

## 5 October 2026: request hygiene (task 0.7c)

| Decision | Reason |
| --- | --- |
| The API reads JSON bodies only. A middleware before the body parser (`apps/api/src/http/json-only.ts`) answers 415 `unsupported_media_type` to a request with a body whose `Content-Type` is not `application/json`, or that names no type; a request without a body (also `Content-Length: 0`) passes | From the review of 0.6a: a plain HTML form of another site can build a form-encoded, multipart or plain-text body, never a JSON one. Before the body parser, so such a body is not even read; the cross-site check still stands in front. |
| A route that takes files will be a declared exception: a short list of method and path in `apps/api/src/http/`, pinned by a test against the declaration of the route. It is not built yet | A middleware runs before routing and cannot read a decorator. Decided by the owner at the plan; the upload task adds the list. |
| 415 has the code `unsupported_media_type`, by its status, so the body parser's own 415 (an unknown charset) has it too | A code of its own for the web app to translate (0.8a). Decided by the owner. |
| `Cache-Control: no-store` is set by a middleware that runs first, on every answer: routes, refusals of the cross-site check and the body parser, unknown paths, faults, the public health route | From the review of 0.6a: a shared classroom computer keeps no answer. The harness also checks the header on the answer of every route for every caller. Errors that Node answers before Express (malformed HTTP) cannot carry it. |
| A request key belongs to an account: `request_keys.account_id` (migration 0010), required by `KeyedRequest.accountId`; the same key from another account is 409 `request_key_reused`, the same answer as for other input | Nobody gets the stored answer of somebody else's request. The account is compared as a column, not inside the hash, so the cleanup and the support view of later tasks can read it. |
| A job key has no account. The database checks that `account_id` is empty exactly when the scope begins with `job:` | A job runs for no account (`JobRunner`). The check keeps a route from storing a key without its account. Decided by the owner. |
| A job key has its own entry point, `RequestKeys.runJobOnce(transaction, { key, jobName, input }, work)`, which builds the scope `job:<name>`; `runOnce` needs an account and refuses a scope that begins with `job:` | Found by both reviews: with one entry point a route could name its scope `job:...` and pass no account, and every account could then repeat that key and read its stored answer. |
| Migration 0010 assumes that `request_keys` holds no key of a route yet: its check would refuse such a row, which has no account | No route of the application uses a key before this task (only the sample route of the tests and the jobs); `sodiq_dev` was empty when it was applied, and nothing is deployed. Found by the review. |
| A key that the database refuses is rolled back to the savepoint of `runOnce` before the error is passed on | Otherwise the caller's transaction would be lost with it; the same reasoning as for work that fails. |
| ESLint refuses `createParamDecorator` (`@nestjs/common`) and `REQUEST` (`@nestjs/core`, also the default import and files inside the package) outside `apps/api/src/http/`, `session.guard.ts` and `permission.guard.ts`; the two guards are still refused the raw decorators | Both hand a route the whole request, past the checked helpers. Open since 0.4b. `context.switchToHttp().getRequest()` in a guard or an interceptor is not refused: the task names these two only. |
| The same files are refused the text `'REQUEST'` (the injection token itself, so `@Inject('REQUEST')` needs no import) and `assignMetadata`, which `createParamDecorator` is built on | Found by both reviews. The rule `no-restricted-syntax` is built per group of files by `apiSyntaxRule`, like the import rule. |
| Known limits of the lint rules, accepted: a dynamic `import()` or `createRequire`, `switchToHttp().getRequest()`, `FileInterceptor` of `@nestjs/platform-express`, and `Requires('x' as never, ...)` are not refused | The rules stop the named ways, not every way; the reviews of each task remain the second guard. `FileInterceptor` is decided with the upload task. An area that is not in the table is refused by the guard whatever the decorator says. |
| ESLint refuses an import from `apps/api/src/testing/` and of `requiresInTable` in code of the application (everything but `*.test.ts` and `src/testing`) | Advice of the permission reviewer, open since 0.4a: the build leaves `src/testing` out, and `requiresInTable` accepts an area of a sample table. Included by the owner. |
| The rule `no-restricted-imports` is built per group of files by `apiImportRule` in `eslint.config.js` | A later block replaces the rule of an earlier one, so each group must name all of its parts; one function keeps the lists in one place. |
| `freezeTable` makes a permission table unchangeable (areas, rows, lists of actions); `PERMISSIONS` is frozen where it is written, and the guard freezes whatever table it is given | Left open by 0.7b: nothing may widen the table while the server runs. |
| The harness names a route declared with `@All()` instead of crashing, and does not call it | Left open by 0.7b. A route names its one method, so it can be listed in `ROUTE_ACCESS` and called as each role. Express holds such a route once per method; those entries are folded into the one named line. |

## 4 October 2026: permission table and guard (task 0.7b)

| Decision | Reason |
| --- | --- |
| Task 0.7b is split again: 0.7b is the table, the guard, the declarations, the own-request helper and the harness; 0.7c is JSON bodies only, `Cache-Control: no-store`, the request key per account and the lint rule for `createParamDecorator` and `REQUEST` | The owner chose this at the plan. |
| A request names its one branch in the header `X-Branch-Id` (`BRANCH_HEADER` in `packages/shared`); a branch never comes from the path, the query or the body | "Every request is checked against one branch" (edge cases, "Who can act"); the spec does not say how. The web app sends the branch of the branch switcher of its tab, and paths stay free of branch ids. Decided by the owner. |
| The own sign-in routes (session, sessions, password, sign-out, sign out everywhere, second step, trusted devices) are open to every signed-in account, the Principal included (`@AnySignedIn()`) | The Principal "changes nothing" is read as a rule about school data; its exceptions named only the own password, language and notification settings at the time, and every account needs sign-out and the second step. Decided by the owner; the spec says so since the spec change of 4 October 2026 (`docs/spec-changes.md`). |
| The permission table (`PERMISSIONS`, `packages/shared/src/permissions.ts`) is area, then role, then the list of actions (view, create, edit, archive, export); it starts with no area and every area writes a row for each of the 15 roles | "Rows are roles, columns are actions per area" (`02`, Rules). Each task adds the rows of its area with its first route. A missing row is a fault that `checkTable` names, not a silent "nothing". |
| `checkTable` holds three rules that no table may break, and a test runs it on the table of the application: a row for every role; the Principal has view and export only; the Super Admin has every action any other role has | The roles table ("changes nothing", "everything every other role can do") and the rules that the later matrix screen may not change (edge cases, last row of "Personal data and the audit log"). The roles of Release 2 and 3 have empty rows and are refused. |
| Every route carries exactly one declaration on its handler: `@Public()`, `@AnySignedIn()` or `@Requires(area, action)`. The declarations add up in a list, so a second one is seen; a route with none or two answers 500 for a signed-in caller and is never run | Deny by default, and loudly: a 403 would look like a decision. Without a session the answer is 401 as for any route. |
| `PermissionGuard` is a second global guard, registered in `AuthModule` right after `SessionGuard`; it reads the assignments `SessionGuard` loaded with the session and never the table `assignments` again | One reading of the roles per request decides the idle limit, the second step and the permission. A test pins the order of the two guards. |
| A missing or malformed `X-Branch-Id` is 400 `validation_failed` naming the header. A branch in which no assignment permits, and a branch that does not exist, are both 403 `permission_denied` | The answer does not tell which branch ids exist. Only the two roles without a branch could name an unknown branch; for them the guard looks the branch up. |
| When several current assignments permit an action, the first by id is the one named for the audit log (`decide` in `permission-check.ts`) | "The audit log records which assignment allowed the action": one deterministic rule for every route. Confirmed by the owner; it is also written in `.claude/rules/api.md`. |
| `@Requires(area, action, { branch: 'none' })` is for school-wide work: no header, any current assignment with a permitted role passes, the transaction gets no branch | Creating a branch or an account (1.1, 2.3) belongs to no branch. A list of all branches for one request (2.6, 5.9) is not built. |
| The guard decides role and branch only; subject, class and own-lesson scope stay with the routes of 2.3, 3.1 and later | Those scopes need data that does not exist yet. The harness therefore covers role and branch; each route tests its own scope. |
| `refuseOwnRequest(actor, requestedBy)` refuses the account that made a request with 403 `own_request`, for every role | "Nobody approves their own" (`02`, "Own requests"). Who decides instead is the routing of 7.2 and 8.4. |
| The harness compares the server with a list written by hand (`ROUTE_ACCESS` in `route-permissions.test.ts`: public, any signed-in account, or the roles allowed), not with the table | A test that reads the same table as the guard proves only the wiring. A new route fails until somebody writes who may call it. |
| The harness sends real requests as 15 roles, an account without a role and nobody, for the own and another branch; a test-only interceptor (`StopBeforeHandler`, switched on only while the harness runs) answers after the guards and before the handler | Sign-out, a later publish or a forced delete must not run, and no route needs a valid body. Guards run before interceptors, so "reached the interceptor" is "allowed". |
| The harness also fails for a route without `@Returns` or `@ReturnsNothing`, and a test pins that the Express router answers exactly the routes of the controllers | Notes of 0.4a and 0.6a: an answer without a schema is not filtered, and a route outside a controller has no guard. |
| `Requires` accepts only the areas of the real table (`Area`); test controllers with a sample table use `requiresInTable(area: string, ...)` | The real table has no area yet, and a route of the application must not be able to name an area that does not exist. |
| The hand-written list also says, for a route with a permission, whether it works for the branch of the request or for none (`{ roles, branch }`); the harness compares that with the declaration and takes nothing it expects from the route itself | Found by both reviews: with the branch mode read from the declaration, a branch route wrongly declared `branch: 'none'` would have passed. |
| A route with a permission may not carry `@AllowedBeforeSecondStep()`, `@AllowedBeforePasswordChange()` or `@AllowedBeforeSecondStepSetUp()`: the guard answers 500, the harness names it, and `STEP_ROUTES` in `route-permissions.test.ts` holds the exact list of routes with such a mark | Found by the permission review: such a mark would let a session that has only given the password act with the roles of an Academic Vice Principal. |
| `decide` counts an assignment without a branch in every branch only for the two roles of `SCHOOL_WIDE_ROLES` | Found by the spec review: until now only the check constraint of migration 0009 held this, and Release 2 relaxes it for Parent. |

## 4 October 2026: roles and assignments (task 0.7a)

| Decision | Reason |
| --- | --- |
| Task 0.7 is split: 0.7a is the 15 roles, the assignments and the sign-in rules that follow the roles; 0.7b is the permission table, the guard and the harness | Two pieces of work with their own reviews. The owner chose this. |
| The 15 roles are named once, in `ROLES` (`packages/shared/src/roles.ts`); the check on `assignments.role` repeats the names and a test compares the two | One list for API, web and database. A role that exists in one place only fails a test. |
| An assignment belongs to an account (`assignments.account_id`), not to a person | No person or staff record exists before 2.2, and rights are checked for the account that is signed in. |
| `assignments` is school-wide and has a nullable `branch_id`; it is named in `SCHOOL_WIDE_TABLES` and in the new list `SCHOOL_WIDE_WITH_BRANCH` of `catalog.test.ts` | The rows of the Super Admin and the Senior Head Teacher have no branch, and the roles of an account are read on every request before a branch is known, so the row filter cannot apply. The exception in the catalog test is by name: every other school-wide table with a `branch_id` still fails. Decided by the owner. |
| Only the Super Admin and the Senior Head Teacher have no branch; every other role, Student and Parent included, needs one (check constraint) | Rules: "Every role is limited to a branch ... Only the Super Admin and the Senior Head Teacher work across branches." Decided by the owner for Release 2 (task 2.5): Parent becomes a role without a branch, by a spec change and a migration that relaxes this check; what a parent sees is decided by the children, and the branch of a request comes from the child. |
| The start and the end of an assignment are moments (`valid_from`, `valid_until`), compared with the injected clock on each request; the time is half-open | "State from stored moments." A role that is removed stops at the next request, and the two roles without a branch have no branch time. Decided by the owner. |
| How a date becomes a moment, for the screens of 2.3: a typed date is 00:00 of that day in the time zone of the branch, or in the time zone of the school for the two roles without a branch; the screens show dates | The spec speaks of dates ("appointments carry dates"); people type and read dates, the server compares moments. Decided by the owner. |
| One account holds one role in one branch once at any moment: exclusion constraint over account, role, branch and time (`btree_gist`); a missing branch is compared as the zero uuid | The database guards the rule, also for two requests at the same moment. Migration 0009 names the extension again (`create extension if not exists`; 0001 created it) and a database test pins it. Asked for by the owner. |
| An assignment is ended, never removed or rewritten: the application user may insert, and update only `valid_until` and `ended_by` | History shows who held which role when (edge cases, "Who can act"). A role given again is a new row. An assignment that is ended before it began gets its start as its end and is never in force; it counts as ended from then on, also while that moment is still ahead (`notEnded` in `current-assignments.ts`, used by the count of Super Admins, the first-account command and `end`; found by the review). The database does not stop the application user from emptying or moving an end that was written: only `Assignments.end` writes one. Decided by the owner after the review: an end that has passed is final (a new assignment is given instead), an end that is still ahead may be moved while it is still ahead, and the trigger that holds this comes with the routes in 2.3. |
| `Assignments.give` and `end` are a service without routes; they write `assignment.given` and `assignment.ended` to the log of the branch, or to the school log for the two roles without a branch | Who may give which role to whom needs the guard (0.7b) and the screens (2.3). For a role with a branch the caller's transaction must work for that branch, or the row filter refuses the audit entry. A refused `give` writes nothing and leaves the caller's transaction usable: the insert sits behind a savepoint, so an overlap can be answered as a refusal (found by the review). |
| "At most 3 accounts" for the Super Admin is checked in `Assignments.give`, under an advisory lock, counting every account whose Super Admin assignment has not ended, those that begin later included | The spec gives the number; the lock makes two at the same moment see each other. Decided by the owner. |
| `Assignments.end` refuses the own Super Admin role (`OwnSuperAdminRemovalError`); the "last active Super Admin" rule comes with the routes in 2.3 | "Nobody can remove their own Super Admin role", like the own reset and the own lock. Decided by the owner. |
| The first-account command creates the account and its Super Admin assignment in one transaction and refuses while a Super Admin assignment that has not ended exists (`SuperAdminExistsError`); accounts without the role do not stand in its way | "The first Super Admin is created by a one-time command." Decided by the owner. Both audit entries have no actor and name the command. |
| `audit_log.assignment_id` has no foreign key, like `actor_id` | The audit tables are partitioned and append-only and must never refuse an entry. Decided by the owner. |
| `Sessions.resolve` reads the assignments of the account once, in the transaction of the use; that one reading decides the idle limit of the use, the end that is written if the session is over, the second step and `ActiveSession.assignments` | A session is never used under one limit and ended under another. A role that is given or ended while a request runs counts from the next request. Asked for by the owner. No lock is taken on the account for this: it would make every request of a person wait for the others. |
| `Assignments.give` accepts a start in the past | The spec says nothing about backdating a role. Decided by the owner: the service accepts it; 2.3 decides what the screen offers. |
| The idle limit and the second step follow the roles at the request, not their history: a strict role that ends can bring back a session that was over under 15 minutes and not seen since, and a strict role that is given can end a session with a moment before the role began; a session that asked for trust while it owed a required set-up stays untrusted when the role ends | Found by the review and accepted by the owner as it is. An exact answer needs the start of the strict role in the calculation; the person whose trust did not begin signs in again with the switch. |
| `SecondStepRule.required(roles)` and `idleLimitMs(roles)` take the roles the account holds now; both name `STRICT_SIGN_IN_ROLES` (`packages/shared`) | Rules: the second step is required for the Super Admin and Academic Vice Principal; question 41: their idle limit is 15 minutes. One list for both. An account without a role has 30 minutes and no required second step; blocking its sign-in is the Inactive and Left status of 2.2 (decided by the owner). |
| `OptionalSecondStep` and the `secondStepRule` option of `createTestApp` are removed; test accounts hold no role unless the kit gives one (`signInKit(app, { newAccountsHold })`, `kit.giveRole`, `kit.endRole`) | The rule of the application is the rule of the spec now, so no suite replaces it. The suites of the strict side make their accounts Academic Vice Principals of a branch. The tests of the suites without roles moved from 15 to 30 minutes. |

## 4 October 2026: trusted devices, the longest life of a session and the account lock (task 0.6d)

| Decision | Reason |
| --- | --- |
| A trusted device is the trusted session of that browser (`sessions.trust_requested`, `trusted_from`, `trust_ended_at`); nothing is built on `known_devices`, and no later sign-in skips a step | "That browser stays signed in for 7 days from the sign-in": inside the 7 days no sign-in happens. A right password alone writes a row in `known_devices`, so it can open nothing. |
| Trust begins at the moment a session that asked for it owes no step: at sign-in when the account has no second step and needs none, otherwise at the code (`TwoStep.pass`) or at the end of a required set-up (`TwoStep.confirm`), through `Sessions.beginTrust`. Until then the idle sign-out holds | Spec change of this task: the sign-in that starts the trust still asks for the second step. The 7 days count from the sign-in, not from the code. |
| A sign-in with a first or reset password never becomes trusted | Decided by the owner: after a forced password change the person signs in again to trust the device. |
| The own password change keeps the session signed in and ends its trust (`trust_ended_at`); from then on it has the idle sign-out | Answered by the owner: "trust ends at once on a password change", as the spec says literally; a password change has always kept the session that made it. |
| The database check is "`trust_ended_at` only with `trust_requested`", not "only with `trusted_from`": a password change also sets `trust_ended_at` on a session whose trust had not begun, and `beginTrust` refuses such a session | A session that asked for trust and changed its password while a step was still owed (the forced change, or a voluntary one before a required set-up) would otherwise become trusted afterwards. Approved by the owner as a change to the plan. |
| Turning the second step off where it is optional leaves trust as it is | Answered by the owner: a right code was just given. A reset of the second step always comes with a password reset (2.3), which ends the sessions. |
| The longest life needs no column: a session is over once `created_at` plus 7 days has passed (`SESSION_MAX_LIFE_MS`, `endByTime` in `session-life.ts`), compared with the injected clock on each request; the first request afterwards writes `expired` with the moment it was over. Of the idle end and the 7 days the earlier one is written | State from stored moments; no timed job. The same shape as the idle sign-out of 0.6b. |
| `Sessions.writeIdleEnds` became `writeEndsByTime`: it also writes the 7-day ends, and it locks the open sessions of the account (`for update`, ordered by id) until the caller's transaction ends | Whatever ends "all sessions" must count only sessions still in force. One lock order for every such caller. |
| The device list is its own pair of routes (`GET` and `DELETE /api/auth/trusted-devices`); the id of a device is the id of its session. Another account's id, an unknown id and an untrusted session are answered alike with 404 `not_found` | The answer must not say whether an id exists in another account. |
| Removing the device that asks is allowed and works like sign-out: the cookie is cleared | Answered by the owner. |
| `auth.sign_in` carries `details.trustRequested` only when the switch was on; `auth.device_trusted` is written when trust begins | "A sign-in with trust is recorded in the sign-in history." Entries of ordinary sign-ins stay as they were. |
| A locked account is told `account_locked` (403) only after the right password; a wrong one gets `sign_in_failed`. The refusal is written down as `auth.sign_in_locked` | Answered by the owner: as for `password_expired`, the answer tells nothing to somebody who does not know the password. |
| `AccountLocks.lock` and the session-writing transaction of `Sessions.signIn` both take the row of the account with `select ... for update` | Asked for by the owner: of a lock and a sign-in at the same moment one waits for the other, so no session of a locked account stays open, by the database and not by timing. The test holds one side open and waits until `pg_locks` shows the other one waiting. |
| `Sessions.resolve` refuses a session of a locked account even if its row is still open | The lock ends every session; this does not rest on that. |
| A lock is three columns on `accounts` (`locked_at`, `locked_by`, `lock_reason`), all filled or all empty, the reason 1 to 500 characters, `locked_by <> id`; an unlock empties them and the audit log keeps the history. An unlock needs no reason; nobody locks or unlocks their own account | "Logged with a reason." Answered by the owner for the unlock. |
| Migration 0008 was edited once before the merge (the trust check above) and applied again in `sodiq_dev` after undoing it by hand as the migration user | Approved by the owner; the file was not merged. |
| The session cookie of a trusted device carries `Expires`, the moment its 7 days are over; every other session cookie has none and ends with the browser, as since 0.6a. The cookie is set once more with the same token when trust begins at the code or at the end of a set-up, and without `Expires` when a password change ends the trust (`SessionCookieJar.keep`) | Found by both reviews: without an end of its own the browser drops the cookie when it closes, and "that browser stays signed in for 7 days" would hold only while it stays open. The server still decides when a session ends; the cookie only lets the browser keep it that long. |
| `Sessions.changePassword` checks inside its transaction, after the open sessions of the account are locked, that its own session is still open, and answers 401 `not_signed_in` otherwise | Found by the review: the guard reads the session before the change is written. A lock, "sign out everywhere" or the removal of the device in between would otherwise still change the password and write a false `auth.trust_ended`. |
| `TwoStep.remove` locks the open sessions of the account ordered by id before it changes them | Found by the review: `writeEndsByTime` locks them in that order, and two orders could wait for each other in a circle. |

## 4 October 2026: two-step sign-in (task 0.6c)

| Decision | Reason |
| --- | --- |
| Task 0.6c is split: 0.6c is the second step, 0.6d is trusted devices, the longest life of a session and the account lock | Three pieces of work with their own reviews. The owner chose this. |
| The second step is the time-based code of RFC 6238 as every authenticator app reads it (HMAC-SHA-1, six digits, 30 seconds), computed with `node:crypto` in `totp.ts`; no library | "A code from an authenticator app." About 40 lines, checked against the test values of the RFC. |
| A code counts for its own 30 seconds and the step before and after; a code that was accepted is not accepted again, and no code of an earlier step after it (`last_used_step`) | The clock of a phone drifts. A code read over a shoulder is useless once it was used. |
| Until 0.7 the second step is required for every account (`SecondStepRule.required()`); `secondStepRequired(roles)` holds the rule for 0.7, with the same two roles as the short idle limit | The strict side, as for the idle limit: a forgotten wiring in 0.7 shows at once instead of leaving a Super Admin without a second step. Decided by the owner. |
| The suites of 0.6a and 0.6b (`auth`, `idle-sessions`, `limits`, `password-resets`) run with `OptionalSecondStep`; the running application and `two-step.test.ts` use the strict rule | Those suites are about passwords, sessions and limits. Passing a second step in each of their sign-ins would add nothing to what they check and would be undone by 0.7. |
| Sign-in stays one public route. The password opens a session at once; a session of an account with a second step reaches only `POST /api/auth/second-step`, the session and sign-out until a code is given (403 `second_step_required`) | No second public route and no half-signed-in token of its own: the session cookie carries the first step, the idle limit and the audit entries apply as to any session. |
| A session stores only the moment it passed (`sessions.second_step_passed_at`); it counts if it is not before `account_second_steps.confirmed_at` | After a reset and a new set-up, sessions that passed with the old device owe a code of the new one. When a person turns the second step on, their other open sessions owe a code too. |
| Whatever removes a second step (reset, turning off, an unreadable secret) also empties `second_step_passed_at` on every session of the account | The comparison of two moments alone would rest on the clock: a new set-up in the same millisecond, or a server clock that stepped back, would leave an old session "passed". Found by both reviews. |
| A set-up never overwrites a second step in force: the upsert of `TwoStep.begin` changes only an unconfirmed row and answers 409 `second_step_already_on` otherwise | With no row to lock, another session of the account could confirm a set-up between the read and the write. Found by the review. |
| `account_second_steps` and `second_step_recovery_codes` are school-wide tables, named in `SCHOOL_WIDE_TABLES` | An account has no branch. Approved by the owner with the plan of the task. |
| Order of the forced steps: second step, then the forced password change, then the set-up of a required second step | An administrator who resets a password cannot enter an account that has a second step ("there is no sign in as another user"). A first password is changed before anything is added to the account. |
| Wrong codes are counted per account, in the row of the second step, with the lengths of 0.6b (five answered as wrong, then 30 seconds doubling to 15 minutes, forgotten after 24 hours or a right code). Recovery codes fall under the same count. The row is locked for each check | The password count starts again at every right password, so with it somebody who has the password could guess codes without end. Per account, not per device: such a person chooses the device. Cost: that person can make the owner of the account wait up to 15 minutes; never for good, and each wrong code is an audit entry. |
| A wrong code at the confirmation of a set-up is not counted | Whoever may confirm was just shown the secret. |
| The secret is stored as `v1:<iv>:<ciphertext and tag>`, AES-256-GCM from `node:crypto`, with the key of `SECOND_STEP_KEY` and the account id as associated data (`SecondStepSecrets`) | A code is computed from the secret, so it cannot be a hash. A copy of the database or a backup gives nobody the second step, and a row copied to another account opens nothing. Decided by the owner. |
| `SECOND_STEP_KEY` is checked at start (exactly 32 bytes in base64). The version prefix lets the key be changed without a migration: a new key becomes `v2` with a variable of its own and `v1` stays readable until no secret has it. Only version 1 exists | Asked for by the owner. Nothing is built ahead for a second key. |
| A secret in force that cannot be decrypted is removed with its recovery codes at the first code that is tried, with the audit entry `account.second_step_unreadable`; the answer is 403 `second_step_set_up_required` | Asked for by the owner: never a 500. This path is for the rare single damaged row; a wrong key on a server is caught at start (next row). |
| The API and the worker refuse to start when the oldest stored secret does not decrypt with `SECOND_STEP_KEY` (`SecondStepKeyCheck.run`, called by `main.ts` and `worker.ts` before they take requests or jobs; `SecondStepKeyError`). No row, no check. `pnpm api:client` does not run it | Without it a wrong key on a server would make each person who tries a code lose the second step and set a new one up with the password alone. Asked for by the owner. It is a call of the entry points, not a start hook of the module: the OpenAPI command and most tests build the application without a database. Consequence: if the oldest row itself is the damaged one, the start is refused until that row is removed by hand (0.10 should say how); a test pins that both entry points make the call. |
| `second-step-key-check.test.ts` pins that the application as it runs has the strict `SecondStepRule` | Four suites replace the rule; like `public-routes.test.ts`, one test holds what the application itself is wired with. Asked for by the owner. 0.7 changes it with the rule. |
| Recovery codes: ten, 16 characters from the alphabet of first passwords, shown as four groups, stored as SHA-256, each usable once; they pass the second step like a code. Codes and recovery codes are compared with `timingSafeEqual` | "Ten single-use recovery codes shown at set-up." 16 characters cannot be guessed, so a plain hash is enough. Constant-time comparison asked for by the owner. |
| Turning the second step off needs a right code and is refused where it is required; no route asks for the password except the password change | "Never asked for the password again, whatever the action" (spec change of 4 October 2026). |
| Reset by an administrator is a service without a route (`TwoStep.resetByAdministrator`): removes the second step and its recovery codes, refuses the administrator's own account, audit entry `account.second_step_reset`. It ends no session | Who may reset whom needs roles; the route is in the 2.3 line of the build plan. Open sessions fall into "set up required" by themselves, because the state is read on every request. |
| The tests take the key from `test.env` in `apps/api/vitest.config.ts` (the public local value of `.env.example`) | The tests do not depend on the `.env` of the machine. |

## 4 October 2026: limits, resets and idle sign-out (task 0.6b)

| Decision | Reason |
| --- | --- |
| Password reset by email and the mail service moved to task 2.3 | An account has no email address, no name and no language before the staff records of 2.2; the spec asks for email reset only "before the school goes live". Decided by the owner. |
| "Device" is a browser that carries the cookie `__Host-sodiq_device` (32 random bytes, `HttpOnly; Secure; SameSite=Strict`, 400 days, set at every successful sign-in; the database stores its SHA-256 per account in `known_devices`). A browser that signed in to the account before has a count of failures of its own; all other browsers share one count per login | "Limits are per account and device, not per network address." A count per account alone would let anybody delay a teacher by typing wrong passwords; a count per cookie alone would be escaped by dropping the cookie. The cookie opens nothing by itself. Confirmed by the owner. |
| Five failures are answered as failures; the fifth starts a wait of 30 seconds, each further failure doubles it, up to 15 minutes; failures are forgotten 24 hours after the last one or at a right password. During a wait every attempt is refused with 429 `too_many_attempts` and `Retry-After`, without looking at the password and without counting | The spec gives no lengths; confirmed by the owner. A refusal with a stored moment (`blocked_until`), not an open connection: state from stored moments, and no request holds a server slot. |
| Open risk, accepted by the owner for the pilot: somebody who knows a login and sends one wrong password each time the wait ends keeps every browser that never signed in to that account out of it, also on the first day, when no browser is known yet | It follows from one shared count per login for unknown devices. To be decided in 10.3, with two candidate answers: count unknown devices per login and network address (needs a spec change: the spec says "not per network address"), or a human check for unknown devices after repeated failures. |
| An attempt is counted before the password is looked at and taken back when it was right (`SignInThrottle.begin`, `passed`), under a row lock that one statement (`insert ... on conflict do update ... returning`) takes | Attempts at the same moment cannot slip past the count: of ten parallel ones five are checked. One statement, so a row that is removed at the same moment is made again instead of missed (found by the review). |
| `known_devices` and `sign_in_throttle` are school-wide tables, named in `SCHOOL_WIDE_TABLES` | An account has no branch, and failures are counted before any branch is known. Approved by the owner with the plan of the task. |
| The count of an attempt and the audit entry of its failure are two transactions | The count must be committed before the password is looked at, or parallel attempts would slip past it; the entry can only be written after the look. An exception to "audit in the same transaction", which is about a change and its own entry: here the entry describes the failed attempt, not the count. If the entry cannot be written, the attempt still counts. Found by the review. |
| A wrong current password at the password change is an audit entry `auth.password_change_failed` (actor and record: the account) | "The log records sign-ins, password and two-step events." A guess from a hijacked session leaves a trace. Found by both reviews. |
| Whatever ends all sessions of an account (sign out everywhere, a password change, a reset) first writes down the idle end of sessions that were already over by time (`Sessions.writeIdleEnds`) | Such a session ended at its own moment with the reason `idle`; it is not counted in `endedSessions`. Found by both reviews. |
| `last_used_at` never moves backwards (`greatest`), and a request that finds its session used by another request in between tries once more | Two requests at the same moment could store the earlier clock, or one of them could be answered as not signed in on a live session. Found by the review. |
| An unknown login is counted like a known one, under the SHA-256 of the typed login; a text that cannot be a login (`LOGIN_FORMAT`) is not counted | The answers must not tell which logins exist. People type passwords into the login field, so the typed text is not stored. No account can have a text outside the format. |
| Each attempt removes at most 50 rows of `sign_in_throttle` whose last failure is older than 24 hours, after its own row is locked and skipping locked rows | Unknown logins would let the table grow without bound. Asked for by the owner. 10.2: a cleanup job should take this over. |
| The current password of `POST /api/auth/password` falls under the same count as the sign-ins of that login from that device | It is a password attempt like any other (note of 0.6a). |
| A failed sign-in for an existing account is an audit entry `auth.sign_in_failed` (no actor, record: the account), only when the password was looked at; an unknown login and a waiting attempt leave none | "The log records sign-ins"; the own sign-in history of 2.6 reads it. An unknown login has nobody to name, and waiting attempts would let a caller fill the log. The entry is one small write that an unknown login does not have; the difference in time is far below that of the password hash. |
| Idle sign-out: `sessions.last_used_at` is moved by every request that reads the session (`Sessions.resolve`); a session is over when that moment plus the limit has passed, compared on each request. The first request after that writes `ended_at` (the moment it was over) with reason `idle` and an audit entry `auth.session_idle`; no timed job | State from stored moments. Public routes do not read the session and so do not refresh it. |
| The idle limit is a function of the roles (`idleLimitMs`, 30 minutes, 15 with Super Admin or Academic Vice Principal). Until 0.7 brings the roles, every session gets 15 minutes | The strict side; the only account today is a Super Admin. Decided by the owner. A test named for 0.7 holds this and says what 0.7 must change. |
| An idle session answers `not_signed_in`, like every ended session | No code of its own until a screen needs to tell the reasons apart (0.8a can ask for one). |
| `GET /api/auth/sessions` lists only sessions in force, with start, last use, the browser's `User-Agent` (cut to 200 characters, stored at sign-in) and "this one"; `POST /api/auth/sign-out-everywhere` ends every session of the account, the asking one included. Neither works while a first or reset password is in use. No route ends a single other session | "The profile lists them, with sign out everywhere." The owner agreed to store the user-agent text. |
| Reset by an administrator is a service without a route (`PasswordResets.byAdministrator`): random one-time password, 24 hours, forced change, all sessions ended (`password_reset`), audit entry `account.password_reset` with the administrator as actor. `accounts.password_reset_by` and `password_reset_at` hold who and when until the person chooses a password; the session answer shows the resetter's login as `passwordResetBy` | Who may reset whom needs roles (0.7); the route comes in 2.3. A name instead of a login comes with the staff records (2.2). |
| A reset by an administrator removes every count of failed sign-ins of that login, on every device, in the transaction of the reset | Otherwise a person who waits after failed attempts would still wait up to 15 minutes with the new one-time password in hand. Decided by the owner. |
| An administrator cannot reset their own password (`OwnPasswordResetError`) | It would bypass "staff change their own password with the current one". Decided by the owner. |
| `ApiException` takes an optional wait in seconds, sent as `Retry-After` | The one error shape has no field for it, and the header is the standard place. |
| Tests whose session must live for days (the 7 days of a first password) read the session every 14 minutes while the clock moves (`advanceInUse` in `auth.test.ts`) | Since idle sign-out such a session would be over. The rule under test is unchanged. |

## 4 October 2026: accounts and sessions (task 0.6a)

| Decision | Reason |
| --- | --- |
| No route creates an account before task 2.3; `Accounts.create` is a service, called by the first-account command and by tests | Roles and the permission guard arrive in 0.7, so no route could check "is an administrator". The owner chose this over a temporary Super Admin flag. |
| The command (`pnpm auth:first-account -- --first-name ... --last-name ...`) creates the first account and refuses when any account exists; 0.7 makes it also write the Super Admin assignment | "The first Super Admin is created by a one-time command" (edge cases). Two runs at once wait for each other on an advisory lock. It connects as `sodiq_app` and writes an audit entry with no actor and `details.command`. |
| `accounts` and `sessions` are school-wide tables and hold no name; the link to a staff record comes in 2.2 | One person has one account for every branch, and sign-in happens before a branch is known. The people model is not decided early. Approved by the owner. |
| Login rule: first letter of the first name, a dot, the last name; lower case, a to z only. Marks on letters, hyphens, spaces and every apostrophe-like character (list in `login.ts`, by code point) are dropped; a name with any other letter is refused; a taken login gets 2, 3, ... (one above the highest in use) | The spec gives only the example `a.karimov`. Decided by the owner; "Oʻtkir Gʻaniyev" in any apostrophe spelling gives `o.ganiyev`. Cyrillic is not transliterated: the caller types the Latin spelling. |
| "Logins are never reused" is kept by the database: `login` is unique, and `sodiq_app` can neither delete an account nor update `login` | Holds even if the application has a fault. A sign-in compares the login exactly as typed. |
| Argon2id comes from `node:crypto` (`crypto.argon2`), no library; `engines.node` is `>=24.7 <25` | No new dependency and no install script. The function is marked release candidate in Node 24; if it changes, `password-hash.test.ts` fails. Chosen by the owner. |
| Parameters: 19 MiB, 2 passes, 1 lane, 16-byte salt, 32-byte tag, stored as PHC text; verification uses the parameters of the stored text | The OWASP minimum for Argon2id. Raising them later needs no migration of old hashes. A stored text that cannot be read, or that asks for more than 16 times our memory, is "wrong password", never an error. |
| The first password is 16 random characters from an alphabet without look-alikes, returned once by `Accounts.create`, valid for 7 days from the injected clock | "Random, valid for 7 days, printed once, not stored." |
| An expired first password answers `password_expired` only when the password is right; otherwise `sign_in_failed` | The person learns to ask for a new one; somebody who guesses learns nothing. An unknown login is verified against a dummy hash, so it takes as long as a wrong password. |
| A first password older than 7 days is also refused as the current password of a password change (`password_expired`), in a session that was opened in time | "Valid for 7 days." Otherwise one sign-in would keep the first password usable without limit. Found by the review. Such a session can still be read and signed out; the person needs a reset (0.6b). |
| `accounts` has the check `must_change_password = false or password_expires_at is not null` | A password that must be changed and has no end would stay valid for ever, whatever the application does. Asked for by the owner after the review. 0.6b: a reset sets both columns together. |
| A sign-in whose login cannot be a login (`LOGIN_FORMAT`) is answered as an unknown login without a query | PostgreSQL refuses a zero byte in a text with a fault; an unsigned caller could produce 500s at will. Found by the review. The answer stays the same as for a wrong password. |
| A new password must have 10 to 128 characters and differ from the current one; no other rule | The minimum is the spec's. The maximum bounds the hashing work. Without "differs" the forced change means nothing. Agreed by the owner. |
| The session token is 32 random bytes from `crypto.randomBytes`, base64url in the cookie; the database stores only its SHA-256 | A reader of `sessions` cannot use a session. Asked for by the owner. |
| The cookie is `__Host-sodiq_session` with `HttpOnly; Secure; SameSite=Strict; Path=/` and no `Max-Age`; it is read by hand in `apps/api/src/http/session-cookie.ts` | No cookie library. When a session ends is decided by the server from stored moments. Chromium and Firefox accept `Secure` on `http://localhost`; if Playwright in 0.8a shows otherwise, name and `Secure` become configuration. |
| Cross-site requests: a request that is not GET or HEAD is refused when `Sec-Fetch-Site` is present and not `same-origin` or `none`; without that header, when `Origin` is present and not the request's own origin; no CSRF token | Web app and API share one origin. The check runs before the body parser. With neither header the caller is not a browser. 0.10: behind Render's proxy the own origin needs `trust proxy`, or the `Origin` fallback refuses HTTPS requests of browsers that send no `Sec-Fetch-Site`. |
| A global guard (`SessionGuard`, `APP_GUARD` in `AuthModule`) refuses every route without a session unless the handler is `@Public()`; `public-routes.test.ts` holds the exact list with a reason each | Deny by default before the permission guard of 0.7, which builds on it. Spec change of 4 October 2026 (`docs/spec-changes.md`). `@Public()` is read from the handler only, so a whole controller cannot be made public. The test-only controllers in `src/testing` are marked `@Public()`. |
| A session with a first password reaches only routes marked `@AllowedBeforePasswordChange()`: read the session, change the password, sign out | "Must change the password at first sign-in": everything else answers 403 `password_change_required`. |
| A password change ends every other session of the account; a session in 0.6a ends only by sign-out or password change | "A password change ends all others." Idle sign-out is 0.6b; nothing is deployed before 0.10. |
| Coded refusals are thrown as `ApiException(code, status)`; new codes: `not_signed_in`, `sign_in_failed`, `password_expired`, `password_change_required`, `current_password_wrong`, `password_unchanged`, `cross_site_request`, `request_key_reused` (the 409 of 0.4b) | The first task that needed codes of its own (decision of 0.4a). |
| The audit log gets no foreign key to `accounts` and no column for the system actor | Accounts are never deleted, and the log stays independent of other tables. `actor_id` empty plus `details.command` names the command. Agreed by the owner. |
| Failed sign-ins are not audit entries in 0.6a | 0.6b builds the record of attempts and decides whether a failure is also an audit entry. |

## 4 October 2026: jobs (task 0.5b)

| Decision | Reason |
| --- | --- |
| pg-boss is pinned to exactly 12.36.0; its schema `pgboss` (version 44) is installed by `db/migrations/0004_job_queue.sql`, made from `pg-boss plans create --schema pgboss`, and the application starts it with `migrate: false, createSchema: false` | The application user cannot create anything. Package and schema must match: with another version the API and the worker refuse to start. An upgrade is a new migration made from `pg-boss plans migrate`, in the same pull request as the new version. |
| The migration leaves out the block of `plans create` that creates two `queue_stats` partitions named after the day it runs; `persistQueueStats` stays off | Every database gets the same tables, and the catalog test can name them. With stats on, pg-boss would create and drop a partition per day at run time, which the application user may not do. |
| `@opentelemetry/api` 1.9.1 is a declared, pinned dependency of the API | pg-boss imports it at load and does not mark the peer optional. It is the API shim only: no OpenTelemetry SDK is installed, so nothing is collected or sent. The owner approved it on 4 October 2026. |
| Everything in schema `pgboss` is owned by `sodiq_migrator`; `sodiq_app` has the rights listed table by table in `catalog.test.ts` (`JOB_TABLE_RIGHTS`) and may not create in the schema | The same rule as for every other table. The catalog test also refuses a table pg-boss does not have, a view, and a `SECURITY DEFINER` function there. The rights were found by running send, fetch, finish, fail and pg-boss's upkeep as `sodiq_app`; they are enough, not proven to be the smallest possible. |
| The `pgboss` tables have no branch filter and are kept out of the generated Kysely types | The queue is school-wide by nature. A job holds ids and its `branchIds`, never personal data, so a transaction of any branch that reads the table learns ids only. Business code cannot query the queue through Kysely; it goes through `Jobs` and `JobRunner`. Confirmed by the owner on 4 October 2026. |
| Job definitions live in code (`defineJob`, listed in `apps/api/src/jobs/job-list.ts`); the API and the worker insert the queues at start | One source for name, payload schema and options; a new job needs no migration. With `partition: false` creating a queue is one insert. The owner chose this over a migration per queue. |
| `Jobs.enqueue(transaction, definition, { branchIds, data })` is the only way to send; the pg-boss instance (`JobQueue`) is not exported by the module | A job cannot be sent outside the transaction of its change, as with `Audit.record`. No lint rule against `boss.send`: the owner decided that not exporting the instance is enough. |
| The handler of a job runs inside `Transactions.run(branchIds, ...)` and inside `RequestKeys.runOnce` with the job id as key and the scope `job:<name>` | "Background jobs carry the branch", and "every job can be repeated safely" holds for database changes without each handler having to arrange it: a job delivered again after its work was committed finds its key and does nothing. Cost: one `request_keys` row per job until the cleanup of 8.3c. The owner chose this on 4 October 2026. It does not cover what a handler sends outside the database. |
| `Jobs.enqueue` refuses a job whose `branchIds` are not among the branches of the transaction that enqueues it; fewer, or none, is allowed | The handler sees the branches of the job, so a wrong list at the call would reach rows that the filter keeps from the caller. Found by the review. Consequence: a transaction for school-wide work (`[]`) cannot enqueue a job for a branch; if a real case needs that (first candidate: 0.9), ask the owner before loosening it. |
| A job in state `failed` does not prove that its work was not done | The worker can die after the handler's commit and before pg-boss marks the job completed; on the last allowed try, or when a run takes longer than its 15 minutes, pg-boss's upkeep then marks the job failed although the data is right. The request key `job:<name>` with the job id in `request_keys` is the proof that the work was committed. The alert on failed jobs (10.2) should check it. Found by the review. |
| pg-boss's own transactional worker (`work(name, { transactional: true })`) is not used | It would commit the handler's work and the job's completion together, but in a transaction pg-boss opens on its own pool, outside `Transactions.run` and the branch filter. |
| A failed run is stored and logged as name, message and stack only (`JobFailure`) | pg-boss stores every field of the thrown error in the job row; the detail of a database error can hold values of a row. The same rule as for a 500 (0.4a). |
| The API and the worker are one code base with two entry points (`main.ts`, `worker.ts`) and the same modules (`SHARED_MODULES`); modules name their handlers with `JobRunner.handle` in both, and only the worker calls `JobRunner.start`, which refuses to start while a definition has no handler | A handler lives beside the code that enqueues its job. A job that nobody handles is found at start, not when it has waited for a day. |
| pg-boss keeps a small pool of its own (2 connections in the API, 5 in the worker) besides Kysely's; in the API it connects at start through `main.ts`, in tests only with the first job | It needs connections outside any transaction for the list of queues, fetching and upkeep. `createTestApp` points it at a database that does not exist unless the test passes `jobsDatabaseUrl`, so no test reaches `sodiq_dev`. |
| Options off: `reindex` (needs the owner of the table), `registerInstance` (stores host, process and configuration of each instance), `schedule` (until the nightly check, 9.2c) | The upkeep still clears pg-boss's registry of instances on every pass, hence the rights on `pgboss.instance`. |
| pg-boss's defaults for retries and retention: 2 retries, 15 minutes per run, finished jobs deleted after 7 days; no dead-letter queue | Agreed by the owner. pg-boss has one retention for completed and failed jobs alike (`deleteAfterSeconds`), so "failed jobs for 30 days" is not possible without keeping every finished job for 30 days or adding a dead-letter queue: decide in 10.2 with the alerts on failed jobs. |
| The times pg-boss itself writes (`created_on`, `start_after`, retention) come from the database server, not the injected clock | They are bookkeeping of the queue; no business rule reads them. A handler decides from stored moments and the injected clock. |
| In development the worker has its own watch build in `apps/api/dist-worker` (`dev:worker`, `tsconfig.worker.json`); root `pnpm dev` runs `turbo run dev dev:worker` | Two `nest start --watch` processes that share `dist` would delete each other's output at start. No process-runner library was added. In production both entry points come from the one `dist` (`start`, `start:worker`). |

## 4 October 2026: audit log (task 0.5a)

| Decision | Reason |
| --- | --- |
| Task 0.5 is split: 0.5a is the audit log, 0.5b is pg-boss and the worker | Two smaller reviews; the pg-boss half has unknowns (the rights its schema needs at run time) that are better reviewed alone. The owner chose this. |
| Two audit tables with the same columns: `audit_log` (`branch_id` not null, the standard branch filter) and `audit_log_school` (events without a branch: sign-ins, relatives, appointments across branches), named school-wide in `catalog.test.ts` | The catalog rule refuses a branch table whose `branch_id` may be empty. With two tables the database itself keeps a branch reader to the branch's entries; who reads the school-wide table is the guard's work (2.6). The owner chose this over one school-wide table. |
| `Audit.record(transaction, entry)` is the only way to write an entry; the transaction and `branchId` (a branch or `null`) are required | An entry cannot be written outside the transaction of its change, and nobody writes a school-wide entry by forgetting the branch. |
| The monthly partitions come from the migration (October 2026 to December 2029) with a default partition per table; a test fails while fewer than 6 months remain | The application user cannot create tables. The owner chose this over a `SECURITY DEFINER` function called by a job. The default partition means a write never fails for a missing month. Month borders are UTC. |
| The application user has select and insert on the two parent tables and no right on any partition; each partition of `audit_log` also has the branch filter | A partition that is read directly is not covered by the policy of its parent. Tests check the rights of every partition from the catalog. |
| `actor_id`, `person_id` and `assignment_id` have no foreign key | Accounts and assignments arrive in 0.6a and 0.7; decide there. The exception is `branch_id`, which the catalog rule requires to reference `branches`. |
| `person_id` is the person an entry is about; "search by person" (2.6) means the actor or that person | Decided by the owner on 4 October 2026. |
| `actor_id` empty means the system (a server command, a job); which one goes into `details` | A column of its own is decided in 0.6a with the first Super Admin command. The owner agreed. |
| `oldValue`, `newValue` and `details` left out or `null` are stored as an empty column, never as a JSON null | One meaning of "no value". A cleared field is recorded by name: `{ phone: null }`. |
| No trigger stops the owner of the tables (`sodiq_migrator`) from changing audit rows | The developer rules ask it of the application's user. The migration user's password exists only in the deploy secret (0.10). |

## 4 October 2026: API foundations, database side (task 0.4b)

| Decision | Reason |
| --- | --- |
| Ids of rows are `uuid`, made by PostgreSQL 18's `uuidv7()` | `branches` is the first real table and sets the pattern. A uuid arrives as text in TypeScript, does not reveal how many rows exist, and can be made by a browser for request keys. Staff IDs and student UIDs stay separate visible numbers, as the spec says. The owner agreed on 4 October 2026. |
| The branch filter is the transaction setting `app.branch_ids` (a PostgreSQL array of uuids), read by the function `app_branch_ids()`; nothing set, or an empty value, is an empty list | Set with `set_config(..., true)`, it ends with the transaction and cannot stay on a pooled connection (developer rules, "Branch filter"). A value that is not a list of uuids is an error, never "all rows". |
| One policy for every branch table, `branch_filter`: `branch_id = any ((select app_branch_ids())::uuid[])` for reading and for writing, for `sodiq_app` only, and no other policy on the table | The inner select makes PostgreSQL read the list once per query. The cast is needed: without it `any ((select ...))` compares with the rows of the select and the policy cannot even be created. The owner of the tables (`sodiq_migrator`) is not filtered, so migrations see every row; `force row level security` is not used. |
| The filter guards against a fault of the application, not against the application user | `sodiq_app` can set `app.branch_ids` itself. The filter makes a forgotten `where` return nothing instead of another branch's rows; who may work for which branch is decided by the permission guard (0.7). |
| Every table in schema `public` is classified by a test over the catalog (`apps/api/src/database/catalog.test.ts`): `branch_id` with the standard filter, or named with a reason in the list of school-wide tables (today `schema_migrations`, `branches`, `request_keys`) | A later migration cannot forget the filter. The test also refuses a `branch_id` that may be empty, a second policy, and a `branch_filter` policy that is not the standard one. Asked for by the owner on 4 October 2026. |
| Every view is created with `security_invoker = true`; no materialized views; no `SECURITY DEFINER` function outside an allow-list with reasons (empty today), all checked by the same test | A view and a `SECURITY DEFINER` function run with the rights of their owner, who is not filtered; a materialized view holds a copy of the rows. The test shows a scratch view and a scratch function returning another branch's row. Asked for by the owner on 4 October 2026. If prepared report totals (9.3b) want a materialized view, ask the owner first. |
| `branches` has no row filter; the application user can only read it until task 1.1 | The branch names are not confidential and the branch switcher shows them. The owner agreed on 4 October 2026. |
| Business code gets its transaction from `Transactions.run(branchIds, work)`; the list of branches is a required argument | Nobody can forget the filter: forgetting shows no rows. `[]` is for work on school-wide tables only. Each id is checked as a uuid before it reaches the setting. Until 0.7 the caller passes the ids; then the guard supplies them. |
| The injection token `DATABASE` lives in `database.tokens.ts` and is exported again by `database.module.ts` | The services of the module import the token; importing it from the module would be a circular import. |
| Repeat-safe requests: the header `Idempotency-Key` (a uuid, `@RequestKey()`), the table `request_keys`, and `RequestKeys.runOnce(transaction, { key, scope, input }, work)` | The key row is written in the same transaction as the change: a request that failed leaves no key and can be tried again; a repeat finds the key and does not run the work. The primary key is the guard, so two requests at the same moment do the work once. |
| A repeat gets the same answer as the first request, from a small stored JSON result | The caller that lost the first answer needs it. The result holds ids and status only, never personal data. The owner agreed on 4 October 2026. |
| The same key for another action, with other input or for other branches is refused with 409 (code `request_refused` until 0.6a adds codes) | A key belongs to one action and one input; the input is compared by a SHA-256 hash of its canonical JSON. The database adds the branch list of the transaction to the hash, so a route cannot forget the branch. Found by the review. |
| `runOnce` puts the key and the work inside a savepoint; when the work throws, both are undone, also when the caller catches the error and commits the rest | Otherwise a refused entry inside a batch would leave its key behind, and a later retry would be answered "already done" with nothing saved. Found by the review. |
| `Transactions.run` gives no transaction to a database user that is a superuser, has BYPASSRLS, or owns the tables (checked once per process, in the first transaction) | For such a user every row policy does nothing and every test would still pass locally. Production users are created by hand in 0.10; a wrong one now stops all branch work instead of showing every branch. Found by the review. |
| Only `transactions.ts` may name the setting `app.branch_ids` (lint rule, with a test) | A `set_config(..., false)` or a second `set_config` elsewhere would keep or widen the filter. The rule stops the accident; it is not a wall against code that builds the name from pieces. |
| `request_keys` has no branch column; the application user may insert, read and update only the stored result, never delete | A key must be unique across the school. From 0.6a a key is also tied to the account that sent it. How long keys are kept, and the cleanup job, are decided in 8.3c with offline entry. |
| `ValidParams(schema)` checks and describes path parameters; `Body`, `Query`, `Param`, `Headers`, `Req` and `Request` of `@nestjs/common` may be imported only inside `apps/api/src/http/` (lint rule, with a test) | A route cannot read unchecked input by accident. `Request` is the other name of `Req`. The rule has no exception for tests or `src/testing`. Asked for by the owner on 4 October 2026. After the review the rule also refuses `Res`, `Response`, `Next`, `RawBody`, `HostParam`, `Ip`, `Session`, `UploadedFile`, `UploadedFiles`, the default import and files inside the package. It does not refuse `createParamDecorator` or `REQUEST` of `@nestjs/core`: the guard of 0.7 may need them; decide there. |
| The catalog test also checks that `branch_id` references `branches (id)`, that `sodiq_app` is not a superuser, has no BYPASSRLS and is a member of no role, and that `public` is the only schema | Found by the review. The checks read schema `public` only, so a new schema (pg-boss in 0.5) must be looked at and the checks extended before it is accepted. |

## 4 October 2026: API foundations, HTTP side (task 0.4a)

| Decision | Reason |
| --- | --- |
| Task 0.4 is split: 0.4a is the HTTP side, 0.4b the database side (branches, branch filter, request keys) | Two smaller reviews; the migration and the row filter are reviewed on their own. The owner chose this. |
| `zod` is the schema library, in `packages/shared`, the API and (through `packages/shared`) the web app | One schema checks the input on the server, describes it in the OpenAPI document and can check an answer in the browser. The owner approved it on 4 October 2026, with `@nestjs/swagger`, `openapi-typescript` and `openapi-fetch`. |
| Validation and schema description are our own code (`apps/api/src/http/`): `SchemaPipe`, and the decorators `@ValidBody`, `@ValidQuery` and `@Returns` | `nestjs-zod` 5.5.0 supports NestJS 10 and 11 only; we are on 12. `@ValidBody(schema)` both checks the body and puts the same schema into the document, so the two cannot differ. The owner chose this over installing an unsupported package. |
| `@nestjs/swagger` builds the OpenAPI document; its schemas come from `z.toJSONSchema` with the target `openapi-3.0` | The package emits OpenAPI 3.0, and JSON Schema of a newer dialect is not valid there. |
| The OpenAPI document is a committed file (`apps/api/openapi.generated.json`) and is not served over HTTP; there is no Swagger page | Serving it would be a new public route. A test fails when the file is out of date. |
| `openapi-typescript` 7.13.0 writes the client types although it declares TypeScript 5 only; `openapi-fetch` is the client | It generates correctly on TypeScript 6.0, and `apps/web/tooling/api-types.test.ts` generates again on every test run and compares. If a later version of either breaks it, that test fails; then ask the owner (`@hey-api/openapi-ts` declares TypeScript 6). `pnpm peers check` shows this one warning. |
| The install script of `@scarf/scarf` is refused (`allowBuilds` in `pnpm-workspace.yaml`) | It comes with the Swagger UI files inside `@nestjs/swagger` and only sends install statistics. |
| One error shape: `{ "error": { "code", "message", "requestId", "details"? } }` (`apiErrorSchema` in `packages/shared`) | `code` is stable and is what the web app translates into three languages from task 0.8a. `message` is English for the developer and is never shown to a user. The owner agreed on 4 October 2026. |
| The text of an error answer is always ours; the message of the thrown error is never sent | A parser's or a library's message can repeat what was sent or name internals. Only the status and, for validation, the details are taken from the error. Today the code follows from the status (401, 403, 409 and 429 are all `request_refused`). The first task that needs a code of its own (0.6a) adds it to `ERROR_CODES` and adds the way to throw it; nothing is built ahead. |
| `@Returns(schema)` is applied to the answer before it is sent (`ResponseSchemaInterceptor`): unknown fields are dropped, and an answer that does not fit is a 500 that names the field and the kind in the log, never the value | The document says what the browser gets, so the server must send exactly that. A query that returns one column too many must not leak it. Found by the review. A route without `@Returns` is not checked; the harness of 0.7 should require it on every route. |
| Validation details hold the path, a code and a fixed message per code, never a submitted value; a path segment that is not a plain field name becomes `*` | An answer must not repeat personal data that was typed. Decided by the owner on 4 October 2026. Limit: an input schema must not use caller-chosen keys (a record) whose keys look like field names; no schema does. |
| A fault of the server (500) is logged with the request id and the error's name, message and stack only | Other fields of an error, for example the detail of a database error, can hold values of a row. Sentry in 0.10 must keep to the same rule. |
| Every request gets an id from the server (`X-Request-Id`, also inside every error answer); an id sent by the client is ignored | The id ties an answer to the log. A caller must not be able to write into the log or reuse an id. |
| The request id is kept on the response, not in `AsyncLocalStorage` | Nothing deeper than the error answer needs it yet, and the context can be lost behind the body parser. Look again when request logging arrives (0.10). |
| Unknown paths outside `/api` and errors that NestJS does not see are answered by two Express handlers added after the routes (`initApp`) | NestJS handles only its own prefix; without them Express answers with an HTML page. `main.ts` and the tests both start the application through `initApp`. |
| CORS stays off | Web app and API share one origin (decision of 0.1), so no other site may read an answer. A test checks that a request with another `Origin` gets no `Access-Control-Allow-Origin`. Decided by the owner on 4 October 2026. |
| Configuration is read once at start by `loadConfig` (zod over the environment) and injected as `CONFIG`; no configuration library | Three variables today. A missing or wrong one stops the API with the names of all of them and never a value. `.env` is still read by `process.loadEnvFile` first. |
| The API listens on `HOST`, default `127.0.0.1`; Vite forwards `/api` to `127.0.0.1:3000` | On a developer machine the API is not reachable from the network. Render needs `HOST=0.0.0.0` (0.10). The owner agreed on 4 October 2026. |
| The request body limit stays at Express's default of 100 kB | "All present" for a class and bulk actions fit; files will go to R2. The owner agreed on 4 October 2026. |
| The clock: `Clock` (type) in `packages/shared`; `CLOCK` token, `SystemClock` and `ClockModule` in `apps/api/src/clock`; `FixedClock` in `src/testing`, which refuses a text without an offset (`+05:00` or `Z`) | A moment without an offset means another moment in CI (UTC) than in Tashkent. Business code is given the time (developer rules, Time-based state). The pure packages keep receiving moments as arguments. |
| ESLint refuses `Date.now()`, `new Date()` without arguments and `Date()` in `apps/api/src` and `packages/*/src`, except tests, `src/testing` and `system-clock.ts`; also `Date.now` without a call and `globalThis.Date` | The rule is checked by a test. `performance.now()` and `process.hrtime()` are not refused: they measure durations and cannot give the date or time of day. The web app is not covered yet: decide with its first code that has a time rule (8.3c). |
| A moment that a business rule compares (locks, windows, exemption ends, lesson times) is written from the injected clock, never from SQL `now()` or `current_timestamp`; `default now()` only for bookkeeping columns that no rule reads | Otherwise a test with a fixed clock would compare its moment with a moment of the database server, and the rule could not be tested at 23:59 and 00:00. Decided by the owner on 4 October 2026; also in `.claude/rules/database.md`. |
| The sample route of the build plan exists only in tests (`src/testing/sample.controller.ts`); the web app calls `GET /api/health` through the generated client | Nothing throwaway ships and no public route is added before the permission guard of 0.7. The owner chose this. |

## 4 October 2026: continuous integration (task 0.3)

| Decision | Reason |
| --- | --- |
| One workflow with two jobs: `checks` (lint, type-check, unit and API tests) and `e2e` (Playwright) | The pull request shows which kind of check failed, and the browser tests do not wait for the others. The owner chose to run the browser tests on every pull request (spec `14`, Whole system). |
| The workflow runs on pull requests and on pushes to `main` | `main` has its own result after each merge; the deploy of task 0.10 can depend on it. On `main` the concurrency group is the commit, so a later merge never cancels or replaces an earlier run; on a pull request a newer push stops the older run. |
| CI creates its users and database with `db/setup/local.sql` and uses the public values of `.env.example` | One way to set up a database, on a developer machine and in CI. The PostgreSQL service lives only inside the job. |
| Actions are pinned to a full commit, with the version in a comment | A tag can be moved to other code; a commit cannot. |
| The PostgreSQL service is `postgres:18`, the official image, not pinned to a digest | CI should follow the minor releases of version 18, as the developer machines and Neon do. The image runs only the throwaway database of a job and never sees the repository token. |
| The superuser password of the service is given only to the `psql` step | No other step needs it, and `pg` would quietly use it for a connection string without a password. |
| The workflow's token may only read the repository (`permissions: contents: read`) | Nothing in CI writes to GitHub. |
| No Turborepo remote cache | A whole run takes minutes at this size. Look again if CI becomes slow. |
| A variable that a Turborepo task reads from the environment is named in that package's `turbo.json` (`DATABASE_URL` and `PORT` for the API's `dev`) | Turborepo passes a task only the variables it names. With `.env` the API reads the file itself, so the gap shows only where there is no `.env`: in CI the API did not start under `pnpm dev` until this was added. |
| In CI Playwright prints the output of the servers it starts | Otherwise a server that fails to start shows only as a timeout. |
| `pnpm db:codegen` does not run in CI | `codegen.test.ts` already fails when the generated types are out of date. |

## 4 October 2026: database, migrations and typed queries (task 0.2)

| Decision | Reason |
| --- | --- |
| Two database users with fixed names: `sodiq_migrator` owns every table and runs the migrations; `sodiq_app` is what the API and the worker connect as | Append-only audit tables and the branch row filter only hold against a user that does not own the tables. The names are fixed because migrations name them in `grant` statements. |
| Each migration grants `sodiq_app` its rights table by table; there are no default privileges | A forgotten grant fails loudly in the first test ("permission denied"). With default privileges a forgotten revoke on an audit table would fail silently. |
| The migration runner is our own code (`apps/api/src/database/migrate.ts`), not a library | About 150 lines. It applies each file in its own transaction, takes an advisory lock so two runners cannot overlap, and refuses to run when an applied file was edited, renamed, removed or overtaken by a lower number. |
| Migrations go forward only; there are no "down" files | A migration is never edited after merge; a mistake is corrected by a new file. Restore is by backup (task 10.2). |
| The checksum of a migration ignores the difference between CRLF and LF | A Windows editor must not make an applied file look edited. |
| The runner uses the `pg` driver directly; everything else uses Kysely | It sends whole SQL files and holds a session lock on one connection. |
| `pg` is the PostgreSQL driver; `kysely-codegen` (development only) writes the types | `pg` is what Kysely and pg-boss use. The owner approved both on 4 October 2026. |
| `.env` is read with Node's own `process.loadEnvFile`, only if the file exists | No dotenv library. Variables already set win, so CI and the servers are not affected. Task 0.4 replaces this with configuration loading. |
| A `date` column arrives in TypeScript as the text `YYYY-MM-DD`; a `timestamptz` as a `Date` | The driver's default turns a date into local midnight, which becomes another day in another time zone. School dates are dates, lesson times are moments (`CLAUDE.md`, Conventions). A `date[]` arrives as an array of such texts. The generated types make a `date` column accept text only, so a `Date` cannot be written into one by mistake. How `bigint` and `numeric` arrive is decided with the first table that has one. |
| Tests: one template database per run, built by the real runner from the real migrations; each test file copies it and connects as `sodiq_app` | Copying a template takes a fraction of a second, files stay independent and can run in parallel, and a missing right fails a test instead of production. `sodiq_migrator` may create databases for this, locally and in CI only. |
| Every test database is named `sodiq_test_<start of the run>_<random>_...`; a run removes its own databases at the end and, at the start, those of runs older than an hour | Two runs at once (watch mode and `pnpm test`, or the owner and a Claude Code session) do not drop each other's databases, and an interrupted run does not leave databases for ever. |
| The tests refuse to run unless `DATABASE_MIGRATION_URL` points at localhost | They create and force-drop databases. |
| `createTestApp()` never connects to `sodiq_dev`: a test passes the `app` connection of its test database, otherwise every query fails | A route test must not read or change the developer database by accident. |
| The runner refuses a file that contains `begin;`, `commit;` or `rollback;` | Such a statement would end the runner's own transaction and could leave the file half-applied and unrecorded. A migration that cannot run in a transaction (`create index concurrently`) needs a change to the runner first; it comes with the first migration that needs one. |
| `0001` uses `create extension if not exists` | On a managed PostgreSQL the extension may already be installed by the provider; a merged migration cannot be edited to allow for that later. |
| `types.generated.ts` is committed exactly as generated; Prettier and ESLint skip it | A test runs the generator in verify mode against a freshly migrated database and fails when the file is out of date. |
| Local database passwords are in the repository (`db/setup/local.sql`, `.env.example`) | They are for a PostgreSQL on a developer machine or in a CI job only, and both files say so at the top. Test and production users are created in task 0.10 with SQL (`db/setup/server.sql`), never in the provider's console (corrected in 0.10: a console role on Neon has `BYPASSRLS`). The owner agreed on 4 October 2026. |
| PostgreSQL 18 everywhere: developer machines, CI, Neon | One version, so a constraint behaves the same in a test and in production. |
| `pnpm dev` on Windows is stopped with Ctrl+C twice | Turborepo starts each task through `cmd.exe`, which asks "Terminate batch job (Y/N)?" after the first Ctrl+C and waits where nobody can answer. Tried in stream and in terminal-UI mode on Turborepo 2.11.7: both wait. No clean fix was found; `README.md` describes it. |

## 4 October 2026: repository skeleton (task 0.1)

| Decision | Reason |
| --- | --- |
| ES modules in every package | NestJS 12, Vite and Vitest are ES modules; browser and server code use one module system. |
| TypeScript 6.0.x, not 7.0 | The NestJS CLI requires 6.0 and typescript-eslint does not support 7 yet. Move to 7 when both do. |
| Node 24 pinned in `.node-version` and `engines` | It is the current long-term-support line. pnpm refuses to install on another major version. Look again when Node 26 becomes long-term support. |
| Shared packages compile to `dist` with `tsc`; Turborepo builds them before lint, type-check, test and dev of what depends on them | Node runs the API from compiled JavaScript, so the packages need real output. One build order serves every command and a clean clone. |
| All API routes sit under `/api`; in development Vite forwards `/api` to the API | The browser sees one origin, which cookie sessions need. How production routes it is decided in task 0.10. |
| `GET /api/health` is public | Uptime monitoring and the deploy smoke test call it without a session. It answers only `{"status":"ok"}`. Task 0.7 declares it public in the permission table. |
| The health route lives in `apps/api/src/health/`, outside `modules/` | It is plumbing, not one of the eleven product modules named in `CLAUDE.md`. |
| The API does not send the `X-Powered-By` header | An answer does not name the framework behind it. |
| LF line endings through `.gitattributes` | A Windows clone otherwise gets CRLF and the Prettier check fails. |
| One ESLint config at the root; `pnpm lint` also runs the Prettier check; Prettier ignores `docs/`, `.claude/` and Markdown | One command checks everything, and the spec can never be reformatted by a tool. |
| shadcn/ui with the `nova` preset on Base UI and the Geist font served from our own files; Lucide is the icon set and is installed with the first component that uses an icon | These are the CLI's current defaults. Geist has Latin and Cyrillic sets. The look is reviewed in tasks 0.8a and 0.8b. |
| Libraries that shadcn/ui components need: `@base-ui/react`, `class-variance-authority`, `tw-animate-css`, `cn`, `@fontsource-variable/geist` | The CLI installs them and its components import them. `cn` is published by the author of shadcn/ui and replaces `clsx` and `tailwind-merge`; it is below version 1.0, and the generated components import it directly, so replacing it would mean patching every component the CLI adds. The owner confirmed `cn`, the Geist font and `shadcn` on 4 October 2026. |
| `shadcn` is a development dependency of the web app | `src/index.css` imports its stylesheet (`shadcn/tailwind.css`) at build time; nothing of it runs in the browser. The stylesheet is maintained with the components, so it is not copied into the repository. |
| Test libraries beside Vitest and Playwright: `jsdom`, `@testing-library/react` and `@testing-library/dom` for component tests; `supertest` for API route tests | Vitest needs a browser-like environment and a way to render a component, and route tests need to call the application over HTTP without opening a port. All are the usual choices for these jobs. |
| `@nestjs/platform-express` (Express) is the HTTP layer under NestJS | It is the NestJS default. |
| Lint tooling: `typescript-eslint`, `eslint-config-prettier`, `eslint-plugin-react-hooks`, `globals` | ESLint needs them to check TypeScript and React hooks and to stay out of Prettier's way. |
| The pure packages are type-checked a second time without Node types (`tsconfig.build.json`) | Tests may read files; the source of `packages/calc`, `packages/timetable-rules` and `packages/shared` may not use Node at all. `pnpm typecheck` fails if it does. |
| NestJS tests run on Vitest's own transform, without an SWC plugin | It emits the decorator metadata NestJS needs. `apps/api/src/testing/injection.test.ts` fails if that ever stops. |
| pnpm's release-age protection stays on, with no exceptions | pnpm refuses a package version published in the last 24 hours (its default, seen when ESLint 10.12.0 was refused). When the newest version is too young, the previous one is used. |
| Turborepo does not maintain an `AGENTS.md` (`agentGuidance: false`) | Project instructions for Claude Code live in `CLAUDE.md` only. |
| Root scripts for later tasks (`db:migrate`, `db:codegen`, `api:client`) exist and stop with a message | The names are fixed from the start and nobody mistakes them for working. |

## 3 October 2026: starting decisions

| Decision | Reason |
| --- | --- |
| React single-page app with Vite, not Next.js | Everything is behind sign-in, so server rendering adds nothing; static files are simpler to host and patch. |
| NestJS with REST and OpenAPI, client generated from it | Clear modules, a documented API for the later mobile apps, and the browser and server cannot disagree about a field. |
| Own sign-in module, no outside sign-in service | Narrow needs fixed by the spec; no fee per user; no account data leaves the platform. |
| SQL migrations by hand, Kysely for queries | The database rules (exclusion constraints, partitions, row filters) are plain SQL that schema tools cannot express. |
| pg-boss, no Redis | A job is saved in the same transaction as the data change; one service fewer. The pg-boss job table is the "outbox table" that `docs/spec/edge-cases/developer-rules.md` asks for; no second outbox is built. |
| Timefold Solver Community Edition in Kotlin as a separate service | Established solver with a school-timetabling model. Its paid "score analysis" is not used: the platform's own rule engine explains blocked lessons. Fallback: Google OR-Tools CP-SAT. |
| AG Grid Community for the journal | Free and built for large editable tables. Enterprise is bought only if range copy and paste is needed. |
| Pragmatic drag and drop for the timetable board | Stays smooth with more than a thousand drop cells. |
| Hosting: Render (Frankfurt), Neon, Cloudflare R2 | Managed services, so one developer does not run servers or database backups. |
| Calculation module and timetable rule engine as pure packages | Used by server and browser alike, and testable without a database. |
