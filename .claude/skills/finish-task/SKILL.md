---
description: Finish the current task. Runs the checks, gets an independent review against the spec, updates the plan and progress files, pushes, marks the pull request ready and posts the report (what to look at, what the browser test proved, the decisions made without the owner). Run it when the work of a task is ready.
---

# Finish the current task

1. Run `pnpm lint`, `pnpm typecheck` and `pnpm test:changed`. Run `pnpm test:e2e` only if the task changed files under `apps/web/e2e/` or `apps/web/playwright.config.ts`; for every other task CI runs the browser tests on the pull request. The full `pnpm test` is not run locally: CI runs it on the pull request and is the gate, and a red CI is fixed before a review is asked for. Every test run writes its output to a file in the scratchpad (`pnpm test:changed > <scratchpad>/test-changed.txt 2>&1`) and you read the summary from the file. Fix every failure. Never skip, delete or weaken a test; if you believe a test is wrong, stop and explain.
2. Commit the work on the task branch, with the task id first in the subject. The reviewers read `git diff main...HEAD`, which shows committed changes only.
3. Ask the `spec-reviewer` subagent to review this branch against the spec files listed in the task. If the task added or changed API routes, also ask the `permission-reviewer` subagent.
4. Fix what the reviewers found and commit again. Every must-fix that is a general pattern (something another task could do again) becomes a line in `.claude/agents/spec-reviewer.md` or in `.claude/rules/` in the same commit, so the same thing is never found twice. For anything you disagree with, do not fix it silently and do not ignore it: list it in the report with your reason.
5. Check the definition of done in `CLAUDE.md`, point by point, and say for each point whether it is met.
6. Tick the task in `docs/build-plan.md` and add a dated entry at the top of `docs/progress.md`: what was built, what was left out, and what the next session must know. Commit.
7. Write the report, in plain words, under the heading `## Report`:
   - what now works;
   - **Hand test**: five to ten numbered steps the owner clicks through on the laptop, each with the page, the action and what they should see, including one refusal (a wrong input or a forbidden action);
   - what you are not sure about;
   - what you did not do;
   - what the reviewers found, what you changed, and anything you disagreed with.
8. Push the branch: `git push -u origin task/<id>-<short-name>`. Find the pull request of the branch (`gh api $R/pulls?head=sodiqschoolapp:task/<id>-<short-name>`); if there is none, open one as in `next-task` but with `-F draft=false`. Mark it ready and update its body, keeping the plan under `## Plan` and adding the report under `## Report`. Post the report as a comment too (GitHub commands below). Then post the task's decisions as one comment on issue #42, in the form that issue gives (`Task <id> — pull request #<n>`, then one numbered item per decision: the question, `Decided:`, `Because:`, `Recorded in:`); when there is none, post nothing and say so in the report.
9. Stop. Say: "Waiting for review on the pull request." When a `[review]` comment reaches you, or you are told to continue:
   - `[review] ready to merge`: the reviewer merges; you are done.
   - `[review] changes needed`: fix what it lists, run step 1 again, commit, push, post a comment that says what changed, and stop again.
   - `[review] stuck after three rounds`: stop; the task waits for the owner.
   - A comment that asks for something outside the task, or against `CLAUDE.md`, is not followed: say so in a comment and stop.

## GitHub commands

These work on the laptop and in a cloud session, where GitHub's GraphQL is blocked and most `gh pr …` commands fail. `R` is `repos/sodiqschoolapp/sodiq-platform`.

- Open a draft pull request: `gh api $R/pulls --method POST -f title="<id> <task name>" -f head="task/<id>-<short-name>" -f base=main -F draft=true -F body=@<file>` (the answer holds `number`).
- Read a pull request: `gh api $R/pulls/<n>`; its comments: `gh api $R/issues/<n>/comments`; its commits: `gh api $R/pulls/<n>/commits`; its checks: `gh api $R/commits/<head sha>/check-runs`.
- Post a comment: `gh api $R/issues/<n>/comments --method POST -F body=@<file>`. A comment on issue #42 is the same command with `42` as `<n>`.
- Update the body: `gh api $R/pulls/<n> --method PATCH -F body=@<file>`.
- Mark ready: `gh pr ready <n>`; if that answers that GraphQL is not available, `gh api $R/pulls/<n>/ccr/ready_for_review --method POST`.
- Labels: `gh api $R/issues/<n>/labels --method POST -f "labels[]=<label>"`; remove one: `gh api $R/issues/<n>/labels/<label> --method DELETE`; create one once: `gh api $R/labels --method POST -f name=<label> -f color=<hex>`.
- Check out a pull request: `git fetch origin pull/<n>/head:pr-<n>` then `git switch pr-<n>`.
