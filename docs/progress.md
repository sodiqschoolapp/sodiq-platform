# Progress log

Newest entry first. Each finished task adds an entry: what was built, what was left out, and what the next session must know. A session that stops half-way writes where it stopped.

## 4 October 2026: task 0.7a Roles and assignments

Task 0.7 was split by the owner: 0.7a is the roles, the assignments and the sign-in rules that follow the roles; 0.7b is the permission table, the guard and the harness. The entry below this one is about the load of the API tests and belongs to this task.

Built:

- `packages/shared/src/roles.ts`: `ROLES` (15), `roleSchema`, `Role`, `SCHOOL_WIDE_ROLES` (Super Admin, Senior Head Teacher), `STRICT_SIGN_IN_ROLES` (Super Admin, Academic Vice Principal), `MAX_SUPER_ADMINS`.
- `db/migrations/0009_assignments.sql`: the school-wide table `assignments` (account, role, branch, `valid_from`, `valid_until`, `created_at`, `given_by`, `ended_by`). Checks: one of the 15 roles; no branch for exactly the two school-wide roles; the end not before the start. Exclusion constraint: one account holds one role in one branch once at any moment. The application user may insert, and update only `valid_until` and `ended_by`.
- `apps/api/src/modules/access/`: `Assignments.give` and `end` (service, no route) with the audit entries `assignment.given` and `assignment.ended`; `currentAssignments(transaction, accountId, now)`, `rolesOf`, `notEnded(now)`.
- `give` refuses a role without its branch or with a branch it must not have, an unknown account or branch, a role the account holds in that branch already, and a fourth Super Admin. `end` refuses an unknown or ended assignment and the own Super Admin role.
- The first-account command creates the account and its Super Admin assignment in one transaction and refuses while a Super Admin assignment that has not ended exists.
- `Sessions`: `ActiveSession.assignments`; the idle limit is 30 minutes, 15 with a strict role, by the roles read at the request (`resolve`, `list`, `writeEndsByTime`). `SecondStepRule.required(roles)`: the second step is required with a strict role only.
- `catalog.test.ts`: the list `SCHOOL_WIDE_WITH_BRANCH` (only `assignments`), decided by the owner; `.claude/rules/database.md` describes it.
- Reviewed by the spec reviewer. No route was added or changed, so no permission review. Fixed from the review: an assignment that was taken back before it began no longer holds one of the 3 Super Admin places, no longer blocks the first-account command and cannot be ended a second time; a refused `give` leaves the caller's transaction usable; the test of the wrong branch names the refusal of the row filter; tests added (the list of sessions and "sign out everywhere" with the 15-minute limit, `end` in the wrong branch and of an end that is still to come, both sides of the 30 minutes for an account without a role and a Principal).

Left out, with the task that brings it:

- Permission table, guard, the branch of a request, `assignmentId` in the audit entries of routes, the own-request helper, the harness, JSON bodies only, `Cache-Control: no-store`, the request key per account, permission declarations of the existing routes: 0.7b.
- Routes and screens to give and end roles, who may give which role, the last active Super Admin rule, subject scope and Head Teacher appointments: 2.3. Class scope: 3.1.
- Roles in the session answer for the role and branch switchers: 0.8c. The alert "branch with no active Academic Vice Principal" and the banner "fewer than two Super Admins": 0.8c and 9.4b.
- The hand test of the command against `sodiq_dev` was not run: it would leave a Super Admin whose password only the session saw. The owner runs it.

Decided by the owner:

- Release 2 (task 2.5): Parent becomes a role without a branch, by a spec change and a migration that relaxes the branch check on `assignments`; what a parent sees is decided by the children, and the branch of a request comes from the child.
- 2.3: a typed date becomes 00:00 of that day in the time zone of the branch, or of the school for the two roles without a branch; screens show dates.
- An account without a current assignment can sign in (30 minutes, no required second step); blocking sign-in is the Inactive and Left status of 2.2.

Open, for the owner (from the review, not fixed):

- The database lets the application user empty or move an end that was written (`update (valid_until, ended_by)` has no condition). Only `Assignments.end` writes an end today. A trigger could make the end write-once ("not emptied, not moved later"); "not moved back before a moment that has passed" needs the clock and cannot be a trigger. Decide before 2.3.
- `give` accepts a `validFrom` in the past; the spec says nothing about backdating a role. Decide before the routes of 2.3.
- The idle limit is that of the roles at the request. A session of an Academic Vice Principal that was idle for 20 minutes and not seen since is in force again if the role ends before its next request (30 minutes then). And a session that was idle for 20 minutes when a strict role is given ends at its next request with the moment "last use plus 15 minutes", which lies before the role began. Both follow from "one reading of the roles decides"; an exact answer needs the start of the strict role in the calculation.
- A sign-in with "Trust this device" by an account that owes the set-up of a required second step, whose strict role then ends before the set-up: the session needs no second step any more, but its trust never begins (it begins only at the code or at the end of a set-up). The spec is silent.
- The first-account tests of 0.6a use the name "Islom Karimov", which is also the name of a real public person. `CLAUDE.md` asks for invented names. Not changed here; a small task of its own.

The next sessions must know:

- A test account holds no role. `kit.giveRole(accountId, { role, branchId?, validFrom? })` gives one, `kit.endRole(assignmentId, endedBy, branchId?)` ends one, `signInKit(app, { newAccountsHold: { role, branchId } })` gives every new account one. With the Academic Vice Principal of a branch the strict sign-in holds (second step required, 15 minutes); a branch comes from `insertBranch(database.migrator, name)`. At most 3 accounts can be Super Admin, so a suite with many strict accounts uses the Academic Vice Principal.
- `OptionalSecondStep` and the `secondStepRule` option of `createTestApp` are gone.
- `Assignments.give` and `end` for a role with a branch must run in `Transactions.run([branchId], ...)`: the audit entry belongs to the branch's log, and the row filter refuses it elsewhere (code 42501).
- "Has not ended" is `notEnded(now)`, never `valid_until is null or valid_until > now` alone: an assignment that was taken back before it began has its start as its end.
- 0.7b: the guard reads `session.assignments` (`id`, `role`, `branchId`; `branchId` is `null` for the two school-wide roles) and never the table again for the same request. `TwoStep.turnOff` and `overview` already use them. `assignments` is not filtered by branch: a query on it must filter by hand.
- 0.7b: the count of Super Admins relies on read committed (`Transactions.run`); under a stricter isolation the advisory lock would not be enough.
- 2.3: the errors of `Assignments` (`AssignmentBranchError`, `AssignmentOverlapError`, `TooManySuperAdminsError`, `UnknownAssignmentError`, `AssignmentAlreadyEndedError`, `OwnSuperAdminRemovalError`, `UnknownAccountError`) become coded refusals in the route; the "last active Super Admin" check runs in the same transaction, under the lock `give` takes.
- 2.6: `assignment.given` and `assignment.ended` of the two school-wide roles are in `audit_log_school`; those of a branch role are in the branch's `audit_log`.
- A new role needs `ROLES` and a migration for `assignments_role_check`; a test compares the two.

The next task is 0.7b.

## 4 October 2026: task 0.7a, the load of the API tests (written before `/finish-task`)

The full `pnpm test` was not stable on the owner's machine (8 processors, 6 GB of memory): in each of two full runs a different test hit the 30-second limit, each one a test that creates a database inside its body. Almost every API test file creates a database of its own, starts the application and hashes passwords, and vitest ran one file per processor.

Changed:

- `apps/api/vitest.config.ts`: `maxWorkers: 4`, at most four test files at once. With the other programs open it was not faster (about 233 s for the API tests with the cap, 206 to 222 s without it); with memory free the API tests took 186 s.
- Database creation moved out of test bodies into hooks, which have 60 s: the two tests "does not start on ..." in `jobs.test.ts` and "uses the test database it is given" in `test-database.test.ts`. No check was removed and no limit raised.

Measured with the cap, full runs without the cache: four in a row passed (4m12s, 3m58s, 4m00s, 4m01s). The fifth lost three test files (40 of 43, 932 of 941 tests) with no failed test in the output, and the three runs after it did not start: Node stopped with a fatal error within seconds, in every package. At that moment the machine had about 0.2 GB of memory free and 1 GB of 21 GB virtual memory, held by other programs. The fifth run was not looked into further; lost workers for lack of memory would fit, but that is not confirmed.

