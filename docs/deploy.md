# The test environment and the deploy

How a merge to `main` reaches the test environment at `https://app-test.sodiqschool.uz`, what the owner sets up once, and what to do when something fails. Built in task 0.10; the spec is `docs/spec/13-technology.md` (Hosting and data, Running cost) and the decisions are in `docs/decisions.md`, 9 October 2026. Production comes with task 10.4 and follows the same steps with its own names.

Nothing in this guide asks for a secret in chat or writes one into the repository. A secret is typed where it is used: the provider's dashboard, GitHub's environment, or `psql` on the laptop.

## How a deploy runs

1. A pull request is merged. `.github/workflows/ci.yml` runs `checks` and `e2e` on `main` as on every pull request.
2. When both pass, the job `deploy-test` runs (GitHub environment `test`):
   - `pnpm db:migrate` applies the new migrations to the test database on Neon, with the migration address from the environment's secret. The address is Neon's **direct** one (the runner holds a session lock, which a pooler does not carry). It finds `db/migrations` in the checkout; the Render services never run migrations.
   - `node apps/api/dist/deploy/cli.js deploy --commit <sha> <api service> <worker service>` asks Render to build and deploy both services at exactly the merged commit, and waits (a look every 15 seconds, at most 20 minutes) until both are live.
   - `node apps/api/dist/deploy/cli.js smoke https://app-test.sodiqschool.uz` runs five checks through the real name: the health route, the web app's page, a refused session, a refused non-JSON body, and a refused WebSocket upgrade of the live connection. The real name matters: it proves the `Secure` cookie, the cross-site check and the WebSocket pass the load balancer.
3. Render deploys without stopping the service: a new instance starts, must answer `GET /api/health`, then takes the traffic; the old instance gets a stop signal and up to 30 seconds to finish (the API closes its connections in order, the worker finishes a running job). A new version that fails its health check never takes traffic: the previous one stays live and the run fails.

Two rules a release must keep:

- **Every migration works with the version that is running.** The old version runs on the new schema from the migration until the deploy is live, and stays on it when the deploy fails. That is the two-step rule of `CLAUDE.md` (a column is added in one release and required in a later one; nothing is renamed or dropped while code reads it).
- **A deploy that failed after its migration is fixed forward**: a new pull request, not a reversal of the migration (migrations are forward-only, decision 0.2).

### Deploys queue

While a deploy runs, a newer merge waits; GitHub keeps one waiting run, so a third merge replaces the second one's waiting run. The next deploy then takes the newest commit of `main` with every migration up to it. Nothing is lost: every commit of `main` was tested by its own `checks` and `e2e` run.

### Taking a release back

`14`, Releases: back to the previous version in minutes. Two ways:

- Run the deploy command with the previous commit from the laptop. Read the key into the shell without echo and without a trace in the shell's history, then run the command:
  ```bash
  read -s RENDER_API_KEY && export RENDER_API_KEY
  ```
  ```bash
  node apps/api/dist/deploy/cli.js deploy --commit <previous sha> <api service id> <worker service id>
  ```
  then `node apps/api/dist/deploy/cli.js smoke https://app-test.sodiqschool.uz`, and close that terminal.
- Or in Render's dashboard: the service, Deploys, the previous deploy, Rollback. Do it for the API and the worker.

The old code then runs on the new schema; that is safe by the first rule above. The next merge deploys forward again.

### When the run fails

Open the run in GitHub (Actions, CI, the commit of the merge). The failed step says what happened:

