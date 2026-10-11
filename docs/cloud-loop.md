# The working loop in the cloud

How a task travels from `docs/build-plan.md` to `main` with the owner touching it once, in the morning: confirming or changing the decisions made without them on issue #42, hand-testing the merged tasks on the test environment, and lifting a gate when it is time. Everything else is done by Claude Code sessions in the cloud, by the review routine and by the start routine. The decisions behind this file are in `docs/decisions.md` (Standing decisions, and 11 October 2026: the loop runs without the owner).

## The loop

```
start routine (or owner)          builder session               review routine              owner (mornings)
--------------------------------  ----------------------------  --------------------------  ----------------
/next-task  ───────────────────▶  plan with "Decided without
                                  the owner", spec-reviewer
                                  on it, draft PR, bind_pr,
                                  stop ("waiting for review") ─▶ [review] approved, with
                                                                 the decisions confirmed
                                                                 or changed /
                                                                 changes needed /
                                                                 owner decision needed
                                                                 (stop list only)
                                  (the bound PR wakes the
                                   session on each comment)
                                  build, tests, /finish-task:
                                  push, PR ready, report,
                                  decisions on issue #42,
                                  stop ───────────────────────▶  [review] ready to merge,
                                                                 merge when checks green /
                                                                 changes needed (three
                                                                 at most, then "stuck",
                                                                 label needs-owner)
                                  fix, push, stop ────────────▶  (again, until ready)
merge ──▶ /next-task on the                                                                  confirm or change
          next unticked task                                                                 decisions on #42,
                                                                                             hand test on the
                                                                                             test environment,
                                                                                             lift a gate
```

Rules of the loop:

- Review comments start with `[review]` and are one of `approved`, `changes needed`, `owner decision needed`, `ready to merge`, `stuck after three rounds`. The builder acts on the newest one (`.claude/skills/next-task`, `.claude/skills/finish-task`).
- When the spec is silent, nothing waits: the builder decides and writes the reading under "Decided without the owner", the reviewer confirms or changes it in its approval, the owner confirms or changes it afterwards on issue #42. `[review] owner decision needed` waits for a person only for the stop list of `CLAUDE.md` ("Stop and wait for the owner"). The owner answers in a comment, or runs `/spec-change`.
- The reviewer never edits or pushes code (`.claude/skills/review-pr`). It merges only at `[review] ready to merge` with the checks `checks` and `e2e` green on the head commit; the owner may merge by hand. The builder never merges (`.claude/settings.json` denies `gh pr merge`).
- After the third `[review] changes needed` on one pull request the reviewer posts `[review] stuck after three rounds` and the label `needs-owner`; the start routine starts nothing new while such a pull request is open.
- CI runs on every push to the pull request: the whole suite and the browser tests. A session runs lint, type-check and `pnpm test:changed`, and the browser tests only when the task changed them. A red CI is fixed before a review is asked for.
- An owner gate line in `docs/build-plan.md` stops the start routine before the task that follows it, until the owner deletes the line.

## One-time setup

Do the steps in this order, one per task, so that a piece that misbehaves is the last one added.

### 1. `.claude/settings.json` on the laptop

Ask Claude Code, in a session on `main`, to make these changes on a branch and open a pull request (the repository rules allow no direct push to `main`; the file holds permissions, so it is changed by hand and never by a script):

- Move `Bash(git push *)` and `PowerShell(git push *)` out of `ask`; add to `allow`: `Bash(git push -u origin task/*)`, `Bash(git push origin task/*)` and the same two for PowerShell. Any other push form still asks, because it is in no list.
- Add to `allow`, for Bash and for PowerShell: `gh api repos/sodiqschoolapp/sodiq-platform/*` and `gh pr ready *`. The skills use the REST form of the GitHub commands because cloud sessions cannot use GraphQL, which most `gh pr …` commands need.
- Add to `deny`, for Bash and for PowerShell: `gh pr merge *` and `git push -f *`. A merge through the REST form cannot be written as a rule; the skills allow it to the reviewer only, at `[review] ready to merge` with green checks.
- Add the session-start hook:

```json
"hooks": {
  "SessionStart": [
    {
      "matcher": "startup|resume",
      "hooks": [
        {
          "type": "command",
          "command": "bash \"$CLAUDE_PROJECT_DIR\"/scripts/cloud-session-start.sh",
          "timeout": 900
        }
      ]
    }
  ]
}
```

On the laptop the hook exits at once (`CLAUDE_CODE_REMOTE` is not `true`); in the cloud it prepares the clone.

Since 11 October 2026 the file also registers a `PostToolUse` hook on `Edit|Write|MultiEdit`: `scripts/hooks/format-written-file.mjs` runs Prettier on every file a session writes, so the Prettier check of CI never fails on a forgotten format.

### 2. The cloud environment

