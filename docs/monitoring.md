# Monitoring, alerts and the daily export

How production is watched and backed up (task 10.2a): what each service does, the one-time setup the owner does, in order, and what to do when an alert comes. The restore steps are in `restore.md`.

Every value in angle brackets is yours: none goes into a file of the repository, a pull request or a chat. No Claude session sets any of this up or reads any of it (`docs/decisions.md`, answer 3); the session that built it handled no secret.

## What watches what

| Service | What it does | Where its setup is |
| --- | --- | --- |
| **Sentry** | Faults of the API, the worker and the web app, the web app's with its source maps (readable stack traces). A new issue is emailed to the owner by Sentry itself: Grafana's free plan cannot read Sentry, and `14` asks that errors raise an alert at once (plan decision 12, the one exception to "Grafana sends every alert"). | Steps 2 and 3 |
| **Grafana Cloud** (EU stack) | The API's request times and answers per route and branch, a heartbeat of the API and the worker every minute, the logs, and the counts the database knows per branch, pushed every minute by the worker. Every alert rule of `edge/system-behaviour` lives here (`monitoring/grafana/alert-rules.yaml`) and is sent by email. The sign-in-and-save check every 5 minutes (Synthetic Monitoring) signs in as the test teacher of the hidden Monitoring branch and saves a cell. | Steps 1, 3, 4, 9 and 10 |
| **UptimeRobot** | An outside check of `https://app.sodiqschool.uz/`, `/api/health` and the certificate's expiry, independent of Grafana, so a broken Grafana is still noticed. | Step 7 |
| **The Backup workflow** | Every night at 02:30 Tashkent (and by hand): makes a branch of production at that moment with a read-only compute, dumps it and deletes it (task 10.2b), restores the dump into an empty PostgreSQL to prove it, stores it in the R2 bucket `sodiq-backups`, and tells Grafana. A failed run is emailed by GitHub; the rule "a backup older than 24 hours" fires the next day if no run succeeded. | Steps 5 and 6 |

**Who receives the alerts**: the owner, by email, the on-call person of school days until the school names another (`edge/system-behaviour`, "A named person is on call on school days"). Telegram comes later (answer 8): one contact point added in Grafana, nothing else changes.

**What leaves the servers.** The numbers carry the route's pattern (`/api/journal/lessons/:lessonId/attendance`), the method, the status class, the branch id and the server's instance; never a query, a body, a name or a record's id. A request's log line has its request id, method, pattern, path without the query, status, milliseconds and branch id. The other log lines are the ones the services already write (an error's name, message and stack, as the error reports). The backup log on GitHub (public) prints sizes, table names and "match" or "differs", never a row.

## One-time setup, in this order

Do one step at a time and check it before the next. Production must be up (`docs/deploy.md`, Production) before step 3 can be checked.

### 1. Grafana Cloud: the stack and its token

1. At grafana.com create a free account and a stack in an **EU** region (for example `eu-west`), name `sodiq`.
2. In the stack's page (My Account, the stack, Details) note:
   - the **OTLP** address of the numbers and its **user**: in the stack's Grafana, Connections, Add new connection, **HTTP Metrics**, Configuration details, format **Otel**: the address in the curl example, `https://otlp-gateway-prod-<region>.grafana.net/otlp/v1/metrics`, and the number after `-u` (the stack's instance id). New stacks take OTLP and no Influx line protocol: an Influx address is answered 530;
   - under **Loki** (or "Logs"): the **push** address, `https://<host>/loki/api/v1/push`, and its **user** (a number).
3. Create an **access policy** `sodiq-push` with the scopes `metrics:write` and `logs:write` only, and one **token** of it. It is shown once: keep it in the password manager.

### 2. Sentry: the source maps and the issue emails

