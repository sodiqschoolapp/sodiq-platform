---
description: Finish the current task. Runs the checks, gets an independent review against the spec, updates the plan and progress files, pushes, posts the report (what to look at, what the browser test proved, the decisions made without the owner) and then marks the pull request ready. Run it when the work of a task is ready.
---

# Finish the current task

1. Run `pnpm format` first (the root script, `prettier --write .`, with `.prettierignore` applied: the hook sees only the Edit and Write tools, not what a shell command wrote), then `pnpm lint`, `pnpm typecheck` and `pnpm test:changed`. Run `pnpm test:e2e` only if the task changed files under `apps/web/e2e/` or `apps/web/playwright.config.ts`; for every other task CI runs the browser tests on the pull request. The full `pnpm test` is not run locally: CI runs it on the pull request and is the gate, and a red CI is fixed before a review is asked for. Every test run writes its output to a file in the scratchpad (`pnpm test:changed > <scratchpad>/test-changed.txt 2>&1`) and you read the summary from the file. Fix every failure. Never skip, delete or weaken a test; if you believe a test is wrong, stop and explain.
2. Commit the work on the task branch, with the task id first in the subject. The reviewers read `git diff main...HEAD`, which shows committed changes only.
3. Ask the `spec-reviewer` subagent to review this branch against the spec files listed in the task. If the task added or changed API routes, also ask the `permission-reviewer` subagent.
4. Fix what the reviewers found and commit again. Every must-fix that is a general pattern (something another task could do again) becomes a line in `.claude/agents/spec-reviewer.md` or in `.claude/rules/` in the same commit, so the same thing is never found twice. For anything you disagree with, do not fix it silently and do not ignore it: list it in the report with your reason.
5. Check the definition of done in `CLAUDE.md`, point by point, and say for each point whether it is met.
6. Tick the task in `docs/build-plan.md` and add a dated entry at the top of `docs/progress.md`, at most 15 lines: three lines on what was built, the left-out items each with the task that brings it, and "The next sessions must know". The inventory of files lives in the pull request body, not here. Commit.
7. Write the report, in plain words, under the heading `## Report`:
   - what now works;
   - **What to look at**: three to five things only a person can judge (the wording in the three languages, how the screen reads, anything missing), each with the page to open; the owner looks at them on the test environment after the merge;
   - **What the browser test proved**: one line;
   - **Decided without the owner**: every decision of the plan as the reviewer confirmed or changed it, plus any taken during the build, in the form of issue #42;
   - what you are not sure about;
   - what you did not do;
   - what the reviewers found, what you changed, and anything you disagreed with.
8. Publish in this order, and mark the pull request ready last: marking it ready starts the review at once, so everything the review reads must be there before it (GitHub commands below).
   1. Push the branch: `git push -u origin task/<id>-<short-name>`.
   2. Find the pull request of the branch (`gh api $R/pulls?head=sodiqschoolapp:task/<id>-<short-name>`); if there is none, open one as in `next-task`, as a draft.
   3. Update its body, keeping the plan under `## Plan` and adding the report under `## Report`.
   4. Post the report as a comment too.
   5. Post the task's decisions as one comment on issue #42, in the form that issue gives (`Task <id> — pull request #<n>`, then one numbered item per decision: the question, `Decided:`, `Because:`, `Recorded in:`; when there is none, the one line "No decisions without the owner."), ending with the line `Migrations: <file names>` or `Migrations: none`, so that the owner sees every migration.
   6. Post a comment "Texts to read" on the pull request with every new or changed Uzbek and Russian text, one line per key (`key → words`), taken from `git diff main...HEAD -- apps/web/src/i18n/locales/uz.ts apps/web/src/i18n/locales/ru.ts`; when the two files did not change, post nothing and say so in the report.
   7. Only now mark the pull request ready.
9. Stop. Say: "Waiting for review on the pull request." When a `[review]` comment reaches you, or you are told to continue:
   - `[review] ready to merge`: the reviewer merges; you are done.
   - `[review] changes needed`: first post one line, "Acting on the review." (the start routine resumes a task that shows no reaction 30 minutes after a review), then fix what it lists, run step 1 again, commit, push, post a comment that says what changed, and stop again.
   - `[review] stuck after three rounds`: stop; the task waits for the owner.
   - CI red on your own push (the bound pull request wakes you with the failure; otherwise read `gh api $R/commits/<head sha>/check-runs`): fix it, run step 1 again, commit, push, and stop again. After the third red CI run in a row on your pushes, post a comment that starts with `@abbosc` saying what fails, add the label `needs-owner`, and stop; the task waits for the owner.
   - The failing step is "Audit the production dependencies" and the pull request added no dependency: when a patched version exists within the range the dependent package already allows, update to it with `pnpm update --no-save <name>` (it changes `pnpm-lock.yaml` only; without `--no-save`, pnpm writes new ranges into `package.json`), run `pnpm audit --prod --audit-level=high` again, and say so in the report. When no patched version exists, post a comment that starts with `@abbosc` and names the advisory, add the label `needs-owner`, and stop. Never lower `--audit-level` and never ignore the advisory: either is a change under `.github/`, which the review refuses.
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