After the owner closed the other programs (about 1.1 GB of memory and 9 GB of virtual memory free): lint and type-check pass, and one full run without the cache passed in 3m10s (API tests 186 s, 941 of 941). The owner decided that one clean run is enough; CI runs the suite again on the pull request.

0.7b must know:

- The cap is 4 and its reason is in the config. 0.7b adds the route-by-role harness, the heaviest suite so far: watch the time and the memory of the full run, and lower the cap before raising a time limit.
- A test that needs a database of its own creates and drops it in `beforeAll` and `afterAll`, never in the test body.
- This machine has 6 GB of memory. The full `pnpm test` needs the other programs closed (other Claude sessions, OneDrive sync, VS Code windows, the browser): without free memory test files are lost or Node does not start at all, and that is not a fault of a test. Check the free memory before looking for a cause in the code.
- Three full runs in a row were not seen on this machine; the longest row was two, twice, with the other programs open.

## 4 October 2026: task 0.6d Trusted devices and account lock

Spec change at the start, by the owner (`docs/spec-changes.md`): the sign-in that starts the trust still asks for the second step where the account has one; removing a trusted device ends its session at once.

Built:

- `db/migrations/0008_trusted_devices_account_lock.sql`: `sessions.trust_requested`, `trusted_from`, `trust_ended_at` with two checks; three new end reasons (`expired`, `account_locked`, `trusted_device_removed`); `accounts.locked_at`, `locked_by`, `lock_reason` with three checks. No new table.
- The longest life (`session-life.ts`): a session is over 7 days after `created_at`, trusted or not, worked out on each request; the end is written as `expired` with the moment it was over (`auth.session_expired`). Of the idle end and the 7 days the earlier one counts.
- Trust: `trustDevice` in the body of `POST /api/auth/sign-in` (off when left out). A trusted session has no idle sign-out. Trust begins when the session owes no step: at sign-in without a second step, at the code, or at the end of a required set-up (`Sessions.beginTrust`); never with a first or reset password. The session cookie of a trusted device carries `Expires` (7 days after the sign-in); every other one ends with the browser.
- Trust ends with the session on sign-out, sign out everywhere, a password reset, an account lock and the removal of the device. The own password change keeps the session and ends its trust (`auth.trust_ended`); it still needs the current password.
- Routes: `GET /api/auth/trusted-devices`, `DELETE /api/auth/trusted-devices/:id` (own devices only; anything else is 404 `not_found`; removing the device that asks clears the cookie). The session answers gained `trustedUntil`, the rows of `GET /api/auth/sessions` gained `trusted`.
- `AccountLocks.lock` and `unlock` (service, no route): a lock needs a reason, ends all sessions (`account_locked`) and writes `account.locked`; a locked account gets 403 `account_locked` after the right password only (`auth.sign_in_locked`); `Sessions.resolve` refuses a locked account. Lock and sign-in both take the row of the account with `select ... for update`.
- Audit actions: `auth.device_trusted`, `auth.trust_ended`, `auth.trusted_device_removed`, `auth.session_expired`, `auth.sign_in_locked`, `account.locked`, `account.unlocked`; `auth.sign_in` carries `details.trustRequested` when the switch was on.
- Reviewed by the spec reviewer and the permission reviewer. Neither found a way to another account's devices or sessions, past the 7 days, or to trust before the second step. Fixed from the reviews: the cookie of a trusted device had no end and was gone when the browser closed; a password change now checks inside its transaction that its own session is still open; `TwoStep.remove` locks the sessions in the order of `writeEndsByTime`; tests added (cookie attributes, exact keys of the device list, a device whose 7 days are over, the code and a lock at the same moment, a password change after its session ended or its account was locked, a locked account with an expired password).

Left out, with the task that brings it:

- Routes for lock and unlock, who may lock whom, the last active Super Admin rule, a shared schema for the reason, who may read `lock_reason`: 2.3.
- "The teacher's future lessons go to needs a teacher": 5.7a. Inactive and Left status that block sign-in: 2.2.
- The idle limit and the second-step rule by real roles: 0.7.
- The switch with its note "do not use on a shared computer", the device list, translations (also of `account_locked`): 0.8a.
- Own sign-in history: 2.6.

Decided by the owner after the reviews:

- A trusted session whose second step is removed keeps its trust; no spec change. Turning off where optional needs a right code. The reset by an administrator comes with a password reset at 2.3, which ends every session and so the trust. An unreadable secret is the rare single row left after the start check, and that session proved a code once already.

Open, for the owner:

- A sign-in to a locked account with the right password is not limited: each one writes an `auth.sign_in_locked` entry. Low risk; decide in 10.3.
- A code that arrives after the idle limit while a second request of the same session is in flight can end the session as idle just after its trust began. It fails on the safe side.

The next sessions must know:

- `Sessions.writeIdleEnds` is now `Sessions.writeEndsByTime`. Whatever ends all sessions of an account calls it first; it locks the open sessions of the account ordered by id.
- An `ActiveSession` has `trustedUntil`. `SignInOrigin` needs `trustDevice`; `kit.signIn(login, password, cookies, true)` signs in with the switch.
- `Sessions.changePassword` answers `{ trustEnded }`; `TwoStep.confirm` answers `{ recoveryCodes, trustedUntil }` and `TwoStep.pass` the moment a trusted session ends or `null`. A route that begins or ends trust calls `cookie.keep(until)` (`SessionCookieJar`).
- A test that holds a transaction open and waits for the other side: `waitingForALock` in `account-locks.test.ts` reads `pg_locks`; `pg_stat_activity` hides the wait of another database user. Release the held transaction in a `finally`, or a failure hangs the suite.
- 0.7: the two new routes need their permission declaration (any signed-in account, own data) and a wrong-account case in the harness. The Principal's "changes nothing" rule must decide about `DELETE /api/auth/trusted-devices/:id`: it works like sign-out; ask the owner. `SecondStepRule.required()` by roles changes when trust begins at sign-in (`Sessions.signIn`). A role that requires the second step, given to a person with a trusted session, turns that session into "set up required" while it stays trusted. Load the roles in `Sessions.resolve` beside the account, where `locked_at` is read on every request.
- 2.3: `AccountLocks.lock(transaction, { accountId, lockedBy, reason, requestId })` and `unlock(transaction, { accountId, unlockedBy, requestId })` check no roles and throw `OwnAccountLockError`, `UnknownAccountError`, `AccountAlreadyLockedError`, `AccountNotLockedError`, `LockReasonError`; the route turns them into coded refusals and takes `lockedBy` from the session. The last-Super-Admin check must run in the same transaction, after the row of the account is locked. `account.locked` and `account.unlocked` are school-wide entries: a reader of one branch's log does not see them. A second-step reset must come with a password reset: alone it ends no session and no trust. The question of trust after a second-step reset is settled by that password reset, which ends every session of the account.
- 2.6: the support account ("locked by default, opened for at most 24 hours") does not fit the lock as built: a lock needs a `locked_by` other than the account and a reason, and there is no stored moment for the 24 hours.
- 0.8a: after the password, `trustedUntil` of the answer says whether the device is trusted and until when; with a second step it is `null` until the code. The browser keeps the cookie by itself (`HttpOnly`). After a forced password change the screen says to sign in again to trust the device.
- 0.10: migration 0008 on a database with open sessions: a session older than 7 days ends at its next request. Nothing is deployed yet.
- A new end reason of a session needs a migration (`sessions_end_reason_check`), as before.

The next task is 0.7.

## 4 October 2026: task 0.6c Two-step sign-in

Task 0.6c was split by the owner: 0.6c is the second step, 0.6d is trusted devices, the longest life of a session and the account lock. Where an older entry below names 0.6c for one of those three, read 0.6d.

Spec change at the start, by the owner (`docs/spec-changes.md`): the password change always needs the current password, also on a trusted device; every session ends 7 days after sign-in at the latest.

Built:

