---
paths:
  - "apps/web/src/**"
---

# Web app

Read `docs/spec/12-ux-standards.md` before building a new screen.

- No hard-coded user-facing text. Add i18n keys in Uzbek, Russian and English together: the same key in `apps/web/src/i18n/locales/en.ts`, `uz.ts` and `ru.ts`. A text with a number has one key per plural form of its language (`_one`, `_other`; Russian also `_few`, `_many`). Uzbek is Latin script, with U+02BB in oʻ and gʻ. A missing key fails the type-check and `locales.test.ts`; the usual ways of writing a text into a component fail lint (what the rule cannot see is in `docs/decisions.md`, task 0.8a). A new component that takes a text under a property name of its own adds the name to `textAttribute` in `eslint.config.js`.
- A new error code of `packages/shared` needs its text under `errors` in the three files, written for the person: what happened and what to do next. Show a failed call with `failureText(t, error)` or `FailureAlert`; never show the `message` of the API.
- Call the API only through the generated client, wrapped in `answerOf(...)` (`apps/web/src/api/failure.ts`), inside a TanStack Query or a mutation. A refusal that says the session ended or owes a step is handled for every call in `createShell`.
- A new page is a route in `apps/web/src/app/router.tsx`: inside `appRoute` when it needs a complete session. Nothing calls the API on a timer without asking: such a call counts as use of the session.
- Tests of a page render the whole app at its address with `renderApp` and `fakeApi` (`apps/web/src/testing/render-app.tsx`). Browser tests sign in with accounts of `apps/api/src/testing/e2e/seed.ts`, one account per test. Do not calculate results in the browser except by calling `packages/calc`.
- Follow the shared list, form and table patterns. Every screen has loading, empty and error states.
- The menu hides what a role cannot use, but never rely on that for safety: the server decides.
