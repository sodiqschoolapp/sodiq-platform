# Permission and security checklist

For the owner to sign (`docs/spec/14-quality-plan.md`, Code review: "A change to permissions or to the calculation module also needs the owner's sign-off on a written checklist"; task 10.3, `docs/build-plan.md`). Written by task 10.3a (pull request #241); 10.3b adds the section on records of another branch reached by id. The checklist is signed once, before go-live, after 10.3b; a later change to permissions comes with this file updated in its pull request.

## How to read and sign it

- **Rules** (below, written by hand): each line is a rule of `02`, `13` (Security) or `edge/people-roles-accounts`, with where the code enforces it and the test that proves it. "No test found" or "Not built" is said plainly.
- **The tables** (after the rules, between the two `generated` markers): read from the code by `pnpm security:checklist`. A test (`apps/api/src/modules/access/permission-checklist.test.ts`) fails while they differ from what runs, so the table signed is the table in force.
- **Accepted risks**: what is known and left as it is, with the reason.
- **Hand checks**: what no automated test can prove, done on the test environment before go-live.
- To sign: tick each line you accept, and fill the line below in a commit, or say on issue #42 which lines you do not accept.

Signed by the owner on: ____________________ (checklist signed: pending)

## Rules

### Sign-in and sessions

- [ ] Passwords hashed with Argon2id ("Argon2id", 13-technology). Enforced: `apps/api/src/modules/auth/password-hash.ts` `hashPassword` / `verifyPassword` (node:crypto argon2, PHC text); database check on `accounts.password_hash` (`db/migrations/0005_accounts_sessions.sql`). Proved by: `apps/api/src/modules/auth/password-hash.test.ts > the password hash > is Argon2id in PHC text with the chosen parameters, and never holds the password`; `apps/api/src/modules/auth/accounts.database.test.ts > accounts and sessions in the database > refuse a stored password that is not an Argon2id hash`.
- [ ] "Passwords have at least ten characters". Enforced: `packages/shared/src/auth.ts` `PASSWORD_MIN_LENGTH = 10` (max 128) in the password-change schema. Proved by: `apps/api/src/modules/auth/auth.test.ts > the forced password change > refuses a new password of 9 characters and accepts one of 10`.
- [ ] "Logins are generated (for example a.karimov) and never reused". Enforced: `apps/api/src/modules/auth/login.ts` `loginBase` / `loginForms`, `Accounts.create` (`accounts.service.ts`); unique login, no delete of an account and no update of `login` for `sodiq_app` (`0005`). Proved by: `apps/api/src/modules/auth/accounts.database.test.ts > keep a login for ever > refuse a second account with the same login` and `> refuse the application user a delete of an account`; `apps/api/src/modules/auth/accounts.test.ts > get a generated login > gives the first holder of a name the plain login and later holders a number`.
- [ ] "There is no open sign-up. Every account is created by an administrator"; first account "by a one-time command on the server, which is logged". Enforced: only the listed `@Public()` routes (none creates an account); `apps/api/src/modules/auth/first-account.command.ts` + `FirstAccount` (`first-account.service.ts`, `SuperAdminExistsError`). Proved by: `apps/api/src/modules/auth/public-routes.test.ts > the routes that work without sign-in > are exactly the listed ones`; `apps/api/src/modules/auth/accounts.test.ts > the first-account command > is refused while a Super Admin exists` and `> is logged without an actor, naming the command`.
- [ ] First password "random, valid for 7 days", forced change, "not stored". Enforced: `Accounts.create` (`accounts.service.ts`); `SessionGuard` `AllowedBeforePasswordChange` (`session.guard.ts`); `password_expires_at` check in `Sessions.signIn`; database check "forced change together with its end" (`0005`/`0006`). Proved by: `apps/api/src/modules/auth/accounts.test.ts > get a first password > that is random, hashed with Argon2id, to be changed, and valid for 7 days`; `apps/api/src/modules/auth/auth.test.ts > the forced password change > refuses every other route while the first password is in use`.
- [ ] Reset by an administrator: "valid for 24 hours and forces a change ... ends all sessions, is logged as 'reset by X for Y', and the user sees 'your password was reset by X'". Enforced: `PasswordResets.byAdministrator` (`apps/api/src/modules/auth/password-resets.service.ts`); `answerOf` `passwordResetBy` (`session-answer.ts`). Proved by: `apps/api/src/modules/auth/password-resets.test.ts > gives a password that is valid for 24 hours > is refused as expired when the 24 hours are over`; `> ends all sessions of the account and none of anybody else`; `> tells the person who reset the password > at the next sign-in and while the one-time password is in use`.
- [ ] "An unknown login and a wrong password get the same answer" (including timing). Enforced: `Sessions.signIn` (`apps/api/src/modules/auth/sessions.service.ts`): one `sign_in_failed` 401, and an unknown login is verified against a dummy Argon2id hash (`unknownLoginHash`) so both run one hash; unknown logins are counted too. Proved by: `apps/api/src/modules/auth/auth.test.ts > sign-in > answers an unknown login and a wrong password alike, with no session and no cookie`; `apps/api/src/modules/auth/limits.test.ts > for a login that no account has > answers exactly as for a wrong password, before and after the fifth failure`. Timing: **no test found** (the dummy hash is in code only).
- [ ] "After five failures each further attempt is delayed; accounts are never locked permanently by failures. Limits are per account and device". Enforced: `apps/api/src/modules/auth/sign-in-throttle.service.ts` (`FREE_FAILURES = 5`, doubling from 30 s to `LONGEST_DELAY_MS` 15 min, forgotten after 24 h; key = login hash + device cookie hash). Proved by: `apps/api/src/modules/auth/limits.test.ts > the limit on sign-in attempts > never locks an account for good: after the longest wait the right password signs in`; `> per device > does not delay the known browser of a person when somebody guesses from elsewhere`.
- [ ] Second step "required for the Super Admin and Academic Vice Principal", authenticator app, "ten single-use recovery codes". Enforced: `apps/api/src/modules/auth/second-step-rule.ts` `secondStepRequired`; `TwoStep` (`two-step.service.ts`, `totp.ts`); `SessionGuard` `AllowedBeforeSecondStep` / `AllowedBeforeSecondStepSetUp`. Proved by: `apps/api/src/modules/auth/two-step.test.ts > where it is required and not set up > refuses every route but the set-up, the session, the password and sign-out`; `> the set-up > is confirmed by a right code, which opens every route and shows ten recovery codes`; `> cannot be turned off where it is required`.
- [ ] Second-step attempts limited. Enforced: `TwoStep.pass` with the wrong-code count (`0007_two_step.sql`, same wait rule as sign-in). Proved by: `apps/api/src/modules/auth/two-step.test.ts > the limit on wrong codes > makes the sixth attempt wait, also with the right code, and ends at its moment`; `> the count of wrong codes over time > makes nobody wait longer than 15 minutes, and never locks for good`.
- [ ] "Sessions end after a period without use" (30 min; 15 min with Super Admin or AVP). Enforced: `apps/api/src/modules/auth/idle-limit.ts` `idleLimitMs`, `session-life.ts` `endByTime`, read in `Sessions.resolve`. Proved by: `apps/api/src/modules/auth/idle-sessions.test.ts > idle sign-out > after 30 minutes > is over for a Teacher at 30 minutes without use`; `> after 15 minutes with the Super Admin or Academic Vice Principal role > holds for a person who is also a Teacher`.
- [ ] "Trust this device": "7 days from the sign-in, with no idle sign-out ... Trust ends at once on 'sign out', 'sign out everywhere', a password change or reset, and an account lock". Enforced: `Sessions.beginTrust` / `endTrust` (`sessions.service.ts`), `session-life.ts` `isTrusted`; database checks in `0008_trusted_devices_account_lock.sql`. Proved by: `apps/api/src/modules/auth/trusted-devices.test.ts > a trusted device > stays signed in for 7 days from the sign-in > works one millisecond before the 7 days are over, and is over with them`; `> ends at once > on a password reset by an administrator` (siblings: on "sign out", "sign out everywhere", a password change, an account lock).
- [ ] Every session ends 7 days after sign-in at the latest. Enforced: `apps/api/src/modules/auth/session-life.ts` `SESSION_MAX_LIFE_MS`, `latestEndOf`. Proved by: `apps/api/src/modules/auth/session-life.test.ts > the longest life of a session > ends a session that is used all the time 7 days after its sign-in, and not before`.
- [ ] "Staff can change their own password (with the current one)". Enforced: `Sessions.changePassword` (`sessions.service.ts`, `verifyPassword` of the current one, throttled). Proved by: `apps/api/src/modules/auth/auth.test.ts > the forced password change > refuses a change with a wrong current password`; `apps/api/src/modules/auth/limits.test.ts > for the current password of a password change > makes the sixth attempt wait, also with the right password, and changes nothing`.
- [ ] "A password change ends all others". Enforced: `Sessions.changePassword`. Proved by: `apps/api/src/modules/auth/auth.test.ts > the forced password change > ends every other session of the account and of nobody else`; `apps/api/src/modules/auth/idle-sessions.test.ts > sign out everywhere > is the same for a password change`.
- [ ] "Rights are read again on every request". Enforced: `SessionGuard` + `Sessions.resolve` (account, lock, status and `currentAssignments` from the database per request); `PermissionGuard` (`apps/api/src/modules/access/permission.guard.ts`). Proved by: `apps/api/src/modules/access/permission.guard.test.ts > the permission guard > refuses at the next request once the role has ended`; `apps/api/src/modules/auth/idle-sessions.test.ts > ... > holds from the next request on when the role is given during a session`.
- [ ] Account lock ends all sessions at once. Enforced: `AccountLocks.lock` (`apps/api/src/modules/auth/account-locks.service.ts`, row lock against a sign-in at the same moment); `locked_at` checked in `Sessions.signIn` / `resolve`. Proved by: `apps/api/src/modules/auth/account-locks.test.ts > an account lock > ends all sessions at once and is logged with its reason`; `> at the same moment as a sign-in > never leaves a session of the locked account open, whichever comes first`.
- [ ] Inactive or left staff cannot sign in. Enforced: `staffAccountBlocked` (`apps/api/src/modules/people/staff-account.ts`) over SQL `staff_account_blocked` (`db/migrations/0024_staff.sql`), in `Sessions.signIn` and on every request in `Sessions.resolve`. Proved by: `apps/api/src/modules/people/staff.test.ts > status > of a record with an account > refuses the sign-in of an inactive person and every request from the date`; `apps/api/src/modules/people/staff.database.test.ts > ... > answer whether an account is inactive or left, on the date of a moment`. `apps/api/src/modules/people/narrower-refusals.test.ts > refuses the sign-in of a staff member who left` (task 10.3a).
- [ ] "There is no 'sign in as another user' function". Enforced: by absence: no such route; the closed list of `@Public()` routes and the route-permission harness list every route. Proved by: `apps/api/src/modules/access/route-permissions.test.ts > every route of the application, as every role > allows and refuses as listed` (no route of that kind exists). No direct test (none is possible beyond the route list).
- [ ] Nothing personal is answered while a sign-in step is owed (decision 0.8c). Enforced: `SessionGuard` (only `AllowedBefore...` routes); `Sessions.answerOf` and `answerOf` (`session-answer.ts`) give no own name, assignments or branches while `owesAStep`. Proved by: `apps/api/src/modules/people/staff-accounts.test.ts > the session > answers the name of the person, and nothing for an account without a record`; `apps/api/src/modules/audit/audit-entries.test.ts > the own sign-in history > answers no name while a sign-in step is still owed, and nothing without a session`.

### Accounts

- [ ] "At most 3 accounts can be Super Admin". Enforced: `Assignments` (`apps/api/src/modules/access/assignments.service.ts`, `MAX_SUPER_ADMINS`, `TooManySuperAdminsError`, under `lockSuperAdmins`). Proved by: `apps/api/src/modules/people/staff-accounts.test.ts > refuses a fourth Super Admin`.
- [ ] "The system refuses to lock or remove the last active Super Admin". Enforced: `keepingASuperAdmin` / `LastSuperAdminError` (`apps/api/src/modules/access/super-admins.ts`), used by role end (`staff-accounts.service.ts`), lock (`account-access.service.ts`) and status inactive/left (`staff.service.ts`). Proved by: `apps/api/src/modules/people/account-access.test.ts > the last active Super Admin > refuses to lock the only active one, and locks one of two`; `apps/api/src/modules/people/staff-accounts.test.ts > refuses to end the role of the last one` and `> refuses to set the record of the last one inactive or left, today or later`.
- [ ] "Nobody can remove their own Super Admin role". Enforced: `OwnSuperAdminRemovalError` in `assignments.service.ts`. Proved by: `apps/api/src/modules/people/staff-accounts.test.ts > refuses the end of one’s own Super Admin role`.
- [ ] "A banner shows while fewer than two exist". Enforced: `StaffAccounts.superAdmins` (`apps/api/src/modules/people/staff-accounts.service.ts`, counted per request); `apps/web/src/features/access/super-admin-banner.tsx`. Proved by: `apps/api/src/modules/people/staff-accounts.test.ts > counts the active Super Admins for the banner, the Super Admin alone`; `apps/web/src/features/access/app-menu.test.tsx > the Super Admin banner > shows to a Super Admin while fewer than two are active`.
- [ ] "A report lists entries made within 48 hours of a reset" (and the email reset after an email change by somebody else). Enforced: `ResetEntries` (`apps/api/src/modules/people/reset-entries.service.ts`, `password_resets_of_branch`, `db/migrations/0112_reset_entries.sql`). Proved by: `apps/api/src/modules/people/reset-entries.test.ts > the report of entries after a reset > lists the entries of the 48 hours of a reset by the Academic Vice Principal, and none before or after`; `> lists the re-hire password and the email reset, and marks the reset after an edit of the email`.
- [ ] "A report lists accounts never used". Enforced: `GET accounts/never-used` (`apps/api/src/modules/people/account-access.controller.ts`, `account-access.service.ts`). Proved by: `apps/api/src/modules/people/account-access.test.ts > the accounts never used > lists an account with no session, for the three readers, and not to a Teacher`.
- [ ] "Only the Super Admin imports staff, and an import can create only Teachers and Tutors". Not built: there is no staff import route or job (the spec says "Later, when a staff import is added"); nothing to sign until it exists.

### Audit

- [ ] "An audit log that nobody can edit". Enforced: `db/migrations/0003_audit_log.sql`: `sodiq_app` has only `select, insert` on `audit_log` and `audit_log_school`, nothing on partitions or columns; migrations that add partitions keep that. Proved by: `apps/api/src/modules/audit/audit.test.ts > is append-only for the application user > refuses an update of %s` / `refuses a delete from %s` / `refuses to truncate %s`; `> gives the application user > exactly select and insert on %s`.
- [ ] Readers: "The Super Admin reads all; the Principal and Academic Vice Principal read their branch ...; sign-ins and school-wide settings are read by the Super Admin; every user sees their own sign-in history". Enforced: `packages/shared/src/permissions.ts` area `audit_log` (super_admin, principal, academic_vice_principal: view); `AuditEntries` (`apps/api/src/modules/audit/audit-entries.service.ts`) with the branch row filter; `SignInHistoryReader` (`sign-in-history.service.ts`, `@AnySignedIn`, own account only). Proved by: `apps/api/src/modules/audit/audit-entries.test.ts > the branch of the request > never shows the Principal an entry of another branch, on any page` and `> gives the Super Admin every branch and the school-wide log by scope`; `> the own sign-in history > never shows an administrator what they did to another account, nor another account's sign-in`.
- [ ] Written "in the same transaction" as the change. Enforced: `Audit.record(transaction, ...)` (`apps/api/src/modules/audit/audit.service.ts`); `assertLessonChangesAudited` (`apps/api/src/database/transactions.ts`). Proved by: `apps/api/src/modules/audit/audit.test.ts > is written in the transaction of the change > keeps no entry when the transaction rolls back`; `apps/api/src/modules/auth/accounts.test.ts > are audited > leave no entry and no account when the transaction rolls back`.
- [ ] "Every export is logged with its filters and row count". Enforced: `exportList` (`apps/api/src/modules/audit/export-list.ts`, details `filters`, `search`, `columns`, `rows`). Proved by: `apps/api/src/modules/audit/exports-logged.test.ts > every export is logged > lists every export route of the application: those that require export and those named so`; `apps/api/src/modules/people/exports.test.ts > of the staff list > writes the rows in the order sent and the columns asked, and logs the export`.
- [ ] "Showing hidden fields" is logged ("the Principal sees them hidden, with a logged 'show'"). Enforced: actions `student.identity_shown`, `staff.identity_shown`, `relative.show`, `audit.entry_shown` (`packages/shared/src/audit.ts`); routes `POST /api/people/students/:id/identity`, `POST relatives/:id/show`, `POST audit entries/:id/show`. Proved by: `apps/api/src/modules/people/students.test.ts > readers > logs every show of the Principal`; `apps/api/src/modules/audit/audit-entries.test.ts > identity hidden from a reader without it > shows the hidden values to the Principal and logs the show`.

### Data

- [ ] "Every record carries its branch" with the row filter (task 0.4). Enforced: `app_branch_ids()` and the `branch_filter` policy pattern (`db/migrations/0002_branches_branch_filter_request_keys.sql`), set per transaction by `Transactions` (`apps/api/src/database/transactions.ts`); `sodiq_app` not superuser, no BYPASSRLS. Proved by: `apps/api/src/database/catalog.test.ts > the migrations > give every table the branch filter or name it as school-wide` and `> leave the application user subject to row security`; `apps/api/src/database/branch-filter.test.ts > branch filter > a row of another branch is invisible`. Note: the allow-listed SECURITY DEFINER functions (`SECURITY_DEFINER_FUNCTIONS` in `catalog.test.ts`) read across branches by design; each has a stated reason.
- [ ] The application database user's grants. Enforced: per-table `grant` lines in each migration; `sodiq_app` cannot create, alter or drop. Proved by: `apps/api/src/database/foundations.test.ts > application user > cannot create a table` and `> has exactly the rights that were granted`; `apps/api/src/database/catalog.test.ts > leave the job queue to its owner, with only the listed rights for the application user`. Gap: **no single pinned list of `sodiq_app` table rights** for the public schema (only the job queue is pinned); grants are proved table by table in the `*.database.test.ts` files.
- [ ] "The Super Admin can produce a personal data report per person". Enforced: `PersonalData` (`apps/api/src/modules/people/personal-data.service.ts`), area `personal_data_report` (super_admin: export only). Proved by: `apps/api/src/modules/people/personal-data.test.ts > who reaches it > refuses %s on every route, writing nothing` (Principal, AVP, Teacher); `> a student's report > writes one export entry in the log of the branch of the request`.
- [ ] "Archive, do not delete"; only the Super Admin's forced delete removes, with a reason. Enforced: no `delete` grant for `sodiq_app` on records with data (per migration); `ForcedDeleteStore` (`apps/api/src/modules/audit/forced-deletes.service.ts`), reason required by schema (`packages/shared/src/forced-deletes.ts`). Proved by: `apps/api/src/modules/timetable/forced-deletes.test.ts > a forced delete > refuses a reason missing, of spaces only or of 501 characters as an input error` and `> is refused to the Academic Vice Principal, the Principal and a Teacher, and nothing changes`.
- [ ] "Error reports carry no names, phones or marks". Enforced: allow-list `reportedEvent` in `apps/api/src/reporting/reporting.ts` and `apps/web/src/reporting/reporting.ts` (no request, user, breadcrumbs, frame variables; web page without query). Proved by: `apps/api/src/reporting/reporting.test.ts > what a report holds > leaves nothing of the request, the session, the person or the machine`; `apps/web/src/reporting/reporting.test.ts > what a report of the web app holds > leaves nothing of the person, the session, the search or the browser`. Residual: the error **message** is kept as it is; no test that a message carries no values.
- [ ] Logs carry no personal data. Enforced: the mail log names the subject only (`apps/api/src/mail/mailer.ts`, fixed by this review); `sendError` logs a fault's stack only, not its other fields (`apps/api/src/http/error-response.ts`); the first-account command prints login and password to the output only. Proved by: `apps/api/src/http/error-response.test.ts > sendError > logs the stack of a fault and none of its other fields`; `apps/api/src/modules/auth/first-account.command.test.ts > run as pnpm runs it > writes neither of them, nor the names, to any log`. The mail log: `apps/api/src/mail/mailer.test.ts > writes the subject of a mail to the log, never its address or its link`.

### Request hygiene

- [ ] Session cookie HttpOnly, Secure, SameSite=Strict, no Domain. Enforced: `apps/api/src/http/session-cookie.ts` (`__Host-sodiq_session`, `{ httpOnly, secure, sameSite: 'strict', path: '/' }`; `__Host-` forbids Domain); device cookie `apps/api/src/http/device-cookie.ts`. Proved by: `apps/api/src/modules/auth/auth.test.ts > sign-in > sets one session cookie that scripts cannot read, for HTTPS and this site only` (attributes exactly HttpOnly, Path=/, SameSite=Strict, Secure); `apps/api/src/modules/auth/limits.test.ts > the device cookie > is set at a sign-in, kept for 400 days, unreadable for scripts, for HTTPS and this site only`.
- [ ] Cross-site check on writes and on the live connection handshake. Enforced: `fromOwnSite` / `sameSiteMiddleware` (`apps/api/src/http/same-site.ts`, before the body parser in `apps/api/src/app.setup.ts`); the same `fromOwnSite` in the handshake (`apps/api/src/modules/notifications/live/socket-server.ts`). Proved by: `apps/api/src/modules/auth/auth.test.ts > the cross-site check > refuses Sec-Fetch-Site of another site even with the own origin in Origin`; `apps/api/src/modules/notifications/live.test.ts > at the handshake > refuses a request from another site, by the rule of the API`.
- [ ] JSON-only bodies (415). Enforced: `jsonOnlyMiddleware` (`apps/api/src/http/json-only.ts`). Proved by: `apps/api/src/http/http.test.ts > JSON bodies only > %s` (form-encoded, plain-text, multipart) and `> refuses a form-encoded body that is sent in chunks, without a length`.
- [ ] `Cache-Control: no-store` on every answer. Enforced: `noStoreMiddleware` (`apps/api/src/http/no-store.ts`). Proved by: `apps/api/src/http/http.test.ts > no answer may be kept > %s` and `> so do the refusals that come before a route`.
- [ ] Request keys belong to their account. Enforced: `apps/api/src/database/request-keys.ts`; `db/migrations/0010_request_key_account.sql`. Proved by: `apps/api/src/database/request-keys.test.ts > a key belongs to the account that sent it > is refused for another account with the same action and input, and the work does not run`; `apps/api/src/http/request-key.test.ts > the key of another account is refused, also with the same content, and changes nothing`.
- [ ] Every API input validated by a schema from `packages/shared`. Enforced: `SchemaPipe` / `HeaderPipe` (`apps/api/src/http/validation.ts`); a lint rule refuses raw `@Body`/`@Query`/`@Param` outside `apps/api/src/http`. Proved by: `apps/api/src/http/http.test.ts > input validation > reports every wrong field at once`; `apps/api/src/http/route-input-imports.test.ts > the lint rule against unchecked route input > refuses them under another name and through the whole package`.
- [ ] "The API returns one error shape everywhere", no stack traces. Enforced: `sendError` (`apps/api/src/http/error-response.ts`), `ApiExceptionFilter`, `notFoundFallback`, `errorFallback` (`apps/api/src/http/api-exception.filter.ts`). Proved by: `apps/api/src/http/http.test.ts > one error shape > %s`; `> a fault of the server says nothing about itself and is logged with the request id`.
- [ ] `x-powered-by` off. Enforced: `app.disable('x-powered-by')` in `configureApp` (`apps/api/src/app.setup.ts`). Proved by: `apps/api/src/health/health.controller.test.ts` (asserts no `x-powered-by` header on the health answer); security headers: `apps/api/src/http/security-headers.test.ts > the security headers > are on an answer of the API`.
- [ ] Live connection: who may connect. Enforced: `admit` in `apps/api/src/modules/notifications/live/socket-server.ts` (session cookie through `Sessions`, not locked, not over by time, no owed step, own site). Proved by: `apps/api/src/modules/notifications/live.test.ts > at the handshake > refuses a session of a locked account` and `> refuses a session that still owes a step of its sign-in, naming the step`.
- [ ] Live connection: who receives which notification. Enforced: `Notifications.send` (`apps/api/src/modules/notifications/notifications.service.ts`, one row per recipient chosen by each feature, delivery job in the same transaction); pushes go to the recipient account's tabs only (`listener.ts`, `socket-server.ts`). Proved by: `apps/api/src/modules/notifications/live.test.ts > tells the tabs of the person > of a new notification, as the list answers it, and tells nobody else` and `> and acts on nothing a tab sends`; `apps/api/src/modules/notifications/notifications.test.ts > are marked read > only among the own: another account's is not found, and stays unread`. Recipients per kind are proved in each feature's tests (for example `apps/api/src/modules/timetable/forced-deletes.test.ts`); no single test of recipients per kind.

### Roles, personal data and exports

- [ ] `02` Rules: "Every role is limited to a branch, and where it applies to subjects, a class or own lessons ... The limit is enforced on the server". Enforced: the guard (`apps/api/src/modules/access/permission.guard.ts`, `permission-check.ts`: role and branch) and each route's own check of the scope. Proved by: `apps/api/src/modules/access/route-permissions.test.ts > allows and refuses as listed` (every route as the 15 roles, without a role and without sign-in, in the own and another branch) and `apps/api/src/modules/access/route-scopes.test.ts > are named, with a test, for every scoped role of every route` (the limits table below).
- [ ] A record of another branch is never reached by its id (task 10.3b): every id a route takes, in its path, its query or its body, of another branch's record or of no record, is answered 404 with nothing written, and a query filter of another branch answers none of its rows (`CLAUDE.md`: "A query never returns another branch's rows"; `.claude/rules/api.md`, tasks 1.3 and 1.5). Enforced: the row filter (Data, above) and each route's own check of its ids against the branch of the request, before any other refusal, also for the Super Admin, whose transaction may hold every branch. Proved by: `apps/api/src/modules/access/route-ids.test.ts > the ids of the routes` (every id of every route, read from the OpenAPI document, names its record and its tests; the table "Records of another branch by id" below).
- [ ] `02` Rules: "Permissions are a table: rows are roles, columns are actions ... fixed in code for the 15 roles". Enforced: `PERMISSIONS` (`packages/shared/src/permissions.ts`, frozen at run time; `checkTable` asks a row for every role). Proved by: `packages/shared/src/permissions.test.ts`; the table is printed below.
- [ ] `02`, build order, from the first piece of work: every record carries its branch, one permission check on the server for every request, a short exact list of routes without sign-in, tests of what each role can and cannot do, roles fixed in code: the lines above and the Data section. Before the school goes live: the second step for the Super Admin and the Academic Vice Principal, a limit on failed sign-ins (Sign-in and sessions), password reset by email (built; with no mail service the mail is not sent and only its subject is logged, see "Fixed by this review"). Release 2 (phone and SMS for parents and students): not built.
- [ ] The Principal "changes nothing" except his own account (`edge/people-roles-accounts`). Enforced: the table gives the Principal no create, edit or archive in any area; his other writes are exports and the logged "show" of hidden fields. Proved by: the role harness (`route-permissions.test.ts`); the limits table (every non-reading route of the Principal is an export or a show).
- [ ] The Academic Vice Principal resets passwords and locks accounts only for Teachers, Tutors, Head Teachers and the Head Tutor of his branch. Enforced: `apps/api/src/modules/people/account-access.service.ts`. Proved by: `apps/api/src/modules/people/account-access.test.ts > refuses %s with nothing written`, `> refuses a person whose only Teacher role has ended`.
- [ ] Nobody changes the email of their own record; the Academic Vice Principal changes an email only for the accounts whose passwords he may reset. Enforced: `apps/api/src/modules/people/staff.service.ts`. Proved by: `apps/api/src/modules/people/staff-email.test.ts > refuses the Academic Vice Principal on accounts they may not reset, and on their own record`, `> refuses a Super Admin on their own record and lets them change another Super Admin`.
- [ ] "A Super Admin resets an Academic Vice Principal's second step; another Super Admin resets a Super Admin's." Enforced: `account-access.service.ts`. Proved by: `apps/api/src/modules/people/account-access.test.ts > refuses the Academic Vice Principal always, with nothing written`, `> %s: refuses the own account to both administrators`.
- [ ] Field groups and their readers (Basic, Contact, Identity, Financial, the diagnostic score; `edge/people-roles-accounts`, Personal data). Enforced: the student, relative and staff reads of `apps/api/src/modules/people/`. Proved by: `apps/api/src/modules/people/students.test.ts > hides the identity from the Principal, with a show`, `> answers Basic and Contact to the Spiritual VP, no birth date, address or score`, `> answers Basic and the diagnostic score to a Head Teacher and a Senior Head Teacher`; the Teacher reads only the students taught: `apps/api/src/modules/people/who-sees-what.test.ts`. The `narrower` rows of the limits table name the rest.
- [ ] "An export contains only what the role may see": the Head Teachers export the Basic fields, a Tutor the own class with what the Tutor reads, the Principal without contact and identity fields; every export is logged. Proved by: `apps/api/src/modules/people/student-exports.test.ts > writes Basic columns only for the Head Teachers, without the score, whole branch`, `> leaves Contact and Identity out of the Principal’s file and names them`; `apps/api/src/modules/people/exports.test.ts > leaves the phone out of the Principal's file, says so, and refuses a file of the phone only`; `apps/api/src/modules/audit/exports-logged.test.ts`.
- [ ] Ctrl+K returns only records the person may open, in the current branch; search by phone or document number for the Super Admin and the Academic Vice Principal; relatives' phones for the Super Admin, the Principal and the Academic Vice Principal. Proved by: `apps/api/src/modules/people/search.test.ts > finds by the phone and the JSHSHIR for the Academic Vice Principal and the Super Admin only`, `> never compares them for the Principal, a Head Teacher, the Head Tutor or a Tutor`, `> never finds the child by the relative's phone for another reader of students`.
- [ ] Forced delete: the Super Admin only, refused in a closed quarter, notifies, restored by a Super Admin within 30 days. Proved by: `apps/api/src/modules/timetable/forced-deletes.test.ts > is refused in a closed quarter, and nothing changes`, `> removes a past lesson, which only a forced delete can, and tells its teacher`, `> puts back the same lesson and block within 30 days, with its claims, its history line and its entry`; the area `forced_deletes` in the table below.
- [ ] "The audit log records which assignment allowed the action." Enforced: `access.assignmentId` passed to `audit.record` by every route. Proved by: `apps/api/src/modules/audit/audit-entries.test.ts > names the role of the assignment that allowed the action`.
- [ ] Consent is recorded on each student with its date. Enforced: the consent columns of `students` (`db/migrations/0032_students.sql`). Proved by: `apps/api/src/modules/people/student-exports.test.ts > answers whether consent is missing to the Financial readers only`; `apps/api/src/modules/people/personal-data.test.ts > holds the status history with the cause and reason of a leaving, and a consent not recorded`.
- [ ] "There is no permanent developer account in the live system." A rule of how the school runs the system, not of the code: the first Super Admins are made by the owner on the server (`pnpm auth:first-account`), and anybody else gets an ordinary account with a role, audited. The owner confirms it at go-live (10.4).

### Dependencies

- [ ] `pnpm audit --prod` from the repository root, 27 October 2026: "No known vulnerabilities found".

## Security headers (task 10.3a)

- [ ] Every answer, the web app's files and the API's answers and refusals alike, carries `Content-Security-Policy` (scripts of the own origin only, no page in another site's frame, requests to the own origin and to Sentry only), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy` (no camera, microphone or location), `Cross-Origin-Opener-Policy: same-origin`, and on the servers `Strict-Transport-Security` for a year. Enforced: `apps/api/src/http/security-headers.ts`, first in `configureApp` (`apps/api/src/app.setup.ts`). Proved by: `apps/api/src/http/security-headers.test.ts > are on the web app, at the root and on a page of the app`, `> are on an unknown address of the API`, `> add Strict-Transport-Security for a year`; `> have no inline script and no inline event handler` (the web app's HTML).

## Fixed by this review (task 10.3a)

- [ ] The mail log wrote the address and the whole text of a mail, the reset link included, to the API log: personal data and a key to the account in the log. It now writes the subject only (`apps/api/src/mail/mailer.ts`; `apps/api/src/mail/mailer.test.ts > writes the subject of a mail to the log, never its address or its link`). With no mail service until the owner adds one (answer 16 of Phase 10), a password reset is made by an administrator.

## Accepted risks

- [ ] **Unknown browsers share one count of failed sign-ins per login.** Somebody who knows a login (they are guessable) and sends a wrong password each time the wait ends delays every browser that never signed in to that account. A browser that signed in before keeps its own count; an administrator can reset; no account is ever locked for good. Proposed spec change, for the owner to run with `/spec-change` if wanted (issue #42): count unknown browsers per account and network address. Decision 2 of pull request #241.
- [ ] **A sign-in to a locked account with the right password is not delayed.** Whoever sends it already has the password; each attempt is written to the audit log (`auth.sign_in_locked`). Decision 3 of pull request #241.
- [ ] **No outside security test before the pilot** (owner, decided ahead for Phase 10, answer 13); reconsidered before Release 2.
- [ ] **Medical and psychologist records do not exist in Release 1** (`02`: Release 3); the rule "visible only to the roles that own them" has nothing to check yet. Parents and students sign in from Release 2.
- [ ] **Error messages are kept in error reports and logs as written by the code.** The reports keep an allow-list of fields only (no request, user, breadcrumbs or variables); a message is written by the code and holds ids, not names, but no test reads every message.
- [ ] **The same time for an unknown login and a wrong password** rests on the code (an unknown login is checked against a dummy Argon2id hash); no test times it, since a timing test would fail at random.
- [ ] **The rights of the application user are proved table by table** (each `*.database.test.ts`), not in one pinned list; 10.3b may add one.
- [ ] **The list of limits proves that each limit names its test, not what the test does.** `route-scopes.test.ts` checks that every scoped role of every route has a line, that each named test exists and that its file names the route; whether the test really refuses that role on that route was read by the reviews of task 10.3a, and several were run with the route's check removed. A new route is held to the same: its line and its test, read by the review.
- [ ] **The list of ids proves that each id names its test, not what the test does**, as for the limits: `route-ids.test.ts` finds every id from the OpenAPI document and checks that its line and its named tests exist and name the route; whether each test sends another branch's id and an unknown one and compares the rows was read by the review of task 10.3b.
- [ ] **Safari and the live connection**: older Safari versions did not count the live connection (`wss:` to the same address) as `'self'`; the supported current and previous Safari do. The hand check below includes a live notice in Safari.
- [ ] **The staff record's identity "show"** is open to the Super Admin and the Academic Vice Principal, who already read the fields, and is logged; the student's and the relative's shows refuse them. Nothing is shown that the reader may not read.
- [ ] **The student list has no attendance column yet** (`04`), so the rule "the Spiritual Vice Principal sees the attendance percent only, not the average" has no route to check; it is checked when the column is built.

## Hand checks on the test environment, before go-live

- [ ] With the security headers in force: sign in, open a journal grid and type a mark, drag a lesson on the timetable board, receive a live notice, print a timetable (Print opens the PDF in a new tab), in the current Chrome, Edge, Firefox and Safari (supported browsers, Phase 10 answer 7). The browser tests run on Vite's development server, which sends no policy, so they do not prove this.
- [ ] Neon and Cloudflare R2 encrypt stored data (`13`: "Personal data is encrypted in transit and at rest"): a fact of the providers, confirmed in their dashboards in task 10.4.

<!-- generated by pnpm security:checklist: start -->

## The routes in numbers

- Routes of the application: 468, each called by the role harness as the 15 roles, an account without a role and nobody, in the own and in another branch.
- Without sign-in: 4. For the own account: 21. With a permission of the table: 443.
- Routes with a limit inside the route: 145.
- Areas of the permission table: 53.

## Routes without a role

Without sign-in (`PUBLIC_ROUTES`, `apps/api/src/testing/route-access-list.ts`; held exact by `public-routes.test.ts`):

| Route | Why it needs no sign-in |
| --- | --- |
| `GET /api/health` | Uptime monitoring and the deploy smoke test call it without a session. |
| `POST /api/auth/password-reset` | The person who forgot the password cannot sign in; "later password reset by email" is in the short list (task 2.3c-2, decision 1 of #66). |
| `POST /api/auth/password-reset/confirm` | The new password is chosen with the link of the mail, without a session (task 2.3c-2, decision 1 of #66). |
| `POST /api/auth/sign-in` | Sign-in cannot require a session. |

Every signed-in account, for its own account only (`@AnySignedIn`):

- `DELETE /api/auth/photo`
- `DELETE /api/auth/trusted-devices/:id`
- `GET /api/auth/photo`
- `GET /api/auth/second-step`
- `GET /api/auth/session`
- `GET /api/auth/sessions`
- `GET /api/auth/sign-in-history`
- `GET /api/auth/trusted-devices`
- `GET /api/notifications`
- `POST /api/auth/password`
- `POST /api/auth/second-step`
- `POST /api/auth/second-step/confirm`
- `POST /api/auth/second-step/set-up`
- `POST /api/auth/second-step/turn-off`
- `POST /api/auth/sign-out`
- `POST /api/auth/sign-out-everywhere`
- `POST /api/feedback`
- `POST /api/notifications/:id/read`
- `POST /api/notifications/read-all`
- `PUT /api/auth/language`
- `PUT /api/auth/photo`

Reachable while a step of sign-in is still owed (`STEP_ROUTES`; held exact by `route-permissions.test.ts`):

| Route | Owed steps |
| --- | --- |
| `GET /api/auth/second-step` | second_step_set_up |
| `GET /api/auth/session` | second_step, password_change, second_step_set_up |
| `POST /api/auth/password` | password_change, second_step_set_up |
| `POST /api/auth/second-step` | second_step |
| `POST /api/auth/second-step/confirm` | second_step_set_up |
| `POST /api/auth/second-step/set-up` | second_step_set_up |
| `POST /api/auth/sign-out` | second_step, password_change, second_step_set_up |

## Limits inside the routes

For every route that lets in a role for less than its whole branch, the limit of each role and the tests that prove the refusal (`ROUTE_SCOPE`, `apps/api/src/testing/route-scope-list.ts`; held complete by `route-scopes.test.ts`). `branch` means the spec gives that role the whole branch on this route.

| Route | Roles | Limit | Rule | Proved by |
| --- | --- | --- | --- | --- |
| `DELETE /api/journal/lessons/:lessonId/works/:workId` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `DELETE /api/journal/lessons/:lessonId/works/:workId` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `DELETE /api/journal/student-absences/:studentId/:date/file` | tutor | class | 02, Tutor: "Records the reason for an absence, without changing the mark" (own class; task 8.6) | `src/modules/journal/exemption-files.test.ts > refuses a Tutor of another class, a Teacher and a Principal` |
| `DELETE /api/plans/files/:fileId` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": "Only the owner edits" | `src/modules/plans/plans.test.ts > refuses a write from everyone but the owner, leaving every row and the audit log` |
| `GET /api/access/head-teachers` | head_teacher | subjects | 02, Scope: own subjects; the list shows the appointments of the reader’s subjects (task 2.3b-1) | `src/modules/people/head-teachers.test.ts > shows a Head Teacher alone neither another subject nor its Senior Head Teacher` |
| `GET /api/access/head-teachers` | senior_head_teacher | subjects | 02, Senior Head Teacher: "Sees the Head Teachers of those subjects" | `src/modules/people/head-teachers.test.ts > shows a Senior Head Teacher alone the holders of their subjects in a branch of no own role` |
| `GET /api/audit/entries` | principal, academic_vice_principal | narrower | edge/people, audit log: the Principal and the Academic VP read their branch; "sign-ins and school-wide settings are read by the Super Admin" | `src/modules/audit/audit-entries.test.ts > does not show %s to the branch, and shows it to the Super Admin` |
| `GET /api/audit/entries` | principal | narrower | edge/people, Personal data: Identity hidden from the Principal, in the log too (task 2.6a, decision 6) | `src/modules/audit/audit-entries.test.ts > hides the address and the date of birth of a student entry from the Principal only` |
| `GET /api/classes` | tutor | class | 02, Tutor: "Own class or classes" (task 3.1c, decisions 1 and 9) | `src/modules/classes/tutor-scope.test.ts > lists the own classes only and reads them with their members` |
| `GET /api/classes` | head_teacher, senior_head_teacher | branch | 02, Head Teacher: "Full student list across classes and groups": every class of the branch (CLASS_WIDE_ROLES, decision 11 of #90) | — |
| `GET /api/classes/:id` | tutor | class | 02, Tutor: "Own class or classes" (task 3.1c, decisions 1 and 9) | `src/modules/classes/tutor-scope.test.ts > refuses another class 403 and another branch's or an unknown one 404` |
| `GET /api/classes/:id` | head_teacher, senior_head_teacher | branch | 02, Head Teacher: "Full student list across classes and groups": every class of the branch (CLASS_WIDE_ROLES, decision 11 of #90) | — |
| `GET /api/classes/:id/members` | tutor | class | 02, Tutor: "Own class or classes" (task 3.1c, decisions 1 and 9) | `src/modules/classes/tutor-scope.test.ts > refuses another class 403 and another branch's or an unknown one 404` |
| `GET /api/classes/:id/members` | head_teacher, senior_head_teacher | branch | 02, Head Teacher: "Full student list across classes and groups": every class of the branch (CLASS_WIDE_ROLES, decision 11 of #90) | — |
| `GET /api/groups` | tutor | class | Task 3.2a, decision 11 (Look first): the groups that draw from own classes | `src/modules/classes/groups.test.ts > lets the readers of 02 read every group, the Head Teachers own subjects, the Tutor own classes` |
| `GET /api/groups` | head_teacher, senior_head_teacher | subjects | 02, Scope: "For own subjects in own branch: ... groups" | `src/modules/classes/groups.test.ts > lets the readers of 02 read every group, the Head Teachers own subjects, the Tutor own classes` |
| `GET /api/groups/:id` | tutor | class | Task 3.2a, decision 11 (Look first): the groups that draw from own classes | `src/modules/classes/groups.test.ts > lets the readers of 02 read every group, the Head Teachers own subjects, the Tutor own classes` |
| `GET /api/groups/:id` | head_teacher, senior_head_teacher | subjects | 02, Scope: "For own subjects in own branch: ... groups" | `src/modules/classes/groups.test.ts > lets the readers of 02 read every group, the Head Teachers own subjects, the Tutor own classes` |
| `GET /api/groups/:id/members` | tutor | class | Task 3.2a, decision 11 (Look first): the groups that draw from own classes, the own class’s members | `src/modules/classes/group-members.test.ts > lets a Tutor read the members of own class only, with a count of the others` |
| `GET /api/groups/:id/members` | head_teacher | subjects | 02, Scope: "For own subjects in own branch: ... groups" | `src/modules/classes/group-members.test.ts > lets a Head Teacher read a group of own subjects, not another` |
| `GET /api/groups/:id/members` | senior_head_teacher | subjects | 02, Senior Head Teacher: everything a Head Teacher can do, for own subjects, in every branch | `src/modules/classes/group-members.test.ts > lets a Senior Head Teacher read a group of own subjects in a branch of no assignment of theirs` |
| `GET /api/journal/attendance-today` | tutor | class | 08, Home pages by role, Tutor; 02, Tutor: "attendance per lesson and daily attendance in percent" of own class (task 9.4b) | `src/modules/results/home-pages.test.ts > gives a Tutor the own class: the day, the week, below the threshold and who is absent now` |
| `GET /api/journal/comments/history` | teacher | own_lessons | 02, Teacher: "Journals of own classes and groups"; 07, Who can do what (a substitute: the substituted lesson only; task 6.2, decision 19) | `src/modules/journal/scope-refusals.test.ts > refuses a Senior Head Teacher of another subject the history of a cell, of a rating entry and of a comment, and a teacher of another journal the history of a comment` |
| `GET /api/journal/comments/history` | head_teacher | subjects | 02, Head Teacher: "Views journals and lesson plans of those subjects"; 07, Who can do what: "View all journals of their subjects, a Head Teacher in own branch" | `src/modules/journal/rating-readers.test.ts > lets a Head Teacher of the subject read both histories, and refuses one of another subject and a Teacher with no lesson` |
| `GET /api/journal/comments/history` | senior_head_teacher | subjects | 02, Senior Head Teacher: everything a Head Teacher can do, for the subjects given to them, in every branch; 07, Who can do what | `src/modules/journal/scope-refusals.test.ts > refuses a Senior Head Teacher of another subject the history of a cell, of a rating entry and of a comment, and a teacher of another journal the history of a comment` |
| `GET /api/journal/comments/history` | tutor | class | 07, Who can do what, Tutor: "Views journals of own class" (task 6.2, decision 2) | `src/modules/journal/rating-readers.test.ts > gives the Tutor of one class of the group the rows of own class only, also in both histories` |
| `GET /api/journal/comments/history` | spiritual_vice_principal, head_tutor | narrower | 02, Vice Principal for Spiritual and Moral Education: views attendance; 08, Who sees it: the Head Tutor and the Spiritual Vice Principal for attendance (journal decision 20: attendance only); comments on marks only (decision 10) | `src/modules/journal/rating-readers.test.ts > shows the readers of attendance no rating exam and no comment but on marks (decision 10)` |
| `GET /api/journal/discipline` | head_teacher | subjects | 08, Journal discipline: own subjects for a Head Teacher (task 8.7, decision 6) | `src/modules/journal/lesson-status.test.ts > refuses a range of more than 92 days or outside one year, and an unknown department; a Head Teacher of another subject sees nobody` |
| `GET /api/journal/discipline` | senior_head_teacher | subjects | 08, Journal discipline: own subjects for a Senior Head Teacher, in every branch (task 8.7, decision 6) | `src/modules/journal/lesson-status.test.ts > gives the Senior Head Teacher the teachers of own subjects in a branch without an appointment there, not those of another subject` |
| `GET /api/journal/discipline` | head_tutor | narrower | 02, Head Tutor: "Views all classes, their tutors and attendance by class and by tutor": the lessons of the Tutor subjects | `src/modules/journal/lesson-status.test.ts > gives the Head Tutor the lessons of the Tutor subjects only, also of a Tutor who teaches another department` |
| `GET /api/journal/exemptions-today` | tutor | class | edge/exemptions, row 11; 07, Problem cases: "The student's Tutor and teachers see 'back from exemption'": own classes for a Tutor, own lessons today for everyone (task 8.5, permission review 11) | `src/modules/journal/exemptions.test.ts > shows the Tutor "exempt today" with the category and "back from exemption" the day after the end` |
| `GET /api/journal/exemptions-today` | teacher | own_lessons | edge/exemptions, row 11; 07, Problem cases: "The student's Tutor and teachers see 'back from exemption'": own classes for a Tutor, own lessons today for everyone (task 8.5, permission review 11) | `src/modules/journal/exemptions-access.test.ts > shows 'back' for the students of the teacher's own lessons today, of their subject only` |
| `GET /api/journal/exemptions-today` | head_teacher, senior_head_teacher | own_lessons | edge/exemptions, row 11; 07, Problem cases: "The student's Tutor and teachers see 'back from exemption'": own classes for a Tutor, own lessons today for everyone (task 8.5, permission review 11) | `src/modules/journal/scope-refusals.test.ts > shows a Head Teacher and a Senior Head Teacher of the subject none of the exemption cards of lessons they do not teach` |
| `GET /api/journal/exports` | tutor, teacher, head_teacher, senior_head_teacher | own_requests | task 8.9, decision 12: the person's own branch exports, access checked again at download | `src/modules/journal/scope-refusals.test.ts > keeps the branch export to its readers: a scoped role asks for none, lists none of another and gets no file of it, writing nothing` |
| `GET /api/journal/exports` | spiritual_vice_principal, head_tutor | narrower | Task 8.9, decision 3: no branch export, and no exports of others, for a reader of part of the branch | `src/modules/journal/journal-exports.test.ts > fails a job whose requester lost the role, and is refused to a reader of part of the branch`<br>`src/modules/journal/narrower-refusals.test.ts > refuses the branch export to the Spiritual Vice Principal, a reader of attendance, with nothing written` |
| `GET /api/journal/exports/:exportId/file` | tutor, teacher, head_teacher, senior_head_teacher | own_requests | task 8.9, decision 12: the person's own branch exports, access checked again at download | `src/modules/journal/scope-refusals.test.ts > keeps the branch export to its readers: a scoped role asks for none, lists none of another and gets no file of it, writing nothing` |
| `GET /api/journal/journals` | teacher | own_lessons | 02, Teacher: "Journals of own classes and groups"; 07, Who can do what (a substitute: the substituted lesson only; task 6.2, decision 19) | `src/modules/journal/journals.test.ts > refuses a teacher of another journal, and reads a teacher who is also Head Tutor whole` |
| `GET /api/journal/journals` | head_teacher | subjects | 02, Head Teacher: "Views journals and lesson plans of those subjects"; 07, Who can do what: "View all journals of their subjects, a Head Teacher in own branch" | `src/modules/journal/journals.test.ts > gives a Head Teacher the journals of own subjects and refuses the others` |
| `GET /api/journal/journals` | senior_head_teacher | subjects | 02, Senior Head Teacher: everything a Head Teacher can do, for the subjects given to them, in every branch; 07, Who can do what | `src/modules/journal/journals.test.ts > gives a Senior Head Teacher the journals of own subjects in the branch of the request only` |
| `GET /api/journal/journals` | tutor | class | 07, Who can do what, Tutor: "Views journals of own class" (task 6.2, decision 2) | `src/modules/journal/journals.test.ts > gives a Tutor the journals of own class whole and refuses another class's` |
| `GET /api/journal/journals/:journalId` | teacher | own_lessons | 02, Teacher: "Journals of own classes and groups"; 07, Who can do what (a substitute: the substituted lesson only; task 6.2, decision 19) | `src/modules/journal/journals.test.ts > refuses a teacher of another journal, and reads a teacher who is also Head Tutor whole` |
| `GET /api/journal/journals/:journalId` | head_teacher | subjects | 02, Head Teacher: "Views journals and lesson plans of those subjects"; 07, Who can do what: "View all journals of their subjects, a Head Teacher in own branch" | `src/modules/journal/journals.test.ts > gives a Head Teacher the journals of own subjects and refuses the others` |
| `GET /api/journal/journals/:journalId` | senior_head_teacher | subjects | 02, Senior Head Teacher: everything a Head Teacher can do, for the subjects given to them, in every branch; 07, Who can do what | `src/modules/journal/journals.test.ts > gives a Senior Head Teacher the journals of own subjects in the branch of the request only` |
| `GET /api/journal/journals/:journalId` | tutor | class | 07, Who can do what, Tutor: "Views journals of own class" (task 6.2, decision 2) | `src/modules/journal/journals.test.ts > gives a Tutor the journals of own class whole and refuses another class's` |
| `GET /api/journal/journals/:journalId` | spiritual_vice_principal, head_tutor | narrower | 02, Vice Principal for Spiritual and Moral Education: views attendance; 08, Who sees it: the Head Tutor and the Spiritual Vice Principal for attendance (journal decision 20: attendance only) | `src/modules/journal/journals.test.ts > gives the Vice Principal for Spiritual and Moral Education and the Head Tutor attendance only`<br>`src/modules/journal/rating-readers.test.ts > shows the readers of attendance no rating exam and no comment but on marks (decision 10)` |
| `GET /api/journal/journals/:journalId/rating/:quarterId/students/:studentId/history` | teacher | own_lessons | 02, Teacher: "Journals of own classes and groups"; 07, Who can do what (a substitute: the substituted lesson only; task 6.2, decision 19) | `src/modules/journal/rating-readers.test.ts > lets a Head Teacher of the subject read both histories, and refuses one of another subject and a Teacher with no lesson` |
| `GET /api/journal/journals/:journalId/rating/:quarterId/students/:studentId/history` | head_teacher | subjects | 02, Head Teacher: "Views journals and lesson plans of those subjects"; 07, Who can do what: "View all journals of their subjects, a Head Teacher in own branch" | `src/modules/journal/rating-readers.test.ts > lets a Head Teacher of the subject read both histories, and refuses one of another subject and a Teacher with no lesson` |
| `GET /api/journal/journals/:journalId/rating/:quarterId/students/:studentId/history` | senior_head_teacher | subjects | 02, Senior Head Teacher: everything a Head Teacher can do, for the subjects given to them, in every branch; 07, Who can do what | `src/modules/journal/scope-refusals.test.ts > refuses a Senior Head Teacher of another subject the history of a cell, of a rating entry and of a comment, and a teacher of another journal the history of a comment` |
| `GET /api/journal/journals/:journalId/rating/:quarterId/students/:studentId/history` | tutor | class | 07, Who can do what, Tutor: "Views journals of own class" (task 6.2, decision 2) | `src/modules/journal/rating-readers.test.ts > gives the Tutor of one class of the group the rows of own class only, also in both histories` |
| `GET /api/journal/journals/:journalId/rating/:quarterId/students/:studentId/history` | spiritual_vice_principal, head_tutor | narrower | 02, Vice Principal for Spiritual and Moral Education: views attendance; 08, Who sees it: the Head Tutor and the Spiritual Vice Principal for attendance (journal decision 20: attendance only); no rating exam (decision 10) | `src/modules/journal/rating-readers.test.ts > shows the readers of attendance no rating exam and no comment but on marks (decision 10)` |
| `GET /api/journal/lessons-today` | head_teacher, senior_head_teacher | subjects | 08, Home pages by role: lessons today, the same scope as the counts per teacher (task 9.4b; task 8.7, decision 6) | `src/modules/results/home-pages.test.ts > counts the held lessons by status as the counts per teacher do, the lessons ahead apart, and keeps the Head Teacher to own subjects` |
| `GET /api/journal/lessons/:lessonId/card` | teacher | own_lessons | 02, Teacher: "Journals of own classes and groups"; 07, Who can do what (a substitute: the substituted lesson only; task 6.2, decision 19); 09, In the journal: "Clicking it opens the lesson card" | `src/modules/plans/plan-delivery.test.ts > refuses a teacher who reads neither the journal nor the plan, and 404s another branch or an unknown lesson` |
| `GET /api/journal/lessons/:lessonId/card` | head_teacher | subjects | 02, Head Teacher: "Views journals and lesson plans of those subjects"; 07, Who can do what: "View all journals of their subjects, a Head Teacher in own branch" | `src/modules/plans/plan-delivery.test.ts > refuses the Academic Vice Principal both marks, and gives the card whole to the Head Teacher of the subject, the Senior Head Teacher and the vice; a Head Teacher of another subject is refused` |
| `GET /api/journal/lessons/:lessonId/card` | senior_head_teacher | subjects | 02, Senior Head Teacher: everything a Head Teacher can do, for the subjects given to them, in every branch; 07, Who can do what | `src/modules/journal/scope-refusals.test.ts > refuses the lesson card to a Tutor of another class and a Senior Head Teacher of another subject` |
| `GET /api/journal/lessons/:lessonId/card` | tutor | class | 07, Who can do what, Tutor: "Views journals of own class" (task 6.2, decision 2) | `src/modules/journal/scope-refusals.test.ts > refuses the lesson card to a Tutor of another class and a Senior Head Teacher of another subject` |
| `GET /api/journal/lessons/:lessonId/students/:studentId/history` | teacher | own_lessons | 02, Teacher: "Journals of own classes and groups"; 07, Who can do what (a substitute: the substituted lesson only; task 6.2, decision 19) | `src/modules/journal/attendance.test.ts > answers the lines of the cells the reader’s grid shows, attendance only for a Head Tutor, and refuses a substitute outside their lesson` |
| `GET /api/journal/lessons/:lessonId/students/:studentId/history` | head_teacher | subjects | 02, Head Teacher: "Views journals and lesson plans of those subjects"; 07, Who can do what: "View all journals of their subjects, a Head Teacher in own branch" | `src/modules/journal/attendance.test.ts > answers every reader whose grid shows the cell, and refuses a Tutor of another class and a Head Teacher of another subject` |
| `GET /api/journal/lessons/:lessonId/students/:studentId/history` | senior_head_teacher | subjects | 02, Senior Head Teacher: everything a Head Teacher can do, for the subjects given to them, in every branch; 07, Who can do what | `src/modules/journal/scope-refusals.test.ts > refuses a Senior Head Teacher of another subject the history of a cell, of a rating entry and of a comment, and a teacher of another journal the history of a comment` |
| `GET /api/journal/lessons/:lessonId/students/:studentId/history` | tutor | class | 07, Who can do what, Tutor: "Views journals of own class" (task 6.2, decision 2) | `src/modules/journal/attendance.test.ts > answers every reader whose grid shows the cell, and refuses a Tutor of another class and a Head Teacher of another subject` |
| `GET /api/journal/lessons/:lessonId/students/:studentId/history` | head_tutor, spiritual_vice_principal | narrower | 02, Vice Principal for Spiritual and Moral Education: views attendance; 08, Who sees it: the Head Tutor and the Spiritual Vice Principal for attendance (journal decision 20: attendance only): no work lines | `src/modules/journal/narrower-refusals.test.ts > answers the Spiritual Vice Principal the attendance lines of a cell only, no work line`<br>`src/modules/journal/journal-works.test.ts > shows the Head Tutor no works, no works "not held", no homework given and no work lines`<br>`src/modules/journal/attendance.test.ts > answers the lines of the cells the reader’s grid shows, attendance only for a Head Tutor, and refuses a substitute outside their lesson` |
| `GET /api/journal/reminders` | tutor, teacher, head_teacher, senior_head_teacher | own_lessons | 07, Reminders: the caller's own lessons (task 8.7, decisions 12 and 13), for every role | `src/modules/journal/scope-refusals.test.ts > gives every role its own reminders only, never the lessons of the journal's teacher` |
| `GET /api/journal/student-absences` | tutor | class | 02, Tutor: "Records the reason for an absence, without changing the mark" (own class; task 8.6) | `src/modules/journal/student-absences.test.ts > lists the days with a 0 or 3 or a reason, marks a 0 after being at school, and limits a Tutor to own classes` |
| `GET /api/journal/student-absences/:studentId/:date/file` | tutor | class | 02, Tutor: "Records the reason for an absence, without changing the mark" (own class; task 8.6) | `src/modules/journal/exemption-files.test.ts > refuses a Tutor of another class, a Teacher and a Principal` |
| `GET /api/journal/unlocks` | tutor, teacher | own_requests | 02, Own requests; task 8.4: the requests the person sent; "deciding" lists only those the reader may decide; "branch" is the whole-branch readers' | `src/modules/journal/scope-refusals.test.ts > lists, decides and withdraws only own requests and those of own subjects, refusing the rest and writing nothing` |
| `GET /api/journal/unlocks` | head_teacher, senior_head_teacher | subjects | 02, Head Teachers and Senior Head Teachers, Who approves: "A teacher's unlock ... goes to the Head Teacher of the subject"; the Senior Head Teacher of the subject sees it too; 02, Own requests; task 8.4: the requests the person sent; "deciding" lists only those the reader may decide; "branch" is the whole-branch readers' | `src/modules/journal/scope-refusals.test.ts > lists, decides and withdraws only own requests and those of own subjects, refusing the rest and writing nothing` |
| `GET /api/people/relatives/:id` | principal | narrower | edge/people, Personal data: relatives’ workplaces and emails hidden from the Principal, with a logged show | `src/modules/people/relatives.test.ts > hides workplace and email from the Principal behind a logged show (decision 5)` |
| `GET /api/people/staff/:id` | principal | narrower | edge/people, Personal data: identity fields hidden from the Principal, with a logged show (task 2.2a, decision 9) | `src/modules/people/staff.test.ts > hides birth date and JSHSHIR from the Principal, with a logged show` |
| `GET /api/people/students` | tutor | branch | 02, Tutor: "Views the full student list of the branch (view only)" | — |
| `GET /api/people/students` | head_teacher, senior_head_teacher | branch | 02, Head Teacher: "Full student list across classes and groups" (class-wide, decision 11 of #90) | — |
| `GET /api/people/students` | teacher | taught_students | 02, Teacher: "The students they teach ... and no other student" (task 3.6a, L48) | `src/modules/people/who-sees-what.test.ts > lists the taught students only: a taught class, a taught group, a planned move into it` |
| `GET /api/people/students` | spiritual_vice_principal | narrower | edge/people, Personal data: Financial (the consent) for the Super Admin, the Academic VP, the Principal and the Head Tutor only | `src/modules/people/students.test.ts > answers the Basic group of the branch to every viewer` |
| `GET /api/people/students/:id` | tutor | class | 02, Tutor: "the profiles of own class" (task 3.1c) | `src/modules/classes/tutor-scope.test.ts > refuses another class, a former member and a student with no class` |
| `GET /api/people/students/:id` | head_teacher, senior_head_teacher | branch | edge/people-roles-accounts, Personal data: "Basic (name, class, photo, UID): all staff of the branch"; 02, the full student list | — |
| `GET /api/people/students/:id` | teacher | taught_students | 02, Teacher: "The students they teach ... and no other student" (task 3.6a, L48) | `src/modules/people/who-sees-what.test.ts > refuses another student on the record, the photo and Ctrl+K` |
| `GET /api/people/students/:id` | head_teacher, senior_head_teacher | narrower | edge/people: Basic for all staff of the branch; the diagnostic score for the Head Teachers; Contact, Identity and Financial not theirs | `src/modules/people/students.test.ts > answers Basic and the diagnostic score to a Head Teacher and a Senior Head Teacher` |
| `GET /api/people/students/:id` | principal | narrower | edge/people, Personal data: Identity "the Principal sees them hidden, with a logged show" | `src/modules/people/students.test.ts > hides the identity from the Principal, with a show` |
| `GET /api/people/students/:id` | spiritual_vice_principal | narrower | 02, Spiritual VP: "Overview with the Basic and Contact fields"; no Identity, Financial or diagnostic score | `src/modules/people/students.test.ts > answers Basic and Contact to the Spiritual VP, no birth date, address or score` |
| `GET /api/people/students/:id/history` | tutor | class | 04, Profile tabs (History); the Tutor reads own classes (task 3.3a, decision 9 as changed by correction 3) | `src/modules/people/group-transfers.test.ts > lets the Tutor of the class read it and refuses a Tutor of another class` |
| `GET /api/people/students/:id/history` | head_teacher, senior_head_teacher | branch | 02, Head Teacher: "Full student list across classes and groups"; 04, Movements: Head Teachers move students between groups (task 3.3a, decision 9: class-wide) | — |
| `GET /api/people/students/:id/leaving-results` | tutor | class | 02, Tutor: "the profiles of own class"; a student who left is of no class now | `src/modules/journal/leaving-results.test.ts > refuses the Tutor of the class alone, a student who left being of no class now, and answers a Tutor who also reads the record` |
| `GET /api/people/students/:id/leaving-results` | head_teacher, senior_head_teacher | subjects | 02, Scope: "For own subjects in own branch: journals" (task 9.1, decision 4) | `src/modules/journal/leaving-results.test.ts > answers each subject only to a reader who reads its journal whole, and refuses the readers outside the record` |
| `GET /api/people/students/:id/leaving-results` | teacher | taught_students | 02, Teacher: "The students they teach ... and no other student" (task 3.6a, L48) | `src/modules/journal/leaving-results.test.ts > answers each subject only to a reader who reads its journal whole, and refuses the readers outside the record` |
| `GET /api/people/students/:id/leaving-results` | spiritual_vice_principal, head_tutor | narrower | 02: no Results tab for the Spiritual VP and the Head Tutor; 6.2 decision 2: the attendance readers read no result | `src/modules/journal/leaving-results.test.ts > answers each subject only to a reader who reads its journal whole, and refuses the readers outside the record` |
| `GET /api/people/students/:id/photo` | tutor, head_teacher, senior_head_teacher | branch | edge/people-roles-accounts, Personal data: "Basic (name, class, photo, UID): all staff of the branch"; 02, the full student list | — |
| `GET /api/people/students/:id/photo` | teacher | taught_students | 02, Teacher: "The students they teach ... and no other student" (task 3.6a, L48) | `src/modules/people/who-sees-what.test.ts > refuses another student on the record, the photo and Ctrl+K` |
| `GET /api/people/students/:id/relatives` | tutor | class | 02, Tutor: "the profiles of own class"; Contact: "the class Tutor" (task 3.1c, decision 2) | `src/modules/classes/tutor-scope.test.ts > is refused for another class and a former member, 404 for another branch and unknown` |
| `GET /api/people/students/:id/relatives` | principal | narrower | edge/people, Personal data: relatives’ workplaces and emails are Identity, hidden from the Principal | `src/modules/people/relatives.test.ts > gives each reader what its group allows (02; decision 5)` |
| `GET /api/people/students/:id/relatives` | spiritual_vice_principal | narrower | 02, Spiritual VP: Relatives tab "name, relationship and phones of a relative" | `src/modules/people/relatives.test.ts > gives each reader what its group allows (02; decision 5)` |
| `GET /api/people/students/no-class` | tutor | branch | 02, Tutor: "Views the full student list of the branch (view only)": the counter of that list | — |
| `GET /api/people/students/no-class` | head_teacher, senior_head_teacher | branch | 02, Head Teacher: "Full student list across classes and groups" (class-wide, decision 11 of #90) | — |
| `GET /api/people/students/no-class` | teacher | taught_students | 02, Teacher: "The students they teach ... and no other student" (task 3.6a, L48) | `src/modules/people/who-sees-what.test.ts > refuses the History and Relatives tabs, the export, the counter and the show` |
| `GET /api/plans` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": the owner; teachers with the same subject and grade in their profile (plan-scope.ts) | `src/modules/plans/plans.test.ts > lets the readers of edge/lesson-plans read a plan, and only its owner edit it` |
| `GET /api/plans` | head_teacher | subjects | 02, Head Teacher: "Views journals and lesson plans of those subjects"; Senior Head Teacher: the same for own subjects in every branch | `src/modules/plans/plans.test.ts > lets the readers of edge/lesson-plans read a plan, and only its owner edit it`<br>`src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject the plan list, the item of a lesson, a plan file and the plan export, logging nothing` |
| `GET /api/plans` | senior_head_teacher | subjects | 02, Head Teacher: "Views journals and lesson plans of those subjects"; Senior Head Teacher: the same for own subjects in every branch | `src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject the plan list, the item of a lesson, a plan file and the plan export, logging nothing` |
| `GET /api/plans/files/:fileId` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": the owner; teachers with the same subject and grade in their profile (plan-scope.ts) | `src/modules/plans/plans.test.ts > adds, reads and removes files within the limits` |
| `GET /api/plans/files/:fileId` | head_teacher, senior_head_teacher | subjects | 02, Head Teacher: "Views journals and lesson plans of those subjects"; Senior Head Teacher: the same for own subjects in every branch | `src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject the plan list, the item of a lesson, a plan file and the plan export, logging nothing` |
| `GET /api/plans/journals/:journalId` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": the owner; teachers with the same subject and grade in their profile (plan-scope.ts) | `src/modules/plans/plans.test.ts > lets the readers of edge/lesson-plans read a plan, and only its owner edit it` |
| `GET /api/plans/journals/:journalId` | head_teacher, senior_head_teacher | subjects | 02, Head Teacher: "Views journals and lesson plans of those subjects"; Senior Head Teacher: the same for own subjects in every branch | `src/modules/plans/plans.test.ts > lets the readers of edge/lesson-plans read a plan, and only its owner edit it` |
| `GET /api/plans/journals/:journalId/master-compare` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": the owner; teachers with the same subject and grade in their profile (plan-scope.ts) | `src/modules/plans/plan-masters.test.ts > refuses take and keep to anyone but the owner, the comparison and the parallel classes to another subject, and the list shows another subject nothing (permission review, must-fixes 3 and 4)` |
| `GET /api/plans/journals/:journalId/master-compare` | head_teacher | subjects | 02, Head Teacher: "Views journals and lesson plans of those subjects"; Senior Head Teacher: the same for own subjects in every branch | `src/modules/plans/plan-masters.test.ts > refuses take and keep to anyone but the owner, the comparison and the parallel classes to another subject, and the list shows another subject nothing (permission review, must-fixes 3 and 4)`<br>`src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject a master, the masters list, a new master of the subject, the comparison and the parallel classes` |
| `GET /api/plans/journals/:journalId/master-compare` | senior_head_teacher | subjects | 02, Head Teacher: "Views journals and lesson plans of those subjects"; Senior Head Teacher: the same for own subjects in every branch | `src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject a master, the masters list, a new master of the subject, the comparison and the parallel classes` |
| `GET /api/plans/lessons/:lessonId` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": the owner; teachers with the same subject and grade in their profile (plan-scope.ts); 09: the substitute sees the item of that lesson | `src/modules/plans/plan-follow.test.ts > lets every reader of the plan read it (edge/lesson-plans, "Who may read a plan?") and refuses the others` |
| `GET /api/plans/lessons/:lessonId` | head_teacher | subjects | 02, Head Teacher: "Views journals and lesson plans of those subjects"; Senior Head Teacher: the same for own subjects in every branch | `src/modules/plans/plan-follow.test.ts > lets every reader of the plan read it (edge/lesson-plans, "Who may read a plan?") and refuses the others`<br>`src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject the plan list, the item of a lesson, a plan file and the plan export, logging nothing` |
| `GET /api/plans/lessons/:lessonId` | senior_head_teacher | subjects | 02, Head Teacher: "Views journals and lesson plans of those subjects"; Senior Head Teacher: the same for own subjects in every branch | `src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject the plan list, the item of a lesson, a plan file and the plan export, logging nothing` |
| `GET /api/plans/masters` | teacher | own_lessons | Task 7.3, decision 2: the masters are read as plans are (whole-branch roles, the Head Teachers of the subject, the profile) | `src/modules/plans/plan-masters.test.ts > lets every reader of plans read the masters, and a teacher only those of the subject and grade in the profile` |
| `GET /api/plans/masters` | head_teacher | subjects | Task 7.3, decision 2: the masters are read as plans are (whole-branch roles, the Head Teachers of the subject, the profile) | `src/modules/plans/plan-masters.test.ts > refuses take and keep to anyone but the owner, the comparison and the parallel classes to another subject, and the list shows another subject nothing (permission review, must-fixes 3 and 4)`<br>`src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject a master, the masters list, a new master of the subject, the comparison and the parallel classes` |
| `GET /api/plans/masters` | senior_head_teacher | subjects | Task 7.3, decision 2: the masters are read as plans are (whole-branch roles, the Head Teachers of the subject, the profile) | `src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject a master, the masters list, a new master of the subject, the comparison and the parallel classes` |
| `GET /api/plans/masters/:masterId` | teacher | own_lessons | Task 7.3, decision 2: the masters are read as plans are (whole-branch roles, the Head Teachers of the subject, the profile) | `src/modules/plans/plan-masters.test.ts > lets every reader of plans read the masters, and a teacher only those of the subject and grade in the profile` |
| `GET /api/plans/masters/:masterId` | head_teacher, senior_head_teacher | subjects | Task 7.3, decision 2: the masters are read as plans are (whole-branch roles, the Head Teachers of the subject, the profile) | `src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject a master, the masters list, a new master of the subject, the comparison and the parallel classes` |
| `GET /api/plans/minimums` | senior_head_teacher, head_teacher, teacher | branch | edge/lesson-plans: "Each subject can have a minimum number of classworks and homeworks per quarter"; task 8.8, decision 11 (a setting of subjects, read by the readers of plans) | — |
| `GET /api/plans/parallel` | teacher | own_lessons | 09, Master plans: "The Head Teacher sees all classes of a grade side by side"; task 7.3, decision 13: a Teacher reads no parallel classes | `src/modules/plans/plan-masters.test.ts > shows each class of the grade with the item it has reached, and a group of two grades under both (09, Parallel classes)` |
| `GET /api/plans/parallel` | head_teacher | subjects | 09, "Parallel classes": the Head Teacher, of own subjects | `src/modules/plans/plan-masters.test.ts > refuses take and keep to anyone but the owner, the comparison and the parallel classes to another subject, and the list shows another subject nothing (permission review, must-fixes 3 and 4)`<br>`src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject a master, the masters list, a new master of the subject, the comparison and the parallel classes` |
| `GET /api/plans/parallel` | senior_head_teacher | subjects | 09, "Parallel classes": the Head Teacher, of own subjects | `src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject a master, the masters list, a new master of the subject, the comparison and the parallel classes` |
| `GET /api/plans/reports/completeness` | head_teacher, senior_head_teacher | subjects | Task 8.8, decision 1: the plan reports of own subjects, the rest counted | `src/modules/plans/plan-delivery.test.ts > gives a Head Teacher who also teaches another subject the plans of the own subject only, counting the other, in every report and the file; a Senior Head Teacher the same` |
| `GET /api/plans/reports/progress` | head_teacher | subjects | Task 8.8, decision 1: the plan reports of own subjects, the rest counted | `src/modules/plans/plan-delivery.test.ts > gives a Head Teacher who also teaches another subject the plans of the own subject only, counting the other, in every report and the file; a Senior Head Teacher the same`<br>`src/modules/plans/scope-refusals.test.ts > gives a Head Teacher and a Senior Head Teacher of another subject who read the plan by the profile none of its progress, its requests or its report files` |
| `GET /api/plans/reports/progress` | senior_head_teacher | subjects | Task 8.8, decision 1: the plan reports of own subjects, the rest counted | `src/modules/plans/scope-refusals.test.ts > gives a Head Teacher and a Senior Head Teacher of another subject who read the plan by the profile none of its progress, its requests or its report files` |
| `GET /api/plans/reports/requests` | head_teacher, senior_head_teacher | subjects | Task 8.8, decision 1: the plan reports of own subjects, the rest counted | `src/modules/plans/scope-refusals.test.ts > gives a Head Teacher and a Senior Head Teacher of another subject who read the plan by the profile none of its progress, its requests or its report files` |
| `GET /api/plans/requests` | teacher | own_requests | 02, "Own requests"; task 7.2 build decision: the requests of a plan are shown to its owner | `src/modules/plans/plan-requests.test.ts > shows the requests to those who decide or oversee them, the Principal read only, and to nobody else`<br>`src/modules/plans/scope-refusals.test.ts > shows a teacher who does not own the plan none of its requests under "mine", and a Senior Head Teacher of another subject none under "deciding"` |
| `GET /api/plans/requests` | head_teacher | subjects | 02, Head Teacher: "Approves ... requests to edit a lesson plan after the window, for those subjects"; "Who approves"; "sees it too" | `src/modules/plans/plan-requests.test.ts > shows the requests to those who decide or oversee them, the Principal read only, and to nobody else` |
| `GET /api/plans/requests` | senior_head_teacher | subjects | 02, Head Teacher: "Approves ... requests to edit a lesson plan after the window, for those subjects"; "Who approves"; "sees it too" | `src/modules/plans/scope-refusals.test.ts > shows a teacher who does not own the plan none of its requests under "mine", and a Senior Head Teacher of another subject none under "deciding"` |
| `GET /api/plans/windows` | senior_head_teacher, head_teacher, teacher | own_record | edge/lesson-plans: "There is one window per quarter and branch"; 09: the Academic Vice Principal "can extend the window for one teacher, for example after illness"; decided in task 10.3a (pull request #241): an extension is shown to that teacher and the whole-branch readers only | `src/modules/plans/scope-refusals.test.ts > shows an extension of the window to its teacher and the whole-branch readers only` |
| `GET /api/results/early-warning` | tutor | class | 08, Early-warning list: the Tutor, the students of own classes on the reference date (task 9.4a, decision 1) | `src/modules/results/early-warning.test.ts > shows each reader their own scope, the attendance reasons only to the Head Tutor and the Spiritual Vice Principal` |
| `GET /api/results/early-warning` | head_teacher | subjects | 02, Scope: "For own subjects in own branch: ... the early-warning list" | `src/modules/results/early-warning.test.ts > shows each reader their own scope, the attendance reasons only to the Head Tutor and the Spiritual Vice Principal` |
| `GET /api/results/early-warning` | senior_head_teacher | subjects | 02, Scope: "For own subjects in own branch: ... the early-warning list"; Senior Head Teacher in every branch | `src/modules/results/scope-refusals.test.ts > leaves every entry out for a Senior Head Teacher of another subject` |
| `GET /api/results/early-warning` | teacher | own_lessons | 08, Early-warning list: the Teacher, own journals (task 9.4a, decision 1) | `src/modules/results/early-warning.test.ts > shows each reader their own scope, the attendance reasons only to the Head Tutor and the Spiritual Vice Principal` |
| `GET /api/results/early-warning` | spiritual_vice_principal, head_tutor | narrower | 08, Early warning, Who sees it: "the Head Tutor and the Vice Principal for Spiritual and Moral Education for attendance" | `src/modules/results/early-warning.test.ts > shows each reader their own scope, the attendance reasons only to the Head Tutor and the Spiritual Vice Principal` |
| `GET /api/results/rating/choices` | tutor | class | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Tutor, own classes | `src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area` |
| `GET /api/results/rating/choices` | head_teacher | subjects | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Head Teacher, own subjects, one subject at a time | `src/modules/results/scope-refusals.test.ts > leaves the journals of another subject out of the choices of a Head Teacher and a Senior Head Teacher` |
| `GET /api/results/rating/choices` | senior_head_teacher | subjects | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Senior Head Teacher, own subjects, one subject at a time | `src/modules/results/scope-refusals.test.ts > leaves the journals of another subject out of the choices of a Head Teacher and a Senior Head Teacher` |
| `GET /api/results/rating/choices` | teacher | own_lessons | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Teacher, the owner of the journal on the reference date | `src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area` |
| `GET /api/results/rating/class` | tutor | class | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Tutor, own classes | `src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area` |
| `GET /api/results/rating/class` | head_teacher | subjects | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Head Teacher, own subjects, one subject at a time | `src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area` |
| `GET /api/results/rating/class` | senior_head_teacher | subjects | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Senior Head Teacher, own subjects, one subject at a time | `src/modules/results/scope-refusals.test.ts > refuses a Senior Head Teacher of another subject the subject list, and every Senior Head Teacher the class list` |
| `GET /api/results/rating/class` | teacher | own_lessons | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Teacher, the owner of the journal on the reference date | `src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area` |
| `GET /api/results/rating/classes` | tutor | class | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Tutor, own classes | `src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area` |
| `GET /api/results/rating/classes` | head_teacher | subjects | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Head Teacher, own subjects, one subject at a time | `src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area` |
| `GET /api/results/rating/classes` | senior_head_teacher | subjects | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Senior Head Teacher, own subjects, one subject at a time | `src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area` |
| `GET /api/results/rating/classes` | teacher | own_lessons | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Teacher, the owner of the journal on the reference date | `src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area` |
| `GET /api/results/rating/classes` | head_tutor | narrower | 08, Rating: the ranking of the classes of the branch is for management | `src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area` |
| `GET /api/results/rating/subject` | tutor | class | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Tutor, own classes | `src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area` |
| `GET /api/results/rating/subject` | head_teacher | subjects | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Head Teacher, own subjects, one subject at a time | `src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area` |
| `GET /api/results/rating/subject` | senior_head_teacher | subjects | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Senior Head Teacher, own subjects, one subject at a time | `src/modules/results/scope-refusals.test.ts > refuses a Senior Head Teacher of another subject the subject list, and every Senior Head Teacher the class list` |
| `GET /api/results/rating/subject` | teacher | own_lessons | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Teacher, the owner of the journal on the reference date | `src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area` |
| `GET /api/results/rating/subject` | head_tutor | narrower | 08, Rating: the Head Tutor ranks the students of a class across subjects, not a journal in one subject | `src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area` |
| `GET /api/results/students/:id` | tutor | class | 02, Tutor: "the profiles of own class"; 07: "Views journals of own class" (task 9.1, decision 4) | `src/modules/results/student-results.test.ts > answers a Teacher who teaches the student another subject only that subject, and the class Tutor every subject of the class`<br>`src/modules/results/scope-refusals.test.ts > refuses the Tutor of another class the results, tabs, attendance and lessons of the student` |
| `GET /api/results/students/:id` | head_teacher | subjects | 02, Scope: "For own subjects in own branch: journals" (task 9.1, decision 4) | `src/modules/results/student-results.test.ts > answers each subject only to a reader of its journal, and refuses the readers outside the record` |
| `GET /api/results/students/:id` | senior_head_teacher | subjects | 02, Scope: "For own subjects in own branch: journals" (task 9.1, decision 4) | `src/modules/results/scope-refusals.test.ts > leaves every subject out for a Senior Head Teacher of another subject, and refuses its lessons` |
| `GET /api/results/students/:id` | teacher | taught_students | 02, Teacher: "The students they teach ... and no other student" (task 3.6a, L48) | `src/modules/results/student-results.test.ts > answers each subject only to a reader of its journal, and refuses the readers outside the record` |
| `GET /api/results/students/:id` | spiritual_vice_principal, head_tutor | narrower | 02: the profile of the Spiritual VP and of the Head Tutor has the Attendance tab, no Results tab | `src/modules/results/student-results.test.ts > answers each subject only to a reader of its journal, and refuses the readers outside the record` |
| `GET /api/results/students/:id/attendance` | tutor | class | 02, Tutor: "the profiles of own class"; 07: "Views journals of own class" (task 9.1, decision 4) | `src/modules/results/scope-refusals.test.ts > refuses the Tutor of another class the results, tabs, attendance and lessons of the student` |
| `GET /api/results/students/:id/attendance` | head_teacher | subjects | 02, Scope: "For own subjects in own branch: journals" (task 9.1, decision 4) | `src/modules/results/student-results.test.ts > answers each subject only to a reader of its journal, and refuses the readers outside the record` |
| `GET /api/results/students/:id/attendance` | senior_head_teacher | subjects | 02, Scope: "For own subjects in own branch: journals" (task 9.1, decision 4) | `src/modules/results/scope-refusals.test.ts > leaves every subject out for a Senior Head Teacher of another subject, and refuses its lessons` |
| `GET /api/results/students/:id/attendance` | teacher | taught_students | 02, Teacher: "The students they teach ... and no other student" (task 3.6a, L48) | `src/modules/results/student-results.test.ts > answers each subject only to a reader of its journal, and refuses the readers outside the record` |
| `GET /api/results/students/:id/lessons` | tutor | class | 02, Tutor: "the profiles of own class"; 07: "Views journals of own class" (task 9.1, decision 4) | `src/modules/results/scope-refusals.test.ts > refuses the Tutor of another class the results, tabs, attendance and lessons of the student` |
| `GET /api/results/students/:id/lessons` | head_teacher | subjects | 02, Scope: "For own subjects in own branch: journals" (task 9.1, decision 4) | `src/modules/results/student-results.test.ts > refuses the lessons of a subject the reader does not read, and answers 404 for another branch’s or an unknown id` |
| `GET /api/results/students/:id/lessons` | senior_head_teacher | subjects | 02, Scope: "For own subjects in own branch: journals" (task 9.1, decision 4) | `src/modules/results/scope-refusals.test.ts > leaves every subject out for a Senior Head Teacher of another subject, and refuses its lessons` |
| `GET /api/results/students/:id/lessons` | teacher | own_lessons | 02, Teacher: journals of own classes and groups (task 9.1, decision 4) | `src/modules/results/student-results.test.ts > answers a Teacher who teaches the student another subject only that subject, and the class Tutor every subject of the class` |
| `GET /api/results/students/:id/lessons` | head_tutor, spiritual_vice_principal | narrower | 02, Vice Principal for Spiritual and Moral Education: views attendance; 08, Who sees it: the Head Tutor and the Spiritual Vice Principal for attendance (journal decision 20: attendance only): the marks behind a figure, never the works | `src/modules/results/student-results.test.ts > opens the lessons behind a figure: the counted lessons with their marks, values and works`<br>`src/modules/results/narrower-refusals.test.ts > answers the Spiritual Vice Principal the marks behind a figure, never the works` |
| `GET /api/results/students/:id/tabs` | tutor | class | 02, Tutor: "the profiles of own class"; 07: "Views journals of own class" (task 9.1, decision 4) | `src/modules/results/scope-refusals.test.ts > refuses the Tutor of another class the results, tabs, attendance and lessons of the student` |
| `GET /api/results/students/:id/tabs` | head_teacher | subjects | 02, Scope: "For own subjects in own branch: journals" (task 9.1, decision 4) | `src/modules/results/student-results.test.ts > answers each subject only to a reader of its journal, and refuses the readers outside the record` |
| `GET /api/results/students/:id/tabs` | senior_head_teacher | subjects | 02, Scope: "For own subjects in own branch: journals" (task 9.1, decision 4) | `src/modules/results/scope-refusals.test.ts > leaves every subject out for a Senior Head Teacher of another subject, and refuses its lessons` |
| `GET /api/results/students/:id/tabs` | teacher | taught_students | 02, Teacher: "The students they teach ... and no other student" (task 3.6a, L48) | `src/modules/results/student-results.test.ts > answers each subject only to a reader of its journal, and refuses the readers outside the record` |
| `GET /api/results/students/:id/tabs` | spiritual_vice_principal, head_tutor | narrower | 02: the profile of the Spiritual VP and of the Head Tutor has the Attendance tab, no Results tab | `src/modules/results/student-results.test.ts > answers each subject only to a reader of its journal, and refuses the readers outside the record` |
| `GET /api/search/classes` | tutor | class | edge/people-roles-accounts: "Search returns only records the person may open" (the Tutor: own class) | `src/modules/classes/search.test.ts > finds own class and no other, by name and by a Cyrillic look-alike spelling` |
| `GET /api/search/classes` | head_teacher, senior_head_teacher | branch | 02, Head Teacher: "Full student list across classes and groups": every class of the branch (CLASS_WIDE_ROLES, decision 11 of #90) | — |
| `GET /api/search/groups` | tutor | class | Task 3.2a, decision 11 (Look first): the groups that draw from own classes | `src/modules/classes/search.test.ts > finds the groups drawing from own class, and not one drawing from another class only` |
| `GET /api/search/groups` | head_teacher, senior_head_teacher | subjects | 02, Scope: "For own subjects in own branch: ... groups" | `src/modules/classes/search.test.ts > a Head Teacher and the Senior Head Teacher find the groups of own subjects only` |
| `GET /api/search/staff` | principal | narrower | edge/people, Ctrl+K: "Search by phone or document number is for the Super Admin and Academic Vice Principal" | `src/modules/people/search.test.ts > finds by the phone and the JSHSHIR for the Academic Vice Principal and the Super Admin only` |
| `GET /api/search/students` | tutor | class | edge/people-roles-accounts: "Search returns only records the person may open" (the Tutor: own class) | `src/modules/people/search.test.ts > lists for the Tutor the students of own class, in force and planned, and no other` |
| `GET /api/search/students` | head_teacher, senior_head_teacher | branch | 02, Head Teacher: "Full student list across classes and groups" (class-wide, decision 11 of #90) | — |
| `GET /api/search/students` | teacher | taught_students | 02, Teacher: "The students they teach ... and no other student" (task 3.6a, L48) | `src/modules/people/who-sees-what.test.ts > refuses another student on the record, the photo and Ctrl+K` |
| `GET /api/search/students` | principal, head_tutor, spiritual_vice_principal | narrower | edge/people, Ctrl+K: "Search by phone or document number is for the Super Admin and Academic Vice Principal" | `src/modules/people/search.test.ts > never compares them for the Principal, a Head Teacher, the Head Tutor or a Tutor` |
| `GET /api/search/students` | head_tutor, spiritual_vice_principal | narrower | edge/people, Ctrl+K: "Relatives’ phones are searched too, for the Super Admin, the Principal and the Academic Vice Principal" | `src/modules/people/search.test.ts > never finds the child by the relative's phone for another reader of students` |
| `GET /api/setup/current-period` | tutor, senior_head_teacher, head_teacher, teacher | branch | 12, Context: "The branch, academic year and quarter in use are always shown in the top bar" (every role) | — |
| `GET /api/timetable/home` | tutor, head_teacher, senior_head_teacher | own_lessons | Task 5.9b: the caller’s own lessons and exams of the week; the query takes no field | `src/modules/timetable/scope-refusals.test.ts > lists only the own lessons on the home page of a Tutor, a Head Teacher and a Senior Head Teacher` |
| `GET /api/timetable/home` | teacher | own_lessons | Task 5.9b: the caller’s own lessons and exams of the week; the query takes no field | `src/modules/timetable/teaching-home.test.ts > refuses a query that names a person (spec review should-fix 4)` |
| `GET /api/timetable/views/branch` | tutor | branch | 02, Tutor: "Sees the school timetable" | — |
| `GET /api/timetable/views/branch` | head_teacher | subjects | 06, Views and outputs: "Head Teachers and Senior Head Teachers the teachers of their subjects" (5.9a decisions 3 and 4) | `src/modules/timetable/views.test.ts > gives a Head Teacher the teachers of own subjects, in those subjects only` |
| `GET /api/timetable/views/branch` | senior_head_teacher | subjects | 06, Views and outputs: "Head Teachers and Senior Head Teachers the teachers of their subjects" (5.9a decisions 3 and 4) | `src/modules/timetable/views.test.ts > gives a Senior Head Teacher the teachers of own subjects in every branch, nothing else` |
| `GET /api/timetable/views/branch` | teacher | own_lessons | 02, Teacher: "Own timetable" (5.9a decision 3) | `src/modules/timetable/views.test.ts > gives a teacher their own timetable and nobody else’s` |
| `GET /api/timetable/views/choices` | tutor | class | 02, Tutor: "Sees the school timetable and the timetable of own class" (5.9a decision 3) | `src/modules/timetable/views.test.ts > lists what each role may open` |
| `GET /api/timetable/views/choices` | head_teacher, senior_head_teacher | subjects | 06, Views and outputs: "Head Teachers and Senior Head Teachers the teachers of their subjects" (5.9a decisions 3 and 4) | `src/modules/timetable/scope-refusals.test.ts > leaves the teachers of another subject, the school, the classes and the rooms out of the choices of a Head Teacher and a Senior Head Teacher` |
| `GET /api/timetable/views/choices` | teacher | own_lessons | 02, Teacher: "Own timetable" (5.9a decision 3) | `src/modules/timetable/views.test.ts > lists what each role may open` |
| `GET /api/timetable/views/class` | tutor | class | 02, Tutor: "the timetable of own class" (5.9a decision 3) | `src/modules/timetable/views.test.ts > gives the Tutor the school and own class only, no room` |
| `GET /api/timetable/views/class` | head_teacher | subjects | 06, Views and outputs: "Head Teachers and Senior Head Teachers the teachers of their subjects" (5.9a decisions 3 and 4) | `src/modules/timetable/views.test.ts > gives a Head Teacher the teachers of own subjects, in those subjects only` |
| `GET /api/timetable/views/class` | senior_head_teacher | subjects | 06, Views and outputs: "Head Teachers and Senior Head Teachers the teachers of their subjects" (5.9a decisions 3 and 4) | `src/modules/timetable/views.test.ts > gives a Senior Head Teacher the teachers of own subjects in every branch, nothing else` |
| `GET /api/timetable/views/class` | teacher | own_lessons | 02, Teacher: "Own timetable" (5.9a decision 3) | `src/modules/timetable/views.test.ts > gives a teacher their own timetable and nobody else’s` |
| `GET /api/timetable/views/room` | tutor | class | 06, Views and outputs: the Tutor the school and own class, no room (5.9a decision 3) | `src/modules/timetable/views.test.ts > gives the Tutor the school and own class only, no room` |
| `GET /api/timetable/views/room` | head_teacher | subjects | 06, Views and outputs: "Head Teachers and Senior Head Teachers the teachers of their subjects" (5.9a decisions 3 and 4) | `src/modules/timetable/views.test.ts > gives a Head Teacher the teachers of own subjects, in those subjects only` |
| `GET /api/timetable/views/room` | senior_head_teacher | subjects | 06, Views and outputs: "Head Teachers and Senior Head Teachers the teachers of their subjects" (5.9a decisions 3 and 4) | `src/modules/timetable/views.test.ts > gives a Senior Head Teacher the teachers of own subjects in every branch, nothing else` |
| `GET /api/timetable/views/room` | teacher | own_lessons | 02, Teacher: "Own timetable" (5.9a decision 3) | `src/modules/timetable/views.test.ts > gives a teacher their own timetable and nobody else’s` |
| `GET /api/timetable/views/room` | head_tutor | narrower | 02, Head Tutor: the school and every class; no room (task 5.9a) | `src/modules/timetable/views.test.ts > gives the Head Tutor the school and every class, no teacher and no room` |
| `GET /api/timetable/views/teacher` | tutor | own_lessons | 5.9a decision 3: the Tutor reads the own teacher view only | `src/modules/timetable/views.test.ts > gives the Tutor the school and own class only, no room` |
| `GET /api/timetable/views/teacher` | head_teacher | subjects | 06, Views and outputs: "Head Teachers and Senior Head Teachers the teachers of their subjects" (5.9a decisions 3 and 4) | `src/modules/timetable/views.test.ts > gives a Head Teacher the teachers of own subjects, in those subjects only` |
| `GET /api/timetable/views/teacher` | senior_head_teacher | subjects | 06, Views and outputs: "Head Teachers and Senior Head Teachers the teachers of their subjects" (5.9a decisions 3 and 4) | `src/modules/timetable/views.test.ts > gives a Senior Head Teacher the teachers of own subjects in every branch, nothing else` |
| `GET /api/timetable/views/teacher` | teacher | own_lessons | 02, Teacher: "Own timetable" (5.9a decision 3) | `src/modules/timetable/views.test.ts > gives a teacher their own timetable and nobody else’s` |
| `GET /api/timetable/views/teacher` | head_tutor | narrower | 02, Head Tutor: "Sees the school timetable and the timetable of every class of the branch"; no other teacher (task 5.9a) | `src/modules/timetable/views.test.ts > gives the Head Tutor the school and every class, no teacher and no room` |
| `PATCH /api/plans/masters/:masterId` | head_teacher | subjects | 09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches" | `src/modules/plans/plan-masters.test.ts > refuses the writes of a master to every role but its keepers, and changes nothing` |
| `PATCH /api/plans/masters/:masterId` | senior_head_teacher | subjects | 09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches" | `src/modules/plans/plan-masters.test.ts > is kept by the Senior Head Teacher, read and copied in every branch, and refused to the others who keep branch masters` |
| `POST /api/audit/entries/:id/show` | principal | narrower | edge/people, audit log: sign-ins and entries of another branch are not the Principal’s | `src/modules/audit/audit-entries.test.ts > answers 404 to an entry the reader may not read, and logs nothing` |
| `POST /api/groups/transfers` | head_teacher, senior_head_teacher | subjects | 02, Head Teacher: "Moves students between groups of those subjects" (task 3.3a, decision 2) | `src/modules/people/scope-refusals.test.ts > is refused to a Head Teacher and a Senior Head Teacher of another subject, writing nothing`<br>`src/modules/people/group-transfers.test.ts > refuses a Head Teacher another subject, and a date in the past`<br>`src/modules/people/group-transfers.test.ts > lets a Senior Head Teacher move own subjects in a second branch and refuses another subject` |
| `POST /api/groups/transfers/:id/cancel` | head_teacher | subjects | 02, Head Teacher: "Moves students between groups of those subjects" (task 3.3a, decision 2) | `src/modules/people/group-transfers.test.ts > lets a Head Teacher change, cancel and undo moves of own subjects only, naming the assignment` |
| `POST /api/groups/transfers/:id/cancel` | senior_head_teacher | subjects | 02, Senior Head Teacher: everything a Head Teacher can do, for own subjects, in every branch | `src/modules/people/scope-refusals.test.ts > is refused to a Senior Head Teacher of another subject on change, cancel and undo, writing nothing` |
| `POST /api/groups/transfers/:id/change` | head_teacher | subjects | 02, Head Teacher: "Moves students between groups of those subjects" (task 3.3a, decision 2) | `src/modules/people/group-transfers.test.ts > lets a Head Teacher change, cancel and undo moves of own subjects only, naming the assignment` |
| `POST /api/groups/transfers/:id/change` | senior_head_teacher | subjects | 02, Senior Head Teacher: everything a Head Teacher can do, for own subjects, in every branch | `src/modules/people/scope-refusals.test.ts > is refused to a Senior Head Teacher of another subject on change, cancel and undo, writing nothing` |
| `POST /api/groups/transfers/:id/undo` | head_teacher | subjects | 02, Head Teacher: "Moves students between groups of those subjects" (task 3.3a, decision 2) | `src/modules/people/group-transfers.test.ts > lets a Head Teacher change, cancel and undo moves of own subjects only, naming the assignment` |
| `POST /api/groups/transfers/:id/undo` | senior_head_teacher | subjects | 02, Senior Head Teacher: everything a Head Teacher can do, for own subjects, in every branch | `src/modules/people/scope-refusals.test.ts > is refused to a Senior Head Teacher of another subject on change, cancel and undo, writing nothing` |
| `POST /api/journal/exports` | teacher | own_lessons | task 8.9, decision 3: the branch export is the whole-branch readers' (Super Admin, Principal, Academic Vice Principal); others export their own journals | `src/modules/journal/scope-refusals.test.ts > keeps the branch export to its readers: a scoped role asks for none, lists none of another and gets no file of it, writing nothing` |
| `POST /api/journal/exports` | tutor | class | task 8.9, decision 3: the branch export is the whole-branch readers' (Super Admin, Principal, Academic Vice Principal); others export their own journals | `src/modules/journal/scope-refusals.test.ts > keeps the branch export to its readers: a scoped role asks for none, lists none of another and gets no file of it, writing nothing` |
| `POST /api/journal/exports` | head_teacher, senior_head_teacher | subjects | task 8.9, decision 3: the branch export is the whole-branch readers' (Super Admin, Principal, Academic Vice Principal); others export their own journals | `src/modules/journal/scope-refusals.test.ts > keeps the branch export to its readers: a scoped role asks for none, lists none of another and gets no file of it, writing nothing` |
| `POST /api/journal/exports` | spiritual_vice_principal, head_tutor | narrower | Task 8.9, decision 3: the export of the whole branch is for the readers of every journal whole (Super Admin, Principal, Academic VP) | `src/modules/journal/journal-exports.test.ts > fails a job whose requester lost the role, and is refused to a reader of part of the branch`<br>`src/modules/journal/narrower-refusals.test.ts > refuses the branch export to the Spiritual Vice Principal, a reader of attendance, with nothing written` |
| `POST /api/journal/journals/:journalId/export` | teacher | own_lessons | 07: "Export to Excel and PDF"; task 8.9, decision 1: "teachers export their own journals" | `src/modules/journal/journal-exports.test.ts > writes attendance only for a reader of attendance, and refuses a month outside the quarter, a lesson reader, another branch and an unknown quarter` |
| `POST /api/journal/journals/:journalId/export` | head_teacher, senior_head_teacher | subjects | task 8.9: the export follows the scope of the grid (subjects for a Head Teacher and a Senior Head Teacher) | `src/modules/journal/journal-exports.test.ts > follows the scope of the grid: a Head Teacher of the subject, a Senior Head Teacher in another branch and the Tutor of the class are let in; the same roles outside their scope are refused` |
| `POST /api/journal/journals/:journalId/export` | tutor | class | task 8.9: the export follows the scope of the grid (own class for a Tutor) | `src/modules/journal/journal-exports.test.ts > follows the scope of the grid: a Head Teacher of the subject, a Senior Head Teacher in another branch and the Tutor of the class are let in; the same roles outside their scope are refused` |
| `POST /api/journal/journals/:journalId/export` | spiritual_vice_principal | narrower | 02, Vice Principal for Spiritual and Moral Education: views attendance; 08, Who sees it: the Head Tutor and the Spiritual Vice Principal for attendance (journal decision 20: attendance only); an export holds what the role may see (edge/people) | `src/modules/journal/journal-exports.test.ts > writes attendance only for a reader of attendance, and refuses a month outside the quarter, a lesson reader, another branch and an unknown quarter` |
| `POST /api/journal/journals/:journalId/rating/:quarterId/entries` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `POST /api/journal/journals/:journalId/rating/:quarterId/entries` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `POST /api/journal/journals/:journalId/rating/:quarterId/unlocks` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `POST /api/journal/journals/:journalId/rating/:quarterId/unlocks` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `POST /api/journal/journals/:journalId/rating/:quarterId/unlocks` | head_teacher, senior_head_teacher | own_lessons | 02, Head Teacher / Senior Head Teacher: "Also works as a Teacher"; an unlock is asked for a lesson or rating exam the person enters (task 8.4, decision 8) | `src/modules/journal/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of the subject an unlock of a lesson and of a rating exam they do not teach, writing nothing` |
| `POST /api/journal/lessons/:lessonId/all-present` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/all-present` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/attendance` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/attendance` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/copy-attendance` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/copy-attendance` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/not-graded` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/not-graded` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/scores` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/scores` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/undo` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/undo` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/unlocks` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/unlocks` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/unlocks` | head_teacher, senior_head_teacher | own_lessons | 02, Head Teacher / Senior Head Teacher: "Also works as a Teacher"; an unlock is asked for a lesson or rating exam the person enters (task 8.4, decision 8) | `src/modules/journal/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of the subject an unlock of a lesson and of a rating exam they do not teach, writing nothing` |
| `POST /api/journal/lessons/:lessonId/works` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/works` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/works/carry` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `POST /api/journal/lessons/:lessonId/works/carry` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `POST /api/journal/unlocks/:unlockId/decide` | head_teacher, senior_head_teacher | subjects | 02, Head Teachers and Senior Head Teachers, Who approves: "A teacher's unlock ... goes to the Head Teacher of the subject"; the Senior Head Teacher of the subject sees it too | `src/modules/journal/scope-refusals.test.ts > lists, decides and withdraws only own requests and those of own subjects, refusing the rest and writing nothing` |
| `POST /api/journal/unlocks/:unlockId/withdraw` | tutor, teacher, head_teacher, senior_head_teacher | own_requests | 02, Own requests; task 8.4: only the person who sent a request withdraws it | `src/modules/journal/scope-refusals.test.ts > lists, decides and withdraws only own requests and those of own subjects, refusing the rest and writing nothing` |
| `POST /api/people/relatives/:id/show` | academic_vice_principal | narrower | edge/people, Personal data: the logged show is the Principal’s; a reader who sees the fields is refused it | `src/modules/people/relatives.test.ts > hides workplace and email from the Principal behind a logged show (decision 5)` |
| `POST /api/people/staff/:id/account/lock` | academic_vice_principal | narrower | edge/people, "Every account is created by an administrator": the Academic Vice Principal resets passwords and locks accounts only for Teachers, Tutors, Head Teachers and the Head Tutor of his branch | `src/modules/people/account-access.test.ts > refuses %s with nothing written`<br>`src/modules/people/account-access.test.ts > refuses a person whose only Teacher role has ended`<br>`src/modules/people/account-access.test.ts > %s: refuses the own account to both administrators` |
| `POST /api/people/staff/:id/account/lock` | super_admin | narrower | edge/people: "The system refuses to lock or remove the last active Super Admin"; not the own account (task 2.3c-1, decision 11) | `src/modules/people/account-access.test.ts > refuses to lock the only active one, and locks one of two`<br>`src/modules/people/account-access.test.ts > %s: refuses the own account to both administrators` |
| `POST /api/people/staff/:id/account/password-reset` | academic_vice_principal | narrower | edge/people, "Every account is created by an administrator": the Academic Vice Principal resets passwords and locks accounts only for Teachers, Tutors, Head Teachers and the Head Tutor of his branch | `src/modules/people/account-access.test.ts > refuses %s with nothing written`<br>`src/modules/people/account-access.test.ts > refuses a person whose only Teacher role has ended`<br>`src/modules/people/account-access.test.ts > %s: refuses the own account to both administrators` |
| `POST /api/people/staff/:id/account/password-reset` | super_admin | narrower | Task 2.3c-1, decision 11: not the own account | `src/modules/people/account-access.test.ts > %s: refuses the own account to both administrators` |
| `POST /api/people/staff/:id/account/second-step-reset` | academic_vice_principal | narrower | edge/people, two-step sign-in: "A Super Admin resets an Academic Vice Principal’s second step; another Super Admin resets a Super Admin’s" | `src/modules/people/account-access.test.ts > refuses the Academic Vice Principal always, with nothing written` |
| `POST /api/people/staff/:id/account/second-step-reset` | super_admin | narrower | edge/people: "another Super Admin resets a Super Admin’s" second step, never the own | `src/modules/people/account-access.test.ts > %s: refuses the own account to both administrators` |
| `POST /api/people/staff/:id/account/unlock` | academic_vice_principal | narrower | edge/people, "Every account is created by an administrator": the Academic Vice Principal resets passwords and locks accounts only for Teachers, Tutors, Head Teachers and the Head Tutor of his branch; not a lock of the Super Admin | `src/modules/people/account-access.test.ts > refuses %s with nothing written`<br>`src/modules/people/account-access.test.ts > refuses the Academic Vice Principal the undo of a Super Admin’s lock`<br>`src/modules/people/account-access.test.ts > %s: refuses the own account to both administrators` |
| `POST /api/people/staff/:id/account/unlock` | super_admin | narrower | Task 2.3c-1, decision 11: not the own account | `src/modules/people/account-access.test.ts > %s: refuses the own account to both administrators` |
| `POST /api/people/staff/:id/roles/:assignmentId/end` | super_admin | narrower | edge/people: "nobody can remove their own Super Admin role"; the last active Super Admin is not removed | `src/modules/people/staff-accounts.test.ts > refuses the end of one’s own Super Admin role`<br>`src/modules/people/staff-accounts.test.ts > refuses to end the role of the last one`<br>`src/modules/access/narrower-refusals.test.ts > refuses the Super Admin the end of their own Super Admin role while another is active, with nothing written` |
| `POST /api/people/staff/:id/status` | academic_vice_principal | narrower | Task 2.2a, decision 2 of pull request #53: the status of a staff record is the Super Admin’s | `src/modules/people/staff.test.ts > is the Super Admin's only` |
| `POST /api/people/staff/:id/status` | super_admin | narrower | edge/people: "The system refuses to lock or remove the last active Super Admin"; not the own record (task 2.2b, correction 5) | `src/modules/people/staff.test.ts > refuses the Super Admin setting their own record to inactive or left`<br>`src/modules/people/staff-accounts.test.ts > refuses to set the record of the last one inactive or left, today or later` |
| `POST /api/people/staff/export` | principal | narrower | edge/people: the Principal’s exports are "without contact and identity fields" (task 2.2c-1, decision 4) | `src/modules/people/exports.test.ts > leaves the phone out of the Principal's file, says so, and refuses a file of the phone only` |
| `POST /api/people/students/:id/identity` | tutor | class | edge/people-roles-accounts, Identity: Super Admin, Academic Vice Principal, Head Tutor; the Principal by a logged show; not the Tutor | `src/modules/classes/tutor-scope.test.ts > refuses the identity show to a Tutor`<br>`src/modules/people/students.test.ts > refuses the show to a reader who sees the identity or may not see it` |
| `POST /api/people/students/:id/identity` | head_teacher | subjects | edge/people-roles-accounts, Identity: not a reader; the show is the Principal’s | `src/modules/people/students.test.ts > refuses the show to a reader who sees the identity or may not see it` |
| `POST /api/people/students/:id/identity` | senior_head_teacher | subjects | edge/people-roles-accounts, Identity: not a reader; the show is the Principal’s | `src/modules/people/scope-refusals.test.ts > refuses the identity show to a Senior Head Teacher who reads the record, writing nothing` |
| `POST /api/people/students/:id/identity` | teacher | taught_students | 02, Teacher: "The students they teach ... and no other student" (task 3.6a, L48) | `src/modules/people/who-sees-what.test.ts > refuses the History and Relatives tabs, the export, the counter and the show` |
| `POST /api/people/students/:id/identity` | super_admin, academic_vice_principal, head_tutor, spiritual_vice_principal | narrower | edge/people, Personal data: the logged show is the Principal’s; the readers of Identity see it unhidden, the Spiritual VP may not see it | `src/modules/people/students.test.ts > refuses the show to a reader who sees the identity or may not see it` |
| `POST /api/people/students/export` | tutor | class | edge/people-roles-accounts: "A Tutor exports the students of own class with every field the Tutor reads about them, and no other class" | `src/modules/classes/tutor-scope.test.ts > refuses a file with no row of the own class, and the consent filter`<br>`src/modules/classes/tutor-scope.test.ts > writes the own class only, with every group the Tutor reads, and counts the rows left out` |
| `POST /api/people/students/export` | head_teacher, senior_head_teacher | branch | 02, Head Teacher: "Full student list across classes and groups; exports it with the Basic fields" | — |
| `POST /api/people/students/export` | principal | narrower | edge/people: the Principal’s exports are "without contact and identity fields", relatives included | `src/modules/people/student-exports.test.ts > leaves Contact and Identity out of the Principal’s file and names them`<br>`src/modules/people/student-exports.test.ts > leaves the relatives out of the Principal’s file and names them` |
| `POST /api/people/students/export` | head_teacher, senior_head_teacher | narrower | 02, Head Teacher: "Full student list across classes and groups; exports it with the Basic fields" | `src/modules/people/student-exports.test.ts > writes Basic columns only for the Head Teachers, without the score, whole branch` |
| `POST /api/plans/items/:itemId/clear` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": "Only the owner edits" | `src/modules/plans/plans.test.ts > refuses a write from everyone but the owner, leaving every row and the audit log` |
| `POST /api/plans/journals/:journalId/carried/:itemId/place` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": "Only the owner edits" | `src/modules/plans/plan-outcomes.test.ts > refuses a reader who does not own the plan the merge, the carry and the place (plan_scope), changing nothing` |
| `POST /api/plans/journals/:journalId/copy` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": "Only the owner edits" | `src/modules/plans/plans.test.ts > refuses a write from everyone but the owner, leaving every row and the audit log` |
| `POST /api/plans/journals/:journalId/export` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": the owner; teachers with the same subject and grade in their profile (plan-scope.ts); edge: "Plans export to PDF and Excel" | `src/modules/plans/plan-delivery.test.ts > exports a plan with its marks, and refuses a teacher who does not read it` |
| `POST /api/plans/journals/:journalId/export` | head_teacher | subjects | 02, Head Teacher: "Views journals and lesson plans of those subjects"; Senior Head Teacher: the same for own subjects in every branch | `src/modules/plans/plan-delivery.test.ts > answers 404 for the plan file of another branch’s journal or quarter and unknown ids, and refuses a Head Teacher of another subject`<br>`src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject the plan list, the item of a lesson, a plan file and the plan export, logging nothing` |
| `POST /api/plans/journals/:journalId/export` | senior_head_teacher | subjects | 02, Head Teacher: "Views journals and lesson plans of those subjects"; Senior Head Teacher: the same for own subjects in every branch | `src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject the plan list, the item of a lesson, a plan file and the plan export, logging nothing` |
| `POST /api/plans/journals/:journalId/items` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": "Only the owner edits" | `src/modules/plans/plans.test.ts > refuses a write from everyone but the owner, leaving every row and the audit log` |
| `POST /api/plans/journals/:journalId/master-keep` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": "Only the owner edits" | `src/modules/plans/plan-masters.test.ts > refuses take and keep to anyone but the owner, the comparison and the parallel classes to another subject, and the list shows another subject nothing (permission review, must-fixes 3 and 4)` |
| `POST /api/plans/journals/:journalId/master-take` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": "Only the owner edits" | `src/modules/plans/plan-masters.test.ts > refuses take and keep to anyone but the owner, the comparison and the parallel classes to another subject, and the list shows another subject nothing (permission review, must-fixes 3 and 4)` |
| `POST /api/plans/journals/:journalId/not-covered/:itemId/carry` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": "Only the owner edits" | `src/modules/plans/plan-outcomes.test.ts > refuses a reader who does not own the plan the merge, the carry and the place (plan_scope), changing nothing` |
| `POST /api/plans/journals/:journalId/not-covered/:itemId/drop` | head_teacher | subjects | 02, Head Teacher: "Approves ... requests to edit a lesson plan after the window, for those subjects"; "Who approves" | `src/modules/plans/plan-outcomes.test.ts > lets the Head Teacher of the subject drop with a reason; the owner, another Head Teacher and a Teacher are refused`<br>`src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject the decision of a request, of the prepared request, by event and the drop of a not-covered item, changing nothing` |
| `POST /api/plans/journals/:journalId/not-covered/:itemId/drop` | senior_head_teacher | subjects | 02, Head Teacher: "Approves ... requests to edit a lesson plan after the window, for those subjects"; "Who approves" | `src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject the decision of a request, of the prepared request, by event and the drop of a not-covered item, changing nothing` |
| `POST /api/plans/journals/:journalId/not-covered/:itemId/merge` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": "Only the owner edits" | `src/modules/plans/plan-outcomes.test.ts > refuses a reader who does not own the plan the merge, the carry and the place (plan_scope), changing nothing` |
| `POST /api/plans/journals/:journalId/requests` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": "Only the owner edits" | `src/modules/plans/plan-requests.test.ts > refuses a teacher who reads the plan by the profile every owner's route: ask, send, send prepared, finish, queue` |
| `POST /api/plans/journals/:journalId/requests/prepared` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": "Only the owner edits" | `src/modules/plans/plan-requests.test.ts > refuses a teacher who reads the plan by the profile every owner's route: ask, send, send prepared, finish, queue` |
| `POST /api/plans/journals/:journalId/requests/prepared/decide` | head_teacher, senior_head_teacher | subjects | 02, Head Teacher: "Approves ... requests to edit a lesson plan after the window, for those subjects"; "Who approves" | `src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject the decision of a request, of the prepared request, by event and the drop of a not-covered item, changing nothing` |
| `POST /api/plans/journals/:journalId/separate` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": "Only the owner edits" | `src/modules/plans/plans.test.ts > refuses a write from everyone but the owner, leaving every row and the audit log` |
| `POST /api/plans/journals/:journalId/share` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": "Only the owner edits" | `src/modules/plans/plans.test.ts > refuses a write from everyone but the owner, leaving every row and the audit log` |
| `POST /api/plans/masters` | head_teacher | subjects | 09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches" | `src/modules/plans/plan-masters.test.ts > refuses the writes of a master to every role but its keepers, and changes nothing`<br>`src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject a master, the masters list, a new master of the subject, the comparison and the parallel classes` |
| `POST /api/plans/masters` | senior_head_teacher | subjects | 09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches" | `src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject a master, the masters list, a new master of the subject, the comparison and the parallel classes` |
| `POST /api/plans/masters/:masterId/archive` | head_teacher | subjects | 09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches" | `src/modules/plans/plan-masters.test.ts > refuses the writes of a master to every role but its keepers, and changes nothing` |
| `POST /api/plans/masters/:masterId/archive` | senior_head_teacher | subjects | 09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches" | `src/modules/plans/plan-masters.test.ts > is kept by the Senior Head Teacher, read and copied in every branch, and refused to the others who keep branch masters` |
| `POST /api/plans/masters/:masterId/items` | head_teacher | subjects | 09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches" | `src/modules/plans/plan-masters.test.ts > refuses the writes of a master to every role but its keepers, and changes nothing` |
| `POST /api/plans/masters/:masterId/items` | senior_head_teacher | subjects | 09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches" | `src/modules/plans/plan-masters.test.ts > is kept by the Senior Head Teacher, read and copied in every branch, and refused to the others who keep branch masters` |
| `POST /api/plans/masters/:masterId/items/:itemId/remove` | head_teacher | subjects | 09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches" | `src/modules/plans/plan-masters.test.ts > refuses the writes of a master to every role but its keepers, and changes nothing` |
| `POST /api/plans/masters/:masterId/items/:itemId/remove` | senior_head_teacher | subjects | 09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches" | `src/modules/plans/plan-masters.test.ts > is kept by the Senior Head Teacher, read and copied in every branch, and refused to the others who keep branch masters` |
| `POST /api/plans/masters/:masterId/restore` | head_teacher | subjects | 09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches" | `src/modules/plans/plan-masters.test.ts > refuses the writes of a master to every role but its keepers, and changes nothing` |
| `POST /api/plans/masters/:masterId/restore` | senior_head_teacher | subjects | 09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches" | `src/modules/plans/plan-masters.test.ts > is kept by the Senior Head Teacher, read and copied in every branch, and refused to the others who keep branch masters` |
| `POST /api/plans/reports/export` | head_teacher | subjects | Task 8.8, decision 1: the plan reports of own subjects, the rest counted | `src/modules/plans/plan-delivery.test.ts > gives a Head Teacher who also teaches another subject the plans of the own subject only, counting the other, in every report and the file; a Senior Head Teacher the same`<br>`src/modules/plans/scope-refusals.test.ts > gives a Head Teacher and a Senior Head Teacher of another subject who read the plan by the profile none of its progress, its requests or its report files` |
| `POST /api/plans/reports/export` | senior_head_teacher | subjects | Task 8.8, decision 1: the plan reports of own subjects, the rest counted | `src/modules/plans/scope-refusals.test.ts > gives a Head Teacher and a Senior Head Teacher of another subject who read the plan by the profile none of its progress, its requests or its report files` |
| `POST /api/plans/requests/:requestId/decide` | head_teacher | subjects | 02, Head Teacher: "Approves ... requests to edit a lesson plan after the window, for those subjects"; "Who approves" | `src/modules/plans/plan-requests.test.ts > refuses the Head Teacher of another subject, and lets a new Head Teacher of the subject decide what waited for the earlier one`<br>`src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject the decision of a request, of the prepared request, by event and the drop of a not-covered item, changing nothing` |
| `POST /api/plans/requests/:requestId/decide` | senior_head_teacher | subjects | 02, Head Teacher: "Approves ... requests to edit a lesson plan after the window, for those subjects"; "Who approves" | `src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject the decision of a request, of the prepared request, by event and the drop of a not-covered item, changing nothing` |
| `POST /api/plans/requests/:requestId/finish` | teacher | own_requests | edge/lesson-plans: "The teacher can press \"finished\" to lock early" (the owner of the plan) | `src/modules/plans/plan-requests.test.ts > refuses a teacher who reads the plan by the profile every owner's route: ask, send, send prepared, finish, queue` |
| `POST /api/plans/requests/:requestId/send` | teacher | own_requests | 09: "The teacher only sends it" (the owner of the plan) | `src/modules/plans/plan-requests.test.ts > refuses a teacher who reads the plan by the profile every owner's route: ask, send, send prepared, finish, queue` |
| `POST /api/plans/requests/decide-event` | head_teacher, senior_head_teacher | subjects | 02, Head Teacher: "Approves ... requests to edit a lesson plan after the window, for those subjects"; "Who approves"; 09, Approving together (others counted, never named) | `src/modules/plans/scope-refusals.test.ts > refuses a Head Teacher and a Senior Head Teacher of another subject the decision of a request, of the prepared request, by event and the drop of a not-covered item, changing nothing` |
| `POST /api/results/early-warning/handled` | tutor | class | Task 9.4a: the Tutor marks the students of own classes handled (permission review, must-fix 1) | `src/modules/results/scope-refusals.test.ts > refuses the Tutor of another class the mark handled, writing nothing` |
| `POST /api/results/early-warning/handled` | teacher | own_lessons | Task 9.4a: the Teacher marks the entries of own journals handled | `src/modules/results/early-warning.test.ts > marks a reason handled with a note, audited, hides it, and refuses in order: 404 for each body id, 403 out of scope, 409 not listed` |
| `POST /api/results/rating/export` | tutor | class | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Tutor, own classes | `src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area`<br>`src/modules/results/scope-refusals.test.ts > refuses an export outside the scope of the Tutor, the Teacher and both Head Teachers, logging nothing` |
| `POST /api/results/rating/export` | head_teacher | subjects | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Head Teacher, own subjects, one subject at a time | `src/modules/results/scope-refusals.test.ts > refuses an export outside the scope of the Tutor, the Teacher and both Head Teachers, logging nothing` |
| `POST /api/results/rating/export` | senior_head_teacher | subjects | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Senior Head Teacher, own subjects, one subject at a time | `src/modules/results/scope-refusals.test.ts > refuses an export outside the scope of the Tutor, the Teacher and both Head Teachers, logging nothing` |
| `POST /api/results/rating/export` | teacher | own_lessons | 08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4): Teacher, the owner of the journal on the reference date | `src/modules/results/scope-refusals.test.ts > refuses an export outside the scope of the Tutor, the Teacher and both Head Teachers, logging nothing` |
| `POST /api/results/rating/export` | head_tutor | narrower | 08, Rating: the Head Tutor ranks the students of a class, not a journal in one subject nor the classes of the branch; an export holds only what the role may see (edge/people) | `src/modules/results/narrower-refusals.test.ts > refuses the Head Tutor the export of a subject list and of the classes list, with nothing logged` |
| `POST /api/timetable/views/export` | tutor | class | 06, Views and outputs, with the 5.9a scope: the Tutor prints the school and own class | `src/modules/timetable/views-export.test.ts > lets the Tutor print the school and own class, nothing else`<br>`src/modules/timetable/views-export.test.ts > writes none for a refusal or a PDF that could not be made, and sends no file` |
| `POST /api/timetable/views/export` | head_teacher | subjects | 06, Views and outputs: "Head Teachers and Senior Head Teachers the teachers of their subjects" (5.9a decisions 3 and 4) | `src/modules/timetable/views-export.test.ts > refuses a Head Teacher of another subject the teachers of this one`<br>`src/modules/timetable/views-export.test.ts > writes none for a refusal or a PDF that could not be made, and sends no file` |
| `POST /api/timetable/views/export` | senior_head_teacher | subjects | 06, Views and outputs: "Head Teachers and Senior Head Teachers the teachers of their subjects" (5.9a decisions 3 and 4) | `src/modules/timetable/views-export.test.ts > lets a Senior Head Teacher print a teacher of own subject in the branch, nothing else`<br>`src/modules/timetable/scope-refusals.test.ts > refuses a Senior Head Teacher of another subject and a Teacher the file of another teacher, logging nothing` |
| `POST /api/timetable/views/export` | teacher | own_lessons | 02, Teacher: "Own timetable" (5.9a decision 3) | `src/modules/timetable/views-export.test.ts > lets a teacher print their own timetable and nobody else’s`<br>`src/modules/timetable/scope-refusals.test.ts > refuses a Senior Head Teacher of another subject and a Teacher the file of another teacher, logging nothing` |
| `POST /api/timetable/views/export` | head_tutor | narrower | 02, Head Tutor: the school and every class; no room, no other teacher (task 5.9a) | `src/modules/timetable/views-export.test.ts > lets the Head Tutor print the school and every class, no room and no other teacher` |
| `PUT /api/journal/comments` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `PUT /api/journal/comments` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `PUT /api/journal/journals/:journalId/rating/:quarterId/date` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `PUT /api/journal/journals/:journalId/rating/:quarterId/date` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `PUT /api/journal/journals/:journalId/rating/:quarterId/not-held` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `PUT /api/journal/journals/:journalId/rating/:quarterId/not-held` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `PUT /api/journal/lessons/:lessonId/delivery` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `PUT /api/journal/lessons/:lessonId/delivery` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `PUT /api/journal/lessons/:lessonId/homework-given` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `PUT /api/journal/lessons/:lessonId/homework-given` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `PUT /api/journal/lessons/:lessonId/works/not-held` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `PUT /api/journal/lessons/:lessonId/works/not-held` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `PUT /api/journal/lessons/:lessonId/works/total` | tutor | own_lessons | 07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class | `src/modules/journal/scope-refusals.test.ts > refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing` |
| `PUT /api/journal/lessons/:lessonId/works/total` | teacher | own_lessons | 07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only" | `src/modules/journal/scope-refusals.test.ts > refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing` |
| `PUT /api/journal/student-absences/:studentId/:date` | tutor | class | 02, Tutor: "Records the reason for an absence, without changing the mark" (own class; task 8.6) | `src/modules/journal/student-absences.test.ts > lets the Academic Vice Principal and the Super Admin write any class, and refuses a Tutor of another class and every other role` |
| `PUT /api/journal/student-absences/:studentId/:date/file` | tutor | class | 02, Tutor: "Records the reason for an absence, without changing the mark" (own class; task 8.6) | `src/modules/journal/exemption-files.test.ts > refuses a Tutor of another class, a Teacher and a Principal` |
| `PUT /api/people/staff/:id` | academic_vice_principal | narrower | edge/people, "A teacher changes their own email": phone, email and name by the Academic VP, the email only for the accounts whose passwords he may reset, never of the own record; every other field the Super Admin’s (task 2.2a, decision 2) | `src/modules/people/staff.test.ts > keeps every other field to the Super Admin`<br>`src/modules/people/staff-email.test.ts > refuses the Academic Vice Principal on accounts they may not reset, and on their own record`<br>`src/modules/people/staff-email.test.ts > is refused across branches: the Academic Vice Principal of another branch, and a person whose role is in another branch` |
| `PUT /api/people/staff/:id` | super_admin | narrower | edge/people: "nobody changes the email of their own record" | `src/modules/people/staff-email.test.ts > refuses a Super Admin on their own record and lets them change another Super Admin` |
| `PUT /api/people/staff/:id/branches` | academic_vice_principal | narrower | Task 2.2a, decision 2 of pull request #53: the branches of a staff record are the Super Admin’s | `src/modules/people/staff.test.ts > keeps them to the Super Admin and refuses an unknown branch` |
| `PUT /api/plans/items/:itemId` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": "Only the owner edits" | `src/modules/plans/plans.test.ts > refuses a write from everyone but the owner, leaving every row and the audit log` |
| `PUT /api/plans/items/:itemId/files` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": "Only the owner edits" | `src/modules/plans/plans.test.ts > refuses a write from everyone but the owner, leaving every row and the audit log` |
| `PUT /api/plans/journals/:journalId/queue` | teacher | own_lessons | edge/lesson-plans, "Who may read a plan?": "Only the owner edits" | `src/modules/plans/plan-requests.test.ts > refuses a teacher who reads the plan by the profile every owner's route: ask, send, send prepared, finish, queue` |
| `PUT /api/plans/masters/:masterId/items/:itemId` | head_teacher | subjects | 09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches" | `src/modules/plans/plan-masters.test.ts > refuses the writes of a master to every role but its keepers, and changes nothing` |
| `PUT /api/plans/masters/:masterId/items/:itemId` | senior_head_teacher | subjects | 09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches" | `src/modules/plans/plan-masters.test.ts > is kept by the Senior Head Teacher, read and copied in every branch, and refused to the others who keep branch masters` |
| `PUT /api/plans/masters/:masterId/order` | head_teacher | subjects | 09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches" | `src/modules/plans/plan-masters.test.ts > refuses the writes of a master to every role but its keepers, and changes nothing` |
| `PUT /api/plans/masters/:masterId/order` | senior_head_teacher | subjects | 09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches" | `src/modules/plans/plan-masters.test.ts > is kept by the Senior Head Teacher, read and copied in every branch, and refused to the others who keep branch masters` |

## The permission table

Every area of `PERMISSIONS` (`packages/shared/src/permissions.ts`), the table the server guard reads on every request. A role not named in an area may do nothing there.

### `absence_reasons`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  | yes |  |  |
| spiritual_vice_principal | yes |  |  |  |  |
| head_tutor | yes |  |  |  |  |
| tutor | yes |  | yes |  |  |

### `academic_years`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  |  |  |  |

### `account_access`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  | yes |  |  |

### `accounts`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes |  |  |
| principal | yes |  |  |  |  |

### `attendance_today`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  |  |  |  |
| spiritual_vice_principal | yes |  |  |  |  |
| head_tutor | yes |  |  |  |  |
| tutor | yes |  |  |  |  |

### `audit_log`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  |  |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  |  |  |  |

### `branch_moves`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  | yes |  |  |

### `branch_summary`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  |  |  |  |
| principal | yes |  |  |  |  |

### `branches`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  |  |  |  |

### `calendar`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes | yes |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes | yes | yes | yes |  |

### `classes`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes | yes | yes |
| principal | yes |  |  |  | yes |
| academic_vice_principal | yes | yes | yes | yes | yes |
| spiritual_vice_principal | yes |  |  |  |  |
| head_tutor | yes |  |  |  |  |
| tutor | yes |  |  |  |  |
| senior_head_teacher | yes |  |  |  |  |
| head_teacher | yes |  |  |  |  |

### `current_period`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  |  |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  |  |  |  |
| spiritual_vice_principal | yes |  |  |  |  |
| head_tutor | yes |  |  |  |  |
| tutor | yes |  |  |  |  |
| senior_head_teacher | yes |  |  |  |  |
| head_teacher | yes |  |  |  |  |
| teacher | yes |  |  |  |  |
| student | yes |  |  |  |  |
| parent | yes |  |  |  |  |
| hr | yes |  |  |  |  |
| nurse | yes |  |  |  |  |
| psychologist | yes |  |  |  |  |
| librarian | yes |  |  |  |  |

### `day_templates`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes | yes |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes | yes | yes | yes |  |

### `divisions`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes | yes | yes |
| principal | yes |  |  |  | yes |
| academic_vice_principal | yes |  |  |  | yes |

### `early_warning`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  |  |  |  |
| spiritual_vice_principal | yes |  |  |  |  |
| head_tutor | yes |  |  |  |  |
| tutor | yes |  | yes |  |  |
| senior_head_teacher | yes |  |  |  |  |
| head_teacher | yes |  |  |  |  |
| teacher | yes |  | yes |  |  |

### `exemptions`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes | yes | yes |  |  |

### `forced_deletes`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  | yes |  |  |

### `group_transfers`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin |  |  | yes |  |  |
| academic_vice_principal |  |  | yes |  |  |
| senior_head_teacher |  |  | yes |  |  |
| head_teacher |  |  | yes |  |  |

### `groups`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes | yes | yes |
| principal | yes |  |  |  | yes |
| academic_vice_principal | yes | yes | yes | yes | yes |
| spiritual_vice_principal | yes |  |  |  |  |
| head_tutor | yes |  |  |  |  |
| tutor | yes |  |  |  |  |
| senior_head_teacher | yes |  |  |  |  |
| head_teacher | yes |  |  |  |  |

### `head_teachers`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  |  |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  |  |  |  |
| senior_head_teacher | yes |  |  |  |  |
| head_teacher | yes |  |  |  |  |

### `journal`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  | yes |  | yes |
| principal | yes |  |  |  | yes |
| academic_vice_principal | yes |  | yes |  | yes |
| spiritual_vice_principal | yes |  |  |  | yes |
| head_tutor | yes |  |  |  | yes |
| tutor | yes |  | yes |  | yes |
| senior_head_teacher | yes |  |  |  | yes |
| head_teacher | yes |  |  |  | yes |
| teacher | yes |  | yes |  | yes |

### `journal_discipline`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  |  |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  |  |  |  |
| head_tutor | yes |  |  |  |  |
| senior_head_teacher | yes |  |  |  |  |
| head_teacher | yes |  |  |  |  |

### `journal_extensions`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes |  |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes | yes |  |  |  |

### `journal_orphans`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  | yes |  |  |

### `journal_support`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  |  |  |  |
| academic_vice_principal | yes |  |  |  |  |

### `journal_unlocks`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes | yes | yes |  |  |
| tutor | yes | yes |  |  |  |
| senior_head_teacher | yes | yes | yes |  |  |
| head_teacher | yes | yes | yes |  |  |
| teacher | yes | yes |  |  |  |

### `personal_data_report`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin |  |  |  |  | yes |

### `plan_masters`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes | yes | yes |  |  |
| senior_head_teacher | yes | yes | yes |  |  |
| head_teacher | yes | yes | yes |  |  |
| teacher | yes |  |  |  |  |

### `plan_reports`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  |  |  | yes |
| principal | yes |  |  |  | yes |
| academic_vice_principal | yes |  |  |  | yes |
| senior_head_teacher | yes |  |  |  | yes |
| head_teacher | yes |  |  |  | yes |

### `plan_requests`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  | yes |  |  |
| senior_head_teacher | yes |  | yes |  |  |
| head_teacher | yes |  | yes |  |  |
| teacher | yes | yes |  |  |  |

### `plan_windows`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes | yes | yes |  |  |
| senior_head_teacher | yes |  |  |  |  |
| head_teacher | yes |  |  |  |  |
| teacher | yes |  |  |  |  |

### `plans`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  | yes |  | yes |
| principal | yes |  |  |  | yes |
| academic_vice_principal | yes |  |  |  | yes |
| senior_head_teacher | yes |  |  |  | yes |
| head_teacher | yes |  |  |  | yes |
| teacher | yes |  | yes |  | yes |

### `quarter_closing`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  | yes |  |  |

### `quarters`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  | yes |  |  |

### `rating`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  |  |  | yes |
| principal | yes |  |  |  | yes |
| academic_vice_principal | yes |  |  |  | yes |
| head_tutor | yes |  |  |  | yes |
| tutor | yes |  |  |  | yes |
| senior_head_teacher | yes |  |  |  | yes |
| head_teacher | yes |  |  |  | yes |
| teacher | yes |  |  |  | yes |

### `relatives`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes | yes | yes |  |  |

### `results_recalculation`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin |  |  | yes |  |  |

### `rooms`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes | yes | yes |
| principal | yes |  |  |  | yes |
| academic_vice_principal | yes |  |  |  | yes |

### `settings`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  | yes |  |  |

### `staff`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes |  | yes |
| principal | yes |  |  |  | yes |
| academic_vice_principal | yes |  | yes |  | yes |

### `staff_teaching`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  | yes |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  | yes |  |  |

### `student_contact`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  |  |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  |  |  |  |
| spiritual_vice_principal | yes |  |  |  |  |
| head_tutor | yes |  |  |  |  |
| tutor | yes |  |  |  |  |

### `student_diagnostic`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  |  |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  |  |  |  |
| head_tutor | yes |  |  |  |  |
| tutor | yes |  |  |  |  |
| senior_head_teacher | yes |  |  |  |  |
| head_teacher | yes |  |  |  |  |

### `student_financial`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  |  |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  |  |  |  |
| head_tutor | yes |  |  |  |  |

### `student_graduates`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin |  |  | yes |  |  |

### `student_history`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  |  |  |  |
| principal | yes |  |  |  |  |
| academic_vice_principal | yes |  |  |  |  |
| tutor | yes |  |  |  |  |
| senior_head_teacher | yes |  |  |  |  |
| head_teacher | yes |  |  |  |  |

### `student_identity`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  |  |  |  |
| academic_vice_principal | yes |  |  |  |  |
| head_tutor | yes |  |  |  |  |

### `student_merges`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin |  |  | yes |  |  |

### `students`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes | yes | yes |
| principal | yes |  |  |  | yes |
| academic_vice_principal | yes | yes | yes | yes | yes |
| spiritual_vice_principal | yes |  |  |  |  |
| head_tutor | yes |  |  |  | yes |
| tutor | yes |  |  |  | yes |
| senior_head_teacher | yes |  |  |  | yes |
| head_teacher | yes |  |  |  | yes |
| teacher | yes |  |  |  |  |

### `subjects`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes | yes | yes |
| principal | yes |  |  |  | yes |
| academic_vice_principal | yes | yes | yes | yes | yes |

### `timetable`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes | yes | yes |
| principal | yes |  |  |  | yes |
| academic_vice_principal | yes | yes | yes | yes | yes |

### `timetable_views`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes |  |  |  | yes |
| principal | yes |  |  |  | yes |
| academic_vice_principal | yes |  |  |  | yes |
| spiritual_vice_principal | yes |  |  |  | yes |
| head_tutor | yes |  |  |  | yes |
| tutor | yes |  |  |  | yes |
| senior_head_teacher | yes |  |  |  | yes |
| head_teacher | yes |  |  |  | yes |
| teacher | yes |  |  |  | yes |

### `vacancies`

| Role | view | create | edit | archive | export |
| --- | :-: | :-: | :-: | :-: | :-: |
| super_admin | yes | yes | yes | yes | yes |
| principal | yes |  |  |  | yes |
| academic_vice_principal | yes | yes | yes | yes | yes |

<!-- generated by pnpm security:checklist: end -->