- `db/migrations/0007_two_step.sql`: the school-wide tables `account_second_steps` (encrypted secret, moment of confirmation, last used step, count of wrong codes) and `second_step_recovery_codes` (hashes), and `sessions.second_step_passed_at`.
- `totp.ts`: the code of an authenticator app (RFC 6238) with `node:crypto`, base32 and the `otpauth://` address. A code counts for its own 30 seconds and the step before and after, once.
- `SecondStepSecrets`: the secret at rest, AES-256-GCM with `SECOND_STEP_KEY`, stored as `v1:...` with the account bound in. `SECOND_STEP_KEY` (32 bytes, base64) is checked at start; `.env.example`, `ci.yml`, `apps/api/turbo.json` and `apps/api/vitest.config.ts` hold the public local value.
- `SecondStepKeyCheck.run()`, called by `main.ts` and `worker.ts`: the start is refused when the oldest stored secret does not decrypt. Not run by `pnpm api:client`.
- `TwoStep`: set-up, confirmation with ten recovery codes, the code at sign-in, turning off where optional, the count of wrong codes per account, reset by an administrator (no route).
- `SecondStepRule`: required for every account until 0.7; `secondStepRequired(roles)` holds the rule of the spec.
- `SessionGuard`: one owed step at a time, in the order second step, forced password change, set-up of a required second step.
- Routes: `POST /api/auth/second-step`, `GET /api/auth/second-step`, `POST /api/auth/second-step/set-up`, `.../confirm`, `.../turn-off`. The answers of `POST /api/auth/sign-in` and `GET /api/auth/session` gained `secondStep` (`not_needed`, `pending`, `set_up_required`, `passed`).
- Error codes: `second_step_required`, `second_step_set_up_required`, `second_step_code_wrong`, `second_step_already_on`, `second_step_not_on`, `second_step_cannot_turn_off`.
- Audit actions: `account.second_step_started`, `account.second_step_on`, `account.second_step_off`, `account.second_step_reset`, `account.second_step_unreadable`, `auth.second_step_passed`, `auth.second_step_failed`, `auth.recovery_code_used`; `auth.sign_in` carries `details.secondStep`.
- Reviewed by the spec reviewer and the permission reviewer. Neither found a way past the second step or a stored or logged secret. Fixed from the reviews: tests of attempts at the same moment (they fail without the row lock; tried), of the 24 hours and the 15-minute cap of the count, of every route in the states "owes the code" and "passed with a reset password"; a set-up can no longer overwrite a second step in force; removing a second step empties the passed moment of every session; an unreadable started set-up leaves an audit entry; weak tests made exact.

Left out, with the task that brings it:

- Trusted devices, the longest life of a session (7 days), account lock and unlock: 0.6d.
- "Required" from real roles: 0.7. Routes for the second-step reset, who may reset whom: 2.3 (now in its build-plan line).
- Screens, the QR picture, translations: 0.8a.
- New recovery codes without a new set-up, and moving to a new phone while the old one works: the spec names neither. Today: turn off and set up again where optional, or a reset by a Super Admin.
- `Cache-Control: no-store` (already a 0.7 item from 0.6a) matters more now: the answers of set-up and confirm hold the secret and the recovery codes.

Decided by the owner after the reviews:

- 0.6d begins with a `/spec-change` for the "Trust this device" row, which still says "with no idle sign-out and no second step": the sign-in that starts the trust asks the code, and removing a device ends its session. Both are in the 0.6d line of the build plan, not yet in the spec.
- 2.3: a second-step reset by an administrator always goes with a password reset, so the one-time password handed to the person is the proof; the exact wording is decided there. Reason: after a reset of the second step alone, anybody who has the password could set up the new one, from a new sign-in or from a session that was waiting for the code.
- `Cache-Control: no-store` stays at 0.7.

Open, for the owner:

- 0.10: if the oldest stored secret is itself damaged, the API and the worker do not start until that row is removed by hand; the deploy notes should say how. The real `SECOND_STEP_KEY` is a secret of the server (`openssl rand -base64 32`), the same for API and worker, and must be kept with the backups in mind: without it no stored second step can be read.

The next sessions must know:

- Every developer machine needs the `SECOND_STEP_KEY` line of `.env.example` in `.env`; without it `pnpm dev`, `pnpm api:client` and the first-account command stop at start. The tests do not need it.
- Route tests whose accounts should sign in with a password alone: `createTestApp({ ..., secondStepRule: new OptionalSecondStep() })` (`sign-in-kit.ts`). Under the rule of the application a session of `kit.fullSession` reaches only the set-up; `kit.completeSession` also sets up a second step and returns `secret` and `recoveryCodes`. `kit.codeOf(secret)` is the code of the clock's present step; a code counts once, so advance the clock by 30 seconds before the next one.
- A new route is refused in the states "owes the code", "must change the password" and "must set up" unless it carries `@AllowedBeforeSecondStep()`, `@AllowedBeforePasswordChange()` or `@AllowedBeforeSecondStepSetUp()`. Almost no route should.
- 0.6d: trust must not start before `second_step_passed_at` is set, and nothing may be built on `known_devices`: a right password alone writes a row there. A trusted session of an account with a second step still passes it once. New end reasons need a migration (`sessions_end_reason_check`).
- 0.7: `SecondStepRule.required()` must answer `secondStepRequired(roles)` with the roles of the account; `second-step-key-check.test.ts` ("the rule of the second step in the application as it runs") and the strict expectations of `two-step.test.ts` change with it; the four suites with `OptionalSecondStep` can then drop it for accounts without the two roles. `SECOND_STEP_ROLES` is `SHORT_IDLE_ROLES`: rename both in one place. The five new routes need their permission declaration (any signed-in account, own data).
- 0.7, a role given to a person who has no second step: their open sessions fall into "set up required" at the next request, by themselves.
- 2.3: `TwoStep.resetByAdministrator(transaction, { accountId, resetBy, requestId })` throws `OwnSecondStepResetError` and `UnknownAccountError`; it ends no session. The entry `account.second_step_reset` is school-wide.
- 2.6: second-step events for the own sign-in history are found by actor (the account); `auth.second_step_failed` has the session as record.
- 0.8a: after the password, read `secondStep` of the answer: `pending` shows the code field (a recovery code goes into the same field; spaces and hyphens are ignored), `set_up_required` the set-up. `too_many_attempts` comes with `Retry-After` here too. After a forced password change the screen says to sign in again to trust the device (decided by the owner for 0.6d).
- A key change later: the new key becomes version 2 with a variable of its own in `config.ts` and `SecondStepSecrets`; version 1 stays readable until no stored secret has it. No migration.

The next task is 0.6d.

## 4 October 2026: task 0.6b Limits, resets and idle sign-out

Changed by the owner at the start: password reset by email and the mail service moved to 2.3 (`docs/build-plan.md`); an account has no email address before 2.2.

Built:

- `db/migrations/0006_sign_in_limits_idle_resets.sql`: `sessions.last_used_at` and `user_agent`, three new end reasons (`idle`, `sign_out_everywhere`, `password_reset`); `accounts.password_reset_by` and `password_reset_at`; the school-wide tables `known_devices` and `sign_in_throttle`.
- Attempt limit (`sign-in-throttle.service.ts`): per login and device; five failures, then a wait of 30 seconds that doubles up to 15 minutes; 429 `too_many_attempts` with `Retry-After`; unknown logins counted alike; forgotten after 24 hours or a right password; each attempt removes up to 50 forgotten rows. It also covers the current password of `POST /api/auth/password`.
- Device cookie `__Host-sodiq_device` (`apps/api/src/http/device-cookie.ts`), set at every successful sign-in.
- Idle sign-out in `Sessions.resolve`, from `last_used_at` and the injected clock; `idle-limit.ts` holds the rule per role.
- Routes: `GET /api/auth/sessions` and `POST /api/auth/sign-out-everywhere` (own session only). `GET /api/auth/session` and the sign-in answer gained `passwordResetBy`.
- `PasswordResets.byAdministrator` (service, no route): one-time password for 24 hours, forced change, all sessions ended, the count of failed sign-ins of the login cleared, audit entry.
- Audit actions: `auth.sign_in_failed`, `auth.password_change_failed`, `auth.session_idle`, `auth.sign_out_everywhere`, `account.password_reset`.
- Reviewed by the spec reviewer and the permission reviewer. Fixed from the reviews: the count of an attempt no longer ends as a fault when its row is removed at the same moment; sessions already over by time keep their own end when all sessions are ended; a wrong current password leaves an audit entry; the last use never moves backwards; missing tests added.
- `apps/api/src/testing/sign-in-kit.ts`: `signInKit(app)` with `newAccount`, `signIn`, `firstSession`, `fullSession`, `probe` for route tests that need a signed-in caller.

Left out, with the task that brings it:

