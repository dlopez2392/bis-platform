# Restore drill

A backup that has never been restored is a hope, not a backup. Once a quarter,
restore production's latest backup into a **new, temporary** Supabase project,
prove it holds what production holds, and delete it the same hour.
(Operational-floor spec §4, decision 3, danlo 2026-10-01: a manual drill. An
automated one would need a production database credential in GitHub, which
this repository's rule that CI never touches production forbids.)

**Audience:** danlo (the dashboard steps) and the orchestrator (the read-only
comparison through the Supabase MCP).
**Takes:** about an hour, most of it waiting on the restore.
**Touches production:** never for writing. The restore goes to a *new* project,
and production is only read, by one read-only SQL file.

## Before you start

1. **Confirm the plan.** Production is in the paid organization (see the facts
   table in `ci-supabase-project.md`). In the dashboard, open
   Organization → Billing and write the plan name in the log below. "Restore to
   a new project" is a paid-plan feature. If the option is missing, stop and
   record that: it is the finding.
2. **Check the backups exist.** Production project → Database → Backups. Note
   the newest backup's time (this is the **backup age** in the log) and whether
   point-in-time recovery is on.

## The drill

1. **Restore into a new project.** Database → Backups → the newest backup →
   **Restore to a new project**.
   - Name it `bis-restore-drill-YYYYMMDD`.
   - Put it in the same region (us-east-1).
   - **Never** choose "Restore" on production itself, which overwrites
     production.

   Wait for it to come up.
2. **Run the comparison on the restored project.** Open its SQL editor, paste
   `packages/db/supabase/drill/restore-check.sql` unchanged, run it, and save
   the output.
3. **Run the same file on production.** The orchestrator runs it through the
   Supabase MCP `execute_sql` on `tlbkbmlrfafquucsmsmm`, or danlo uses the SQL
   editor. It is read-only and prints counts, versions and timestamps, never a
   row.
4. **Compare.** A good restore means:
   - `migration` is the **same** on both sides.
   - `tables` is the **same**.
   - every `rows:<table>` on the restored side is **equal or lower** than
     production. It is never higher, and never missing, because the backup is
     older than now.
   - every `newest:<table>` on the restored side is **no later** than the
     backup time from "Before you start" step 2.

   Anything else is a failed drill: a table missing, a higher count, an older
   migration, or an error running the file. Record it and raise it the same
   day.
5. **Sign in once** to the restored project's Table Editor and open `accounts`.
   Seeing the client rows proves the data is readable, not just countable.
6. **Delete the temporary project.** Project Settings → General → Delete
   project. It holds a full copy of client data. It must not outlive the
   drill, and nothing may point at it.
7. **Log it** below.

## When a real restore is needed

This drill is the rehearsal for that day. The order on the day:

1. Take the phones back first. Use the per-account call forward, or
   `VOICE_FORWARD_TO` for every account (`voice-setup.md`).
2. Restore to a **new** project, exactly as above.
3. Verify it with the same comparison.
4. Only then repoint the app's env (Vercel: `NEXT_PUBLIC_SUPABASE_URL`, the
   service-role key, `SUPABASE_DB_URL`) and redeploy.

Restoring over production in place loses everything written since the backup,
and it cannot be undone.

## Drill log

| Date | Plan | Backup age | PITR | Duration | Result | Notes | Run by |
|---|---|---|---|---|---|---|---|
| | | | | | | First drill: run when this runbook ships | |
