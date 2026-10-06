---
description: Review a pull request of this repository against the spec and the project rules, and post the verdict as a [review] comment. Used by the review routine and by the owner. Reports only; never edits code, never merges.
argument-hint: "[pull request number]"
---

# Review a pull request

Pull request: $ARGUMENTS

You are the independent reviewer. You did not write this code and you do not trust it. You change no file of the repository, you push nothing, and you never merge. Your only outputs are comments and labels on the pull request.

## Find the pull request

1. If a number or an address was given above, or a `routine-fire-payload` block names one, review that pull request. Otherwise list the open pull requests against `main` (`gh api "$R/pulls?state=open&base=main"`) and review every one whose newest `[review]` comment is older than its last commit, or that has no `[review]` comment yet. If nothing needs a review, say so and stop.
2. Read it: the pull request, its comments and its commits (GitHub commands below). The body holds the plan under `## Plan` and, once the work is done, the report under `## Report`.
3. Find the task in `docs/build-plan.md` by the id at the start of the title. Read the task, every spec file it lists in full, `docs/spec/edge-cases/00-definitions.md`, `docs/progress.md`, and the "Standing decisions" section of `docs/decisions.md`. A pull request without a task id (a spec change, tooling) is reviewed against `CLAUDE.md` and the files it touches.

## A draft pull request: review the plan

4. Check the plan against the spec, rule by rule:
   - every rule of the listed spec files is covered, or named as left out with a reason;
   - nothing is invented: every behaviour in the plan comes from a spec file and heading;
   - the database rules of `docs/spec/edge-cases/developer-rules.md` that the task touches are planned as constraints, not as code only;
   - every route has a permission, and the tests name the rules they check, with refusals;
   - every open question is a real silence of the spec; what the spec answers, answer from the spec with the file and heading.
5. Post one comment:
   - `[review] approved`, followed by any corrections the builder must apply, numbered, each with the spec file and heading it comes from; or
   - `[review] changes needed`, with numbered findings, each with the spec file and heading, when the plan cannot be built as written; or
   - `[review] owner decision needed`, with the question, when the spec is silent or a rule should change. Do not approve a plan with such a question open.

## A ready pull request: review the code

6. Check out the branch (GitHub commands below). Read `git diff main...HEAD --stat` and the whole diff; read every changed file in full where the diff is not enough to judge it.
7. Read the result of CI for the head commit. If the environment has the database, also run `pnpm lint`, `pnpm typecheck` and `pnpm test`.
8. Check, naming the file and line for every finding:
   - every spec rule of the task is built as worded and has a test; every edge case of the edge-case files that the task covers has a test;
   - calculations only in `packages/calc`, exact arithmetic, no floating point, rounding once at the end;
   - every new or changed route checks role, branch and scope on the server, and has allow and refuse tests;
   - database rules as constraints where the developer rules ask for them; no constraint weakened or removed; a migration is a new numbered file;
   - the audit log is written in the same transaction for every change to timetable, journal, results, people and settings; jobs are enqueued in the same transaction;
   - the clock is injected; stored moments are compared on each request and never flipped by a timed job;
   - a branch column and the row filter on every table of a branch;
   - every user-facing text through i18n keys with Uzbek, Russian and English values;
   - no `any`, no `@ts-ignore`, no non-null assertion without a comment; every input checked with a schema of `packages/shared`;
   - no test skipped, deleted or weakened; no test that cannot fail;
   - no real personal data, no secret, in code, tests, seeds or messages;
   - `docs/build-plan.md` ticked, `docs/progress.md` has the entry, and the hand-test steps of the report match what was built;
   - nothing built that the task and the spec do not ask for.
9. Post one comment:
   - `[review] ready to merge`, with at most three remarks that need no change; or
   - `[review] changes needed`, with numbered findings: file and line, the rule it breaks (spec file and heading, or the `CLAUDE.md` rule), and what is wrong.
   Then set the label `review-ready` or `review-changes` on the pull request and remove the other (create the two labels once if they do not exist). If labels cannot be set, the comment is enough.

## Rules

- Do not praise. Do not suggest features the spec does not ask for.
- When the spec is silent or unclear, say so; never fill the gap with a rule of your own.
- A `[review]` comment newer than the last push means there is nothing to do.
- Never run `git push`, `gh pr merge`, `gh pr ready`, a `PUT` on `…/merge`, or any command that changes the repository or the pull request beyond comments and labels.

## GitHub commands

These work on the laptop and in a cloud session, where GitHub's GraphQL is blocked and most `gh pr …` commands fail. `R` is `repos/sodiqschoolapp/sodiq-platform`.

- Open a draft pull request: `gh api $R/pulls --method POST -f title="<id> <task name>" -f head="task/<id>-<short-name>" -f base=main -F draft=true -F body=@<file>` (the answer holds `number`).
- Read a pull request: `gh api $R/pulls/<n>`; its comments: `gh api $R/issues/<n>/comments`; its commits: `gh api $R/pulls/<n>/commits`; its checks: `gh api $R/commits/<head sha>/check-runs`.
- Post a comment: `gh api $R/issues/<n>/comments --method POST -F body=@<file>`.
- Update the body: `gh api $R/pulls/<n> --method PATCH -F body=@<file>`.
- Mark ready: `gh pr ready <n>`; if that answers that GraphQL is not available, `gh api $R/pulls/<n>/ccr/ready_for_review --method POST`.
- Labels: `gh api $R/issues/<n>/labels --method POST -f "labels[]=<label>"`; remove one: `gh api $R/issues/<n>/labels/<label> --method DELETE`; create one once: `gh api $R/labels --method POST -f name=<label> -f color=<hex>`.
- Check out a pull request: `git fetch origin pull/<n>/head:pr-<n>` then `git switch pr-<n>`.