- Password reset by email, the mail service, the route of the reset by an administrator and who may reset whom: 2.3.
- The idle limit by real roles: 0.7 (see below). Trusted devices (no idle sign-out) and the second step: 0.6c.
- The report "entries made within 48 hours of a reset" (edge cases, "Accounts and sign-in") is in no task: it belongs to 2.6 or 8.9, whichever builds audit reports. The data is there: `account.password_reset` entries in `audit_log_school`.
- A screen for the session list, the text "your password was reset by X", translations: 0.8a. Own sign-in history: 2.6.
- Ending one other session from the list: the spec names only the list and "sign out everywhere".

Decided by the owner after the reviews (nothing changed in code):

- 10.3: open risk, accepted for the pilot. All browsers that never signed in to an account share one count of failed sign-ins per login. Somebody who knows a login (they are guessable) and sends one wrong password each time the wait ends keeps every new browser out of that account, also on the first day, when no browser is known yet; a reset clears the count only until the next guess. 10.3 decides between the two candidate answers: count unknown devices per login and network address (needs a spec change, the spec says "not per network address": `/spec-change`), or a human check for unknown devices after repeated failures.
- 0.6c: a session has no longest life: used every 14 minutes it lives until a password change, a reset or "sign out everywhere". Consider a longest life of 7 days for every session, matching trusted devices.
- 10.2: `known_devices` has no cleanup: each sign-in without a device cookie adds a row. The cleanup job of 10.2 should cover it together with `sign_in_throttle`; the application user has no delete right on `known_devices` today, so that needs a migration.
- 2.3: `PasswordResets.byAdministrator` hashes the new password inside the caller's transaction, as `Accounts.create` does since 0.6a. The route should keep that transaction short.
- 0.10: migration 0006 on a database with open sessions: a session older than 15 minutes ends as idle at its next request. Nothing is deployed yet.
- The audit entry `auth.password_change_failed` stays.

The next sessions must know:

- Whatever ends all sessions of an account calls `Sessions.writeEndsByTime(transaction, accountId)` first (named `writeIdleEnds` before 0.6d) (0.6c: account lock; 2.3: lock and unlock).
- 0.7: the Principal's "changes nothing" rule must exempt `POST /api/auth/password`, sign-out and sign-out-everywhere. Load the roles in `Sessions.resolve` beside the account, so the idle limit follows a role change at once.
- 2.3: the reset entry `account.password_reset` is school-wide (`branchId: null`), so a reader of one branch's log does not see it. A `resetBy` that is no account ends as a foreign-key fault: the route passes the session's account.
- 2.6: the own sign-in history finds `auth.sign_in_failed` by its record (the account); its actor is empty. The 48-hour report can only come from the `account.password_reset` entries: `accounts.password_reset_at` is emptied by the password change.
- 0.8a: the browser name in the session list is text a caller chose: show it as plain text.
- 0.7: today every session gets the 15-minute idle limit (`Sessions.idleLimitMs`). 0.7 must make it call `idleLimitMs(roles)` with the roles of the account: 30 minutes, 15 with Super Admin or Academic Vice Principal. The test "0.7: today every session gets the 15-minute limit" in `idle-sessions.test.ts` must be changed then (29:59 and 30:00 for the other roles), and `SHORT_IDLE_ROLES` in `idle-limit.ts` must use the role names of 0.7.
- 0.7: the two new routes need their permission declaration (any signed-in account, own data). `GET /api/auth/sessions` must stay limited to the caller's account.
- 10.2: `sign_in_throttle` is cleaned only by sign-in attempts, 50 rows each. A cleanup job should take this over (rows whose `last_failure_at` is older than 24 hours).
- A test whose session must survive more than 15 minutes of clock time has to use it on the way (`advanceInUse` in `auth.test.ts`), or the session is over.
- A route that the web app calls by itself on a timer (0.9 unread count, 8.3b) is a use and would keep a session alive for ever: such a route must not go through `Sessions.resolve` as it is, or resolve needs a way to read without refreshing. Decide in 0.9.
- 0.6c: a trusted device has no idle sign-out: `Sessions.resolve` and `Sessions.list` both apply the limit. Trust is not the device cookie: `known_devices` only separates the counts of failed sign-ins and opens nothing. New end reasons need a migration again.
- 2.3: `PasswordResets.byAdministrator(transaction, { accountId, resetBy, requestId })` throws `OwnPasswordResetError` and `UnknownAccountError`; the route turns them into coded refusals and checks who may reset whom before calling. A reset clears the count of failed sign-ins of that login on every device (`SignInThrottle.forget`), in the same transaction.
- 2.2: `passwordResetBy` in the session answer is a login; with staff records it should become a name.
- 0.8a: `too_many_attempts` comes with `Retry-After` in seconds; the sign-in page should show the wait. The browser must keep the device cookie (it is `HttpOnly`; nothing to do in code).
- A new coded refusal with a wait: `new ApiException(code, 429, seconds)`.

The next task is 0.6c.

## 4 October 2026: task 0.6a Accounts and sessions

Built:

- `db/migrations/0005_accounts_sessions.sql`: `accounts` (login, Argon2id hash, forced change, expiry of the first password; no name) and `sessions` (hash of the token, start, end with reason). Both school-wide. The application user cannot delete an account, change a login, or delete or alter a session; it can only end one. A check constraint refuses a forced password change without an expiry.
- `apps/api/src/modules/auth/`: `Accounts.create` (generated login, random first password valid 7 days, shown once), `Sessions` (sign-in, resolve, sign-out, password change), `SessionGuard` (global), `AuthController`, `FirstAccount` and the command `pnpm auth:first-account -- --first-name <name> --last-name <name>`.
- Routes: `POST /api/auth/sign-in` (public), `GET /api/auth/session`, `POST /api/auth/password`, `POST /api/auth/sign-out`. `GET /api/health` is declared public on its handler.
- `apps/api/src/http/`: `ApiException(code, status)` and eight new error codes; the session cookie (`__Host-sodiq_session`, read by hand); the cross-site check for changing requests; `@RequestId()`; `@ReturnsNothing()` (204).
- Password hashing with Node's own `crypto.argon2` (no library); `engines.node` is `>=24.7 <25`.
- Spec change, by the owner: a short list of routes works without sign-in (`docs/spec-changes.md`). `public-routes.test.ts` holds the exact list.
- Reviewed by the spec reviewer and the permission reviewer. Fixed from the reviews: the public-routes test now sees inherited handlers; a first password older than 7 days is refused as the current password inside an open session; a login that cannot be a login (zero byte) no longer reaches the database; missing tests added (cross-site check with a real session, other parameters of a stored hash, two password changes at once, HEAD and other spellings of a path).
- Hand test against `sodiq_dev`: command, sign-in, forced change, sign-out. The two accounts it made were removed afterwards by the owner's order; their audit entries remain in `audit_log_school`.

Left out, with the task that brings it:

- A route and screens to create accounts, lock and unlock, the last Super Admin rule: 2.3. The Super Admin assignment written by the command, `assignmentId` in audit entries, role, branch and scope checks, the route-by-role harness: 0.7.
- Attempt limit, reset by an administrator and by email, idle sign-out, session list, "sign out everywhere", failed sign-ins as records: 0.6b. Second step and trusted devices: 0.6c.
- Link from an account to a person or staff record, "inactive cannot sign in", re-hiring: 2.2. Printed slips and the "accounts never used" report: with the staff screens.
- A request key tied to the account that sent it (noted for 0.6a in the 0.4b entry): moved to 0.7, where the guard supplies the account.
- Screens and translations: 0.8a.
- From the reviews, moved to 0.7 by the owner: accept JSON bodies only (a form-encoded body is accepted today; the cookie and the cross-site check still stand in front of it), and `Cache-Control: no-store` on API answers.
- No test reaches the re-check of the password hash inside sign-in (a password change between the check and the session); the code was read by both reviewers.

The next sessions must know:

