# The document vault, part 3: the Documents page, expiry To-dos, the Owner checklist card, share links (S-07 + F-005, first release item 6)

**Status:** owner-approved in brainstorming on 2026-10-17. The written spec is waiting for the owner's review.
**Source:** part 1 spec `2026-10-13-document-vault-design.md` §1 (part 3 row); part 2 spec `2026-10-15-document-vault-part2-design.md` (:17 "Not in part 2", §5.2 amendment D6); `docs/crm-features.md` surface 3 (:2618-2648); study `docs/research/2026-09-25-crm-feature-research.md` §3.4 (share link that expires in 24 hours, view tracking, account-wide Documents view, "expiring in 30 days" reminders, "every public link follows one rule"); DESIGN.md (module contract, rules 4–8, paged lists).

## 1. Scope

Part 3 is one spec built as two PRs (decided 2026-10-17):

| PR | Contents | Migration |
|---|---|---|
| **3a** | The account-wide **Documents page** (new sidebar entry, DESIGN.md amended), **expiry To-dos** from a daily pass, and the **Required documents card** for client Owners (closes P7 for them) | 0084 |
| **3b** | **Share links**: a 24-hour, revocable, view-tracked link to one version of one file | 0085 |

3b starts after 3a merges. Each PR has its own plan and the usual lane pipeline.

**Not in part 3:**
- No automatic message to a customer about an expiring file. Staff press **Pedir al cliente** themselves (decision E1).
- No configurable reminder window. It is fixed at 30 days.
- The share-link lifetime is not configurable (fixed at 24 hours), and there are no multi-file or zip shares.
- No retention classes, legal holds or destruction log.
- Documents on properties or deals are still not surfaced.
- No model ever reads a document.

## 2. Decisions (owner, 2026-10-17)

