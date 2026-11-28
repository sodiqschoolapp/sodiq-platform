# Spec change proposal: the owner's decisions of 28 November 2026

**Status:** built on branch `claude/period-numbers-migration-qo0m2u` and waiting for the owner. No file under `docs/spec/` has been changed. The owner gave each rule below in chat on 28 November 2026; `/spec-change` writes it into the spec.

## 1. Printing the slips of chosen parents only

**`edge-cases/close-relatives.md`**, the row "First passwords for a class of 25 students…". Add at the end:

> A slip can also be printed for chosen relatives of the class only: exactly those relatives get a slip, and no one else. A chosen relative with a valid slip gets a new password, and the earlier slip stops working. A relative who already chose a password of their own gets no slip: they are left out of a print of the chosen, and refused when named alone.

## 2. Generated staff passwords are valid for 7 days

**`edge-cases/people-roles-accounts.md`**, the row "An administrator resets a teacher's password…".

- Now: "A reset gives a one-time password valid for 24 hours and forces a change before anything else."
- New:

> A reset gives a one-time password valid for 7 days and forces a change before anything else. Every password the platform generates for a staff account (first password, reset, the reset that goes with a second-step reset, re-hire) is valid for 7 days.

Parents are unchanged (owner: "7 days only for staff"): the first password of a class slip stays 30 days, and a reset stays 7 days.

## 3. Generated passwords that are easy to copy by hand

**`edge-cases/people-roles-accounts.md`**, the row "400 first passwords must be handed out…".

- Now: "First passwords are random, valid for 7 days, printed once on per-person slips and not stored."
- New:

> First passwords are random: ten characters of lowercase letters and digits without look-alikes (no i, l, o, 0 or 1), printed in two groups of five. They are valid for 7 days, printed once on per-person slips and not stored.

**`10-portal-notifications-release-2.md`**, Signing in.

- Now: "The first password is random, valid for 30 days, printed once and not stored, and changed at first sign-in."
- New:

> The first password is random (ten lowercase letters and digits without look-alikes, printed in two groups of five), valid for 30 days, printed once and not stored, and changed at first sign-in.

**`edge-cases/close-relatives.md`**:

- "printing gives a new first password, random, valid for 30 days…" becomes "printing gives a new first password, random (ten lowercase letters and digits without look-alikes, printed in two groups of five), valid for 30 days…".
- In the reset row, "a new one-time password on a slip" becomes "a new one-time password of the same kind on a slip".

The two-step recovery codes are unchanged: 16 characters of mixed case. Sign-in attempts stay limited by `SignInThrottle`: after 5 failures the wait doubles from 30 seconds up to 15 minutes, per login and device. With roughly 49.5 bits per password, that leaves no practical way to guess one online.

## 4. Journal numbers count the students who remain

**`07-journal.md`**:

- Layout, the row "Student list".
  - Now: "Number, surname and name in alphabetical order, UID."
  - New: "Number, surname and name in alphabetical order, UID. The number counts the students of the main list only, from 1 without gaps; a student in the folded "Left or moved" section has no number, and a student in the folded "Exempt" section keeps theirs."
- The line "Students who left or moved are shown in a folded section at the bottom with their data intact." becomes "Students who left or moved are shown in a folded section at the bottom with their data intact and without a number."
