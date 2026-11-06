# F-087 part 1 — One map of the product: a surface manifest every menu reads (design spec)

> Scope: `docs/crm-features.md:1430` ("F-087 | One map of the product: a
> surface manifest every menu reads | 2.5–3.5 | The manifest F-088, F-089
> and the palette read | none"); §6.3 Surfaces 4 and 8 (`:2670-2691`,
> `:2785-2811`); §6.4's enabler row (`:2830`, "A typed manifest that the
> sidebar, the box, Ajustes, the launch plan and the upgrade page all
> read; display only, never authorisation"); §6.5 amendment 7 (sidebar
> groups, `:2858`, still **Proposed**) and amendment 9 (the palette as the
> one box, `:2860`, still **Proposed**); §3629 ("Next", 2 FLAG / 5 risk /
> 1 reward). F-098 is folded into this feature (`:1750`, `:2162`, `:2811`,
> `:2871`, `:3640` — "audiences in the manifest"), not built separately.
> This spec is part 1 only: display infrastructure, no migration, no auth
> change, no visible redesign. No code in this change — the spec is the
> deliverable.

## 0. Summary for the owner

The sidebar and the ⌘K palette mostly already agree, because the palette's
"go" half is *derived* from the sidebar's own list (`buildNavGroups`), not
re-typed. But three real surfaces sit outside that derivation entirely, each
guarded by nothing: one page is reachable from no menu at all; two of the
palette's own anchors are checked by nothing, in either direction (one
already shipped the drift the Settings-page check exists to catch, just on
a page that check doesn't scan); and the Settings-page check itself only
runs one of the two directions a real completeness check needs. Part 1
replaces the sidebar's and palette's separately-maintained lists with one
typed manifest both read, and turns the one-directional Settings check into
a real, bidirectional one. It ships no new routes and (with one exception
flagged below, not silently fixed) no visible change — the menus should
look exactly as they do today, because they were already agreeing almost
everywhere.

## 1. What exists today (file:line), and where it disagrees

