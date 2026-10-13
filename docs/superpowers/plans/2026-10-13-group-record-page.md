# The household and business record page (S-03 part 2): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A household or a business customer gets one record page, `/dashboard/accounts/[accountId]/groups/[groupId]`, on part 1's kit: who is in it and who we call first, what they share (properties, open deals), and (2b) what is happening with any of them on one merged timeline whose every row names its member as well as its author. The page loads, empties and fails card by card, reads in English and Spanish, and lets a Technician see only their own customers.

**Architecture:** Two PRs. **2a** adds migration 0075 (`client_group_members.is_primary_contact`, at most one per group, written only through a service-role plpgsql function behind a server action that proved its target), the group queries in `@bis/db` (`listGroupMembers`, `countGroupMembers`, `listGroupPeople`, `setGroupPrimaryContact`, `listGroupPlaces`, `listOpenDealsFor`), a generic card registry with `GROUP_RECORD_CARDS`, the page with its header (Call, Text and Email to the call-first member), People, Details, Properties (today's `PlacesCard` with a group subject) and Deals. In 2a the page is reachable by URL only. **2b** changes no database: each of the seven timeline sources takes one id or a set, `listTimelinePage` merges a set, `groupActivityMembers`/`groupFacts`/`groupNextUp` read the ≤50 most relevant members, the kit's `TimelineItem` gains a member slot and `RecordHeader` a linked subtitle, and the two entry links (contact header, Groups card "Open") ship.

**Tech Stack:** Postgres (Supabase; plpgsql, RLS), supabase-js through `@bis/db`, Next.js 16 App Router (server page, client cards, server actions), React 19.2, Tailwind v4, vitest (`renderToStaticMarkup`, no DOM; `withRollback` on a local PG18 replica; `withTestAccount` on CI `verify`), Playwright (bis-e2e-qa writes, the orchestrator runs).

**Spec:** `docs/superpowers/specs/2026-10-13-group-record-page-design.md` (commit `0878e5d1`, OWNER-APPROVED 2026-10-13 including §16 rulings R1–R3). Base: `origin/main` at `d729b373` (#249, 0074). Every file:line below was read off this worktree at `0878e5d1`; anything not read is labelled **Assumption**.

`<WT>` = `/c/Users/danlo/bis-platform/.claude/worktrees/s03-group`. `…/accounts/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`. `…/contacts/` = `…/accounts/contacts/`. `…/groups/` = `…/accounts/groups/[groupId]/` (new).

## Global Constraints

- **Ownership (tag on every task; no task edits a file its owner does not own).**
  - **bis-db-schema:** `packages/db/supabase/migrations/0075_group_primary_contact.sql`, `packages/db/src/test/group-primary-contact-schema.test.ts`, the new describe in `packages/db/src/test/client-groups-rls.test.ts`. Writes the migration, never applies it.
  - **bis-crm:** `packages/db/src/{client-groups,places,opportunities,activities,forms,record,timeline-cursor}.ts` and their tests (`client-groups.test.ts`, new `group-members.test.ts`, `head-count-null.test.ts` (one added case), `timeline-sources.test.ts`, `record.test.ts`), `packages/db/src/index.ts` (own lines only), `apps/web/src/lib/record/*`, `apps/web/src/lib/contacts/places-load.ts`, `…/contacts/{groups-actions,places-actions}.ts` and their tests, `…/contacts/[contactId]/{page,loading,deals-card,next-up-card}.tsx` and their tests, everything under `…/groups/` (new), `apps/web/src/app/api/accounts/[accountId]/groups/**` (new), `…/accounts/in-account-service-reads.test.ts` (one line each), the `groupPage.*`, `record.group.*` and `contact.noName.es` copy.
  - **bis-frontend:** `apps/web/src/components/record/*`, `apps/web/src/app/(dashboard)/dashboard/styleguide/*`, the Properties card UI (`…/contacts/{places-card.tsx,place-dialog.tsx,equipment-dialog.tsx,places-card-handlers.ts}` and their tests, as S-02 part 3's plan gave them, `2026-10-11-places-and-equipment.md` Task 6), the Groups card UI (`…/contacts/groups-card.tsx` and its tests, S-02 part 1's Task 6), the `groups.open*` copy.
  - **bis-comms:** `packages/db/src/messaging.ts` (`listContactMessages`) and `packages/db/src/test/contact-messages.test.ts`.
  - **bis-booking:** `packages/db/src/booking.ts` (`countBookingsMadeFor`, `listContactUpcomingBookings`, `listContactBookings`) and `packages/db/src/test/booking.test.ts`, plus its one barrel line in `packages/db/src/index.ts` (the booking block).
  - **bis-voice:** `packages/db/src/voice.ts` (`listContactCalls`) and `packages/db/src/test/voice-timeline.test.ts`.
  - **bis-e2e-qa:** `apps/web/e2e/group-page.spec.ts` (new), `apps/web/e2e/i18n-overflow.spec.ts`.
  - **Orchestrator:** merges, rollout (bis-ci, production, parity), the gates, `DESIGN.md` (bis-platform or the orchestrator lands the sentence the plan gives), the ledger.
- **`apps/web/src/lib/messages.ts` is edited by exactly one task at a time, in this order: 2a: Task 4 only. 2b: Task 15 (bis-frontend, `groups.open`/`groups.openAria`) → Task 16 (bis-crm, the 2b `groupPage.*` keys).** Each task's messages.ts step is its LAST code step and starts only after the previous task in the chain has committed. New keys go just above `} as const;` (`messages.ts:3892` today), under the task's own namespace. A `.es` twin for an existing key goes on the line directly under its English key (`contact.noName` is at `:721`).
- **Migration 0075 order.** bis-ci first (`ci-project-setup.yml`: push-dry-run, which must list only `0075_group_primary_contact.sql`, then push), then production exactly once through MCP `apply_migration` (name `group_primary_contact`), then the parity digest (`docs/runbooks/ci-supabase-project.md`), all **before 2a merges** (the e2e job's `.github/scripts/ci-migrations-applied.sh` enforces the first). ASCII only, no backslash anywhere (the MCP has mangled escapes). **Never re-apply 0069–0074.** 2b has no migration.
- **No `@bis/db` vitest runs locally against bis-ci until 0075 is on bis-ci** (Task 10 step 3). The package's globalSetup sweep runs on every invocation. Prove `withRollback` tests on a **local PG18 replica**: `initdb -E UTF8 --locale=C --locale-provider=icu --icu-locale=en-US`, `alter database … set timezone to 'UTC'`, never 5432, one port per agent (below). Pure db tests run with the credentials blanked so the sweep skips: `NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= SUPABASE_DB_URL=postgresql://postgres@localhost:<port>/post`. `withTestAccount` (PostgREST) tests are written red-first, typechecked locally (`pnpm --filter @bis/db typecheck`), and proven red then green by **CI `verify`** after the orchestrator pushes. 2b's `withTestAccount` tests may also run locally by path once Task 10 has put 0075 on bis-ci, and only by path (memory: agent test scope).
- **Never run the three live web tests:** `src/app/f/[publicId]/actions.returning-lead.test.ts`, `src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/actions.test.ts`, `weekly-metrics.live.test.ts`. Run web tests BY FILE PATH (every folder this plan names was checked: none holds one of the three, except `…/accounts/` itself, so never pass that folder).
- **Replica ports:** Task 1 implementer **55510**, Task 1 reviewer **55511**, Task 9 (2a final review) **55512**, spares **55513–55519**. Scratch only under `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\17dbaa35-46d9-467d-9b8b-67a623e43604\scratchpad\s03-2-t<N>-impl\` (reviewer `-review\`), written in Git Bash as `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/17dbaa35-46d9-467d-9b8b-67a623e43604/scratchpad/s03-2-t<N>-impl`; `<SCRATCH>` below means that literal path. (If the executing session has its own scratchpad, the orchestrator substitutes it in each brief.)
- **plpgsql NULL guard.** Every boolean a function, CHECK or policy branches on is `coalesce(…, false)`.
- **A HEAD count throws on a null count** (repo rule since #245; `record.ts:20-27`). `countGroupMembers` and every count this plan adds throws `"<fn> failed: no count returned"`.
- **Every test can fail.** Each test names the mutation probe that makes it fail. Run the probe, see the test fail BY NAME, paste the failing assertion line into the report, revert. A `-t` filter that matches nothing passes silently: check the run count.
- **The `vi.mock("@bis/db")` factory check.** A task that adds a NEW named import from `@bis/db` to an existing module adds that name to every `vi.mock("@bis/db", …)` factory reaching the module: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module basename>"`.
- **DESIGN.md definition of done for every UI task (4–7, 15–18):** tokens only (dots `bg-[var(--accent|good|warn|crit|text-3)]`, rules `border-[var(--row-line)]`, radii `rounded-full`/`rounded-[var(--radius-ctl)]`), dark and light (`.dark`), the blur fallback (cards keep `glass`, never blurred), loaded/empty/error per card, visible `:focus-visible` ring (`outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50`), controls `min-h-11 md:min-h-8` on a phone, EN+ES, the pseudo-locale's +35% wraps and never clips, `lang` correct (typed text `lang=""`), rule 3 (dot + word), rule 6 (Undo toasts, no confirm dialogs), rule 7 (skeletons), rule 8 (Call the one primary in the header; one primary per card at most, People has none), rule 11 (no hero). New kit variants get `/styleguide` entries.
- **Copy:** usted, trades Spanish, the spec's §9 words verbatim. No `{{…}}`, no milestone codes (`INTERNAL_MILESTONE` in `messages.test.ts`), no vendor jargon. New `.tsx` files carry NO JSX literal copy (`lib/i18n/ratchet.test.ts`). A person's name and typed text show as typed. A name shown on this page is built with the page's locale (`memberName`, Task 4), never `contactDisplayName` (`lib/format.ts:119-124`, English `m[…]`).
- **Running tests.** Web: `pnpm --filter web exec vitest run <paths>`, `pnpm --filter web typecheck`, `pnpm --filter web exec eslint <touched files>`. DB: `pnpm --filter @bis/db typecheck`. Judge a db run by vitest's summary block (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` prints after the real results). When an exit code matters, write it to a file with nothing after the command. **Never run the gates** (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`): the orchestrator runs them, one at a time. **Corrected 2026-10-13 (final review):** a task that changes a shared reader's select or call shape runs EVERY test that references that function (`grep -rln "<fn>" apps/web/src packages/db/src`, the pure ones by path), not only the tests of the files in its diff: two pure db tests (`messaging-author-shape`, `tasks-call-id-read`) pinned the old shapes of `listContactMessages` and `listContactTasks` and went red unseen.
- **Commits:** `git add -- <new files>` then `git commit -m "<type>(<scope>): <what and why>" -- <every path>`. Never `-A` or `.`. **Never `git stash`.** If `.git/index.lock` exists, wait and retry; never delete it. Never push. Never touch `main`. Trailer lines on every commit: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`.
- **Never** apply a migration to bis-ci or production (Task 10 is the orchestrator's), mutate Test Client One, create or edit `.env*`, call a real provider.

## Where this plan departs from the spec's wording (the source decided)

1. **0075 also replaces `public.undo_set_business`** (spec §5 replaces only `app.restore_member`). Once `restore_member` honours a snapshot's `is_primary_contact`, `undoContactBusinessAction` (`…/contacts/actions.ts:201-221`, any reader, a Technician included) sends a browser snapshot through `undo_set_business` (`0069:325-347`) into `restore_member` (`:343`). A forged `is_primary_contact: true` there would let a Technician make their customer a business's call-first member (C2). The replacement passes `p_removed - 'is_primary_contact'`, so the Business-name Undo never sets the flag (an Owner who loses a call-first member that way sees the People prompt again). Pinned by a schema test.
2. **`app.restore_member` and `set_group_primary_contact` lock the group row `for no key update`, not `for update`** (spec §5 says `for update`). `for update` conflicts with the `for key share` every member INSERT takes on its group through `client_group_members_group_fkey` (`0069:70-71`), so it would queue every add to that group behind a choice; `for no key update` still serialises two choosers (it conflicts with itself) and two restores, which is what the partial index needs. 0069's own `app.lock_contact` uses the same mode (`0069:117`).
3. **`listGroupMembers` returns `primary` on every page, not only the first** (spec §6: "On the first page … a second one-row read"). The header's Call needs the call-first member on page 2 too. People pins it only when `?people=` is absent (C10 unchanged).
4. **The People cursor is `TimelineCursor` (`{ v: string; id: string }`, `timeline-cursor.ts:7`), not `RowCursor`.** `RowCursor` lives in `apps/web/src/lib/cursor.ts:32`, which `packages/db` cannot import; the web page parses `?people=` with the existing `parseTimelineCursor` (`cursor.ts:64-68`), whose instant-plus-uuid check is exactly a `(created_at, id)` key.
5. **2a's Deals set is `listGroupPeople` (the first 50 by joined order), and 2b swaps in `groupActivityMembers`' set** (C13 says both; this names the function). Names on deal rows come from that set, never from an `opportunities → contacts` embed (0050 had to fix ambiguous opportunity embeds, `0050_same_account_fks.sql:43`).
6. **`setGroupPrimaryContactAction` answers `groups.failed`, not `groups.refused`, when a whole-account reader names a membership that is not there** (spec §5's Undo row wants "That didn't save. Try again." for a `previous` that has since gone). A narrow reader is refused before any read (C2), and a membership of another group is `groups.refused`.
7. **The Properties card's group subject keeps the existing prop names.** `PlacesCard`, `PlacesCardView`, `PlaceDialog`, `EquipmentDialog` and `placeHandlers` keep their `contactId` parameter, widened to `PlaceSubjectArg = string | { kind: "group"; id: string }` (a bare string is a contact, as every caller passes today, so `contact-drawer.tsx:284`, the contact page and `styleguide/places-demo.tsx:58` are unchanged). `PlacesCard` gains `group?` for the route and the subject's name. Spec C12's `subject: { kind; id }` is that union's object arm.
8. **`groupActivityMembers` returns `GroupPerson = { contactId; firstName; lastName }`, not `{ contactId; name }`.** The name is built in the page's language in `apps/web` (`memberName`), so the db layer never holds the English "(no name)".
9. **`groupActivityMembers`' total is a `Fact<number>`.** A failed head count costs the people fact (named "Couldn't count the people in this group.", the spec's `groupPage.facts.what.people`) and the cap line, not the whole middle column. The scan itself failing is the three cards' error.
10. **RLS for the page's reads is proven in SQL under `actAs`, as 1b's deviation 9 did.** The db suite has no supabase-js Technician client, so `client-groups-rls.test.ts` runs each read's SQL shape (the member rows of one group, its count, its places, the flag) under a Technician's claims; `group-members.test.ts` proves paging and the primary pin on the service client.
11. **The e2e group and contacts are named `Familia García <stamp>` / `<First> García <stamp>`, never `E2E …`**, so `e2e/fixtures/fixture-names.test.ts` needs no new admission (groups.spec's precedent, `groups.spec.ts:19-24`); `afterAll` deletes them by id, each error checked.
12. **The cap line is its own node at the top of the middle column, not inside the Summary card** (spec §8.6 puts it "under the facts" but also "at the top of the middle column … governs … on every width"). Inside the card it would vanish when the summary fails while Next up and the timeline still show 50 people's activity.
13. **The 2a e2e reads "Properties and Deals are closed ABOVE People" at 390px.** §11.1 says "under People", but §7's phone order (and DESIGN.md's) puts what they have (4, 5) before who they are (6, 7).
14. **Each pager drops the other list's cursor.** "More people" keeps only `?locale=`; "Older" keeps only `?locale=` (`timeline-pager.ts:21`). Following one list's pager returns the other to its first page. The spec says only that the two never share a pager.
15. **The allowlist entry is `lib/record/group-loaders.ts`, not the page** (spec §10: the page "joins the allowlist as `proven-target`"). The ledger client is built inside `loadPrimaryText`, so the loader is the file that names `ledgerDb`; the scan fails on a stale entry (`in-account-service-reads.test.ts:147-150`), so the page cannot be listed while it names no getter.

## File Structure

**Created (2a)**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0075_group_primary_contact.sql` | bis-db-schema | the column, the partial unique index, `set_group_primary_contact`, `restore_member` and `undo_set_business` replaced, grants |
| `packages/db/src/test/group-primary-contact-schema.test.ts` | bis-db-schema | index, function, restore, Business-name Undo, sync not firing, grants (replica) |
| `packages/db/src/test/group-members.test.ts` | bis-crm | live: `listGroupMembers`, `listGroupPeople`, `listGroupPlaces`, `listOpenDealsFor`, `setGroupPrimaryContact` |
| `apps/web/src/lib/record/group-header.ts` (+ `.test.ts`) | bis-crm | `memberName`, `memberFirstName`, `groupHeaderActions`, `firstGroupMapUrl`, `peoplePagerHrefs` |
| `apps/web/src/lib/record/group-loaders.ts` (+ `.test.ts`) | bis-crm | `loadGroupPeople`, `loadGroupDeals`, `loadGroupHeaderPlaces`, `loadPrimaryText` |
| `apps/web/src/app/api/accounts/[accountId]/groups/[groupId]/places/route.ts` (+ `.test.ts`) | bis-crm | the group's Properties read |
| `…/groups/page.tsx` (+ `page.test.ts`) | bis-crm | the page: 404 before any read, the header, the cards |
| `…/groups/loading.tsx` (+ `loading.test.ts`) | bis-crm | skeleton of every group card in phone order |
| `…/groups/people-card.tsx` (+ `.test.ts`) | bis-crm | People: rows, call-first, role, pays, remove + Undo, prompt, pager, empty |
| `…/groups/people-handlers.ts` (+ `.test.ts`) | bis-crm | People's writes and toasts, in the reader's language |
| `…/groups/details-card.tsx` (+ `.test.ts`) | bis-crm | Details: name, type, billing address |
| `apps/web/e2e/group-page.spec.ts` | bis-e2e-qa | 2a by URL; 2b via the links |

**Created (2b)**

| Path | Owner | Responsibility |
|---|---|---|
| `apps/web/src/lib/record/group-facts.ts` (+ `.test.ts`) | bis-crm | `groupFactsView`, `groupCapLine` |
| `…/groups/group-timeline.tsx` (+ `.test.ts`) | bis-crm | the read-only merged timeline |

**Modified (2a):** `packages/db/src/{client-groups,places,opportunities,index}.ts`, `packages/db/src/test/{client-groups-rls,head-count-null}.test.ts`, `apps/web/src/lib/record/{record-cards,header-actions}.ts` (+ tests), `apps/web/src/lib/contacts/places-load.ts`, `apps/web/src/lib/messages.ts`, `…/contacts/{groups-actions,places-actions}.ts` (+ tests), `…/contacts/{places-card.tsx,place-dialog.tsx,equipment-dialog.tsx,places-card-handlers.ts}` (+ tests), `…/contacts/[contactId]/{page,loading,deals-card}.tsx`, `…/contacts/[contactId]/{page,loading}.test.ts`, `…/accounts/in-account-service-reads.test.ts`, `apps/web/e2e/i18n-overflow.spec.ts`.

**Modified (2b):** `packages/db/src/{timeline-cursor,activities,opportunities,forms,messaging,booking,voice,record,index}.ts` and `packages/db/src/test/{timeline-cursor,timeline-sources,contact-messages,booking,voice-timeline,record}.test.ts`, `apps/web/src/components/record/{timeline-item,record-header}.tsx` (+ tests), `…/styleguide/record-demo.tsx` (+ test), `…/contacts/groups-card.tsx` (+ test), `apps/web/src/lib/record/{timeline-rows,next-up,loaders,group-loaders,record-cards}.ts` (+ tests), `…/contacts/[contactId]/{page,next-up-card}.tsx` (+ tests), `…/groups/{page,loading}.tsx` (+ tests), `apps/web/src/lib/messages.ts`, `apps/web/e2e/{group-page,i18n-overflow}.spec.ts`, `DESIGN.md` (orchestrator).

## Task list, owners, order

| # | Task | PR | Owner | Review | Depends on | Group |
|---|---|---|---|---|---|---|
| 0 | Confirm the base; 0075 is free | 2a | orchestrator | n/a | — | — |
| 1 | Migration 0075, schema + grants tests, RLS cases | 2a | bis-db-schema | **opus** | 0 | A |
| 2 | `@bis/db`: group members, call-first write, group places, open deals, barrel | 2a | bis-crm | **opus** | 0 | A |
| 4 | Registry generic + `GROUP_RECORD_CARDS`; group header helpers; copy (**messages.ts, 2a's only**) | 2a | bis-crm | sonnet | 0 | A |
| 3 | Server: `setGroupPrimaryContactAction`, narrow Undo keeps the flag honest, places actions + route take a group | 2a | bis-crm | **opus** | 2 | B |
| 5 | Properties card UI with a group subject | 2a | bis-frontend | sonnet | 3, 4 | C |
| 6 | People and Details cards, their handlers | 2a | bis-crm | sonnet | 3, 4 | C |
| 7 | Group loaders, the page, loading, the 404 before any read | 2a | bis-crm | **opus** | 5, 6 | D |
| 8 | e2e `group-page.spec.ts` (by URL) + overflow | 2a | bis-e2e-qa | sonnet | 7 | E |
| 9 | Whole-branch review, PR 2a | 2a | reviewer | **opus** | 8 | — |
| 10 | Rollout 2a: measure, bis-ci, production, parity, merge | 2a | orchestrator | n/a | 9 | — |
| 11 | `forContacts` helper; notes, To-dos, deals, submissions take a set | 2b | bis-crm | sonnet | 10 | F |
| 12 | `listContactMessages` takes a set | 2b | bis-comms | sonnet | 11 (commit 1) | F |
| 13 | Bookings: `countBookingsMadeFor`, upcoming and timeline take a set | 2b | bis-booking | sonnet | 11 (commit 1) | F |
| 14 | `listContactCalls` takes a set | 2b | bis-voice | sonnet | 11 (commit 1) | F |
| 15 | Kit: `TimelineItem.subject`, `RecordHeader.subtitleHref`, styleguide; Groups card "Open" (**messages.ts 2b #1**) | 2b | bis-frontend | sonnet | 10 | F |
| 16 | `listTimelinePage`, `groupActivityMembers`, `groupFacts`, `groupNextUp`; web views and copy (**messages.ts 2b #2**) | 2b | bis-crm | **opus** | 11–15 | G |
| 17 | The page's middle column, Deals on the activity set, the contact header link | 2b | bis-crm | **opus** | 16 | H |
| 18 | e2e via the links + overflow fact line | 2b | bis-e2e-qa | sonnet | 17 | I |
| 19 | DESIGN.md sentence; ledger follow-up | 2b | orchestrator | n/a | 17 | — |
| 20 | Whole-branch review, PR 2b | 2b | reviewer | **opus** | 18, 19 | — |
| 21 | Rollout 2b: an ordinary merge | 2b | orchestrator | n/a | 20 | — |

**Lanes (2–3 at a time, disjoint files).**
- **2a Group A (three lanes):** Task 1 owns the migration and two db test files; Task 2 owns `client-groups.ts`, `places.ts`, `opportunities.ts`, `index.ts`, `group-members.test.ts`, `head-count-null.test.ts`; Task 4 owns `lib/record/{record-cards,header-actions,group-header}.ts`, the contact page's `page.tsx`/`loading.tsx` call sites and tests, and `messages.ts`. Task 2's `setGroupPrimaryContact` names Task 1's function; its live test is proven by CI `verify`, which applies 0075 from the branch, so the two run in parallel.
- **2a Group B:** Task 3 alone (it needs Task 2's exports).
- **2a Group C (two lanes):** Task 5 (bis-frontend: the four Properties UI files and their tests) and Task 6 (bis-crm: the new `…/groups/people-*` and `details-card*` files).
- **2a D, E:** Task 7, then Task 8.
- **2b Group F (up to three lanes at once):** Task 11 commits its `forContacts` helper FIRST (Step 1–3, its own commit), then Tasks 12, 13, 14 (three files in three domains) start; Task 15 (components, styleguide, groups-card, messages.ts #1) runs beside them from the start. `index.ts` is edited by Task 2 (2a), and in 2b by Task 13 (its one `countBookingsMadeFor` line at the booking block, `:88`) and Task 16 (pre-flight correction 2026-10-13); Task 13 and Task 16 never run at once.

---

## Task 0: Confirm the base (orchestrator)

- [ ] **Step 1.** In `<WT>` (branch `feat/s03-group-page`): `git fetch origin` then `git log --oneline origin/main -1` → `d729b373`. If `main` moved, `git merge origin/main` and re-run Step 2.
- [ ] **Step 2.** Confirm, and stop if any line differs:
  `ls packages/db/supabase/migrations | tail -2` → `0073_record_provenance.sql`, `0074_record_provenance_not_null.sql`.
  `git ls-tree --name-only origin/main packages/db/supabase/migrations/ | grep -c 0075` → `0`.
  `grep -n "is_primary_contact" -r packages apps/web/src | wc -l` → `0`.
  `grep -n "create function app.restore_member\|create function public.undo_set_business" packages/db/supabase/migrations/0069_client_groups.sql` → `169:` and `325:`; and `grep -ln "restore_member\|undo_set_business" packages/db/supabase/migrations/007*.sql` → nothing (no later migration replaced either).

---

## Task 1: Migration 0075 and its proof (bis-db-schema)

**Review:** opus. **Scratch:** `<SCRATCH>` = `…/scratchpad/s03-2-t1-impl`, replica port **55510** (reviewer `s03-2-t1-review`, **55511**).

**Files**
- Create: `packages/db/supabase/migrations/0075_group_primary_contact.sql`
- Create: `packages/db/src/test/group-primary-contact-schema.test.ts`
- Modify: `packages/db/src/test/client-groups-rls.test.ts` (one new `describe` after `:80`)

**Interfaces**
- Consumes (SQL, read off 0069): `public.client_groups (id, account_id, kind, name …)` (`:43-57`), `public.client_group_members (… is_primary, is_billing, created_at)` (`:59-75`), `app.restore_member(uuid, jsonb)` (`:169-191`), `public.undo_set_business(uuid, uuid, uuid, jsonb)` (`:325-347`), `public.remove_group_membership(uuid, uuid)` returning `to_jsonb(v_row)` (`:367-380`), `public.restore_group_membership(uuid, jsonb)` (`:382-390`), the sync trigger `client_group_members_sync_company_name … update of is_primary, client_group_id, contact_id` (`:223-225`), 0072's `contacts_company_name_derived` trigger.
- Produces (SQL), exact names later tasks rely on:
  - Column `public.client_group_members.is_primary_contact boolean not null default false`.
  - Index `client_group_members_one_primary_contact` on `(client_group_id) where is_primary_contact`.
  - `public.set_group_primary_contact(p_account_id uuid, p_group_id uuid, p_member_id uuid) returns jsonb` → `{"status":"ok","previous":<uuid|null>}` or `{"status":"not_found"}`. Executable by `service_role` only.
  - `app.restore_member(uuid, jsonb)` honours `is_primary_contact` when no other member of the group holds it.
  - `public.undo_set_business(uuid, uuid, uuid, jsonb)` never restores `is_primary_contact`.

- [ ] **Step 1: Build your replica** (without 0075). Write the env file:

```bash
mkdir -p "<SCRATCH>"
cat > "<SCRATCH>/env.sh" <<'EOF'
S="<SCRATCH>"
PGBIN="/c/Program Files/PostgreSQL/18/bin"
P() { "$PGBIN/psql" -h localhost -p 55510 -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
EOF
```

Then from `<WT>` in Git Bash:

```bash
source "<SCRATCH>/env.sh"
"$PGBIN/initdb" -U postgres -A trust -E UTF8 --locale=C --locale-provider=icu --icu-locale=en-US -D "$S/pgdata" > "$S/initdb.log" 2>&1
"$PGBIN/pg_ctl" -D "$S/pgdata" -o "-p 55510" -l "$S/pg.log" start </dev/null >/dev/null 2>&1
P -c "create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls; grant anon, authenticated, service_role to postgres;"
for d in pre post; do
  P -c "create database $d"
  P -d $d -c "alter database $d set timezone to 'UTC'"
  P -d $d -c "create schema if not exists app; create schema if not exists extensions;"
  sed -n '58,63p;72,73p' packages/db/supabase/bootstrap/ci-project.sql | P -d $d
  for f in packages/db/supabase/migrations/0*.sql; do
    case "$f" in *0075_*) continue;; esac
    P -d $d -1 -f "$f" || { echo "FAILED at $f on $d"; break; }
  done
done
```

Expected: no `FAILED at` line (`bootstrap/ci-project.sql:58-63` are the public default privileges, `:72-73` the app-schema function defaults, the 0043 trap this migration must undo). `pre` stays without 0075 (the red run); `post` gets it in Step 4.

- [ ] **Step 2: Write the failing schema test** `packages/db/src/test/group-primary-contact-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * Who we call first in a household or business (S-03 part 2, migration 0075; spec §5). As the table
 * owner inside a rolled-back transaction unless a case switches role. A refused statement runs in a
 * savepoint so the next one reports its own code. Seeds are local to this file on purpose.
 */
const RUN = Math.random().toString(36).slice(2, 10);

async function refused(c: Client, run: () => Promise<unknown>): Promise<unknown> {
  await c.query("savepoint probe");
  try { await run(); return null; } catch (e) { return e; } finally { await c.query("rollback to savepoint probe"); }
}
async function seedAccount(c: Client, org: string) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const { rows: [a] } = await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Call First Co',true) returning id",
    [agency!.id, org]);
  return a!.id;
}
const one = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
const contact = (c: Client, acct: string, first: string) =>
  one(c, "insert into contacts (account_id, first_name) values ($1,$2) returning id", [acct, first]);
const group = (c: Client, acct: string, kind: string, name: string) =>
  one(c, "insert into client_groups (account_id, kind, name) values ($1,$2,$3) returning id", [acct, kind, name]);
const member = (c: Client, acct: string, g: string, ct: string, extra: { primary?: boolean; callFirst?: boolean } = {}) =>
  one(c, `insert into client_group_members (account_id, client_group_id, contact_id, is_primary, is_primary_contact)
          values ($1,$2,$3,$4,$5) returning id`, [acct, g, ct, extra.primary ?? false, extra.callFirst ?? false]);
const holders = async (c: Client, g: string) =>
  (await c.query<{ id: string }>("select id from client_group_members where client_group_id = $1 and is_primary_contact order by id", [g]))
    .rows.map((r) => r.id);
const setPrimary = async (c: Client, acct: string, g: string, m: string | null) =>
  (await c.query<{ r: { status: string; previous?: string | null } }>(
    "select public.set_group_primary_contact($1, $2, $3) as r", [acct, g, m])).rows[0]!.r;

async function household(c: Client) {
  const acct = await seedAccount(c, `org_cf_${RUN}`);
  const home = await group(c, acct, "household", "Garcia");
  const ana = await contact(c, acct, "Ana");
  const luis = await contact(c, acct, "Luis");
  const maria = await contact(c, acct, "Maria");
  return {
    acct, home, ana, luis, maria,
    mAna: await member(c, acct, home, ana, { primary: true }),
    mLuis: await member(c, acct, home, luis, { primary: true }),
    mMaria: await member(c, acct, home, maria, { primary: true }),
  };
}

describe("0075: at most one call-first member per group (spec §5)", () => {
  it("a second call-first member in one group is refused 23505 (mutation: drop index client_group_members_one_primary_contact -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      await c.query("update client_group_members set is_primary_contact = true where id = $1", [s.mAna]);
      expect(await refused(c, () => c.query("update client_group_members set is_primary_contact = true where id = $1", [s.mLuis])))
        .toMatchObject({ code: "23505", constraint: "client_group_members_one_primary_contact" });
    }));
  it("two groups each keep their own call-first member, and one person may hold it in both", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const biz = await group(c, s.acct, "business", "Acme Roofing");
      const mAnaBiz = await member(c, s.acct, biz, s.ana);
      await c.query("update client_group_members set is_primary_contact = true where id = any($1)", [[s.mAna, mAnaBiz]]);
      expect(await holders(c, s.home)).toEqual([s.mAna]);
      expect(await holders(c, biz)).toEqual([mAnaBiz]);
    }));
  it("a new membership starts with none: no backfill (ruling R1)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      expect(await holders(c, s.home)).toEqual([]);
    }));
});

describe("0075: set_group_primary_contact (spec §5)", () => {
  it("sets, swaps in one call naming the previous holder, and clears with null (mutation: drop the clearing update -> the swap raises 23505, FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      expect(await setPrimary(c, s.acct, s.home, s.mAna)).toEqual({ status: "ok", previous: null });
      expect(await setPrimary(c, s.acct, s.home, s.mLuis)).toEqual({ status: "ok", previous: s.mAna });
      expect(await holders(c, s.home)).toEqual([s.mLuis]);
      expect(await setPrimary(c, s.acct, s.home, null)).toEqual({ status: "ok", previous: s.mLuis });
      expect(await holders(c, s.home)).toEqual([]);
      expect(await setPrimary(c, s.acct, s.home, s.mLuis)).toEqual({ status: "ok", previous: null });
      expect(await setPrimary(c, s.acct, s.home, s.mLuis)).toEqual({ status: "ok", previous: s.mLuis }); // same again: unchanged
      expect(await holders(c, s.home)).toEqual([s.mLuis]);
    }));
  it("a member of ANOTHER group is not_found and nothing moves (mutation: drop `client_group_id = p_group_id` from the member check -> the crossed member is set, FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const biz = await group(c, s.acct, "business", "Acme Roofing");
      const mAnaBiz = await member(c, s.acct, biz, s.ana);
      expect(await setPrimary(c, s.acct, s.home, mAnaBiz)).toEqual({ status: "not_found" });
      expect(await holders(c, s.home)).toEqual([]);
      expect(await holders(c, biz)).toEqual([]);
    }));
  it("another account's group, or this group under another account id, is not_found (mutation: drop `account_id = p_account_id` from the group lock -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const other = await seedAccount(c, `org_cf_other_${RUN}`);
      expect(await setPrimary(c, other, s.home, s.mAna)).toEqual({ status: "not_found" });
      expect(await setPrimary(c, other, s.home, null)).toEqual({ status: "not_found" });
      expect(await holders(c, s.home)).toEqual([]);
    }));
  it("choosing never touches anyone's Business name: the sync trigger does not fire on the flag (mutation: add is_primary_contact to client_group_members_sync_company_name's update-of list -> the stored value is recomputed, FAILS)", () =>
    withRollback(async (c) => {
      // A value the sync did not set (0072's trigger lifted for one statement, as the table owner):
      // only a sync run would replace it, so it survives exactly when the trigger does not fire.
      await c.query("lock table public.contacts in share row exclusive mode");
      const s = await household(c);
      const biz = await group(c, s.acct, "business", "Acme Roofing");
      const m = await member(c, s.acct, biz, s.ana);
      await c.query("alter table public.contacts disable trigger contacts_company_name_derived");
      await c.query("update contacts set company_name = 'Acme (as typed)' where id = $1", [s.ana]);
      await c.query("alter table public.contacts enable trigger contacts_company_name_derived");
      expect(await setPrimary(c, s.acct, biz, m)).toEqual({ status: "ok", previous: null });
      const { rows: [row] } = await c.query<{ company_name: string }>("select company_name from contacts where id = $1", [s.ana]);
      expect(row!.company_name).toBe("Acme (as typed)");
    }));
});

describe("0075: the flag across remove, restore, the Business-name Undo and a deleted contact (spec §5's table)", () => {
  const removeOf = async (c: Client, acct: string, m: string) =>
    (await c.query<{ r: { status: string; removed: Record<string, unknown> } }>(
      "select public.remove_group_membership($1, $2) as r", [acct, m])).rows[0]!.r;
  const restore = async (c: Client, acct: string, snap: unknown) =>
    (await c.query<{ r: string }>("select public.restore_group_membership($1, $2::jsonb) as r", [acct, JSON.stringify(snap)])).rows[0]!.r;

  it("removing the holder leaves the group with none; no one is promoted", () =>
    withRollback(async (c) => {
      const s = await household(c);
      await setPrimary(c, s.acct, s.home, s.mAna);
      const r = await removeOf(c, s.acct, s.mAna);
      expect(r.status).toBe("ok");
      expect(r.removed.is_primary_contact).toBe(true); // to_jsonb carries the new column: the payload's source
      expect(await holders(c, s.home)).toEqual([]);
    }));
  it("restoring the holder puts the flag back (mutation: leave restore_member as 0069 wrote it -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      await setPrimary(c, s.acct, s.home, s.mAna);
      const r = await removeOf(c, s.acct, s.mAna);
      expect(await restore(c, s.acct, r.removed)).toBe("ok");
      expect(await holders(c, s.home)).toEqual([s.mAna]);
    }));
  it("restoring while another member now holds it restores the membership WITHOUT the flag (mutation: restore the flag unconditionally -> 23505, FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      await setPrimary(c, s.acct, s.home, s.mAna);
      const r = await removeOf(c, s.acct, s.mAna);
      await setPrimary(c, s.acct, s.home, s.mLuis);
      expect(await restore(c, s.acct, r.removed)).toBe("ok");
      expect(await holders(c, s.home)).toEqual([s.mLuis]);
      const { rowCount } = await c.query("select 1 from client_group_members where id = $1", [s.mAna]);
      expect(rowCount).toBe(1);
    }));
  it("the Business-name Undo never restores the flag, whatever its snapshot says (plan deviation 1; mutation: pass p_removed through unchanged in undo_set_business -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const biz = await group(c, s.acct, "business", "Acme Roofing");
      const m = await member(c, s.acct, biz, s.ana);
      const snap = (await c.query<{ s: Record<string, unknown> }>("select to_jsonb(m) as s from client_group_members m where id = $1", [m])).rows[0]!.s;
      await c.query("delete from client_group_members where id = $1", [m]);
      const forged = { ...snap, is_primary_contact: true };
      const { rows: [u] } = await c.query<{ r: string }>(
        "select public.undo_set_business($1, $2, null, $3::jsonb) as r", [s.acct, s.ana, JSON.stringify(forged)]);
      expect(u!.r).toBe("ok");
      expect(await holders(c, biz)).toEqual([]);
      expect((await c.query("select 1 from client_group_members where id = $1", [m])).rowCount).toBe(1);
    }));
  it("deleting the holder's contact leaves the group with none, and no error (mutation: make client_group_members_contact_fkey on delete restrict -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      await setPrimary(c, s.acct, s.home, s.mAna);
      expect((await c.query("delete from contacts where id = $1", [s.ana])).rowCount).toBe(1);
      expect(await holders(c, s.home)).toEqual([]);
    }));
});

describe("0075: grants (spec §5; client-groups-schema.test.ts:157-208's shapes)", () => {
  it("the client role can neither update the flag nor insert a row carrying it (mutation: grant update (is_primary_contact) to authenticated -> the update runs, FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      await actAs(c, { app_role: "agency_admin", sub: `user_cf_agency_${RUN}` });
      expect((await c.query("select is_primary_contact from client_group_members where id = $1", [s.mAna])).rows)
        .toEqual([{ is_primary_contact: false }]); // positive control: it can READ the flag
      expect(await refused(c, () => c.query("update client_group_members set is_primary_contact = true where id = $1", [s.mAna])))
        .toMatchObject({ code: "42501", message: "permission denied for table client_group_members" });
      expect(await refused(c, () => c.query(
        "insert into client_group_members (account_id, client_group_id, contact_id, is_primary_contact) values ($1,$2,$3,true)",
        [s.acct, s.home, s.ana])))
        .toMatchObject({ code: "42501", message: "permission denied for table client_group_members" });
    }));
  it("the new and the two replaced functions are executable by service_role only (mutation: drop 0075's revoke loop -> the 0043 default privilege grants anon and authenticated, FAILS)", () =>
    withRollback(async (c) => {
      for (const f of ["public.set_group_primary_contact(uuid,uuid,uuid)", "app.restore_member(uuid,jsonb)", "public.undo_set_business(uuid,uuid,uuid,jsonb)"]) {
        const { rows: [r] } = await c.query(
          `select has_function_privilege('service_role', $1, 'execute') as svc,
                  has_function_privilege('authenticated', $1, 'execute') as auth,
                  has_function_privilege('anon', $1, 'execute') as anon`, [f]);
        expect(r, f).toEqual({ svc: true, auth: false, anon: false });
      }
    }));
});
```

- [ ] **Step 3: Run it red on `pre`.**

```bash
cd "<WT>/packages/db" && NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= SUPABASE_DB_URL=postgresql://postgres@localhost:55510/pre pnpm exec vitest run src/test/group-primary-contact-schema.test.ts > "<SCRATCH>/red.log" 2>&1; echo $? > "<SCRATCH>/red.code"
```

Expected: every case fails with `column "is_primary_contact" … does not exist` or `function public.set_group_primary_contact … does not exist`. Paste one failing assertion line and the summary line into the report.

- [ ] **Step 4: Write the migration** `packages/db/supabase/migrations/0075_group_primary_contact.sql`:

```sql
-- 0075_group_primary_contact.sql - who we call first in a household or business (S-03 part 2, PR 2a)
-- (docs/superpowers/specs/2026-10-13-group-record-page-design.md section 5, owner ruling R1)
--
-- client_group_members.is_primary is the CONTACT's main group (at most one per contact, 0069), so it
-- cannot say whose phone a household's Call reaches. This adds a second flag, at most one per GROUP,
-- with no backfill: every group starts with none and the People card asks. Written by server code only,
-- through 0069's member-write path: a plain plpgsql function, executable by service_role only, behind a
-- server action that proved the group and the membership on the request client. The client role keeps
-- SELECT only: 0069 section 3 revoked insert, update and delete on the TABLE, which covers this column.
-- No policy changes: RLS on client_group_members is row-level, so the flag is as visible as its row.
--
-- app.restore_member (0069 section 5) is replaced so the Undo of a removal puts the flag back when no
-- other member holds it now. public.undo_set_business (0069 section 7) is replaced so the Business
-- name Undo, whose snapshot comes back from ANY reader's browser, never sets it.
-- Both lock the group row FOR NO KEY UPDATE: it serialises two choosers and two restores (the partial
-- index's race) without queueing member inserts, which take FOR KEY SHARE through the group FK.
-- The sync trigger fires on update of is_primary, client_group_id, contact_id only (0069 section 6),
-- so choosing who we call first never touches anyone's Business name.
-- ASCII only, no backslash anywhere (0050's rule; the MCP apply has mangled escapes before).
--
-- APPLY ORDER: CI project (ci-project-setup.yml push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge PR 2a.
--
-- ROLLBACK (revert the app first; the old build never reads the column):
--   drop function public.set_group_primary_contact(uuid, uuid, uuid);
--   re-run 0069's "create function app.restore_member" and "create function public.undo_set_business"
--   statements verbatim, each as "create or replace function";
--   drop index public.client_group_members_one_primary_contact;
--   alter table public.client_group_members drop column is_primary_contact;
--   Lost: the call-first choices made since.

set local lock_timeout = '5s';

-- 1. The flag: at most one per group. "Exactly one" is not kept: a group may have none.
alter table public.client_group_members add column is_primary_contact boolean not null default false;
create unique index client_group_members_one_primary_contact
  on public.client_group_members (client_group_id) where is_primary_contact;

-- 2. The write. p_member_id null clears. Answers the member that held it before, or null.
create function public.set_group_primary_contact(p_account_id uuid, p_group_id uuid, p_member_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare v_previous uuid;
begin
  perform 1 from public.client_groups where id = p_group_id and account_id = p_account_id for no key update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if p_member_id is not null then
    perform 1 from public.client_group_members
     where id = p_member_id and client_group_id = p_group_id and account_id = p_account_id;
    if not found then return jsonb_build_object('status', 'not_found'); end if;
  end if;
  select id into v_previous from public.client_group_members where client_group_id = p_group_id and is_primary_contact;
  if v_previous is distinct from p_member_id then
    update public.client_group_members set is_primary_contact = false where client_group_id = p_group_id and is_primary_contact;
    if p_member_id is not null then
      update public.client_group_members set is_primary_contact = true where id = p_member_id;
    end if;
  end if;
  return jsonb_build_object('status', 'ok', 'previous', v_previous);
end $$;

-- 3. The restore. 0069's body, plus the flag: back only when no other member of the group holds it.
create or replace function app.restore_member(p_account_id uuid, p_snapshot jsonb) returns text
language plpgsql set search_path = '' as $$
declare
  v_contact uuid := (p_snapshot ->> 'contact_id')::uuid;
  v_group uuid := (p_snapshot ->> 'client_group_id')::uuid;
  v_primary boolean := coalesce((p_snapshot ->> 'is_primary')::boolean, false);
  v_call_first boolean := coalesce((p_snapshot ->> 'is_primary_contact')::boolean, false);
begin
  perform 1 from public.client_groups where id = v_group and account_id = p_account_id for no key update;
  if not found then return 'not_found'; end if;
  perform 1 from public.contacts where id = v_contact and account_id = p_account_id;
  if not found then return 'not_found'; end if;
  if exists (select 1 from public.client_group_members where client_group_id = v_group and contact_id = v_contact) then
    return 'ok';
  end if;
  if v_primary then
    update public.client_group_members set is_primary = false where contact_id = v_contact and is_primary;
  end if;
  if v_call_first and exists (select 1 from public.client_group_members where client_group_id = v_group and is_primary_contact) then
    v_call_first := false;
  end if;
  insert into public.client_group_members
    (id, account_id, client_group_id, contact_id, role, is_primary, is_billing, is_primary_contact, created_at)
  values ((p_snapshot ->> 'id')::uuid, p_account_id, v_group, v_contact, p_snapshot ->> 'role', v_primary,
          coalesce((p_snapshot ->> 'is_billing')::boolean, false), v_call_first,
          coalesce((p_snapshot ->> 'created_at')::timestamptz, now()));
  return 'ok';
end $$;

-- 4. The Business name Undo. 0069's body, except the snapshot loses is_primary_contact first.
create or replace function public.undo_set_business(p_account_id uuid, p_contact_id uuid, p_added uuid, p_removed jsonb)
returns text language plpgsql set search_path = '' as $$
begin
  if not app.lock_contact(p_account_id, p_contact_id) then return 'not_found'; end if;
  if p_removed is not null and (p_removed ->> 'contact_id')::uuid is distinct from p_contact_id then
    raise exception 'undo_set_business: the snapshot is for another contact' using errcode = '22023';
  end if;
  -- The snapshot comes back from the browser: it may name only a BUSINESS group of this account. A
  -- forged one naming a household (one a Technician cannot see) would otherwise join it.
  if p_removed is not null and not exists (
       select 1 from public.client_groups g
        where g.id = (p_removed ->> 'client_group_id')::uuid and g.account_id = p_account_id and g.kind = 'business') then
    return 'not_found';
  end if;
  if p_added is not null then
    delete from public.client_group_members where id = p_added and contact_id = p_contact_id;
  end if;
  if p_removed is not null then
    -- 0075: who we call first is chosen by Owner, Staff and the agency, never restored from a browser here.
    perform app.restore_member(p_account_id, p_removed - 'is_primary_contact');
  end if;
  perform app.promote_primary(p_contact_id);
  return 'ok';
end $$;

-- 5. Grants. Default privileges hand EXECUTE to anon, authenticated and service_role BY NAME (0043);
--    create or replace keeps the old ACL, re-stated here so this file alone is the record.
do $$
declare f text;
begin
  foreach f in array array[
    'public.set_group_primary_contact(uuid,uuid,uuid)', 'app.restore_member(uuid,jsonb)',
    'public.undo_set_business(uuid,uuid,uuid,jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
```

Apply to `post` only: `P -d post -1 -f packages/db/supabase/migrations/0075_group_primary_contact.sql`.

- [ ] **Step 5: Run green on `post`**, the same command with `/post`. Expected: `Tests  14 passed (14)` (3 + 4 + 5 + 2 `it(` blocks; recount if you split or merge any). Then run each probe named in a test title on a scratch copy of the function or index on `post`, inside `begin; … rollback;` or by re-creating `post` from Step 1, see that test fail BY NAME, restore. The "drop the clearing update" probe: `create or replace` the function without the first `update`; the sync probe: `drop trigger client_group_members_sync_company_name on client_group_members; create trigger … after insert or delete or update of is_primary, client_group_id, contact_id, is_primary_contact …` with 0069's body.

- [ ] **Step 6: Extend `client-groups-rls.test.ts`** with this describe after line 80 (it reuses that file's `seed`, `claims`, `ids`; the SQL mirrors Task 2's reads: the member rows of one group, its count, its places, the flag):

```ts
describe("S-03 part 2: the group page's reads under the Technician's RLS (spec §4.2, §11.1; plan deviation 10)", () => {
  const groupRows = async (c: Client, acct: string, g: string) =>
    (await c.query<{ id: string; is_primary_contact: boolean }>(
      `select id, is_primary_contact from client_group_members where account_id = $1 and client_group_id = $2 order by created_at, id`,
      [acct, g])).rows;
  const count = async (c: Client, acct: string, g: string) =>
    (await c.query<{ n: number }>("select count(*)::int as n from client_group_members where account_id = $1 and client_group_id = $2", [acct, g])).rows[0]!.n;

  it("a Technician with one member of the household reads the group, ONE member row and a count of 1, and every place of the group (mutation: drop client_group_members_technician_scope -> 2 rows, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const place = (await c.query<{ id: string }>(
        "insert into places (account_id, client_group_id, label) values ($1,$2,'The house') returning id", [s.acct, s.shared])).rows[0]!.id;
      await actAs(c, claims("tech"));
      expect(await ids(c, "client_groups", s.acct)).toEqual([s.shared]);
      expect((await groupRows(c, s.acct, s.shared)).map((r) => r.id)).toEqual([s.mineInShared]);
      expect(await count(c, s.acct, s.shared)).toBe(1);
      expect((await c.query("select id from places where account_id = $1 and client_group_id = $2", [s.acct, s.shared])).rows)
        .toEqual([{ id: place }]);
      // A group with none of theirs reads as nothing at all: the page's readGroup is null, a 404.
      expect((await c.query("select 1 from client_groups where id = $1", [s.onlyTheirs])).rowCount).toBe(0);
    }));
  for (const p of ["owner", "staff", "agency"] as const) {
    it(`${p}: both members of the household and a count of 2`, () => withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims(p));
      expect((await groupRows(c, s.acct, s.shared)).map((r) => r.id).sort()).toEqual([s.mineInShared, s.theirsInShared].sort());
      expect(await count(c, s.acct, s.shared)).toBe(2);
    }));
  }
  it("the flag is exactly as visible as its row: the Technician reads it on their customer's row and nowhere else (mutation: drop the restrictive member policy -> they read the other's holder row, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("update client_group_members set is_primary_contact = true where id = $1", [s.mineInShared]);
      await actAs(c, claims("tech"));
      expect(await groupRows(c, s.acct, s.shared)).toEqual([{ id: s.mineInShared, is_primary_contact: true }]);
      await c.query("reset role");
      await c.query("update client_group_members set is_primary_contact = false where id = $1", [s.mineInShared]);
      await c.query("update client_group_members set is_primary_contact = true where id = $1", [s.theirsInShared]);
      await actAs(c, claims("tech"));
      expect((await groupRows(c, s.acct, s.shared)).filter((r) => r.is_primary_contact)).toEqual([]);
      await c.query("reset role");
      await actAs(c, claims("owner"));
      expect((await groupRows(c, s.acct, s.shared)).filter((r) => r.is_primary_contact).map((r) => r.id)).toEqual([s.theirsInShared]);
    }));
});
```

(The seed already gives the shared household two members: `mineInShared` (the Technician's customer) and `theirsInShared` (another Technician's), `client-groups-rls.test.ts:31-40`. The spec's "one of three" reads the same here with two: the Technician sees one, everyone else all.) Run it on `pre` (red: `column "is_primary_contact" does not exist` in the third case; the first two pass on `pre` because they read no new column, which is correct, since 0068/0069's fences already hold; their probe is the policy drop) and on `post` (green). Probe each by name.

- [ ] **Step 7: Run the neighbours on `post`:** `client-groups-schema.test.ts` (the "exactly the four policies" case, `:174`, still four; the function list `:189-195` still service-role-only), `client-groups-functions.test.ts`, `client-groups-guards.test.ts`, `company-name-read-only-schema.test.ts`, `schema-grants-guard.test.ts` (`EXPECTED_WRITES` does not move: no client grant was added). All green. Paste each summary line.

- [ ] **Step 8: Byte scan.** `node -e "const b=require('fs').readFileSync('packages/db/supabase/migrations/0075_group_primary_contact.sql');let n=0;for(const x of b){if(x>127||x===92)n++}console.log('0075',n)"` → `0075 0`.

- [ ] **Step 9: Commit.**

```bash
git add -- packages/db/supabase/migrations/0075_group_primary_contact.sql packages/db/src/test/group-primary-contact-schema.test.ts
git commit -m "feat(db): who we call first in a household or business, at most one per group, server-written (migration 0075)" -- packages/db/supabase/migrations/0075_group_primary_contact.sql packages/db/src/test/group-primary-contact-schema.test.ts packages/db/src/test/client-groups-rls.test.ts
```

---

## Task 2: `@bis/db` group members, the call-first write, group places, open deals (bis-crm)

**Review:** opus (it wraps a write and decides what the Undo's payload records).

**Files**
- Modify: `packages/db/src/client-groups.ts` (`GroupMemberSnapshot` `:18-21`; `removeMembership` `:234-241`; new functions after `readGroup`, `:156`)
- Modify: `packages/db/src/places.ts` (`PlaceCtx` `:75`, `event` `:79-81`; new `listGroupPlaces` after `listContactPlaces`, `:161`)
- Modify: `packages/db/src/opportunities.ts` (new `listOpenDealsFor` after `listContactOpportunities`, `:168`)
- Modify: `packages/db/src/index.ts` (the client-groups block `:235-243`, the places block `:254-261`, line 44's opportunities export)
- Create: `packages/db/src/test/group-members.test.ts`
- Modify: `packages/db/src/test/head-count-null.test.ts` (one case)

**Interfaces**
- Consumes: `rpc`, `emit` (`client-groups.ts:42-46`, `:2`); `isTimelineInstant`, `TimelineCursor` (`timeline-cursor.ts:25`, `:7`); `PLACE_COLUMNS`, `EQUIPMENT_COLUMNS`, `MAX_PLACES_READ`, `MAX_EQUIPMENT_READ`, `dbError`, `assertUuid` (`places.ts:44-50`, `:25-31`); Task 1's `set_group_primary_contact`.
- Produces (exact names, barrelled):

```ts
// client-groups.ts
export const GROUP_MEMBERS_PAGE_SIZE = 30;
export const GROUP_ACTIVITY_CAP = 50;
export type GroupMember = {
  memberId: string; contactId: string; firstName: string | null; lastName: string | null;
  phone: string | null; email: string | null; role: string | null; isBilling: boolean;
  isPrimaryContact: boolean; joinedAt: string;
};
export type GroupMembersPage = { primary: GroupMember | null; members: GroupMember[]; next: TimelineCursor | null };
export type GroupPerson = { contactId: string; firstName: string | null; lastName: string | null };
export function listGroupMembers(db, accountId, groupId, opts?: { after?: TimelineCursor; limit?: number }): Promise<GroupMembersPage>;
export function countGroupMembers(db, accountId, groupId): Promise<number>;
export function listGroupPeople(db, accountId, groupId, limit?: number): Promise<GroupPerson[]>;
export function setGroupPrimaryContact(db, accountId, groupId, memberId: string | null, actorId: string):
  Promise<{ status: "ok"; previous: string | null } | { status: "not_found" }>;
// GroupMemberSnapshot gains is_primary_contact: boolean; removeMembership's event payload gains wasPrimaryContact.
// places.ts
export type PlaceCtx = { subjectId: string; subjectKind?: "contact" | "group"; actorId: string; actorType?: ActorType };
export function listGroupPlaces(db, accountId, groupId): Promise<ContactPlaces>; // groups: [] always
// opportunities.ts
export const GROUP_DEALS_SHOWN = 30;
export type OpenDealRow = { id: string; name: string; status: string; monetary_value: number | string; created_at: string; contact_id: string };
export function listOpenDealsFor(db, accountId, contactIds: readonly string[], limit?: number): Promise<{ deals: OpenDealRow[]; count: number }>;
```

- [ ] **Step 1: Write the failing live test** `packages/db/src/test/group-members.test.ts`:

```ts
import "dotenv/config";
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { addPlace } from "../places";
import { ensureDefaultPipeline, createOpportunity } from "../opportunities";
import {
  createGroupWithMember, addContactToGroup, removeMembership, listGroupMembers, countGroupMembers, listGroupPeople,
  setGroupPrimaryContact, GROUP_MEMBERS_PAGE_SIZE,
} from "../client-groups";
import { listGroupPlaces } from "../places";
import { listOpenDealsFor } from "../opportunities";

const A = "user_test";
const RUN = Math.random().toString(36).slice(2, 8);

async function household(db: Parameters<Parameters<typeof withTestAccount>[0]>[0], accountId: string, n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push((await createContact(db, accountId, { firstName: `P${i}`, lastName: "Garcia", email: `gm-${RUN}-${i}@example.com` }, A)).id);
  }
  const g = await createGroupWithMember(db, accountId, ids[0]!, "household", `Garcia ${RUN}`, null, A);
  if (g.status !== "ok") throw new Error(g.status);
  const members = [g.memberId];
  for (const id of ids.slice(1)) {
    const r = await addContactToGroup(db, accountId, id, g.groupId, null, A);
    if (r.status !== "ok") throw new Error(r.status);
    members.push(r.memberId);
  }
  return { groupId: g.groupId, contactIds: ids, memberIds: members };
}

describe("group members (S-03 part 2, spec §6)", () => {
  it("pins the call-first member and never repeats them in the rows; primary comes back on a later page too (C10; plan deviation 3; mutation: drop .eq('is_primary_contact', false) -> the holder appears twice, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const h = await household(db, accountId, 3);
      expect(await setGroupPrimaryContact(db, accountId, h.groupId, h.memberIds[1]!, A)).toEqual({ status: "ok", previous: null });
      const page = await listGroupMembers(db, accountId, h.groupId);
      expect(page.primary?.memberId).toBe(h.memberIds[1]);
      expect(page.primary?.isPrimaryContact).toBe(true);
      expect(page.members.map((m) => m.memberId)).toEqual([h.memberIds[0], h.memberIds[2]]);
      const later = await listGroupMembers(db, accountId, h.groupId, { after: { v: page.members[0]!.joinedAt, id: page.members[0]!.memberId } });
      expect(later.primary?.memberId).toBe(h.memberIds[1]);
      expect(later.members.map((m) => m.memberId)).toEqual([h.memberIds[2]]);
    }));

  it("31 members page as 30 then 1, no row lost or repeated at a created_at tie (mutation: compare created_at only in the cursor filter -> the tied row is lost or repeated, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const h = await household(db, accountId, 31);
      // Two memberships share one instant (the service role may write created_at; 0069 revokes only the client role).
      const tie = "2026-10-13T12:00:00.000001+00:00";
      const { error } = await db.from("client_group_members").update({ created_at: tie })
        .eq("account_id", accountId).in("id", [h.memberIds[29]!, h.memberIds[30]!]);
      if (error) throw new Error(error.message);
      const first = await listGroupMembers(db, accountId, h.groupId);
      expect(first.members).toHaveLength(GROUP_MEMBERS_PAGE_SIZE);
      expect(first.next).not.toBeNull();
      const second = await listGroupMembers(db, accountId, h.groupId, { after: first.next! });
      expect(second.next).toBeNull();
      const all = [...first.members, ...second.members].map((m) => m.memberId);
      expect(all).toHaveLength(31);
      expect(new Set(all).size).toBe(31);
      expect(await countGroupMembers(db, accountId, h.groupId)).toBe(31);
    }));

  it("listGroupPeople is the first 50 by joined order, with names", () =>
    withTestAccount(async (db, accountId) => {
      const h = await household(db, accountId, 3);
      expect(await listGroupPeople(db, accountId, h.groupId, 2)).toEqual([
        { contactId: h.contactIds[0], firstName: "P0", lastName: "Garcia" },
        { contactId: h.contactIds[1], firstName: "P1", lastName: "Garcia" },
      ]);
    }));

  it("setGroupPrimaryContact refuses a member of another group and names the previous holder on a swap", () =>
    withTestAccount(async (db, accountId) => {
      const h = await household(db, accountId, 2);
      const other = await household(db, accountId, 1);
      expect(await setGroupPrimaryContact(db, accountId, h.groupId, other.memberIds[0]!, A)).toEqual({ status: "not_found" });
      await setGroupPrimaryContact(db, accountId, h.groupId, h.memberIds[0]!, A);
      expect(await setGroupPrimaryContact(db, accountId, h.groupId, h.memberIds[1]!, A)).toEqual({ status: "ok", previous: h.memberIds[0] });
      expect(await setGroupPrimaryContact(db, accountId, h.groupId, null, A)).toEqual({ status: "ok", previous: h.memberIds[1] });
    }));

  it("removing the holder records wasPrimaryContact on its event, and the snapshot carries the flag (spec §10; mutation: drop wasPrimaryContact from the payload -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const h = await household(db, accountId, 2);
      await setGroupPrimaryContact(db, accountId, h.groupId, h.memberIds[0]!, A);
      const r = await removeMembership(db, accountId, h.memberIds[0]!, A);
      if (r.status !== "ok") throw new Error(r.status);
      expect(r.removed.is_primary_contact).toBe(true);
      const { data } = await db.from("events").select("payload").eq("account_id", accountId)
        .eq("type", "client_group.member_removed").contains("payload", { memberId: h.memberIds[0] });
      expect((data ?? []).map((e) => (e.payload as { wasPrimaryContact?: boolean }).wasPrimaryContact)).toEqual([true]);
    }));

  it("listGroupPlaces returns the group's own places and never a member's own (C12; mutation: reuse listContactPlaces' contact_id-or-group filter -> the member's own place appears, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const h = await household(db, accountId, 1);
      const shared = await addPlace(db, accountId, { contactId: null, groupId: h.groupId },
        { label: "The house", address: "1 Main St", landmark: null, directions: null, city: null, region: null, postal_code: null, country: null },
        { subjectId: h.groupId, subjectKind: "group", actorId: A });
      await addPlace(db, accountId, { contactId: h.contactIds[0]!, groupId: null },
        { label: "Ana's shop", address: "2 Oak St", landmark: null, directions: null, city: null, region: null, postal_code: null, country: null },
        { subjectId: h.contactIds[0]!, actorId: A });
      const read = await listGroupPlaces(db, accountId, h.groupId);
      expect(read.places.map((p) => p.id)).toEqual([shared.id]);
      expect(read.placeCount).toBe(1);
      expect(read.groups).toEqual([]);
      // Events name the GROUP as the record a group-page change was made from, never a contactId.
      const { data } = await db.from("events").select("payload").eq("account_id", accountId).eq("type", "place.added")
        .contains("payload", { placeId: shared.id });
      expect(data?.[0]?.payload).toMatchObject({ groupId: h.groupId });
      expect(data?.[0]?.payload).not.toHaveProperty("contactId");
    }));

  it("listOpenDealsFor returns open deals only, newest first, with contact_id and an exact count (C13; mutation: drop .eq('status','open') -> the won deal appears, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const h = await household(db, accountId, 2);
      const pipeline = await ensureDefaultPipeline(db, accountId);
      // Assumption: createOpportunity's input names; read opportunities.ts before writing this line.
      const a = await createOpportunity(db, accountId, { contactId: h.contactIds[0]!, pipelineId: pipeline.id, name: "Deck", value: 100 }, A);
      const b = await createOpportunity(db, accountId, { contactId: h.contactIds[1]!, pipelineId: pipeline.id, name: "Roof", value: 200 }, A);
      const { error } = await db.from("opportunities").update({ status: "won" }).eq("id", a.id);
      if (error) throw new Error(error.message);
      const r = await listOpenDealsFor(db, accountId, h.contactIds);
      expect(r.deals.map((d) => [d.id, d.contact_id])).toEqual([[b.id, h.contactIds[1]]]);
      expect(r.count).toBe(1);
      expect(await listOpenDealsFor(db, accountId, [])).toEqual({ deals: [], count: 0 });
    }));
});
```

**Before writing the deals case, read `opportunities.ts`'s `ensureDefaultPipeline` and `createOpportunity` signatures** (rule 1) and adjust the two calls; the assertion lines stay.

Add to `head-count-null.test.ts`'s describe (with `countGroupMembers` imported from `../client-groups`):

```ts
  it("countGroupMembers rejects a count-less answer (mutation: return count ?? 0 -> resolves 0, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await expect(countGroupMembers(noCount(db, "client_group_members"), accountId, randomUUID()))
        .rejects.toThrow(noCountReturned("countGroupMembers"));
    }));
```

- [ ] **Step 2: Typecheck red.** `pnpm --filter @bis/db typecheck` → fails naming `listGroupMembers`, `countGroupMembers`, `listGroupPeople`, `setGroupPrimaryContact`, `GROUP_MEMBERS_PAGE_SIZE`, `listGroupPlaces`, `listOpenDealsFor`, `subjectKind` and `is_primary_contact`. Paste the first error line. (The live red is CI `verify`'s; do not run this file locally against bis-ci.)

- [ ] **Step 3: Implement `client-groups.ts`.** Change `GroupMemberSnapshot` (`:18-21`) to add `is_primary_contact: boolean;` after `is_billing: boolean;`. Change `removeMembership`'s emit (`:238-239`) to:

```ts
  await emit(db, accountId, "client_group.member_removed", actorId,
    { memberId, contactId: r.removed.contact_id, groupId: r.removed.client_group_id,
      // S-03 part 2 (spec §10): a narrow caller's Undo restores the call-first flag only when THIS says so.
      wasPrimaryContact: r.removed.is_primary_contact === true });
```

Add after `readGroup` (`:156`), with `import { isTimelineInstant, type TimelineCursor } from "./timeline-cursor";` at the top:

```ts
/** The People card's page size, and the most members the page's activity reads (spec D7). */
export const GROUP_MEMBERS_PAGE_SIZE = 30;
export const GROUP_ACTIVITY_CAP = 50;

export type GroupMember = {
  memberId: string; contactId: string; firstName: string | null; lastName: string | null;
  phone: string | null; email: string | null; role: string | null; isBilling: boolean;
  isPrimaryContact: boolean; joinedAt: string;
};
export type GroupMembersPage = { primary: GroupMember | null; members: GroupMember[]; next: TimelineCursor | null };
export type GroupPerson = { contactId: string; firstName: string | null; lastName: string | null };

type GroupMemberRow = {
  id: string; contact_id: string; role: string | null; is_billing: boolean; is_primary_contact: boolean; created_at: string;
  contacts: { first_name: string | null; last_name: string | null; phone: string | null; email: string | null } | null;
};
// The composite-FK embed listContactGroups already reads (:108-109); contacts_technician_scope fences it again.
const GROUP_MEMBER_COLS = "id, contact_id, role, is_billing, is_primary_contact, created_at, contacts(first_name, last_name, phone, email)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toMember = (r: GroupMemberRow): GroupMember => ({
  memberId: r.id, contactId: r.contact_id, firstName: r.contacts?.first_name ?? null, lastName: r.contacts?.last_name ?? null,
  phone: r.contacts?.phone ?? null, email: r.contacts?.email ?? null, role: r.role, isBilling: r.is_billing,
  isPrimaryContact: r.is_primary_contact, joinedAt: r.created_at,
});

/** `(created_at, id) > (v, id)` for PostgREST's `.or()`; validated, then quoted (timeline-cursor.ts's rule). */
function membersAfterFilter(after: TimelineCursor): string {
  if (!isTimelineInstant(after.v) || !UUID.test(after.id)) throw new TypeError("group members cursor: malformed");
  const v = `"${after.v}"`;
  return `created_at.gt.${v},and(created_at.eq.${v},id.gt.${after.id.toLowerCase()})`;
}

/**
 * The group page's People (spec §6, C10): the call-first member, read on EVERY page because the
 * header calls them (plan deviation 3), then the rest in the order they joined, `limit` a page past
 * `after`, the holder excluded so they are never shown twice. RLS decides who is visible: a
 * Technician reads their own customers' memberships only (0069:99-100), so `primary` is null when
 * the holder is someone else's customer. THROWS on a read error.
 */
export async function listGroupMembers(
  db: SupabaseClient, accountId: string, groupId: string, opts: { after?: TimelineCursor; limit?: number } = {},
): Promise<GroupMembersPage> {
  const limit = opts.limit ?? GROUP_MEMBERS_PAGE_SIZE;
  let rest = db.from("client_group_members").select(GROUP_MEMBER_COLS)
    .eq("account_id", accountId).eq("client_group_id", groupId).eq("is_primary_contact", false);
  if (opts.after) rest = rest.or(membersAfterFilter(opts.after));
  const [held, page] = await Promise.all([
    db.from("client_group_members").select(GROUP_MEMBER_COLS)
      .eq("account_id", accountId).eq("client_group_id", groupId).eq("is_primary_contact", true).maybeSingle(),
    rest.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(limit + 1),
  ]);
  if (held.error) throw new Error(`listGroupMembers primary failed: ${held.error.message}`);
  if (page.error) throw new Error(`listGroupMembers failed: ${page.error.message}`);
  const raw = (page.data ?? []) as unknown as GroupMemberRow[];
  const shown = raw.slice(0, limit);
  const last = shown.at(-1);
  const primaryRow = held.data as unknown as GroupMemberRow | null;
  return {
    primary: primaryRow && primaryRow.contacts ? toMember(primaryRow) : null,
    members: shown.filter((r) => r.contacts !== null).map(toMember),
    next: raw.length > limit && last ? { v: last.created_at, id: last.id } : null,
  };
}

/** The exact number of memberships the caller can see. THROWS on a read error or a count-less answer (#245). */
export async function countGroupMembers(db: SupabaseClient, accountId: string, groupId: string): Promise<number> {
  const { count, error } = await db.from("client_group_members").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("client_group_id", groupId);
  if (error) throw new Error(`countGroupMembers failed: ${error.message}`);
  if (count === null) throw new Error("countGroupMembers failed: no count returned");
  return count;
}

/** The first `limit` people by joined order (C13 in 2a: Deals' set), with their names. THROWS. */
export async function listGroupPeople(
  db: SupabaseClient, accountId: string, groupId: string, limit = GROUP_ACTIVITY_CAP,
): Promise<GroupPerson[]> {
  const { data, error } = await db.from("client_group_members").select("contact_id, contacts(first_name, last_name)")
    .eq("account_id", accountId).eq("client_group_id", groupId)
    .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(limit);
  if (error) throw new Error(`listGroupPeople failed: ${error.message}`);
  return ((data ?? []) as unknown as { contact_id: string; contacts: { first_name: string | null; last_name: string | null } | null }[])
    .filter((r) => r.contacts !== null)
    .map((r) => ({ contactId: r.contact_id, firstName: r.contacts!.first_name, lastName: r.contacts!.last_name }));
}

/**
 * Who we call first (0075's set_group_primary_contact). The CALLER must have proven the group and,
 * when given, the membership through the request client and checked the caller is a manager (C2).
 * `memberId` null clears. Answers the member that held it before, for the Undo.
 */
export async function setGroupPrimaryContact(
  db: SupabaseClient, accountId: string, groupId: string, memberId: string | null, actorId: string,
): Promise<{ status: "ok"; previous: string | null } | { status: "not_found" }> {
  const r = await rpc<{ status: string; previous?: string | null }>(
    db, "set_group_primary_contact", { p_account_id: accountId, p_group_id: groupId, p_member_id: memberId });
  if (r.status !== "ok") return { status: "not_found" };
  await emit(db, accountId, "client_group.member_updated", actorId,
    { groupId, memberId, previous: r.previous ?? null, fields: ["is_primary_contact"] });
  return { status: "ok", previous: r.previous ?? null };
}
```

- [ ] **Step 4: Implement `places.ts`.** `PlaceCtx` (`:75`) becomes:

```ts
/** subjectId: the record the action was taken from, carried in every event payload; a group's page (S-03
 *  part 2, C12) records it as `groupId`, a contact's as `contactId`. */
export type PlaceCtx = { subjectId: string; subjectKind?: "contact" | "group"; actorId: string; actorType?: ActorType };
```

`event` (`:79-81`) becomes:

```ts
async function event(db: SupabaseClient, accountId: string, type: string, ctx: PlaceCtx, ids: Record<string, unknown>) {
  const subject = ctx.subjectKind === "group" ? { groupId: ctx.subjectId } : { contactId: ctx.subjectId };
  await emit(db, accountId, type, ctx.actorId, { ...subject, ...ids }, ctx.actorType ?? "user");
}
```

Add after `listContactPlaces` (`:161`):

```ts
/**
 * A group's OWN places (S-03 part 2, C12): `client_group_id = groupId`, active first, capped at
 * MAX_PLACES_READ with an exact count, and their equipment, as listContactPlaces' second and third
 * reads with the owner filter swapped. A member's own places are on their own page. `groups` is
 * always empty: on a group's page there is no other group to rank by. THROWS on a read error.
 */
export async function listGroupPlaces(db: SupabaseClient, accountId: string, groupId: string): Promise<ContactPlaces> {
  assertUuid(groupId, "listGroupPlaces");
  const { data: pData, count: placeCount, error: pErr } = await db.from("places").select(PLACE_COLUMNS, { count: "exact" })
    .eq("account_id", accountId).eq("client_group_id", groupId)
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true }).order("id", { ascending: true })
    .limit(MAX_PLACES_READ);
  if (pErr) throw dbError("listGroupPlaces places read failed", pErr);
  if (placeCount === null) throw new PlaceDbError("listGroupPlaces failed: no count returned", undefined);
  const places = (pData ?? []) as unknown as PlaceRow[];
  let equipment: EquipmentRow[] = [];
  let equipmentCount = 0;
  if (places.length > 0) {
    const { data, count, error } = await db.from("equipment").select(EQUIPMENT_COLUMNS, { count: "exact" })
      .eq("account_id", accountId).in("place_id", places.map((p) => p.id))
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .limit(MAX_EQUIPMENT_READ);
    if (error) throw dbError("listGroupPlaces equipment read failed", error);
    if (count === null) throw new PlaceDbError("listGroupPlaces failed: no equipment count returned", undefined);
    equipment = (data ?? []) as unknown as EquipmentRow[];
    equipmentCount = count;
  }
  return { groups: [], places, placeCount, equipment, equipmentCount };
}
```

- [ ] **Step 5: Implement `opportunities.ts`** after `listContactOpportunities` (`:168`):

```ts
/** The group page's Deals card shows at most this many rows (spec §8.5). */
export const GROUP_DEALS_SHOWN = 30;
export type OpenDealRow = { id: string; name: string; status: string; monetary_value: number | string; created_at: string; contact_id: string };

/**
 * Open deals of a set of people (S-03 part 2, C13), newest first, at most `limit`, with an exact
 * count for "Showing 30 of 41 open deals.". On the caller's client: RLS (0068) decides. THROWS.
 */
export async function listOpenDealsFor(
  db: SupabaseClient, accountId: string, contactIds: readonly string[], limit = GROUP_DEALS_SHOWN,
): Promise<{ deals: OpenDealRow[]; count: number }> {
  if (contactIds.length === 0) return { deals: [], count: 0 };
  const { data, count, error } = await db.from("opportunities")
    .select("id, name, status, monetary_value, created_at, contact_id", { count: "exact" })
    .eq("account_id", accountId).eq("status", "open").in("contact_id", [...contactIds])
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error) throw new Error(`listOpenDealsFor failed: ${error.message}`);
  if (count === null) throw new Error("listOpenDealsFor failed: no count returned");
  return { deals: (data ?? []) as OpenDealRow[], count };
}
```

- [ ] **Step 6: Barrel.** In `index.ts`'s client-groups block (`:235-243`) add `listGroupMembers, countGroupMembers, listGroupPeople, setGroupPrimaryContact, GROUP_MEMBERS_PAGE_SIZE, GROUP_ACTIVITY_CAP,` and `type GroupMember, type GroupMembersPage, type GroupPerson,`. In the places block (`:254-261`) add `listGroupPlaces,`. On line 44's opportunities export add `listOpenDealsFor, GROUP_DEALS_SHOWN, type OpenDealRow` (read the line first; add to it, touch no other name).
- [ ] **Step 7: Green (typecheck), and the neighbours.** `pnpm --filter @bis/db typecheck` → clean. Then the pure and owner-run neighbours that do not need PostgREST: none in this task. The live file goes red→green on CI `verify`; record in the report that `group-members.test.ts` and the `head-count-null` case are CI-proven, with the probes to run there named (the orchestrator pushes the branch at the end of Group A).
- [ ] **Step 8: Commit.**

```bash
git add -- packages/db/src/test/group-members.test.ts
git commit -m "feat(db): a group's members, its call-first write, its own places and its people's open deals (S-03 part 2)" -- packages/db/src/client-groups.ts packages/db/src/places.ts packages/db/src/opportunities.ts packages/db/src/index.ts packages/db/src/test/group-members.test.ts packages/db/src/test/head-count-null.test.ts
```

---

## Task 3: Server actions and the group's Properties route (bis-crm)

**Review:** opus (tenancy: every write proves its target on the request client; the Undo's flag).

**Files**
- Modify: `…/contacts/groups-actions.ts` (+ `groups-actions.test.ts`)
- Modify: `…/contacts/places-actions.ts` (+ `places-actions.test.ts`)
- Create: `apps/web/src/app/api/accounts/[accountId]/groups/[groupId]/places/route.ts` (+ `route.test.ts`)
- Modify: `apps/web/src/lib/contacts/places-load.ts` (+ its test, `places-load.test.ts` if present; else in `places-card.test.ts`'s parser cases)
- Modify: `…/accounts/in-account-service-reads.test.ts` (nothing to add: the route uses only `dbForRequest`; `groups-actions.ts` is already listed `proven-target`, `:86`)

**Interfaces**
- Consumes: Task 2's `setGroupPrimaryContact`, `listGroupPlaces`, `readGroup` (`client-groups.ts:150-156`), `readMembership` (`:142-148`), `GroupMemberSnapshot.is_primary_contact`; `seesWholeAccount` (`lib/auth-role.ts:15-17`); `isUuid` (`lib/assign/action-guards.ts:11`).
- Produces:

```ts
// groups-actions.ts
export async function setGroupPrimaryContactAction(accountId: string, groupId: string, memberId: string | null):
  Promise<GroupResult<{ previous: string | null }>>;
// places-actions.ts
export type PlaceSubjectArg = string | { kind: "group"; id: string };
// every exported action's second parameter is now `subjectArg: PlaceSubjectArg` (a string is a contact, as before)
// route: GET /api/accounts/[accountId]/groups/[groupId]/places -> PlacesResponse with `group`
// places-load.ts / route types:
export type PlacesResponse = { subject; today; groups; places; placeCount; equipment; equipmentCount;
  /** S-03 part 2: present when the record is a group. */ group?: { id: string; kind: GroupKind; name: string } };
```

- [ ] **Step 1: Failing action tests.** Add to `groups-actions.test.ts`: `setGroupPrimaryContact: vi.fn()` in the `db` factory object (`:17-22`), and a `snap()` default `is_primary_contact: false`. Then:

```ts
describe("S-03 part 2: who we call first is Owner, Staff and the agency's to choose (C2)", () => {
  const MB = "44444444-4444-4444-8444-444444444444";
  it("a Technician is refused before any read or service write (mutation: drop the seesWholeAccount check -> the service write runs, FAILS)", async () => {
    access.role = "technician";
    expect(await A.setGroupPrimaryContactAction("a1", G, M)).toEqual({ ok: false, error: "groups.refused" });
    expect(db.readGroup).not.toHaveBeenCalled();
    expect(db.setGroupPrimaryContact).not.toHaveBeenCalled();
  });
  it("Staff: group and membership proven on the REQUEST client, written on the SERVICE client, previous handed back", async () => {
    access.role = "staff";
    db.readGroup.mockResolvedValue({ id: G, kind: "household", name: "Garcia", billingAddress: null });
    db.readMembership.mockResolvedValue({ contactId: C, groupId: G });
    db.setGroupPrimaryContact.mockResolvedValue({ status: "ok", previous: MB });
    expect(await A.setGroupPrimaryContactAction("a1", G, M)).toEqual({ ok: true, previous: MB });
    expect(db.readGroup).toHaveBeenCalledWith(REQUEST, "a1", G);
    expect(db.readMembership).toHaveBeenCalledWith(REQUEST, "a1", M);
    expect(db.setGroupPrimaryContact).toHaveBeenCalledWith(SERVICE, "a1", G, M, "user_1");
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/accounts/a1/groups/${G}`);
  });
  it("a membership of ANOTHER group is refused (mutation: drop the groupId comparison -> written, FAILS)", async () => {
    access.role = "owner";
    db.readGroup.mockResolvedValue({ id: G, kind: "household", name: "Garcia", billingAddress: null });
    db.readMembership.mockResolvedValue({ contactId: C, groupId: MB });
    expect(await A.setGroupPrimaryContactAction("a1", G, M)).toEqual({ ok: false, error: "groups.refused" });
    expect(db.setGroupPrimaryContact).not.toHaveBeenCalled();
  });
  it("an Undo naming a membership that has gone is groups.failed and moves nothing (plan deviation 6)", async () => {
    access.role = "owner";
    db.readGroup.mockResolvedValue({ id: G, kind: "household", name: "Garcia", billingAddress: null });
    db.readMembership.mockResolvedValue(null);
    expect(await A.setGroupPrimaryContactAction("a1", G, M)).toEqual({ ok: false, error: "groups.failed" });
    expect(db.setGroupPrimaryContact).not.toHaveBeenCalled();
  });
  it("null clears, with no membership read", async () => {
    access.isAgency = true;
    db.readGroup.mockResolvedValue({ id: G, kind: "household", name: "Garcia", billingAddress: null });
    db.setGroupPrimaryContact.mockResolvedValue({ status: "ok", previous: M });
    expect(await A.setGroupPrimaryContactAction("a1", G, null)).toEqual({ ok: true, previous: M });
    expect(db.readMembership).not.toHaveBeenCalled();
    expect(db.setGroupPrimaryContact).toHaveBeenCalledWith(SERVICE, "a1", G, null, "user_1");
  });
  it("a bad id is refused before any read", async () => {
    access.role = "owner";
    expect(await A.setGroupPrimaryContactAction("a1", "nope", M)).toEqual({ ok: false, error: "groups.refused" });
    expect(await A.setGroupPrimaryContactAction("a1", G, "nope")).toEqual({ ok: false, error: "groups.refused" });
    expect(db.readGroup).not.toHaveBeenCalled();
  });
});

describe("S-03 part 2: a narrow caller's Undo restores the call-first flag only when THEIR removal held it (spec §10)", () => {
  beforeEach(() => { db.getContact.mockResolvedValue({ id: C }); db.restoreMembership.mockResolvedValue("ok"); });
  it("a snapshot claiming the flag, whose removal event lacks wasPrimaryContact, is restored WITHOUT it (mutation: pass the snapshot through -> FAILS)", async () => {
    events.data = [{ id: "e1", payload: { memberId: M, contactId: C, groupId: G } }];
    expect(await A.restoreMembershipAction("a1", { ...snap(), is_primary_contact: true } as never)).toEqual({ ok: true });
    expect(db.restoreMembership).toHaveBeenCalledWith(SERVICE, "a1", expect.objectContaining({ is_primary_contact: false }), "user_1");
  });
  it("the removal event saying wasPrimaryContact restores the flag", async () => {
    events.data = [{ id: "e1", payload: { memberId: M, contactId: C, groupId: G, wasPrimaryContact: true } }];
    await A.restoreMembershipAction("a1", { ...snap(), is_primary_contact: false } as never);
    expect(db.restoreMembership).toHaveBeenCalledWith(SERVICE, "a1", expect.objectContaining({ is_primary_contact: true }), "user_1");
  });
  it("Staff's snapshot passes through as it came (they may choose the call-first member anyway)", async () => {
    access.role = "staff";
    await A.restoreMembershipAction("a1", { ...snap(), is_primary_contact: true } as never);
    expect(db.restoreMembership).toHaveBeenCalledWith(SERVICE, "a1", expect.objectContaining({ is_primary_contact: true }), "user_1");
  });
});
```

The events chain mock (`:13-15`, `:46-48`) already answers `events.data`; the lookup's `.select("id")` becomes `.select("id, payload")`, which the chain mock accepts. Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/groups-actions.test.ts"` → the new cases fail (`setGroupPrimaryContactAction is not a function`; the restore cases with `expected … is_primary_contact: false`). Paste one line.

- [ ] **Step 2: Implement `groups-actions.ts`.** Import `setGroupPrimaryContact` from `@bis/db` (factory check: `groups-actions.test.ts` is the only factory reaching it; Step 1 added it). Add `const groupPath = (accountId: string, groupId: string) => \`/dashboard/accounts/${accountId}/groups/${groupId}\`;` under `contactsPath` (`:31`). Replace `removedByCaller` (`:195-203`) and the narrow branch of `restoreMembershipAction` (`:218-221`):

**Corrected 2026-10-13 (final review):** the snippet below is the shipped form. The first version matched ANY of
the caller's own removals (`.eq("actor_id", userId)`, unordered), so a Technician could replay an older removal
taken while the member held the flag after a newer removal by someone else (restore puts the row back under its
old id, so every earlier removal still matches). The NEWEST removal of that member, by any actor, decides both the
Undo and the flag. Its ids must be the stored lowercase ones on both sides: `removeMembership` records
`memberId: r.removed.id` (not the caller's string), the Business-name path records each membership it deletes
(`setContactsBusiness`, `undoSetBusiness`, commit `4fc64671`), and `restoreMembershipAction` lowercases the
snapshot's three ids before the lookup and the restore, because jsonb `@>` compares strings exactly while a uuid
cast ignores case (commit `8ae998f2`).

```ts
async function removedByCaller(
  accountId: string, userId: string, snapshot: GroupMemberSnapshot,   // snapshot's ids already lowercased
): Promise<{ found: boolean; wasPrimaryContact: boolean }> {
  const { data, error } = await serviceDb().from("events").select("id, actor_id, payload")
    .eq("account_id", accountId).eq("type", "client_group.member_removed")
    .contains("payload", { memberId: snapshot.id, contactId: snapshot.contact_id, groupId: snapshot.client_group_id })
    .gte("created_at", new Date(Date.now() - RESTORE_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .limit(1);
  if (error) throw new Error(`restore removal lookup failed: ${error.message}`);
  const newest = (data ?? [])[0] as { actor_id?: unknown; payload?: { wasPrimaryContact?: unknown } } | undefined;
  if (!newest || newest.actor_id !== userId) return { found: false, wasPrimaryContact: false };
  return { found: true, wasPrimaryContact: newest.payload?.wasPrimaryContact === true };
}
```

and at the top of `restoreMembershipAction`, after the uuid checks (the parameter is renamed `raw`):

```ts
  const snapshot: GroupMemberSnapshot = {
    ...raw, id: raw.id.toLowerCase(), contact_id: raw.contact_id.toLowerCase(), client_group_id: raw.client_group_id.toLowerCase(),
  };
```

and inside its `guarded` body:

```ts
    if (!(await getContact(await dbForRequest(), accountId, snapshot.contact_id))) return refuse(L, accountId, "contact not visible", ids);
    let toRestore: GroupMemberSnapshot = snapshot;
    if (!seesWholeAccount(access)) {
      const removal = await removedByCaller(accountId, userId, snapshot);
      if (!removal.found) return refuse(L, accountId, "not the caller's removal", ids);
      // S-03 part 2 (spec §10, C2): the snapshot is a claim from the browser. Who we call first comes
      // back only when the caller's own removal event recorded that this member held it.
      toRestore = { ...snapshot, is_primary_contact: removal.wasPrimaryContact };
    }
    const r = await restoreMembership(serviceDb(), accountId, toRestore, userId);
    if (r !== "ok") return refuse(L, accountId, r, ids);
    revalidateContacts(accountId, snapshot.contact_id);
    revalidatePath(groupPath(accountId, snapshot.client_group_id));
    return { ok: true };
```

In `removeMembershipAction` (`:166-179`) add `revalidatePath(groupPath(accountId, proven.groupId));` after `revalidateContacts`. Add the action after `setBillingAddressAction`:

```ts
/**
 * Who we call first in a household or business (S-03 part 2, migration 0075). Owner, Staff and the
 * agency only (C2: it decides who the whole group's Call reaches, and a group can hold customers a
 * Technician does not serve), refused before any read for a narrow caller. The group and, when given,
 * the membership are proven on the request client, then 0075's function writes on the service client.
 * `memberId` null clears (the Undo of a first choice). A manager sees every membership, so one that is
 * not there has gone since (an Undo's `previous`): that is "didn't save", not "you can't".
 */
export async function setGroupPrimaryContactAction(
  accountId: string, groupId: string, memberId: string | null,
): Promise<GroupResult<{ previous: string | null }>> {
  const access = await requireAccountAccess(accountId);
  const L = "setGroupPrimaryContactAction";
  const ids = memberId === null ? { group: groupId } : { group: groupId, member: memberId };
  if (!isUuid(groupId) || (memberId !== null && !isUuid(memberId))) return refuse(L, accountId, "bad input", ids);
  if (!seesWholeAccount(access)) return refuse(L, accountId, "not a manager", ids);
  return guarded<{ previous: string | null }>(L, accountId, async () => {
    const db = await dbForRequest();
    if (!(await readGroup(db, accountId, groupId))) return refuse(L, accountId, "group not visible", ids);
    if (memberId !== null) {
      const proven = await readMembership(db, accountId, memberId);
      if (!proven) {
        console.warn(`${L}: account ${accountId}: groups.failed (membership gone): member ${memberId}`);
        return failed;
      }
      if (proven.groupId !== groupId) return refuse(L, accountId, "membership of another group", ids);
    }
    const r = await setGroupPrimaryContact(serviceDb(), accountId, groupId, memberId, access.userId);
    if (r.status !== "ok") return failed;
    revalidatePath(groupPath(accountId, groupId));
    return { ok: true, previous: r.previous };
  });
}
```

Run the file → green. Run every probe in the new titles; paste each failing line.

- [ ] **Step 3: Failing places-action tests.** In `places-actions.test.ts`, add `readGroup: vi.fn()` to its `vi.mock("@bis/db", …)` factory (read the file first; it is the factory reaching `places-actions.ts`). Then, with `GR = "55555555-5555-4555-8555-555555555555"`:
  - `addPlaceAction(accountId, { kind: "group", id: GR }, fields)` reads `readGroup(REQUEST, accountId, GR)` and never `getContact`; with no owner named it calls `addPlace(REQUEST, accountId, { contactId: null, groupId: GR }, …, { subjectId: GR, subjectKind: "group", actorId })` (probe: default the owner to `{ contactId: subject }` for both kinds → FAILS).
  - With `readGroup` → null, every action given a group subject returns `places.refused` and writes nothing.
  - `updatePlaceFieldAction` on a group subject refuses a place owned by a CONTACT (even a member's) (probe: let `ownedByRecord` fall through to the contact branch → FAILS).
  - `setPlaceOwnerAction` with a group subject is `places.refused` before any read (C12: no "Move to" on the group page).
  - A malformed subject (`{ kind: "group", id: "nope" }`, `{ kind: "contact", id: GR }`, `42`) is `places.error.invalid` before any read.
  - Every existing case passes unchanged (a string subject is a contact).
  Run → red. Paste one line.

- [ ] **Step 4: Implement `places-actions.ts`.** Import `readGroup` from `@bis/db`. Replace `ctxFor`, `recordVisible`, `ownedByRecord` (`:70-93`) and add the subject parser:

```ts
/** C12 (S-03 part 2): the record an action is taken from is a contact (a uuid, as every caller has
 *  passed since 0071) or a group, on the group's own page. Parsed, never trusted: it came from a browser. */
export type PlaceSubjectArg = string | { kind: "group"; id: string };
type PlaceSubject = { kind: "contact" | "group"; id: string };
function subjectOf(raw: unknown): PlaceSubject | null {
  if (typeof raw === "string") return isUuid(raw) ? { kind: "contact", id: raw.toLowerCase() } : null;
  if (isRecord(raw) && raw.kind === "group" && isUuid(raw.id)) return { kind: "group", id: (raw.id as string).toLowerCase() };
  return null;
}
const ctxFor = (subject: PlaceSubject, access: { userId: string }): PlaceCtx =>
  ({ subjectId: subject.id, subjectKind: subject.kind, actorId: access.userId });

async function recordVisible(db: SupabaseClient, accountId: string, subject: PlaceSubject): Promise<boolean> {
  return subject.kind === "group"
    ? Boolean(await readGroup(db, accountId, subject.id))
    : Boolean(await getContact(db, accountId, subject.id));
}

/** The record's own: a contact's own place or one shared by its groups; a group's own place only. */
async function ownedByRecord(
  db: SupabaseClient, accountId: string, subject: PlaceSubject, owner: Pick<PlaceRow, "contact_id" | "client_group_id">,
): Promise<boolean> {
  if (subject.kind === "group") return owner.contact_id === null && owner.client_group_id?.toLowerCase() === subject.id;
  if (owner.contact_id !== null) return owner.contact_id.toLowerCase() === subject.id;
  if (owner.client_group_id !== null) return inGroup(db, accountId, subject.id, owner.client_group_id);
  return false;
}
```

`placeOnRecord` and `unitOnRecord` (`:97-106`) take `subject: PlaceSubject`. In each of the ten exported actions, the second parameter becomes `subjectArg: PlaceSubjectArg`, and the opening lines `if (!isUuid(subjectId) …) return invalid; const subject = subjectId.toLowerCase();` become `const subject = subjectOf(subjectArg); if (!subject || …) return invalid;` (keep each action's other checks, e.g. `|| !isUuid(placeId)`). In `addPlaceAction`, the default owner (`:116`) becomes `subject.kind === "group" ? { contactId: null, groupId: subject.id } : { contactId: subject.id, groupId: null }`. In `setPlaceOwnerAction`, after the parse: `if (subject.kind === "group") return refused;`. Run → green; probes by name.

- [ ] **Step 5: Failing route test** `apps/web/src/app/api/accounts/[accountId]/groups/[groupId]/places/route.test.ts`, modelled on the contact route's test (read `…/contacts/[contactId]/places/route.test.ts` if present, else `groups/route.test.ts`, for the mock shape): `apiAccountAccess` null → 404 with no read; a non-uuid `groupId` → 404 with no read; `readGroup` null → 404 and `listGroupPlaces` never called (probe: read the places first → FAILS); ready → 200 with `{ subject: { id: GR, firstName: null, lastName: null }, group: { id, kind, name }, groups: [], places (no created_by), … }`; `listGroupPlaces` throwing → 500, logged with the ids only. Run → red (module not found).
- [ ] **Step 6: Implement the route** `apps/web/src/app/api/accounts/[accountId]/groups/[groupId]/places/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readGroup, listGroupPlaces } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { accountToday } from "@/lib/contacts/account-today";
import type { PlacesResponse } from "../../../contacts/[contactId]/places/route";

export const dynamic = "force-dynamic";

function withoutAuthor<R extends { created_by: string | null }>(row: R): Omit<R, "created_by"> {
  const copy: Partial<R> = { ...row };
  delete copy.created_by;
  return copy as Omit<R, "created_by">;
}

/**
 * A group's Properties card read (S-03 part 2, C12): its own places only, on the request client, so
 * 0071's RLS decides (a Technician sees every place of a group one of their customers is in, by design).
 * The group read on the caller's client is the authorisation; a group they cannot see reads nothing.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ accountId: string; groupId: string }> }) {
  const { accountId, groupId: raw } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access || !isUuid(raw)) return NextResponse.json({}, { status: 404 });
  const groupId = raw.toLowerCase();
  const db = await dbForRequest(); // RLS-scoped: NEVER serviceDb here
  try {
    const group = await readGroup(db, accountId, groupId);
    if (!group) return NextResponse.json({}, { status: 404 });
    const [read, today] = await Promise.all([listGroupPlaces(db, accountId, groupId), accountToday(db, accountId)]);
    const body: PlacesResponse = {
      subject: { id: groupId, firstName: null, lastName: null },
      group: { id: group.id, kind: group.kind, name: group.name },
      today, groups: [],
      places: read.places.map(withoutAuthor), placeCount: read.placeCount,
      equipment: read.equipment.map(withoutAuthor), equipmentCount: read.equipmentCount,
    };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`group places read (account ${accountId}, group ${groupId}): ${loggableError(e)}`);
    return NextResponse.json({}, { status: 500 });
  }
}
```

In `…/contacts/[contactId]/places/route.ts` (`:17-25`) add to `PlacesResponse`: `/** S-03 part 2: present when the record is a group (its own route). */ group?: { id: string; kind: GroupKind; name: string };` with `type GroupKind` imported from `@bis/db`. In `lib/contacts/places-load.ts` (`:42-46`) add to `ok`: `&& (body.group === undefined || (isObj(body.group) && str(body.group.id) && (body.group.kind === "household" || body.group.kind === "business") && str(body.group.name)))`, with a parser test: a malformed `group` is the error state (probe: drop the clause → FAILS). Run → green.

- [ ] **Step 7: Run all touched tests by path, typecheck, eslint.** Then the service-read scan: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"` → green with no edit (the route names no service getter).
- [ ] **Step 8: Commit.**

```bash
git add -- "apps/web/src/app/api/accounts/[accountId]/groups/[groupId]/places/route.ts" "apps/web/src/app/api/accounts/[accountId]/groups/[groupId]/places/route.test.ts"
git commit -m "feat(contacts): choosing who we call first, an Undo that cannot forge it, and a group's own Properties read (S-03 part 2)" -- <every path above>
```

---

## Task 4: The generic registry, the group header helpers, the copy (bis-crm)

**Review:** sonnet. **messages.ts:** 2a's only editor; its step is last.

**Files**
- Modify: `apps/web/src/lib/record/record-cards.ts` (+ `record-cards.test.ts`)
- Modify: `apps/web/src/lib/record/header-actions.ts` (+ `header-actions.test.ts`)
- Create: `apps/web/src/lib/record/group-header.ts` (+ `group-header.test.ts`)
- Modify: `…/contacts/[contactId]/page.tsx:255` and `loading.tsx:28` (the `columnRuns(RECORD_CARDS)` call), `…/contacts/[contactId]/loading.test.ts:57,67`, `…/contacts/[contactId]/page.test.ts` (one new case)
- Modify: `apps/web/src/lib/messages.ts`

**Interfaces**
- Consumes: `RecordColumn` (`components/record/record-layout.tsx:4`), `RecordHeaderAction` (`record-header.tsx:5-7`), `Tr` (`lib/record/copy.ts:9-13`), `encodeCursor` (`lib/cursor.ts:45`), `mapUrl` (`lib/contacts/place-view.ts:31`), Task 2's `GroupMember`, `PlaceRow`.
- Produces:

```ts
// record-cards.ts
export type RecordCardDef<Id extends string = RecordCardId> = { id: Id; column: RecordColumn; deskOrder: number; phoneOrder: number;
  collapsibleOnPhone: boolean; titleKey: MessageKey; skeletonRows: number };
export const RECORD_CARDS: readonly RecordCardDef<RecordCardId>[];
export type GroupRecordCardId = "properties" | "deals" | "people" | "details";   // 2b adds "summary" | "next-up" | "timeline"
export const GROUP_RECORD_CARDS: readonly RecordCardDef<GroupRecordCardId>[];
export function cardsInPhoneOrder<Id extends string>(cards: readonly RecordCardDef<Id>[]): RecordCardDef<Id>[];
export function columnRuns<Id extends string>(cards: readonly RecordCardDef<Id>[]): { column: RecordColumn; cards: RecordCardDef<Id>[] }[];
// header-actions.ts: headerActions(input & { composeHref?: string })  // Text/Email href `${composeHref ?? ""}#compose-…`
// group-header.ts
export function memberName(p: { firstName: string | null; lastName: string | null }, tr: Tr): string;
export function memberFirstName(p: { firstName: string | null; lastName: string | null }, tr: Tr): string;
export function firstGroupMapUrl(groupPlaces: readonly PlaceRow[], primaryOwn: readonly PlaceRow[]): string | null;
export function groupHeaderActions(input: { accountId: string; primary: GroupMember | null; canText: boolean;
  directionsUrl: string | null; tr: Tr }): RecordHeaderAction[];
export function peoplePagerHrefs(p: { basePath: string; next: { v: string; id: string } | null; paged: boolean; locale?: unknown }):
  { moreHref: string | null; firstHref: string | null };
```

- [ ] **Step 1: Failing tests.** In `record-cards.test.ts`, change every `cardsInPhoneOrder()` / `columnRuns()` to pass `RECORD_CARDS`, then add:

```ts
describe("the group record page's cards (S-03 part 2, spec §7)", () => {
  it("ids are unique", () => {
    const ids = GROUP_RECORD_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("2a's phone order: what they have, then who they are (mutation: swap people's and properties' phoneOrder -> FAILS)", () => {
    expect(cardsInPhoneOrder(GROUP_RECORD_CARDS).map((c) => c.id)).toEqual(["properties", "deals", "people", "details"]);
    expect(columnRuns(GROUP_RECORD_CARDS).map((r) => r.column)).toEqual(["have", "who"]);
  });
  it("only Properties and Deals collapse on a phone", () => {
    expect(GROUP_RECORD_CARDS.filter((c) => c.collapsibleOnPhone).map((c) => c.id).sort()).toEqual(["deals", "properties"]);
  });
  it("every title has a key and a Spanish twin (mutation: delete groupPage.card.people.es -> FAILS naming people)", () => {
    const catalogue: Record<string, string | undefined> = m;
    for (const c of GROUP_RECORD_CARDS) {
      expect(m[c.titleKey], c.id).toBeTruthy();
      expect(catalogue[`${c.titleKey}.es`], `${c.id}: ${c.titleKey}.es`).toBeTruthy();
    }
  });
  it("the contact list's runs are unchanged by the generic (mutation: make columnRuns ignore its argument and read GROUP_RECORD_CARDS -> FAILS)", () => {
    expect(columnRuns(RECORD_CARDS).map((r) => [r.column, r.cards.map((c) => c.id)])).toEqual([
      ["happening", ["summary", "next-up", "timeline"]],
      ["have", ["groups", "properties", "deals"]],
      ["who", ["details", "tags", "related-people"]],
    ]);
  });
});
```

In `header-actions.test.ts` add: with `composeHref: "/dashboard/accounts/a1/contacts/c9"`, Text is `/dashboard/accounts/a1/contacts/c9#compose-sms` and Email `…#compose-email`; without it, today's `#compose-sms` (probe: always prefix → the contact page's case FAILS).

Create `group-header.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTr } from "./copy";
import { groupHeaderActions, firstGroupMapUrl, memberName, memberFirstName, peoplePagerHrefs } from "./group-header";
import type { GroupMember, PlaceRow } from "@bis/db";

const tr = makeTr("en");
const ana: GroupMember = { memberId: "m1", contactId: "c1", firstName: "Ana", lastName: "García", phone: "+19565550100",
  email: "ana@example.com", role: null, isBilling: false, isPrimaryContact: true, joinedAt: "2026-10-01T00:00:00Z" };
const place = (over: Partial<PlaceRow>): PlaceRow => ({ id: "p", account_id: "a1", contact_id: null, client_group_id: "g1", label: null,
  address: null, landmark: null, directions: null, city: null, region: null, postal_code: null, country: null, archived_at: null,
  created_by: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...over });

describe("the group header (spec §8.1, D4, C14)", () => {
  it("Call, Text and Email go to the call-first member and name them; Call is the only primary (mutation: make Text primary -> FAILS)", () => {
    const a = groupHeaderActions({ accountId: "a1", primary: ana, canText: true, directionsUrl: null, tr });
    expect(a.map((x) => [x.id, x.label, x.href, Boolean(x.primary)])).toEqual([
      ["call", "Call Ana", "tel:+19565550100", true],
      ["text", "Text Ana", "/dashboard/accounts/a1/contacts/c1#compose-sms", false],
      ["email", "Email Ana", "/dashboard/accounts/a1/contacts/c1#compose-email", false],
    ]);
  });
  it("no visible call-first member: no Call, Text or Email, Directions stays (mutation: fall back to the first member -> FAILS)", () => {
    const a = groupHeaderActions({ accountId: "a1", primary: null, canText: true, directionsUrl: "https://maps.example/x", tr });
    expect(a.map((x) => x.id)).toEqual(["directions"]);
  });
  it("the label uses the display name when there is no first name, and Spanish says 'Mandar texto a'", () => {
    const es = makeTr("es");
    const noFirst = { ...ana, firstName: null };
    expect(groupHeaderActions({ accountId: "a1", primary: noFirst, canText: true, directionsUrl: null, tr: es }).map((x) => x.label))
      .toEqual(["Llamar a García", "Mandar texto a García", "Mandar correo a García"]);
    expect(memberFirstName({ firstName: null, lastName: null }, es)).toBe("(sin nombre)");
    expect(memberName({ firstName: "Ana", lastName: "García" }, tr)).toBe("Ana García");
  });
  it("Directions takes the group's first active addressed place before the call-first member's own (mutation: swap the two lists -> FAILS)", () => {
    const shared = place({ id: "p1", address: "1 Main St" });
    const removed = place({ id: "p0", address: "9 Gone St", archived_at: "2026-10-02T00:00:00Z" });
    const own = place({ id: "p2", contact_id: "c1", client_group_id: null, address: "2 Oak St" });
    expect(firstGroupMapUrl([removed, shared], [own])).toContain(encodeURIComponent("1 Main St"));
    expect(firstGroupMapUrl([removed], [own])).toContain(encodeURIComponent("2 Oak St"));
    expect(firstGroupMapUrl([], [])).toBeNull();
  });
  it("People's pager: More carries ?people=, Back to the start only when paged, and only ?locale= is kept", () => {
    const h = peoplePagerHrefs({ basePath: "/g", next: { v: "2026-10-01T00:00:00Z", id: "11111111-1111-4111-8111-111111111111" }, paged: true, locale: "es" });
    expect(h.moreHref).toMatch(/^\/g\?locale=es&people=[\w-]+#group-people$/);
    expect(h.firstHref).toBe("/g?locale=es#group-people");
    expect(peoplePagerHrefs({ basePath: "/g", next: null, paged: false, locale: "<x>" })).toEqual({ moreHref: null, firstHref: null });
  });
});
```

Add to the contact `page.test.ts`, beside the header case at `:785-799`:

```ts
  it("the group line uses S-02's kind words: a business reads 'Business customer', and Spanish 'Familia' / 'Cliente comercial' (R3; mutation: leave 'Negocio' -> FAILS)", async () => {
    listContactPlacesMock.mockResolvedValue({ ...NO_PLACES, groups: [{ id: "g2", kind: "business", name: "Acme", isPrimary: true }] });
    expect(await render()).toMatch(/data-record-subtitle[^>]*>Acme · Business customer</);
    prefsMock.mockResolvedValue({ language: "es", theme: null });
    expect(await render()).toMatch(/data-record-subtitle[^>]*>Acme · Cliente comercial</);
    listContactPlacesMock.mockResolvedValue({ ...NO_PLACES, groups: [{ id: "g1", kind: "household", name: "García", isPrimary: true }] });
    expect(await render()).toMatch(/data-record-subtitle[^>]*>García · Familia</);
  });
```

(Read the file's `beforeEach` around the header case first: `prefsMock` and `listContactPlacesMock` must be reset by it; if not, reset them at this case's end.) Run all four files → red.

- [ ] **Step 2: Implement `record-cards.ts`:**

```ts
import type { RecordColumn } from "@/components/record/record-layout";
import type { MessageKey } from "@/lib/messages";

export type RecordCardId =
  | "summary" | "next-up" | "timeline" | "groups" | "properties" | "deals" | "details" | "tags" | "related-people";
/** The household and business page's cards (S-03 part 2, spec §7). 2b adds the three middle cards. */
export type GroupRecordCardId = "properties" | "deals" | "people" | "details";

/** One core card of a record page (spec §8). The page binds each id to its body: a card with no body is a compile error. */
export type RecordCardDef<Id extends string = RecordCardId> = {
  id: Id; column: RecordColumn; deskOrder: number; phoneOrder: number;
  collapsibleOnPhone: boolean; titleKey: MessageKey; skeletonRows: number;
};

/** The spec's §8 table, verbatim. Packs (later modules) add rows here, never pages. */
export const RECORD_CARDS: readonly RecordCardDef<RecordCardId>[] = [
  // … the nine rows exactly as they are today (:15-23), unchanged …
];

/** S-03 part 2 §7: what they have (closed on a phone), then who they are. The phone numbers leave 1-3 to 2b's middle column. */
export const GROUP_RECORD_CARDS: readonly RecordCardDef<GroupRecordCardId>[] = [
  { id: "properties", column: "have", deskOrder: 1, phoneOrder: 4, collapsibleOnPhone: true, titleKey: "places.title", skeletonRows: 2 },
  { id: "deals", column: "have", deskOrder: 2, phoneOrder: 5, collapsibleOnPhone: true, titleKey: "record.card.deals", skeletonRows: 2 },
  { id: "people", column: "who", deskOrder: 1, phoneOrder: 6, collapsibleOnPhone: false, titleKey: "groupPage.card.people", skeletonRows: 3 },
  { id: "details", column: "who", deskOrder: 2, phoneOrder: 7, collapsibleOnPhone: false, titleKey: "groupPage.card.details", skeletonRows: 3 },
];

export function cardsInPhoneOrder<Id extends string>(cards: readonly RecordCardDef<Id>[]): RecordCardDef<Id>[] {
  return [...cards].sort((a, b) => a.phoneOrder - b.phoneOrder);
}

/** Consecutive same-column runs in phone order: the DOM order RecordLayout renders (C6). */
export function columnRuns<Id extends string>(cards: readonly RecordCardDef<Id>[]): { column: RecordColumn; cards: RecordCardDef<Id>[] }[] {
  const runs: { column: RecordColumn; cards: RecordCardDef<Id>[] }[] = [];
  for (const card of cardsInPhoneOrder(cards)) {
    const last = runs.at(-1);
    if (last && last.column === card.column) last.cards.push(card);
    else runs.push({ column: card.column, cards: [card] });
  }
  return runs;
}
```

Update the three callers: `…/contacts/[contactId]/page.tsx:255` and `loading.tsx:28` → `columnRuns(RECORD_CARDS)` (import `RECORD_CARDS`), `loading.test.ts:57,67` → `cardsInPhoneOrder(RECORD_CARDS)` (import it beside).

- [ ] **Step 3: Implement `header-actions.ts`.** `headerActions`' input gains `composeHref?: string`; Text's href becomes `` `${input.composeHref ?? ""}#compose-sms` `` and Email's `` `${input.composeHref ?? ""}#compose-email` ``. Doc comment: "`composeHref`: the record whose composer Text and Email open; absent, this page's own (the group page sends them to the call-first member's, S-03 part 2 §8.1)."
- [ ] **Step 4: Implement `group-header.ts`:**

```ts
import type { GroupMember, PlaceRow } from "@bis/db";
import type { RecordHeaderAction } from "@/components/record/record-header";
import { encodeCursor } from "@/lib/cursor";
import { mapUrl } from "@/lib/contacts/place-view";
import { headerActions, type HeaderActionId } from "./header-actions";
import type { Tr } from "./copy";

/** A member's name in the PAGE's language: contactDisplayName reads the English catalogue (lib/format.ts:119-124). */
export function memberName(p: { firstName: string | null; lastName: string | null }, tr: Tr): string {
  return [p.firstName, p.lastName].filter((s): s is string => Boolean(s && s.trim())).join(" ") || tr.text("contact.noName");
}
/** "Call Ana": the first name, else the whole display name (spec §8.1). */
export function memberFirstName(p: { firstName: string | null; lastName: string | null }, tr: Tr): string {
  return p.firstName?.trim() || memberName(p, tr);
}

/** D4: the group's first ACTIVE addressed place, in the read's order, else the call-first member's own first. */
export function firstGroupMapUrl(groupPlaces: readonly PlaceRow[], primaryOwn: readonly PlaceRow[]): string | null {
  for (const list of [groupPlaces, primaryOwn]) {
    for (const p of list) {
      if (p.archived_at) continue;
      const url = mapUrl(p);
      if (url) return url;
    }
  }
  return null;
}

const LABEL = {
  call: "groupPage.action.call", text: "groupPage.action.text", email: "groupPage.action.email", directions: "record.action.directions",
} as const satisfies Record<HeaderActionId, string>;

/**
 * The group header's actions (spec §8.1): Call (the ONE primary), Text and Email go to the call-first
 * member and name them; with none visible, all three are hidden (D4; part 1 D3: an action with
 * nothing behind it is hidden) and Directions still shows. `canText` is C14's gate, decided by the page.
 */
export function groupHeaderActions(input: {
  accountId: string; primary: GroupMember | null; canText: boolean; directionsUrl: string | null; tr: Tr;
}): RecordHeaderAction[] {
  const p = input.primary;
  const actions = headerActions({
    phone: p?.phone ?? null, email: p?.email ?? null, canText: p !== null && input.canText, directionsUrl: input.directionsUrl,
    composeHref: p ? `/dashboard/accounts/${input.accountId}/contacts/${p.contactId}` : undefined,
  });
  const name = p ? memberFirstName(p, input.tr) : "";
  return actions.map((a) => ({ ...a, label: a.id === "directions" ? input.tr.text(LABEL.directions) : input.tr.text(LABEL[a.id], { name }) }));
}

/** People's anchor, so its pager lands on the card. */
export const PEOPLE_ANCHOR = "group-people";
const QA_LOCALES = new Set(["en", "es", "pseudo"]);

/** People's one pager (C10): "More people" carries ?people=, "Back to the start" drops it. Only ?locale= is kept (plan deviation 14). */
export function peoplePagerHrefs(p: {
  basePath: string; next: { v: string; id: string } | null; paged: boolean; locale?: unknown;
}): { moreHref: string | null; firstHref: string | null } {
  const keep: Record<string, string> = typeof p.locale === "string" && QA_LOCALES.has(p.locale) ? { locale: p.locale } : {};
  const href = (extra: Record<string, string>) => {
    const qs = new URLSearchParams({ ...keep, ...extra }).toString();
    return `${p.basePath}${qs ? `?${qs}` : ""}#${PEOPLE_ANCHOR}`;
  };
  return { moreHref: p.next ? href({ people: encodeCursor(p.next) }) : null, firstHref: p.paged ? href({}) : null };
}
```

- [ ] **Step 5 (LAST code step): messages.ts.** Directly under `contact.noName` (`:721`): `"contact.noName.es": "(sin nombre)",`. Change `record.group.household.es` (`:3763`) to `"{group} · Familia"`, `record.group.business` (`:3764`) to `"{group} · Business customer"`, `record.group.business.es` (`:3765`) to `"{group} · Cliente comercial"`. Above `} as const;` (`:3892`):

```ts
  // S-03 part 2 (PR 2a): the household and business record page. Words verbatim from the spec's §9.1.
  "groupPage.action.call": "Call {name}",
  "groupPage.action.call.es": "Llamar a {name}",
  "groupPage.action.text": "Text {name}",
  "groupPage.action.text.es": "Mandar texto a {name}",
  "groupPage.action.email": "Email {name}",
  "groupPage.action.email.es": "Mandar correo a {name}",
  "groupPage.card.people": "People",
  "groupPage.card.people.es": "Personas",
  "groupPage.card.details": "Details",
  "groupPage.card.details.es": "Datos",
  "groupPage.details.type": "Type",
  "groupPage.details.type.es": "Tipo",
  "groupPage.people.primaryContact": "Primary contact",
  "groupPage.people.primaryContact.es": "Contacto principal",
  "groupPage.people.makePrimaryContact": "Make primary contact",
  "groupPage.people.makePrimaryContact.es": "Hacer contacto principal",
  "groupPage.people.primaryContactSet": "{name} is now the primary contact.",
  "groupPage.people.primaryContactSet.es": "{name} ahora es el contacto principal.",
  "groupPage.people.choosePrimary": "Choose who we call first.",
  "groupPage.people.choosePrimary.es": "Elija a quién llamamos primero.",
  "groupPage.people.removed": "Removed {name} from this group.",
  "groupPage.people.removed.es": "Se quitó a {name} de este grupo.",
  "groupPage.people.emptyHousehold": "No one in this household yet. Add someone from their own page.",
  "groupPage.people.emptyHousehold.es": "Todavía no hay nadie en esta familia. Agregue a alguien desde su propia página.",
  "groupPage.people.emptyBusiness": "No one at this business yet. Add someone from their own page.",
  "groupPage.people.emptyBusiness.es": "Todavía no hay nadie en este negocio. Agregue a alguien desde su propia página.",
  "groupPage.people.more": "More people",
  "groupPage.people.more.es": "Más personas",
  "groupPage.people.first": "Back to the start",
  "groupPage.people.first.es": "Volver al inicio",
  "groupPage.people.pages": "People pages",
  "groupPage.people.pages.es": "Páginas de personas",
  "groupPage.places.emptyHousehold": "Homes this household shares show up here, with how to get there and the equipment on site.",
  "groupPage.places.emptyHousehold.es": "Aquí aparecen las casas que comparte esta familia, con cómo llegar y el equipo que hay.",
  "groupPage.places.emptyBusiness": "Job sites of this business show up here, with how to get there and the equipment on site.",
  "groupPage.places.emptyBusiness.es": "Aquí aparecen los lugares de trabajo de este negocio, con cómo llegar y el equipo que hay.",
  "groupPage.deals.empty": "No open deals with these people. Deals added on a person's page show here.",
  "groupPage.deals.empty.es": "No hay oportunidades abiertas con estas personas. Aquí aparecen las que se agregan en la página de una persona.",
  "groupPage.deals.more": "Showing {shown} of {count} open deals.",
  "groupPage.deals.more.es": "Se muestran {shown} de {count} oportunidades abiertas.",
```

- [ ] **Step 6: Green.** `pnpm --filter web exec vitest run src/lib/record/record-cards.test.ts src/lib/record/header-actions.test.ts src/lib/record/group-header.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/loading.test.ts" src/lib/messages.test.ts src/lib/i18n/ratchet.test.ts` → all green; `record-header.test.ts:6` and `page.test.ts:798` still pass (they assert the household's English, unchanged). Typecheck, eslint. Probes by name.
- [ ] **Step 7: Commit.**

```bash
git add -- apps/web/src/lib/record/group-header.ts apps/web/src/lib/record/group-header.test.ts
git commit -m "feat(contacts): the group page's card list, header actions to the call-first member, and S-02's kind words on the contact header (S-03 part 2)" -- <every path above>
```

---

## Task 5: The Properties card with a group subject (bis-frontend)

**Review:** sonnet.

**Files**
- Modify: `…/contacts/places-card.tsx`, `place-dialog.tsx`, `equipment-dialog.tsx`, `places-card-handlers.ts`
- Modify tests: `…/contacts/places-card.test.ts`, `places-card.handlers.test.ts` (corrected 2026-10-13 (final review): `places-card.owner.test.ts` was listed but needed no change and was not touched)

**Interfaces**
- Consumes: Task 3's `PlaceSubjectArg` (`places-actions.ts`), `PlacesResponse.group`, the route `/api/accounts/{a}/groups/{g}/places`; Task 4's `groupPage.places.empty*` keys.
- Produces: `PlacesCard({ accountId, contactId?, group?, canMovePlace, headingHidden?, emptyText? })` — exactly one of `contactId` / `group`; `PlacesCardView` gains `emptyText?: string` and its `contactId` widens to `PlaceSubjectArg`.

- [ ] **Step 1: Failing tests** (in `places-card.test.ts`, render `PlacesCardView` with a group-shaped READY load):
  - With `load.data.group = { id: "g1", kind: "household", name: "García" }`, `contactId={ kind: "group", id: "g1" }` and `emptyText="Homes this household shares…"`, no places: the empty line is that text, not `places.empty` (probe: ignore `emptyText` → FAILS).
  - The add dialog's subject name is the group's ("García"), not "This customer" (probe: build the subject from first/last name only → FAILS). Read how `places-card.test.ts` inspects `PlaceDialog`'s props first (mock or rendered text) and use the same idiom.
  - With `canMovePlace={false}` no owner select renders (unchanged rule; the group page always passes false).
  - `placeHandlers({ accountId, contactId: { kind: "group", id: "g1" }, … }).removePlace("p1", "The house")` calls `removePlaceAction("a1", { kind: "group", id: "g1" }, "p1")` (probe: stringify the subject → FAILS).
  - `PlacesCard` with `group` fetches `/api/accounts/a1/groups/g1/places`; with `contactId`, today's URL (read how the existing tests stub `fetch`; if none renders `PlacesCard` itself, test the URL through a small exported pure `placesRouteFor(accountId, contactId, group)` added to `places-card.tsx`, probe: always the contact URL → FAILS).
  Run → red.
- [ ] **Step 2: Implement.** In `places-card.tsx`: import `type PlaceSubjectArg` from `./places-actions` and `type GroupKind` from `@bis/db`. `Ctx.contactId` becomes `PlaceSubjectArg` (doc: "a contact id, or `{ kind: 'group', id }` on a group's own page (S-03 part 2, C12)"), and so does `PlacesCardView`'s `contactId` prop; `PlacesCardView` gains `emptyText?: string`, passed to `ReadyBody`, whose empty line becomes `{ctx.emptyText ?? ctx.tt("places.empty")}` (add `emptyText?: string` to `Ctx`). The subject (`:298-300`) becomes:

```tsx
  const subject = ready
    ? ready.group
      ? { id: ready.group.id, name: ready.group.name }
      : { id: ready.subject.id, name: [ready.subject.firstName, ready.subject.lastName].filter(Boolean).join(" ") || tt("places.thisCustomer") }
    : null;
```

Add, and use in `PlacesCard`'s effect:

```tsx
/** The card's own read: a contact's route, or (S-03 part 2) the group's. */
export function placesRouteFor(accountId: string, contactId: string | undefined, group: { id: string } | undefined): string {
  return group ? `/api/accounts/${accountId}/groups/${group.id}/places` : `/api/accounts/${accountId}/contacts/${contactId}/places`;
}
```

`PlacesCard`'s props become `{ accountId: string; canMovePlace: boolean; headingHidden?: boolean; emptyText?: string } & ({ contactId: string; group?: undefined } | { contactId?: undefined; group: { id: string; kind: GroupKind; name: string } })`; inside, `const key = props.group ? \`group:${props.group.id}\` : props.contactId!;` replaces `contactId` in the paired state (`:360-375`), `const subjectArg: PlaceSubjectArg = props.group ? { kind: "group", id: props.group.id } : props.contactId!;` is what `placeHandlers` and `PlacesCardView` receive, and the effect depends on `[accountId, key, nonce]`. In `place-dialog.tsx`, `equipment-dialog.tsx` and `places-card-handlers.ts`, widen `contactId: string` to `contactId: PlaceSubjectArg` (same doc line); no other change: each passes it straight to an action. `PlaceDialog`'s owner default `contact:${subject.id}` (`:43`) is unused when `owners` is null, which it always is on the group page (`canMovePlace` false, `groups: []`).
- [ ] **Step 3: Green.** The three places test files, `places-demo.test.ts`, `contact-drawer.wiring.test.ts`, the contact `page.test.ts`; typecheck; eslint. Probes by name.
- [ ] **Step 4: Commit** `feat(contacts): the Properties card reads and writes a household's or business's own places (S-03 part 2)` with every path.

---

## Task 6: People and Details (bis-crm)

**Review:** sonnet.

**Files**
- Create: `…/groups/people-handlers.ts` (+ `people-handlers.test.ts`)
- Create: `…/groups/people-card.tsx` (+ `people-card.test.ts`)
- Create: `…/groups/details-card.tsx` (+ `details-card.test.ts`)

**Interfaces**
- Consumes: Task 3's `setGroupPrimaryContactAction`; `setRoleAction`, `setBillingAction`, `removeMembershipAction`, `restoreMembershipAction`, `renameGroupAction`, `setBillingAddressAction` (`groups-actions.ts:123-269`, `GroupResult`, `GroupActionError`); `InlineField` (`components/inline-field.tsx:78`; `field="source"`, `undoWith`, `placeholder`, `locale`); Task 4's `memberName`, `peoplePagerHrefs`, `PEOPLE_ANCHOR`, the `groupPage.*` keys; `t` (`lib/i18n/t.ts:36`); `useLocale`.
- Produces:

```ts
// people-handlers.ts
export function groupErrorText(e: unknown, locale: Locale): string;
export function peopleHandlers(p: { accountId: string; groupId: string; locale: Locale; onChanged: () => void }): {
  makePrimaryContact(member: { memberId: string; name: string }): Promise<boolean>;
  remove(member: { memberId: string; name: string }): Promise<boolean>;
  toggleBilling(member: { memberId: string; isBilling: boolean }): Promise<boolean>;
  roleSave(memberId: string): (v: string) => Promise<{ ok: true; undoPayload?: unknown } | { ok: false; error: string }>;
  roleUndo(memberId: string): (prev: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
};
// people-card.tsx (client)
export type PeopleRow = { memberId: string; contactId: string; name: string; role: string | null; isBilling: boolean; isPrimaryContact: boolean };
export function PeopleCardView(p: { accountId: string; groupId: string; kind: GroupKind; manager: boolean;
  primary: PeopleRow | null; rows: PeopleRow[]; paged: boolean; pager: { moreHref: string | null; firstHref: string | null };
  handlers: ReturnType<typeof peopleHandlers> }): JSX.Element;
export function PeopleCard(props: Omit<Parameters<typeof PeopleCardView>[0], "handlers">): JSX.Element; // builds handlers, router.refresh()
// details-card.tsx (client)
export function DetailsCardView(p: { accountId: string; groupId: string; name: string; kind: GroupKind; billingAddress: string | null;
  manager: boolean; onChanged: () => void }): JSX.Element;
export function DetailsCard(props: Omit<Parameters<typeof DetailsCardView>[0], "onChanged">): JSX.Element;
```

- [ ] **Step 1: Failing handler tests** `people-handlers.test.ts` (the `groups-card.test.ts:7-15` mock shape: `vi.mock("../../contacts/groups-actions", …)` with `setGroupPrimaryContactAction` added, `vi.mock("sonner", …)`):

```ts
it("Make primary contact: toast names the person in the reader's language, and its Undo sends the server's previous back (spec §5; mutation: Undo with null always -> FAILS)", async () => {
  vi.mocked(actions.setGroupPrimaryContactAction).mockResolvedValue({ ok: true, previous: "m0" });
  const onChanged = vi.fn();
  const h = peopleHandlers({ accountId: "a1", groupId: "g1", locale: "es", onChanged });
  expect(await h.makePrimaryContact({ memberId: "m1", name: "Ana García" })).toBe(true);
  expect(actions.setGroupPrimaryContactAction).toHaveBeenCalledWith("a1", "g1", "m1");
  const [text, opts] = vi.mocked(toast.success).mock.calls[0]!;
  expect(text).toBe("Ana García ahora es el contacto principal.");
  await (opts as { action: { onClick: () => Promise<void> } }).action.onClick();
  expect(actions.setGroupPrimaryContactAction).toHaveBeenLastCalledWith("a1", "g1", "m0");
  expect(onChanged).toHaveBeenCalledTimes(2);
});
it("a first choice's Undo clears (previous null)", async () => { /* previous: null → Undo calls (a1, g1, null) */ });
it("an Undo whose previous has gone shows 'That didn't save. Try again.' (groups.failed)", async () => { /* Undo answers { ok: false, error: "groups.failed" } → toast.error(m["groups.failed"]) */ });
it("Remove: 'Removed {name} from this group.' with an Undo that restores the server's snapshot", async () => { /* removeMembershipAction → { ok: true, removed: SNAP }; Undo → restoreMembershipAction("a1", SNAP) */ });
it("a rejected action (a stale tab) is a toast, never a throw", async () => { /* mockRejectedValue → toast.error(groups.failed in locale), returns false */ });
```

Write each body in full (the comments name exactly what to assert). Run → red.
- [ ] **Step 2: Implement `people-handlers.ts`.** The same `runGroupWrite`/`runUndo` shape as `groups-card.tsx:76-104`, but every string through `t(m, key, locale, params)`:

```ts
import { toast } from "sonner";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import {
  setGroupPrimaryContactAction, removeMembershipAction, restoreMembershipAction, setBillingAction, setRoleAction,
  type GroupActionError, type GroupResult,
} from "../../contacts/groups-actions";

/**
 * People's writes (S-03 part 2, §8.2): the Groups card's own actions (C3), its toasts in the READER's
 * language (the Groups card's are English, groups spec §8). Every Undo writes what the SERVER handed
 * back, never a value captured here (groups-card.tsx's rule). A rejected action is a toast, not a throw.
 */
const ERROR_KEYS: readonly GroupActionError[] = ["groups.refused", "groups.failed", "groups.nameTaken", "groups.tooLong"];
export function groupErrorText(e: unknown, locale: Locale): string {
  return t(m, ERROR_KEYS.includes(e as GroupActionError) ? (e as GroupActionError) : "groups.failed", locale);
}

type Undo = () => Promise<GroupResult>;

export function peopleHandlers({ accountId, groupId, locale, onChanged }: {
  accountId: string; groupId: string; locale: Locale; onChanged: () => void;
}) {
  const failed = () => toast.error(t(m, "groups.failed", locale));
  async function runUndo(undo: Undo) {
    try {
      const r = await undo();
      if (!r.ok) { toast.error(groupErrorText(r.error, locale)); return; }
      onChanged();
    } catch { failed(); }
  }
  async function write<T extends object>(run: () => Promise<GroupResult<T>>, success: (r: T) => string, undo?: (r: T) => Undo): Promise<boolean> {
    let r: GroupResult<T>;
    try { r = await run(); } catch { failed(); return false; }
    if (!r.ok) { toast.error(groupErrorText(r.error, locale)); return false; }
    onChanged();
    const u = undo?.(r);
    if (u) toast.success(success(r), { action: { label: t(m, "common.undo", locale), onClick: () => runUndo(u) } });
    else toast.success(success(r));
    return true;
  }
  return {
    makePrimaryContact: (member: { memberId: string; name: string }) =>
      write(() => setGroupPrimaryContactAction(accountId, groupId, member.memberId),
        () => t(m, "groupPage.people.primaryContactSet", locale, { name: member.name }),
        (r) => () => setGroupPrimaryContactAction(accountId, groupId, r.previous)),
    remove: (member: { memberId: string; name: string }) =>
      write(() => removeMembershipAction(accountId, member.memberId),
        () => t(m, "groupPage.people.removed", locale, { name: member.name }),
        (r) => () => restoreMembershipAction(accountId, r.removed)),
    toggleBilling: (member: { memberId: string; isBilling: boolean }) =>
      write(() => setBillingAction(accountId, member.memberId, !member.isBilling),
        () => t(m, "groups.saved", locale),
        (r) => () => setBillingAction(accountId, member.memberId, r.previous)),
    roleSave: (memberId: string) => async (v: string) => {
      let r: GroupResult<{ previous: string | null }>;
      try { r = await setRoleAction(accountId, memberId, v === "" ? null : v); } catch { return { ok: false as const, error: t(m, "groups.failed", locale) }; }
      if (!r.ok) return { ok: false as const, error: groupErrorText(r.error, locale) };
      onChanged();
      return { ok: true as const, undoPayload: r.previous };
    },
    roleUndo: (memberId: string) => async (prev: unknown) => {
      let r: GroupResult;
      try { r = await setRoleAction(accountId, memberId, (prev as string | null) ?? null); } catch { return { ok: false as const, error: t(m, "groups.failed", locale) }; }
      if (!r.ok) return { ok: false as const, error: groupErrorText(r.error, locale) };
      onChanged();
      return { ok: true as const };
    },
  };
}
```

Green.
- [ ] **Step 3: Failing card tests** `people-card.test.ts` (render `PeopleCardView` under `LocaleProvider`; `handlers` are `vi.fn()`s):
  - Rows: the pinned primary first with the dot-and-word "Primary contact" (`data-people-mark="primary-contact"`, a dot `bg-[var(--accent)]` plus the word), then the rest; each name is a link to `/dashboard/accounts/a1/contacts/<id>` (`data-people-name`), the row itself is not a link.
  - A manager: every non-primary row has "Make primary contact" and every row "Remove from this group" (ghost; `aria-label` "Remove from this group: {name}"); none is `data-variant="default"` (rule 8: the header's Call is the page's one primary).
  - A narrow reader (`manager={false}`): no "Make primary contact", no "Remove from this group", no prompt; role and Pays the bills still render (probe: render the actions regardless of `manager` → FAILS).
  - The prompt "Choose who we call first." renders for a manager with rows and no primary, never for a narrow reader, never when `paged` (probe: show it to everyone → the narrow case FAILS).
  - Pager: "More people" with `moreHref`, "Back to the start" with `firstHref`, inside one `nav[aria-label="People pages"]` at the card's foot; neither when both null.
  - Empty (no primary, no rows, not paged): household "No one in this household yet. Add someone from their own page.", business the business sentence (probe: one sentence for both kinds → the business case FAILS).
  - Spanish: under `locale="es"`, "Contacto principal", "Hacer contacto principal", "Quitar de este grupo", "Paga las cuentas"; the root carries `lang="es"`.
  - No JSX literal copy (the ratchet test covers new files; run it).
  `details-card.test.ts`: a manager gets two `InlineField`s (name with `undoWith`, billing address) and the type as text (the kind word, never editable); a narrow reader gets all three as text (probe: render the editors for everyone → FAILS); Spanish labels "Nombre del grupo", "Tipo", "Dirección de cobro".
  Run → red.
- [ ] **Step 4: Implement `people-card.tsx`** (`"use client"`), the row markup modelled on `groups-card.tsx:271-330` (read it), all copy via `t(m, key, locale)`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GroupKind } from "@bis/db";
import { Button, buttonVariants } from "@/components/ui/button";
import { InlineField } from "@/components/inline-field";
import { useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { PEOPLE_ANCHOR } from "@/lib/record/group-header";
import { peopleHandlers } from "./people-handlers";

export type PeopleRow = { memberId: string; contactId: string; name: string; role: string | null; isBilling: boolean; isPrimaryContact: boolean };
type Handlers = ReturnType<typeof peopleHandlers>;

const focus = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const rowLine = "border-t border-[var(--row-line)] first:border-t-0";

/**
 * People (S-03 part 2, §8.2): the call-first member pinned first (C10), then everyone in the order
 * they joined, 30 a page, one pager at the foot. A row holds inline fields, so it is not a row-click
 * table: the NAME is the link to that person's page. Owner, Staff and the agency choose who we call
 * first and remove; a Technician edits role and Pays the bills on their own customers' rows (C2, C3).
 */
export function PeopleCardView(p: {
  accountId: string; groupId: string; kind: GroupKind; manager: boolean; primary: PeopleRow | null; rows: PeopleRow[];
  paged: boolean; pager: { moreHref: string | null; firstHref: string | null }; handlers: Handlers;
}) {
  const locale = useLocale();
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  const shown = !p.paged && p.primary ? [p.primary, ...p.rows] : p.rows;
  if (shown.length === 0 && !p.paged) {
    return <p data-people-empty lang={locale} className="text-sm text-muted-foreground">
      {tt(p.kind === "household" ? "groupPage.people.emptyHousehold" : "groupPage.people.emptyBusiness")}</p>;
  }
  return (
    <div id={PEOPLE_ANCHOR} lang={locale} className="scroll-mt-4 space-y-2">
      {p.manager && !p.paged && !p.primary && shown.length > 0
        ? <p data-people-prompt className="text-sm text-card-foreground">{tt("groupPage.people.choosePrimary")}</p> : null}
      <ul className="flex flex-col">
        {shown.map((row) => (
          <PersonRow key={row.memberId} accountId={p.accountId} manager={p.manager} row={row} handlers={p.handlers} tt={tt} locale={locale} />
        ))}
      </ul>
      {p.pager.moreHref || p.pager.firstHref ? (
        <nav aria-label={tt("groupPage.people.pages")} data-people-pager className="flex items-center justify-end gap-2">
          {p.pager.firstHref ? <Link href={p.pager.firstHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 md:min-h-8")}>{tt("groupPage.people.first")}</Link> : null}
          {p.pager.moreHref ? <Link href={p.pager.moreHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 md:min-h-8")}>{tt("groupPage.people.more")}</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}

function PersonRow({ accountId, manager, row, handlers, tt, locale }: {
  accountId: string; manager: boolean; row: PeopleRow; handlers: Handlers;
  tt: (key: MessageKey, params?: Record<string, string | number>) => string; locale: ReturnType<typeof useLocale>;
}) {
  const [busy, setBusy] = useState(false);
  const act = (run: () => Promise<unknown>) => async () => { if (busy) return; setBusy(true); try { await run(); } finally { setBusy(false); } };
  return (
    <li data-people-row={row.memberId} className={cn(rowLine, "space-y-1.5 py-2.5 first:pt-0")}>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/dashboard/accounts/${accountId}/contacts/${row.contactId}`} data-people-name title={row.name}
          className={cn("min-w-0 flex-1 truncate rounded-[var(--radius-ctl)] font-medium text-card-foreground underline-offset-4 hover:underline", focus)}>
          {row.name}
        </Link>
        {row.isPrimaryContact ? (
          <span data-people-mark="primary-contact" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />{tt("groupPage.people.primaryContact")}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {manager && !row.isPrimaryContact ? (
          <Button size="sm" variant="ghost" className="min-h-11 md:min-h-8" disabled={busy}
            onClick={act(() => handlers.makePrimaryContact({ memberId: row.memberId, name: row.name }))}>
            {tt("groupPage.people.makePrimaryContact")}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="min-h-11 md:min-h-8" aria-pressed={row.isBilling} disabled={busy}
          onClick={act(() => handlers.toggleBilling({ memberId: row.memberId, isBilling: row.isBilling }))}>
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", row.isBilling ? "bg-[var(--good)]" : "border border-[var(--line-strong)]")} />
            {tt("groups.billing")}
          </span>
        </Button>
        {manager ? (
          <Button size="sm" variant="ghost" className="ml-auto min-h-11 text-muted-foreground md:min-h-8" disabled={busy}
            aria-label={`${tt("groups.remove")}: ${row.name}`}
            onClick={act(() => handlers.remove({ memberId: row.memberId, name: row.name }))}>
            {tt("groups.remove")}
          </Button>
        ) : null}
      </div>
      <dl className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
        <dt className="text-xs text-muted-foreground">{tt("groups.role")}</dt>
        <dd className="min-w-0">
          <InlineField key={`role:${row.role ?? ""}`} label={tt("groups.role")} field="source" value={row.role} locale={locale}
            placeholder={tt("groups.rolePlaceholder")} save={handlers.roleSave(row.memberId)} undoWith={handlers.roleUndo(row.memberId)} />
        </dd>
      </dl>
    </li>
  );
}

/** The card on the page: builds the handlers; every landed write refreshes the server-rendered page. */
export function PeopleCard(props: Omit<Parameters<typeof PeopleCardView>[0], "handlers">) {
  const router = useRouter();
  const locale = useLocale();
  const handlers = peopleHandlers({ accountId: props.accountId, groupId: props.groupId, locale, onChanged: () => router.refresh() });
  return <PeopleCardView {...props} handlers={handlers} />;
}
```

(The Pays-the-bills on/off shape and the role field are the Groups card's own, `groups-card.tsx:300-321`. Check `InlineField`'s `field="source"` arm still takes `placeholder` and `undoWith` (`inline-field.tsx:78-125`); it does at `0878e5d1`.)

**Implement `details-card.tsx`** (`"use client"`): a `dl` of three rows, labels `groups.name`, `groupPage.details.type`, `groups.billingAddress`; for a manager the name is `<InlineField field="source" … save={nameSave} undoWith={…renameGroupAction(accountId, groupId, prev)} />` where `nameSave` refuses `""` with `groups.nameEmpty` (the Groups card's rule, `groups-card.tsx:170-171`) and maps `groups.nameTaken` through `groupErrorText`; the billing address the same with `setBillingAddressAction` (`""` clears to null). A narrow reader reads all three as text. Every landed save calls `onChanged` (`router.refresh()` in `DetailsCard`). Copy through `t()`.
- [ ] **Step 5: Green.** The three new test files, `src/lib/i18n/ratchet.test.ts`; typecheck; eslint. Probes by name.
- [ ] **Step 6: Commit** `feat(contacts): People and Details on the group page, who we call first chosen with an Undo (S-03 part 2)`.

---

## Task 7: The page, its loaders, loading, and the 404 before any read (bis-crm)

**Review:** opus (authorisation order, the ledger client built only after the proof).

**Files**
- Create: `apps/web/src/lib/record/group-loaders.ts` (+ `group-loaders.test.ts`)
- Create: `…/groups/page.tsx` (+ `page.test.ts`), `…/groups/loading.tsx` (+ `loading.test.ts`)
- Modify: `…/contacts/[contactId]/deals-card.tsx` (+ `deals-card.test.ts`)
- Modify: `…/accounts/in-account-service-reads.test.ts` (one line)

**Interfaces**
- Consumes: Tasks 2–6; `loadHeaderPlaces`, `softSmsGate` (`lib/record/loaders.ts:118-135`); `canTextFrom` (`header-actions.ts:22-24`); `smsRecipientState` (`lib/consent/recipient-state`), `composerStateLine` (`lib/consent/composer-state`), `ledgerDb` (`lib/consent/ledger-db`); `requestLocale` (`lib/i18n/request-locale.ts:35`), `requestPseudoMode`; `getPersonPrefs`; `renderZone`; `parseTimelineCursor` (`lib/cursor.ts:64`); `RecordLayout`, `RecordHeader`, `RecordCard`; `LocaleProvider`.
- Produces:

```ts
// group-loaders.ts
export type PeopleLoad = { status: "ready"; page: GroupMembersPage } | { status: "error" };
export function loadGroupPeople(db, accountId, groupId, after?: TimelineCursor): Promise<PeopleLoad>;
export type GroupDealsLoad = { status: "ready"; deals: OpenDealRow[]; count: number; people: GroupPerson[] } | { status: "error" };
export function loadGroupDeals(db, accountId, people: () => Promise<GroupPerson[]>): Promise<GroupDealsLoad>;
export function loadGroupHeaderPlaces(db, accountId, groupId): Promise<ContactPlaces | null>;   // soft
export function loadPrimaryText(input: { db; accountId; primary: GroupMember | null; smsGate: SmsGate | null; zone: string; locale: Locale }): Promise<boolean>; // soft, fails closed
// deals-card.tsx: DealRow gains who?: string; DealsBody gains emptyText?: string; moreText?: string | null
```

- [ ] **Step 1: Failing loader tests** `group-loaders.test.ts` (mock `@bis/db`'s `listGroupMembers`, `listGroupPeople`, `listOpenDealsFor`, `listGroupPlaces`, `getContact`; mock `@/lib/consent/ledger-db`, `@/lib/consent/recipient-state`): each loader returns `{ status: "error" }` (or `null`, or `false`) on a throw and logs `record page: <card> read failed for account <id>` without customer data; `loadPrimaryText` returns false with no `getContact` call when `primary` is null, false when `getContact` is null, and calls `ledgerDb()` only AFTER `getContact` resolved a contact (probe: build the ledger first → the call-order assertion `getContactMock.mock.invocationCallOrder[0] < ledgerDbMock.mock.invocationCallOrder[0]` FAILS); with an open gate and no consent line it answers `canTextFrom`'s verdict. Run → red.
- [ ] **Step 2: Implement `group-loaders.ts`:**

```ts
import {
  listGroupMembers, listOpenDealsFor, listGroupPlaces, getContact,
  type GroupMembersPage, type GroupMember, type GroupPerson, type OpenDealRow, type ContactPlaces, type SupabaseClient, type TimelineCursor,
} from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import type { Locale } from "@/lib/i18n/locale";
import { ledgerDb } from "@/lib/consent/ledger-db";
import { smsRecipientState } from "@/lib/consent/recipient-state";
import { composerStateLine } from "@/lib/consent/composer-state";
import { loggableError } from "@/lib/loggable-error";
import { canTextFrom } from "./header-actions";

/** One loader per group card (S-03 part 2; part 1 C5): each returns a load and NEVER throws. Logs name the card and the account only. */
const log = (card: string, accountId: string, e: unknown) =>
  console.error(`record page: ${card} read failed for account ${accountId}: ${loggableError(e)}`);

export type PeopleLoad = { status: "ready"; page: GroupMembersPage } | { status: "error" };
export async function loadGroupPeople(db: SupabaseClient, accountId: string, groupId: string, after?: TimelineCursor): Promise<PeopleLoad> {
  try { return { status: "ready", page: await listGroupMembers(db, accountId, groupId, { after }) }; }
  catch (e) { log("people", accountId, e); return { status: "error" }; }
}

export type GroupDealsLoad = { status: "ready"; deals: OpenDealRow[]; count: number; people: GroupPerson[] } | { status: "error" };
/** C13: open deals of the page's set of people (2a: the first 50 joined; 2b: the activity set). */
export async function loadGroupDeals(db: SupabaseClient, accountId: string, people: () => Promise<GroupPerson[]>): Promise<GroupDealsLoad> {
  try {
    const set = await people();
    const { deals, count } = await listOpenDealsFor(db, accountId, set.map((p) => p.contactId));
    return { status: "ready", deals, count, people: set };
  } catch (e) { log("deals", accountId, e); return { status: "error" }; }
}

/** The header's Directions (spec §6): soft, so a failure drops Directions, never the header. */
export async function loadGroupHeaderPlaces(db: SupabaseClient, accountId: string, groupId: string): Promise<ContactPlaces | null> {
  try { return await listGroupPlaces(db, accountId, groupId); }
  catch (e) { log("header places", accountId, e); return null; }
}

/**
 * C14: would the call-first member's text composer open? The ledger client (a service client,
 * F-085 §7.3) is built only after getContact on the REQUEST client proved them, the contact page's
 * rule ([contactId]/page.tsx:85-89). Soft, failing closed: any failure hides Text.
 */
export async function loadPrimaryText(input: {
  db: SupabaseClient; accountId: string; primary: GroupMember | null; smsGate: SmsGate | null; zone: string; locale: Locale;
}): Promise<boolean> {
  if (!input.primary || !input.smsGate) return false;
  try {
    const contact = await getContact(input.db, input.accountId, input.primary.contactId);
    if (!contact) return false;
    const state = await smsRecipientState(ledgerDb(), input.accountId, contact);
    const line = composerStateLine(state, input.zone, input.locale);
    return canTextFrom({ phone: contact.phone ?? null, smsGate: input.smsGate, smsBlockedLine: line });
  } catch (e) { log("text gate", input.accountId, e); return false; }
}
```

(Read `composerStateLine`'s and `smsRecipientState`'s signatures in their files before writing the two calls; the contact page calls them as `smsRecipientState(ledger, accountId, contact)` and `composerStateLine(smsRecipient, zone.zone, locale)`, `[contactId]/page.tsx:100`, `:159`.)

- [ ] **Step 3: Failing deals-card test.** In `deals-card.test.ts`: a row with `who: "Ana García"` shows it under the name (`data-deal-who`); `emptyText` replaces `contact.noOpportunities`; `moreText` renders under the list (`data-deals-more`); without the three props, today's markup (probe: always render a `who` line → the contact page case FAILS). Implement: `DealRow` gains `who?: string`; `DealsBody({ deals, tr, emptyText, moreText })`; a `<p data-deal-who className="truncate text-xs text-muted-foreground" title={o.who}>{o.who}</p>` after the name when present; the `moreText` line `<p data-deals-more className="pt-1 text-xs text-muted-foreground">`.
- [ ] **Step 4: Failing page test** `…/groups/page.test.ts`. Mock as the contact page test does (`[contactId]/page.test.ts:17-176`: `@/lib/db`'s accounts chain, `@/lib/auth`, `@bis/db`, `@/lib/preferences/person-prefs`, `@/components/record/use-phone`, `@/lib/zone`, `@/lib/sms/sender`, `@/lib/consent/*`, `next/navigation`); mock `../../contacts/places-card` (record props, render null), `./people-card` (record props), `./details-card` (record props). Cases:

```ts
it("a malformed id is a 404 before ANY read (C16; mutation: start the reads before the uuid check -> FAILS)", async () => {
  await expect(render({ groupId: "not-a-uuid" })).rejects.toBe(NOT_FOUND);
  for (const f of [readGroupMock, listGroupMembersMock, listGroupPeopleMock, listGroupPlacesMock, listOpenDealsForMock,
                   getContactMock, resolveSmsSenderMock, prefsMock, ledgerDbMock, accountRead]) expect(f).not.toHaveBeenCalled();
});
it("a group readGroup cannot see is a 404 before any other read (mutation: Promise.all the reads with readGroup -> FAILS)", async () => {
  readGroupMock.mockResolvedValue(null);
  await expect(render()).rejects.toBe(NOT_FOUND);
  expect(readGroupMock).toHaveBeenCalledWith(REQUEST_DB, "acct1", G);
  for (const f of [listGroupMembersMock, listGroupPeopleMock, listGroupPlacesMock, listOpenDealsForMock,
                   getContactMock, resolveSmsSenderMock, prefsMock, ledgerDbMock, accountRead]) expect(f).not.toHaveBeenCalled();
});
it("the header: the group's name as the h1, the kind word under it, and Call to the call-first member as the one primary", async () => {
  listGroupMembersMock.mockResolvedValue({ primary: ANA, members: [LUIS], next: null });
  const html = await render();
  expect(html).toMatch(/<h1[^>]*>García<\/h1>/);
  expect(html).toMatch(/data-record-subtitle[^>]*>Household</);
  expect([...html.matchAll(/data-record-action="(\w+)"/g)].map((x) => x[1])).toEqual(["call", "email"]);
  expect(html).toContain('href="tel:+19565550100"');
  expect(html).toContain(`href="/dashboard/accounts/acct1/contacts/${ANA.contactId}#compose-email"`);
  expect(html).toContain(">Call Ana<");
});
it("no visible call-first member: no Call, Text or Email (D4)", async () => { /* primary: null → no data-record-action except directions when a place has an address */ });
it("the ledger client is built only after getContact proved the call-first member (C14; mutation: build it first -> FAILS)", async () => {
  listGroupMembersMock.mockResolvedValue({ primary: ANA, members: [], next: null });
  resolveSmsSenderMock.mockResolvedValue({ ok: true, sender: "x" });
  getContactMock.mockResolvedValue({ id: ANA.contactId, phone: "+19565550100", email: null });
  await render();
  expect(getContactMock.mock.invocationCallOrder[0]).toBeLessThan(ledgerDbMock.mock.invocationCallOrder[0]!);
});
it("each card fails on its own: People failing leaves Properties, Deals and Details (mutation: one Promise.all with no per-card loads -> the render rejects, FAILS)", async () => {
  listGroupMembersMock.mockRejectedValue(new Error("members down"));
  const html = await render();
  expect(cardHtml(html, "people")).toMatch(/data-state="error"/);
  expect(cardHtml(html, "deals")).not.toMatch(/data-state="error"/);
  expect(detailsCardProps.at(-1)).toMatchObject({ name: "García" });
  expect(placesCardProps.at(-1)).toMatchObject({ group: { id: G, kind: "household", name: "García" }, canMovePlace: false });
});
it("Deals failing leaves People (and the reverse case above)", async () => { /* listOpenDealsForMock rejects → deals error, people ready */ });
it("a narrow reader gets no Make primary contact, no Remove and no prompt (C2, C3; mutation: pass manager from a team read that failed open -> FAILS)", async () => {
  requireAccountAccessMock.mockResolvedValue({ userId: "u1", isAgency: false, role: "technician", canManage: false });
  await render();
  expect(peopleCardProps.at(-1)).toMatchObject({ manager: false });
  expect(detailsCardProps.at(-1)).toMatchObject({ manager: false });
});
it("Spanish: lang='es', the kind word 'Familia', the titles 'Personas' and 'Datos' (D10)", async () => { /* prefsMock language es */ });
it("a ?people= that does not parse is a cold start, and a good one reaches listGroupMembers", async () => { /* render({ people: "x" }) → listGroupMembers called with { after: undefined } */ });
it("Deals reads exactly the people listGroupPeople returned (C13)", async () => {
  listGroupPeopleMock.mockResolvedValue([{ contactId: "c1", firstName: "Ana", lastName: null }, { contactId: "c2", firstName: "Luis", lastName: null }]);
  await render();
  expect(listOpenDealsForMock).toHaveBeenCalledWith(REQUEST_DB, "acct1", ["c1", "c2"]);
});
```

`loading.test.ts`: one loading card per `GROUP_RECORD_CARDS` entry in phone order (the contact loading test's regex, `[contactId]/loading.test.ts:60-67`), a skeleton header, no spinner, Spanish titles under `LocaleProvider locale="es"`. Run both → red.
- [ ] **Step 5: Implement the page** `…/groups/page.tsx`:

```tsx
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { readGroup, listGroupPeople } from "@bis/db";
import { dbForRequest } from "@/lib/db";
import { requireAccountAccess } from "@/lib/auth";
import { seesWholeAccount } from "@/lib/auth-role";
import { isUuid } from "@/lib/assign/action-guards";
import type { MessageKey } from "@/lib/messages";
import { LocaleProvider } from "@/components/locale-provider";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordHeader } from "@/components/record/record-header";
import { RecordCard, type RecordCardState } from "@/components/record/record-card";
import { GROUP_RECORD_CARDS, columnRuns, type GroupRecordCardId } from "@/lib/record/record-cards";
import { makeTr } from "@/lib/record/copy";
import { softSmsGate, loadHeaderPlaces } from "@/lib/record/loaders";
import { groupHeaderActions, firstGroupMapUrl, memberName, peoplePagerHrefs } from "@/lib/record/group-header";
import { loadGroupPeople, loadGroupDeals, loadGroupHeaderPlaces, loadPrimaryText } from "@/lib/record/group-loaders";
import { parseTimelineCursor } from "@/lib/cursor";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import type { Locale } from "@/lib/i18n/locale";
import { renderZone } from "@/lib/zone";
import { PlacesCard } from "../../contacts/places-card";
import { DealsBody } from "../../contacts/[contactId]/deals-card";
import { PeopleCard, type PeopleRow } from "./people-card";
import { DetailsCard } from "./details-card";

export const dynamic = "force-dynamic";

type Slot = { node: ReactNode; state?: RecordCardState; errorText?: string };
const KIND_KEY = { household: "groups.kind.household", business: "groups.kind.business" } as const satisfies Record<string, MessageKey>;

/**
 * A household's or business's record page (S-03 part 2; spec §8). A record reached from its members'
 * pages, never a nav surface. The group read on the REQUEST client is the authorisation: a malformed
 * id or a group the caller cannot see (another account's; for a Technician, one with none of their
 * customers, 0069:101-102) is a 404 before any other read (C16), identical to one that does not exist.
 * Every card has its own loader (never throws) and its own boundary. In 2a the page is URL-only (R2).
 */
export default async function GroupRecordPage({ params, searchParams }: {
  params: Promise<{ accountId: string; groupId: string }>;
  searchParams?: Promise<{ locale?: string; people?: string }>;
}) {
  const { accountId, groupId } = await params;
  const { locale: localeParam, people: peopleParam } = (await searchParams) ?? {};
  const access = await requireAccountAccess(accountId);
  if (!isUuid(groupId)) notFound();
  const db = await dbForRequest();
  const group = await readGroup(db, accountId, groupId);
  if (!group) notFound();

  const after = parseTimelineCursor(peopleParam);
  const manager = seesWholeAccount(access);
  const [prefs, account, smsGate, people, places, deals] = await Promise.all([
    getPersonPrefs(),
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle(),
    softSmsGate(db, accountId),
    loadGroupPeople(db, accountId, group.id, after),
    loadGroupHeaderPlaces(db, accountId, group.id),
    loadGroupDeals(db, accountId, () => listGroupPeople(db, accountId, group.id)),
  ]);
  if (account.error) console.error(`group page: account ${accountId} timezone and language read failed: ${account.error.message}`);
  const accountRow = account.data as { timezone: string; language?: Locale | null } | null;
  const zone = await renderZone(accountRow?.timezone);
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: accountRow?.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, { locale: localeParam });
  const tr = makeTr(locale, requestPseudoMode({ locale: localeParam }));

  const primary = people.status === "ready" ? people.page.primary : null;
  const groupUrl = firstGroupMapUrl(places?.places ?? [], []);
  // D4: the call-first member's own first place only when the group's places were READ and none has an address
  // (soft, one extra read). A failed group read (places null) cannot know that, so Directions is dropped rather
  // than guessed. Corrected 2026-10-13 (final review): was `!groupUrl && primary` (commit ad5281aa).
  const ownUrl = !groupUrl && places && primary
    ? firstGroupMapUrl([], ((await loadHeaderPlaces(db, accountId, primary.contactId))?.places ?? []).filter((p) => p.contact_id === primary.contactId))
    : null;
  const canText = await loadPrimaryText({ db, accountId, primary, smsGate, zone: zone.zone, locale });
  const actions = groupHeaderActions({ accountId, primary, canText, directionsUrl: groupUrl ?? ownUrl, tr });

  const row = (p: { memberId: string; contactId: string; firstName: string | null; lastName: string | null; role: string | null;
    isBilling: boolean; isPrimaryContact: boolean }): PeopleRow =>
    ({ memberId: p.memberId, contactId: p.contactId, name: memberName(p, tr), role: p.role, isBilling: p.isBilling, isPrimaryContact: p.isPrimaryContact });
  const basePath = `/dashboard/accounts/${accountId}/groups/${group.id}`;
  const failed = (titleKey: MessageKey): Slot => ({ node: null, state: "error", errorText: tr.text("record.card.failed", { title: tr.text(titleKey) }) });
  const names = deals.status === "ready" ? new Map(deals.people.map((p) => [p.contactId, memberName(p, tr)])) : new Map<string, string>();

  const slots = {
    properties: { node: <PlacesCard accountId={accountId} group={{ id: group.id, kind: group.kind, name: group.name }} canMovePlace={false} headingHidden
      emptyText={tr.text(group.kind === "household" ? "groupPage.places.emptyHousehold" : "groupPage.places.emptyBusiness")} /> },
    deals: deals.status === "ready"
      ? { node: <DealsBody tr={tr} emptyText={tr.text("groupPage.deals.empty")}
          deals={deals.deals.map((d) => ({ ...d, who: names.get(d.contact_id) }))}
          moreText={deals.count > deals.deals.length ? tr.text("groupPage.deals.more", { shown: deals.deals.length, count: deals.count }) : null} /> }
      : failed("record.card.deals"),
    people: people.status === "ready"
      ? { node: <PeopleCard accountId={accountId} groupId={group.id} kind={group.kind} manager={manager}
          primary={people.page.primary ? row(people.page.primary) : null} rows={people.page.members.map(row)} paged={Boolean(after)}
          pager={peoplePagerHrefs({ basePath, next: people.page.next, paged: Boolean(after), locale: localeParam })} /> }
      : failed("groupPage.card.people"),
    // The group row is the page's authorisation: if it failed the page already 404'd or errored (§8.3).
    details: { node: <DetailsCard accountId={accountId} groupId={group.id} name={group.name} kind={group.kind}
      billingAddress={group.billingAddress} manager={manager} /> },
  } satisfies Record<GroupRecordCardId, Slot>;

  const columns = columnRuns(GROUP_RECORD_CARDS).map(({ column, cards }) => ({
    column,
    content: cards.map((def) => {
      const slot: Slot = slots[def.id];
      return (
        <RecordCard key={def.id} id={def.id} title={tr.text(def.titleKey)} collapsibleOnPhone={def.collapsibleOnPhone}
          skeletonRows={def.skeletonRows} state={slot.state ?? "ready"} errorText={slot.errorText}>
          {slot.node}
        </RecordCard>
      );
    }),
  }));

  return (
    <LocaleProvider locale={locale}>
      <RecordLayout lang={locale} skipLabel={tr.text("record.skipToDetails")} columns={columns}
        header={<RecordHeader name={group.name} subtitle={tr.text(KIND_KEY[group.kind])} actions={actions}
          back={{ href: `/dashboard/accounts/${accountId}/contacts`, label: tr.text("record.back") }} />} />
    </LocaleProvider>
  );
}
```

`…/groups/loading.tsx`: the contact loading file (`[contactId]/loading.tsx:1-42`) with `columnRuns(GROUP_RECORD_CARDS)` and no timeline skeleton branch in 2a. Add to `in-account-service-reads.test.ts`'s list, in its alphabetical place among the `lib/` entries (beside `"lib/consent/ledger-db.ts"`, `:112`):

```ts
  // loadPrimaryText: ledgerDb only after getContact on the request client proved the call-first member (C14).
  "lib/record/group-loaders.ts": "proven-target",
```

The page itself names no getter, so it gets NO entry: the scan fails on an unlisted importer (`:144-146`) AND on a stale entry (`:147-150`), so an entry for the page would red the "no stale entry" case (plan deviation 15).
- [ ] **Step 6: Green.** `pnpm --filter web exec vitest run src/lib/record/group-loaders.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/page.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/loading.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/deals-card.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts" src/lib/i18n/request-locale-callers.test.ts src/lib/i18n/ratchet.test.ts`; typecheck; eslint. Every probe by name.
- [ ] **Step 7: Commit** `feat(contacts): the household and business record page, reachable by URL, a 404 before any read (S-03 part 2a)`.

---

## Task 8: e2e, `group-page.spec.ts` by URL, and the overflow check (bis-e2e-qa)

**Review:** sonnet. Written by the agent; **run by the orchestrator only** (Task 10 step 2).

**Files:** Create `apps/web/e2e/group-page.spec.ts`; modify `apps/web/e2e/i18n-overflow.spec.ts`.

- [ ] **Step 1: Write the spec** on the per-run fixture account (`e2e/.auth/client-fixture.json`, `record-page.spec.ts:35-39`'s `fixture()`), serial, 60 s:

```ts
import { test, expect } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact, createGroupWithMember, addContactToGroup } from "@bis/db";
import { m } from "../src/lib/messages";
import { recordPage } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-03 part 2, 2a (spec §11.1): the household page, opened BY URL (2a ships no link to it, R2).
 * ON THE PER-RUN FIXTURE ACCOUNT ONLY, never Test Client One. Three contacts "<First> García <stamp>"
 * with random phones and the household "Familia García <stamp>" (never "E2E …": this file deletes its
 * own rows, fixture-names.test.ts needs no admission; groups.spec's precedent). afterAll deletes the
 * group (its memberships cascade) then the contacts, each error checked.
 */
test.describe.configure({ mode: "serial", timeout: 60_000 });

const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
const fixture = (): { accountId: string; clerkUserId: string } => {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`client fixture missing at ${FIXTURE_FILE}: run the full suite (the "setup" project).`);
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8"));
};
const stamp = Date.now();
const ACTOR = "e2e-group-page";
const LAST = `García ${stamp}`;
const phone = () => `+1956292${String(Math.floor(Math.random() * 9000) + 1000)}`;
const made: { ana?: string; luis?: string; maria?: string; group?: string } = {};
const url = (q = "") => `/dashboard/accounts/${fixture().accountId}/groups/${made.group}${q}`;

test.beforeAll(async () => {
  const { accountId } = fixture();
  const db = serviceDb();
  for (const first of ["Ana", "Luis", "Maria"] as const) {
    const c = await createContact(db, accountId, { firstName: first, lastName: LAST, phone: phone() }, ACTOR);
    if (c.existing) throw new Error(`group-page e2e: ${first} matched an existing contact; refusing to use (or delete) it.`);
    made[first.toLowerCase() as "ana" | "luis" | "maria"] = c.id;
  }
  const g = await createGroupWithMember(db, accountId, made.ana!, "household", `Familia ${LAST}`, null, ACTOR);
  if (g.status !== "ok") throw new Error(`group-page e2e: ${g.status}`);
  made.group = g.groupId;
  for (const id of [made.luis!, made.maria!]) {
    const r = await addContactToGroup(db, accountId, id, g.groupId, null, ACTOR);
    if (r.status !== "ok") throw new Error(`group-page e2e: ${r.status}`);
  }
});

test.afterAll(async () => {
  const { accountId } = fixture();
  const db = serviceDb();
  const step = async (label: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run();
    if (error) console.error(`group-page e2e: ${label} cleanup failed (the fixture sweep takes it): ${error.message}`);
  };
  if (made.group) await step("group", () => db.from("client_groups").delete().eq("account_id", accountId).eq("id", made.group!));
  const ids = [made.ana, made.luis, made.maria].filter((x): x is string => Boolean(x));
  await step("contacts", () => db.from("contacts").delete().eq("account_id", accountId).in("id", ids));
  const { data: left } = await db.from("contacts").select("id").in("id", ids);
  expect(left ?? []).toEqual([]);
});

test("asks who we call first, then Call Ana is the one primary, and Undo puts the question back (R1, D4)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url());
  const rec = recordPage(page);
  await expect(rec.locator("h1")).toHaveText(`Familia ${LAST}`);
  await expect(rec.locator("[data-people-prompt]")).toHaveText(m["groupPage.people.choosePrimary"]);
  await expect(rec.locator('[data-record-action="call"]')).toHaveCount(0);
  const anaRow = rec.locator(`[data-people-row]`, { hasText: `Ana ${LAST}` });
  await anaRow.getByRole("button", { name: m["groupPage.people.makePrimaryContact"] }).click();
  await expect(page.getByText(m["groupPage.people.primaryContactSet"].replace("{name}", `Ana ${LAST}`))).toBeVisible();
  const call = rec.locator('[data-record-action="call"]');
  await expect(call).toHaveText(m["groupPage.action.call"].replace("{name}", "Ana"));
  await expect(rec.locator('[data-record-actions] [data-variant="default"]')).toHaveCount(1);
  await expect(call).toHaveAttribute("data-variant", "default");
  // The fixture account has no approved A2P registration (record-page.spec.ts:190): no Text.
  await expect(rec.locator('[data-record-action="text"]')).toHaveCount(0);
  await expect(rec.locator("[data-people-prompt]")).toHaveCount(0);
  await page.getByRole("button", { name: m["common.undo"] }).click();
  await expect(rec.locator("[data-people-prompt]")).toBeVisible();
  await expect(rec.locator('[data-record-action="call"]')).toHaveCount(0);
});

test("lists the three people and each name opens that person", async ({ page }) => {
  await page.goto(url());
  const rec = recordPage(page);
  await expect(rec.locator("[data-people-name]")).toHaveText([`Ana ${LAST}`, `Luis ${LAST}`, `Maria ${LAST}`]);
  await rec.locator("[data-people-name]", { hasText: `Luis ${LAST}` }).click();
  await expect(page).toHaveURL(new RegExp(`/contacts/${made.luis}$`));
});

test("at 390px Properties and Deals are closed, above People (spec §7's phone order; plan deviation 13)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url());
  const rec = recordPage(page);
  const order = await rec.locator("[data-record-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-record-card")));
  expect(order).toEqual(["properties", "deals", "people", "details"]);
  for (const id of ["properties", "deals"]) {
    await expect(rec.locator(`[data-record-card="${id}"] h2 > button[aria-expanded]`)).toHaveAttribute("aria-expanded", "false");
  }
});
```

(Read `apps/web/e2e/support.ts`'s `recordPage` and the toast's accessible name in `toast-keyboard-reach.spec.ts` before relying on `getByRole("button", { name: m["common.undo"] })`; use their idiom.)
- [ ] **Step 2: Overflow.** In `i18n-overflow.spec.ts`, beside the contact record case (`:133-161`), add "the group record page: header actions and People's controls wrap, never clip, under the pseudo-locale": seed one contact and a household as above (the file's own setup/cleanup idiom, `:9-30`), make them the call-first member through `setGroupPrimaryContact` (service client), open `…/groups/<id>?locale=pseudo`, measure `[data-record-action], [data-people-row] button` with the file's `clipFailure`.
- [ ] **Step 3:** `pnpm --filter web exec tsc --noEmit -p e2e` (or the repo's e2e typecheck, read `apps/web/package.json`) and `pnpm --filter web exec vitest run e2e/fixtures/fixture-names.test.ts` → green. Commit `test(e2e): the household page by URL, who we call first, and its phone order (S-03 part 2a)`.

---

## Task 9: Whole-branch review, PR 2a (reviewer, opus)

- [ ] **Step 1.** Read the spec end to end, then `git diff origin/main...HEAD` in `<WT>`. Check each 2a row of the coverage table below against the diff, line by line.
- [ ] **Step 2.** On a fresh replica (port **55512**, Task 1 Step 1 with all migrations including 0075 on `post`): run `group-primary-contact-schema.test.ts`, `client-groups-rls.test.ts`, `client-groups-schema.test.ts`, `client-groups-functions.test.ts`, `schema-grants-guard.test.ts`. Re-run two probes of your own choosing by name.
- [ ] **Step 3.** Web, by path: every test file Tasks 3–7 touched, plus `record-header.test.ts`, `contact-drawer.wiring.test.ts`, `places-demo.test.ts`, `messages.test.ts`, `ratchet.test.ts`, `request-locale-callers.test.ts`, `in-account-service-reads.test.ts`. `pnpm --filter web typecheck`.
- [ ] **Step 4.** Hunt specifically: (a) any read on the group page before `readGroup`; (b) any `serviceDb`/`ledgerDb` use not preceded by a request-client proof; (c) a Technician path to `setGroupPrimaryContact` or to restoring the flag; (d) any `count ?? 0`; (e) English leaking into a Spanish group page (`m[…]`, `contactDisplayName`); (f) a second primary button; (g) a test that cannot fail (memory: vacuous test shapes).
- [ ] **Step 5.** Report findings by severity with file:line. The orchestrator routes fixes to the owning task's agent.

---

## Task 10: Rollout 2a (orchestrator; not a coding task)

- [ ] **1. Measure, read-only** (MCP `execute_sql`, bis-ci then production): `select max(n) from (select count(*) as n from public.client_group_members group by client_group_id) s;` and `select count(*) from public.client_groups;`. Record both in the ledger (spec §12: the 50 cap is assumed far off; this measures it).
- [ ] **2. Gates.** Push the branch so `verify` runs the db suite (the `withTestAccount` cases of Task 2 prove red→green there: read the run and confirm each named probe was exercised by the implementer's report). `e2e` stays red until step 4 (the migration check). Then, one at a time on the combined tree: `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (check for an in-progress `screenshots.yml` run first).
- [ ] **3. bis-ci, dry run.** `gh workflow run ci-project-setup.yml --ref feat/s03-group-page -f step=push-dry-run`. Read the run: it lists exactly `0075_group_primary_contact.sql`. Anything else: stop.
- [ ] **4. bis-ci, push.** `gh workflow run ci-project-setup.yml --ref feat/s03-group-page -f step=push`. Read it for success. Re-run the PR's `e2e` job.
- [ ] **5. Pre-flight, read-only, immediately before step 6 (added 2026-10-13 (final review)).** On production (MCP `execute_sql`): `select count(*) from public.memberships where scope = 'account' and role = 'technician';` → must be `0`. Why: once 0075 replaces `app.restore_member`, `main`'s build (still live until 2a deploys) lets a narrow caller's browser snapshot carry `is_primary_contact: true` into a restore, so a Technician could make their customer a group's call-first member in the window between the apply and 2a's deploy (spec §12). With no technician membership there is nobody to do it. A non-zero count: stop, tell danlo, and apply only when 2a's merge and deploy can follow at once. Record the count in the ledger.
- [ ] **6. Production.** Warn danlo in chat first. Re-run Task 1 Step 8's byte scan (`0075 0`). MCP `apply_migration`, name `group_primary_contact`, **exactly once; never re-apply**, never touch 0069–0074. Then read-only: `select count(*) from public.client_group_members where is_primary_contact` → `0` (no backfill); `select has_function_privilege('authenticated', 'public.set_group_primary_contact(uuid,uuid,uuid)', 'execute')` → `false`.
- [ ] **7. Parity.** The runbook's digest between bis-ci and production: they match. Spot check on production: `select count(*) from pg_indexes where indexname = 'client_group_members_one_primary_contact'` → `1`.
- [ ] **8. PR, merge, deploy.** Open PR 2a only now (body ends with the attribution line). Read the check runs for the HEAD SHA (`gh api repos/{owner}/{repo}/commits/{sha}/check-runs`); squash-merge with the SHA pinned. Verify the deploy is READY at the merge SHA; `/` 200, `/sign-in` 200, `/b/bogus` 404. Served-HTML markers (signed in, Preview or production): the "People" card title on `…/groups/<id>` opened by URL; a contact page in Spanish reading "· Familia".
- [ ] **9. Ledger, runbook, tracker.** Propose the 0075 run-log line for `docs/runbooks/ci-supabase-project.md` to bis-platform; update S-03's row in the roadmap tracker.

Hazards (spec §12; corrected 2026-10-13 (final review)): **2a's app before 0075:** the People read selecting `is_primary_contact` fails, so People shows its error and the header shows no Call, Text or Email (data-safe); and the contact page's Business-name Undo answers "Undo failed", because `undoSetBusiness` reads the added membership's `is_primary_contact` before it runs (nothing is deleted). The order is fixed. **0075 before 2a:** NOT fully safe: the replaced `app.restore_member` honours a snapshot's `is_primary_contact`, and `main`'s `restoreMembershipAction` passes a narrow caller's snapshot through, so a Technician could take call-first in the window until 2a deploys. Step 5's count of technician memberships (`0`) is what makes the window empty. **Rollback:** revert the app; 0075 is harmless to the old build; dropping it (Task 1's header) is an owner decision.

---

## Task 11: `forContacts`, and notes, To-dos, deals, submissions take a set (bis-crm)

**Review:** sonnet. **Base:** `main` after Task 10 (2b branches from it: `feat/s03-group-page-2b`, the orchestrator creates the worktree).

**Files:** Modify `packages/db/src/timeline-cursor.ts` (+ `timeline-cursor.test.ts`), `activities.ts` (`listNotes` `:20-27`, `listContactTasks` `:44-65`), `opportunities.ts` (`listContactOpportunities` `:156-168`), `forms.ts` (`listContactSubmissions` `:519-530`), `packages/db/src/test/timeline-sources.test.ts`.

**Interfaces**
- Produces:

```ts
// timeline-cursor.ts
/** `.eq(column, id)` for one id, `.in(column, ids)` for a set. A set must be non-empty (callers short-circuit). */
export function forContacts<T>(q: T, column: string, ids: string | readonly string[]): T;
// activities.ts / opportunities.ts / forms.ts: the `contactId` parameter becomes `contactId: string | readonly string[]`,
// and every row carries `contact_id: string` (notes, tasks, deals: added to the select; submissions: already in SUBMISSION_COLS, forms.ts:222-224).
```

- [ ] **Step 1: Failing pure test** in `timeline-cursor.test.ts`: `forContacts` on a recording chain calls `eq("contact_id", "c1")` for a string and `in("contact_id", ["c1","c2"])` for an array (probe: always `.in` → the string case FAILS); an empty array throws `TypeError("forContacts: an empty set")` (probe: drop the guard → FAILS). Run with blanked credentials → red.
- [ ] **Step 2: Implement** in `timeline-cursor.ts`:

```ts
type Filterable = { eq: (column: string, value: string) => Filterable; in: (column: string, values: string[]) => Filterable };

/**
 * S-03 part 2 (C6): one source function serves one person (the contact page, `.eq`, unchanged) or a
 * household's members (`.in`). An empty set is refused: PostgREST's `in.()` is not a query anyone
 * means, and the merged page short-circuits before it (record.ts).
 */
export function forContacts<T>(q: T, column: string, ids: string | readonly string[]): T {
  if (typeof ids === "string") return (q as unknown as Filterable).eq(column, ids) as unknown as T;
  if (ids.length === 0) throw new TypeError("forContacts: an empty set");
  return (q as unknown as Filterable).in(column, [...ids]) as unknown as T;
}
```

Green. **Commit this step alone** (`feat(db): one timeline source reads one person or a set (S-03 part 2b)`), so Tasks 12–14 can start.
- [ ] **Step 3: Failing live tests** in `timeline-sources.test.ts` (read its seeding helpers first): with two contacts' notes, To-dos, deals and submissions, each function given `[a, b]` and a page returns both people's rows in `(created_at desc, id desc)` order, each with its own `contact_id` (probe: drop `contact_id` from `listNotes`' select → `undefined`, FAILS); given `a` alone, exactly today's rows (probe: route the string through `.in([a, b])` → b's rows appear, FAILS). CI-proven (typecheck red locally).
- [ ] **Step 4: Implement.** In each function: the parameter type, `.eq("contact_id", contactId)` → `forContacts(q, "contact_id", contactId)` (keep `.eq("account_id", accountId)`), `contact_id` added to the select (`listNotes`: `"id, contact_id, body, pinned, author_id, created_at"`; `TASK_COLS` gains `contact_id`; `listContactOpportunities`' `cols` gains `contact_id`), and the return row types gain `contact_id: string`. The no-page (drawer) path accepts only a string: `if (!page && typeof contactId !== "string") throw new TypeError("<fn>: a set needs a page");` — the drawer passes a string, so it is unchanged.
- [ ] **Step 5:** typecheck, the pure tests with blanked credentials, commit `feat(db): notes, To-dos, deals and submissions read a household's members in one page (S-03 part 2b)`.

---

## Task 12: `listContactMessages` takes a set (bis-comms)

**Review:** sonnet. **Starts after** Task 11's first commit. **Files:** `packages/db/src/messaging.ts:742-769`, `packages/db/src/test/contact-messages.test.ts`.

- [ ] **Step 1: Failing live test** in `contact-messages.test.ts`: two contacts, a text each; `listContactMessages(db, accountId, [a, b], { limit: 31, channels: ["email","sms"] })` returns both, newest first, each with `contact_id` mapped from its conversation (probe: map every row to the first conversation's contact → FAILS); `[a]` with a contact who has no conversation returns `[]`; `listContactMessages(db, accountId, [a, b])` with no page throws `a set needs a page`. CI-proven.
- [ ] **Step 2: Implement:**

```ts
export async function listContactMessages(
  db: SupabaseClient, accountId: string, contactId: string | readonly string[],
  page?: TimelinePageOpts & { channels?: readonly NewMessage["channel"][] },
): Promise<ContactMessageRow[]> {
  if (typeof contactId !== "string" && !page) throw new TypeError("listContactMessages: a set needs a page");
  const { data: convos, error } = await forContacts(
    db.from("conversations").select("id, contact_id").eq("account_id", accountId), "contact_id", contactId);
  if (error) throw new Error(`listContactMessages failed: ${error.message}`);
  const list = (convos ?? []) as { id: string; contact_id: string }[];
  if (list.length === 0) return [];
  if (!page) return listMessages(db, accountId, list[0]!.id);
  const owner = new Map(list.map((c) => [c.id, c.contact_id]));
  let q = db.from("messages")
    .select(`${MESSAGE_COLS}, author_kind, author_id` as typeof MESSAGE_COLS)
    .eq("account_id", accountId).in("conversation_id", list.map((c) => c.id));
  if (page.channels) q = q.in("channel", [...page.channels]);
  const { data, error: mErr } = await withTimelinePage(q, "created_at", page);
  if (mErr) throw new Error(`listContactMessages failed: ${mErr.message}`);
  return ((data ?? []) as ContactMessageRow[]).map((r) => ({ ...r, contact_id: owner.get(r.conversation_id) ?? "" }));
}
```

(One conversation per customer, `conversations_account_contact_unique`, `0005_messaging.sql:22-25`, so `list[0]` is that customer's only one for a string. Keep the doc comment at `:730-741` and add one line for the set.) **Corrected 2026-10-13 (final review):** for ONE id the read is byte-identical to before for six of the seven sources; messages is the one whose shape moves: its page read is `.in("conversation_id", [id])` (and the conversations read is an awaited array, not `maybeSingle`), with identical results because of `conversations_account_contact_unique`. Tests that mocked the old shape (`messaging-author-shape.test.ts`) must be updated with it. `ContactMessageRow` gains `contact_id?: string` (page mode only). Import `forContacts` from `./timeline-cursor`.
- [ ] **Step 3:** typecheck, commit `feat(db): a household's texts and emails in one timeline page, each naming its person (S-03 part 2b)`.

---

## Task 13: Bookings take a set (bis-booking)

**Review:** sonnet. **Starts after** Task 11's first commit. **Files:** `packages/db/src/booking.ts:944-1017`, `packages/db/src/index.ts:88` (one name added), `packages/db/src/test/booking.test.ts`.

**Produces:** `countBookingsMadeFor(db, accountId, contactIds: readonly string[]): Promise<number>` (D-035's definition: `rescheduled_from_id is null`; throws on a null count; `[]` → 0 with no read); `UpcomingBooking = { id: string; starts_at: string; contact_id: string }`; `listContactUpcomingBookings(db, accountId, contactId: string | readonly string[], nowIso, limit = 3)`; `ContactBookingRow` gains `contact_id: string`; `listContactBookings(db, accountId, contactId: string | readonly string[], page)`.

- [ ] **Step 1: Failing live tests** in `booking.test.ts`: across two contacts, `countBookingsMadeFor` counts both people's bookings made and NOT a reschedule (probe: drop `.is("rescheduled_from_id", null)` → FAILS); `listContactUpcomingBookings([a, b], now)` returns both, soonest first, each with `contact_id`; `listContactBookings([a, b], page)` the same, each with `contact_id` (probe: drop `contact_id` from the select → FAILS); `countBookingsMadeFor` rejects a count-less answer with `countBookingsMadeFor failed: no count returned` (probe: `count ?? 0` → FAILS), using `head-count-null.test.ts:41-52`'s `noCount` proxy copied into `booking.test.ts` (that file is bis-crm's; a local copy keeps this task inside bis-booking's files).
- [ ] **Step 2: Implement** with `forContacts`; `countContactBookingsMade` (`:945-960`) is unchanged. Barrel: add `countBookingsMadeFor` to `index.ts:88`.
- [ ] **Step 3:** typecheck, commit `feat(db): a household's bookings, made and ahead, each naming its person (S-03 part 2b)`.

---

## Task 14: `listContactCalls` takes a set (bis-voice)

**Review:** sonnet. **Starts after** Task 11's first commit. **Files:** `packages/db/src/voice.ts:944-964`, `packages/db/src/test/voice-timeline.test.ts`.

- [ ] **Step 1: Failing live test:** two contacts' calls; `listContactCalls(db, accountId, [a, b], 31, { excludeSpam: true })` returns both, newest first, spam left out, each with `contact_id` (probe: drop `contact_id` from the select → FAILS); a string id reads exactly today's rows.
- [ ] **Step 2: Implement:** the parameter type; `.eq("contact_id", contactId)` → `forContacts(query, "contact_id", contactId)`; the select gains `contact_id`; `ContactCallRow` gains `contact_id: string`. (`voice` is `export *` in the barrel, `index.ts:124`: nothing to add.)
- [ ] **Step 3:** typecheck, commit `feat(db): a household's calls in one timeline page, each naming its person (S-03 part 2b)`.

---

## Task 15: The kit's member slot and linked subtitle; the Groups card's Open (bis-frontend)

**Review:** sonnet. **messages.ts:** 2b's first editor (its last step).

**Files:** `apps/web/src/components/record/timeline-item.tsx` (+ test), `record-header.tsx` (+ test), `apps/web/src/app/(dashboard)/dashboard/styleguide/record-demo.tsx` (+ test), `…/contacts/groups-card.tsx` (+ `groups-card.test.ts`), `apps/web/src/lib/messages.ts`.

**Produces:** `TimelineItemProps.subject?: { label: string; href: string }`; `RecordHeader({ …, subtitleHref?: string })`.

- [ ] **Step 1: Failing tests.**
  - `timeline-item.test.ts`: with `subject: { label: "Ana García", href: "/dashboard/accounts/a1/contacts/c1" }` the head line reads member, `·`, mark, verb in that DOM order, the member a link with `data-timeline-subject` and a visible focus ring class; without `subject` the markup equals today's exactly (snapshot the string of a fixed row before your change and compare; probe: always render an empty subject span → FAILS).
  - `record-header.test.ts`: with `subtitleHref` the subtitle is an `<a href=…>` carrying `data-record-subtitle` (probe: ignore the prop → FAILS); without it, today's `<p>` (`:25`).
  - `groups-card.test.ts`: each group row has an "Open" link to `/dashboard/accounts/a1/groups/<groupId>` with `aria-label="Open Garcia"` (probe: link the first group for every row → with two groups, FAILS).
  - `record-demo.test.ts`: the styleguide shows a linked subtitle and a timeline row with a subject (read the test's existing assertions for the idiom).
  Run → red.
- [ ] **Step 2: Implement `TimelineItem`:** in the head `<p>` (`timeline-item.tsx:37`), before `<AuthorMark …/>`:

```tsx
          {subject ? (
            <>
              <Link href={subject.href} data-timeline-subject title={subject.label}
                className="max-w-[16rem] truncate rounded-[var(--radius-ctl)] font-medium text-card-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                {subject.label}
              </Link>
              <Sep />
            </>
          ) : null}
```

with `import Link from "next/link";` and `subject?: { label: string; href: string };` in the props (doc: "S-03 part 2 (C8): the member a row is about, on a household's timeline; the mark after it still says who did it").
  **`RecordHeader`:** `subtitleHref?: string`; the subtitle line becomes `subtitleHref ? <Link href={subtitleHref} data-record-subtitle className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline rounded-[var(--radius-ctl)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">{subtitle}</Link> : <p data-record-subtitle …>` (only when `subtitle` is set).
  **Styleguide:** in `record-demo.tsx`, one `RecordHeader` with `subtitleHref="#"` and one `TimelineItem` with a subject.
  **Groups card:** in `GroupRow` (`groups-card.tsx:290-292`), beside the kind word:

```tsx
        <Link href={`/dashboard/accounts/${accountId}/groups/${group.groupId}`} aria-label={withName(m["groups.openAria"], group.name)}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 shrink-0 md:min-h-8")} data-group-open={group.groupId}>
          {m["groups.open"]}
        </Link>
```

(`m[…]` like the rest of the card, groups spec §8; the `.es` twin shows when the card moves to `t()`.)
- [ ] **Step 3 (LAST code step): messages.ts**, above `} as const;`:

```ts
  // S-03 part 2b: the Groups card's way to the household's or business's own page.
  "groups.open": "Open",
  "groups.open.es": "Abrir",
  "groups.openAria": "Open {name}",
  "groups.openAria.es": "Abrir {name}",
```

- [ ] **Step 4:** the four test files, `styleguide.spec`-free checks (`record-demo.test.ts`), `messages.test.ts`, `ratchet.test.ts`; typecheck; eslint; commit `feat(design): a timeline row can name the person it is about, a record header can link its group, and the Groups card opens the group (S-03 part 2b)`.

---

## Task 16: The merged page across a set; facts, Next up, the cap; web views and copy (bis-crm)

**Review:** opus (the set, the ranking, the cap and the qualifier decide what a Technician is told).

**Files:** `packages/db/src/record.ts`, `packages/db/src/index.ts` (record block `:263-272`), `packages/db/src/test/record.test.ts`; `apps/web/src/lib/record/{timeline-rows,next-up,loaders}.ts` (+ tests), `apps/web/src/lib/record/group-facts.ts` (+ test), `…/contacts/[contactId]/next-up-card.tsx` (+ test), `apps/web/src/lib/messages.ts`.

**Interfaces**
- Consumes: Tasks 11–14's set forms; `GROUP_ACTIVITY_CAP`, `countGroupMembers` (Task 2).
- Produces:

```ts
// record.ts
export const GROUP_ACTIVITY_SCAN = 500;
// every TimelineEntry variant gains `contactId: string`
export function listTimelinePage(db, accountId, contactIds: readonly string[], before?: TimelineCursor,
  opts?: { limit?: number; onError?: (source: TimelineSource, e: unknown) => void }): Promise<TimelinePage>;
export function listContactTimelinePage(db, accountId, contactId: string, before?, opts?): Promise<TimelinePage>; // = listTimelinePage(…, [contactId], …) semantics, `.eq` path
export type GroupActivity = { people: GroupPerson[]; total: Fact<number> };
export function groupActivityMembers(db, accountId, groupId, cap?: number): Promise<GroupActivity>;
export type GroupLastTalked = LastTalked & { contactId: string };
export type GroupFacts = { bookingsMade: Fact<number>; lastTalked: Fact<GroupLastTalked | null> };
export function groupFacts(db, accountId, contactIds: readonly string[], opts?: { onError?: (name: FactName, e: unknown) => void }): Promise<GroupFacts>;
export type GroupNextUp = { bookings: UpcomingBooking[]; datedTasks: (NextUpTask & { contact_id: string })[]; undatedCount: number };
export function groupNextUp(db, accountId, contactIds: readonly string[], nowIso: string, limit?: number): Promise<GroupNextUp>;
// web
export function timelineRows(entries, ctx: { zone; tr; author; subjects?: Readonly<Record<string, { label: string; href: string }>> }): TimelineRow[]; // TimelineRow.subject: {label, href} | null
export function nextUpView(data: ContactNextUp | GroupNextUp, ctx: { zone; now; tr; names?: Readonly<Record<string, string>> }, limit?): NextUpView; // NextUpRow gains who: string | null
export function groupFactsView(input: { total: Fact<number>; narrow: boolean; facts: GroupFacts; names: Readonly<Record<string, string>> }, ctx: { zone; now; tr }): FactsView;
export function groupCapLine(input: { total: Fact<number>; shown: number; narrow: boolean }, tr: Tr): string | null;
```

- [ ] **Step 1: Failing db tests** in `record.test.ts` (live; read its seeding helpers first):
  - `listTimelinePage` over three members merges a call of one, a booking of another and a note of the third in `(at, id)` order, each entry with its `contactId` (probe: drop `contact_id` from `listContactCalls`' select → that entry's `contactId` is `undefined`, FAILS).
  - `listContactTimelinePage(db, a, c1)` equals `listTimelinePage(db, a, [c1])` for the same contact, item for item (probe: route the one-id path through `.in` with a second id → FAILS).
  - `listTimelinePage(db, a, [])` is `{ items: [], older: null, failed: [] }` with no read (probe: drop the short-circuit → `forContacts` throws into `failed`, FAILS).
  - `groupActivityMembers`: the call-first member first, then by `conversations.last_message_at desc nulls last`, then membership `created_at desc`, then `contact_id desc`; cut at `cap` while `total` stays exact (seed 4, cap 2; probe: sort nulls first → FAILS; take `total` from the cut list → FAILS).
  - `groupFacts` counts bookings made (not reschedules) across the set (probe: `countContactBookingsMade` of the first id only → FAILS) and names the member of the newest conversation or call (probe: take the oldest → FAILS).
  - `groupNextUp`'s bookings and To-dos carry `contact_id`, and the undated count spans the set.
  Technician scope for the set is pinned per table by `technician-scope.test.ts` (`:27-31`'s `PER_CONTACT`) and Task 1's SQL; RLS drops another id's rows whatever ids the page passes (spec §4.2). Typecheck red locally; CI-proven.
- [ ] **Step 2: Implement `record.ts`.** Rename the body of `listContactTimelinePage` (`:180-217`) to `listTimelinePage` taking `contactIds: readonly string[]`, with `if (contactIds.length === 0) return { items: [], older: null, failed: [] };` first and the set passed to each source as `contactIds.length === 1 ? contactIds[0]! : contactIds` (so one person keeps the `.eq` path); each `.map` adds `contactId: <row>.contact_id` to its entry. `listContactTimelinePage(db, accountId, contactId, before, opts)` becomes `return listTimelinePage(db, accountId, [contactId], before, opts);`. Each `TimelineEntry` variant (`:149-156`) gains `contactId: string`.

```ts
/** How many visible memberships the activity ranking reads, newest-joined first (spec §6, C5). */
export const GROUP_ACTIVITY_SCAN = 500;
export type GroupActivity = { people: GroupPerson[]; total: Fact<number> };

/**
 * C5's set: the call-first member (when visible), then by the customer's one conversation's
 * last_message_at desc nulls last, then the membership's created_at desc, then contact_id desc; cut at
 * `cap`. PostgREST cannot order a parent by a to-many embed (groups spec ruling 13.1), so the sort is
 * here, over at most GROUP_ACTIVITY_SCAN memberships. `total` is the exact visible count, its own read
 * (plan deviation 9): a failure costs the people fact and the cap line, not the page. THROWS on the scan.
 */
export async function groupActivityMembers(
  db: SupabaseClient, accountId: string, groupId: string, cap = GROUP_ACTIVITY_CAP,
): Promise<GroupActivity> {
  type Row = { contact_id: string; is_primary_contact: boolean; created_at: string;
    contacts: { first_name: string | null; last_name: string | null; conversations: { last_message_at: string | null }[] | null } | null };
  const [scan, total] = await Promise.all([
    db.from("client_group_members")
      .select("contact_id, is_primary_contact, created_at, contacts(first_name, last_name, conversations(last_message_at))")
      .eq("account_id", accountId).eq("client_group_id", groupId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(GROUP_ACTIVITY_SCAN),
    settle("people", () => countGroupMembers(db, accountId, groupId)),
  ]);
  if (scan.error) throw new Error(`groupActivityMembers failed: ${scan.error.message}`);
  const rows = ((scan.data ?? []) as unknown as Row[]).filter((r) => r.contacts !== null);
  // instantKey (timeline-cursor.ts:40-45) sorts to the microsecond whatever offset PostgREST wrote.
  const lastAt = (r: Row) => {
    const v = r.contacts!.conversations?.[0]?.last_message_at ?? null;
    return v === null ? null : instantKey(v);
  };
  const desc = (x: string, y: string) => (x === y ? 0 : x < y ? 1 : -1);
  rows.sort((a, b) => {
    const la = lastAt(a), lb = lastAt(b);
    return Number(b.is_primary_contact) - Number(a.is_primary_contact)
      || (la === lb ? 0 : la === null ? 1 : lb === null ? -1 : desc(la, lb))
      || desc(instantKey(a.created_at), instantKey(b.created_at))
      || desc(a.contact_id, b.contact_id);
  });
  return {
    people: rows.slice(0, cap).map((r) => ({ contactId: r.contact_id, firstName: r.contacts!.first_name, lastName: r.contacts!.last_name })),
    total,
  };
}
```

(Imports for `record.ts`: `countGroupMembers`, `GROUP_ACTIVITY_CAP`, `type GroupPerson` from `./client-groups`; `countBookingsMadeFor` from `./booking`; `forContacts` beside `instantKey` from `./timeline-cursor`. `FactName` (`:33`) widens to `"bookings" | "talked" | "deals" | "people"`. **Assumption** (spec §6): the `contacts → conversations` embed has one path, because `conversations.contact_id` has one FK (`0005:14`) and 0050 adds none to `conversations`; the live test is what proves it: a PGRST201 there fails the scan.)

`groupFacts`: `bookingsMade` = `settle("bookings", () => countBookingsMadeFor(db, accountId, contactIds))`; `lastTalked` = the newest `email`/`sms` message not `failed`/`bounced` across the set's conversations (conversations `.in("contact_id", ids)` selecting `id, contact_id`, then messages `.in("conversation_id", …)` with `newestConversationMessage`'s filters, `:53-56`, limit 1, mapping `contactId` back) against `listContactCalls(db, accountId, contactIds, 1, { excludeSpam: true })[0]`, newer wins, `{ at, channel, contactId }`. `groupNextUp`: `contactNextUp`'s three reads (`:112-121`) with `forContacts` and `contact_id` in the To-do select, bookings through the set form of `listContactUpcomingBookings`; the undated count throws on null. An empty set answers `{ bookingsMade: ok 0, lastTalked: ok null }` / empty Next up with no read. Barrel: add `listTimelinePage, groupActivityMembers, groupFacts, groupNextUp, GROUP_ACTIVITY_SCAN, type GroupActivity, type GroupFacts, type GroupLastTalked, type GroupNextUp` to the record block.
- [ ] **Step 3: Failing web tests.**
  - `timeline-rows.test.ts`: with `subjects` every row's `subject` is that entry's member and its `mark` is unchanged, including a customer-authored row (probe: drop the mark when `mark.kind === "customer"` and a subject is present → FAILS); without `subjects` every row's `subject` is `null` (probe: build a subject from `entry.contactId` always → the contact page case FAILS).
  - `next-up.test.ts`: with `names`, each row's `who` is that row's member's first name; without, `null`.
  - `group-facts.test.ts`:

```ts
it("a narrow reader is told 'people you can see' whenever they are narrow, whether or not anything is hidden (C4; the view takes no hidden count, so it cannot branch on one)", () => {
  const facts = { bookingsMade: { ok: true as const, value: 0 }, lastTalked: { ok: true as const, value: null } };
  expect(groupFactsView({ total: { ok: true, value: 3 }, narrow: true, facts, names: {} }, ctx).line).toEqual(["3 people you can see"]);
  expect(groupFactsView({ total: { ok: true, value: 1 }, narrow: true, facts, names: {} }, ctx).line).toEqual(["1 person you can see"]);
  expect(groupFactsView({ total: { ok: true, value: 3 }, narrow: false, facts, names: {} }, ctx).line).toEqual(["3 people"]);
});
it("the cap line shows only past 50 (mutation: >= 50 -> FAILS at exactly 50)", () => {
  expect(groupCapLine({ total: { ok: true, value: 50 }, shown: 50, narrow: false }, tr)).toBeNull();
  expect(groupCapLine({ total: { ok: true, value: 73 }, shown: 50, narrow: false }, tr))
    .toBe("Showing activity for 50 of 73 people. Open a person to see theirs.");
  expect(groupCapLine({ total: { ok: true, value: 73 }, shown: 50, narrow: true }, tr))
    .toBe("Showing activity for 50 of the 73 people you can see. Open a person to see theirs.");
  expect(groupCapLine({ total: { ok: false }, shown: 50, narrow: false }, tr)).toBeNull();
});
it("Last talked names the member: 'Last talked yesterday with Ana (text)' (C9)", () => { /* names: { c1: "Ana" }, lastTalked at now-1d channel text contactId c1 */ });
it("a failed count is named, never zeroed: 'Couldn't count the people in this group.' (plan deviation 9)", () => { /* total ok:false → missing contains groupPage.facts.what.people */ });
it("Spanish: '3 personas', 'Última conversación … con Ana (texto)'", () => { /* makeTr("es") */ });
```

(The probe for C4's "do not branch on a hidden count": add a `hiddenCount` parameter and show the qualifier only when it is above zero → the first case FAILS, because it passes no hidden count and expects the qualifier.)
  - `next-up-card.test.ts`: a row with `who` reads "… · Ana" (`data-next-up-who`).
  Run → red.
- [ ] **Step 4: Implement the web side.**
  - `timeline-rows.ts`: `TimelineRow` gains `subject: { label: string; href: string } | null`; `timelineRows`' ctx gains `subjects?`; each row sets `subject: ctx.subjects ? ctx.subjects[entry.contactId] ?? null : null`.
  - `next-up.ts`: `NextUpRow` variants gain `who: string | null`; `nextUpView`'s ctx gains `names?`; each row's `who` is `ctx.names?.[contact_id] ?? null` (read `contact_id` off the task or booking when present: `"contact_id" in t ? t.contact_id : undefined`).
  - `next-up-card.tsx`: after each row's label or detail, `{row.who ? <span data-next-up-who className="text-muted-foreground"> · {row.who}</span> : null}`.
  - `group-facts.ts`:

```ts
import type { GroupFacts, Fact } from "@bis/db";
import { formatDateInZone } from "@/lib/format";
import { talkedWhen, type FactsView } from "./record-facts";
import type { Tr } from "./copy";

/**
 * The group summary's one line (spec §8.6). A zero is left out; a failed read is left out AND named
 * (DESIGN.md: omitted, never zeroed). C4: "you can see" qualifies the people fact for EVERY narrow
 * reader (a Technician, or a role that could not be settled), never only when something is hidden:
 * this view is given no hidden count, so it cannot leak one.
 */
export function groupFactsView(
  input: { total: Fact<number>; narrow: boolean; facts: GroupFacts; names: Readonly<Record<string, string>> },
  ctx: { zone: string; now: Date; tr: Tr },
): FactsView {
  const { tr, zone, now } = ctx;
  const line: string[] = [];
  const missing: string[] = [];
  if (!input.total.ok) missing.push(tr.text("groupPage.facts.what.people"));
  else if (input.total.value > 0) line.push(tr.count(input.narrow ? "groupPage.facts.peopleVisible" : "groupPage.facts.people", input.total.value));
  const booked = input.facts.bookingsMade;
  if (!booked.ok) missing.push(tr.text("record.facts.what.bookings"));
  else if (booked.value > 0) line.push(tr.count("record.facts.booked", booked.value));
  const talked = input.facts.lastTalked;
  if (!talked.ok) missing.push(tr.text("record.facts.what.talked"));
  else if (talked.value) {
    line.push(tr.text("groupPage.facts.lastTalked", {
      when: talkedWhen(talked.value.at, now, zone, tr.locale),
      name: input.names[talked.value.contactId] ?? tr.text("assign.someone"),
      channel: tr.text(`record.facts.channel.${talked.value.channel}` as const),
    }));
  }
  const tag = tr.locale === "es" ? "es-US" : "en-US";
  return {
    line,
    missing: missing.length > 0 ? tr.text("record.facts.couldntCount", { what: new Intl.ListFormat(tag, { type: "conjunction" }).format(missing) }) : null,
    allFailed: !input.total.ok && !booked.ok && !talked.ok,
  };
}

/** D7: one plain line, only past the cap, governing the summary, Next up and the timeline below it. */
export function groupCapLine(input: { total: Fact<number>; shown: number; narrow: boolean }, tr: Tr): string | null {
  if (!input.total.ok || input.total.value <= input.shown) return null;
  return tr.text(input.narrow ? "groupPage.cappedVisible" : "groupPage.capped", { shown: input.shown, total: input.total.value });
}
```

(Read `record-facts.ts:42-80`'s `FactsView` and `allFailed` rule first and keep the same shape; `assign.someone` is part 1's "Someone on the team", reused per spec §9.)
  - `lib/record/group-loaders.ts` (2b additions): `loadGroupActivity(db, accountId, groupId)` → `{ status: "ready"; activity: GroupActivity } | { status: "error" }`; `loadGroupSummary(db, accountId, ids)`; `loadGroupNextUp(db, accountId, ids, now)`; `loadGroupTimeline(db, accountId, ids, before)` → the `TimelineLoad` shape without `holdOpen` (`loaders.ts:41-82`'s body with `listTimelinePage`, `listPeopleNames`, `getVoiceProfile`; no hold read: the group timeline has no Done, C7). Each never throws (tests: one each, a throw → error and a log line naming the card).
- [ ] **Step 5 (LAST code step, after Task 15's messages commit): messages.ts**, above `} as const;`, the spec's §9.2 rows verbatim:

```ts
  // S-03 part 2b: the household and business page's middle column.
  "groupPage.facts.people": "{count} people",
  "groupPage.facts.people.es": "{count} personas",
  "groupPage.facts.peopleOne": "1 person",
  "groupPage.facts.peopleOne.es": "1 persona",
  "groupPage.facts.peopleVisible": "{count} people you can see",
  "groupPage.facts.peopleVisible.es": "{count} personas que usted puede ver",
  "groupPage.facts.peopleVisibleOne": "1 person you can see",
  "groupPage.facts.peopleVisibleOne.es": "1 persona que usted puede ver",
  "groupPage.facts.lastTalked": "Last talked {when} with {name} ({channel})",
  "groupPage.facts.lastTalked.es": "Última conversación {when} con {name} ({channel})",
  "groupPage.facts.what.people": "the people in this group",
  "groupPage.facts.what.people.es": "las personas de este grupo",
  "groupPage.capped": "Showing activity for {shown} of {total} people. Open a person to see theirs.",
  "groupPage.capped.es": "Se muestra la actividad de {shown} de {total} personas. Abra a una persona para ver la suya.",
  "groupPage.cappedVisible": "Showing activity for {shown} of the {total} people you can see. Open a person to see theirs.",
  "groupPage.cappedVisible.es": "Se muestra la actividad de {shown} de las {total} personas que usted puede ver. Abra a una persona para ver la suya.",
  "groupPage.nextUp.empty": "Nothing coming up for these people. Bookings ahead and To-dos with a due date show here.",
  "groupPage.nextUp.empty.es": "No hay nada próximo para estas personas. Aquí aparecen las citas que vienen y los pendientes con fecha.",
  "groupPage.timeline.empty": "Texts, calls, bookings, notes and To-dos with these people show up here. Open a person to start one.",
  "groupPage.timeline.empty.es": "Aquí aparecen los textos, llamadas, citas, notas y pendientes con estas personas. Abra a una persona para empezar uno.",
```

- [ ] **Step 6: Green, then commit.** Web tests by path (the five above, `loaders.test.ts`, `group-loaders.test.ts`, `messages.test.ts`, `ratchet.test.ts`, the contact `page.test.ts` and every `activity-timeline.*.test.ts`: `TimelineRow.subject` is new and `null` there); `pnpm --filter @bis/db typecheck`; `pnpm --filter web typecheck`. Factory check: `listTimelinePage`, `groupActivityMembers`, `groupFacts`, `groupNextUp` added to every `vi.mock("@bis/db")` reaching `group-loaders.ts`. Commit `feat(contacts): one timeline across a household's members, the facts and Next up for them, and the cap said in words (S-03 part 2b)`.

---

## Task 17: The page's middle column, Deals on the activity set, the contact header's link (bis-crm)

**Review:** opus.

**Files:** `apps/web/src/lib/record/record-cards.ts` (+ test), `…/groups/{page,loading}.tsx` (+ tests), `…/groups/group-timeline.tsx` (+ `group-timeline.test.ts`), `…/contacts/[contactId]/page.tsx` (+ `page.test.ts`).

- [ ] **Step 1: Failing tests.**
  - `record-cards.test.ts`: `GroupRecordCardId` gains `"summary" | "next-up" | "timeline"`; the phone order is exactly `["summary", "next-up", "timeline", "properties", "deals", "people", "details"]`, runs `["happening", "have", "who"]` (probe: swap people's and timeline's phoneOrder → FAILS).
  - `group-timeline.test.ts`: rows render on `TimelineItem` with the subject first, then the mark; a call row keeps "Open call"; there is no composer, no add-To-do form, no Done button, no assignee picker and no hold hint in the markup (probe: render `ActivityTimeline` instead → FAILS on the composer); the empty sentence is `groupPage.timeline.empty`; `failedText` shows with Try again; one pager.
  - Group `page.test.ts` (extended): the summary, Next up and timeline each fail alone (each loader's mock rejects in turn; the others still render) (probe: one shared try → FAILS); the timeline's, facts' and Next up's sources receive exactly `groupActivityMembers`' ids (probe: pass the first People page's ids → FAILS, seeded so the two differ); Deals now reads the activity set (C13); the cap line node `data-group-capped` renders once, first in the middle column, only past 50, and is absent when the scan failed; a narrow reader's facts read "people you can see".
  - Contact `page.test.ts`: `subtitleHref` is `/dashboard/accounts/acct1/groups/<mainGroup.id>` for the MAIN group (probe: the first group instead of the main one → with the main second in the list, FAILS).
  - `loading.test.ts`: seven cards in the new phone order; the timeline loads as `TimelineItemSkeleton` rows.
  Run → red.
- [ ] **Step 2: Implement.** `GROUP_RECORD_CARDS` gains the spec §7 rows `summary` (happening 1/1, `record.card.summary`, 1), `next-up` (happening 2/2, `record.card.nextUp`, 3), `timeline` (happening 3/3, `record.card.activity`, 5). `group-timeline.tsx`: `GroupTimeline({ rows, failedText, emptyText, pager, accountId, tr })`, the read-only twin of `ActivityTimeline`'s list (`activity-timeline.tsx:95-131`) and row bodies (`:136-232`) with each `TimelineItem` given `subject={row.subject ?? undefined}` and these removed: the composer, the add-To-do form, the task's Done/hold action and the assignee field (C7). The page: after `readGroup`, `const activity = await loadGroupActivity(db, accountId, group.id)`; `ids = activity.status === "ready" ? activity.activity.people.map((p) => p.contactId) : null`; then in the existing `Promise.all`: `loadGroupSummary`, `loadGroupNextUp`, `loadGroupTimeline` on `ids` (each card's error when `ids` is null), and `loadGroupDeals(db, accountId, async () => { if (!ids) throw new Error("no activity set"); return activity.activity.people; })`. Names: `Object.fromEntries(people.map((p) => [p.contactId, memberName(p, tr)]))`; first names for facts and Next up via `memberFirstName`; subjects `{ [id]: { label: memberName, href: \`/dashboard/accounts/${accountId}/contacts/${id}\` } }`. The middle column's content is `[capLine ? <p data-group-capped className="text-sm text-muted-foreground">{capLine}</p> : null, ...cards]` (plan deviation 12). Narrow is `!seesWholeAccount(access)`. Timeline pager: `timelinePagerHrefs({ basePath, older, paged: Boolean(before), failed, locale: localeParam })` with `before = parseTimelineCursor(beforeParam)` (`?before=`). Empty states: `groupPage.nextUp.empty` (and no "Add a To-do": `addTodoLabel={null}`), `groupPage.timeline.empty` on the head with nothing failed. Contact page (`[contactId]/page.tsx:161-164`, `:274`): `subtitleHref={mainGroup ? \`/dashboard/accounts/${accountId}/groups/${mainGroup.id}\` : undefined}`.
- [ ] **Step 3: Green.** By path: the group page and loading tests, `group-timeline.test.ts`, `record-cards.test.ts`, the contact `page.test.ts` and `loading.test.ts`, `request-locale-callers.test.ts`, `in-account-service-reads.test.ts`, `ratchet.test.ts`; typecheck; eslint. Probes by name. Commit `feat(contacts): the household's merged activity, its facts and what is next, and the way in from each member's page (S-03 part 2b)`.

---

## Task 18: e2e via the links, and the fact line's overflow (bis-e2e-qa)

**Review:** sonnet. Run by the orchestrator only.

- [ ] **Step 1.** Extend `group-page.spec.ts`'s `beforeAll`: a receptionist call for Ana (`record-page.spec.ts:80-86`'s `assignPhoneNumber`/`startCallRow`/`finishCallRow` with `contactId: made.ana`), a booking-page booking for Luis (`:71-77`'s `getOrCreateCalendar` + `createBooking(…, "public", "system")`, sixty days out), and a note for Maria written with the e2e user's Clerk id (**corrected 2026-10-13 (final review):** the AGENCY user's, `e2e/.auth/agency-fixture.json`'s `clerkUserId`, read as `preferences.spec.ts:48-52` does, because the spec runs as `agency_admin` (playwright.config's storageState); the client fixture's id reads "E2E Client", not "You". `addNote(db, accountId, made.maria, "…", agencyClerkUserId())`: the service role's insert keeps it, `app.notes_author_guard` rewrites only an `authenticated` insert, `0073_record_provenance.sql:118-122`). `afterAll` adds, in order: the call, its number, the booking (`on delete restrict`, before the contacts), then today's steps.
- [ ] **Step 2.** New tests: from Ana's page the header's household words (`[data-record-subtitle]`, now a link) open the group page, and so does the Groups card's Open (`[data-group-open]`); on the group page the three seeded rows appear, each with its member AND its mark: "Ana García <stamp> · Sofía · AI", "Luis García <stamp> · Customer", "Maria García <stamp> · You" (read the persona and the mark words from `m`, not literals); the summary reads "3 people"; Next up names Luis; under `?locale=es` a row reads "Cliente" and the fact "3 personas".
- [ ] **Step 3.** `i18n-overflow.spec.ts`: the group page's fact line (`[data-record-facts]`) joins the measured set.
- [ ] **Step 4.** e2e typecheck, `fixture-names.test.ts`; commit `test(e2e): the household page from its members' pages, every row naming its person and its author (S-03 part 2b)`.

---

## Task 19: DESIGN.md and the ledger (orchestrator)

- [ ] **Step 1.** Land in `DESIGN.md`'s "Record page" paragraph, appended after "…then who they are.": "A household or a business has its own record page on the same kit (decided 2026-10-13): it is a record, reached from its members' pages, not a new top-level surface." (spec §15; with 2b, because "reached from its members' pages" is true only once the links ship, R2).
- [ ] **Step 2.** File in the ledger: the `contactDisplayName` locale follow-up (spec §16.2), the "Past 500 members" and "proxy activity" risks (§13), and plan deviation 9's unknown-total case.

---

## Task 20: Whole-branch review, PR 2b (reviewer, opus)

- [ ] As Task 9, for 2b's rows of the coverage table. Hunt: a source that still `.eq`s the first id of a set; a `TimelineEntry` without `contactId`; the qualifier shown on any condition but `narrow`; a hidden count anywhere in the web layer; the cap line inside a card; a write affordance on the group timeline; the contact drawer's `/summary` route changed (it must not be, C6); Spanish leaks. Run the web tests by path and `pnpm --filter web typecheck`; the db tests are CI's.

## Task 21: Rollout 2b (orchestrator)

- [ ] **1.** Gates one at a time (`pnpm check`, build, e2e), push, read the HEAD SHA's check runs, open PR 2b, squash-merge with the SHA pinned. No migration (dry run unnecessary; the e2e migration check passes with 0075 already on bis-ci).
- [ ] **2.** Deploy READY at the merge SHA; served-HTML markers: a `data-timeline-subject` on a group timeline row, and an `href` to `/groups/` in a contact page's header. Rollback: revert (the page goes back to URL-only). Update the tracker.

---

## Self-review against the spec

| Spec | Covered by |
|---|---|
| §1 goal; D1 route on the kit, no nav, own card list | Task 4 (`GROUP_RECORD_CARDS`), Task 7 (route), Task 17 (full list) |
| D2 / C15 / R2 entry links, for every reader who sees the group, in 2b | Task 15 (Groups card Open, `RecordHeader.subtitleHref`), Task 17 (contact header link), Task 18 (e2e) |
| D3 / C6 / C8 merged timeline, member named first, mark kept | Tasks 11–14 (set forms), Task 16 (`listTimelinePage`, `timelineRows` subjects), Task 15 (`TimelineItem.subject`), Task 17 (`GroupTimeline`), Task 18 |
| D4 / C1 / R1 header to the call-first member; none → hidden; Directions order | Task 1 (0075), Task 2 (`listGroupMembers.primary`), Task 4 (`groupHeaderActions`, `firstGroupMapUrl`), Task 7 (page), Task 8 (e2e) |
| D5 / C7 no composer; read-only timeline | Task 17 (`GroupTimeline`, test probe "reuse ActivityTimeline"), Task 16 (no hold read) |
| D6 cards and their columns | Task 4, Task 17 (registry), Tasks 5–7, 16–17 (bodies) |
| D7 / C5 ≤50, primary first then most recent, the cap line | Task 16 (`groupActivityMembers`, `groupCapLine`), Task 17 (cap node, plan deviation 12) |
| D8 / C4 Technician via RLS; "you can see" for every narrow reader; no hidden count | Task 1 (RLS SQL cases), Task 16 (`groupFactsView` takes no hidden count), Task 17 (narrow from `seesWholeAccount`) |
| D9 / C16 states; 404 before any read | Task 7 (page test's two 404 cases), Tasks 6, 16, 17 (empty, error, loading per card) |
| D10 English and Spanish | Tasks 4, 15, 16 (keys and twins), Tasks 6, 7 (copy through `t()`, `memberName`), Task 8/18 (`?locale=es`) |
| D11 / §15 DESIGN.md sentence, with 2b | Task 19 |
| D12 / R1 / R2 two PRs; 0075 with 2a | Task list; Tasks 10, 21 |
| D13 testing: merge with member named; cap; primary-or-hidden; Technician; 404; e2e on fixture | Tasks 1, 2, 4, 7, 8, 16, 17, 18 |
| C2 call-first chosen by managers only; no prompt for a Technician | Task 3 (action refusal before any read), Task 6 (no prompt, no button), Task 1 deviation 1 (Business-name Undo) |
| C3 People reuses the Groups card's actions; Remove managers-only on this page | Task 6 (handlers call the same actions; Remove only when `manager`) |
| C9 Last talked names the member | Task 16 (`groupFacts.lastTalked.contactId`, `groupFactsView`) |
| C10 People pages by join order, own `?people=` cursor, primary pinned, one pager | Task 2 (`listGroupMembers`), Task 4 (`peoplePagerHrefs`), Task 6 (card), deviation 3, 4, 14 |
| C11 / R3 kind words everywhere; part 1's header line changed | Task 4 (messages and the contact page test) |
| C12 Properties: the group's own places, group subject, no Move to | Task 2 (`listGroupPlaces`, `PlaceCtx.subjectKind`), Task 3 (actions, route), Task 5 (card), deviation 7 |
| C13 Deals of the same ≤50, newest, 30 shown, exact count, person named | Task 2 (`listOpenDealsFor`, `listGroupPeople`), Task 7 (Deals slot), Task 17 (activity set), deviation 5 |
| C14 Text gate for the primary; ledger only after `getContact` | Task 7 (`loadPrimaryText`, call-order tests) |
| C17 loading is the route's | Task 7 (`loading.tsx`), Task 17 (seven cards) |
| §5 0075: index, function, grants, no policy change, restore, cases table, sync not firing, rollback | Task 1 (every case a test), Task 10 (rollout) |
| §6 queries 2a and 2b, head counts fail closed | Tasks 2, 11–14, 16 |
| §8.1–§8.10 screens, keyboard, phone, overflow | Tasks 5–7, 15–18; overflow in Tasks 8, 18 |
| §9 copy, `contact.noName.es` | Tasks 4, 15, 16 |
| §10 errors; new write; narrow Undo honours `wasPrimaryContact`; allowlist | Task 2 (payload), Task 3 (action and restore), Task 7 (allowlist) |
| §11 tests with probes | every task's Step 1 |
| §12 rollout order, measurement, markers | Tasks 10, 21 |
| §14 needs from other agents | Tasks 1 (bis-db-schema), 12 (bis-comms), 13 (bis-booking), 14 (bis-voice), 5 and 15 (bis-frontend), 8 and 18 (bis-e2e-qa) |
| §16.2 follow-ups | Task 19 |

Placeholder scan: no "TBD" or "similar to Task N". Two steps say "write each body in full" over comment-described cases (Task 6 Step 1, Task 7 Step 4): the comment names the exact mock and assertion; the implementer writes them out. Task 2's deals case marks the one call whose signature this plan did not read (`createOpportunity`) and tells the implementer to read it first.

Type and name consistency checked across tasks: `GroupMember`, `GroupMembersPage`, `GroupPerson`, `GROUP_MEMBERS_PAGE_SIZE`, `GROUP_ACTIVITY_CAP`, `GROUP_ACTIVITY_SCAN`, `listGroupMembers`, `countGroupMembers`, `listGroupPeople`, `setGroupPrimaryContact`, `setGroupPrimaryContactAction`, `GroupMemberSnapshot.is_primary_contact`, `wasPrimaryContact`, `listGroupPlaces`, `PlaceCtx.subjectKind`, `PlaceSubjectArg`, `PlacesResponse.group`, `placesRouteFor`, `OpenDealRow`, `GROUP_DEALS_SHOWN`, `listOpenDealsFor`, `RecordCardDef<Id>`, `GroupRecordCardId`, `GROUP_RECORD_CARDS`, `cardsInPhoneOrder(cards)`, `columnRuns(cards)`, `headerActions({ composeHref })`, `memberName`, `memberFirstName`, `firstGroupMapUrl`, `groupHeaderActions`, `peoplePagerHrefs`, `PEOPLE_ANCHOR`, `peopleHandlers`, `groupErrorText`, `PeopleRow`, `PeopleCardView`, `PeopleCard`, `DetailsCardView`, `DetailsCard`, `PeopleLoad`, `GroupDealsLoad`, `loadGroupPeople`, `loadGroupDeals`, `loadGroupHeaderPlaces`, `loadPrimaryText`, `forContacts`, `listTimelinePage`, `TimelineEntry.contactId`, `GroupActivity`, `groupActivityMembers`, `GroupFacts`, `GroupLastTalked`, `groupFacts`, `GroupNextUp`, `groupNextUp`, `countBookingsMadeFor`, `UpcomingBooking.contact_id`, `ContactBookingRow.contact_id`, `ContactCallRow.contact_id`, `TimelineRow.subject`, `NextUpRow.who`, `groupFactsView`, `groupCapLine`, `GroupTimeline`, `TimelineItemProps.subject`, `RecordHeader.subtitleHref`. SQL: `client_group_members.is_primary_contact`, `client_group_members_one_primary_contact`, `public.set_group_primary_contact(uuid,uuid,uuid)`, `app.restore_member(uuid,jsonb)`, `public.undo_set_business(uuid,uuid,uuid,jsonb)`.

## Spec gaps and conflicts found while planning (for the ledger)

1. **The Business-name Undo would have forged the call-first flag** (deviation 1). Spec §5 replaces `app.restore_member` to honour the snapshot, but a second caller, `undo_set_business`, feeds it a browser snapshot from any reader (`…/contacts/actions.ts:201-221` → `0069:343`). Planned: 0075 strips the key there, with a schema test.
2. **`for update` on the group row would queue every member insert** (deviation 2). Planned `for no key update`.
3. **§6 reads the call-first member on the first page only**, but the header needs them on every page (deviation 3).
4. **§11.1's e2e says Properties and Deals sit "under People" at 390px**; §7 and DESIGN.md put them above (deviation 13).
5. **A failed head count would either zero the people fact or blank the middle column.** §6 returns `total: number`; planned as `Fact<number>` (deviation 9). Open risk: with the count failed and ≥50 people scanned, no cap line shows while the cards hold 50 people's activity. Rare (a count failing while the scan succeeded); recorded, not designed around.
6. **The cap line's place.** §8.6 says both "under the facts" and "at the top of the middle column … on every width"; planned as its own node so a failed summary does not hide it (deviation 12).
7. **`listOpenDealsFor` and the activity set's names** cannot come from an `opportunities → contacts` embed safely (0050 fixed ambiguous opportunity embeds before); planned from the people set (deviation 5).
8. **Not measured while planning:** the largest group's member count on bis-ci and production (§12), and the `contacts → conversations` embed's single path (§6, an Assumption the live test proves). Both are Task 10 step 1 and Task 16's live test.
9. **No supabase-js Technician client in the db suite** (as 1b's deviation 9): the page's reads under RLS are pinned in SQL under `actAs` (deviation 10).
10. **§10 lists the page itself on the service-read allowlist**, but the scan fails on a stale entry, and the page names no getter once the ledger read lives in `loadPrimaryText`; planned as the loader's entry (deviation 15).
11. **§11.1's "a Technician with one of three members"** reads the same on `client-groups-rls.test.ts`'s existing seed, whose shared household has two members (`:31-40`): one theirs, one someone else's. Not a behaviour change; recorded so a reviewer does not look for a third row.
