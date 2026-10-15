# The document vault's scanner (`services/scanner`)

Audience: danlo (Fly steps, Vercel steps) and the orchestrator (rollout,
rotation, ops-health follow-up).

## 1. What it is

One Fly machine (`iad`, `shared-cpu-1x`, 2 GB, always on): ClamAV + a
dependency-free Node shim (`services/scanner/src`). It holds no database or
storage credential — only `SCANNER_CLIENTS`, a list of `<secret>@<origin>`
entries, each binding one caller's secret to that caller's own storage
origin. It writes nothing anywhere: it fetches the one URL a signed `POST
/scan` request hands it, from the caller's own origin only, scans it against
clamd, and answers a verdict (clean, infected, unscannable, or error with its
stage). `GET /health` answers clamd's up/down state, the signature database's
date, and the INSTREAM self-test's own result (clamd can answer PING and
still be unable to scan). Two callers in production: Production and Preview,
each with its own secret bound to its own storage origin — never the same
secret used for both.

## 2. Create (once, with the owner's Fly account)

```
<FLYCTL> auth login
```

From `services/scanner/`:

```
<FLYCTL> launch --no-deploy --copy-config --name <app>
<FLYCTL> config validate
```

(`--copy-config` keeps the `fly.toml` already in the repo; do not let
`launch` regenerate it.)

Generate two secrets, one per caller:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set both as one `SCANNER_CLIENTS` value, Production first:

```
<FLYCTL> secrets set SCANNER_CLIENTS="<prodSecret>@https://tlbkbmlrfafquucsmsmm.supabase.co <previewSecret>@https://odnobiodsftffphuuosz.supabase.co"
```

Deploy and confirm the machine is up:

```
<FLYCTL> deploy
<FLYCTL> status
```

## 3. Read its health without exposing a secret

`SCANNER_SECRET` in the environment, read only into this one command — never
printed:

```
node -e "
const crypto = require('crypto');
const secret = process.env.SCANNER_SECRET;
const ts = Math.floor(Date.now() / 1000);
const sign = (s, t, m, p, b) => crypto.createHmac('sha256', s).update(\`\${t}.\${m}.\${p}.\${b}\`).digest('hex');
fetch(process.env.SCANNER_URL + '/health', {
  headers: { 'x-bis-scan-timestamp': String(ts), 'x-bis-scan-signature': sign(secret, ts, 'GET', '/health', '') },
}).then((r) => r.json()).then((j) => console.log(JSON.stringify(j)));
"
```

The canonical string signed is `${timestamp}.${method}.${path}.${body}`
(`services/scanner/src/hmac.mjs`), the same one the app's own
`scan-client.ts` signs with.

## 4. Vercel

```
SCANNER_URL=https://<app>.fly.dev
```

in both Production and Preview (same worker, same origin).