| # | List | File:line | Holds | Read by |
|---|---|---|---|---|
| 1 | `buildNavGroups` | `lib/nav-groups.ts:58-221` | The sidebar's scrolling nav: 4 in-account groups, the agency's flat top-level list, the Technician's 4-item subset — href, `labelKey`, icon key, gated by `isAgency`/`isOwner`/`isTechnician` | `app-sidebar.tsx:202` (renders it directly); `palette/registry.ts:151-164` (derives nav entries from it) |
| 2 | `SETTINGS_SECTIONS` | `palette/registry.ts:50-74` | 12 Settings-card anchors, hand-written, agency-only | `buildPaletteEntries` (`:277-288`), pushed as `group: "settings"` entries |
| 3 | `NAV_KEYWORDS` | `palette/registry.ts:78-117` | Extra search words per nav href suffix | `keywordsFor` (`:119-122`), folded into every derived nav entry |
| 4 | Registry's own extra pushes | `palette/registry.ts:169-276` | Preferences, Team (`nav:team`/`settings:team`), BIS access, Required documents, Settings, Setup — six destinations that are *not* in `buildNavGroups` at all | `buildPaletteEntries` only — nothing else lists these |
| 5 | The sidebar footer | `app-sidebar.tsx:216-229` | Settings link (agency), Team link (client Owner), the agency's own `/dashboard` fallback link — written a **third** time, independently of both #1 and #4 | Rendered directly; nothing checks it against #4 |
| 6 | `CHECKLIST_CATALOGUE` | `lib/checklist-catalogue.ts:14-68` | 11 onboarding rows (phone number, A2P, email domain, …) | Content *inside* the one Checklist surface (`nav.checklist`, already in #1) — not a second menu |
| 7 | `SetupStepKey` | `lib/setup/setup-status.ts:11-13` | 10 wizard-step keys | Content *inside* the one Setup surface — not a second menu |

Rows 6 and 7 are included to rule them **out**: they are a page's own
internal state machine, not a list of surfaces a menu renders, and are out
of scope below.

### 1.1 Why most of this already agrees

`buildPaletteEntries` derives its navigation entries from `buildNavGroups`
(`registry.ts:151`, "so a nav destination cannot exist without a palette
entry"), and `registry.test.ts:53` pins that parity in three roles. That is
exactly F-087's own idea, already half-built for the sidebar/palette pair —
which is why part 1 is a 2.5–3.5 ew *consolidation*, not new product.

### 1.2 Where it disagrees — three findings, not a paraphrase

**(a) A real page with no menu entry at all.** `app/(dashboard)/dashboard/page.tsx`
is the agency's own landing page — companies, contacts, open opportunities,
pipeline value, guarded by `requireAgency()` (`:16`). It is reachable by
exactly two hand-written links: the wordmark (`app-sidebar.tsx:298-304`) and
the footer's own fallback (`:219`). It is in neither `buildNavGroups(null, …)`
(`nav-groups.ts:61-96`, which lists Accounts/Blueprints/Work/Numbers/Screened/Plans
but not itself) nor, therefore, in the palette at all. Typing "dashboard"
into ⌘K at the agency top level finds nothing; the same word finds the
in-account Dashboard just fine. This is a finding from reading the code, not
something the brief or DESIGN.md names — see Q2.

**(b) Two palette anchors nothing checks, in either direction.** `nav:required-documents`
(`registry.ts:200-207`, href `${base}/documents#required-documents`) and
`nav:bis-access` (`:216-223`, href `${base}/team#bis-access`) both point at
real markup — `app/.../documents/required-documents-summary.tsx:58,67` and
`components/access-log/bis-access-frame.tsx:17` really do carry those ids,
each proven by its own file's own test. But the *link between the two* is
proven by nothing: the existing anchor-parity test (`registry.test.ts:296-323`)
only scans `.filter((e) => e.group === "settings")` (`:316`) — both of these
entries are `group: "navigation"` (they are not Settings-page cards), so
they never enter that scan. A typo in either href, or a renamed id on either
component, would be silent today.

**(c) The one check that exists runs one direction only.** `registry.test.ts:296`'s
own comment names the defect class precisely: "`id="branding"` (and every
other settings anchor) was unpinned — nothing proved the Settings page
actually has a Card wearing the anchor a `SETTINGS_SECTIONS` entry points
at" (D-080: three real cards had no registry entry, found by review, not by
a test). The fix that shipped reads the *registry's* anchors against the
*page's* markup. It does not read the *page's* markup for ids the registry
has no entry for — so a fourth card added tomorrow with no registry entry
would pass every test in the suite today, the same way the three D-080 cards
did.

## 2. Part 1 scope — one PR, about 3–5 days

### 2.1 The manifest