1. In the organisation of `docs/deploy.md`, step 2 (production), create an **organisation auth token** with the scope `project:releases` (Settings, Auth Tokens). Shown once: password manager.
2. Note the organisation's **slug** (in its address, `sentry.io/organizations/<slug>/`).
3. In each of `sodiq-production` and `sodiq-production-web`: Alerts, Create Alert, Issues, "A new issue is created", action "Send a notification to" the owner's email. Name them `new issue`.

### 3. Render: the variables of production

On `sodiq-api` **and** `sodiq-worker` (Environment), the five values of step 1:

- `GRAFANA_METRICS_URL` (the OTLP address), `GRAFANA_METRICS_USER` (its user);
- `GRAFANA_LOGS_URL` (the Loki push address), `GRAFANA_LOGS_USER`;
- `GRAFANA_TOKEN` (the token of `sodiq-push`).

All five or none: with four, the service refuses to start and names the missing one.

On `sodiq-api` only:

- `SENTRY_ORG`: the slug of step 2 (`SENTRY_PROJECT` is already `sodiq-production-web` in the Blueprint);
- a **Secret File** (Environment, Secret Files) named exactly `sentry-auth-token` whose content is the token of step 2. The image's build reads it as a Docker build secret: it is in no layer of the image and in no variable of the running service.

Save. The next production deploy (`docs/deploy.md`) builds with them. **Check**: in the build log of `sodiq-api` the Sentry plugin says it uploaded the source maps; a few minutes after the deploy, Grafana, Explore, the metric `sodiq_process_up` shows `service="api"` and `service="worker"`; Explore, Loki, `{service="api"}` shows request lines.

### 4. Grafana: the rules, the contact point, the email

1. Alerting, Contact points, **New**: `owner email`, integration Email, the owner's address. Make it the default of the notification policy.
2. Alerting, Alert rules, **Import** (to Grafana-managed rules), from file: `monitoring/grafana/alert-rules.yaml` of the repository, data source the stack's Prometheus, folder `sodiq`. 19 rules appear.
3. For **ApiSilent**, **WorkerSilent**, **CountsSilent** and **BackupOld**, open each and check "Alert state if no data" is **Alerting** (their expressions already fire on a missing series; this is a second guard).
4. **Check**: Alerting, Alert rules: every rule is "Normal", except **BackupOld** until the first backup (step 6) and **FirstSlotFewMarks** which is "Normal" outside 09:00 to 09:30.

The rules come from `apps/api/src/monitoring/alert-rules.ts`. When a later change of the repository changes the file, import it again (Grafana replaces rules of the same name).

### 5. Cloudflare R2: the backup bucket

