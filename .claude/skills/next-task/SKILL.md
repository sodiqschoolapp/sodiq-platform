---
description: Start a task from docs/build-plan.md. Reads the task and the spec files it lists, then proposes a plan and waits for approval. Use at the start of a session.
argument-hint: "[task id, for example 1.3]"
disable-model-invocation: true
---

# Start a task

Task requested: $ARGUMENTS

1. Before anything else, run `git branch --show-current`, `git rev-parse HEAD` and `git ls-remote origin main`. If the current branch is not `main`, or HEAD differs from the remote main, stop and tell the owner to run `git switch main` and `git pull`, then start a new session. Do not plan from an out-of-date copy.
2. Open `docs/build-plan.md`. If a task id was given above, use that task. Otherwise use the first unticked task. Say which task you chose and quote it.
3. Read `docs/progress.md` to see what was done last and what was left open.
4. Read every spec file the task lists, in full, plus `docs/spec/edge-cases/00-definitions.md`. Short names are explained at the top of the build plan.
5. Look at the existing code that the task touches. Do not propose anything before you have seen it.
6. Write a plan and stop. Do not edit files yet. The plan has:
   - what will exist when the task is done, in two or three sentences;
   - database changes (tables, constraints, migrations);
   - API routes with the permission each one needs;
   - screens or components;
   - the tests you will write, naming the spec rule each one checks;
   - anything in the spec that is unclear, missing or contradictory, as numbered questions;
   - anything you plan to leave out of this task, and why.
7. If the task is too large for one session, propose a split into a, b, c and stop.
8. Wait for the owner to approve or correct the plan. Then switch to `main`, pull the latest changes, create the branch `task/<id>-<short-name>` from it, and start.
9. When the work is ready, stop and tell the owner to run `/finish-task`. If the spec itself needs to change, stop and tell the owner to run `/spec-change`.