- **Apply the migrations**: the runner's message. A refused file (edited, renamed, out of order) is a repository problem; a wrong address or password is the secret `DATABASE_MIGRATION_URL` of the environment `test`. Nothing was deployed.
- **Deploy**: `<service>: deploy <id> ended as build_failed` (read the build log in Render: usually a dependency or a command), `update_failed` or `pre_deploy_failed` (the new instance did not pass its health check: read the service's log), or `still … after 20 minutes` (Render is slow or stuck: look at the dashboard). The previous version is still live.
- **Smoke test**: `n of 5 checks failed: <name> (<problem>)`. The new version is live but something is wrong on the real name: the DNS record, the domain on the service, a header the load balancer changed. Fix forward or take the release back.

A fault of the running API or worker is in Sentry (project `sodiq-test`) with the request id, the job name or the part (`live`, `jobs`), and in the service's log on Render under the same request id.

## One-time setup, in this order

Do one step at a time and check it before the next. Every value in angle brackets is yours; none of them goes into a file of the repository.

### 1. Neon: the test database

1. At console.neon.tech create a project `sodiq-test`, region **Frankfurt** (eu-central-1), PostgreSQL **18**, on the **Launch** plan (decided by the owner: the Free plan suspends a project after 100 CU-hours a month, and the API's listener and pg-boss keep the compute awake, about 180 CU-hours; Launch has no monthly minimum). Scale to zero may stay on.
2. Copy the connection string the console shows for the project's own role (the one it created, something like `neondb_owner`), **direct connection, not pooled**.
3. On the laptop, with `psql` installed, run:
   ```bash
   psql "<that connection string>" -f db/setup/server.sql
   ```
   It asks two passwords (make them long and random, for example `openssl rand -base64 32` twice) and creates the roles `sodiq_migrator` and `sodiq_app` **with SQL** and the database `sodiq`. `psql` shows what you type at a prompt: clear the terminal afterwards (`clear`, or close it). Never create these roles in Neon's console: a console role is a member of `neon_superuser`, which bypasses the row filters, and the API refuses every transaction of such a user. Keep both passwords in your password manager; they are typed twice more below and nowhere else.
4. Build the two addresses from the console's host (the direct host, without `-pooler`):
   - migrations: `postgres://sodiq_migrator:<password>@<host>/sodiq?sslmode=verify-full`
   - application: `postgres://sodiq_app:<password>@<host>/sodiq?sslmode=verify-full`

   `sslmode=verify-full` makes the driver check Neon's certificate; `require` would only warn.
5. Nothing more here: the first run of the deploy job applies the migrations. If that run says the extension `btree_gist` could not be created (it is a trusted extension, so the owner of the database may normally create it), create it once from Neon's SQL editor with `create extension if not exists btree_gist;` on the database `sodiq` and run the job again.

### 2. Sentry: the error reports

1. At sentry.io create an organisation (Developer plan, free) and a project `sodiq-test` of platform Node.js. Copy its DSN (Settings, Client Keys): an address `https://<key>@<org>.ingest.sentry.io/<id>`. A DSN is not a secret in the strict sense (the web app's one is in the browser bundle), but it is still entered in dashboards only.
2. A second project `sodiq-test-web` of platform Browser, for the web app, with its own DSN. (One project for both would mix stack traces of two runtimes.)
3. What a report holds is fixed in code and tested (`apps/api/src/reporting/`, `apps/web/src/reporting/`): the error's name, message and stack, the request id or the job name, the environment and the release (the commit). Nothing of a request, a session, a person or a row; the web app sends the page's path without its query. Keep the projects' data scrubbing on anyway.

### 3. Render: the services

1. At render.com create a workspace (Pro, decided in `13`), region Frankfurt, and connect it to the GitHub repository `sodiqschoolapp/sodiq-platform` (read access is enough).
2. Dashboard, Blueprints, **New Blueprint Instance**, choose the repository and the branch `main`. Render reads `render.yaml` and shows the two services `sodiq-test-api` (2 instances) and `sodiq-test-worker`, and asks for the values marked `sync: false`:
   - `DATABASE_URL`: the application address of step 1.4, the **same** on both services;
   - `SECOND_STEP_KEY`: `openssl rand -base64 32` once, the **same** on both services. Keep it in the password manager with the database passwords: without it no stored second step can ever be read again (0.6c), so it belongs with the backups;
   - `SENTRY_DSN`: the DSN of `sodiq-test`, on both;
   - `VITE_SENTRY_DSN` (API service only): the DSN of `sodiq-test-web`.
3. Apply. Render builds both services once from `main` and tries to start them. **This first start fails, and that is expected**: the database has no tables yet (the migrations run in step 7), and the API and the worker refuse to start without the job queue's schema. Render shows the deploy as failed; nothing is wrong. What must succeed here is the **build** (the log's first part): it installs the pinned pnpm with `npm install -g pnpm@…` before `pnpm install`, and Node comes from `.node-version`. If the build itself fails, read its log; a fix is a small pull request on `render.yaml`.
4. On the API service, note the **service id** (`srv-…` in the dashboard's address) and do the same for the worker. Also create an **API key** (Account Settings, API Keys). These go to GitHub in step 5.
5. The custom domain: the Blueprint declares `app-test.sodiqschool.uz` on the API service. Render shows the record to add; at the registrar (Eskiz) add **one** DNS record, a CNAME `app-test` pointing at the API service's `onrender.com` host. Nothing existing in the zone is touched (`test.` and `api.` belong to other projects). Render issues the certificate when the record resolves (minutes to an hour).
6. The certificate does not depend on the services running; the page answers after step 7.

### 4. Cloudflare R2: the bucket

1. At dash.cloudflare.com, R2 Object Storage, create the bucket `sodiq-test-files`, location hint **Western Europe** (and the EU jurisdiction if the dialog offers it).
2. No token yet: the first task that stores a file creates its API token (a token is shown once and would otherwise have to be kept until then). The daily backup export of 10.2 and the photos of 2.x are those tasks.

### 5. GitHub: the environment `test`

Repository Settings, Environments, **New environment** named exactly `test`. No protection rules for the test environment (production, in 10.4, gets the owner as required reviewer, so that a release goes out outside lesson hours). Add:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `DATABASE_MIGRATION_URL` | the migrations address of step 1.4 (the only place `sodiq_migrator`'s password exists outside the password manager) |
| Secret | `RENDER_API_KEY` | the API key of step 3.4 |
| Variable | `RENDER_API_SERVICE_ID` | the API service's `srv-…` id |
| Variable | `RENDER_WORKER_SERVICE_ID` | the worker's `srv-…` id |
| Variable | `TEST_URL` | `https://app-test.sodiqschool.uz` |

### 6. Resend: the account

At resend.com create the account in the **EU** region. No domain, no key yet: the sender address (`@sodiqschool.uz` or a subdomain) is a school decision, verifying it is the one step that writes into the school's DNS zone, and nothing is sent before task 2.3 (password reset by email). 2.3 adds the domain, the key `RESEND_API_KEY` and the mail service.

### 7. The first deploy and the first account

1. Merge the next pull request (or re-run the `CI` workflow of the last commit on `main` from the Actions tab: "Re-run all jobs"). The job `deploy-test` applies the migrations, deploys and runs the smoke test. Green means the task's "done when" is met. Open `https://app-test.sodiqschool.uz` and expect the sign-in page; there is no account yet.
2. The first Super Admin: open the API service on Render, **Shell**, and run
   ```bash
   node apps/api/dist/modules/auth/cli.js first-account --first-name <name> --last-name <name>
   ```
   It prints the login and the first password once (valid 7 days, changed at the first sign-in). Sign in at `https://app-test.sodiqschool.uz`. The command refuses while a Super Admin exists.
3. Invented data for the test environment (`13`: "a copy of real structure with invented data") is not part of this task; the owner names the task that seeds it.

## Rare cases

- **The API or the worker does not start and the log says `SECOND_STEP_KEY does not decrypt the oldest stored secret`.** Either the key on Render is not the one the secrets were encrypted with (restore it from the password manager), or the oldest row itself is damaged. In the second case only, from Neon's SQL editor as the project's own role: find it with `select account_id, created_at from account_second_steps order by created_at, account_id limit 1;` and remove that one row with `delete from account_second_steps where account_id = '<id>';`. That person sets the second step up again at the next sign-in. Nothing else is touched.
- **The key was lost.** Every stored second step is unreadable; with a new key every person who gives a code loses the second step and sets it up again with the password alone (0.6c). Avoid it: the key lives in the password manager with the database passwords.
- **Migrations 0006 and 0008 on a database with open sessions** (the laptop's note): a session older than 15 minutes ends as idle at its next request, one older than 7 days ends. The test environment had no sessions before its first deploy; production in 10.4 is deployed once, empty.
- **An uncaught exception in the API or the worker.** It is reported and the process exits, as Node does without a handler (Sentry's handler is set to exit even when another handler exists, and unhandled rejections are strict). Render starts the instance again; while it is down the health check keeps traffic on the other instance. Read the report, fix forward.
- **Sentry is unreachable.** No answer and no job waits for it: a report is queued and dropped if it cannot leave; a stop waits at most 2 seconds for the queue.

## What this task left for later

- Production, its Neon project, its environment with the owner's approval, the go-live checklist: 10.4.
- Grafana Cloud, UptimeRobot, alerts to Telegram, the sign-in-and-save check, the daily export to R2, the restore drill, request logging: 10.2.
- Sentry source maps of the web app (minified stack traces until then): 10.2. The API's stack traces already name TypeScript lines (`--enable-source-maps`; the `.map` files stay on the server).
- The mail service and `RESEND_API_KEY`: 2.3. The R2 token: the first task that stores a file.
- The solver service on Render: 5.x.
