---
description: Change a rule in the spec with the owner's approval, log the change, and list the code and tests it affects. Use when the owner decides the product should behave differently from docs/spec.
argument-hint: "[what should change]"
disable-model-invocation: true
---

# Change the spec

Requested change: $ARGUMENTS

1. Find every place in `docs/spec/` that states the rule being changed, including edge-case files. Quote each one with its file and heading.
2. Look for side effects: other rules, database constraints, calculations or screens that depend on it. Say what could go wrong.
3. Show the owner the exact new wording for each place. Wait for approval. Do not edit before approval.
4. After approval, edit the spec files so that no old wording remains anywhere.
5. Add an entry to `docs/spec-changes.md`: date, what changed, why, and the files touched.
6. List the code and tests that must change. If the change belongs to a task that is not built yet, stop here. Otherwise propose a plan for the code change and wait for approval.
