# Owner feedback of 27 November 2026: what the code does, and a proposed task for each item

Status: **findings only; nothing is built.** Each item below is its own task (one task per session and branch, `CLAUDE.md`). Items marked *spec* need a `/spec-change` first. Items marked *stop* touch the stop list for the live system (item 5: permissions; item 4: `packages/calc`). None of them touches `packages/calc`.

## 1. Printing one parent's slip prints the whole class — real

- **The page.** `apps/web/src/features/people/parent-slips-page.tsx`. Ticking one parent and choosing "Print again" sends only that id (`:205-218`). The header button "Print the slips" sends none (`:154`).
- **The cause is on the server.** `ParentAccounts.print` (`apps/api/src/modules/people/parent-accounts.service.ts:178-260`) loops over every relative of the class. It prints a new slip for everyone still "to print" (no account yet, or an expired first or reset password), and adds the ticked ones on top (`:219-234`).
- **So "one parent" prints that parent and every parent without a password.** The code does what decision `docs/decisions.md:1195` says. The spec (`edge/close-relatives`) does not say a single parent can be printed alone.
- **Fix.** The request gets `only: uuid[]`. When it is given, exactly those relatives are printed, whatever their state, and a relative who already signed in is still refused. The page sends it for a selection. Route tests: one id; another branch's id (404); a signed-in relative (409).
- *Spec:* one line in `edge/close-relatives`, "A slip can also be printed for chosen relatives only."

## 2. Password validity of 7 days everywhere — *spec*

| Password | Today | Source |
| --- | --- | --- |
| Staff first password, staff import, first account | 7 days | `edge/people-roles-accounts:43` |
| Staff re-hire | 7 days | decisions |
| **Admin reset of a staff password, and reset of the second step** | **24 hours** (`password-resets.service.ts:13`) | `edge/people-roles-accounts:36` "valid for 24 hours" |
| **Parent first password (class slips)** | **30 days** (`shared/parent-accounts.ts:11`) | `10`:38, `edge/close-relatives:17` |
| Parent reset | 7 days | `edge/close-relatives:18` |
| Email reset link | 60 minutes | a link, not a password |

**Proposed.** The 24-hour ones become 7 days. The text "valid for 24 hours" in `en.ts:4142, 4146` and in uz and ru changes with them.

**Question.** The parent first password is 30 days today. "7 days everywhere" would *shorten* it. Is that meant? Proposed: keep 30 for class slips, because they travel home with the child.

## 3. Easier passwords for parents — *spec, Look first (security)*

- **Today.** One generator (`accounts.service.ts:15-27`) gives everyone 16 characters of mixed case without look-alikes. The same generator also makes the two-step recovery codes (`two-step.service.ts:27`), so those must not change.
- **Proposed, for parents only.** 10 characters of lowercase letters and digits, without `0 o 1 l i`. They are printed in two groups of five (`k7m2p q9x4t`), and sign-in ignores the space and the letter case. That is about 49 bits; with the sign-in attempt limits (`13`) it cannot be guessed online. Staff keep 16 characters.

## 4. Journal numbering counts students who left — real

- `journal-grid.service.ts:947` numbers `index + 1` over every student of the quarter. Those who left or moved are sorted in with the rest (`:550`) and only drawn in the folded section afterwards.
- **Fix.** Number only the students shown in the main list, from 1. The folded "Left or moved" students get no number (a dash). Students in the folded "Exempt" section are still members and keep theirs. The export follows the screen.
- The spec (`07`:19, 35) is silent on this, so it is decided without the owner.

## 5. Archived records mixed with active ones

- **Slot types** (`slot-types-page.tsx:161-169`) and divisions, buildings, subjects, day templates, the calendar, classes, groups, plan masters and announcements: the state filter starts on "all".
- **Departments** have no list page. They are a table in the division panel (`division-panel.tsx:256-289`) with no filter at all.
- **Fix, one for all.** `ListPage` gets a default filter value. Every list with a state filter opens on "Active", and the page title shows "74 active · 6 archived" (`docs/design-system.md:179`), where the archived count opens the archived view. The department table hides archived rows behind "Show archived (n)".

## 6. Journals by teacher; teacher names as links — *stop item 5 only if a route's reach widens (it does not)*