At claude.ai/code, open the environment selector (the cloud icon by the prompt box) and create an environment:

| Field | Value |
| --- | --- |
| Name | `sodiq-platform` |
| Network access | Custom: tick "Also include default list of common package managers" (npm, GitHub, Ubuntu's apt) and add the domains `apt.postgresql.org` and `www.postgresql.org` (PostgreSQL 18; the VM has 16) and `nodejs.org` (fallback for Node 24) |
| Environment variables | `TURBO_TELEMETRY_DISABLED=1` and `PATH=/opt/node24/bin:/nix/var/nix/profiles/default/bin:/root/.local/bin:/root/.cargo/bin:/usr/local/go/bin:/opt/node22/bin:/opt/maven/bin:/opt/gradle/bin:/opt/rbenv/bin:/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` (the VM's own PATH with `/opt/node24/bin` in front; without it the shell's `node` is 22) |
| Setup script | The whole of `scripts/cloud-setup.sh`, pasted. It never aborts: a failed step prints `!! … failed` and the session still starts, so the trial can report it |

Create a second environment for the review routine, the same but named `sodiq-review`, with one more variable: `SODIQ_REVIEW_ONLY=1`. Its sessions install the dependencies and skip the database.

The Claude GitHub App must be installed on `sodiqschoolapp/sodiq-platform` (it is: auto-fix was offered on pull request #19).

### 3. The trial: one task by hand in the cloud

Start a session at claude.ai/code on the repository with the `sodiq-platform` environment, and send:

```
Change nothing. Run these and report every output in full:
echo $PATH; which node; node --version; which pnpm; pnpm --version;
pg_lsclusters; pg_isready -h 127.0.0.1 -p 5432;
PGPASSWORD=sodiq_app_local psql -h 127.0.0.1 -U sodiq_app -d sodiq_dev -c "select 1".
Then run pnpm lint, pnpm typecheck and pnpm test and report the results.
```

Expected: `node --version` 24.x from `/opt/node24/bin`, `pnpm --version` 12.8.1 from `/opt/node24/bin`, one cluster `18 main 5432 online`, `accepting connections`, `1`, and three green runs. The session's own setup log (the box above the first answer) shows the setup script and the hook; a line starting with `!!` names a failed step.

What the first runs taught, and the fix for each:

- The setup script has no GitHub credentials: nothing is cloned in it.
- A setup script that aborts means no session at all: both scripts report and go on.
- Docker has no daemon in this VM, although the docs list it: PostgreSQL 18 is installed from `apt.postgresql.org` and started with `pg_ctlcluster` in the hook.
- `/opt/node22/bin` comes before `/usr/local/bin` on the session's PATH: the environment variable `PATH` above puts `/opt/node24/bin` first. If `node --version` is still 22 after that, the variable was not applied: tell the owner's reviewer; the fallback is a symlink of `/opt/node22/bin/node` to Node 24 in the setup script.
- The pnpm that pnpm installs for itself from `packageManager` is a stub without a shebang, which turbo cannot run (`Exec format error`): pnpm of the pinned version is installed with npm into `/opt/node24/bin`, and `/opt/node22/bin/pnpm` points there.

When all is green, send `/next-task` in the same session. It plans, opens the draft pull request, binds it to the session and stops. The review routine (step 4) posts `[review] …`, which wakes the session; from here the task runs by itself and ends with the reviewer merging. The owner hand-tests on the test environment the next morning.

### 4. The review routine

At claude.ai/code/routines, **New routine**:

| Field | Value |
| --- | --- |
| Name | `Review pull requests` |
| Repository | `sodiqschoolapp/sodiq-platform` |
| Environment | `sodiq-review` |
| Connectors | none |
| Triggers | two: GitHub event: Pull request, all actions, filter: base branch equals `main`; and a schedule every 30 minutes, with the same prompt (the skill does nothing when nothing needs a review) |
| Prompt | the text below |

```
Read .claude/skills/review-pr/SKILL.md in this repository and follow it.
Review the pull request named in the routine-fire-payload block if there is one;
otherwise every open pull request against main that needs a review, as the skill
says; when nothing needs a review, say so and stop.
If the pull request is a draft, review the plan: confirm or change every item
under "Decided without the owner", each with a reason, and list the result under
**Decisions** in the approval; [review] owner decision needed only for a stop-list
item or a real contradiction in the spec, never because the spec is silent.
If it is ready, review the code and read the result of CI.
Post the verdict as a comment that starts with [review] and set the label. Count
the [review] changes needed comments on the pull request: when three exist and the
verdict would be a fourth, post [review] stuck after three rounds with the findings
and add the label needs-owner instead.
At [review] ready to merge, read the check runs of the head commit: when checks and
e2e are both green, merge the pull request as the skill says (merge commit) and say
"Merged."; when one is still running, enable auto-merge and say so; when the merge
is refused, post the reason and add the label needs-owner.
Change no file, push nothing.
```

GitHub events have hourly caps per routine and per account; a pull request that gets no review within a few minutes is reviewed by the scheduled run, or by **Run now** on the routine. The routine also runs on actions that need no review (a label, an assignment); the skill then finds a `[review]` newer than the last push and stops. The scheduled run also confirms a merge that auto-merge finished after the event run.

Check the first run on the routine's page: a green status means the session ran, not that it reviewed; open the run and read the comment it posted.

### 5. Binding the pull request to the builder session

A bound pull request is what delivers a `[review]` comment and a CI result to the builder session without the owner. In a cloud session, step 10 of `next-task` binds the draft pull request to the session with the `bind_pr` tool (in some sessions the tool is listed as `subscribe_pr_activity`) and says that it did. From then on the session wakes on each comment and on each CI failure and follows `.claude/skills/next-task` and `.claude/skills/finish-task`.

If a session opened its pull request without binding it (the tool was missing), send once:

```
Bind the pull request you opened to this session, so that review comments reach you.
```

If a woken session does not continue after a comment, the fallback is a build routine: trigger `Pull request, labeled`, filter labels include `plan-approved`; the review routine then adds that label with its approval, and the build routine checks out the branch and continues from step 13 of `next-task`.

### 6. The start routine

Once steps 3 to 5 have each worked on a task, the loop starts itself. **New routine**:

| Field | Value |
| --- | --- |
| Name | `Start the next task` |
| Repository | `sodiqschoolapp/sodiq-platform` |
| Environment | `sodiq-platform` |
| Triggers | two: GitHub event: Pull request, closed; filters: is merged equals true, base branch equals `main`, head branch starts with `task/`; and a schedule every 30 minutes, with the same prompt |
| Prompt | the text below |

```
Read docs/build-plan.md and list the open pull requests against main
(gh api "repos/sodiqschoolapp/sodiq-platform/pulls?state=open&base=main").
Do nothing, and say why, when any of these holds: an open pull request from a
task/ branch exists; any open task pull request carries the label needs-owner; the
first unticked task of docs/build-plan.md comes after an owner gate line
("> **Owner gate.**"). One exception to doing nothing: an open draft pull request
from a task/ branch with no commit and no comment for three hours gets one comment,
"the builder session may have stopped", and nothing else is started.
Otherwise read .claude/skills/next-task/SKILL.md in this repository and follow it
with no task id: the first unticked task. Follow it to the end of "The draft pull
request": the branch task/<id>-<short-name>, the empty commit, the draft pull
request with the plan. Then bind the pull request to this session with the bind_pr
tool so that review comments and CI results reach it, say that you did, and stop.
If the skill tells you to stop for the owner (a split, a stop-list item), stop
there and say why.
```

Two tasks in parallel are started by the owner, not by this routine, and only when the reviewer paired them.

## What the owner does each morning

1. Read issue #42 and reply under each task's comment, one line per decision: `1 confirmed`, `2 change: <what instead>`. A changed decision becomes a line under "The next sessions must know" in `docs/progress.md` and, when code must change, a fix task `<id>b` first among the open tasks of `docs/build-plan.md`. A confirmed decision that reveals a silence of the spec is recorded with `/spec-change`.
2. Hand-test the merged tasks on `app-test.sodiqschool.uz` by the report's "What to look at" (a merge to `main` deploys there by itself). Something wrong is a comment on the merged pull request and a fix task.
3. Lift a gate when ready: delete the owner gate line in `docs/build-plan.md` (a pull request, or a commit by hand); the next scheduled run of the start routine starts the task after it.
4. The owner's reviewer fills issue #41 (cycle time per task) after each merge.
5. Once a week, read two review threads end to end, so the loop never runs unread.

## When something goes wrong

- A session that stopped and does not continue: open it at claude.ai/code and send "read the review on the pull request and proceed". An expired session is restored with its conversation when opened.
- A pull request with the label `needs-owner`: the reviewer stopped after three rounds, or a merge was refused. The start routine starts nothing while it is open. The owner reads the findings, decides in a comment (a `[review] …` of their own, or the answer the rounds were missing), removes the label, and the loop goes on.
- The comment "the builder session may have stopped" on a draft pull request: the start routine saw no commit and no comment for three hours. Open the session and send "continue"; or close the pull request and delete its branch, and the next run starts the task again.
- A review that is wrong: reply on the pull request with `[review] …` yourself; the builder follows the newest `[review]`.
- A routine run with a green status and no comment: open the run and read why; the usual causes are a blocked network request or a pull request that already had a newer review.
- Anything that touches `docs/spec/`: never from a routine. A session stops and the owner runs `/spec-change`.
