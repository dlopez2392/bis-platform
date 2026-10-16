# The document vault, part 2: scanning, customer upload links, the "7 de 9" checklist (S-07 + F-005, first release item 6)

**Status:** owner-approved in brainstorming on 2026-10-15, section by section. The written spec is waiting for the owner's review.
**Builds on:** `docs/superpowers/specs/2026-10-13-document-vault-design.md` (part 1; 0077, 0078, #258, #259). Its §1 table names part 2's contents; its §8 names decision 2, settled below.
**Source:** `docs/crm-features.md` surface 3 (:2618-2660), F-005 (:1898), §9 decision 2 (:3049); study `docs/research/2026-09-25-crm-feature-research.md` §3.4 (:286-335); appendix D (:327-336, malware scanning).

## 1. Scope

Part 2 ships as three PRs, in this order; each leaves the vault working on its own.

| PR | Contents | Migration |
|---|---|---|
| **2a** | Virus scanning for every file (staff and customer): the ClamAV worker on Fly.io, a per-version scan state, the single read gate, the retry pass, the virus-removed state, a catch-up scan of part 1's files | 0079 |
| **2b** | Customer upload links ("Pedir al cliente"): the request, its delivery by text, email or copied link, the public page `/d/[token]`, customer uploads filed under the requested category | 0080 |
| **2c** | The "7 de 9" checklist: the account's required categories (Settings), per-customer skips, the meter and the missing items on the customer's Documents card | 0081 |

**Not in part 2:** expiry reminders, share links, the account-wide Documents view (all part 3); the checklist on household/business pages or in the list drawer; required *fields*; pack-supplied lists (F-171 later fills 2c's setting); retention classes; any model reading a document.

## 2. Decisions (owner, 2026-10-15)

| # | Decision |
|---|---|
| P1 | **Decision 2 (crm-features §9), for the vault:** ClamAV is accepted as the scanner, running as an always-on daemon in a small container. |
| P2 | The container runs on **Fly.io** (one machine, ~2 GB RAM, region `iad`, near Vercel's `iad1`). |
| P3 | **Every file waits until clean.** Staff and customer uploads alike cannot be opened or downloaded until their scan passes. If the scanner is down, files wait; nothing is ever let through unscanned. Part 1's stored files get one catch-up scan. |
| P4 | **An infected file is deleted at once and leaves a visible note** ("Quitado: tenía un virus"), a timeline row and an event. Nothing infected is kept. *Owner ruling 2026-10-15:* a password-protected file (clamd: Heuristics.Encrypted.*) is removed the same way and its note says why: "Tiene contraseña: quítela y vuelva a subirlo"; the reason is kept in data (the version's scan_signature, read by one shared helper) so 2b's customer page can say it too. Other unscannable causes keep "No se pudo revisar este archivo". |
| P5 | A customer request **names the documents wanted** (categories, plus "Otro" with a note), as one link that expires in **7 days**, capped at **25 MB per file** and **20 files per request per day**. |
| P6 | **Staff pick the channel:** Text (only when the account can text and the customer has not stopped texts), Email (when there is an address), or Copy link (always). Text is pre-selected when available. |
| P7 | **The checklist's list is the account's** (Owners pick required categories in Settings; empty = off), **with a per-customer "No hace falta" skip**. An expired file counts as missing ("Vencido"). |

## 3. PR 2a: scanning

### 3.1 The worker (`services/scanner/`, new)

- The official ClamAV image (`clamd` + `freshclam`), plus a small Node HTTP shim, built from a `Dockerfile` and deployed with a `fly.toml`, both in this repo.
- `POST /scan` with `{ url }`: `url` is a signed GET (120 s) for ONE storage object. The shim streams the bytes to clamd's `INSTREAM` and answers `{ verdict: "clean" | "infected" | "error", signature?: string }`. It never writes anything anywhere.
- Every request carries an HMAC-SHA256 over its body and a timestamp, keyed by `SCANNER_SECRET`; a bad or stale (>60 s) signature gets 401 and the URL is never fetched. The shim fetches only `https://<project-ref>.supabase.co/storage/v1/object/sign/documents/...` URLs (an allow-list from its env), so it cannot be used as an open fetcher.
- `GET /health` (same HMAC): clamd reachable, and the signature database's age.
- The worker holds **no database or storage credential**: only `SCANNER_SECRET` and the allowed storage origins. A compromised host can scan URLs it is handed, nothing more.
- One always-on machine; no auto-stop (clamd must stay warm). Production and Vercel Preview call the same worker: it holds no data, and Preview's storage origin (bis-ci) is on its allow-list.
- *Amended 2026-10-15 (2a plan review):* the worker holds one secret PER CALLER, each bound to that caller's storage origin (`SCANNER_CLIENTS="<secret>@<origin> …"`), not one `SCANNER_SECRET`: a request signed with Preview's secret can only fetch bis-ci objects, so Preview never holds anything that reaches production. Each deployment keeps its own `SCANNER_URL` and `SCANNER_SECRET`. Errors name their stage (`clamd` or `transport`, §3.4). (Plan deviation 4; `docs/superpowers/plans/2026-10-15-document-vault-pr2a.md`.)
- Sizing (~2 GB for clamd's signatures, ~$10–12/month) is an **assumption** the plan confirms against Fly's pricing and clamd's measured memory.

### 3.2 Data (migration 0079)

- `document_versions.scan_status text not null` in (`pending`, `clean`, `infected`, `unscannable`), default `pending`; `scan_attempts int not null default 0`; `scanned_at timestamptz`; `scan_signature text` (the virus name, staff-only through the existing RLS).
- Part 1's rows are left `pending`, which makes the retry pass scan them (the catch-up).
- `documents.scan_status` is **dropped**: it is per document and predates versions. The app's one writer (`documents.ts:115`, always `'skipped'`) goes with it.
  - *Amended 2026-10-15 (2a plan review):* 0079 does NOT drop it: 0079 applies before the merge and the build running then still writes it on every upload. 0079 gives it a default and 2a's app stops writing it; **0080 drops it as its first statement.** (Plan deviation 2.)
- `current_version_id` moves to a new version only when that version is `clean`. The existing trigger (0077 §5) gains that condition. A document is listed once it has any `ready` version.
  - *Amended 2026-10-15 (2a plan review):* **superseded.** `current_version_id` keeps 0077's meaning (the newest ready version, which is what lists a file in seven places, `discardDocumentUpload` among them), and 0077's trigger and `mark_document_version_ready` are unchanged. What OPENS is the newest CLEAN ready version, derived in the card's read; the one mint function (§3.3) refuses anything not clean, so P3 holds without the pointer. (Plan deviation 1, accepted by the orchestrator 2026-10-15.)
- An RPC (service role only) records a verdict: compare-and-set from `pending`; on `clean` it advances `current_version_id` when this version is newer than the current one; on `infected`/`unscannable` it leaves the pointer. The bytes are deleted by the app (storage first, then the verdict), so a crash never leaves an infected object marked anything but `pending`.
  - *Amended 2026-10-15 (2a plan review):* the verdict function (`record_document_scan`, SECURITY INVOKER, service role only) moves NO pointer (this follows from the pointer keeping its meaning); `error` adds an attempt and stays `pending`. (Plan deviation 3.)

### 3.3 The single gate

Every signed READ URL for a version is minted by one function, which refuses unless `scan_status = 'clean'`. The viewer, Download and the Versions list all go through it, so "every file waits" holds by construction (P3). The scanner's own signed URL is minted by a separate, server-only function that is never reachable from a browser.

### 3.4 When scans run

- **At once:** the finish action (staff, and 2b's customer finish) calls the worker after the version becomes `ready`. Normally the verdict lands in a second or two and the row goes "Revisando" → "Listo".
- **Retry pass:** a new pass on the existing reminders cron (`/api/cron/reminders`, pass registry) scans every `pending` version oldest first, within a time budget, incrementing `scan_attempts`. After 3 attempts that each end in `error`, the version becomes `unscannable` and is handled like an infected one (bytes deleted, note shown): fail closed.
  - *Amended 2026-10-15 (2a plan review):* (1) The pass scans only while the worker's `/health` is good, so an outage never spends attempts (plan deviation 7). (2) **Only two causes count against a file** (restated after the final check, orchestrator ruling): the worker's error answer names its stage. `clamd` (clamd answered ERROR about this stream) counts. `missing` (storage said this object does not exist) counts ONLY after the app confirms, with its own service-role storage client, that the object of a ready version is really gone. Everything else is `transport` and never counts: any other 4xx (400, 401, 403, 429), any 5xx, a redirect, a network failure, every timeout (fetch or clamd, so slow storage or a signature reload can never remove files), the size limit, clamd unreachable. A countable cause takes one attempt, three at most, then the file is removed as unscannable with the generic note. A file that keeps failing for a transport reason stays "Revisando" with the heartbeat naming it; the retry order rotates past it, and the operator's runbook has the deliberate end. (3) **The breaker is the worker's self-test, not a count** (restated): `/health` streams a tiny fixed clean buffer through clamd; the pass scans only when it passes, holds every countable error during its run, and spends them only when the self-test passes AGAIN after the run, so a worker-wide fault (out of memory, broken signatures) never counts against any file, even with one pending file. The finish action never spends; only the pass does. The pass stamps each version `scan_tried_at` before scanning it and reads never-tried versions first, then the least recently tried, so a version that always times out cannot block the rest. Without (2) and (3), a misconfigured binding would delete every pending file in about 30 minutes while `/health` stayed green. (4) Content clamd could not fully read (a scan limit, encryption) is reported by clamd (`AlertExceedsMax`, `AlertEncrypted*`) and treated as `unscannable`, never clean. **Owner ruling 2026-10-15:** a password-protected file (`Heuristics.Encrypted.*`) is removed and its note says why ("Tiene contraseña: quítela y vuelva a subirlo"; see P4); every other cause keeps "No se pudo revisar este archivo". No limit is set below clamd 1.4's own defaults (`MaxFileSize 100M`, `MaxScanSize 400M`, `StreamMaxLength 100M`); ours are at or above them (`MaxFileSize 400M`, `MaxScanSize 1000M`, `StreamMaxLength 100M`; final whole-branch review M4). **Orchestrator ruling 2026-10-15:** a file that expands past them is treated as a decompression bomb, unscannable with the generic note, an accepted residual. (Plan deviations 15, 16, 17; plan review C1, C2; re-review N1, N2, N3.)
- **Heartbeat:** the pass records an `ops_heartbeats` row (0057) with the worker's `/health` answer. `/api/ops/health` goes red when the worker is unreachable, its signatures are older than 3 days, or any version has been `pending` for over 15 minutes.

### 3.5 What people see

- A row whose newest version is pending reads **"Revisando"** (dot + word); it cannot be opened. After 15 minutes it adds "Tarda más de lo normal", so it never reads as lost.
- While a NEW version is pending, the previous clean version stays current and opens normally; the Versions list shows the new one as "Revisando".
- **Infected:** the object is deleted; the version is marked; if no clean version is left, the row reads **"Quitado: tenía un virus"** (dot + word), with Move to trash available so staff can clear it. Timeline: "Se quitó *Lease*: tenía un virus" with the **automation** author mark; event `document.virus_removed` with `{ documentId, versionId }` (no file name, as part 1's deviation 3). The uploader sees the same row; there is no toast for a verdict that arrives after they leave.
- **Unscannable:** the same, reading "No se pudo revisar este archivo".
- *Amended 2026-10-15 (2a plan review):* (1) The timeline row follows the timeline's grammar, the automation mark first: "Automatización quitó *Lease*: tenía un virus" / "Automation removed Lease: it had a virus"; unscannable: "quitó *Lease*: no se pudo revisar" (plan deviation 10). (2) An unscannable file emits `document.unscannable` with the same payload `{ documentId, versionId }` (deviation 8). (3) There is no permanent "Listo" label: a clean file is the ordinary row, and the card re-reads while a file is "Revisando", so the word goes away by itself (deviation 11).
- All copy in English and Spanish.

## 4. PR 2b: customer upload links

### 4.1 Data (migration 0080)

`document_requests`: `id`, `account_id`, exactly one of `contact_id` / `client_group_id`, `items jsonb` (an array of `{ key, category, note }`, 1–9 items, `note` ≤ 80 chars, only with `other`), `language` (`en` | `es`, from the customer's language, then the account's), `token_hash` (sha256, unique), `channel` (`text` | `email` | `link`), `created_by`, `created_at`, `expires_at` (created + 7 days), `revoked_at`, `revoked_by`, `completed_at`. Server-written only; members read under the record's visibility (as `documents`). Each item's "answered" state is derived from documents carrying `request_id` + `request_item_key`, two nullable columns added to `documents`.

`documents.source` gains `customer`. A customer file's `created_by` / `uploaded_by` is `customer:<requestId>`, which the author-mark code reads as the **customer** mark.

The token: 32 random bytes, base64url, present only in the URL. The database keeps its sha256; nothing logs it.

*Amended 2026-10-15 (2b plan review):* (1) The token is DERIVED, not random: HMAC-SHA256 of the request id under `DOCUMENT_LINK_SECRET`, 32 bytes, base64url, so staff can Copy link on an open request again and a held text can be released without storing the link (orchestrator ruling; plan deviation 1). (2) `DOCUMENT_LINK_SECRET` is REQUIRED: a fresh random value of at least 32 bytes, different in Production and Preview, with no fallback to any other key; rotating it ends every open link. (3) Said precisely: no database column of ours holds the token (only its sha256) and our code never logs it; the link does travel in the text or email we send (so in that text's stored message row and in the provider's copy), and Vercel's request logs record the path `/d/<token>` of each visit. (Plan `docs/superpowers/plans/2026-10-15-document-vault-pr2b.md`, deviation 1, review M1 and I10.)

### 4.2 Staff side

- **Pedir al cliente** on the Documents card (contact and group pages) opens a dialog: tick categories (plus "Otro" with a note), then choose Text / Email / Copy link (P6).
- Text and email are composed in the request's language and sent through the existing send paths: consent holds and stops apply, quiet hours apply, and the send appears in "What went out". Copy link sends nothing and records `channel = 'link'`.
- The card lists open requests: "Pedido: Seguro, Identificación · vence en 6 días", with **Copy link** and **Revoke** (immediate, with Undo inside the toast's window).
- Timeline: "Ana pidió 2 documentos" (person mark). Revoke and expiry are not timeline rows.

### 4.3 The customer's page (`/d/[token]`, no sign-in)

- Carries the client's logo and brand colour (DESIGN.md rule 9), on `--surface-0`, "Powered by BIS" footer, in the request's language with `lang` set.
- Lists each requested item with **Subir** and, on a phone, **Tomar foto** (rear camera, EXIF stripped in the browser as part 1 §5.3).
- Per file: "Subiendo 45 %" → "Revisando" → "Recibido", or "No pudimos aceptar este archivo" (wrong type, too big, virus, over quota). The customer never sees or downloads anything stored.
- Expired, revoked and completed links each get their own plain page, naming the business and its phone number.

### 4.4 The upload path

- The same three steps as staff uploads (part 1 V6): two public routes, `POST /api/d/[token]/start` and `/finish`. Each re-proves the token (hash lookup, not expired, not revoked, not completed), then every query carries an explicit `account_id` and record filter (study §3.4, "every public link follows one rule").
- Limits: 25 MB per file; 20 starts per request per UTC day (*amended 2026-10-16, 2b review:* counted on the request row itself, `start_day` + `starts_today`, bumped under the start function's lock before the quota reservation, so a refused finish that deletes its rows, or an over-quota attempt, still counts; counting surviving `document_versions` let a link holder reset the limit); the account's 5 GB quota (over quota: the customer is asked to call, and staff get a work-queue item).
- The file is filed under its item's category, `owners_only = false`, source `customer`, linked to the request item, and scanned (2a).

### 4.5 When files arrive

- A clean file answers its item. When every item is answered, `completed_at` is set and the link stops working.
  - *Amended 2026-10-16 (owner rulings on the 2b final review):* (a) a clean version that STAFF upload onto a customer's requested document also answers its item (the business already has it; the link closes instead of asking again). (b) A customer file whose clean verdict arrives after the request was revoked still opens the "sent documents · Review" To-do: the file is real and filed on the record, so both the scan hook and the lost-To-do reconcile include revoked requests.
- Staff news: a timeline row per file ("Ana subió *Seguro*", customer mark). Staff work: ONE work-queue item per request, opened on its first clean file ("Ana mandó documentos · Revisar"), closed by staff.

*Amended 2026-10-15 (2b plan review):* (1) A file the customer had ALREADY started (its upload reserved and its link signed) still finishes after the request completes or expires; only a revoked request refuses it. The start refuses new files once a request is completed or expired. (2) The work-queue item cannot be lost: if opening it fails after a clean verdict, the scan pass opens it on a later run (a bounded check for open or just-completed requests with a clean customer file and no item). (Plan deviations 8 and 13; orchestrator rulings I5, I6.)

## 5. PR 2c: the "7 de 9" checklist

### 5.1 Data (migration 0081)

- `accounts.required_document_categories text[] not null default '{}'`, each element one of the nine keys; empty = the checklist is off.
- `document_requirement_skips`: `account_id`, `contact_id`, `category`, `skipped_by`, `created_at`; unique on (`contact_id`, `category`). Server-written; members read under the contact's visibility.

### 5.2 Settings

A **Documents** section in Settings (Owners and agency edit; others read), registered in the ⌘K palette: the nine categories as checkboxes, and one sentence, "Each customer's Documents card will show which of these they're missing." One primary Save (rule 8).

### 5.3 What counts

A required category is **met** for a customer by a document that is not in the trash, has a clean current version, and is not expired (`expires_on` is null or on/after today in the account's own zone), filed on the customer **or on any household/business they belong to**. Skipped categories are left out of both numbers.

### 5.4 On the customer's Documents card

- The card header reads "DOCUMENTOS 2 de 3" (met of required-minus-skipped).
- Each unmet item is named: **Falta: Seguro** or **Vencido: Identificación**, each with **Pedir al cliente** (2b's dialog with that item ticked) and **Subir** (an upload with the category preset).
- A skipped item reads "No hace falta" with **Hace falta otra vez**. Skip and un-skip run at once with an Undo toast (rule 6) and each gets a timeline row (person mark).
- All met: "Completo" (dot + word), and the list disappears. Checklist off: nothing is drawn.

## 6. Errors and states

- Every card loads, empties and fails on its own (part 1 §4.5); the checklist's read failing shows "No se pudo cargar la lista" without blanking the files.
- Scanner unreachable: files wait ("Revisando", then "Tarda más de lo normal"); the retry pass and ops health cover it (§3.4).
- Customer page: a failed PUT is retried once, then "No se subió. Intente de nuevo."; every refusal has designed copy in both languages.

## 7. Testing

- **Worker** (`services/scanner/`, its own CI job): the shim's unit tests; against the real clamd image, the EICAR test string answers `infected` and a clean PDF answers `clean`; a bad HMAC and a disallowed URL are refused without a fetch.
- **App:** the scan client mocked at its HTTP boundary. The gate refuses to mint for `pending`, `infected` and `unscannable`; current advances only on clean; the retry pass respects its budget and its 3-attempt rule; infected deletes storage before recording the verdict.
- **`@bis/db` / replica:** RLS and grants for 0079–0081; the verdict RPC's compare-and-set; token isolation (a token never reaches another account's or another record's rows; expired, revoked and completed tokens refuse both routes; a token for record A cannot file onto record B).
- **e2e:** CI has no scanner, so the e2e stack runs a **fake scanner** (*Amended 2026-10-15 (2a plan review):* the REAL shim in front of a fake clamd, `services/scanner/test/fake-clamd.mjs`, both started by Playwright's `webServer`, not a route: nothing fake is in the app or the image, so it cannot reach production, and the shim's HMAC and allow-list run in every e2e run; plan deviation 5) answering by content: EICAR → infected, else clean, behind the same HMAC. Specs: Revisando → Listo; the infected path; a customer upload through `/d/[token]` end to end without Clerk; the checklist meter and a skip with Undo.
- **Real scanner:** one manual EICAR upload on Preview before 2a merges (owner and orchestrator together).

## 8. Rollout

- **Every migration:** bis-ci first (`ci-project-setup.yml`), then production through MCP `apply_migration` once, then the parity check, then merge. Never re-apply.
- **2a, before merge:** the owner creates the Fly.io account and adds a card; the orchestrator creates the app with `flyctl`, sets its secrets, deploys, reads `/health`; `SCANNER_URL` and `SCANNER_SECRET` go into Vercel Production and Preview; the EICAR check on Preview. The catch-up scan runs by itself through the retry pass after deploy; the orchestrator reads that no version stays `pending`.
- **2b:** the plan reads `next.config.ts` and the middleware for CSP and public-route rules before adding `/d/[token]` and `/api/d/*`.
- **2c:** off for every account until an Owner opts in.
- **Tracker:** item 6 / F-005 stay `in_progress` until part 3.

## 9. Assumptions (each checked by the plan)

- **A1** clamd's resident memory with the current signature set fits a 2 GB Fly machine.
- **A2** Fly's price for that machine is about $10–12 a month.
- **A3** clamd's `INSTREAM` limit (`StreamMaxLength`) can be raised to 26 MB in the image's config.
  - *Amended 2026-10-15 (2a plan review):* the check is that the WHOLE stream is read, not only accepted: a 25 MiB file whose last member is the EICAR string must answer infected, beside a clean 25 MiB file answering clean, with every clamd limit at or above 1.4's own defaults (re-review N1: an earlier draft lowered them); and an XLSX-shaped file of about 1 MB that unpacks to 300 MiB must answer clean, with its scan time and peak memory reported (feeds A1).
- **A4** Supabase's signed GET URLs for the `documents` bucket are fetchable from Fly's network with no IP allow-listing.