- Every route is refused without a session unless its handler has `@Public()` (`session.guard.ts`). A new public route is a decision for the owner and must be added to `PUBLIC_ROUTES` in `public-routes.test.ts` with a reason. `@Public()` works on a handler only.
- A route gets the caller with `@CurrentSession() session: ActiveSession` (session id, account id, login). Never take an account id from the path or the body for "own" actions.
- Route tests that need a signed-in caller: see `firstSession` and `fullSession` in `auth.test.ts` (create an account through `Accounts`, sign in, send the `Cookie` header by hand). Test-only controllers need `@Public()` on each handler or a session.
- A coded refusal: add the code to `ERROR_CODES` (`packages/shared`), its text to `error-response.ts`, and throw `new ApiException(code, status)`.
- A route without a body in its answer: `@ReturnsNothing()`. Audit entries of a route carry `@RequestId()`.
- 0.6b: the attempt limit must also cover the current password of `POST /api/auth/password`. Idle sign-out goes into `Sessions.resolve`; public routes do not call it, so they do not refresh the last use. A reset must set `must_change_password` and `password_expires_at` together (24 hours). A session with an expired first password can only be read and signed out: it needs the reset. Signing in again leaves the old session of that browser open until it ends by time. `end_reason` has a check constraint: new reasons need a migration.
- 0.6b, password reset by email: its routes are public and go into `PUBLIC_ROUTES`.
- 0.7, two items from the 0.6a reviews: (1) accept only JSON bodies on the API (today a form-encoded body is parsed too, so a plain HTML form of another site can build a valid body; refuse other content types before the routes); (2) send `Cache-Control: no-store` on every API answer, so a shared classroom computer keeps no answer of a GET route.
- 0.7: the permission guard builds on `SessionGuard`; `POST /api/auth/password` must stay allowed for every role, also the Principal. `Sessions.resolve` must refuse locked accounts once that state exists. The command must also write the Super Admin assignment and then refuse by "a Super Admin exists". The harness must list routes the way `routesOf` in `public-routes.test.ts` does (inherited handlers included) and should also look at the Express router for what is not a controller.
- 0.9: a Socket.IO gateway is not behind `APP_GUARD` nor behind the cross-site check; it needs its own session check at the handshake.
- 0.8a: the web client sends JSON and needs no CSRF token. The first Playwright sign-in shows whether Chromium accepts the `__Host-` cookie with `Secure` on `http://localhost`; if not, name and `Secure` become configuration (`docs/decisions.md`). The sign-in field should switch off auto-capitalisation: a login is compared exactly.
- 0.10: Node 24.7 or later on Render. `trust proxy` must be set, or the `Origin` fallback of the cross-site check refuses HTTPS requests of browsers that send no `Sec-Fetch-Site`. The first-account command runs on the server as `node dist/modules/auth/cli.js first-account --first-name ... --last-name ...` with `DATABASE_URL` of `sodiq_app`.
- In Git Bash here a heredoc also loses backslashes (`\\u`, `\\.` arrive as `\u`, `\.`): use the editor tools for anything with a backslash.

The next task is 0.6b.

## 4 October 2026: spec change, routes that work without sign-in

Made at the start of task 0.6a (`docs/spec-changes.md`). The next sessions must know:

- 8.3a: the health check must be exempt from the rule "every request carries the application version" (`edge/system-behaviour`): the uptime monitor cannot send a version.

## 4 October 2026: task 0.5b Jobs

Built:

- `db/migrations/0004_job_queue.sql`: schema `pgboss` of pg-boss 12.36.0 (schema version 44), owned by `sodiq_migrator`, with the rights of `sodiq_app` table by table. pg-boss is pinned exactly and starts with `migrate: false, createSchema: false`; `@opentelemetry/api` 1.9.1 is declared because pg-boss cannot load without it (approved by the owner).
- `apps/api/src/jobs/`: `defineJob` and the list `job-list.ts` (empty); `Jobs.enqueue(transaction, definition, { branchIds, data })`, which writes the job in the caller's transaction; `JobRunner`, which runs a handler inside `Transactions.run(branchIds, ...)` and `RequestKeys.runOnce` with the job id as key; `JobQueue`, the one pg-boss instance, not exported.
- The worker: `apps/api/src/worker.ts` and `worker.module.ts`, the same modules as the API without HTTP. `pnpm dev` now runs web, API and worker (`dev:worker`, its own watch build in `apps/api/dist-worker`); `start:worker` for the server.
- Tests: no job after a rollback (the done-when), change, audit entry and job committed together, no job after a failed keyed work, the refusals of `enqueue`, the handler sees only the job's branches, a run that fails half-way is undone and tried again, a job delivered twice changes the data once, the stored failure holds no other field of the error, the worker entry point, and the rights of the application user in schema `pgboss`.
- `catalog.test.ts`: the schemas are exactly `public` and `pgboss`; in `pgboss` every object belongs to `sodiq_migrator`, the tables are those of pg-boss 12.36.0, the effective rights of `sodiq_app` are the listed ones, and there is no view and no `SECURITY DEFINER` function.
- Reviewed by the spec reviewer. Its must-fix is fixed: a job may only name branches of the transaction that enqueues it. No route was added, so no permission review.
- Test stability, found by repeated full runs: `destroy` of a test database waits until no session is left before the drop; the hook timeout of the API tests is 60 s; `apps/web/tooling/api-types.test.ts` has a limit of 30 s (it starts a Node process and came close to 5 s when builds ran beside the tests).

Left out, with the task that brings it:

- Any real job and handler: 0.9 (delivery of notifications) is the first.
- Scheduled jobs (`schedule: true`): 9.2c with the nightly check.
- Alerts on failed jobs, a dead-letter queue, how long failed jobs are kept: 10.2. The Render worker service: 0.10.
- Not done from the review, by choice, for the owner to confirm: the message of a failure is stored in the job row and logged as thrown (the same rule as for a 500; some PostgreSQL messages repeat a value); `sodiq_app` may update all of `pgboss.version`, not only its timestamp columns (narrowing it means editing the migration and applying it again in `sodiq_dev`); no test ties the migration file to the output of `pg-boss plans create`.

The next sessions must know:

- A new job: `defineJob({ name, data, options })` beside the code that enqueues it, add it to `JOB_DEFINITIONS` in `job-list.ts`, and name its handler with `jobRunner.handle(definition, handler)` in a provider's `onModuleInit`. The worker refuses to start while a definition has no handler. `data` holds ids only: it is readable from a transaction of any branch.
- Enqueue inside the `Transactions.run` of the change, next to `audit.record`. The job's `branchIds` must be among the branches of that transaction; a school-wide transaction (`[]`) cannot enqueue for a branch. Ask the owner before loosening this.
- A handler decides from stored moments and the injected clock, never from the fact that it was triggered: a job can run late or twice (`.claude/rules/api.md`).
- 0.9: the runner's repeat safety covers database changes only. A handler that sends something outside the database (Telegram, email) must send after its transaction commits and must be safe when the send is repeated.
- A route test whose route enqueues a job: `createTestApp({ database: database.app, jobsDatabaseUrl: database.appUrl })`. Tests of a handler: build `JobQueue`, `Jobs` and `JobRunner` as in `jobs.test.ts`, with `pollingIntervalSeconds: 0.5` and the helpers of `src/testing/sample-job.ts`.
- 10.2: a job in state `failed` does not prove that its work was not done (worker died after the commit; a run longer than 15 minutes). The request key with the job id and scope `job:<name>` is the proof. pg-boss has one retention for completed and failed jobs (`deleteAfterSeconds`, 7 days): "failed jobs for 30 days" needs every finished job kept for 30 days or a dead-letter queue.
- 0.10: the worker on Render runs `pnpm --filter @sodiq/api start:worker` from the same build as the API, with `DATABASE_URL` of `sodiq_app`. API and worker stop at start when schema `pgboss` is missing or of another version, so migrations run first.
- An upgrade of pg-boss: the new exact version and a new migration made from `pg-boss plans migrate` in one pull request; update `JOB_TABLE_RIGHTS` in `catalog.test.ts` if tables change. With `persistQueueStats` or `registerInstance` turned on, pg-boss needs rights it does not have; ask first.
- pg-boss logs a failed run as an error line; in the tests these lines (`sample.note ...: The run failed.`) are expected.
- In Git Bash here a heredoc breaks on apostrophes (again in this task): write a script file with the editor tools and run it.

The next task is 0.6a.

## 4 October 2026: task 0.5a Audit log

Task 0.5 was split by the owner: 0.5a is the audit log, 0.5b is jobs (pg-boss, the worker).

Built:

