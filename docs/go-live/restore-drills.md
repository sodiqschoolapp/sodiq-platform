# Restore drills

The owner's monthly restore test (`13`, Backups; `14`, Recovery; answer 12), by the steps of `docs/restore.md`, "The monthly drill". One line per drill: no data, no id, no name.

| Date | Copies opened (Neon history, R2 export) | Minutes to open and check each | What did not work as written |
| --- | --- | --- | --- |
| 1 November 2026 | Neon history (07:10 of the same morning); R2 export of 1 November | about 10; about 55 (download, restore 35, checks) | On Windows `sslrootcert=system` failed (the Let's Encrypt root file worked); the parent branch is `production`, not `main`; the downloaded file is `daily_<date>.dump`; `pg_restore` stopped at Neon's own default privileges after restoring everything else; the restore from Tashkent took 35 minutes. `docs/restore.md` corrected for each. |
| ____ | ____ | ____ | ____ |
