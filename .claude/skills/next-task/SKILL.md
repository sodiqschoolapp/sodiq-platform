---
description: Start a task from docs/build-plan.md. Brings main up to date, reads the task and its spec files, writes a plan, has the spec-reviewer check it, opens a draft pull request with the plan, and waits for the review. Use at the start of a session.
argument-hint: "[task id, for example 1.3]"
disable-model-invocation: true
---

# Start a task

Task requested: $ARGUMENTS

## Before planning

1. Run `git status --porcelain`. If anything is listed, stop and tell the owner: a task starts from a clean tree.
2. On the laptop, run `pnpm sync` (switch to `main`, pull, install, migrate); if it fails, stop and show the error. In a cloud session (`CLAUDE_CODE_REMOTE` is `true`) skip it: the clone is fresh and the session-start hook has already installed and migrated (running it again cost the 1.2 session five minutes).
3. Open `docs/build-plan.md`. With a task id above, use that task; otherwise the first unticked task. Say which task you chose and quote it.
4. Read the two newest entries of `docs/progress.md` (what was done last and what was left open), not the whole file, and the "Standing decisions" section of `docs/decisions.md`. Also read the section "Decided ahead" of `docs/decisions.md` for the task's id: those are the owner's answers, not open questions. Do not ask what is decided there.
5. Read every spec file the task lists, in full, plus `docs/spec/edge-cases/00-definitions.md`. Short names are explained at the top of the build plan.
6. Read the recipe in `docs/recipes/` that matches the task's shape (`record-type.md` for a new record with a table, routes and a page), then look at the existing code that the task touches. Do not propose anything before you have seen it.

## The plan