- `db/migrations/0003_audit_log.sql`: `audit_log` (belongs to a branch, standard branch filter) and `audit_log_school` (events without a branch), with the same columns: id, occurred_at, actor_id, person_id, assignment_id, action, record_type, record_id, old_value, new_value, reason, details, request_id. Both are partitioned by month (UTC borders) from October 2026 to December 2029, with a default partition each.
- Append-only: `sodiq_app` has select and insert on the two parents and no right on any partition. Tests prove that update, delete and truncate are refused, that a partition cannot be reached directly, and read the rights of every partition from the catalog.
- `Audit.record(transaction, entry)` (`apps/api/src/modules/audit/audit.service.ts`), in a global `AuditModule`: writes in the caller's transaction with the moment from the injected clock. `branchId: null` writes to `audit_log_school`.
- `catalog.test.ts`: `audit_log_school` and its partitions are listed as school-wide (names generated for the range of the migration).
- Reviewed by the spec reviewer: no must-fix finding; the weak tests it found are fixed. No route was added, so no permission review.

Left out, with the task that brings it:

- pg-boss, the worker entry point, jobs in the transaction, `pnpm dev` and CI wiring, the catalog checks for schema `pgboss`: 0.5b.
- Journal cell history (also append-only and partitioned): 6.1.
- Reading routes, rights per role, the screen, exports: 2.6.
- Foreign keys of `actor_id` and `person_id`, and a column for the system actor: 0.6a. Foreign key of `assignment_id`: 0.7. A flag for the support account: 2.6.
- No speed test at the spec's data volume: 10.1.

The next sessions must know:

- Every change to timetable, journal, results, people and settings: `await audit.record(transaction, { branchId, actorId, action, record, oldValue, newValue, ... })` inside the `Transactions.run` of the change. An entry for a branch the transaction does not work for is refused by the row filter. Left out and `null` values are stored alike; a cleared field is `{ field: null }`.
- A query on the audit log should carry a date range, or PostgreSQL opens every partition.
- A migration whose code needs the new types: `pnpm db:migrate` builds the API first and fails until the types are regenerated. Way out used here: in `apps/api`, `pnpm exec tsc -p tsconfig.build.json` (it emits despite the type errors), `node dist/database/cli.js migrate`, then `pnpm db:codegen`. Or write and apply the migration before the code that uses it.
- Adding months (before mid-2029; a test fails from 1 July 2029): a new migration that creates the partitions before those months begin and while the default partitions are empty. Creating a partition locks the parent and scans the default partition; if the default partition holds a row of the new month the migration fails. Each new `audit_log` partition needs row security and the `branch_filter` policy and no grant; extend the range in `auditSchoolPartitions()` of `catalog.test.ts`.
- 0.5b, found while planning: pg-boss is 12.36.0 (Node 22.12 or later). Its schema SQL comes from `pg-boss plans create --schema pgboss` and goes into a numbered migration (remove `begin` and `commit`: the runner refuses them); the application starts it with `migrate: false, createSchema: false`. Pin the exact version; an upgrade means a new migration from `plans migrate`. A job is sent in our transaction with `boss.send(name, data, { db: fromKysely(transaction) })` (`fromKysely` is part of pg-boss). Check first whether `createQueue` (default `partition: false`) needs more than insert rights; otherwise queues are created in the migration. Jobs carry `branchIds` and the handler opens `Transactions.run(branchIds, ...)`; payloads hold ids only. The catalog test "keep everything in schema public" must be extended. The notes of 0.2, 0.3 and 0.4b for 0.5 below still hold.
- 0.6a: sign-ins and the first Super Admin command are school-wide entries (`branchId: null`, and for the command `actorId: null` with the command named in `details`).
- 0.7: the guard supplies `assignmentId` and `requestId` for audit entries.
- 2.6: the audit screen must apply the field-group rules of people-roles-accounts ("Personal data and the audit log") to `old_value` and `new_value`, so a role that sees identity or financial fields hidden does not read them through the audit log. 2.6 also decides who reads `audit_log_school` entries (sign-ins, settings): the spec gives the Principal and Academic Vice Principal "their branch" only, and at database level any transaction can read that table. Entries about a branch's person that are school-wide (sign-ins, relatives) are not in that branch's `audit_log`.
- 0.10: `sodiq_migrator` owns the audit tables and could change them, so its password exists only in the deploy secret and is never used by the running application.

The next task is 0.5b.

## 4 October 2026: task 0.4b API foundations, database side

Built:

- `db/migrations/0002_branches_branch_filter_request_keys.sql`: the minimal `branches` table (id, name), the function `app_branch_ids()`, the `request_keys` table, and the policy pattern `branch_filter` as a comment for every later branch table.
- Branch filter: the transaction setting `app.branch_ids`, a list of branch ids. Nothing set shows no rows; a value that is not a list of uuids is an error. Rows of another branch cannot be read, written, moved or deleted.
- `Transactions.run(branchIds, work)` (`apps/api/src/database/transactions.ts`): the one place a transaction with the filter is opened. It refuses a database user that is not subject to row security.
- Repeat-safe requests: `@RequestKey()` (header `Idempotency-Key`, a uuid) and `RequestKeys.runOnce(transaction, { key, scope, input }, work)`. A repeat does not run the work and gets the stored answer; the same key for another action, other input or other branches is a 409; work that fails leaves no key.
- `ValidParams` for path parameters, described in OpenAPI like body and query.
- Lint rules, each with a test: raw request decorators of `@nestjs/common` only inside `apps/api/src/http/`; the name `app.branch_ids` only in `transactions.ts`.
- Catalog test (`apps/api/src/database/catalog.test.ts`): every table is branch-filtered in the standard way or named with a reason as school-wide; every view has `security_invoker = true`; no materialized view; no `SECURITY DEFINER` function outside the allow-list; `sodiq_app` is subject to row security; `public` is the only schema.
- The sample route of the build plan exists only in tests: `apps/api/src/testing/keyed-sample.controller.ts`. No route was added to the running application.
- Reviewed by the spec reviewer and the permission reviewer; their findings are fixed or listed below.

Left out, with the task that brings it:

- The branch list from the signed-in user: 0.6a (session) and 0.7 (guard). Today the caller of `Transactions.run` passes it.
- A request key tied to the account that sent it, and an error code of its own for the 409: 0.6a.
- Jobs that carry the branch, audit in the transaction: 0.5.
- The full branch record and the right to create and edit branches: 1.1. The application user can only read `branches`.
- How long request keys are kept, and the cleanup job: 8.3c. The application user has no delete right on `request_keys`.
- A time limit for a repeat that waits for the first request with the same key (it waits until that one commits or rolls back): decide with publish, 5.5a.
- A lint rule that stops business code from importing `src/testing` (still open from 0.4a).
- Not fixed from the review, by choice: the application user may rewrite the stored answer of a key (a database rule against it would need a trigger); `request-key.test.ts` has tests that build on the row of the first test; `import x = require(...)` and an inline `eslint-disable` are not refused by the import rule.

Open, for the owner:

- 0.10: the database user of the application on Neon must not be a superuser, must not have BYPASSRLS and must not own the tables. Confirmed by the owner from Neon's documentation (neon.com/docs/manage/roles): roles created in the Neon Console, CLI or API are members of `neon_superuser`, which has BYPASSRLS; roles created with SQL are not. So `sodiq_app` and `sodiq_migrator` are created with SQL (`CREATE ROLE ... LOGIN PASSWORD`) from the SQL editor or psql, never in the console. With a wrong user the API refuses every transaction instead of showing all branches.
- 0.7: whether `createParamDecorator` and `REQUEST` of `@nestjs/core` are also kept inside `apps/api/src/http/`.

The next sessions must know:

- A new branch table: `branch_id uuid not null references branches (id)`, then the two statements of the policy pattern in migration 0002, exactly. The cast `::uuid[]` in the policy is needed. `catalog.test.ts` fails until the table is right. A school-wide table goes into `SCHOOL_WIDE_TABLES` in that test, with a reason, after asking the owner.
- Foreign keys and unique constraints are not filtered: a unique constraint on a branch table includes `branch_id`; an id from a request is checked against the branch first, or the error would tell whether the id exists in another branch (`.claude/rules/database.md`).
- A query outside `Transactions.run` sees no branch rows. Tests of branch tables: `new Transactions(database.app)`; helpers in `apps/api/src/testing/branch-filter-sql.ts` (`addBranchFilter`, `insertBranch`). The migrator sees everything and is refused by `Transactions`.
- A changing route that must be repeat-safe: `@RequestKey() key`, then `requestKeys.runOnce` inside `transactions.run`. `input` holds every path parameter and the body; the result is small JSON with ids and status, never personal data. Permission and scope checks come before `runOnce`.
- `runOnce` uses a savepoint named `request_key`; work that throws is undone even when the caller catches the error.
- 0.5: pg-boss brings its own schema: the catalog test "keep everything in schema public" will fail and the checks must be extended to that schema. Each monthly audit partition is a table of its own for the catalog test, and a partition read directly is not covered by the policy of its parent.
- 0.7: the guard is the only source of the branch list; a branch id in a path is compared with the person's assignments first. The filter knows branches only: subject, class and own-lesson scope are the guard's work. A Super Admin gets the list of every branch id; there is no "all" value. `branchIdSchema` accepts upper-case letters: compare ids in lower case. The raw `DATABASE` connection is still injectable; it sees school-wide tables without any filter. The harness must also put the guard on test controllers.
- 0.10: the API and the worker must never connect as `sodiq_migrator`.
- To re-apply an unmerged migration locally, ask the owner before changing anything in `sodiq_dev` (`.claude/rules/database.md`).
- In Git Bash here a heredoc breaks on apostrophes (again in this task): write a script file with the editor tools and run it.

