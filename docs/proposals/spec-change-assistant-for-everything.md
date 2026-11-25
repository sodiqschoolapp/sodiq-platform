# The assistant for everything: every action of the role, switches for the Super Admin, a map of the platform and fewer limits

Proposal of 25 November 2026, from the owner's request in chat: "we want it to be a super assistant". The spec edits are applied in this pull request; the owner's merge approves them. The build-plan edits (not spec) are in the same pull request: tasks 11.19 to 11.23, before the owner gate.

## Why

1. **It does too little.** Today the assistant has fixed lists: 166 of the Super Admin's 517 actions, 151 of the Academic Vice Principal's 421, and 24 of the Teacher's 100 (read from the code on 24 November 2026). The rest is closed, either by the spec's "never" list or because no task has opened it yet. The owner wants it to do as much as possible, and the Super Admin to decide what it may do.
2. **It knows too little.** It knows its own actions and the bare names of the menu pages. Asked "how do we do X" or "what is this button" about anything else, it guesses, and it may say the platform cannot do something it can.
3. **It is held back.** At most 6 reads and changes in one question, 10 changes in one proposal and 4 minutes; personal data never goes to the model. The owner wants fewer limits (owner, 25 November 2026: "forget about restricting student data").

## What changes

- **Every action of the chosen role**, reading and changing, in every part of the platform, the journal included, with exports prepared as a file and imports through their own preview. The assistant still has no rights of its own: it never does what the person could not do on a screen, and every change waits for Confirm.
- **Switches** on the Assistant settings page: for each role, every action grouped by area, on or off. Everything is on at the start except the heaviest areas: publishing a timetable, closing a quarter or a year and starting one, recalculating closed results, force delete, accounts, roles and appointments, and integration keys. These start off and take one click.
- **One floor no switch opens**: the model never sees a secret (passwords, one-time passwords, recovery codes, a key's secret, a session). The action still runs, and the person sees the secret once in the conversation.
- **Personal data goes to the model**, with a switch for each group (contact, identity, financial, diagnostic, medical, relatives). All are on at the start.
- **A map of the platform** generated from the app's code: every page, tab, button, field and column, what it does, which roles see it, in the three languages. The assistant answers "what is this", "where is X" and "how do we do X" with steps and a link to the exact place. It also knows the page and record the person has open.
- **Limits as settings**: none per day, 40 reads and changes in one question, 100 changes in one proposal, 10 minutes, all changeable. The monthly spending cap stays the one limit always in force. A long piece of work goes on with Continue.
- **Easier answers**: tables, choices as buttons, Undo of a confirmed proposal; files, photos and voice; helpers (the day's briefing, ranked substitutes, a unit of plans, why a result is what it is).

## Decided in this proposal (the owner confirms or changes them on the pull request)

- **Look first.** Personal data groups are **on** at the start, as the owner asked. The school already hosts outside Uzbekistan by its own decision (`13`, Hosting and data); data sent to the model is processed in Frankfurt, or through Google's worldwide endpoint when the fallback is on.
- **Look first.** The heavy areas listed above start **off**, so switching the assistant on does not at once let it publish a timetable or reset passwords. One click per area turns each on.
- **Look first.** The floor on secrets cannot be switched off: a password in the model's input is exposed to the provider with no gain, since the person sees it anyway.
- **Look first.** The journal is opened to the assistant. Every entry still goes through the journal's own action, with its edit window, locks and versions, and only on Confirm. Results are still calculated only by `packages/calc`.
- The defaults of the limits: no daily limit, 40, 100 and 10 minutes. The monthly cap stays at what the Super Admin set ($300 at the start).
- The order of the tasks: knowledge first (11.19), so the bigger lists of 11.20 meet a model that knows the platform; then the switches and every action (11.20), the limits and answers (11.21), files and voice (11.22) and the helpers (11.23).
- Not in this proposal (owner, 25 November 2026): exports run and downloaded by themselves, questions on a schedule, and feedback on answers.

## The spec edits (applied in this pull request)

- `docs/spec/02-roles-and-access.md`, Assistant: "Acting as the person" says it never does what the person could not do on a screen; "Reading and proposing" gains Undo; "What the Super Admin and the Academic Vice Principal can do through it", "What a Teacher can do through it", "Never through the assistant" and "What never goes to the model" become "What it can do", "Switches", "Never, whatever the switches" and "Personal data and the model"; new bullets "Knows the platform", "Knows where the person is", "Answers", "Files, photos and voice" and "Helpers"; "Limits" rewritten; the build-order row names the switches.
- `docs/spec/edge-cases/people-roles-accounts.md`, The assistant: the row "A Teacher asks the assistant to mark everyone present" now proposes the entries; eight rows added (an action switched off while a proposal waits, a password reset, an action the role cannot take, "what does this button do", "how do we", past the limit of one question, an attached Excel file, an export).
- `docs/spec/06-timetable.md`: "It never publishes a version" becomes publishing only where the Super Admin switched it on, and always as a proposal.
- `docs/spec/13-technology.md`, Security: the actions of the role switched on for it; secrets never go to the model and personal data goes as the switches allow.
