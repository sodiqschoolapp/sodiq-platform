# The working loop in the cloud

How a task travels from `docs/build-plan.md` to `main` with the owner touching it three times: a decision when the spec is silent, the merge, and the hand test. Everything else is done by Claude Code sessions in the cloud and by the review routine. The standing decisions behind this file are in `docs/decisions.md`.

## The loop

```
owner (or the start routine)      builder session               review routine              owner
--------------------------------  ----------------------------  --------------------------  ---------------
/next-task  ───────────────────▶  plan, spec-reviewer on it,
                                  draft PR with the plan,
                                  stop ("waiting for review") ─▶ [review] approved /
                                                                 changes needed /
                                                                 owner decision needed
                                  (auto-fix hands the comment
                                   to the session)
                                  build, tests, /finish-task:
                                  push, PR ready, report with
                                  hand-test steps, stop ──────▶  [review] ready to merge /
                                                                 changes needed
                                  fix, push, stop ────────────▶  (again, until ready)
                                                                                              merge, pnpm sync,
                                                                                              hand test
```

Rules of the loop:

- Review comments start with `[review]` and are one of `approved`, `changes needed`, `owner decision needed`, `ready to merge`. The builder acts on the newest one (`.claude/skills/next-task`, `.claude/skills/finish-task`).
- The reviewer never edits, pushes or merges (`.claude/skills/review-pr`). The builder never merges (`.claude/settings.json` denies `gh pr merge`). Only the owner merges.
- `[review] owner decision needed` is the one comment that waits for a person: the spec is silent or a rule should change. The owner answers in a comment, or runs `/spec-change`.
- CI runs on every push to the pull request, including the browser tests. A session runs the browser tests itself only when the task changed them.

## One-time setup

Do the steps in this order, one per task, so that a piece that misbehaves is the last one added.

### 1. `.claude/settings.json` on the laptop

Ask Claude Code, in a session on `main`, to make these changes on a branch and open a pull request (the repository rules allow no direct push to `main`; the file holds permissions, so it is changed by hand and never by a script):

- Move `Bash(git push *)` and `PowerShell(git push *)` out of `ask`; add to `allow`: `Bash(git push -u origin task/*)`, `Bash(git push origin task/*)` and the same two for PowerShell. Any other push form still asks, because it is in no list.
- Add to `allow`, for Bash and for PowerShell: `gh api repos/sodiqschoolapp/sodiq-platform/*` and `gh pr ready *`. The skills use the REST form of the GitHub commands because cloud sessions cannot use GraphQL, which most `gh pr …` commands need.
- Add to `deny`, for Bash and for PowerShell: `gh pr merge *` and `git push -f *`. A merge through the REST form cannot be written as a rule; the skills forbid it and only the owner merges.
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

### 2. The cloud environment

At claude.ai/code, open the environment selector and create an environment:

| Field | Value |
| --- | --- |
| Name | `sodiq-platform` |
| Network access | Trusted (the default list: npm, GitHub, Docker Hub). Node 24 comes from the npm registry; Custom with the default list plus `nodejs.org` is the fallback if that ever fails |
| Environment variables | `TURBO_TELEMETRY_DISABLED=1` |
| Setup script | The whole of `scripts/cloud-setup.sh`, pasted. It never aborts: a failed step prints `!! … failed` and the session still starts, so the trial can report it |

Create a second environment for the review routine, the same but named `sodiq-review`, with one more variable: `SODIQ_REVIEW_ONLY=1`. Its sessions install the dependencies and skip the database.