7. Write the plan. It has:
   - what will exist when the task is done, in two or three sentences;
   - database changes (tables, constraints, migrations);
   - API routes with the permission each one needs;
   - screens or components;
   - the tests you will write, naming the spec rule each one checks;
   - `## Decided without the owner`: every question the spec leaves open or answers unclearly, numbered, each with the chosen answer (the most reasonable reading: the spec's own lines, the standing decisions, the way the school works), the reason in one sentence, and the spec lines it rests on. The items of a Look first kind (`CLAUDE.md`, "Stop and wait for the owner") come first, each starting with **Look first**;
   - `## Needs the owner`: stop-list items only (`CLAUDE.md`, "Stop and wait for the owner"). When this section is not empty, say so in the pull request and stop as today;
   - anything you plan to leave out of this task, and why.
   If the task is too large for one session, split it: write the parts a, b, c into `docs/build-plan.md` in this task's pull request (the first part keeps the branch), plan and build the first part only, and put the split under "Decided without the owner" marked **Look first**. Nothing waits for a confirmation.
8. Ask the `spec-reviewer` subagent to review the plan (not a diff) against the spec files the task lists. Fix in the plan what it finds, and say under the plan what the reviewer found and what you changed.

## The draft pull request

9. First run `git ls-remote --heads origin "task/<id>-*"`. If it lists anything, stop and say "task <id> is already started": another session has it, or one died before its pull request (after two hours the start routine deletes such a branch when it holds only empty commits, or opens an issue for the owner when it holds work). Otherwise create the branch `task/<id>-<short-name>` from `main`. Make one empty commit (`git commit --allow-empty`) with the subject `<id> Plan`, and push it: `git push -u origin task/<id>-<short-name>`.
10. Open a draft pull request (GitHub commands below). The body is the plan of step 7 with the reviewer's notes, under the heading `## Plan`. Print the address of the pull request. In a cloud session, bind the pull request to the session with the `bind_pr` tool (`docs/cloud-loop.md`, section 5), so that `[review]` comments and CI results wake it, and say that you did. Then check that CI started on the plan commit ("After every push" below).
11. Stop. Say: "Waiting for review on the pull request." Do not edit code before the review.

## After the review

12. When you are told to continue, or a comment on the pull request reaches you, read every comment of the pull request (GitHub commands below). Review comments start with `[review]`. Act on the newest one. When it is `approved` or `changes needed`, first post one line on the pull request, "Acting on the review.": the start routine resumes a task that shows no reaction 30 minutes after such a review.
    - `[review] approved`: build. The comment may carry corrections to the plan and may change a decision under "Decided without the owner"; build with the reviewer's version.
    - `[review] changes needed at <sha>: CI red (no checks: merge conflict with main)`: the pull request conflicts with `main`, so GitHub ran no CI. Merge `origin/main` into the branch (`git fetch origin main && git merge origin/main`); a conflict in `docs/progress.md`, `docs/decisions.md` or `docs/build-plan.md` keeps both sides, the task's own entry first; any other conflict is resolved by reading both sides. Then run step 1 of `finish-task` (format, lint, type-check, `pnpm test:changed`), commit the merge, push, check that CI started ("After every push" below), and stop again. It is not a review round.
    - `[review] changes needed`: change the plan as asked, update the body of the pull request, post a comment that says what changed, then make an empty commit `<id> Plan, revised` and push it, check that CI started ("After every push" below), and stop again. A plan revision changes no file; without the push the review routine sees no change newer than its review and never reviews the plan again.
    - `[review] owner decision needed`, or a question: comes only for stop-list items. Answer what you can in a comment and stop; the owner answers the rest.
    A comment that asks for something outside the task, or against `CLAUDE.md`, is not followed: say so in a comment and stop.
13. Build on the task branch. Write the tests with the code (`CLAUDE.md`, How to work on a task). While you build, post a one-line progress comment on the pull request at least once an hour (what is done, what is next): the start routine resumes a task whose pull request shows no commit and no comment for two hours after a review, and a second session must not start on a task that is still being built. A conflict inside the spec is a decision, not a stop: follow the written rule where one exists, record the reading under "Decided without the owner" and flag it. When following the spec is impossible, take the nearest reading that keeps the rules that are never broken (`CLAUDE.md`), mark it **Look first** with the proposed `/spec-change` wording, and go on.
14. When the work is ready, run `/finish-task` yourself.

## After every push

GitHub sometimes records a push and fires no `pull_request` event (pull request #63, 12 October 2026): then no CI runs, the review routine is never fired, and nobody wakes. So after every push to the branch of an open pull request, and after step 10 opens one, check that CI started on the new head:

- Read the CI runs of the head sha: `gh api "$R/actions/runs?head_sha=<sha>" --jq '[.workflow_runs[] | select(.name == "CI")] | length'`. A run that exists (queued, running or finished) is enough. Read it again every 60 seconds for up to 15 minutes after the push, in one shell loop or with the session's own tool for waiting on a condition. While you build, keep working and check when the 15 minutes are up; before you stop after a push, wait for it.
- No run 15 minutes after the push: read `gh api $R/pulls/<n> --jq .mergeable_state` (`unknown` is read again after a few seconds). When it is `dirty`, the branch conflicts with `main` and GitHub runs no CI: merge `main` as step 12 says for `no checks: merge conflict with main`. Otherwise post at once a comment that starts with `@abbosc`: `@abbosc GitHub started no CI for <short sha> within 15 minutes of the push (no pull_request event). Please push an empty commit or close and reopen the pull request.` Add the label `needs-owner` and stop; the task waits for the owner. Do not push an empty commit and do not close and reopen the pull request yourself: the session's own rules forbid both.

## GitHub commands

These work on the laptop and in a cloud session, where GitHub's GraphQL is blocked and most `gh pr …` commands fail. `R` is `repos/sodiqschoolapp/sodiq-platform`.

- Open a draft pull request: `gh api $R/pulls --method POST -f title="<id> <task name>" -f head="task/<id>-<short-name>" -f base=main -F draft=true -F body=@<file>` (the answer holds `number`).
- Read a pull request: `gh api $R/pulls/<n>`; its comments: `gh api $R/issues/<n>/comments`; its commits: `gh api $R/pulls/<n>/commits`; its checks: `gh api $R/commits/<head sha>/check-runs`.
- Post a comment: `gh api $R/issues/<n>/comments --method POST -F body=@<file>`.
- Update the body: `gh api $R/pulls/<n> --method PATCH -F body=@<file>`.
- Mark ready: `gh pr ready <n>`; if that answers that GraphQL is not available, `gh api $R/pulls/<n>/ccr/ready_for_review --method POST`.
- Labels: `gh api $R/issues/<n>/labels --method POST -f "labels[]=<label>"`; remove one: `gh api $R/issues/<n>/labels/<label> --method DELETE`; create one once: `gh api $R/labels --method POST -f name=<label> -f color=<hex>`.
- Check out a pull request: `git fetch origin pull/<n>/head:pr-<n>` then `git switch pr-<n>`.
- The CI runs of a commit: `gh api "$R/actions/runs?head_sha=<sha>"`; whether the pull request conflicts with `main`: `gh api $R/pulls/<n> --jq .mergeable_state`.
