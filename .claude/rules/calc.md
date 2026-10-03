---
paths:
  - "packages/calc/**"
---

# Calculation module

Before changing anything here, read `docs/spec/07-journal.md` (The total, Calculation rules, Exemptions), `docs/spec/08-results-rating-analytics.md`, `docs/spec/edge-cases/calculation.md` and `docs/spec/edge-cases/exemptions.md`.

- Pure TypeScript with no dependencies and no access to the database, the clock or the network.
- Exact fractions (integer numerator and denominator) from typed numbers to the final result. Round once, at the end. No floating point, no `toFixed`, no `Math.round` on intermediate values.
- Write the failing test first. Every worked example in the spec is a test.
- A change to a formula changes the module's version number and needs the owner's sign-off. Ask before changing a rule.
