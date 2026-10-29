# Restoring a backup

The written steps of `13` (Backups) and `14` (Recovery), task 10.2a: how a backup is opened as a **side copy inside the live environment, under the same access rules**, how damaged entries are repaired from it, and the monthly drill the owner runs (answer 12). The owner follows them; no Claude session connects to production or to a copy of it (answer 3).

Targets (`edge/system-behaviour`, "A bad release corrupts marks at 09:10"): at most **5 minutes** of entries lost, service back within **2 hours**. The live system is not rolled back for damaged entries: that would erase the valid work since. A full restore is only for total loss.

There are two backups:

| | Neon's restore history | The daily export in R2 |
| --- | --- | --- |
| What | Any moment of the last **7 days** (Launch plan, answer 11; 30 days on Scale) | One dump a day at 02:30 Tashkent, kept **35 days** |
| Where | Neon, project `sodiq-production` | Cloudflare R2, bucket `sodiq-backups`, `daily/<date>.dump` |
| Use it for | Damaged entries of the last week, to the minute | Older damage, or Neon itself lost |

Every value in angle brackets is yours. Passwords are typed when `psql` asks, never on the command line.

## 1. A side copy from Neon's restore history (the usual case)

1. Neon console, project `sodiq-production`, **Branches**, **Create branch**: name `restore-<date>`, parent `main`, **from a point in time**: the moment just before the damage (Tashkent time shown in your browser's zone; check it). The copy opens within seconds; production is not touched.
2. The branch has its own host (Connection details, the branch `restore-<date>`, **direct**, not pooled). It carries the same roles, `sodiq_migrator` and `sodiq_app`, with the same passwords, and the same row filters: the same access rules as production.
3. Go on with "Reading the copy" below.

## 2. A side copy from the daily export

When the damage is older than 7 days, or Neon's history is gone.

1. Cloudflare dashboard, R2, `sodiq-backups`, `daily/`: download the dump of the day before the damage (`<date>.dump`) to the laptop. It holds every person of the school: keep it on the laptop's encrypted disk only and delete it at the end (step 6).
2. Neon console, project `sodiq-production`, **Create branch** `restore-<date>` from `main` at the current moment: it carries the roles `sodiq_migrator` and `sodiq_app`, so the copy keeps the same access rules. In its **SQL editor** (the console role may create a database), on the database `neondb`:
   ```sql
   create database sodiq_restore owner sodiq_migrator;
   ```
   Then on the laptop restore the dump into it as its owner:
   ```bash
   pg_restore --exit-on-error --no-owner --role=sodiq_migrator \
     --dbname="postgresql://sodiq_migrator@<branch host>/sodiq_restore?sslmode=verify-full" <date>.dump
   ```
   (`pg_restore` of PostgreSQL 18; `--no-owner --role=sodiq_migrator`: only `sodiq_migrator` owns tables there, as in production; the grants to `sodiq_app` and the row filters of the dump come back as they are.) The command ends without an error. In the steps below, the database of this copy is `sodiq_restore`, not `sodiq`.
3. Check the copy: `select count(*) from schema_migrations;` gives the number of migrations of that day, and `select max(changed_at) from journal_cell_history;` a moment of the evening before the dump.
4. Go on with "Reading the copy".

## 3. Reading the copy

Read the copy as **`sodiq_app`** with the branch filter set, as the API reads it, never with Neon's console role (`neondb_owner`): that role belongs to `neon_superuser` and passes every row filter (`docs/deploy.md`, Neon). One branch at a time:

```bash
psql "postgresql://sodiq_app@<branch host>/sodiq?sslmode=verify-full"
```
```sql
begin read only;
select set_config('app.branch_ids', '{<branch id>}', true);
-- for example the cells of one lesson as they were:
select student_id, mark, score, version, changed_at
from journal_cells where lesson_id = '<lesson id>' order by student_id, work_id;
rollback;
```

The ids are in the app's addresses (a lesson, a journal) and in the audit log (Audit log page, the entry of the damaging change, its request id and record).

## 4. Repairing from the copy

Compare each damaged entry with the copy (step 3) and the live one (the app), then **type the right value again in the app**, as the person who may change it (an Academic Vice Principal's correction, or an unlock for a locked lesson). The repair is then a change like any other: history, audit log, the reason typed. Never write to the live database by hand.

For many entries, write down the list (lesson, student, value) from the copy first, and agree with the Academic Vice Principal who types them.

## 5. A full restore (total loss only)

Only when production's database is lost or unusable as a whole, after agreeing it with the school:

1. Render: suspend `sodiq-api` and `sodiq-worker` (the users see the service is down).
2. Neon: restore `main` of `sodiq-production` to the chosen moment (**Restore**, "to a point in time"), or, when Neon's history is gone, create a new project as in `docs/deploy.md`, Production, step 1, and restore the newest dump into it as in step 2 above.
3. Render: when the address changed, update `DATABASE_URL` on both services and `DATABASE_MIGRATION_URL` and `BACKUP_DATABASE_URL` in GitHub. `BACKUP_DATABASE_URL` is `sodiq_backup` on a **read-only compute** of the restored project: add a read replica to it first, and the role in its console (`monitoring.md`, step 6); the nightly run refuses any other connection. Resume both services. The smoke test: `node apps/api/dist/deploy/cli.js smoke https://app.sodiqschool.uz` from the laptop's build, or simply sign in.
4. Tell the school which moment the data is from: every entry after it is typed again.

## 6. Afterwards

Delete the side copy: Neon, Branches, `restore-<date>`, **Delete**. Delete any downloaded dump from the laptop (and empty the bin). A copy holds every person's data and is never kept.

## The monthly drill (answer 12)

Once a month, on a quiet day (not at the end of a quarter):

1. Open a side copy from Neon's history at a moment of yesterday (section 1) and read one lesson's cells (section 3).
2. Open a side copy from the newest daily export (section 2) and check it (step 3).
3. Delete both (section 6).
4. Note it in `docs/go-live/restore-drills.md`: the date, which copies, the minutes each took, anything that did not work as written. No data, no id.

When a step here did not work as written, the drill's note says so and the steps are corrected.
