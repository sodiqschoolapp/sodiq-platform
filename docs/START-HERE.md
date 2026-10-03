# Start here

A short version of the owner's guide. The full guide is the "Build guide" tab of the spec document.

## Once

1. Buy: a Claude plan that includes Claude Code (Max recommended for daily work) and a GitHub organisation on the Team plan. Nothing else is paid before task 0.10.
2. Install on Windows: Git (`winget install Git.Git`), Node.js LTS (`winget install OpenJS.NodeJS.LTS`), pnpm (`npm install -g pnpm`), PostgreSQL (installer from postgresql.org), GitHub CLI (`winget install GitHub.cli`, then `gh auth login`), and the Claude desktop app. A Java JDK 21 or newer is needed only before task 5.10. Docker is not needed.
3. Create an empty private repository on GitHub, clone it, copy this pack into it so that `CLAUDE.md` is at the top level, then:

```
git branch -M main
git add .
git commit -m "Add spec and Claude Code starter pack"
git push -u origin main
```

4. Open the folder in the Claude desktop app, Code tab. Ask which project instructions, skills and subagents it sees; it should name `CLAUDE.md`, four skills and two reviewers.

## For every task

1. New session. Plan mode on. Type `/next-task` (or `/next-task 0.1` for the first one).
2. Read the plan. Check database changes, permissions per route and the list of tests. Correct or approve.
3. Let it build. Then try the result by hand as the roles involved.
4. Type `/finish-task`. It runs the checks, has two reviewers read the changes against the spec, updates `docs/build-plan.md` and `docs/progress.md`, and asks before it pushes and opens a pull request.
5. Merge when the checks on GitHub are green and you have read the pull request. After task 0.3, protect `main` in the GitHub settings: require a pull request and the checks.

## Always

- One task per session. Start a new session for the next task.
- Read every change to `db/migrations`, `packages/calc` and the permission table yourself.
- Stop Claude Code if it skips or weakens a test, edits `docs/spec/` without `/spec-change`, or adds a library without asking.
- When a rule must change: `/spec-change <what and why>`.
- At the end of a phase: `/spec-check <module>`, then show the result to the Academic Vice Principal.
- Never put real names, phones or document numbers into the repository or a chat. Replace them first.
- Secrets go into provider dashboards and local `.env` files only. Claude Code is not allowed to read `.env` files.

## To prepare from the school

- The decision on question 12 (UID prefix and staff ID format), before task 2.4.
- Branches, rooms, calendar, lesson and break lengths, travel time between branches, for Phase 1.
- Subjects with weights per quarter, Head Teacher appointments, staff with branches and languages, for Phase 2.
- Five to ten journals from last year with names replaced and results checked by hand, for task 4.2.
- One branch's teaching load and teacher availability with names replaced, for task 5.10.
- A bank card that works for payments in USD abroad, for task 0.10.

More prompts to copy: `docs/prompts.md`.
