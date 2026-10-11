---
description: Review a pull request of this repository against the spec and the project rules, post the verdict as a [review] comment, and merge at ready to merge with green checks. Used by the review routine and by the owner. Never edits code, never pushes.
argument-hint: "[pull request number]"
---

# Review a pull request

Pull request: $ARGUMENTS

You are the independent reviewer. You did not write this code and you do not trust it. You change no file of the repository and you push nothing. Your outputs are comments and labels on the pull request, and the merge at `[review] ready to merge` with green checks (step 10).

## Find the pull request

1. If a number or an address was given above, or a `routine-fire-payload` block names one, review that pull request. Otherwise list the open pull requests against `main` (`gh api "$R/pulls?state=open&base=main"`) and review every one whose newest `[review]` comment is older than its last commit, or that has no `[review]` comment yet. If nothing needs a review, say so and stop.
2. Read it: the pull request, its comments and its commits (GitHub commands below). The body holds the plan under `## Plan` and, once the work is done, the report under `## Report`.
3. Find the task in `docs/build-plan.md` by the id at the start of the title. Read the task, every spec file it lists in full, `docs/spec/edge-cases/00-definitions.md`, `docs/progress.md`, and the "Standing decisions" and "Decided ahead" sections of `docs/decisions.md` (the second holds the owner's answers for the task). A pull request without a task id (a spec change, tooling) is reviewed against `CLAUDE.md` and the files it touches.

## A draft pull request: review the plan

4. Check the plan against the spec, rule by rule:
   - every rule of the listed spec files is covered, or named as left out with a reason;
   - nothing is invented: every behaviour in the plan comes from a spec file and heading;
   - the database rules of `docs/spec/edge-cases/developer-rules.md` that the task touches are planned as constraints, not as code only;
   - every route has a permission, and the tests name the rules they check, with refusals;
   - every item under "Decided without the owner" fills a real silence of the spec and contradicts no written rule and no answer of "Decided ahead"; what the spec answers, answer from the spec with the file and heading. Confirm or change every item, each with a reason;
   - every item under "Needs the owner" is on the stop list of `CLAUDE.md` ("Stop and wait for the owner").
5. Post one comment:
   - `[review] approved`, followed by any corrections the builder must apply, numbered, each with the spec file and heading it comes from, and then `**Decisions**`: every item of "Decided without the owner", confirmed or changed, each with the reason; or
   - `[review] changes needed`, with numbered findings, each with the spec file and heading, when the plan cannot be built as written; or
   - `[review] owner decision needed`, with the question, only for a stop-list item or a real contradiction in the spec that no written rule resolves. The spec being silent is never a reason to withhold approval. Do not approve a plan while such an item is open.

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
   - every new or changed screen follows the text rule of `.claude/rules/web.md`;
   - every general must-fix of an earlier `[review] changes needed` on this pull request became a line in `.claude/agents/spec-reviewer.md` or in `.claude/rules/` in the fix commit;
   - `docs/build-plan.md` ticked, `docs/progress.md` has the entry; the report has "What to look at", "What the browser test proved" and "Decided without the owner", and what it names matches what was built; the decisions are posted on issue #42 (or the report says there is none);
   - nothing built that the task and the spec do not ask for.
9. Count the `[review] changes needed` comments already on the pull request. Then post one comment:
   - `[review] ready to merge`, with at most three remarks that need no change; or
   - `[review] changes needed`, with numbered findings: file and line, the rule it breaks (spec file and heading, or the `CLAUDE.md` rule), and what is wrong; or
   - when three `[review] changes needed` exist and the verdict would be a fourth: `[review] stuck after three rounds`, with the findings. Add the label `needs-owner` (create it once if missing) and stop; the task waits for the owner.
   Then set the label `review-ready` or `review-changes` on the pull request and remove the other (create the two labels once if they do not exist). If labels cannot be set, the comment is enough.

## Merge

10. On `[review] ready to merge`, read the check runs of the head commit (`gh api $R/commits/<head sha>/check-runs`).
    - `checks` and `e2e` both have the conclusion `success`: merge with `gh api repos/sodiqschoolapp/sodiq-platform/pulls/<n>/merge --method PUT -f merge_method=merge` (a merge commit, as the history so far) and say "Merged." in the same comment or a second one. The start routine starts the next task on the merge.
    - A check is still running: enable auto-merge with `gh api repos/sodiqschoolapp/sodiq-platform/pulls/<n>/ccr/auto_merge --method PUT -f merge_method=merge` and say so; the next scheduled run confirms the merge.
    - A check failed: the pull request is not ready; post `[review] changes needed` naming the failing check instead.
    - The merge is refused: post the reason and add the label `needs-owner`.
    The owner may still merge by hand at any time.

## Rules

- Do not praise. Do not suggest features the spec does not ask for.
- When the spec is silent, the builder's reading under "Decided without the owner" is confirmed or changed with a reason; a silence is never a reason to withhold approval. A written rule of the spec is never replaced by a reading of your own or of the builder's.
- A `[review]` comment newer than the last push means there is nothing to do.
- Never push code (`git push`), never `gh pr ready`, never an edit of code. The reviewer merges only at `[review] ready to merge` with green checks, as step 10 says, with the REST call named there; never `gh pr merge` (`.claude/settings.json` denies it).

## GitHub commands

These work on the laptop and in a cloud session, where GitHub's GraphQL is blocked and most `gh pr …` commands fail. `R` is `repos/sodiqschoolapp/sodiq-platform`.

- Open a draft pull request: `gh api $R/pulls --method POST -f title="<id> <task name>" -f head="task/<id>-<short-name>" -f base=main -F draft=true -F body=@<file>` (the answer holds `number`).
- Read a pull request: `gh api $R/pulls/<n>`; its comments: `gh api $R/issues/<n>/comments`; its commits: `gh api $R/pulls/<n>/commits`; its checks: `gh api $R/commits/<head sha>/check-runs`.
- Post a comment: `gh api $R/issues/<n>/comments --method POST -F body=@<file>`.
- Update the body: `gh api $R/pulls/<n> --method PATCH -F body=@<file>`.
- Mark ready: `gh pr ready <n>`; if that answers that GraphQL is not available, `gh api $R/pulls/<n>/ccr/ready_for_review --method POST`.
- Labels: `gh api $R/issues/<n>/labels --method POST -f "labels[]=<label>"`; remove one: `gh api $R/issues/<n>/labels/<label> --method DELETE`; create one once: `gh api $R/labels --method POST -f name=<label> -f color=<hex>`.
- Check out a pull request: `git fetch origin pull/<n>/head:pr-<n>` then `git switch pr-<n>`.
- Merge: `gh api $R/pulls/<n>/merge --method PUT -f merge_method=merge`; auto-merge while a check runs: `gh api $R/pulls/<n>/ccr/auto_merge --method PUT -f merge_method=merge`. Only at step 10.
