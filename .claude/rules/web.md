---
paths:
  - "apps/web/src/**"
---

# Web app

Read `docs/spec/12-ux-standards.md` before building a new screen.

- No hard-coded user-facing text. Add i18n keys in Uzbek, Russian and English together.
- Call the API only through the generated client. Do not calculate results in the browser except by calling `packages/calc`.
- Follow the shared list, form and table patterns. Every screen has loading, empty and error states.
- The menu hides what a role cannot use, but never rely on that for safety: the server decides.
