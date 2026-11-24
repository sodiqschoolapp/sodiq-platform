# The assistant: Frankfurt first with a worldwide fallback, a page of its own, and answers that show while they are written

Proposal of 24 November 2026, approved and applied the same day with one addition (the Limits bullet of `02` names the Assistant page beside the panel), from the owner's first hand test of the assistant on the test environment (23 and 24 November 2026, in chat). Apply each section with `/spec-change`, one commit per section, in this order. Where a sentence is quoted as "old", replace it word for word. The build-plan edits (not spec) are in the same pull request: task 11.15 is extended and task 11.16 is added.

## Why

1. **Frankfurt alone is not enough.** On Vertex AI a model's capacity in a region is shared by all its users. On 23 November Frankfurt answered 429 "resource exhausted" for every request, even one word, for most of a morning. Of the EU regions tested on 24 November, only Frankfurt serves `gemini-3.5-flash`, so there is no other EU region to fall back to. Google's worldwide ("global") endpoint has far more capacity and every current Gemini model, but there Google chooses the country that processes each request.
2. **The owner's choice (24 November 2026, in chat): the middle way.** Frankfurt first. Only when Frankfurt does not answer after its retries does the same request go once through the worldwide endpoint. The Super Admin can switch the fallback off, for example if the lawyer advises against it.
3. **Waiting with nothing to see irritates users.** Today a sent question shows only when the whole answer is ready, which can take half a minute. Until then the box stays filled and the Send button spins. The owner asks that the question show at once and the answer show as it comes.
4. **A page of its own.** The owner asks that the chat also open as a full page, not only as the panel.

## Decided in this proposal (the owner confirms or changes them)

- **The fallback is on until the Super Admin switches it off,** following the owner's choice of the middle way. Settings show how many questions of the month went through the worldwide endpoint.
- **The same model in both places** (`gemini-3.5-flash` today), so an answer does not change with where it was processed.
- **The page is for the same three roles,** with the `assistant` view right they already have. No new right.

---

## 1. `docs/spec/02-roles-and-access.md`, section "Assistant"

First paragraph, old: "It uses an outside language model, Google Gemini, on a paid plan (owner, 21 November 2026)."
New: "It uses an outside language model, Google Gemini, on a paid plan (owner, 21 November 2026), in Frankfurt first (owner, 24 November 2026; Where the model runs, below)."

Bullet "Where", old: "- **Where.** A button in the top bar opens a chat panel beside the page; on a phone it fills the screen. The panel answers in the person's language."
New: "- **Where.** A button in the top bar opens a chat panel beside the page; on a phone it fills the screen. The same conversations also open on a page of their own, Assistant, in the menu of the three roles, with the person's conversations listed beside the chat; the panel links to it. The assistant answers in the person's language."

Add this bullet after the bullet "Where":

- **While it works.** A question shows in the conversation the moment it is sent, and the box is empty again. The conversation shows what the assistant is reading as it reads it, and the answer as it is written. The person can go on with other work: closing the panel or leaving the page loses nothing, and the answer is in the conversation when it is opened again.

Add this bullet after the bullet "What never goes to the model":

- **Where the model runs.** Each request goes first to the model in Frankfurt. When Frankfurt is busy or does not answer, the platform waits and tries again. Only when it still does not answer does the same request go once through Google's worldwide endpoint, where Google chooses the country that processes it. The Super Admin can switch this fallback off; it is on until switched off (owner, 24 November 2026). Each answer records whether it was processed in Frankfurt or through the worldwide endpoint, and the Settings show how many questions of the month used the fallback.

## 2. `docs/spec/edge-cases/people-roles-accounts.md`, section "The assistant"

Add these rows at the end of the table:

| Case | Rule |
| --- | --- |
| Frankfurt is busy at 09:00, when many teachers ask at once. | The platform waits and tries Frankfurt again, at most twice. Then it sends the same request once through the worldwide endpoint, unless the Super Admin switched the fallback off. Only when that fails too does the panel say the model is busy and to try again in a minute. |
| The Super Admin switches the fallback off. | From the next question every request goes to Frankfurt only. A busy Frankfurt then ends in the "busy" message after its retries. Answers given earlier keep the record of where they were processed. |
| A person closes the panel while the assistant is still working. | The work goes on. The answer, or the proposal, is stored in the conversation and shows when the panel or the Assistant page is opened again. Nothing is asked twice. |
| The same conversation is open in the panel and on the Assistant page, or in two tabs. | Both show the same messages, and a question sent in one shows in the other. A second question sent while the first is still being answered is refused with a short message; it is never lost or asked twice. |

## 3. `docs/spec/13-technology.md`

Section "Hosting and data": add this bullet after the bullet that starts "Hosting is outside Uzbekistan, in Frankfurt":

- [ ] The assistant's language model runs in Frankfurt. When Frankfurt does not answer, a question may be processed through Google's worldwide endpoint, in a country Google chooses, unless the Super Admin switched that off (`02`, Assistant, Where the model runs).

Section "Running cost", row "Google Gemini API", second column, old: "Paid plan, pay per use, Frankfurt region where the model is offered; the model chosen by the test of the first assistant task"
New: "Paid plan, pay per use, Frankfurt region where the model is offered, Google's worldwide endpoint only when Frankfurt does not answer; the model chosen by the test of the first assistant task"

---

## Build-plan edits (not spec)

Task 11.15 is extended with the fallback and the choice of model, and task 11.16 is added after it, above the gate of 15 November.
