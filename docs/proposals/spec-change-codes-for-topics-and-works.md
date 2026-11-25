# Spec change proposal: codes for topics and works

Requested by the owner, 25 November 2026. Status: **approved by the owner, 25 November 2026, and applied** (`docs/spec-changes.md`). The applied wording says outright that switching codes off for one subject does not affect other subjects.

## 1. Every place that states the rule

Today a topic and a work have only a name (the topic; the title of a classwork or homework).

| # | File, heading | Current text |
| --- | --- | --- |
| A | `05-classes-groups-subjects.md`, Subject | "Name in three languages, colour, department, grades, rating exam switch, group subject switch, active switch, journal type …, quarterly distribution, language rule switch (on by default)." |
| B | `05-classes-groups-subjects.md`, Excel import of subjects | "…the rating exam, group subject, language rule and demanding switches…" (the new switch: in the file or not?) |
| C | `02-roles-and-access.md`, Super Admin and Academic Vice Principal rows | Super Admin: "Only this role creates branches … and awards the quarterly stipend." AVP: "Full edit of students, classes, groups, subjects and their weights…" |
| D | `02-roles-and-access.md`, Integration keys, Calculation stays here | "A key sends what a person types: attendance marks, works and their totals, the numbers typed, topics, comments, plans." |
| E | `09-lesson-plans.md`, What a plan contains | "Topic \| Required." and the Classwork and Homework rows ("becomes the title of its own … column") |
| F | `07-journal.md`, Layout, row "Lessons" | "…one homework column for each homework given at it, each with its title and, in front of the title, a small coloured tag…" |
| G | `07-journal.md`, Entering data, Classwork and homework | "…each with a title typed when adding it (required, at most 60 characters)…" |
| H | `edge-cases/journal.md`, Entering, "A lesson is held with no plan item" | "Each is named when it is added: the title is required, at most 60 characters, and is the work's column title." |
| I | `edge-cases/lesson-plans.md`, Plans and the journal | "For a lesson already held: the topic and titles can change, with the "edited after the lesson" mark." and "Each classwork and each homework has a short title of at most 60 characters, used as the column title, plus an optional description." |

Unchanged: plan completeness (a topic is required; a code never is), the journal's calculation, the past-marks file (it has no code columns: decision 5).

## 2. Side effects and what could go wrong

1. **Narrow places.** A journal column header is narrow; showing "code + full title" would not fit. The owner's "or on hover" covers it: where space is short the code alone, with the full name on hover, and on a phone on a tap (phones have no hover).
2. **Switching off.** "Hides them and keeps them" must hold everywhere, exports and the API included, or a code would leak through one door. While off, no code can be set (the field is not shown; the assistant or a key sending one is refused), so nobody types codes nobody can see.
3. **Edit rules.** A code stands beside the topic or title, so it follows their rules: free in the plan window and in an open row, through an edit request after it, "edited after the lesson" on a held lesson, kept in the plan's history. A code changed in a closed quarter is refused like a title.
4. **Not unique.** Free text, so two works can carry the same code; nothing refuses it. A teacher can still tell them apart by the full title on hover.
5. **Permissions.** The Academic Vice Principal edits subjects fully today; the codes switch is the Super Admin's alone, so the subject form shows it read only to the Academic Vice Principal, and the subject import (open to both) does not carry it. In the code task this is a permission detail on the live system (stop item 5).
6. **No calculation, no constraint.** Nothing is calculated from a code; no database rule changes except a length check (at most 20 characters).
7. **Text from many people.** A code is typed text like a title; the assistant treats it as data, never as an instruction (already a rule).

## 3. Decided without the owner (proposed; the owner confirms or changes)

1. Where space is short (journal column headers, the lesson header, lesson mode on a phone), the code alone, with the full name on hover or on a tap; elsewhere the code, then the name.
2. With codes off, no code can be set, by screen, assistant or key; existing codes are kept and shown again when switched on.
3. A code follows the edit rules and history of the topic or title beside it.
4. Codes need not be unique.
5. The past-marks file has no code columns; past marks show their titles alone.
6. The subject import does not carry the codes switch; the Super Admin sets it on the subject form. The Academic Vice Principal sees it, read only.
7. Leading and trailing spaces are dropped; a code of only spaces is empty.