The next task is 0.5.

## 4 October 2026: task 0.4a API foundations, HTTP side

Task 0.4 was split by the owner: 0.4a is the HTTP side, 0.4b the database side.

Built:

- Configuration (`apps/api/src/config`): `HOST` (default `127.0.0.1`), `PORT`, `DATABASE_URL`, checked at start, injected as `CONFIG`. A wrong variable stops the API with its name, never its value.
- One error shape (`apiErrorSchema` in `packages/shared`): `{ error: { code, message, requestId, details? } }`, also for unknown paths inside and outside `/api`, a body that is not JSON and a body over 100 kB. The text is always ours.
- Request ids: `X-Request-Id` made by the server on every answer and repeated in every error body.
- Validation (`apps/api/src/http`): `@ValidBody`, `@ValidQuery`, `@Returns` with zod schemas. The same schema checks and documents. `@Returns` also drops fields the schema does not know before the answer is sent. Validation details never repeat a submitted value.
- Clock: `Clock` type in `packages/shared`; `CLOCK`, `SystemClock`, `ClockModule` in the API; `FixedClock` for tests; the lint rule against reading the system clock in `apps/api/src` and `packages/*/src`.
- OpenAPI: `pnpm api:client` writes `apps/api/openapi.generated.json` and `apps/web/src/api/schema.generated.ts`; the placeholder page calls the health route through `apps/web/src/api/client.ts`. Two tests fail when a generated file is out of date.
- The sample route of the build plan exists only in tests: `apps/api/src/testing/sample.controller.ts`.
- Reviewed by the spec reviewer and the permission reviewer; their findings are fixed or listed below.

Left out, with the task that brings it:

- Branches table, branch filter, row policies, transaction helper, repeat-safe request keys: 0.4b.
- Error codes of their own for 401, 403, 409, 429 and the way to throw them: 0.6a (first use).
- Application version on every request: 8.3a. TanStack Query and Router: 0.8a. Request logging, Sentry: 0.10.
- `NODE_ENV` in the configuration: nothing reads it yet.
- The clock lint rule for `apps/web`: with its first code that has a time rule (8.3c).
- A lint rule that stops business code from importing `src/testing` (advice of the permission reviewer; today only tests import it and the build leaves the folder out).

Open, for the owner:

- A 500 is logged with the message and stack of the error. PostgreSQL puts a typed value into the message of a few errors (for example "invalid input syntax for type date"). Input validation stops such values before a query, but the log rule itself allows it. Decide in 0.10 with Sentry whether messages of database errors are cut.

The next sessions must know:

- A new route: `@ValidBody(schema)` / `@ValidQuery(schema)` on the parameter, `@Returns(schema)` on the method, schemas in `packages/shared`. Then `pnpm api:client` and commit both generated files. `sample.controller.ts` is the example.
- Route tests: `createTestApp({ clock: new FixedClock('2026-10-05T23:59:00+05:00'), controllers: [...] })`. `FixedClock` refuses a text without an offset.
- Query schemas: `z.coerce.number()` also accepts `0x50` and `1e3`, and reads an empty value as 0. Real query schemas (first in the lists of 0.8b) should use a strict whole-number text instead of copying the sample.
- An input schema must not use a record whose keys the caller chooses and that look like field names; such a key would appear in `details[].path` (`docs/decisions.md`).
- Errors that Node answers before Express (malformed HTTP, headers too large, request timeout) cannot have the error shape.
- NestJS turns every `SyntaxError` and `URIError` that reaches its Express error handler into a 400. 0.6a: middleware that parses stored data (sessions) must catch its own parse errors, or a server fault would be answered as `malformed_request` without a log line.
- 0.6a: cookie sessions need the SameSite setting and CSRF protection decided there. CORS is off and must stay off (`docs/decisions.md`).
- 0.7: 0.4a added no route to the running application. The guard must decide how test-only controllers passed to `createTestApp({ controllers })` declare access, without letting undeclared routes through. The two Express fallbacks (`initApp`) run outside NestJS, where no guard runs: nothing that serves data may be mounted there. The harness should also require `@Returns` on every route.
- 0.4b: decided already: the branch filter is a list of branch ids, normally one; nothing set shows no rows. Moments that rules compare come from the clock, not SQL `now()` (`.claude/rules/database.md`).
- 0.10: `HOST=0.0.0.0` on Render; a new variable goes into `config.ts`, `.env.example`, `apps/api/turbo.json` and `ci.yml`. Sentry must not send more of an error than the log does.
- `pnpm peers check` shows one known warning: `openapi-typescript` wants TypeScript 5. The install script of `@scarf/scarf` is refused on purpose (`pnpm-workspace.yaml`).
- In Git Bash on this machine a heredoc breaks on apostrophes and can lose backslashes: write files with the editor tools, not with shell text.

The next task is 0.4b.

## 4 October 2026: task 0.3 Continuous integration

Built:

- `.github/workflows/ci.yml`, on every pull request and every push to `main`. Job `checks`: install, `pnpm lint`, `pnpm typecheck`, `pnpm test`. Job `e2e`: `pnpm db:migrate`, Chromium, `pnpm test:e2e`; Playwright traces are kept 7 days when it fails. Each job has its own PostgreSQL 18 service, set up with `db/setup/local.sql` and the values of `.env.example`.
- Proof on a throwaway pull request (number 3, closed without merging, branch deleted): both jobs green, then `checks` red at "Unit and API tests" with a deliberately failing test.
- `apps/api/turbo.json`: the `dev` task names `DATABASE_URL` and `PORT`. Without this the API did not start under `pnpm dev` in CI.
- `apps/web/playwright.config.ts`: in CI the output of the servers is printed.
- `README.md` (Continuous integration) and `docs/decisions.md`.

Left out, with the task that brings it:

- Required checks for `main`: the owner turns them on in GitHub after the merge (`checks` and `e2e`).
- Deploy, migrations before a deploy, smoke test: 0.10. Solver build and tests: 5.10. Nightly simulation: 9.5c. Speed tests: 10.1.
- Turborepo remote cache: not needed yet.

The next sessions must know:

- Turborepo passes a task only the environment variables that the package's `turbo.json` names for it. A new variable read by the API, the worker or a test (0.4 configuration loading, 0.5 worker, 0.6 mail, 0.10) must be added there for `dev` and `test`, or it is missing wherever there is no `.env`. CI is where this shows first.
- A new environment variable that the tests or `pnpm dev` need also goes into the `env` block of `ci.yml` and into `.env.example`.
- The names of the jobs (`checks`, `e2e`) are what the branch protection requires. Renaming a job means changing the protection in GitHub too, or no pull request can be merged.
- Actions are pinned to a commit. To update one: new commit and new version in the comment.
- The review fixes of this task (concurrency group per commit on `main`, the superuser password only on the `psql` step, the 10-minute limit on the browser tests) ran for the first time on the task's own pull request, not on the throwaway one.
- 0.5: the worker joins `pnpm dev`; the `e2e` job then starts it too and it needs its variables (first note).
- 0.8a: more Playwright tests make `e2e` longer; the limits are 10 minutes for the step and 15 for the job.
- 0.10: the deploy can depend on the run of `ci.yml` on `main`; each commit on `main` has its own run that a later merge does not cancel.

The next task is 0.4.

## 4 October 2026: task 0.2 Database, migrations and typed queries

Built:

