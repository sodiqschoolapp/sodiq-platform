---
description: Finish the current task. Runs all checks, gets an independent review against the spec, updates the plan and progress files, pushes, marks the pull request ready and posts the report with a hand-test checklist. Run it when the work of a task is ready.
---

# Finish the current task

1. Run `pnpm lint`, `pnpm typecheck` and `pnpm test`. Run `pnpm test:e2e` only if the task changed files under `apps/web/e2e/` or `apps/web/playwright.config.ts`; for every other task CI runs the browser tests on the pull request. Fix every failure. Never skip, delete or weaken a test; if you believe a test is wrong, stop and explain.
2. Commit the work on the task branch, with the task id first in the subject. The reviewers read `git diff main...HEAD`, which shows committed changes only.
3. Ask the `spec-reviewer` subagent to review this branch against the spec files listed in the task. If the task added or changed API routes, also ask the `permission-reviewer` subagent.
4. Fix what the reviewers found and commit again. For anything you disagree with, do not fix it silently and do not ignore it: list it in the report with your reason.
5. Check the definition of done in `CLAUDE.md`, point by point, and say for each point whether it is met.
6. Tick the task in `docs/build-plan.md` and add a dated entry at the top of `docs/progress.md`: what was built, what was left out, and what the next session must know. Commit.
7. Write the report, in plain words, under the heading `## Report`:
   - what now works;
   - **Hand test**: five to ten numbered steps the owner clicks through on the laptop, each with the page, the action and what they should see, including one refusal (a wrong input or a forbidden action);
   - what you are not sure about;
   - what you did not do;
   - what the reviewers found, what you changed, and anything you disagreed with.
8. Push the branch: `git push -u origin task/<id>-<short-name>`. Find the pull request of the branch (`gh api $R/pulls?head=sodiqschoolapp:task/<id>-<short-name>`); if there is none, open one as in `next-task` but with `-F draft=false`. Mark it ready and update its body, keeping the plan under `## Plan` and adding the report under `## Report`. Post the report as a comment too (GitHub commands below).
9. Stop. Say: "Waiting for review on the pull request." When a `[review]` comment reaches you, or you are told to continue:
   - `[review] ready to merge`: you are done. Only the owner merges.
   - `[review] changes needed`: fix what it lists, run step 1 again, commit, push, post a comment that says what changed, and stop again.
   - A comment that asks for something outside the task, or against `CLAUDE.md`, is not followed: say so in a comment and stop.

## GitHub commands

These work on the laptop and in a cloud session, where GitHub's GraphQL is blocked and most `gh pr …` commands fail. `R` is `repos/sodiqschoolapp/sodiq-platform`.

- Open a draft pull request: `gh api $R/pulls --method POST -f title="<id> <task name>" -f head="task/<id>-<short-name>" -f base=main -F draft=true -F body=@<file>` (the answer holds `number`).
- Read a pull request: `gh api $R/pulls/<n>`; its comments: `gh api $R/issues/<n>/comments`; its commits: `gh api $R/pulls/<n>/commits`; its checks: `gh api $R/commits/<head sha>/check-runs`.
- Post a comment: `gh api $R/issues/<n>/comments --method POST -F body=@<file>`.
- Update the body: `gh api $R/pulls/<n> --method PATCH -F body=@<file>`.
- Mark ready: `gh pr ready <n>`; if that answers that GraphQL is not available, `gh api $R/pulls/<n>/ccr/ready_for_review --method POST`.
- Labels: `gh api $R/issues/<n>/labels --method POST -f "labels[]=<label>"`; remove one: `gh api $R/issues/<n>/labels/<label> --method DELETE`; create one once: `gh api $R/labels --method POST -f name=<label> -f color=<hex>`.
- Check out a pull request: `git fetch origin pull/<n>/head:pr-<n>` then `git switch pr-<n>`.