- **Today.** The journals list row is `{id, unit, subject}` (`shared/journal.ts:36-43`), so there is no teacher to filter by. The journal header shows the teacher as plain text (`journal-page.tsx:386-390`), and so does the discipline page (`discipline-page.tsx:91-96`).
- **Fix.** Add the teacher (or teachers) to each journal list row, plus a Teacher filter. The list stays scoped exactly as today, with no new rights. The teacher's name becomes a link to the staff record, shown only when the reader may open staff records (the server says so in the answer). Otherwise it stays text.

## 7. Buttons that look like text — design

- The Journals page header holds up to eight `text-link`s (`journals-page.tsx:117-157`): absences, unlocks, exemptions, discipline, orphans, closing, exports, support. They read as text.
- **Proposed rule for `docs/design-system.md`.** A link inside a sentence stays a text link. A link that **goes to another page from a page header or a card** is a button-styled link (`buttonVariants({ variant: 'outline' })`) with an icon and a trailing chevron.
- **When a header has more than three.** The first two stay buttons, and the rest go under a "More" menu.
- **On the Journals page.** The eight links become a row of "Related pages" tiles: an icon, a name and a count where there is one, such as "Unlock requests · 3". It is the pattern of the home page tiles.
- The rule is added to `.claude/rules/web.md`, and every page header with such links is changed in one pass.

## 8. Assistant screen

| Problem | Cause | Fix |
| --- | --- | --- |
| No scroll to new messages | No scroll code in `assistant-chat.tsx` (`:280`) | Scroll to the end on a new message or a streamed part when the reader is already near the end; otherwise a "New messages ↓" button |
| Ctrl+V does not paste files | No `onPaste`; files come only through the paperclip (`assistant-files.tsx:81-149`) | `onPaste` on the text box passes `clipboardData.files` to the same `choose()`, with the same type and size checks |
| Long chat names overflow | `li > button > span.truncate` inside a grid with no `min-w-0` (`assistant-panel.tsx:220-231`, `assistant-page.tsx:114-126`) | `min-w-0` on the items, and the full name in a `title` |
| Long text is hidden in the input | Fixed at `rows={2}`, and `max-sm:h-11` pins it to 44 px on phones (`assistant-chat.tsx:367-380`) | Use the shared `Textarea` (`field-sizing-content`), growing up to about 40% of the screen, then scrolling |

## 9. Assistant cost — measure first, then cut

The assistant runs on **Gemini** (`gemini-3.5-flash` on Vertex AI, `config.ts:192-197`), not on Claude. What makes each question expensive:

1. **Up to 64 route tools are declared on every model call** (`MAX_DECLARED_ACTIONS`, `tools.ts:64`). At about 720 bytes each, that is about 45 KB, or roughly 11–12k tokens, before the conversation starts. Every read or action is another call that sends all of it again: up to "actions + 2" calls per question.
2. **No context caching** (`gemini-model.ts`). The system text holds today's date and the branch (`assistant.engine.ts:626-631`), and the tool list is rebuilt in a changing order, so the prefix is never the same twice and Gemini's implicit caching cannot hit.
3. **Reads go to the wrong pages.** `find_actions` scores routes by keywords over descriptions in three languages and returns the top 12 (`tools.ts:61, 623-665`). "Subject" matches the staff and student lists, because their descriptions mention subjects, and the model then reads them. Each read can be up to 20,000 characters (`assistant.engine.ts:171`), and the 20 messages of history carry the reads forward.

**Proposed task, in this order:**

1. **Measure.** Log the tokens of each call: prompt, cached, tool declarations, reads and output. Read them from the answer's usage, not a guess. Show the cost of each question on the Assistant settings page. A "$1 for 3–4 messages" figure then has a breakdown.
2. **A stable prefix.** Fixed system text, with the date and branch moved into the first user turn. Tools in a fixed order. Explicit Gemini context caching for the system text and the always-on tools.
3. **Fewer tools.** Declare only what `find_actions` found for this question, plus the page's own routes: 16 at most instead of 64.
4. **Reads with a purpose.**
   - `find_actions` ranks a route by its main record (a subjects question finds the subject routes first) and drops routes whose only match is a word in a field list.
   - Every read tool takes a required `purpose` and the fields it needs; the answer gives only those fields.
   - Reads already in the history are summarised to their used figures after the turn.
5. **The test of the change.** The existing assistant question set is run before and after: the same answers and proposals, at a lower token count.

*Spec:* `02`, Assistant, says nothing on these internals; no change is needed, unless the cost page is added to the settings, which needs one line.