- `db/setup/local.sql` (run once per machine as `postgres`): the users `sodiq_migrator` and `sodiq_app` and the database `sodiq_dev`. `.env.example` with `DATABASE_URL` (application user) and `DATABASE_MIGRATION_URL` (migration user). Both files are for local machines and CI only and say so.
- `db/migrations/0001_foundations.sql`: extension `btree_gist`; only the migration user may create objects; `sodiq_app` may read `schema_migrations`.
- The migration runner `apps/api/src/database/migrate.ts` and `pnpm db:migrate`: files `NNNN_short_name.sql` in number order, each in its own transaction, one runner at a time. It refuses an applied file that was edited (line endings do not count), renamed or removed, a duplicate number, a lower number than the last applied, a bad name, and a file with its own `begin`, `commit` or `rollback`.
- Kysely: `createDatabase` and the global `DatabaseModule` (token `DATABASE`), connecting as `sodiq_app`. `pnpm db:codegen` writes `apps/api/src/database/types.generated.ts`. A `date` column is the text `YYYY-MM-DD` in TypeScript.
- Test helper `apps/api/src/testing/test-database.ts`: `createTestDatabase()` gives a test file its own copy of a template built from the real migrations, with an `app` connection (as `sodiq_app`) and a `migrator` connection (owner). 54 API tests pass.
- Outside the task, asked for by the owner: `/next-task` first checks that `main` is up to date; `README.md` says how to stop `pnpm dev` on Windows (Ctrl+C twice).

Left out, with the task that brings it:

- Branch filter per transaction, row-filter policies, a transaction helper, configuration loading: 0.4. Today two environment variables are read in `apps/api/src/database/config.ts`.
- CI: 0.3. Users and databases on Neon, migrations before a deploy: 0.10.
- Migrations outside a transaction (`create index concurrently`): the runner cannot run them yet. Change the runner with the first migration that needs one.
- How `bigint` and `numeric` columns arrive in TypeScript: decide with the first table that has one (phase 4 or 9).
- The health route does not query the database.

The next sessions must know:

- The API does not start without `DATABASE_URL`. `pnpm dev` and `pnpm test` need the local PostgreSQL 18 and `.env` (README, Setup).
- Every migration grants `sodiq_app` its rights table by table (`.claude/rules/database.md`). After a migration: `pnpm db:migrate`, `pnpm db:codegen`, commit the generated file; `codegen.test.ts` fails otherwise.
- Tests that reach the database: `const database = await createTestDatabase()` in `beforeAll`, `await database.destroy()` in `afterAll`. Use `database.app` for the code under test, so a missing grant fails the test. Route tests: `createTestApp({ database: database.app })`; without it every query fails on purpose. Closing the application closes that connection.
- `sodiq_migrator` owns the tables, so row filters do not apply to it: row-filter tests (0.4) must use `database.app`.
- A test needs a scratch table? Create it in the test database as `database.migrator` and grant it; never add a sample table to `db/migrations`.
- 0.3: CI runs `db/setup/local.sql` against a PostgreSQL 18 service on localhost (`psql -U postgres -f db/setup/local.sql`) and sets the two variables of `.env.example`. The tests refuse a database host other than localhost. `pnpm db:codegen` reads `../../.env`, which CI does not have; CI does not need to run it, the verify test covers it. Turborepo: `apps/api/turbo.json` makes `db/migrations`, `.env` and the two variables part of the test cache key.
- 0.5: pg-boss creates its own schema when it starts, and `sodiq_app` cannot create anything. The schema must be installed by the migration user and granted. The same holds for the monthly audit partitions: the application user cannot create them.
- 0.5 and 0.4: `sodiq_app` still has PostgreSQL's default right to create temporary tables and to connect to any database on the server. Harmless for the append-only rule; decide in 0.10 whether to revoke it on Neon.
- 0.10: `sodiq_migrator` and `sodiq_app` must exist on Neon before the first migration (`0001` names `sodiq_app`). The runner holds a session lock, so `DATABASE_MIGRATION_URL` must be Neon's direct connection, not the pooled one. The compiled runner is `apps/api/dist/database/cli.js migrate`; it looks for `db/migrations` four folders above itself, check that this holds in the deployed layout. A second runner waits for the first without a time limit.
- The runner talks to PostgreSQL through `pg` directly, an exception to "Kysely only" that is written in `docs/decisions.md`.
- On Windows `pnpm dev` stops with Ctrl+C twice. Do not build shell commands with a quoted heredoc that contains an apostrophe in Git Bash here; write a script file instead.

The next task is 0.3.

## 4 October 2026: task 0.1 Repository skeleton

Built:

- pnpm workspace with Turborepo: `apps/web`, `apps/api`, `packages/calc`, `packages/timetable-rules`, `packages/shared`.
- `apps/api`: NestJS 12 with the eleven empty modules in `src/modules` and the public route `GET /api/health`.
- `apps/web`: Vite, React, Tailwind CSS, shadcn/ui (Button only). One placeholder page calls the health route and shows "reachable" or "not reachable".
- ESLint, Prettier and Vitest in every package; Playwright with one smoke test; the root scripts named in `CLAUDE.md`. 36 unit and API tests and 1 browser test pass.
- Setup steps in `README.md`; the technical choices in `docs/decisions.md`.

Left out, with the task that brings it:

- Jobs worker in `pnpm dev`: 0.5. `pnpm db:migrate` and `pnpm db:codegen`: 0.2. `pnpm api:client`: 0.4. Until then the three scripts stop with a message.
- Continuous integration: 0.3. `apps/solver`: 5.10. Web feature folders: created with each feature.
- TanStack Router and Query, i18next, AG Grid, Pragmatic drag and drop, Dexie, Socket.IO, Kysely, pg-boss and fast-check are not installed; each comes with the first task that uses it.
- The placeholder page has hard-coded English text and a plain `fetch`. No permission tests and no translations yet (allowed before 0.8c).

The next sessions must know:

- Node 24 is pinned (`.node-version`, `engines`); `pnpm install` refuses another major version. TypeScript stays on 6.0.x. pnpm refuses package versions younger than 24 hours: take the previous version, do not add an exception.
- New shadcn/ui components: `pnpm dlx shadcn@latest add <name> -c apps/web`, then `pnpm format`.
- Do not write files with PowerShell `Set-Content`: it adds CRLF and a byte-order mark. Line endings are LF.
- 0.2: replace the two database stubs in the root `package.json`.
- 0.3: use `.node-version` and `pnpm install --frozen-lockfile`. The browser test needs `playwright install chromium`; the build plan does not say whether CI runs `pnpm test:e2e`, ask the owner. Tests are slow when all packages run at once (timeouts were raised in `apps/api/vitest.config.ts` and `apps/web/src/test-setup.ts`); watch this in CI.
- 0.4: replace `parseHealthResponse` (`packages/shared`) and the `fetch` in `apps/web/src/App.tsx` with the shared schemas and the generated client. Configuration loading replaces the read of `PORT` in `apps/api/src/main.ts` and should also set the host: today the API listens on all network interfaces. Unknown paths give three different error shapes today (NestJS JSON under `/api`, an Express HTML page outside it, the body parser's own errors). Add the lint rule against reading the system clock. If the OpenAPI document is served over HTTP, that is a new route.
- 0.4 to 0.6c add routes before the permission harness of 0.7 exists. Each must be listed for 0.7.
- 0.7: declare `GET /api/health` public on the handler, not by a list of paths (Express also matches `HEAD`, `/API/HEALTH` and `/api/health/`). The harness must find routes from the running application: the health controller is in `src/health/`, outside `modules/`. Requests to unknown paths never reach a guard. The reviewer also advises that public routes do not refresh a session's last-use time.
- Before 0.7 the owner decides one point: `docs/spec/02-roles-and-access.md` says "Every request passes one permission check on the server" and names no public route. If the health route stays public, the spec may need a line (`/spec-change`).
- 0.8a: i18n replaces the placeholder texts, the `lang` and title in `apps/web/index.html`, and the tests that look for English strings. 0.8a and 0.8b review the look (the `nova` preset and the Geist font came from the shadcn CLI).
- Turborepo's `AGENTS.md` generation is off (`agentGuidance: false` in `turbo.json`). Its anonymous telemetry is on by default on each machine; `pnpm exec turbo telemetry disable` turns it off.

The next task is 0.2.

## 3 October 2026

Repository created from the starter pack. Nothing is built yet. The next task is 0.1 in `docs/build-plan.md`.
