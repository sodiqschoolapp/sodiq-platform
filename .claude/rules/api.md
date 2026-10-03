---
paths:
  - "apps/api/src/**"
---

# API

- Every route declares its permission and passes through the permission guard. The route-by-role test harness must cover it.
- Check branch and scope (subjects, class, own lessons) on the server for every request.
- Validate input with schemas from `packages/shared`. Return the one shared error shape.
- Use the injected clock. Do not call `Date.now()` or `new Date()` in business code.
- Write to the audit log in the same transaction as the change. Enqueue jobs in that transaction too.
- After changing a route, run `pnpm api:client` so the web client matches.
