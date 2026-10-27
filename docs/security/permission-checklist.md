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
- [ ] Inactive or left staff cannot sign in. Enforced: `staffAccountBlocked` (`apps/api/src/modules/people/staff-account.ts`) over SQL `staff_account_blocked` (`db/migrations/0024_staff.sql`), in `Sessions.signIn` and on every request in `Sessions.resolve`. Proved by: `apps/api/src/modules/people/staff.test.ts > status > of a record with an account > refuses the sign-in of an inactive person and every request from the date`; `apps/api/src/modules/people/staff.database.test.ts > ... > answer whether an account is inactive or left, on the date of a moment`. (The HTTP test uses `inactive` only; `left` is proved at the function level.)
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
- [ ] Logs carry no personal data. Enforced: the mail log names the subject only (`apps/api/src/mail/mailer.ts`, fixed by this review); `sendError` logs a fault's stack only, not its other fields (`apps/api/src/http/error-response.ts`); the first-account command prints login and password to the output only. Proved by: `apps/api/src/http/error-response.test.ts > sendError > logs the stack of a fault and none of its other fields`; `apps/api/src/modules/auth/first-account.command.test.ts > run as pnpm runs it > writes neither of them, nor the names, to any log`. **Not enforced for mail:** `LogMailer.send` (`apps/api/src/mail/mailer.ts`) writes `To:` (the staff email) and the full text, with the reset link, to the API log. This is by design until go-live; the code comment says it "must be replaced before any real staff email is loaded".

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
- [ ] **The staff record's identity "show"** is open to the Super Admin and the Academic Vice Principal, who already read the fields, and is logged; the student's and the relative's shows refuse them. Nothing is shown that the reader may not read.
- [ ] **The student list has no attendance column yet** (`04`), so the rule "the Spiritual Vice Principal sees the attendance percent only, not the average" has no route to check; it is checked when the column is built.

## Hand checks on the test environment, before go-live

- [ ] With the security headers in force: sign in, open a journal grid and type a mark, drag a lesson on the timetable board, receive a live notice, print a timetable (Print opens the PDF in a new tab), in the current Chrome, Edge, Firefox and Safari (supported browsers, Phase 10 answer 7). The browser tests run on Vite's development server, which sends no policy, so they do not prove this.
- [ ] Neon and Cloudflare R2 encrypt stored data (`13`: "Personal data is encrypted in transit and at rest"): a fact of the providers, confirmed in their dashboards in task 10.4.

<!-- generated by pnpm security:checklist: start -->

## The routes in numbers

- Routes of the application: 468, each called by the role harness as the 15 roles, an account without a role and nobody, in the own and in another branch.
- Without sign-in: 4. For the own account: 21. With a permission of the table: 443.
- Routes with a limit inside the route: 0.
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
