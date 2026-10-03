---
description: Compare what is built for one module with its spec files and report every gap. Reports only; changes nothing.
argument-hint: "[module, for example journal or timetable]"
disable-model-invocation: true
---

# Check a module against the spec

Module: $ARGUMENTS

1. Use the reading lists in `docs/spec/00-index.md` to find the spec files for this module. Read them in full.
2. Read the code and the tests of the module.
3. Report a table with one row per rule in the spec: the rule (with file and heading), whether it is implemented, whether a test covers it, and where in the code it lives.
4. List separately: behaviour in the code that the spec does not ask for, and tests that were skipped or weakened.
5. Do not edit any file. End with the three gaps you would fix first.
