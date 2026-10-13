# The document vault, part 1: the staff vault (S-07 + F-005, first release item 6)

**Status:** owner-approved in brainstorming on 2026-10-13. The written spec is waiting for the owner's review.
**Source:** `docs/crm-features.md` §4.3 item 6 (S-07 re-costed 8–10 ew, F-005 +2–3), the S-07 row (:3750), F-005 (:1898), surface 3 (:2618-2648); study `docs/research/2026-09-25-crm-feature-research.md` §3.4 (:286-335) and the schema (:226-230); DESIGN.md "Documents" and the module contract.

## 1. Scope

Item 6 is split into three parts, each with its own spec, plan and PRs (decided 2026-10-13):

| Part | Contents | Depends on |
|---|---|---|
| **1 (this spec)** | The staff vault: staff upload (including the phone camera), a Documents card on contact and group pages, the viewer, the nine bilingual categories, versions, expiry in words, Owners only, trash with Undo, typed-name purge, one storage quota, EXIF stripping, a bucket created by migration, and a daily clean-up job | nothing new |
| 2 | Virus scanning (the quarantine state for real), customer upload links ("Pedir al cliente"), the "7 de 9" checklist | decision 2 (ClamAV and where it runs) |
| 3 | Expiry reminders, share links, an account-wide Documents view | part 2 |

**Not in part 1:**
- no customer-facing anything (`client_visible` exists, is always false, and has no control)
- no documents on properties or deals (their link columns exist but stay unused)
- no document in the list drawer
- no scanning
- no model ever reads a document (rule 14 / decision 6 is untouched)
- no per-tenant off switch (the tax-preparer hold stays as written in `crm-features.md` :3058)

## 2. Decisions (owner, 2026-10-13)

| # | Decision |
|---|---|
| V1 | Staff vault first. Scanning arrives with customer uploads, in part 2. |
| V2 | A document is filed on a customer (contact) or a household/business (group), exactly one. |
| V3 | Anyone who can see the record sees its documents (a Technician only for assigned customers). An **Owners only** flag limits a file to Owners and agency staff. This is enforced by RLS on the row. The stored file is reachable only through a server-minted signed URL issued after an RLS read. |
| V4 | One default quota for every account: **5 GB per account, 25 MB per file**. Trashed files count until they are purged. |
| V5 | Categories are a fixed bilingual list, stored as keys: `id`, `contract`, `estimate`, `invoice`, `photo`, `permit`, `insurance`, `warranty`, `other`. |
| V6 | Uploads are server-reserved and go directly to storage: a start action, then a browser PUT to a signed upload URL, then a finish action. They never pass through a Vercel function body, which is capped at 4.5 MB. |

| Category key | English | Spanish |
|---|---|---|
| id | ID | Identificación |
| contract | Contract | Contrato |
| estimate | Estimate or quote | Presupuesto |
| invoice | Invoice or receipt | Factura o recibo |
| photo | Photo | Foto |
| permit | Permit or license | Permiso o licencia |
| insurance | Insurance | Seguro |
| warranty | Warranty | Garantía |
| other | Other | Otro |

## 3. Data and storage (migration 0077)

### 3.1 Bucket
The migration creates the bucket with `insert into storage.buckets`:
- id `documents`
- `public = false`
- `file_size_limit = 26214400` (25 MiB)
- `allowed_mime_types` = `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX), `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (XLSX)

HEIC is **not** allowed, because the browser cannot strip its location data (§5.3). The migration adds **no `storage.objects` policy** for `authenticated` or `anon`: only the service role reads or writes objects. Unlike `brand-logos` (hand-made, `ci-project.sql:75`), a fresh environment gets the bucket from the migration itself. The plan confirms that the CI runners' local stacks (`ci-local-supabase.sh`) run storage inserts in a migration. If they do not, the plan adds the bucket to the bootstrap as well, and states why.

