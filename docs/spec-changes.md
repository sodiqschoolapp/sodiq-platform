# Spec changes

The spec in `docs/spec/` was taken from the full spec document on 3 October 2026 (revision 88). Every later change to a spec file is listed here, newest first, with the date, what changed, why, and the files touched. Changes are made only with the `/spec-change` skill and the owner's approval.

## 4 October 2026: the password change on a trusted device, and the longest life of a session

- What changed: the "Trust this device" rule now says that the one exception to "never asked for the password again" is changing one's own password, which always needs the current one; and every session ends 7 days after sign-in at the latest, trusted or not.
- Why: the trusted-device sentence contradicted "staff change their own password with the current one", and the spec named only idle sign-out, with no longest life for a session. Decided in task 0.6c.
- Files: `docs/spec/edge-cases/people-roles-accounts.md` (Accounts and sign-in), `docs/spec/16-open-questions.md` (question 41), `docs/spec/13-technology.md` (Security).

## 4 October 2026: routes that work without sign-in

- What changed: the spec now says that a short list of routes works without sign-in (the health check and sign-in with all its steps, later password reset by email), that each is declared public in code, and that a test holds the exact list.
- Why: sign-in cannot require a session, and uptime monitoring calls the health check. Decided in tasks 0.1 and 0.6a.
- Files: `docs/spec/02-roles-and-access.md` (Accounts and sign-in: build order), `docs/spec/13-technology.md` (Security).
