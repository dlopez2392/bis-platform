# Design Phase 4 — Tables + Record Drawers

**Date:** 2026-09-02 · **Status:** approved by danlo (brainstorm 2026-09-02)
**Roadmap:** P4 of `docs/superpowers/plans/2026-08-31-design-migration-roadmap.md`
**Governing contract:** `DESIGN.md` (rules 1–10; the record-views and tables key patterns)

## Goal

Put the contacts and calls lists on the full DESIGN.md table pattern and ship
the contact drawer as the record-drawer exemplar. Exit (from the roadmap):
contacts + calls lists on the pattern; one drawer (contact detail) shipped.

## Decisions (danlo, locked — do not re-litigate)

1. **Drawer scope: summary + jump link.** Fields (name/phone/email/company,
   tags) with inline editing, a compact recent-activity strip, and an
   "Open full page" link. The rich 3-column contact page stays untouched as
   the deep-link destination for heavy work.
2. **Bulk actions on contacts: Add tag + Delete.** Add tag is reversible →
   runs immediately with an undo toast. Delete is destructive → confirmed by
   typing the selection count (rule 6). Both are new server actions.
3. **Inline edit is one shared component on both surfaces.** `InlineField`
   powers the drawer AND the full contact page's fields panel (retrofit) —
   click value → edit → save on blur/Enter + undo toast, Esc cancels.
4. **Architecture: approach A** — client-state drawer + GET route handler
   (chosen over Next intercepting routes and over fattening the list query).
5. **Calls list gets NO checkboxes** — no bulk operations exist for calls;
   rule 4 forbids checkboxes without bulk actions. Call rows navigate to the
   existing call detail page (the roadmap ships exactly one drawer, contact).

## Architecture

### Drawer wiring

- Row click sets client state; the drawer (shadcn `Sheet`, right side,
  ~420px) opens immediately. Name/phone/email/company paint instantly from
  the row the table already holds; tags + recent activity load after.
- **Reads ride GET**: new route handler
  `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.ts`.
  Rationale (hard lesson from P2/P3): Next serializes same-client server
  actions, so a drawer read implemented as an action would queue user
  mutations behind background reads. GET requests cannot.
- Auth inside the handler: `requireAccountAccess(accountId)` + RLS-scoped
  `dbForRequest()` — contacts are a both-audiences surface and RLS already
  grants client sessions their own tenant's rows. The handler must never use
  `serviceDb()`.
- **URL:** shallow `history.pushState` writes `?peek=<contactId>` on open;
  `popstate` closes (Back = close), refresh with `?peek=` reopens the drawer
  after hydration. Esc / ✕ / outside-click also close (each pops the state
  it pushed). No RSC re-render on open/close.
- While loading: skeleton shaped like the drawer content (rule 7). On fetch
  failure: designed error state with retry + the full-page link — never a
  blank panel.

### Summary payload (the GET response)

```ts
{
  tags: { id: string; name: string }[],
  recent: {                       // newest-first, capped at 5 after merge
    kind: "call" | "note" | "submission" | "message" | "opportunity",
    label: string,                // pre-localized display line
    at: string,                   // ISO; rendered in the ACCOUNT zone
  }[]
}
```

Sources are the per-contact db functions that already exist (calls, notes,
submissions, messages, opportunities); the handler fetches small per-source
limits, merges by epoch ms (NOT lexicographic ISO — the +00:00 vs .000Z
trap), caps at 5. Timestamps render in the account timezone via the same
`safeZone` discipline as every other date surface.

### Writes (server actions — user-initiated, correct to serialize)

- `updateContactFieldAction(accountId, contactId, field, value)` — inline
  saves. Allowed fields: `first_name`, `last_name`, `email`, `phone`,
  `company_name` (allowlist enforced server-side; empty string → NULL).
  Undo = the same action re-run with the prior value.
- `bulkAddTagAction(accountId, contactIds, tagName)` — single insert with
  `on conflict do nothing` semantics; undo removes that tag from the same
  ids. Toast reports the honest applied count.
- `bulkDeleteContactsAction(accountId, contactIds)` — **skip-blocked
  semantics** (amended after schema verification): `opportunities.contact_id`
  and `conversations.contact_id` are NO ACTION FKs and `bookings.contact_id`
  is `on delete restrict` BY DESIGN (migration 0017), so a naive
  `delete … where id in (…)` would abort the whole batch on one linked
  contact. The action pre-reads which selected ids have opportunities,
  conversations, or bookings, deletes only the unblocked ones in one
  statement, and reports honestly: "Deleted N · skipped M (linked to
  bookings, deals, or conversations)". No undo (rule 6 destructive path;
  typed-count confirm gates it). Never weaken an FK to make delete easier.