| # | Decision |
|---|---|
| E0 | Part 3 has two PRs: 3a covers the view, the To-dos and the Owner card, and 3b covers share links. One spec, two plans. |
| E1 | **Expiry reminders go to staff only.** Thirty days before `expires_on`, a daily pass opens one To-do on the record. Asking the customer for the renewal is one click away: **Pedir al cliente** opens with that category pre-filled (2b's upload link). No new outbound path, consent or quiet-hours work. |
| E2 | **The Documents page is a sidebar entry under CRM, right after Contacts.** This PR amends DESIGN.md's module contract and sidebar pattern. |
| E3 | **Share links:** anyone who can see the file can make one. For an Owners-only file, only Owners and agency staff can. A link covers ONE version, expires in **24 hours**, can be revoked, and serves only a scan-clean, untrashed file. The **first open** writes a timeline row. It uses 2b's token pattern. |

## 3. PR 3a

### 3.1 The Documents page

- **Route:** `/dashboard/accounts/[accountId]/documents`. The nav entry is `nav.documents`, labelled "Documents" in English and "Documentos" in Spanish, with a new icon key `documents`. It is placed in the CRM group after Contacts in `nav-groups.ts`. Technicians get it too: their nav list gains it after Contacts, and their rows are limited by existing RLS to assigned customers.
- **⌘K:** the palette index gains "Documents" as a jump target.
- **Reads go through the request client (RLS), never the service client.** Visibility therefore follows part 1 V3 and F-085 unchanged: an Owners-only file appears only for Owners and agency staff, and a Technician sees only files on customers assigned to them. A file on a household/business follows that group's visibility. No new policy.
- **Rows:** every document with `deleted_at is null`, filed on a contact or a client group. Each row shows:
  - the title
  - the category label in the reader's language
  - **filed on**: the customer's or group's name, as a link to that record. The link is a separate focus target and does not open the viewer.
  - the expiry in words, with dot + word when ≤ 30 days or past (part 1 wording, reused)
  - the source line
  - the Owners only marker
  - the scan state, using the existing "Revisando" and removed wording
- **The whole row opens the existing viewer** (part 1). Rows have a visible focus ring and `--surface-3` hover. There are no checkboxes, because there are no bulk actions (rule 4).
- **Filters (server-side):**
  - **Expiring soon** (`expires_on` between today and today + 30, in the account's own zone). This is the default.
  - **Expired** (`expires_on` < today)
  - **All**
  - a **Category** select (the nine categories, plus "Any")

  The filter and category live in the URL (`?show=expiring|expired|all&category=`).
- **Sort:**
  - Expiring soon: `expires_on` ascending, then `id`.
  - Expired: `expires_on` descending (most recently expired first), then `id`.
  - All: `created_at` descending, then `id`.
- **Paging:** cursor paging, never offset. "Older"/"Newer" links carry `?before=` with a cursor over the sort key plus `id`. There is exactly one pager. The header states the real total for the current filter. The count must throw on `{count:null}` (see the head-count-null rule) and never show `count ?? 0`.
- **States:** a skeleton shaped like the rows, and an error state with retry that names the failure in plain words. The empty states are:
  - All: "Files you upload to a customer or household show up here. Open a customer and use Documents to add one."
  - Expiring soon: "Nothing expires in the next 30 days. Files with an expiry date show up here a month before."
  - Expired: "Nothing has expired."
- **No hero** (rule 11). This is a work list, not a headline metric.

### 3.2 Expiry To-dos

- **New pass `documentsExpiry`** goes in `lib/automations/registry.ts`, beside `documentsSweep` and `documentsScan`. It runs through the existing cron harness on every tick, as the sweep does, and is idempotent: a file that already has its To-do for that date is skipped, and the unique index is the last word. Its heartbeat key is `cron.pass.documentsExpiry`. **Amended 2026-10-17:** the sweep has no daily window (it runs every tick), so neither does this pass (plan PR 3a deviation 1).
- **A document qualifies when:**
  - it is not trashed
  - it is not Owners only (a To-do title would reveal the file to Staff)
  - `expires_on` is set
  - it is filed on a contact or a group
  - its current version is scan-clean
  - `expires_on` lies between today and today + 30 in **the account's own zone**

  Files already past expiry never open a To-do. This is the catch-up rule: the first run must not flood the queue with old expiries. The Documents page's Expired filter covers them.
- **Exactly one To-do per document and expiry date.** 0084 adds `tasks.document_expiry_id uuid` and `tasks.document_expiry_on date`. Both are null or both are set, enforced by a check constraint. A composite foreign key `(account_id, document_expiry_id)` references `documents (account_id, id)`. A unique partial index `tasks_document_expiry_once` covers `(document_expiry_id, document_expiry_on)`. The insert relies on 23505 to dedupe, as `ensureDocumentRequestTask` does. 0080's client-write trigger, which nulls the server-only columns, is extended to the two new columns, so only the service client can set them.
- **Re-arm:** a changed expiry date is a new key. Renewing a file (a new date) therefore gets its own To-do 30 days before the new date. The old To-do is left as it is: staff close it, and nothing closes it automatically.
- **The To-do:**
  - **Title:** in the account's language, e.g. "Ana García's insurance expires on Nov 16" / "El seguro de Ana García vence el 16 nov". It falls back to the file title when the category is `other`, and to a no-name form when the customer has no name.
  - **Placement:** it lands on the contact. A group file lands on the group's primary contact (`client_group_members.is_primary_contact`, 0075). With no primary contact, `contact_id` is null and the title names the group.
  - **Due date:** `due_at` is the expiry date at 09:00 in the account's zone, minus 7 days.
  - **Event:** `task.created` is emitted with `documentId`, actor `documents-expiry`, type `system`.
- **The To-do links to the record's Documents card** with the document in focus. On the card, **Pedir al cliente** accepts a pre-selected category, carried in the URL (`?ask=insurance`). This is a small change to the 2b dialog's initial state.
- **Owners only removes the To-do (amended 2026-10-17, owner ruling R1).** Switching a file to Owners only deletes its open expiry To-dos at once, on the server, in the same action, after the action's own visibility read: a To-do title names the file, and Staff read To-dos. A done To-do stays. Switching the file back off holds nothing, so the next pass run reopens the To-do for that file and date.
- **The trash removes the To-do (amended 2026-10-17, owner ruling R4).** Moving a file to the trash (each file trashed; there is no bulk trash) deletes its open expiry To-dos at once, on the server, in the same action, after the action's own visibility read. A done To-do stays. Undo or restore puts the file back; the next pass run reopens the To-do if the file is still in its window.
- **Failures** are logged by document id and account, never with the file title (`loggableError`). One document's failure never stops the pass. The pass has a per-run cap (200 To-dos), and a capped run logs that it was capped.

### 3.3 The Required documents card (Owner screen for the 2c checklist)

- **Placement:** at the top of the Documents page, visible to client Owners and agency staff only (`is_account_owner` or agency). It is a collapsed summary line, "Required for every customer: ID, Insurance (2)", that expands into the same nine-category picker as the agency Settings card.
- **Saving** uses 2c's existing save action, which already admits a client Owner (2c §5.2 amendment D6). No database change. The card has its own primary Save, its own toast and its own Undo (rule 8: the card is its own view).
- **Agency Settings keeps its card.** Both surfaces write the same account list.
- **Settings ⌘K entry:** the palette's "Required documents" target now opens this card for Owners.
- **The 2c PR note**, that P7 is not met for client Owners, is closed by this PR. The part 2 spec gets an amendment line saying so.

### 3.4 Migration 0084 (`document_expiry_tasks`)

- The two `tasks` columns, the check, the composite foreign key, the unique partial index, and the client-write trigger extension (3.2).
- Three `documents` indexes (amended 2026-10-17; plan PR 3a deviation 4):
  - `(account_id, expires_on, id) where deleted_at is null and expires_on is not null` serves the page's expiring and expired filters;
  - `(expires_on) where deleted_at is null and expires_on is not null` serves the pass, which reads across every account (a leading `account_id` cannot serve that on Postgres 17);
  - `(account_id, created_at desc, id desc) where deleted_at is null` serves the All filter (0077 has no `created_at` index on `documents`).
- The rollback note lives in the file's header.
- Grants and RLS: no new table, so the existing `tasks` policies apply. **Amended 2026-10-17:** the grants guard test does not change (`tasks` already holds table-wide client grants); the control is the extended client-write trigger.

## 4. PR 3b: share links

### 4.1 Creating and revoking

- **Copy share link** goes in the document row menu (record card and Documents page) and in the viewer header.
  - Allowed for anyone who can read the document (an RLS read through the request client first), and only Owners and agency staff when the file is Owners only.
  - Refused for trashed files and for versions that are not scan-clean, with plain copy: "This file is still being checked" or "This file was removed".
- **What the server action does:**
  - mints a random token
  - stores `sha256(token)`
  - returns `${APP_ORIGIN}/s/${token}`, which the browser copies
  - shows a toast: "Link copied. It works for 24 hours."
- **The record's Documents card** shows "Shared · expires in 18 h" on the file while a live link exists, with **Stop sharing** (revoke). Revoking takes effect at once, with an Undo toast that un-revokes while the link has not expired (compare-and-set on `revoked_at`).
- **Timeline:** "Ana shared Seguro 2026.pdf" (person mark). Revoking is not a timeline row.

### 4.2 The public page `/s/[token]`

- **Clerk is bypassed**, as at `/d/[token]` and `/u/[token]`. Every query uses the service client with an explicit `account_id`, document and version filter derived from the token row (the study's "every public link follows one rule").
- **Page content:**
  - the business's logo and name, with brand colour from the theming engine (rule 9)
  - the file title and its type and size
  - one **Download** button, which calls `POST /api/s/[token]/download`. That route re-proves the token, then mints a 120 s signed URL for **the shared version** (not the current one).
  - no other customer data
  - "Powered by BIS" footer
- **Refusal pages:** expired, revoked, trashed and infected-or-removed each get their own plain page that names the business and its phone number. The response never says whether a token exists.
- **The page sends:**
  - `Cache-Control: no-store`
  - `Referrer-Policy: no-referrer`
  - `X-Robots-Tag: noindex`
- **Rate limiting** reuses the forms and upload-link limiter keyed on IP + token hash. The plan names the existing limiter.

### 4.3 View tracking

- **On the first successful Download**, not the page load (so link previewers do not count as opens), the route sets `first_opened_at` with a compare-and-set (`where first_opened_at is null`).
- When that write wins, it adds a timeline row: "Opened by the link's recipient" / "Lo abrió quien recibió el enlace". The author mark is "the customer" kind, worded as the recipient, because the person holding the link is not known to be the customer. The plan checks this mark against the closed author set and raises it to the owner if it does not fit.
- Later downloads only increment `open_count`.

### 4.4 Migration 0085 (`document_shares`)

`document_shares` has these columns:
- `id`
- `account_id`
- `document_id`
- `version_id` (composite FKs on account)
- `token_hash` (unique)
- `created_by`
- `created_at`
- `expires_at` (created + 24 h, enforced by a check)
- `revoked_at` and `revoked_by` (coherent pair)
- `first_opened_at`
- `open_count int not null default 0`

Access rules:
- **RLS:** members who can read the document can read its shares (an `exists` on documents under the reader's own RLS).
- **Writes are server-only:** the service client, after the action's RLS read. Clients get no insert, update or delete grants.
- **Teardown:** the account teardown and the fixture sweep both list the table.

## 5. Copy and language

- Every new string goes into the typed catalogue in English and Spanish (usted).
- The public page follows the account's language, then English. Expiry To-do titles use the account's language. The Documents page uses the reader's locale.
- Everything is checked with the pseudo-locale (+35%) at 360 px, and the page sets `lang` correctly (DESIGN.md DoD).

## 6. Testing

- **`@bis/db` / replica tests**
  - 0084:
    - only the service client can set the new task columns
    - the unique index dedupes
    - the composite FK refuses a cross-account document
  - 0085:
    - RLS: Staff cannot read an Owners-only file's shares, and a Technician reads only shares of assigned customers' files
    - there are no client write grants
- **Pass tests** (`documents-expiry.test.ts`):
  - the window edges at day 30 and day 0 in two zones, including the account zone crossing midnight UTC
  - already-expired files never open a To-do
  - Owners-only, trashed and not-clean files are skipped
  - dedupe on re-run
  - a new expiry date re-arms
  - a group file routes to the primary contact, and to null with no primary
  - the cap
  - one document's error does not stop the pass
- **Token isolation (3b):**
  - a token never reaches another account's, document's or version's rows
  - expired, revoked and trashed tokens refuse both the page and the download
  - a share made before a new version still serves its own version
  - the first-open compare-and-set writes exactly one timeline row under concurrent downloads
- **Page reads:**
  - the filters' SQL bounds in the account zone
  - the cursor round-trips
  - the total throws on a null count
- **e2e (per-run fixture account only):**
  - Documents page filters and paging
  - the Owner card saves and Undo restores
  - an expiry To-do appears after a forced pass run
  - **Pedir al cliente** opens pre-filled
  - share: copy, open in a fresh context, download, timeline row, Stop sharing, then the revoked page
- **Mutation probes:** each reviewer runs the probes named in the plan and does not trust the plan's claim that they fail (see the test-vacuity rule).

## 7. Rollout

- **3a:** 0084 goes to bis-ci, then production, then a parity check. Deploy order: the migration before the code (the pass and the trigger extension need the columns).
- **3b:** 0085 follows the same order, and the e2e share spec runs on CI.
- **Tracker:** item 6 / F-005 → `done` after 3b.
- **Owed post-deploy:**
  - **3a:** a production smoke on an AGENCY-owned record. Set an expiry 20 days out, run the pass by hand (or wait for the next run), and check the To-do. Then open the Documents page as a client Owner to check the Required documents card.
  - **3b:** a production smoke that shares a clean file, opens it in a private window, and checks the timeline row, then revokes the link.
