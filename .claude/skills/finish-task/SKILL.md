---
description: Finish the current task. Runs all checks, gets an independent review against the spec, updates the plan and progress files, and opens a pull request.
disable-model-invocation: true
---

# Finish the current task

1. Run `pnpm lint`, `pnpm typecheck` and `pnpm test`. If the task touched screens, also run `pnpm test:e2e`. Fix every failure. Never skip, delete or weaken a test; if you believe a test is wrong, stop and explain.
2. Commit the work on the task branch, with the task id first in the subject. The reviewers read `git diff main...HEAD`, which shows committed changes only.
3. Ask the `spec-reviewer` subagent to review this branch against the spec files listed in the task. If the task added or changed API routes, also ask the `permission-reviewer` subagent.
4. Fix what the reviewers found and commit again. For anything you disagree with, do not fix it silently and do not ignore it: list it for the owner with your reason.
5. Check the definition of done in `CLAUDE.md`, point by point, and say for each point whether it is met.
6. Tick the task in `docs/build-plan.md` and add a dated entry at the top of `docs/progress.md`: what was built, what was left out, and what the next session must know. Commit.
7. Tell the owner, in plain words:
   - what now works and how to try it by hand;
   - what you are not sure about;
   - what you did not do.
8. Ask before pushing. After approval, push the branch and open a pull request with `gh pr create`, using the summary from step 7 as the description.