A new pure module, `apps/web/src/lib/surfaces/manifest.ts` (no React, no DB,
same discipline `nav-groups.ts`'s own doc comment states for why it is pure).
Proposed shape — the plan/task level may rename fields, not add a fifth
dimension of meaning without a reason:

```ts
export type SurfaceKind = "page" | "settings-section" | "action";
export type SurfaceScope = "agency-top" | "account" | "person";
export type SurfaceAudience = {
  agency: boolean;
  client: boolean | "owner"; // true = every client role; "owner" = client Owner only
  technician: boolean;       // a further narrowing, never a fourth audience value
};
export type SurfaceEntry = {
  id: string;                 // "nav:contacts", "settings:billing", "footer:settings"
  kind: SurfaceKind;
  scope: SurfaceScope;
  group: MessageKey | null;   // nav.group.* for the scrolling nav; null otherwise
  labelKey: MessageKey;       // existing m/t() key — no new strings for an existing surface
  route: (base: string | null) => string;
  audience: SurfaceAudience;
  anchor?: string;             // settings-section kind only — the real `id="…"` the page carries
};
export const SURFACE_MANIFEST: SurfaceEntry[] = [ /* … */ ];
```

Keywords (`NAV_KEYWORDS`, `SETTINGS_SECTIONS`'s own arrays) stay a
**palette-only**, id-keyed lookup, *not* a manifest field — see Q3.

### 2.2 Who reads it, and what must not change

- `buildNavGroups(base, isAgency, isOwner, isTechnician)` keeps its exact
  signature (every call site — `app-sidebar.tsx:202`, `registry.ts:151`, both
  test files — compiles unchanged) but its body becomes a filter-and-group
  over `SURFACE_MANIFEST` instead of inlined literals. `nav-groups.test.ts`'s
  existing exhaustive output assertions (e.g. `:172-192`'s full-href
  snapshots) are the regression guard: they must keep passing byte for byte
  against the refactored body — that is "red first" for the refactor itself
  (temporarily point one manifest entry at the wrong group and watch the
  named snapshot assertion fail).
- `buildPaletteEntries` drops `SETTINGS_SECTIONS` and its own six hand-pushed
  extra entries (§1 row 4); it iterates `SURFACE_MANIFEST` once, filters by
  the same three audience flags, and attaches keywords from the
  still-separate id-keyed lookup. Settings-section anchors and hrefs come
  from the SAME manifest entries the bidirectional test (§4) checks — so a
  drift between "what the palette points at" and "what the page carries" is
  now a single typo away from being *structurally* impossible for any entry
  this manifest lists, not merely tested for the eleven it lists today.
- `app-sidebar.tsx`'s footer (`:216-229`) reads its three links — the
  agency's Settings, the client Owner's Team, the agency top-level
  fallback — from the manifest's own `footer`-grouped entries (new `group`
  values, e.g. `null` with a `scope` of `"account"`/`"agency-top"`, or a
  dedicated marker — plan-level detail), closing finding (a) and the
  three-way duplication in row 5 of §1's table in the same stroke (see Q1).

### 2.3 The one real UI change this spec recommends (not silent)

Finding (a) — the agency's own `/dashboard` is literally unreachable from
⌘K today. Fixing it is a one-line manifest addition once the manifest
exists, and makes that page searchable for the first time. Per the
invariant below ("no visible UI change in part 1 unless you find a real
inconsistency — then list it as an owner question"), this is listed as Q2,
not applied without asking.

### 2.4 Explicitly deferred

- **F-088** (five surface states + one upgrade page): needs an
  entitlement/plan dimension this manifest does not carry. Reads the
  manifest *later*, to know which surfaces exist to grade — building that
  dimension now would be speculative; no plan/entitlement field ships in
  part 1.
- **F-089** (2027 sidebar: fixed spine, module slots, a budget of nine):
  blocked on amendment 7 (`crm-features.md:2858`), still **Proposed** —
  "Until decided, new modules go into today's sidebar groups" (`:2885`).
  Part 1 keeps today's OVERVIEW/CRM/COMMUNICATIONS/GROWTH grouping exactly;
  the manifest's `group` field is this plan's groups, not the future spine.
- **F-099** (one launch plan, two views): "later" per `:3641`; nothing in
  code reads a launch-plan surface today. The manifest ships so F-099 has
  something to read when it starts, not because it starts now.
- **F-098** ("View as owner", BIS-only marks): **no minimal slice fits in
  part 1.** F-098's dependency on F-087 is exactly "audiences in the
  manifest" (`:2871`) — the `audience` field *is* that dependency, fully
  met by §2.1's shape. The toggle control itself (where it lives, how a
  "viewing as" state persists per agency session, what a BIS-only mark
  looks like) is undecided interaction design, not a data-shape question,
  and the crm-features ledger never promises F-098 UI ships alongside
  F-087. See Q4.

## 3. Invariants

- **Display only, never authorisation** (the enabler row's own words,
  `:2830`). Every route keeps its own guard (`requireAgency`,
  `requireAgencyOnlyAccountAccess`, `requireAccountOwner`,
  `requireNotTechnician`, …) exactly as today; the manifest's `audience`
  field decides what a menu *offers*, never what a request *admits*. §4's
  test 5 checks this is not merely asserted but roughly true in practice.
- **No visible UI change in part 1**, except finding (a) above, which is
  raised as a question (Q2), not applied unasked.
- **EN/ES parity.** Every `labelKey` the manifest references already has
  an `.es` twin (it reuses existing `nav.*`/`palette.settings.*` keys,
  per `messages.test.ts`'s per-namespace twin checks, e.g. `:884`) — part 1
  adds no new message keys for any surface that exists today.
- **`nav-groups.ts`'s own exported shapes (`NavGroupSpec`, `NavItemSpec`)
  do not change** — the sidebar's render contract is untouched; only where
  the data backing it comes from moves.

## 4. Test strategy (named mutation probes)

1. **Reverse settings-anchor parity (new).** Scan every `id="…"` the
   Settings cardFiles list (`registry.test.ts:297-310`) actually carries,
   and assert each is a registered manifest anchor. Mutation: add
   `<Card id="new-thing">` to any listed card file with no manifest entry
   → FAILS (this is the exact D-080 shape, made impossible instead of
   review-dependent).
2. **Forward settings-anchor parity (kept, widened).** Every manifest
   `settings-section` anchor is a real id on a Settings card — today's
   `registry.test.ts:296` rewritten to read the manifest. Mutation: remove
   `id="branding"` from `branding-panel.tsx` → FAILS (same mutation the
   brief names; still catches it after the refactor).
3. **Navigation-anchor parity (new; closes finding (b)).** Widen the scan
   to every manifest entry whose `route()` carries a `#fragment`, regardless
   of `group`, checked against the *actual page* it names (Documents' own
   file for `required-documents`, Team's for `bis-access`), not only
   Settings' cardFiles. Mutation: rename `id="bis-access"` in
   `bis-access-frame.tsx` without updating the manifest's route → FAILS
   (today this mutation passes every existing test, including the e2e
   suite if nothing happens to click that exact link).
4. **Sidebar/palette regression (existing, must still pass unmodified).**
   `nav-groups.test.ts`'s exhaustive snapshots (e.g. `:172-192`,
   `:158-166`) and `registry.test.ts`'s role-parity test (`:53`) run
   against the refactored `buildNavGroups`/`buildPaletteEntries` with zero
   edits to their own assertions. Mutation: swap two items' order inside
   one manifest group → the exact snapshot at `nav-groups.test.ts:57-60`
   FAILS by name.
5. **Audience-matches-guard, spot-checked (new, lightweight).** For every
   manifest entry at `scope: "account"` marked agency-only, grep its
   route's `page.tsx` source (same `stripComments` helper already in
   `registry.test.ts:23-50`) for `requireAgency` or
   `requireAgencyOnlyAccountAccess`. Mutation: mark a manifest entry
   `agency: true` for a route whose `page.tsx` has neither call → FAILS,
   naming the route. (This cannot prove the guard is *correct*, only that
   the manifest is not asserting visibility a route-level grep finds no
   evidence for — a display-only sanity check, never the enforcement
   itself, per the invariant above.)
6. **Route-existence, bounded (new; see Q5).** Every manifest entry's
   static route segments (after substituting a fixed `base`) resolve to an
   existing folder under the dashboard route tree. Mutation: point one
   manifest entry at a renamed/deleted folder → FAILS, naming the path.
   Bounded to part 1's finite, known entry list — not a full route-tree
   walk in the other direction (a brand-new, never-registered route is a
   broken-link bug a human notices fast; the manifest-says-X-page-doesn't-
   exist direction is the one worth automating).
7. **`/dashboard`'s own entry findable (new, only if Q2 is "yes").**
   `filterEntries(buildPaletteEntries(null, true, false), "dashboard")`
   includes the agency top-level entry. Mutation: drop that one manifest
   row → FAILS.

Every probe above names the exact code change that makes it fail; none is
satisfied by a comment, a type-only change, or code that cannot regress
(working rule 2 and the vacuous-test catalogue).

## 5. Task list

| # | Task | Tier |
|---|---|---|
| 1 | `lib/surfaces/manifest.ts` — the typed shape and the full entry list for everything in §1's rows 1, 4 and 5 (sidebar nav + registry's extra pushes + the footer's three links) | medium |
| 2 | Refactor `buildNavGroups` to read the manifest; keep its signature and every existing snapshot green | medium |
| 3 | Refactor `buildPaletteEntries` to drop `SETTINGS_SECTIONS` and its own extra pushes, reading the manifest instead; keywords stay a separate id-keyed lookup | medium |
| 4 | Refactor `app-sidebar.tsx`'s footer to read its three links from the manifest | low |
| 5 | Reverse + navigation-anchor parity tests (probes 1 and 3) | medium |
| 6 | Route-existence test (probe 6) and the audience/guard spot-check (probe 5) | low |
| 7 | Resolve Q2; if "yes", add the one `/dashboard` entry and its test (probe 7) | low |
| 8 | `/styleguide` — no new component, so no entry required by the DoD; confirm and note so in the PR, rather than skip silently | low |

## 6. Open questions for the owner

1. **Fold the sidebar's footer (Settings / Team / agency top-level
   fallback) into the manifest now, or leave it hand-written a little
   longer?** Options: (a) fold it in now — it is three literals, and it is
   the one place today that duplicates a hardcoded destination a *second*
   independent time (row 5 of §1's table) with nothing checking the two
   agree; (b) defer to a later part, keeping part 1 smaller. **Recommend
   (a):** this is precisely the drift class F-087 exists to end, it is
   cheap, and leaving it out of "every menu" while claiming the title would
   undersell the PR.
2. **The agency's own `/dashboard` page has no nav or palette entry at
   all (finding (a)) — add one now, or note the gap and leave it?**
   Options: (a) add a manifest entry now — one line, no new route, makes a
   real page ⌘K-findable for the first time; (b) leave it, since nothing
   is broken, only unsearchable. **Recommend (a):** the fix is exactly the
   size of the problem, and shipping a "completeness" feature that knowingly
   leaves one surface incomplete is a strange way to open.
3. **Do `NAV_KEYWORDS`/`SETTINGS_SECTIONS`'s keyword arrays move into the
   manifest as an optional field, or stay a separate, palette-only lookup
   keyed by manifest id?** Options: (a) fold them in now, one shape for
   everything; (b) keep them separate. **Recommend (b):** keywords are a
   search-ranking concern the palette owns, not "what surfaces exist";
   F-095 part 1 (the palette's Spanish-keyword work) shipped the same day
   this spec was written, with its own careful tests — moving that data
   into a new shape now multiplies the surface a mistake could land on for
   no part-1 requirement.
4. **Does any minimal slice of F-098's "View as owner" UI belong in this
   PR, now that the manifest carries `audience`?** Options: (a) a small
   read-only stub now; (b) none — audience-field only. **Recommend (b):**
   F-098's own dependency on F-087 is named as exactly "audiences in the
   manifest" (`:2871`); its toggle, persistence and BIS-only marks are
   separate, undecided interaction design with no part-1 claim on them.
5. **Should the completeness test also check route-existence on disk
   (probe 6), or is that over-scoped for part 1?** Options: (a) include
   it, bounded to part 1's finite entry list; (b) skip it — a dead
   manifest link is a broken link a reviewer notices fast, unlike the
   silent anchor drift probes 1–3 exist for. **Recommend (a):** it is one
   small `fs.existsSync` loop over a fixed, short list, not a route-tree
   walk, and it closes the last easy direction of "the manifest says
   something that isn't true."

## 7. Owner rulings (2026-11-06, binding)

danlo accepted every recommendation:

- **Q1 → (a)** The sidebar footer's three links read from the manifest in part 1.
- **Q2 → (a)** Add the agency's own `/dashboard` entry now. It is part 1's one visible change: ⌘K finds it in EN and ES. Probe 7 is in scope.
- **Q3 → (b)** Keywords stay a separate, palette-only lookup keyed by manifest id.
- **Q4 → (b)** No F-098 UI. Only the `audience` field ships.
- **Q5 → (a)** The route-existence test (probe 6) is in scope, bounded to the manifest's entry list.
