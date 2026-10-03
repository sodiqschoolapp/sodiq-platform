# Prompts to copy

Short prompts for the usual moments. The skills in `.claude/skills/` do most of the work; these are for the rest.

## First session, after copying the starter pack

```
/next-task 0.1
```

## Start of every session

```
/next-task
```

Or name the task: `/next-task 5.2`.

## After reading the plan

Approve: `The plan is approved. Start.`

Correct: `Change the plan: <what>. The spec says <quote> in <file>. Show the plan again.`

## While it works

- `Stop. Explain what you are doing and why, before you continue.`
- `That is not what the spec says. Read <file>, section <heading>, again and quote the rule before you change anything.`
- `Do not change that test. Explain why it fails.`
- `You added a library. Remove it or tell me why it is needed and what the alternatives are.`

## When something is broken

```
There is a bug: <what I did, what I expected, what happened>.
First write a test that fails because of this bug. Show it to me. Then fix the code until it passes.
```

## Before finishing

```
/finish-task
```

Then ask: `What are you least sure about in this task? What did you not test?`

## Checking a whole module later

```
/spec-check journal
```

## Changing a rule

```
/spec-change <what should change and why>
```

## When a session got long or confused

```
Write where you stopped into docs/progress.md: what is done, what is half-done, what to do next. Then stop.
```

Start a new session and run `/next-task` with the same task id.

## Looking at a screen

```
Run the app, open <page> as a <role>, take a screenshot and compare it with docs/spec/12-ux-standards.md. List what does not match.
```
