# Spec changes

The spec in `docs/spec/` was taken from the full spec document on 3 October 2026 (revision 88). Every later change to a spec file is listed here, newest first, with the date, what changed, why, and the files touched. Changes are made only with the `/spec-change` skill and the owner's approval.

## 5 October 2026: vacancies, a load row for a teacher not yet hired

- What changed: a vacancy is a staff record that stands for a teacher not yet hired: a name, one branch, the Academic division and one department, subjects with grades, languages, availability and contract load; no staff ID, no account, no roles, nothing personal. A teaching load row, and a group, may name a vacancy in place of a teacher, and step 2 of the builder is ready when every load has a teacher or a vacancy. A vacancy is bound by every blocked rule that binds a teacher, and the warnings on contract load and lessons per day apply to it. Its dated lessons keep it as their teacher and are "needs a teacher" from creation, so the teacher constraint covers it. The Academic Vice Principal creates, edits, fills and closes vacancies; filling publishes a version that changes only the teacher of the rows, in the live version and in every later published one. Until the vacancy is filled the Academic Vice Principal can name an acting teacher for the journal, who owns the plan and grades; without one the lessons are attendance-only and the closing checklist lists the journal as "no teacher". The Rules table also gains a warning that had no row: a teacher has more lessons in a day than the teacher's most lessons per day. The setting existed (builder step 3) but no rule used it.
- Why: the school places lessons for teachers it has not hired yet (grades 5–11 timetable), and one vacancy name stands for one future person, so its lessons must not overlap. Before, the builder refused to generate until every load had a teacher. Decided by the owner on 5 October 2026, with amendments after the check against the access rules, the staff record, the version chain and the lesson plans.
- Files: `docs/spec/04-people.md` (Teacher and staff record), `docs/spec/05-classes-groups-subjects.md` (Group and Teaching load rows), `docs/spec/06-timetable.md` (Model, Building step 2, Rules, Changes after publishing, How surprises are prevented), `docs/spec/edge-cases/timetable.md` (After publishing), `docs/spec/edge-cases/developer-rules.md` (Teacher in one place), `docs/spec/02-roles-and-access.md` (roles table), `docs/spec/edge-cases/people-roles-accounts.md` (Who can act).

## 4 October 2026: what the Principal may change on his own account

- What changed: the rule "the server refuses every change by the Principal" now names its exceptions as the changes to his own account: password, language, notification settings and photo, his sessions and sign-out, his second step and his trusted devices. Before, it named only password, language and notification settings. The list is closed: phone, email and name stay with the Super Admin and the Academic Vice Principal.
- Why: every account needs sign-out, "sign out everywhere", the second step and the list of trusted devices, and the row on own data already gives every staff member the photo. The Principal's "changes nothing" is a rule about school data. Decided by the owner in task 0.7b, after the permission review found that the code and the spec text differed.
- Files: `docs/spec/edge-cases/people-roles-accounts.md` (Who can act). The roles table of `docs/spec/02-roles-and-access.md` ("Changes nothing") stays as it is: the edge-case file is the more specific one.

## 4 October 2026: a trusted device still gives the second step, and removing one ends its session

- What changed: the "Trust this device" rule no longer says "no second step": the sign-in that starts the trust asks for the second step where the account has one. Removing a trusted device from the profile list ends its session at once.
- Why: with "no second step", a password alone would open a Super Admin's or Academic Vice Principal's account for 7 days on any browser where the switch is set. "Can be removed" did not say what happens to the session. Decided by the owner after the reviews of task 0.6c.
- Files: `docs/spec/edge-cases/people-roles-accounts.md` (Accounts and sign-in), `docs/spec/16-open-questions.md` (question 41).

## 4 October 2026: the password change on a trusted device, and the longest life of a session

- What changed: the "Trust this device" rule now says that the one exception to "never asked for the password again" is changing one's own password, which always needs the current one; and every session ends 7 days after sign-in at the latest, trusted or not.
- Why: the trusted-device sentence contradicted "staff change their own password with the current one", and the spec named only idle sign-out, with no longest life for a session. Decided in task 0.6c.
- Files: `docs/spec/edge-cases/people-roles-accounts.md` (Accounts and sign-in), `docs/spec/16-open-questions.md` (question 41), `docs/spec/13-technology.md` (Security).

## 4 October 2026: routes that work without sign-in

- What changed: the spec now says that a short list of routes works without sign-in (the health check and sign-in with all its steps, later password reset by email), that each is declared public in code, and that a test holds the exact list.
- Why: sign-in cannot require a session, and uptime monitoring calls the health check. Decided in tasks 0.1 and 0.6a.
- Files: `docs/spec/02-roles-and-access.md` (Accounts and sign-in: build order), `docs/spec/13-technology.md` (Security).