The Claude GitHub App must be installed on `sodiqschoolapp/sodiq-platform` (it is: auto-fix was offered on pull request #19).

### 3. The trial: one task by hand in the cloud

Start a session at claude.ai/code on the repository with the `sodiq-platform` environment, and send:

```
Change nothing. Run these and report every output in full:
echo $PATH; which node; node --version; /opt/node24/bin/node --version;
pnpm --version; docker ps; ls /opt;
docker exec sodiq-pg psql -U sodiq_app -d sodiq_dev -c "select 1".
Then run pnpm lint, pnpm typecheck and pnpm test and report the results.
```

Expected: `node --version` is 24.x, pnpm 12.8.1, a container `sodiq-pg`, `1`, and three green runs. The session's own setup log (the box above the first answer) shows the setup script and the hook; a line starting with `!!` names a failed step.

If `/opt/node24/bin/node` is 24 but `node --version` is not: the session's `PATH` puts `/opt/node22/bin` first. Add the variable `PATH=/opt/node24/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin` to the environment and start a new session. If `/opt/node24/bin/node` is missing: both Node installs failed; the setup log says which. If `docker ps` fails in the session as well: replace the container by `apt install postgresql-18` from `apt.postgresql.org` in the setup script (drop the cluster of the preinstalled 16 first, so 18 takes port 5432), add `apt.postgresql.org` and `www.postgresql.org` to a Custom network list, and start it in the hook with `service postgresql start`.

Known from the first runs: the setup script has no GitHub credentials (nothing is cloned in it), Docker's daemon needs a few seconds after `service docker start`, and a setup script that aborts means no session at all.

When all is green, send `/next-task` in the same session. It plans, opens the draft pull request and stops. The reviewer (step 4 once it exists; the owner's reviewer until then) posts `[review] …`; the owner sends "read the review on the pull request and proceed" from the phone or the browser. From here the task runs as on the laptop, and ends with the owner merging and hand-testing after `pnpm sync`.

### 4. The review routine

At claude.ai/code/routines, **New routine**:

| Field | Value |
| --- | --- |
| Name | `Review pull requests` |
| Repository | `sodiqschoolapp/sodiq-platform` |
| Environment | `sodiq-review` |
| Connectors | none |
| Trigger | GitHub event: Pull request, all actions, filter: base branch equals `main` |
| Prompt | the text below |

```
Read .claude/skills/review-pr/SKILL.md in this repository and follow it.
Review the pull request named in the routine-fire-payload block if there is one;
otherwise every open pull request against main that needs a review, as the skill
says. Post the verdict as a comment that starts with [review] and set the label.
Change no file, push nothing, merge nothing. If the pull request is a draft, review
the plan; if it is ready, review the code and read the result of CI.
```

GitHub events have hourly caps per routine and per account; a pull request that gets no review within a few minutes is reviewed by the next run, or by **Run now** on the routine. The routine also runs on actions that need no review (a label, an assignment); the skill then finds a `[review]` newer than the last push and stops.

Check the first run on the routine's page: a green status means the session ran, not that it reviewed; open the run and read the comment it posted.

### 5. Auto-fix on the task's pull request

Auto-fix is what delivers a `[review]` comment to the builder session without the owner. In the builder session, after the draft pull request is open, send once:

```
Turn on auto-fix for the pull request you opened, so that review comments reach you.
```

From then on the session wakes on each comment and on each CI failure and follows `.claude/skills/next-task` and `.claude/skills/finish-task`. Add that sentence to the end of step 10 of `next-task` once it has worked on two tasks, so nobody has to send it.

If a woken session does not continue after a comment, the fallback is a build routine: trigger `Pull request, labeled`, filter labels include `plan-approved`; the review routine then adds that label with its approval, and the build routine checks out the branch and continues from step 13 of `next-task`.

### 6. The start routine

Once steps 3 to 5 have each worked on a task, the loop can start itself. **New routine**:

| Field | Value |
| --- | --- |
| Name | `Start the next task` |
| Repository | `sodiqschoolapp/sodiq-platform` |
| Environment | `sodiq-platform` |
| Trigger | GitHub event: Pull request, closed; filters: is merged equals true, base branch equals `main`, head branch starts with `task/` |
| Prompt | the text below |

```
Read .claude/skills/next-task/SKILL.md in this repository and follow it with no
task id: the first unticked task of docs/build-plan.md. Follow it to the end of
"The draft pull request": the branch task/<id>-<short-name>, the empty commit, the
draft pull request with the plan. Then turn on auto-fix for that pull request so
that review comments reach this session, and stop. If the skill tells you to stop
for the owner (a split, a question), stop there and say why.
```

Two tasks in parallel are started by the owner, not by this routine, and only when the reviewer paired them.

## What the owner does per task

1. Nothing, until GitHub notifies: a `[review] owner decision needed` comment, or a pull request marked ready with `[review] ready to merge`.
2. Answer the decision in a comment, or run `/spec-change` when a rule should change.
3. Merge. On the laptop: `pnpm sync`, `pnpm dev`, the hand-test steps of the report. Something wrong is a comment on the merged pull request and a line for the next task, or a fix task.
4. Once a week, read two review threads end to end, so the loop never runs unread.

## When something goes wrong

- A session that stopped and does not continue: open it at claude.ai/code and send "read the review on the pull request and proceed". An expired session is restored with its conversation when opened.
- A review that is wrong: reply on the pull request with `[review] …` yourself; the builder follows the newest `[review]`.
- A routine run with a green status and no comment: open the run and read why; the usual causes are a blocked network request or a pull request that already had a newer review.
- Anything that touches `docs/spec/`: never from a routine. A session stops and the owner runs `/spec-change`.