1. R2, **Create bucket** `sodiq-backups`, location hint **Western Europe**. Not the EU jurisdiction: such a bucket has another address (`<account>.eu.r2.cloudflarestorage.com`), which the upload does not use. Public access stays off.
2. The bucket, Settings, **Object lifecycle rules**: delete objects **35 days** after upload (plan decision 5: more than Neon's 7 days of restore).
3. R2, Manage API tokens, **Create API token** `sodiq-backups`: permission **Object Read & Write**, limited to the bucket `sodiq-backups`. Note the access key id and the secret (shown once).

### 6. GitHub: the environment `backup`

Repository Settings, Environments, **New environment** `backup`:

- **Deployment branches**: `main` only. **No required reviewer**: the run is every night (plan decision 4).
- Secrets:
  - `BACKUP_DATABASE_URL`, `NEON_API_KEY`, `NEON_PROJECT_ID`: the read-only login of production and the key that makes each night's snapshot (task 10.2b; your answer of 29 October 2026 on #261; **Look first**). In Neon's console, project `sodiq-production`:
    1. Roles, **New role** `sodiq_backup`. A role made in the console is a member of `neon_superuser`, reads past the row filters (`select rolbypassrls from pg_roles where rolname = 'sodiq_backup'` says `t`) and reads every table (`pg_read_all_data`), so the dump holds every branch's rows. Keep its password in the password manager.
    2. SQL Editor, the primary, database `sodiq`: `grant connect on database sodiq to sodiq_backup;`. `db/setup/server.sql` lets only `sodiq_app` and `sodiq_migrator` connect; without the grant the dump stops with "permission denied for database".
    3. Connect: role `sodiq_backup`, database `sodiq`, connection pooling off (`pg_dump` needs the direct endpoint): `postgres://sodiq_backup:<password>@<host>/sodiq?sslmode=verify-full`. That is `BACKUP_DATABASE_URL`; the run puts the snapshot's host in place of `<host>`, so any endpoint of the project will do. The workflow gives the dump the runner's trusted roots, so `verify-full` checks Neon's certificate; an address ending in `&sslrootcert=system` works too.
    4. Settings, **API keys**, **Create** a key limited to the project `sodiq-production` (`github-backup`): that is `NEON_API_KEY`. `NEON_PROJECT_ID` is the project's id (Settings, General).

    Each night the run makes a branch `nightly-backup-<date>-<run>` of production at that moment with a **read-only compute** only, dumps and counts it, and deletes it at the end, failed or not; a branch a broken run left behind is deleted by the next run. Nothing writes to that branch, so nothing ends the dump: on the live read replica of production the worker's writes every minute ended it with "terminating connection due to conflict with recovery" (30 October 2026), so no read replica is needed. `db/backup/row-counts.sql` asks `pg_is_in_recovery()`, and the step that compares the copy fails with "production was read through a connection that can write" unless the dump read a read-only compute; the dump is then not stored. A role that cannot pass the row filters makes `pg_dump` itself stop at the dump step (it reads with `row_security` off and stops rather than dump part of a table). A failed dump or count prints its error lines with every value hidden.
  - `BACKUP_R2_ACCOUNT_ID`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY` (step 5), `BACKUP_R2_BUCKET` = `sodiq-backups`;
  - `GRAFANA_METRICS_URL`, `GRAFANA_METRICS_USER`, `GRAFANA_TOKEN` (step 1).

**Check**: Actions, **Backup**, Run workflow on `main`. Green in about 10 minutes; "Snapshot nightly-backup-… made, with a read-only compute", the comparison starts with "read-only: yes", and the log ends with "Stored daily/<date>.dump" and "Grafana told", then "Snapshot … deleted". The bucket holds the file; the rule BackupOld turns Normal.

### 7. UptimeRobot: the outside check

At uptimerobot.com (free plan), with the owner's email as the alert contact:

1. HTTP(s) monitor `app`: `https://app.sodiqschool.uz/`, every 5 minutes.
2. HTTP(s) monitor `api health`: `https://app.sodiqschool.uz/api/health`, every 5 minutes, keyword `ok`.
3. On the first one, **SSL expiry** reminders on, 14 days ahead.

### 8. The first restore drill

Follow `restore.md`, "The monthly drill", once (the "Done when" of 10.2), and note it in `docs/go-live/restore-drills.md`.

### 9. The hidden Monitoring branch (once)

The check of step 10 signs in as the test teacher of a branch that only the Super Admin sees ("Monitoring" in the branch switcher; answer 10 and your answer of 29 October 2026 on #261): one class `M-1`, three invented students (UIDs `MON0001` to `MON0003`), one lesson at 06:30 on every day of the week, four quarters that touch. It is left out of the school's report totals, the counts pushed to Grafana and the notices to the Super Admins, and the Senior Head Teacher cannot open it. Its own nightly check, its teacher's reminders and the audit log go on as in any branch.

1. After 18:00 or at the weekend, in the Render Shell of `sodiq-api`:
   `node apps/api/dist/monitoring/cli.js monitoring-branch --subject "<English name of a subject taught to whole classes>" --year-end <the day before next year's first day>`
   (`--year-start` is tomorrow unless given: a timetable is published from tomorrow at the earliest).
2. It asks for **your** Super Admin login, password and second-step code (not shown as you type), builds the branch through the application's own routes (every change is in the audit log under your name), prints each step, and at the end the test teacher's **login and first password, once**. Nothing is written when the subject is missing or taught in groups, or when one of the UIDs is taken. A run that stops half-way names the step: finish it in the screens as Super Admin, or archive what it made and run it again.
3. In a private window, sign in as the test teacher with the first password and set a new one (from the password manager). Keep the login and the new password for step 10.
4. **Check**, the next morning: sign in as the test teacher; the home page shows today's 06:30 lesson.

The year ends on `--year-end`. After it the check fails until the year is closed and the next one started, which comes with the year-end tasks (9.5a and 9.5b).

### 10. The sign-in-and-save check (Grafana Synthetic Monitoring)

1. In Grafana: Testing & synthetics, Synthetic Monitoring, **Secrets**: `monitoring-teacher-login` and `monitoring-teacher-password` (step 9).
2. Checks, **Add new check**, **Scripted** (k6): job name `sign-in-and-save`, frequency **5 minutes**, one **EU** probe (for example Frankfurt), timeout 30 s. Paste `monitoring/synthetic/sign-in-and-save.js` of the repository as it is, and let the check use the two secrets.
3. **Check**: the runs turn green (a run before 06:30 Tashkent fails: the lesson has not started; the alert reads 07:00 to 20:00 only). Import `monitoring/grafana/alert-rules.yaml` again (step 4): **SignInSaveFailing** appears.

The script signs in, reads today's lesson from the teacher's home page and the first student's cell from the journal, switches it between present and late, and signs out. A step that fails, or a save slower than 0.3 s, fails the run. It logs nothing of an answer.

## When an alert comes

| Alert | What it means | First thing to do |
| --- | --- | --- |
| CellSavesFailing | Cell saves answer 500 in a branch. | Sentry, `sodiq-production`, the newest issue; the request id is in the issue and in Loki. Teachers keep typing: unsent entries stay in their browser. |
| CellSavesSlow | Saves take over 0.3 s (95th percentile) for 10 minutes. | Grafana, the request times of the save routes per branch; Neon's monitoring (CPU, connections). |
| RefusedSavesJump | Far more refused saves than the same hour last week. | Loki, `{service="api"} |= "SaveRefusals"`; usually a lock moment or a closed quarter the teachers did not expect. |
| JobsFailing, BranchExportsFailing | A job or a branch export failed in the last hour. | Sentry (part `jobs`) and Loki `{service="worker"}`. |
| PublishOrCloseFailed | A publish or a close answered 500 (it rolled back). | Sentry; the person can try again once it is fixed. |
| NightlyCheckDifference | The nightly check found a difference (the Super Admins also got an in-app notice). | Results, the check's list; closing that journal is blocked until it is explained. |
| NightlyCheckLate, DailyWorkLate | No nightly check finished, or no daily work was enqueued, for 26 hours. | Render, `sodiq-worker`: is it running? Its log. |
| BackupOld | No backup for 24 hours. | Actions, Backup: the newest run and its failed step. |
| FirstSlotFewMarks | Far fewer first lessons have attendance by 09:00 than usual. | Ask the branch: the internet, the classroom computers, or the platform (CellSavesFailing?). |
| ServerErrors | Any route answered 500. | Sentry. |
| SlowJournal, SlowSearch, SlowReports, SlowPages | A page is slower than its target of `12` for 10 minutes. | Grafana, the route; Neon's monitoring. |
| ApiSilent, WorkerSilent, CountsSilent | No numbers from the API, the worker or the counts for 10 minutes. | Render: the service's state and log. If Render is fine, the push to Grafana (its token) is the problem. |
| SignInSaveFailing | The test teacher could not sign in and save a cell twice in a row (07:00 to 20:00 Tashkent). | Synthetic Monitoring, the check's newest run: which step failed (sign-in, home, journal, save). A failed save: is CellSavesFailing firing too? A failed sign-in: Render and Sentry. After `--year-end`: step 9. |
| UptimeRobot: down | The address does not answer from outside. | Render's status and the service; Cloudflare/the registrar's DNS. |