### 3.2 `documents`
| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| account_id | uuid not null → accounts | |
| contact_id, group_id, property_id, opportunity_id | uuid null, FKs | CHECK: exactly one is non-null. Part 1 writes only contact_id or group_id. |
| title | text not null | defaults to the file name without its extension; 1–200 chars |
| category | text not null | CHECK in the nine keys |
| expires_on | date null | |
| owners_only | boolean not null default false | |
| client_visible | boolean not null default false | no writer in part 1 |
| source | text not null | CHECK in (`upload`, `camera`); parts 2+ widen it |
| scan_status | text not null | CHECK in (`skipped`, `pending`, `clean`, `infected`); part 1 writes `skipped` (staff files are honestly not scanned) |
| current_version_id | uuid null → document_versions | the newest **ready** version; null only while the first upload is in flight |
| created_by | text not null | the Clerk user id |
| created_at, updated_at | timestamptz | |
| deleted_at | timestamptz null | in the trash when set |
| deleted_by | text null | |

Indexes: `(account_id, contact_id) where contact_id is not null`, `(account_id, group_id) where group_id is not null`, `(deleted_at) where deleted_at is not null`.

### 3.3 `document_versions`
Columns: `id`, `document_id → documents on delete cascade`, `account_id`, `storage_path` (unique; `{account_id}/{document_id}/{version_id}` and never derived from a file name), `bytes bigint not null`, `content_type` (the type read from the file's bytes, §5.2), `sha256 text null` (set at finish), `original_name text`, `uploaded_by`, `status` CHECK in (`uploading`, `ready`), `created_at`. A document is listed only once it has a ready version. "Upload a new version" adds a row, and `current_version_id` moves to it when it becomes ready.

### 3.4 Who can read (RLS) and who can write
- **SELECT** on both tables for a member of the account who can see the record the document is filed on:
  - a contact document: the same visibility as the contact row, so a Technician sees only their assigned customers (0068's helpers)
  - a group document: the same visibility as the group row
  - agency staff see everything
- `owners_only = true` additionally requires the member's role to be `owner`, or agency.
- The guard uses `coalesce(..., false)`, so a NULL never fails open (memory: plpgsql NULL guard).
- **No INSERT, UPDATE or DELETE grants for `authenticated`.** Every write goes through server actions using `serviceDb`, after `requireAccountAccess` plus an RLS read with `userDb` that proves the person can see the record (the 0053 server-only-writes pattern).
- Changing `owners_only` is allowed for Owners and agency only. Staff and Technicians can edit the other fields of files they can see.

### 3.5 Quota
A function `public.reserve_document_version(p_account_id, p_document_id, p_bytes, …)` is `SECURITY DEFINER` and executable by `service_role` only. It:
1. locks the account row (`for update`)
2. adds up `bytes` of every version with status `ready` or `uploading` on that account, trashed documents included
3. refuses if the new total would pass **5,368,709,120** bytes (5 GiB)
4. otherwise inserts the `uploading` version row and returns its id and path

Two simultaneous uploads therefore cannot both slip under the limit. The constant lives in one place, and the app reads it from the same module that tests pin.

### 3.6 Timeline
Adding, trashing, restoring and purging each record an event through `emit` (`packages/db/src/events.ts`): `document.added`, `document.trashed`, `document.restored`, `document.purged`. The payload carries the document id, title and the record it is filed on. A person's action is `actor_type 'user'`, and the daily job's purge is `'system'`. The record timeline shows these as rows with the person mark or the automation mark (DESIGN.md provenance: a row with no mark is a defect). The plan wires them into the contact and group timeline readers.

## 4. What people see

### 4.1 The Documents card
- **Placement:** a `documents` entry in `RECORD_CARDS` and in `GROUP_RECORD_CARDS` (`lib/record/record-cards.ts`), in the "what they have" column. On a phone it sits in the "what they have" group, closed until tapped (the record page's phone order). The list drawer is unchanged.
- **Title:** "Documents" / "Documentos", with the count.
- **Actions:**
  - **Upload** is the card's one primary button (rule 8: the card is its own view).
  - **Take photo** is a ghost button, shown only on coarse-pointer or narrow viewports. It is an `<input type="file" accept="image/*" capture="environment">`.
  - Desktop accepts drag-and-drop onto the card.
- **Rows:** newest first. Each row carries:
  - the title
  - the category word
  - the source in words: "Added by Ana · 3 days ago" / "Agregado por Ana · hace 3 días"; "Photo taken by Ana"; a person the reader cannot name reads "Someone on the team"
  - "Version 2", only when there is more than one ready version
  - the expiry in words: "Expires in 12 days", "Expires today", "Expired 3 days ago". When the expiry is 30 days away or less, or past, it is a dot plus the word (rule 3, never colour alone).
  - **Owners only** with a lock icon and the word, when set
- **The whole row** opens the viewer, has a visible focus ring, and hovers to `--surface-3`. A row menu, reachable by keyboard, offers: Rename, Category, Expiry, Owners only (Owners and agency only), Upload new version, Download, Move to trash.
- **Inline edits** (title, category, expiry, Owners only) save at once with an Undo toast. Undo is a compare-and-set on the value written, not a blind restore.

### 4.2 Uploading
1. **Choosing files.** Up to 10 files open an inline panel in the card. Each file gets a category select (default: `photo` for images, `other` for everything else). One **Owners only** checkbox and one optional expiry date apply to the batch, followed by one Upload button. The privacy choice is made before the file exists, so an owners-only file is never visible to the team even briefly.
2. **Progress.** Each file shows "Uploading 45%", then "Checking", then it joins the list.
3. **Failures.** A failed file stays as a row with the reason and a **Retry**:
   - "Too large: 31 MB. The limit is 25 MB."
   - "This kind of file can't be kept here. Use PDF, JPG, PNG, WebP, Word or Excel."
   - "Your account's 5 GB is full. Delete files you no longer need, or contact BIS."
   - "Couldn't upload. Try again."
4. **Space used.** Shown on the card only above 80%: "4.1 of 5 GB used".
5. **Camera and size.** A camera photo is re-encoded in the browser (§5.3) before the start action, so the size checked is the size stored.

### 4.3 The viewer
- A dialog over the page; Esc closes it.
- Images and PDFs are shown inline from a 120-second signed URL, re-minted on demand. Word and Excel files show a Download button only and are never rendered.
- The header shows the title, category, source line, expiry and Owners only.
- A **Versions** list (newest first) offers each older version for download.

### 4.4 Trash
- **Move to trash** is immediate, with an Undo toast (rule 6).
- **"Trash (n)"** at the foot of the card lists trashed files, each saying "Deleted for good in 27 days", with **Restore** (immediate, with an Undo toast) and **Delete forever**.
- **Delete forever** asks for the document's title to be typed. It is the only typed confirmation, and it is never shared with the trash move.
- Trashed files are excluded from the card's main list and count.

### 4.5 States and language
- **Empty:** "Contracts, IDs, photos and receipts for this customer are kept here. Upload a file or take a photo." Spanish: "Aquí se guardan los contratos, identificaciones, fotos y recibos de este cliente. Suba un archivo o tome una foto." Usted, per Q5. The group page says "this household" or "this business".
- **Loading:** a skeleton shaped like the rows.
- **Error:** the card fails alone, behind its own boundary.
- **Language:** every string is in English and Spanish, survives the pseudo-locale's +35%, and passes the ratchet.
- **Design:** tokens only, dark and light, the blur fallback, and a `/styleguide` entry for the card and its rows.

## 5. Server behaviour

### 5.1 Actions
Every action returns `{ ok: true, … } | { ok: false, message }`, with bilingual messages in the reader's language; nothing throws out of an action.
- **`startDocumentUpload`**
  1. checks access to the record (an RLS read) and the role, for Owners only
  2. checks the declared size (≤ 25 MiB) and the extension/declared type against the allowlist
  3. creates the document row with no current version (or uses the existing document, for a new version)
  4. calls `reserve_document_version`
  5. returns `createSignedUploadUrl` for the version's path
- **`finishDocumentUpload`**
  1. checks the object exists
  2. reads its real size and its first bytes (§5.2) and computes its sha256
  3. if any check fails, deletes the object, deletes the version row, and deletes a document that never had a ready version, then returns the reason
  4. otherwise marks the version `ready`, moves `current_version_id`, and emits `document.added` (only for a document's first version)
- **Edit, trash, restore and purge actions** follow §3.4's rules. Purge removes every version's object, then the rows, then emits.
- **`getDocumentUrl(versionId)`** reads the version through `userDb` (RLS decides) and only then mints a 120-second signed URL with the service role. Word and Excel are always minted with `download` (attachment).

### 5.2 Content check
The finish step reads the leading bytes:
- PDF: `%PDF-`
- JPEG: `FF D8 FF`
- PNG: `89 50 4E 47`
- WebP: `RIFF....WEBP`
- DOCX and XLSX: the ZIP signature `PK\x03\x04` plus the `[Content_Types].xml` part naming word or xl

Anything else, or a mismatch with the declared type, is refused and deleted: an `.exe` renamed to `.pdf` never stays. SVG and HTML are never allowed. The pattern follows `lib/branding/validate-logo.ts`.

### 5.3 EXIF stripping
- **Images (JPEG, PNG, WebP)** are decoded and redrawn on a canvas in the browser, with orientation applied, and re-encoded:
  - JPEG at quality 0.9; PNG stays PNG; WebP re-encodes as WebP
  - this drops GPS and camera metadata
  - an image over 4096 px on its long side is scaled down to 4096
- **PDFs and Office files** are stored as given.
- This is a browser-side step for staff uploads, and its limits are stated, not hidden: a modified client could skip it. Part 2's server-side scanning pipeline is where enforcement for customer uploads belongs.

### 5.4 The daily clean-up job
One new pass in the cron registry (`lib/automations/registry.ts`), named `documents-sweep`, running once a day:
- purges documents trashed more than 30 days ago, emitting `document.purged` as `system`
- deletes versions still `uploading` more than an hour after creation, with their objects if present, and any document left with no ready version
- deletes the object first and the row second. A failed object delete leaves the row for the next run, which logs it in `automation_log`.

It also follows the existing cron-coupling test rules.

### 5.5 Teardown and test hygiene
- `packages/db/src/account-teardown.ts` deletes every object under `{account_id}/` in `documents` before the rows go.
- The e2e sweep (`apps/web/e2e/fixtures/sweep.ts`) clears the fixture account's objects, as it does for `brand-logos`.

## 6. Testing

- **Database (bis-db-schema):**
  - RLS matrix: Owner, Staff, Technician (assigned and unassigned customer), agency, and another account, each with and without `owners_only`, on contact and group documents
  - `authenticated` has no write grants
  - the exactly-one-link CHECK
  - categories and `scan_status` CHECKs
  - `reserve_document_version`: refuses past 5 GiB; two concurrent reservations cannot both pass; executable only by `service_role`
  - the bucket row exists, is private, and has the 25 MiB limit and the six types
- **App:**
  - each action's refusals: no access, the wrong role for Owners only, oversize, a disallowed type, a type mismatch, quota full, a missing object at finish
  - `getDocumentUrl` refuses a version the reader cannot see
  - Undo's compare-and-set
  - the card's loaded, empty, error, expiry wording (each band) and Owners-only wording, in both languages
  - the content checker on real byte prefixes
  - the sweep pass's ordering and retry
  - every test is mutation-probed by its reviewer (memory: test vacuity)
- **End to end, on the per-run fixture account, never Test Client One:**
  - upload a PDF and a JPEG, view both, rename with Undo
  - mark Owners only
  - move to trash with Undo, trash again and restore
  - (PR 1b) Delete forever by typed name; upload a new version and see "Version 2"

## 7. Rollout and PRs

- **One migration (0077) and two PRs:**
  - **1a:** 0077, upload (including camera), list, viewer, inline edits, Owners only, trash with Undo and Restore, and the daily job
  - **1b:** new versions and the Versions list, Delete forever with the typed name, teardown, and the space-used line
- **The migration:** bis-ci first (`ci-project-setup.yml`), then production through MCP `apply_migration` once, then a parity check (runbook `ci-supabase-project.md`). Never re-apply.
- **CSP:** if the app's content-security policy restricts `img-src`, `frame-src` or `connect-src`, the plan adds the Supabase storage origin for the viewer and the upload PUT. The plan reads `next.config.ts` and the middleware first.
- **The tracker:** item 6 becomes `in_progress` on the first merge. It is `done` only after parts 2 and 3.

## 8. Open items named, not decided here

- **Decision 2 (ClamAV and its host)** is needed before part 2 starts.
- **Retention classes and legal holds** (study §3.4) wait for part 3 or later. Part 1 keeps every file until a person trashes it.
- **Sensitivity (`health`, `phi`)** is not in part 1. No AI path reads documents; rule 14 holds trivially, and the column arrives with document intake (S-19).
