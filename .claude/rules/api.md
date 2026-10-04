---
paths:
  - "apps/api/src/**"
---

# API

- Every route declares its permission and passes through the permission guard. The route-by-role test harness must cover it.
- Check branch and scope (subjects, class, own lessons) on the server for every request.
- Validate input with schemas from `packages/shared`. Return the one shared error shape.
- A route reads its input only through `ValidBody`, `ValidQuery`, `ValidParams` and `RequestKey` (`apps/api/src/http/schemas.ts`). `Body`, `Query`, `Param`, `Headers`, `Req` and `Request` of `@nestjs/common` may be imported only inside `apps/api/src/http/`; a lint rule refuses them elsewhere.
- A change that must be safe to repeat (publish, close, offline entries) takes `@RequestKey()` and runs inside `RequestKeys.runOnce` in the same transaction as the change.
- Use the injected clock. Do not call `Date.now()` or `new Date()` in business code.
- Write to the audit log in the same transaction as the change. Enqueue jobs in that transaction too.
- After changing a route, run `pnpm api:client` so the web client matches.
