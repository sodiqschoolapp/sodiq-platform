# Spec changes

The spec in `docs/spec/` was taken from the full spec document on 3 October 2026 (revision 88). Every later change to a spec file is listed here, newest first, with the date, what changed, why, and the files touched. Changes are made only with the `/spec-change` skill and the owner's approval.

## 4 October 2026: routes that work without sign-in

- What changed: the spec now says that a short list of routes works without sign-in (the health check and sign-in with all its steps, later password reset by email), that each is declared public in code, and that a test holds the exact list.
- Why: sign-in cannot require a session, and uptime monitoring calls the health check. Decided in tasks 0.1 and 0.6a.
- Files: `docs/spec/02-roles-and-access.md` (Accounts and sign-in: build order), `docs/spec/13-technology.md` (Security).
