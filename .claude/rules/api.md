---
paths:
  - "apps/api/src/**"
---

# API

- Every route declares its permission and passes through the permission guard. The route-by-role test harness must cover it.
- Check branch and scope (subjects, class, own lessons) on the server for every request.
- Validate input with schemas from `packages/shared`. Return the one shared error shape.
- A route reads its input only through `ValidBody`, `ValidQuery`, `ValidParams` and `RequestKey` (`apps/api/src/http/schemas.ts`). `Body`, `Query`, `Param`, `Headers`, `Req`, `Request` and the other raw request decorators of `@nestjs/common` (the list is in `eslint.config.js`) may be imported only inside `apps/api/src/http/`; a lint rule refuses them elsewhere.
- Check permission and scope before `RequestKeys.runOnce`, on every request: a repeat does not run the work, so a check inside the work would be skipped.
- A change that must be safe to repeat (publish, close, offline entries) takes `@RequestKey()` and runs inside `RequestKeys.runOnce` in the same transaction as the change.
- Use the injected clock. Do not call `Date.now()` or `new Date()` in business code.
- Write to the audit log in the same transaction as the change. Enqueue jobs in that transaction too.
- After changing a route, run `pnpm api:client` so the web client matches.
