# Design Phase 6 — Command Palette + /styleguide

**Date:** 2026-09-02 · **Status:** approved by danlo (brainstorm 2026-09-02)
**Roadmap:** P6 of `docs/superpowers/plans/2026-08-31-design-migration-roadmap.md`
**Governing contract:** `DESIGN.md` — the Command-palette key pattern, rules 3/5/6/7/8, and the DoD's `/styleguide` line.

## Goal

Ship ⌘K over the whole operator surface — records, destinations and safe
actions — and the `/styleguide` page the definition-of-done already
references. Exit: settings sections are registered in the palette index (the
contract's own wording) and the styleguide renders every component in the
live theme.

## Decisions (danlo, locked — do not re-litigate)

1. **Full palette, including live record search** across contacts, calls and
   conversations — not navigation-only.
2. **`/styleguide` is an agency-only route reachable in production**
   (`/dashboard/styleguide`), not dev-only. Reason: tenant-branding surprises
   only show up against real production theming.
3. **Search is scoped to the CURRENT account.** Controller's call, recorded
   for danlo to override: every other surface scopes this way and the client
   switcher already handles jumping between companies. Cross-account agency
   search would need a second scope path and its own tenancy story — see Out
   of scope.
4. **Both audiences get the palette.** A client searching their own contacts
   is the same feature; the static registry is role-filtered so a client
   never sees an agency-only destination.

## Architecture

### Two result classes, two mechanisms

**Static (instant, no network).** A pure registry module
`apps/web/src/lib/palette/registry.ts` lists every destination (pages +
settings sections) and every safe action, each with a label, a group, a
role requirement, and an href or action id. It is BUILT FROM the same
vocabulary `lib/nav-groups.ts` uses, so a nav destination cannot exist
without a palette entry — that is what satisfies DESIGN.md's "settings
sections must be registered in the palette index". Filtering is
client-side via `cmdk`'s own matching.

**Live (debounced, server).** New GET route handler
`apps/web/src/app/api/accounts/[accountId]/search/route.ts`:

- **GET, not a server action.** Same reasoning as P4's summary route: Next
  serializes same-client server actions, so a per-keystroke read implemented
  as an action would queue the user's own mutations behind it.
- `apiAccountAccess(accountId)` (added in P4) → 404 for both no-access and
  unknown account; never confirm existence.
- RLS-scoped `dbForRequest()` — **never `serviceDb()`**. A client session
  must see exactly its own rows, and only e2e can prove that (unit mocks are
  blind to column grants — this repo has shipped three defects behind that
  blindness).
- Debounce ~200ms client-side; abort the in-flight request on each new
  keystroke (`AbortController`), and ignore a response whose query no longer
  matches the current input — the P4 drawer's stale-response lesson.
- Cap per source (5 each) so one noisy source cannot crowd the others.
- Reuses existing db functions where they exist (`listContacts` already
  takes `{ search, limit }`); any new read is added to `packages/db` beside
  its siblings, not written inline in the route.

### Palette shell

`cmdk` and the full `Command*` primitive set (including the currently unused
`CommandDialog`) are already installed — use them; do not add a dependency.
The palette mounts once in the dashboard shell, opens on ⌘K **and Ctrl+K**,
closes on Esc, and must not hijack the shortcut while focus is in a text
input where the browser/OS already owns it.

### States (rules 5 and 7)

The palette carries its own loaded / empty / error states:
- in-flight → a skeleton row shaped like a result, never a spinner;
- genuinely no matches → "No matches" naming what was searched;
- fetch failed → an honest error row with a retry, **never silence** (silence
  reads as "nothing found", which is a lie about a failure).
Static results always render even while the live query is in flight, so the
palette is never empty for a keystroke.

### Safety

Palette actions are **navigation and safe creates only** — no destructive
action is ever reachable from a fuzzy match one keystroke from Enter. Rule 6
still governs destructive actions on their own surfaces.

## /styleguide

`/dashboard/styleguide`, gated by `requireAgencyOnly...` (agency-only, like
the wizard). Renders every component and variant against the CURRENT theme:
buttons, badges/chips, tables and row states, empty states, toasts, the
drawer, inline fields, the rail's five states, form controls. Each entry
names the component and its file path so the page is a working index, not a
poster.

## Error handling

- Search route failure → the palette's error row; the static half keeps
  working, so the palette is never wholly dead.
- A stale/aborted response is discarded, never rendered.
- The registry is pure and cannot fail; a role-filtered empty group is simply
  not rendered.

## Testing

**Unit (pure logic — apps/web vitest has no DOM):**
- registry: every nav destination has an entry; role filtering hides
  agency-only destinations from a client; no duplicate ids; every entry has a
  label and a target.
- the search route: auth rejection → 404, unknown account → 404, payload
  shape, per-source caps, and that a query matching nothing returns empty
  rather than erroring.

**e2e (fixture account):**
- ⌘K opens, Esc closes; ArrowDown/Enter navigate to a static destination.
- typing a seeded contact's name returns it under CONTACTS and Enter opens
  that contact.
- **a client session's search returns only its own rows** — the RLS/grants
  proof no unit test can give.
- `/styleguide` renders for the agency; a client is redirected away.

**Screenshot pass** both themes before merge: palette open with mixed static
+ live results, its empty state, its error state, and the styleguide.

## Out of scope (explicitly)

- **Cross-account (agency-wide) search** — decision 3 above; would need a
  second scope path and its own tenancy proof.
- Recent/frecency ranking, fuzzy-match tuning, per-user palette history.
- Destructive actions in the palette (deliberate, see Safety).
- Registering the palette in a keyboard-shortcuts help surface.

## Definition of done

DESIGN.md's DoD applies (tokens only, dark + light, loaded/empty/error
states, keyboard: full arrow/Enter/Esc operation with a visible focus ring,
7 AM copy), plus its own line: `/styleguide` updated for any new
component/variant. Gates before merge: `pnpm check`, `pnpm --filter web
build`, full `pnpm --filter web test:e2e`, review gate, danlo screenshot gate.