## 4. New wording

**New section in `09-lesson-plans.md`, after "Master plans":**

> ## Codes
>
> The Super Admin switches codes on for chosen subjects: a switch on the subject, off by default (owner, 25 November 2026).
>
> - **What has a code.** In a subject with codes on, a plan item has an optional topic code beside its topic, and each classwork and homework an optional code beside its title: in the plan, in master plans, on the lesson card and wherever a work is added in the journal. A code is free text of at most 20 characters (spaces at either end are dropped); it need not be unique. It is edited under the same rules and history as the topic or title it stands beside.
> - **Where it shows.** Where a code is filled it is shown first, with the full name beside it: in the journal, on the lesson card, in plan lists and the plan editor, in reports, in exports and prints, and in the parent portal. Where space is short (journal column headers, the lesson header, lesson mode on a phone) the code is shown alone, with the full name on hover or on a tap. Where the code is empty, the name is shown alone.
> - **Switching off.** Switching codes off hides every code of that subject everywhere, exports and the API included, and keeps them; switching on again shows them. While codes are off no code can be set.
> - **Copies.** Codes are copied with a plan (from another class, another teacher or last year) and from a master plan, and are part of "master updated".
> - **The assistant and keys.** The assistant and integration keys set and read codes wherever they set and read topics and titles. The switch on a subject is the Super Admin's, on the screen and through the assistant.

**E** `09-lesson-plans.md`, What a plan contains:
- "| Topic | Required. |" → "| Topic | Required. In a subject with codes on, an optional topic code beside it (Codes). |"
- Classwork row, after "becomes the title of its own classwork column in the journal.": "In a subject with codes on, it can have a code beside its title (Codes)."
- Homework row, after "where it is graded.": "In a subject with codes on, it can have a code beside its title (Codes)."

**A** `05`, Subject fields: "…language rule switch (on by default)." → "…language rule switch (on by default), codes switch (off by default; set by the Super Admin only; `09`, Codes)."

**B** `05`, Excel import of subjects, after "…and the same file is not imported twice.": "The codes switch is not in the template; the Super Admin sets it on the subject."

**C** `02`, Super Admin: "…and awards the quarterly stipend." → "…awards the quarterly stipend, and switches codes on or off for a subject (`09`, Codes)." Academic Vice Principal: "Full edit of students, classes, groups, subjects and their weights" → "Full edit of students, classes, groups, subjects (except the codes switch) and their weights".

**D** `02`, Integration keys: "…the numbers typed, topics, comments, plans." → "…the numbers typed, topics, comments, plans, and the codes of topics and works (`09`, Codes)."

**F** `07`, Layout, row "Lessons": "each with its title and, in front of the title," → "each with its title (its code first where the subject has codes on and one is filled; `09`, Codes) and, in front of it,".

**G** `07`, Classwork and homework: "each with a title typed when adding it (required, at most 60 characters)" → "each with a title typed when adding it (required, at most 60 characters) and, in a subject with codes on, an optional code (`09`, Codes)".

**H** `edge-cases/journal.md`, no plan item: "the title is required, at most 60 characters, and is the work's column title." → "the title is required, at most 60 characters, and is the work's column title; in a subject with codes on, a code of at most 20 characters may be added (`09`, Codes)."

**I** `edge-cases/lesson-plans.md`:
- approved edit: "the topic and titles can change" → "the topic, titles and codes can change".
- 300 MB video: "…plus an optional description." → "…plus an optional description, and, in a subject with codes on, an optional code of at most 20 characters (`09`, Codes)."

## 5. After approval

The spec edits and the entry in `docs/spec-changes.md`. The code plan joins the others when the owner says the spec changes are done.