`SCANNER_SECRET` is NOT the same value in both: `prodSecret` in Production
only, `previewSecret` in Preview only. Never both values in one environment
("Add New" on an existing name silently no-ops — Remove-then-Add, then
redeploy; `.env.example`'s own note on this applies here too).

```
vercel env add SCANNER_URL production
vercel env add SCANNER_URL preview
vercel env add SCANNER_SECRET production
vercel env add SCANNER_SECRET preview
```

Redeploy after any change — env changes need a fresh deploy.

## 5. Rotate a caller

1. Add the new secret to `SCANNER_CLIENTS` beside the old one (both valid at
   once):
   ```
   <FLYCTL> secrets set SCANNER_CLIENTS="<old entries> <newSecret>@<same origin>"
   ```
   (`secrets set` restarts the machine on its own; a bare `<FLYCTL> deploy`
   also picks up the new value.)
2. Change that caller's Vercel value (`SCANNER_SECRET`) to the new secret,
   redeploy.
3. Once the new deploy is confirmed healthy, remove the old entry from
   `SCANNER_CLIENTS` and `<FLYCTL> secrets set` again.

## 6. When it is red

`/api/ops/health` names `documents.scanner` (or the alert email fires) with
words saying which: not configured; worker unreachable; clamd down;
signatures N hours old; a file has waited N minutes. Read, in order:

```
<FLYCTL> logs
<FLYCTL> machine restart
<FLYCTL> ssh console -C "clamdscan --version"
```

Files wait meanwhile ("Checking"); nothing opens unscanned, so there is no
urgency to a destructive fix.

## 7. Memory (assumption A1)

```
<FLYCTL> machine status
```

or the metrics page, read especially right after a freshclam signature
reload (the moment memory peaks). If usage crosses 1.6 GiB:

```
<FLYCTL> scale memory 4096
```

The owner decides the cost of this (deviation 12); do not do it unasked.

## 8. A file that stays "Checking"

Read why first (read-only; beside the heartbeat's words and the shim's
per-scan log line, `<FLYCTL> logs`: verdict, stage, ms — never a URL):

```sql
select id, account_id, scan_attempts, scan_tried_at, created_at
from document_versions
where status = 'ready' and scan_status = 'pending'
order by created_at limit 20;
```

- **(a) The heartbeat says every file "could not be reached":** the wiring
  (a `SCANNER_CLIENTS` binding, §4 above) or the network. Nothing counts yet
  against any file; fix the binding.
- **(b) The self-test fails:** the worker itself. `<FLYCTL> machine restart`,
  then `<FLYCTL> logs`.
- **(c) ONE version's object is confirmed missing** (its log lines say stage
  `missing`): it counts one attempt per run and is removed as unscannable, by
  itself, at the third attempt. No action needed.
- **(d) ONE version keeps failing for a transport reason** while others scan
  clean (its log lines say `transport`: it always times out, or storage
  refuses it with something other than not-found): it never counts toward
  the limit, so it stays "Checking" until someone decides to end it by hand.

To end (d) by hand, go through the APP's own verdict path, so
`document.unscannable` is emitted exactly as an automatic removal emits it —
object removed first, then the verdict recorded, never the reverse (prefer
this to raw SQL):

```
pnpm exec tsx -e "import('@bis/db').then(async (b) => { const db = b.serviceDb(); const v = { accountId: '<account>', versionId: '<version>', storagePath: '<account>/<document>/<version>' }; const { error } = await db.storage.from(b.DOCUMENT_BUCKET).remove([v.storagePath]); if (error) throw error; console.log(await b.recordDocumentScan(db, { accountId: v.accountId, versionId: v.versionId, verdict: 'unscannable', signature: null })); })"
```

Run this from `apps/web`, with that project's service values in the
environment for this one command only (production's live only in Vercel
Production; never write them to a file).

If production's service key cannot be put in a shell — the rule since
2026-10-07 is that it lives only in Vercel Production — use this fallback and
SAY SO in the ledger: remove the object through the storage dashboard first,
then through MCP `execute_sql`, in ONE statement (so a stale verdict records
no event):

```sql
with v as (select public.record_document_scan('<account>', '<version>', 'unscannable', null) as r)
insert into public.events (account_id, type, actor_type, actor_id, payload)
select '<account>', 'document.unscannable', 'system', 'documents-scan',
  jsonb_build_object('documentId', v.r->>'document_id', 'versionId', '<version>')
from v where v.r->>'status' = 'ok'
returning id;
```

(The exact row `emit` writes, `packages/db/src/events.ts:34-36`. No row
returned means the version was no longer pending and nothing was written.)

The card then reads "Couldn't check this file". Never mark a version clean
by hand.

## 9. Roll back

The app side reverts with the PR. The machine itself can be stopped —

```
<FLYCTL> scale count 0
```

— and files then simply wait ("Checking") rather than fail; nothing opens
unscanned either way. 0079's own rollback is in its migration header.
