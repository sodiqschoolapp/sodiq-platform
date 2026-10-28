# Monitoring, alerts and the daily export

How production is watched and backed up (task 10.2a): what each service does, the one-time setup the owner does, in order, and what to do when an alert comes. The restore steps are in `restore.md`.

Every value in angle brackets is yours: none goes into a file of the repository, a pull request or a chat. No Claude session sets any of this up or reads any of it (`docs/decisions.md`, answer 3); the session that built it handled no secret.

## What watches what

| Service | What it does | Where its setup is |
| --- | --- | --- |
| **Sentry** | Faults of the API, the worker and the web app, the web app's with its source maps (readable stack traces). A new issue is emailed to the owner by Sentry itself: Grafana's free plan cannot read Sentry, and `14` asks that errors raise an alert at once (plan decision 12, the one exception to "Grafana sends every alert"). | Steps 2 and 3 |
| **Grafana Cloud** (EU stack) | The API's request times and answers per route and branch, a heartbeat of the API and the worker every minute, the logs, and the counts the database knows per branch, pushed every minute by the worker. Every alert rule of `edge/system-behaviour` lives here (`monitoring/grafana/alert-rules.yaml`) and is sent by email. The sign-in-and-save check every 5 minutes comes with 10.2b. | Steps 1, 3 and 4 |
| **UptimeRobot** | An outside check of `https://app.sodiqschool.uz/`, `/api/health` and the certificate's expiry, independent of Grafana, so a broken Grafana is still noticed. | Step 7 |
| **The Backup workflow** | Every night at 02:30 Tashkent (and by hand): dumps production, restores the dump into an empty PostgreSQL to prove it, stores it in the R2 bucket `sodiq-backups`, and tells Grafana. A failed run is emailed by GitHub; the rule "a backup older than 24 hours" fires the next day if no run succeeded. | Steps 5 and 6 |

**Who receives the alerts**: the owner, by email, the on-call person of school days until the school names another (`edge/system-behaviour`, "A named person is on call on school days"). Telegram comes later (answer 8): one contact point added in Grafana, nothing else changes.

**What leaves the servers.** The numbers carry the route's pattern (`/api/journal/lessons/:lessonId/attendance`), the method, the status class, the branch id and the server's instance; never a query, a body, a name or a record's id. A request's log line has its request id, method, pattern, path without the query, status, milliseconds and branch id. The other log lines are the ones the services already write (an error's name, message and stack, as the error reports). The backup log on GitHub (public) prints sizes, table names and "match" or "differs", never a row.

## One-time setup, in this order

Do one step at a time and check it before the next. Production must be up (`docs/deploy.md`, Production) before step 3 can be checked.

### 1. Grafana Cloud: the stack and its token

1. At grafana.com create a free account and a stack in an **EU** region (for example `eu-west`), name `sodiq`.
2. In the stack's page (My Account, the stack, Details) note:
   - under **Prometheus** (or "Metrics"): the **Influx push** address, `https://<host>/api/v1/push/influx/write`, and the **user** (a number);
   - under **Loki** (or "Logs"): the **push** address, `https://<host>/loki/api/v1/push`, and its **user** (a number).
3. Create an **access policy** `sodiq-push` with the scopes `metrics:write` and `logs:write` only, and one **token** of it. It is shown once: keep it in the password manager.

### 2. Sentry: the source maps and the issue emails

1. In the organisation of `docs/deploy.md`, step 2 (production), create an **organisation auth token** with the scope `project:releases` (Settings, Auth Tokens). Shown once: password manager.
2. Note the organisation's **slug** (in its address, `sentry.io/organizations/<slug>/`).
3. In each of `sodiq-production` and `sodiq-production-web`: Alerts, Create Alert, Issues, "A new issue is created", action "Send a notification to" the owner's email. Name them `new issue`.

### 3. Render: the variables of production

On `sodiq-api` **and** `sodiq-worker` (Environment), the five values of step 1:

- `GRAFANA_METRICS_URL` (the Influx push address), `GRAFANA_METRICS_USER`;
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

1. R2, **Create bucket** `sodiq-backups`, location **Western Europe** (EU jurisdiction if offered). Public access stays off.
2. The bucket, Settings, **Object lifecycle rules**: delete objects **35 days** after upload (plan decision 5: more than Neon's 7 days of restore).
3. R2, Manage API tokens, **Create API token** `sodiq-backups`: permission **Object Read & Write**, limited to the bucket `sodiq-backups`. Note the access key id and the secret (shown once).

### 6. GitHub: the environment `backup`

Repository Settings, Environments, **New environment** `backup`:

- **Deployment branches**: `main` only. **No required reviewer**: the run is every night (plan decision 4).
- Secrets:
  - `BACKUP_DATABASE_URL`: the **migrations** address of production (`postgres://sodiq_migrator:<password>@<host>/sodiq?sslmode=verify-full`, the direct host). It is the owner of the tables, so the dump holds every branch's rows (**Look first**, decision 4: this role can also write; a read-only login is a later step of 10.2b);
  - `BACKUP_R2_ACCOUNT_ID`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY` (step 5), `BACKUP_R2_BUCKET` = `sodiq-backups`;
  - `GRAFANA_METRICS_URL`, `GRAFANA_METRICS_USER`, `GRAFANA_TOKEN` (step 1).

**Check**: Actions, **Backup**, Run workflow on `main`. Green in about 10 minutes; the log ends with "Stored daily/<date>.dump" and "Grafana told". The bucket holds the file; the rule BackupOld turns Normal.

### 7. UptimeRobot: the outside check

At uptimerobot.com (free plan), with the owner's email as the alert contact:

1. HTTP(s) monitor `app`: `https://app.sodiqschool.uz/`, every 5 minutes.
2. HTTP(s) monitor `api health`: `https://app.sodiqschool.uz/api/health`, every 5 minutes, keyword `ok`.
3. On the first one, **SSL expiry** reminders on, 14 days ahead.

### 8. The first restore drill

Follow `restore.md`, "The monthly drill", once (the "Done when" of 10.2), and note it in `docs/go-live/restore-drills.md`.

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
| UptimeRobot: down | The address does not answer from outside. | Render's status and the service; Cloudflare/the registrar's DNS. |
