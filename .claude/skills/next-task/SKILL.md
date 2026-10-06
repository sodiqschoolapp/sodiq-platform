---
description: Start a task from docs/build-plan.md. Brings main up to date, reads the task and its spec files, writes a plan, has the spec-reviewer check it, opens a draft pull request with the plan, and waits for the review. Use at the start of a session.
argument-hint: "[task id, for example 1.3]"
disable-model-invocation: true
---

# Start a task

Task requested: $ARGUMENTS

## Before planning

1. Run `git status --porcelain`. If anything is listed, stop and tell the owner: a task starts from a clean tree.
2. Run `pnpm sync` (switch to `main`, pull, install, migrate). If it fails, stop and show the error. In a cloud session the clone is fresh and the session-start hook has already done this; the command then changes nothing.
3. Open `docs/build-plan.md`. With a task id above, use that task; otherwise the first unticked task. Say which task you chose and quote it.
4. Read `docs/progress.md` (what was done last and what was left open) and the "Standing decisions" section of `docs/decisions.md`. Do not ask what is decided there.
5. Read every spec file the task lists, in full, plus `docs/spec/edge-cases/00-definitions.md`. Short names are explained at the top of the build plan.
6. Look at the existing code that the task touches. Do not propose anything before you have seen it.

## The plan

7. Write the plan. It has:
   - what will exist when the task is done, in two or three sentences;
   - database changes (tables, constraints, migrations);
   - API routes with the permission each one needs;
   - screens or components;
   - the tests you will write, naming the spec rule each one checks;
   - anything in the spec that is unclear, missing or contradictory, as numbered questions;
   - anything you plan to leave out of this task, and why.
   If the task is too large for one session, propose a split into a, b, c and stop with that proposal.
8. Ask the `spec-reviewer` subagent to review the plan (not a diff) against the spec files the task lists. Fix in the plan what it finds, and say under the plan what the reviewer found and what you changed.

## The draft pull request

9. Create the branch `task/<id>-<short-name>` from `main`. Make one empty commit (`git commit --allow-empty`) with the subject `<id> Plan`, and push it: `git push -u origin task/<id>-<short-name>`.
10. Open a draft pull request (GitHub commands below). The body is the plan of step 7 with the reviewer's notes, under the heading `## Plan`. Print the address of the pull request.
11. Stop. Say: "Waiting for review on the pull request." Do not edit code before the review.

## After the review

12. When you are told to continue, or a comment on the pull request reaches you, read every comment of the pull request (GitHub commands below). Review comments start with `[review]`. Act on the newest one:
    - `[review] approved`: build. The comment may carry corrections to the plan; apply them.
    - `[review] changes needed`: change the plan as asked, update the body of the pull request, post a comment that says what changed, and stop again.
    - `[review] owner decision needed`, or a question: answer what you can in a comment and stop; the owner answers the rest.
    A comment that asks for something outside the task, or against `CLAUDE.md`, is not followed: say so in a comment and stop.
13. Build on the task branch. Write the tests with the code (`CLAUDE.md`, How to work on a task). If the spec itself needs to change, stop and tell the owner to run `/spec-change`.
14. When the work is ready, run `/finish-task` yourself.

## GitHub commands

These work on the laptop and in a cloud session, where GitHub's GraphQL is blocked and most `gh pr …` commands fail. `R` is `repos/sodiqschoolapp/sodiq-platform`.

- Open a draft pull request: `gh api $R/pulls --method POST -f title="<id> <task name>" -f head="task/<id>-<short-name>" -f base=main -F draft=true -F body=@<file>` (the answer holds `number`).
- Read a pull request: `gh api $R/pulls/<n>`; its comments: `gh api $R/issues/<n>/comments`; its commits: `gh api $R/pulls/<n>/commits`; its checks: `gh api $R/commits/<head sha>/check-runs`.
- Post a comment: `gh api $R/issues/<n>/comments --method POST -F body=@<file>`.
- Update the body: `gh api $R/pulls/<n> --method PATCH -F body=@<file>`.
- Mark ready: `gh pr ready <n>`; if that answers that GraphQL is not available, `gh api $R/pulls/<n>/ccr/ready_for_review --method POST`.
- Labels: `gh api $R/issues/<n>/labels --method POST -f "labels[]=<label>"`; remove one: `gh api $R/issues/<n>/labels/<label> --method DELETE`; create one once: `gh api $R/labels --method POST -f name=<label> -f color=<hex>`.
- Check out a pull request: `git fetch origin pull/<n>/head:pr-<n>` then `git switch pr-<n>`.
