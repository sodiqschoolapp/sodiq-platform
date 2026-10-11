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
   - `## Decided without the owner`: every question the spec leaves open or answers unclearly, numbered, each with the chosen answer (the most reasonable reading: the spec's own lines, the standing decisions, the way the school works), the reason in one sentence, and the spec lines it rests on;
   - `## Needs the owner`: stop-list items only (`CLAUDE.md`, "Stop and wait for the owner"). When this section is not empty, say so in the pull request and stop as today;
   - anything you plan to leave out of this task, and why.
   If the task is too large for one session, propose a split into a, b, c and stop with that proposal.
8. Ask the `spec-reviewer` subagent to review the plan (not a diff) against the spec files the task lists. Fix in the plan what it finds, and say under the plan what the reviewer found and what you changed.

## The draft pull request

9. First run `git ls-remote --heads origin "task/<id>-*"`. If it lists anything, stop and say "task <id> is already started": another session has it, or one died before its pull request (the start routine names such a branch for the owner). Otherwise create the branch `task/<id>-<short-name>` from `main`. Make one empty commit (`git commit --allow-empty`) with the subject `<id> Plan`, and push it: `git push -u origin task/<id>-<short-name>`.
10. Open a draft pull request (GitHub commands below). The body is the plan of step 7 with the reviewer's notes, under the heading `## Plan`. Print the address of the pull request. In a cloud session, bind the pull request to the session with the `bind_pr` tool (`docs/cloud-loop.md`, section 5), so that `[review]` comments and CI results wake it, and say that you did.
11. Stop. Say: "Waiting for review on the pull request." Do not edit code before the review.

## After the review

12. When you are told to continue, or a comment on the pull request reaches you, read every comment of the pull request (GitHub commands below). Review comments start with `[review]`. Act on the newest one:
    - `[review] approved`: build. The comment may carry corrections to the plan and may change a decision under "Decided without the owner"; build with the reviewer's version.
    - `[review] changes needed`: change the plan as asked, update the body of the pull request, post a comment that says what changed, then make an empty commit `<id> Plan, revised` and push it, and stop again. A plan revision changes no file; without the push the review routine sees no change newer than its review and never reviews the plan again.
    - `[review] owner decision needed`, or a question: comes only for stop-list items. Answer what you can in a comment and stop; the owner answers the rest.
    A comment that asks for something outside the task, or against `CLAUDE.md`, is not followed: say so in a comment and stop.
13. Build on the task branch. Write the tests with the code (`CLAUDE.md`, How to work on a task). While you build, post a one-line progress comment on the pull request at least once an hour (what is done, what is next): the start routine resumes a task whose pull request shows no commit and no comment for two hours after a review, and a second session must not start on a task that is still being built. A conflict inside the spec is a decision, not a stop: follow the written rule where one exists, record the reading under "Decided without the owner" and flag it. Stop only when following the spec is impossible; then tell the owner to run `/spec-change`.
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