- All action results surface through the existing `notifyActionResult`
  pattern so stale-tab rejections stay loud (the silent-save lesson).
- Existing single tag add/remove actions are reused in the drawer.

## Components

### Row pattern (shared by both tables)

- Whole row is the click target: `tabIndex=0`, visible `:focus-visible`
  ring, Enter/Space opens, hover shifts the row to `--surface-2`, ↑/↓ moves
  focus between rows (rule 4 + DoD keyboard line).
- Interactive elements inside a row (checkbox; the caller's contact link in
  calls) `stopPropagation` so they don't also trigger the row.
- Contacts row-open = drawer. Calls row-open = navigate to call detail; the
  existing chevron affordance stays. The calls table's current two-link
  markup collapses into the one row target (plus the inner contact link).

### New components

- **`ContactDrawer`** — header (avatar + name, open-full-page icon, ✕);
  fields block (`InlineField` per field); tags row (existing add/remove
  actions); RECENT strip; skeleton + error states.
- **`InlineField`** — display text → click → type-appropriate input; save on
  blur or Enter; **Esc cancels** (no save, no toast); success → undo toast;
  failure → revert displayed value + error toast. Light email/phone
  validation client-side; server action revalidates. Empty allowed (columns
  are nullable). Consumed by the drawer and the retrofitted
  `contact-fields-panel.tsx`.
- **`BulkActionBar`** — renders above the table when ≥1 row selected:
  "N selected", **Add tag** (dropdown of the account's existing tags +
  type-to-create), **Delete…** (dialog; confirm by typing the count, e.g.
  "3"), ✕ clears selection. Header checkbox selects the visible page;
  indeterminate when partially selected. Selection clears after a bulk
  action completes.
- **Empty states** (rule 5) for both lists: one sentence of what appears
  here + the action that causes it (contacts: add-contact / forms; calls:
  what produces call rows). Copy passes the 7 AM read.

### Touched surfaces

- `contacts/contacts-table.tsx` — row pattern, bulk bar, drawer mount.
- `calls/calls-table.tsx` — row pattern (markup consolidation only; server
  component stays a server component, row interactivity moves into a small
  client row wrapper).
- `contacts/[contactId]/contact-fields-panel.tsx` — retrofit onto
  `InlineField`; custom fields + tags keep their existing actions.
- The contact full page is otherwise untouched.

## Error handling

- Summary GET non-200 → drawer error state (retry + full-page link).
- Drawer open on a contact that was bulk-deleted (or stale `?peek=`) → the
  same error state; never ghost data.
- Inline save failure → displayed value reverts, error toast.
- Bulk tag is a single statement; bulk delete is a pre-read plus one
  statement over the unblocked ids (see the FK amendment above). Either way
  the toast reports the count actually affected — never a claimed count.
- A row navigation and a checkbox tick must never fire from one click
  (stopPropagation is asserted in tests).

## Testing

- **Unit:** `InlineField` (blur saves, Enter saves, Esc cancels, undo
  restores prior value, failure reverts); bulk-bar selection logic
  (page-select, indeterminate, clear-after-action); summary route (auth
  rejection, payload shape, epoch-ms merge ordering, zone pinning with the
  TWO-zone opposite-assert discipline on one instant); action allowlist
  (rejects a non-allowed field name).
- **e2e (fixture account):** drawer opens from row click, Esc closes, Back
  closes; refresh with `?peek=` reopens; inline edit mutation-checked by
  reload; bulk tag + undo round-trip; bulk delete with typed-count confirm;
  keyboard row nav (focus ring visible, Enter opens); **client-session
  drawer read** (RLS/grants proof — serviceDb fixtures are blind to grants,
  only e2e sees them); calls row navigates.
- **Screenshot pass** both themes before merge, per the phase ritual (P1–P3
  precedent), including drawer open, bulk bar visible, and both empty
  states.

## Out of scope (explicitly)

- Calls drawer, opportunities/pipeline table retrofit, conversations list —
  later phases.
- Command palette registration (P6), `/styleguide` page (P6).
- Contact merge/dedupe, CSV export, saved filters — not planned.
- Single-contact delete on the full page — bulk delete covers cleanup;
  revisit on demand.

## Definition of done

DESIGN.md's DoD checklist applies (tokens only, dark+light, loaded/empty/
error states, keyboard, 7 AM copy). Gates before merge: `pnpm check`,
`pnpm --filter web build`, `pnpm --filter web test:e2e`, review gate, danlo
screenshot gate.
