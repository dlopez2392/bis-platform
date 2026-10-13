# The contacts list drawer on the record kit (S-03 part 3): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The contact list's drawer becomes the record's quick look on the record kit: the record's header (Call the one primary; Text and Email open the record page's composer), the checked facts, Next up without "Add a To-do", the five newest timeline rows each with its author mark, and who they are (the inline fields, Business name, the Texts and Email rows, Source, Assigned to, Tags), in flat sections that each load, empty and fail on their own; Groups, Properties and Related people leave the drawer for the full record. The who-they-are panels read English or Spanish on both the drawer and the record page.

**Architecture:** One PR, no migration (spec D9). The `/summary` route is rewritten to build every read-only string on the server, in the locale it resolves once (C1), from the record page's own loaders and view builders (`loadSummary`, `loadNextUp`, a new `loadRecent`, `loadTags`, `loadHeaderPlaces`, `softSmsGate`, `smsRecipientState` on the ledger client after `getContact`), each section with its own `{status}`; the drawer parses it per section (`parseDrawerSummary`), wraps its body in `LocaleProvider locale={body.locale}`, and draws the sections with the kit's new flat `RecordSection` and `RecordHeader`'s drawer form. The bilingual pass converts the who-they-are client components from `m[…]` to `t(m, …, locale)` and adds the missing `.es` twins.

**Tech Stack:** Next.js 16 App Router (route handler, client components), React 19.2, Radix Dialog (the Sheet), Tailwind v4 tokens, vitest (`renderToStaticMarkup`, no DOM; `vi.mock`), Playwright (bis-e2e-qa writes it, the orchestrator runs it).

**Spec:** `docs/superpowers/specs/2026-10-13-record-drawer-design.md` (commits `82ee8aec` + `f1405cf5`, OWNER-APPROVED 2026-10-13: Q1–Q5 as recommended; orchestrator rulings: `lib/consent/texts-row.ts` and `email-row.ts` are bis-crm's; bis-frontend adds the Sheet's `closeLabel`; the two §17 DESIGN.md sentences land in this PR; server-action error strings stay English; the read count is measured). Base: `619a9b75` (#253). Every file:line below was read off this worktree at `f1405cf5`; anything not read is labelled **Assumption**.

`<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s03-drawer` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s03-drawer`). `…/contacts/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/`. `…/summary/` = `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/`.

## Global Constraints

- **Ownership (tag on every task; no task edits a file its owner does not own).**
  - **bis-crm:** `…/contacts/contact-drawer.tsx` and `contact-drawer.wiring.test.ts`; `…/summary/route.ts` and `route.test.ts` (rewritten) and the new `route.reads.test.ts`; `apps/web/src/lib/record/{header-actions,loaders,recent-rows}.ts` and their tests; `apps/web/src/lib/contacts/{drawer-summary,lead-source}.ts` and their tests (and the deletion of `lib/contacts/summary.ts` + `summary.test.ts`); `lib/consent/texts-row.ts`, `lib/consent/email-row.ts` and their tests (orchestrator ruling); `…/contacts/{texts-row,email-row,source-field,business-field}.tsx` and their tests; `…/contacts/[contactId]/{contact-fields-panel,summary-card,page}.tsx` and `page.test.ts`; `…/accounts/[accountId]/in-account-service-reads.test.ts` (one line); `apps/web/src/lib/messages.ts` (keys under `drawer.*` and the `.es` twins of spec §10.3); `apps/web/src/lib/i18n/{catalogue-baseline,ratchet-baseline}.json` (regenerated, never hand-edited).
  - **bis-frontend:** `apps/web/src/components/record/{record-header,record-card-boundary,record-section}.tsx` and their tests; `apps/web/src/components/ui/sheet.tsx` (the `closeLabel` prop) and a new `sheet.test.ts`; `apps/web/src/components/assign/assignee-field.tsx` and a new `assignee-field.locale.test.ts`; `apps/web/src/app/(dashboard)/dashboard/styleguide/record-demo.tsx` and `record-demo.test.ts`.
  - **bis-e2e-qa:** `apps/web/e2e/{contacts-drawer,consent-phone-country,places,i18n-overflow}.spec.ts`.
  - **Orchestrator:** `DESIGN.md` (the two §17 sentences), the ledger, the gates, the PR.
- **Shared files, one task at a time, in this order.**
  - `apps/web/src/lib/messages.ts`: **Task 3 (the 62 twins) → Task 6 (the `drawer.*` keys)**. Each task's messages.ts step is its LAST code step and starts only after the previous one in the chain has committed. A `.es` twin goes on the line directly under its English key; a new key goes beside its namespace's existing keys (the `drawer.*` block, `messages.ts:836-855`).
  - `…/contacts/[contactId]/page.tsx`: **Task 2 (`headerActionLabels`) → Task 3 (the `lang="en"` wrappers)**.
  - `…/contacts/contact-drawer.tsx` and `contact-drawer.wiring.test.ts`: **Task 6 only.**
  - `apps/web/src/lib/i18n/*-baseline.json`: **Task 7 only**, after Tasks 3 and 6 have committed.
- **DESIGN.md definition of done for every UI task (1, 3, 4, 6):** tokens only, no hard-coded colours, radii or shadows (dots `bg-[var(--accent|good|warn|crit|text-3)]`, rules `border-[var(--row-line)]` inside a section and `border-[var(--line)]` between sections, radii `rounded-full` / `rounded-[var(--radius-ctl)]` / `rounded-xl`); both themes via the `.dark` class; the blur fallback is the Sheet's own (`glass-overlay`), and **no glass card inside the glass Sheet** (D9); rule 3, every status a dot and a word; rules 5 and 7, every section has loaded, empty and error states and loads as a skeleton shaped like its content, never a spinner; rule 8, Call is the ONE primary in the drawer's header and every other control in the drawer is ghost (an inline form keeps its own); a visible `:focus-visible` ring on every link and button (`outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50`); controls `min-h-11 md:min-h-8` on a phone; Esc keeps today's rule (`contact-drawer.tsx:174-183`); nothing animates on scroll.
- **Copy:** every new string through `t()` / `makeTr` with an `.es` twin in the same commit (the ratchet, `lib/i18n/ratchet.test.ts:192-195`, admits no new key without one). New `.tsx` code carries NO JSX literal copy (`ratchet.test.ts:184-190`). Usted, trades Spanish, the spec's §10.3 and §11 words verbatim. No `{{…}}`, no milestone codes (`INTERNAL_MILESTONE`), no vendor jargon. Typed text (a note, a text, a tag, a name, a To-do title) shows as typed with `lang=""`. A call summary's model prose is `lang="en"`.
- **Every test can fail.** Each test names the mutation that breaks it. Run the probe, see the test fail BY NAME, paste the failing assertion line into the report, revert. A `-t` filter that matches nothing passes silently: check the run count in vitest's summary.
- **The `vi.mock("@bis/db")` factory check.** A task that adds a NEW named import from `@bis/db` to an existing module adds that name to every factory reaching the module: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module basename>"`.
- **Running tests.** Only the affected tests, by path: `pnpm --filter web exec vitest run "<path>" …`, `pnpm --filter web typecheck`, `pnpm --filter web exec eslint "<touched files>"`. **No `@bis/db` vitest at all** (this plan changes nothing in `packages/db`; keep db tests out of local runs). **Never run the gates** (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) and never Playwright: the orchestrator runs them, one at a time. Never pass the folder `…/accounts/[accountId]/` to vitest (it holds `calls/[callId]/actions.test.ts`, a live test). A task that changes a shared function's signature runs EVERY test that references it (`grep -rln "<fn>" apps/web/src`).
- **Mutating e2e only on the per-run fixture account** (`e2e/.auth/client-fixture.json`), never `Test Client One`; every seeded row deleted in `afterAll`/`finally`, each error checked; a person's `users.language` restored in `finally`.
- **Commits:** `git add -- <new files>` then `git commit -m "<type>(<scope>): <what and why>" -- <every path>`. Never `-A` or `.`. **Never `git stash`, never `--amend`.** If `.git/index.lock` exists, wait and retry; never delete it. Never push. Never touch `main`. Trailer lines on every commit: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`.
- **Never** apply a migration (there is none), mutate Test Client One, create or edit `.env*`, call a real provider.

## Where this plan departs from the spec's wording (the source decided)

1. **62 keys gain a Spanish twin, not 63** (spec §10.3). `compose.smsHeld` already has one (`messages.ts:1160-1161`, "Los textos a esta persona están en pausa mientras revisa si pidió que se detuvieran."); a second `"compose.smsHeld.es"` would be a duplicate key. It stays as it is (`compose.*` is bis-comms' namespace); bis-comms' review (Q5) decides whether "en pausa" should read "en espera" to match `contact.texts.held.es`. Counted with a script over the spec's table against `messages.ts` and `catalogue-baseline.json`: 63 rows, 62 without a twin, all 63 on the frozen list.
2. **`who.fields` is in the body** (spec §7.2 deletes `phone` from the body). Q1 was decided as recommended: "Feed `FIELDS` from the route's contact when the row is the stub". The route therefore sends `who.fields = { first_name, last_name, email, phone, company_name }`, read off the same `getContact` row, and the drawer uses it only when the list row is the stub (`created_at === ""`, `contacts-table.tsx:41-46`). Until that body arrives, a stub row's fields show skeleton lines, never blank editable fields.
3. **A new key, `drawer.close`** ("Close" · "Cerrar"), is not in spec §11. The Sheet's `closeLabel` (orchestrator ruling) needs a word, and the catalogue has no "Close" (`grep '"common.close\|Cerrar' messages.ts` → nothing).
4. **`RecordCardBoundary` gains an optional `onReset`** (spec C4 reuses it unchanged). Its reset is hard-wired to `router.refresh()` (`record-card-boundary.tsx:40`), which inside the drawer would re-read the list behind it; `RecordSection` passes its `onRetry`. Absent, today's refresh.
5. **`data-drawer-section` sits on a wrapper the drawer draws around each `RecordSection`**; the kit section itself carries `data-record-section` (a kit piece does not name its one caller). The wrapper's `data-state` is the section's load (for `who`, the route's `who` part, while the fields above Source are already editable).
6. **The `/styleguide` specimen of the drawer header sits in a Sheet-styled frame (`glass-overlay`), not an open Sheet** (spec §8.1: "inside a Sheet"). Radix's `Dialog.Title` throws outside a `Dialog` (`SheetTitle`, `sheet.tsx:114-125`), and an open Sheet would cover the styleguide; the specimen shows the header without `wrapHeading`.
7. **The route's Spanish test uses an account in Spanish and a client with no language of their own** (spec §12.1: "a Spanish person's body … probe: pass `isOperator: true` for a client → FAILS"). With the person's own `users.language` set, both branches of `requestLocale` answer Spanish (`request-locale.ts:61-63`), so that probe could not fail; the account's language is what `isOperator` decides.
8. **The Texts row's "Permitido" render case lives in `texts-row.test.ts`, not `page.test.ts`** (spec §12.1). `page.test.ts` mocks `../texts-row` (`page.test.ts:144-148`), so the page's own render never draws the row's words.
9. **The scroll check (`contacts-drawer.spec.ts:771-821`) measures the bottom "Open full record" link, not the last recent row** (spec §12.2 says it "keeps its hooks"). Recent now sits ABOVE Details (spec §9's order), so after scrolling to the bottom of a drawer whose six tags overflow it, the last recent row is above the fold by design; the last element in the scroller is the bottom link.
10. **The read count is measured as an exact count of `from()`/`rpc()` calls through a recording client** (a unit test over the real `@bis/db` readers), plus wall time annotated by the e2e on the per-run fixture account (spec §5: "the plan measures it on the replica"). A PG18 replica runs SQL, not supabase-js through the route; the count is deterministic, and the wall time comes from the real stack.
11. **`setup.rename.empty` gains its twin, but `InlineField` still reads it in English** (`inline-field.tsx:40`, `normalizeRequired` takes no locale). No drawer or panel field is `required`, so nothing on these screens shows it; reported, not fixed (bis-frontend's file).
12. **Left English, outside spec §10.3's list (reported):** `contact.phoneCountry.word` ("Check number", `lib/contacts/phone-country.ts:16`), the pick's toasts (`.mxToast`, `.usToast`, `.undoBusy`, `.failed`, `.changed`), `contact.texts.changed`, and the assignee toasts in `components/assign/assign-handlers.ts`. A Spanish drawer on an ambiguous number reads "Check number" in English.

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `apps/web/src/components/record/record-section.tsx` (+ `.test.ts`) | bis-frontend | the flat section: mono label, `--line` rule, the card's skeleton, error and boundary, `onRetry` required |
| `apps/web/src/components/record/record-card-boundary.on-reset.test.ts` | bis-frontend | the boundary's `onReset` |
| `apps/web/src/components/ui/sheet.test.ts` | bis-frontend | the close button's `closeLabel` |
| `apps/web/src/components/assign/assignee-field.locale.test.ts` | bis-frontend | the picker's words in Spanish |
| `apps/web/src/lib/record/recent-rows.ts` (+ `.test.ts`) | bis-crm | `RecentRowView`, `recentRowsView` |
| `apps/web/src/lib/contacts/drawer-summary.ts` (+ `.test.ts`) | bis-crm | `DrawerSummary`, `parseDrawerSummary`, `drawerLoadFrom`, `drawerSummaryUrl`, `drawerFieldsRow` |
| `…/summary/route.reads.test.ts` | bis-crm | the measured read count |

**Deleted:** `apps/web/src/lib/contacts/summary.ts`, `apps/web/src/lib/contacts/summary.test.ts` (Task 6).

**Modified:** `components/record/{record-header,record-card-boundary}.tsx`, `record-header.test.ts`, `components/ui/sheet.tsx`, `components/assign/assignee-field.tsx`, `styleguide/record-demo.tsx` (+ test); `lib/record/{header-actions,loaders}.ts` (+ tests); `lib/contacts/lead-source.ts` (+ test); `lib/consent/{texts-row,email-row}.ts` (+ tests); `…/contacts/{texts-row,email-row,source-field,business-field,contact-drawer}.tsx` (+ tests); `…/contacts/[contactId]/{contact-fields-panel,summary-card,page}.tsx`, `page.test.ts`; `…/summary/route.ts`, `route.test.ts`; `…/accounts/[accountId]/in-account-service-reads.test.ts`; `lib/messages.ts`; `lib/i18n/{catalogue,ratchet}-baseline.json`; `apps/web/e2e/{contacts-drawer,consent-phone-country,places,i18n-overflow}.spec.ts`; `DESIGN.md` (orchestrator).

## Task list, owners, order

| # | Task | Owner | Review | Depends on | Files (disjoint per wave) |
|---|---|---|---|---|---|
| 0 | Confirm the base | orchestrator | n/a | — | none |
| 1 | Kit: `RecordHeader` drawer form, `RecordCardBoundary.onReset`, `RecordSection`, Sheet `closeLabel`, styleguide | bis-frontend | sonnet | 0 | `components/record/*`, `components/ui/sheet*`, `styleguide/record-demo*` |
| 2 | `headerActionLabels` (page switched), `recentRowsView`, `loadRecent`, `contactSourceHint(…, locale)` | bis-crm | sonnet | 0 | `lib/record/{header-actions,recent-rows,loaders}*`, `lib/contacts/lead-source*`, `[contactId]/page.tsx` |
| 4 | `assignee-field.tsx` reads `t()` | bis-frontend | sonnet | 0 | `components/assign/assignee-field*` |
| 3 | Bilingual who-they-are (page and panels), the page's wrappers, 62 twins (**messages.ts #1**) | bis-crm | **opus** | 2 | `lib/consent/{texts,email}-row*`, `…/contacts/{texts-row,email-row,source-field,business-field}*`, `[contactId]/{contact-fields-panel,page}*`, `messages.ts` |
| 5 | The route and its parser | bis-crm | **opus** | 2 | `…/summary/route*`, `lib/contacts/drawer-summary*`, `lib/contacts/summary.ts` (type moved in), `in-account-service-reads.test.ts` |
| 6 | The drawer (**messages.ts #2**) | bis-crm | **opus** | 1, 3, 4, 5 | `contact-drawer*`, `[contactId]/summary-card.tsx`, `lib/contacts/summary*` (deleted), `messages.ts` |
| 8 | Measure the reads per open | bis-crm | sonnet | 5 | `…/summary/route.reads.test.ts` |
| 7 | Regenerate the i18n baselines | bis-crm | sonnet | 3, 6 | `lib/i18n/*-baseline.json` |
| 9 | e2e | bis-e2e-qa | sonnet | 6, 7 | the four specs |
| 10 | DESIGN.md §17 sentences; ledger follow-ups | orchestrator | n/a | 6 | `DESIGN.md` |
| 11 | Whole-branch final review (checkpoint, not an implementer task) | reviewer | **opus** | 7, 8, 9, 10 | none |

**Dependency graph (lanes on disjoint files, 2–3 at a time).**

```
Wave A (three lanes):   T1 (bis-frontend)   T2 (bis-crm)   T4 (bis-frontend, second instance or after T1)
Wave B (two lanes):     T3 (bis-crm, after T2)   T5 (bis-crm, after T2)
Wave C (two lanes):     T6 (bis-crm, after T1, T3, T4, T5)   T8 (bis-crm, after T5; one new file)
Wave D:                 T7 (after T3 and T6)   T10 (orchestrator, after T6)
Wave E:                 T9 (after T6, T7)
Checkpoint:             T11 (after T7, T8, T9, T10)
```

T3 and T5 never touch the same file: T3 owns `lead-source` callers on the client and `messages.ts`; T5 calls `contactSourceHint(…, locale)` which Task 2 already shipped. T6 and T8 never touch the same file. T2 commits `page.tsx` before T3 starts.

---

## Task 0: Confirm the base (orchestrator)

- [ ] **Step 1.** In `<WT>` (branch `feat/s03-drawer`): `git log --oneline -3` → `f1405cf5 S-03 part 3 spec: owner rulings on Q1–Q5`, `82ee8aec …`, `619a9b75 …`. `git fetch origin` then `git log --oneline origin/main -1`; if `main` moved past `619a9b75`, `git merge origin/main` and re-run Step 2.
- [ ] **Step 2.** Confirm, and stop if any line differs:
  - `grep -c "RecordSection\|record-section" -r apps/web/src` → `0`.
  - `grep -n "back: { href: string; label: string }" apps/web/src/components/record/record-header.tsx` → `15:` (back is required today).
  - `grep -n '"drawer\.' apps/web/src/lib/messages.ts | wc -l` → `10`.
  - `grep -rn "parseContactSummary\|summaryLoadFrom" apps/web/src --include=*.ts --include=*.tsx -l` → `contact-drawer.tsx`, `lib/contacts/summary.ts`, `lib/contacts/summary.test.ts`, `…/summary/route.test.ts`.
  - `ls packages/db/supabase/migrations | tail -1` → `0075_group_primary_contact.sql` (no migration in this PR).

---

## Task 1: The kit's drawer pieces and the Sheet's close label (bis-frontend)

**Review:** sonnet. **Runs beside:** Tasks 2 and 4.

**Files**
- Modify: `apps/web/src/components/record/record-header.tsx:14-46`
- Modify: `apps/web/src/components/record/record-header.test.ts` (append a `describe`)
- Modify: `apps/web/src/components/record/record-card-boundary.tsx:33-44`
- Create: `apps/web/src/components/record/record-card-boundary.on-reset.test.ts`
- Create: `apps/web/src/components/record/record-section.tsx`, `record-section.test.ts`
- Modify: `apps/web/src/components/ui/sheet.tsx:48-92`
- Create: `apps/web/src/components/ui/sheet.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/styleguide/record-demo.tsx:1-108`, `record-demo.test.ts:29-35` (+ one new case)

**Interfaces**
- Consumes: `RecordCardSkeleton`, `RecordCardError`, `RecordCardState` (`record-card.tsx:15-46`); `RecordCardBoundaryCore` (`record-card-boundary.tsx:10-25`).
- Produces (Task 6 relies on these exact names):
  - `RecordHeader` props: `back?: { href: string; label: string }` (optional now); `headingLevel?: 1 | 2` (default 1); `wrapHeading?: (heading: ReactElement) => ReactNode`; `trailing?: ReactNode`. Everything else unchanged.
  - `RecordCardBoundary` props gain `onReset?: () => void` (default `() => router.refresh()`).
  - `RecordSection(props: { id: string; label: string | null; state: RecordCardState; errorText: string; retryLabel: string; onRetry: () => void; skeletonRows?: number; skeleton?: ReactNode; children?: ReactNode })`, root `<section data-record-section={id} data-state={state}>`.
  - `SheetContent` prop `closeLabel?: string` (default `"Close"`).

- [ ] **Step 1: Write the failing tests.**

Append to `apps/web/src/components/record/record-header.test.ts`:

```ts
describe("RecordHeader's drawer form (S-03 part 3 §8.1)", () => {
  const drawer = (over: Partial<Parameters<typeof RecordHeader>[0]> = {}) =>
    renderToStaticMarkup(createElement(RecordHeader, {
      name: "Ana García", subtitle: null, actions: ALL, headingLevel: 2,
      trailing: createElement("a", { href: "/dashboard/accounts/a1/contacts/c1", "aria-label": "Open full record" }, "↗"),
      ...over,
    }));

  it("no back link when none is given (mutation: render the Link unconditionally -> FAILS)", () => {
    const html = drawer();
    expect(html).not.toContain('href="/dashboard/accounts/a1/contacts"');
    expect(html.match(/<a /g)).toHaveLength(5); // the trailing link and the four actions, nothing else
  });

  it("the name is an h2, never a second h1 over a page that has one (mutation: hard-code h1 -> FAILS)", () => {
    const html = drawer();
    expect(html).not.toContain("<h1");
    expect(html).toMatch(/<h2[^>]*title="Ana García"[^>]*>Ana García<\/h2>/);
  });

  it("wrapHeading wraps exactly the heading, so the Sheet's title can be it (mutation: ignore wrapHeading -> FAILS)", () => {
    const html = drawer({ wrapHeading: (h) => createElement("div", { "data-wrapped": "" }, h) });
    expect(html).toMatch(/<div data-wrapped=""><h2/);
  });

  it("the trailing node sits on the name line after the name and never shrinks (mutation: drop trailing -> FAILS)", () => {
    const html = drawer();
    expect(html).toMatch(/<\/h2><span class="shrink-0"><a href="\/dashboard\/accounts\/a1\/contacts\/c1" aria-label="Open full record">/);
  });

  it("the page's form is unchanged: back link and h1 (mutation: default headingLevel 2 -> FAILS)", () => {
    const html = render(ALL);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('href="/dashboard/accounts/a1/contacts"');
    expect(html).not.toContain("shrink-0\"><a");
  });
});
```

Create `apps/web/src/components/record/record-card-boundary.on-reset.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const { RecordCardBoundary } = await import("./record-card-boundary");

type CoreEl = ReactElement<{ onReset: () => void }>;
const fallback = () => null;

describe("RecordCardBoundary's onReset (S-03 part 3: a section inside an overlay retries itself, never the page behind it)", () => {
  beforeEach(() => refresh.mockReset());

  it("a given onReset is what the core calls, and the router is not refreshed (mutation: ignore onReset -> FAILS)", () => {
    const onReset = vi.fn();
    const el = RecordCardBoundary({ fallback, skeleton: null, onReset }) as CoreEl;
    el.props.onReset();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("without one, today's refresh (mutation: drop the default -> FAILS)", () => {
    const el = RecordCardBoundary({ fallback, skeleton: null }) as CoreEl;
    el.props.onReset();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
```

Create `apps/web/src/components/record/record-section.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
// A fixed id, so the component can also be CALLED (outside a render) to read its element tree. An
// ESM namespace cannot be spied on, so the module is mocked; react-dom/server keeps the real React.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), useId: () => "sec" }));
const { RecordSection } = await import("./record-section");
const { RecordCardError } = await import("./record-card");
const { RecordCardBoundary } = await import("./record-card-boundary");

const base = { id: "recent", label: "Recent", errorText: "Couldn't load Recent.", retryLabel: "Try again", onRetry: () => {} };
const html = (over: Partial<Parameters<typeof RecordSection>[0]>, body: unknown = createElement("p", null, "rows")) =>
  renderToStaticMarkup(createElement(RecordSection, { ...base, state: "ready", ...over }, body as never));

/** Every element in a tree returned by calling the component (hooks: only useId, below). */
function elements(node: unknown, out: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) { node.forEach((n) => elements(n, out)); return out; }
  if (!isValidElement(node)) return out;
  const el = node as ReactElement<Record<string, unknown>>;
  out.push(el);
  elements(el.props.children, out);
  return out;
}

describe("RecordSection (S-03 part 3 C4): a flat section, its own states", () => {
  it("a mono label (DESIGN.md's Label role) that names the section (mutation: drop aria-labelledby -> FAILS)", () => {
    const out = html({});
    expect(out).toMatch(/<section data-record-section="recent" data-state="ready" aria-labelledby="sec"/);
    expect(out).toMatch(/<h3 id="sec" class="[^"]*font-mono[^"]*text-\[10px\][^"]*uppercase[^"]*tracking-\[0\.14em\]/);
  });

  it("no label, no heading and no aria-labelledby (the facts line continues the header)", () => {
    const out = html({ label: null });
    expect(out).not.toContain("<h3");
    expect(out).not.toContain("aria-labelledby");
  });

  it("a rule between sections on the --line token, never a glass card (mutation: add glass -> FAILS)", () => {
    const out = html({});
    expect(out).toMatch(/class="[^"]*border-t[^"]*border-\[var\(--line\)\]/);
    expect(out).not.toMatch(/\bglass\b|rounded-xl|bg-card/);
  });

  it("loading: the skeleton given, else rows; never the body, never a spinner (rule 7; mutation: render children while loading -> FAILS)", () => {
    expect(html({ state: "loading" })).toContain("data-record-skeleton");
    expect(html({ state: "loading" })).not.toContain(">rows<");
    expect(html({ state: "loading", skeleton: createElement("div", { "data-testid": "drawer-skeleton" }) })).toContain('data-testid="drawer-skeleton"');
    expect(html({ state: "loading" })).not.toMatch(/animate-spin/);
  });

  it("error: the section's sentence and Try again as an alert, no body (mutation: render children on error -> FAILS)", () => {
    const out = html({ state: "error" });
    expect(out).toMatch(/role="alert"/);
    expect(out).toContain("Couldn&#x27;t load Recent.");
    expect(out).toContain(">Try again<");
    expect(out).not.toContain(">rows<");
  });

  it("ready and empty both draw the body the caller gives (the empty sentence is the caller's)", () => {
    expect(html({ state: "ready" })).toContain(">rows<");
    expect(html({ state: "empty" }, createElement("p", null, "nothing yet"))).toContain(">nothing yet<");
  });

  it("Try again, and the boundary's reset, call onRetry, never the router (mutation: omit onRetry from RecordCardError or the boundary -> FAILS)", () => {
    const onRetry = vi.fn();
    const errorTree = elements(RecordSection({ ...base, state: "error", onRetry }));
    expect(errorTree.find((e) => e.type === RecordCardError)?.props.onRetry).toBe(onRetry);
    const readyTree = elements(RecordSection({ ...base, state: "ready", onRetry }));
    expect(readyTree.find((e) => e.type === RecordCardBoundary)?.props.onReset).toBe(onRetry);
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

Create `apps/web/src/components/ui/sheet.test.ts` (a source pin: Radix's Portal renders nothing on the server and apps/web has no DOM; the e2e Spanish case in Task 9 reads the button's accessible name in a browser):

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./sheet.tsx", import.meta.url)), "utf8");

describe("SheetContent's close button names itself in the reader's language (S-03 part 3, orchestrator ruling)", () => {
  it("the sr-only name is the closeLabel prop (mutation: keep the literal Close -> FAILS)", () => {
    expect(src).toMatch(/<span className="sr-only">\{closeLabel\}<\/span>/);
    expect(src).not.toMatch(/<span className="sr-only">Close<\/span>/);
  });
  it("defaults to Close, so every other sheet is unchanged (mutation: drop the default -> FAILS)", () => {
    expect(src).toMatch(/closeLabel = "Close"/);
  });
});
```

In `apps/web/src/app/(dashboard)/dashboard/styleguide/record-demo.test.ts`, replace the "RecordHeader with every action and with none" case (`:29-35`) with:

```ts
  it("RecordHeader with every action, with none, and in the drawer's form (mutation: drop the no-action header -> 5 headers, FAILS)", () => {
    // Six headers: two in the layouts, one with every action, one with none, one whose subtitle links
    // to the group (S-03 part 2b), and the drawer's (S-03 part 3). Exactly one has no action row.
    expect(html.match(/data-record-header/g)).toHaveLength(6);
    expect(html.match(/data-record-actions/g)).toHaveLength(5);
  });
```

and add:

```ts
  it("the drawer's header and its flat sections in a Sheet's surface (S-03 part 3; mutation: drop the specimen -> FAILS)", () => {
    const start = html.indexOf("data-sg-drawer");
    expect(start).toBeGreaterThan(-1);
    const section = html.slice(start, html.indexOf("data-sg-drawer-end"));
    expect(section).toMatch(/class="[^"]*glass-overlay/);
    expect(section).toContain("<h2");
    expect(section).not.toContain("<h1");
    expect(section).not.toContain(`>${m["record.back"]}<`);
    expect(section).toContain(`aria-label="${m["drawer.openFull"]}"`);
    expect([...section.matchAll(/data-record-section="[^"]+" data-state="(\w+)"/g)].map((x) => x[1]))
      .toEqual(["ready", "loading", "empty", "error"]);
  });
```

- [ ] **Step 2: Run them; they fail.**

Run: `pnpm --filter web exec vitest run src/components/record/record-header.test.ts src/components/record/record-card-boundary.on-reset.test.ts src/components/record/record-section.test.ts src/components/ui/sheet.test.ts "src/app/(dashboard)/dashboard/styleguide/record-demo.test.ts"`

Expected: FAIL — the drawer-form cases (`expected '…<h1…' not to contain '<h1'`, the back link present), the on-reset case (`expected "spy" to be called 1 times, but got 0 times`), `record-section.test.ts` fails to import (`Failed to resolve import "./record-section"`), the sheet pins (`expected … to match /<span className="sr-only">\{closeLabel\}…/`), and the styleguide counts (`expected [ …5 items ] to have a length of 6`).

- [ ] **Step 3: Implement.**

`record-header.tsx`, replacing `:1-46`:

```tsx
import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export type RecordHeaderAction = {
  id: string; label: string; href: string; ariaLabel?: string; primary?: boolean; external?: boolean;
};

/**
 * The record's header (spec §9.1). On the page the name is its h1 (Display 600, 22px) under a back
 * link. In the list's drawer (S-03 part 3 §8.1) there is no back link, the name is an h2 (a dialog
 * over a page that has its own h1 holds no second one) wrapped by the Sheet's title, and `trailing`
 * (the ↗ to the full record) sits beside it and never shrinks. Under the name, muted, the main group.
 * The actions follow in the order given, the one primary first; each at least 44px tall; they wrap.
 */
export function RecordHeader({ name, subtitle, subtitleHref, back, actions, headingLevel = 1, wrapHeading, trailing }: {
  name: string; subtitle?: string | null; subtitleHref?: string;
  back?: { href: string; label: string };
  actions: RecordHeaderAction[];
  headingLevel?: 1 | 2;
  wrapHeading?: (heading: ReactElement) => ReactNode;
  trailing?: ReactNode;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h1";
  const heading = (
    <Heading title={name} className="min-w-0 truncate text-[22px] font-display font-[600] tracking-[-0.02em] text-card-foreground">{name}</Heading>
  );
  const named = wrapHeading ? wrapHeading(heading) : heading;
  return (
    <header data-record-header className="min-w-0 space-y-1.5">
      {back ? (
        <Link href={back.href}
          className="inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-ctl)] text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8">
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      {trailing ? (
        <div data-record-name-line className="flex min-w-0 items-center gap-2">
          {named}<span className="shrink-0">{trailing}</span>
        </div>
      ) : named}
      {subtitle ? (
        subtitleHref ? (
          <Link href={subtitleHref} data-record-subtitle
            className="block w-fit rounded-[var(--radius-ctl)] text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
            {subtitle}
          </Link>
        ) : <p data-record-subtitle className="text-sm text-muted-foreground">{subtitle}</p>
      ) : null}
      {actions.length > 0 ? (
        <div data-record-actions className="flex flex-wrap gap-2 pt-2">
          {actions.map((a) => (
            <Button key={a.id} asChild variant={a.primary ? "default" : "ghost"} className="min-h-11" data-record-action={a.id}>
              <a href={a.href} aria-label={a.ariaLabel} {...(a.external ? { target: "_blank", rel: "noreferrer" } : {})}>
                {a.label}
              </a>
            </Button>
          ))}
        </div>
      ) : null}
    </header>
  );
}
```

(The existing first case's regex `/<h1[^>]*title="Ana García"[^>]*>Ana García<\/h1>/` still matches: `title` precedes `class`.)

`record-card-boundary.tsx`, replacing `:27-44`:

```tsx
/**
 * One per card (spec C5, DESIGN.md "Record page": one card's fault never blanks the page).
 * React's server renderer does not run class error boundaries, so the Suspense is what keeps a
 * server-render throw inside this card: it renders `skeleton` there and the client retries, where
 * the core catches it. Verified on React 19.2.4 (plan, Global Constraints). `onReset`: what Try again
 * re-reads after a render throw; absent, the page (a section inside the list's drawer passes its own,
 * S-03 part 3, so it never refreshes the list behind the drawer).
 */
export function RecordCardBoundary({ fallback, skeleton, children, onReset }: {
  // Optional only so createElement(RecordCardBoundary, props, child) type-checks (TS2769 on a
  // required children prop); ReactNode already admits undefined, so callers see no difference.
  fallback: (reset: () => void) => ReactNode; skeleton: ReactNode; children?: ReactNode; onReset?: () => void;
}) {
  const router = useRouter();
  return (
    <RecordCardBoundaryCore fallback={fallback} onReset={onReset ?? (() => router.refresh())}>
      <Suspense fallback={skeleton}>{children}</Suspense>
    </RecordCardBoundaryCore>
  );
}
```

Create `apps/web/src/components/record/record-section.tsx`:

```tsx
"use client";

import { useId, type ReactNode } from "react";
import { RecordCardError, RecordCardSkeleton, type RecordCardState } from "./record-card";
import { RecordCardBoundary } from "./record-card-boundary";

export type RecordSectionProps = {
  id: string;
  /** The mono label (DESIGN.md's Label role); null for a section that continues the header. */
  label: string | null;
  state: RecordCardState;
  errorText: string;
  retryLabel: string;
  /** Required: a section lives inside an overlay, where router.refresh() would re-read the page behind it. */
  onRetry: () => void;
  skeletonRows?: number;
  /** Drawn in place of the line skeleton while loading (Recent loads as rows). */
  skeleton?: ReactNode;
  children?: ReactNode;
};

/**
 * The card chrome's flat twin (S-03 part 3 C4) for a surface that is already glass (the Sheet): a
 * mono label, a `--line` rule above every section but the first, rows the caller rules with
 * `--row-line`, and the SAME skeleton, error and boundary as a card. Never a glass box in the glass.
 */
export function RecordSection(p: RecordSectionProps) {
  const labelId = useId();
  const skeleton = p.skeleton ?? <RecordCardSkeleton rows={p.skeletonRows ?? 3} />;
  return (
    <section data-record-section={p.id} data-state={p.state} aria-labelledby={p.label ? labelId : undefined}
      className="min-w-0 border-t border-[var(--line)] pt-3 first:border-t-0 first:pt-0">
      {p.label ? (
        <h3 id={labelId} className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{p.label}</h3>
      ) : null}
      {p.state === "loading" ? skeleton
        : p.state === "error" ? <RecordCardError text={p.errorText} retryLabel={p.retryLabel} onRetry={p.onRetry} />
        : (
          <RecordCardBoundary onReset={p.onRetry} skeleton={skeleton}
            fallback={(reset) => <RecordCardError text={p.errorText} retryLabel={p.retryLabel} onRetry={reset} />}>
            {p.children}
          </RecordCardBoundary>
        )}
    </section>
  );
}
```

`sheet.tsx`, replacing `:48-92`:

```tsx
function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  closeLabel = "Close",
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  /** The close button's screen-reader name, in the reader's language (the list's drawer, S-03 part 3). */
  closeLabel?: string
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        // A toast drawn over an open sheet (Sonner's toaster sits above
        // every overlay) is not an "outside" interaction — see
        // interact-outside.ts.
        onInteractOutside={interactOutsideExemptingToaster(onInteractOutside)}
        className={cn(
          "fixed z-50 flex flex-col gap-4 glass-overlay border-[var(--line-strong)] transition ease-in-out data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:animate-in data-[state=open]:duration-500",
          side === "right" &&
            "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
          side === "left" &&
            "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
          side === "top" &&
            "inset-x-0 top-0 h-auto border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
          side === "bottom" &&
            "inset-x-0 bottom-0 h-auto border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-secondary">
            <XIcon className="size-4" />
            <span className="sr-only">{closeLabel}</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}
```

(`material.test.ts:777-778` reads the class after `SheetPrimitive.Close`: unchanged.)

`record-demo.tsx`: add the imports `import { ExternalLink } from "lucide-react";` (merge with the existing `CalendarCheck` import) and `import { RecordSection } from "@/components/record/record-section";`, then add, after the linked-subtitle header (`:82`):

```tsx
      {/* S-03 part 3: the list's drawer. The header with no back link, an h2 and the ↗ beside the
          name; then the flat sections in each state. A Sheet-styled frame, not an open Sheet: Radix's
          title needs a Dialog around it, and an open one would cover this page. */}
      <div data-sg-drawer className="w-[448px] max-w-full space-y-4 rounded-xl border border-[var(--line-strong)] glass-overlay p-4">
        <RecordHeader name="Ana García" headingLevel={2}
          subtitle={m["record.group.household"].replace("{group}", "García")}
          trailing={
            <a href="#" aria-label={m["drawer.openFull"]}
              className="inline-flex min-h-11 items-center rounded-[var(--radius-ctl)] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8">
              <ExternalLink className="size-4" aria-hidden />
            </a>
          }
          actions={[
            { id: "call", label: m["record.action.call"], href: "tel:+19565550100", ariaLabel: m["record.action.callAria"].replace("{name}", "Ana García"), primary: true },
            { id: "email", label: m["record.action.email"], href: "#compose-email" },
          ]} />
        <RecordSection id="sg-facts" label={null} state="ready" errorText={m["record.summary.failed"]} retryLabel={m["record.card.retry"]} onRetry={() => {}}>
          <p className="text-sm text-card-foreground">{m["record.facts.openDealsOne"]}</p>
        </RecordSection>
        <RecordSection id="sg-next" label={m["record.card.nextUp"]} state="loading" errorText={failedText(m["record.card.nextUp"])} retryLabel={m["record.card.retry"]} onRetry={() => {}} />
        <RecordSection id="sg-recent" label={m["drawer.recent"]} state="empty" errorText={failedText(m["drawer.recent"])} retryLabel={m["record.card.retry"]} onRetry={() => {}}>
          <p className="text-sm text-muted-foreground">{m["timeline.empty"]}</p>
        </RecordSection>
        <RecordSection id="sg-tags" label={m["contact.tags"]} state="error" errorText={failedText(m["contact.tags"])} retryLabel={m["record.card.retry"]} onRetry={() => {}} />
      </div>
      <span data-sg-drawer-end hidden />
```

(Specimen words come from the catalogue, so the ratchet sees no literal. `record.facts.openDealsOne` is the existing specimen line, `:21`.)

- [ ] **Step 4: Run them; they pass.** Same command as Step 2. Expected: every file green; then the probes named in each test title, one at a time, each failing BY NAME, reverted. Also run `pnpm --filter web exec vitest run src/components/record src/components/ui/material.test.ts "src/app/(dashboard)/dashboard/styleguide"` (the kit's other tests and the close button's 2px exception), `pnpm --filter web typecheck`, `pnpm --filter web exec eslint src/components/record src/components/ui/sheet.tsx "src/app/(dashboard)/dashboard/styleguide/record-demo.tsx"`.

- [ ] **Step 5: Commit.**

```bash
git add -- apps/web/src/components/record/record-section.tsx apps/web/src/components/record/record-section.test.ts apps/web/src/components/record/record-card-boundary.on-reset.test.ts apps/web/src/components/ui/sheet.test.ts
git commit -m "feat(design): the record header's drawer form, a flat record section, and a sheet that names its close button in the reader's language (S-03 part 3)" -- apps/web/src/components/record/record-header.tsx apps/web/src/components/record/record-header.test.ts apps/web/src/components/record/record-card-boundary.tsx apps/web/src/components/record/record-card-boundary.on-reset.test.ts apps/web/src/components/record/record-section.tsx apps/web/src/components/record/record-section.test.ts apps/web/src/components/ui/sheet.tsx apps/web/src/components/ui/sheet.test.ts "apps/web/src/app/(dashboard)/dashboard/styleguide/record-demo.tsx" "apps/web/src/app/(dashboard)/dashboard/styleguide/record-demo.test.ts"
```

---

## Task 2: The record's view builders the drawer shares (bis-crm)

**Review:** sonnet. **Runs beside:** Tasks 1 and 4. Commits `[contactId]/page.tsx` BEFORE Task 3 starts.

**Files**
- Modify: `apps/web/src/lib/record/header-actions.ts:1-51` (add `headerActionLabels`), `header-actions.test.ts` (append)
- Create: `apps/web/src/lib/record/recent-rows.ts`, `recent-rows.test.ts`
- Modify: `apps/web/src/lib/record/loaders.ts` (add `DRAWER_RECENT` and `loadRecent` after `loadTimeline`, `:82`), `loaders.test.ts` (append; the import at `:35`)
- Modify: `apps/web/src/lib/contacts/lead-source.ts:118-148` (`locale`), `lead-source.test.ts` (append)
- Modify: `…/contacts/[contactId]/page.tsx:17`, `:54-56`, `:175-184` (use `headerActionLabels`)

**Interfaces**
- Consumes: `HeaderAction`, `HeaderActionId` (`header-actions.ts:6-7`); `Tr`, `makeTr` (`lib/record/copy.ts:9-22`); `RecordHeaderAction` (`components/record/record-header.tsx:5-7`); `TimelineRow`, `TimelineStatus`, `timelineRows` (`lib/record/timeline-rows.ts:8-16`, `:99-114`); `AuthorMarkView` (`author-mark.ts:4`); `splitSummaryBlocks` (`lib/voice/summary-blocks.ts:42`, kinds `"facts" | "mismatch" | "prose"`, the warning starts `⚠ MISMATCH`, `:16`); `listContactTimelinePage(db, accountId, contactId, before?, { limit?, onError? })` (`packages/db/src/record.ts:367-373`), `TIMELINE_SOURCES`, `listPeopleNames`, `getVoiceProfile`; `t(m, key, locale, params?)` (`lib/i18n/t.ts:36-45`).
- Produces (Tasks 3, 5 rely on these exact names):
  - `headerActionLabels(actions: readonly HeaderAction[], tr: Tr, name: string): RecordHeaderAction[]`
  - `type RecentRowView = { key: string; kind: TimelineEntry["kind"]; mark: AuthorMarkView; verb: string; status: TimelineStatus | null; detail: string | null; time: string; dateTime: string; excerpt: { text: string; lang: "" | "en"; done: boolean } | null }`
  - `recentRowsView(rows: readonly TimelineRow[]): RecentRowView[]`
  - `DRAWER_RECENT = 5`; `type RecentLoad = { status: "ready"; page: TimelinePage; names: Record<string, string>; personaName: string | null } | { status: "error" }`; `loadRecent(db: SupabaseClient, accountId: string, contactId: string): Promise<RecentLoad>` (never throws)
  - `contactSourceHint(input, locale: Locale = "en"): string | null`

- [ ] **Step 1: Write the failing tests.**

Append to `apps/web/src/lib/record/header-actions.test.ts` (add `headerActionLabels` to the import at `:10`; add `import { makeTr } from "./copy";`, `import { readFileSync } from "node:fs";` and `import { fileURLToPath } from "node:url";` at the top):

```ts
describe("headerActionLabels (S-03 part 3 C8): the header's words have one home", () => {
  it("Spanish words for every action, and only Call names the person (mutation: a drawer-only map that says 'Phone' -> FAILS)", () => {
    const labelled = headerActionLabels(headerActions(base), makeTr("es"), "Ana García");
    expect(labelled.map((a) => a.label)).toEqual(["Llamar", "Mandar texto", "Mandar correo", "Cómo llegar"]);
    expect(labelled.map((a) => a.ariaLabel)).toEqual(["Llamar a Ana García", undefined, undefined, undefined]);
  });
  it("keeps every href, primary and external flag (mutation: rebuild the action without primary -> FAILS)", () => {
    const raw = headerActions({ ...base, composeHref: "/dashboard/accounts/a1/contacts/c1" });
    const labelled = headerActionLabels(raw, makeTr("en"), "Ana");
    expect(labelled.map(({ id, href, primary, external }) => ({ id, href, primary, external })))
      .toEqual(raw.map(({ id, href, primary, external }) => ({ id, href, primary, external })));
  });
  it("the record page labels its header through it and keeps no map of its own (mutation: restore the page's ACTION_KEY -> FAILS)", () => {
    const page = readFileSync(fileURLToPath(new URL(
      "../../app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.tsx", import.meta.url)), "utf8");
    expect(page).not.toMatch(/ACTION_KEY/);
    expect(page).toMatch(/headerActionLabels\(headerActions\(\{/);
  });
});
```

Create `apps/web/src/lib/record/recent-rows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { TimelineEntry } from "@bis/db";
import { timelineRows } from "./timeline-rows";
import { recentRowsView } from "./recent-rows";
import { makeTr } from "./copy";

const AT = "2026-10-09T16:12:00Z";
const view = (entries: TimelineEntry[]) =>
  recentRowsView(timelineRows(entries, { zone: "America/Chicago", tr: makeTr("en"), author: { viewerId: null, names: {}, personaName: null, tr: makeTr("en") } }));
const call = (reason: string | null, summary: string): TimelineEntry => ({ kind: "call", id: "k1", at: AT, contactId: "c1",
  call: { id: "k1", contact_id: "c1", started_at: AT, outcome: "booked", duration_secs: 120, reason, summary, language: "es" } });
const booking: TimelineEntry = { kind: "booking", id: "b1", at: AT, contactId: "c1",
  booking: { id: "b1", contact_id: "c1", created_at: AT, starts_at: "2026-10-16T15:00:00Z", status: "booked", note: "Gate code 4411",
    author_kind: "customer", author_id: null, rescheduled_from_id: null, moved_from_starts_at: null } };
const task = (done: boolean): TimelineEntry => ({ kind: "task", id: "t1", at: AT, contactId: "c1", task: { id: "t1", title: "Call back about the gutters",
  due_at: null, completed_at: done ? AT : null, created_at: AT, consent_event_id: null, call_id: null, assigned_to: null, created_by: null } });
const deal: TimelineEntry = { kind: "deal", id: "d1", at: AT, contactId: "c1",
  deal: { id: "d1", name: "Deck build", status: "open", monetary_value: 1200, created_at: AT, created_by: null } };
const submission: TimelineEntry = { kind: "submission", id: "s1", at: AT, contactId: "c1",
  submission: { id: "s1", created_at: AT, formName: "Contact us", answers: [{ key: "message", label: "Message", value: "Leak" }], author_kind: "customer" } };
const message = (subject: string | null): TimelineEntry => ({ kind: "message", id: "m1", at: AT, contactId: "c1",
  message: { id: "m1", channel: "email", direction: "inbound", status: "delivered", subject, body: "The body", error: null, created_at: AT,
    author_kind: "customer", author_id: null } });

describe("recentRowsView (S-03 part 3 C6, §9.4): the drawer's compact rows", () => {
  it("every row keeps its author mark; the booking page's booking is the customer's (mutation: drop the mark for customer -> FAILS)", () => {
    const [b] = view([booking]);
    expect(b!.mark).toEqual({ kind: "customer", label: "Customer" });
    expect(b!.verb).toBe("booked an appointment for Fri, Oct 16, 10:00 AM");
    expect(b!.status).toEqual({ tone: "accent", word: "Booked" });
  });

  it("a call's reason as typed (lang=\"\"), else its summary's prose in English, else nothing on a mismatch (mutation: show the summary anyway -> FAILS)", () => {
    expect(view([call("Wants a roof quote", "Roof leak, booked.")])[0]!.excerpt).toEqual({ text: "Wants a roof quote", lang: "", done: false });
    expect(view([call(null, "Roof leak, booked.")])[0]!.excerpt).toEqual({ text: "Roof leak, booked.", lang: "en", done: false });
    expect(view([call(null, "⚠ MISMATCH the summary says booked; no booking was made\n\nRoof leak, booked.")])[0]!.excerpt).toBeNull();
  });

  it("a deal and a submission have no excerpt: the name and the form are in the verb (mutation: excerpt the form's answers -> FAILS)", () => {
    const [d, s] = view([deal, submission]);
    expect(d!.excerpt).toBeNull();
    expect(s!.excerpt).toBeNull();
    expect(s!.verb).toBe("sent the Contact us form");
  });

  it("a To-do's title as typed, struck through once done; a message's subject before its body; a booking's note (mutation: done always false -> FAILS)", () => {
    expect(view([task(false)])[0]!.excerpt).toEqual({ text: "Call back about the gutters", lang: "", done: false });
    expect(view([task(true)])[0]!.excerpt).toEqual({ text: "Call back about the gutters", lang: "", done: true });
    expect(view([message("Quote")])[0]!.excerpt!.text).toBe("Quote");
    expect(view([message(null)])[0]!.excerpt!.text).toBe("The body");
    expect(view([booking])[0]!.excerpt).toEqual({ text: "Gate code 4411", lang: "", done: false });
  });

  it("JSON only: no TimelineEntry rides along, and it survives a JSON round trip unchanged (mutation: spread the row -> `entry` appears, FAILS)", () => {
    const rows = view([booking, call(null, "Roof leak, booked."), deal]);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["dateTime", "detail", "excerpt", "key", "kind", "mark", "status", "time", "verb"]);
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
    expect(rows[0]!.dateTime).toBe(AT);
  });
});
```

(Read `timeline-rows.test.ts:1-30` before running: the expected verb strings and "Customer" come from the same `makeTr("en")` its own cases use. If `timeline.form`'s English differs from "sent the {form} form", take it from `messages.ts`, never from this plan.)

Append to `apps/web/src/lib/record/loaders.test.ts` (change the import at `:35` to `const { loadSummary, loadTimeline, loadRecent, DRAWER_RECENT, loadHeaderPlaces, softSmsGate } = await import("./loaders");`), inside the existing `describe("record loaders", …)` after its last case:

```ts
  it("the drawer's Recent reads the head of the merged timeline, five rows, no cursor (mutation: drop limit -> 30 rows, FAILS)", async () => {
    expect(DRAWER_RECENT).toBe(5);
    await loadRecent(db, "acct1", "ct1");
    expect(listContactTimelinePageMock).toHaveBeenCalledWith(db, "acct1", "ct1", undefined, expect.objectContaining({ limit: 5 }));
  });

  it("Recent reads no hold and no ledger: the drawer has no Done (mutation: build it on loadTimeline -> FAILS)", async () => {
    listContactTimelinePageMock.mockResolvedValueOnce({ items: [{ kind: "task", id: "t1", at: "2026-10-01T00:00:00Z", contactId: "ct1",
      task: { id: "t1", completed_at: null, consent_event_id: "ev1", call_id: null, created_by: null } }], older: null, failed: [] });
    expect((await loadRecent(db, "acct1", "ct1")).status).toBe("ready");
    expect(holdOpenTaskIdsMock).not.toHaveBeenCalled();
  });

  it("Recent is an error only when all seven sources failed; six failed is ready, naming them (mutation: error on any failure -> FAILS)", async () => {
    const all = ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"];
    listContactTimelinePageMock.mockResolvedValueOnce({ items: [], older: null, failed: all });
    expect(await loadRecent(db, "acct1", "ct1")).toEqual({ status: "error" });
    listContactTimelinePageMock.mockResolvedValueOnce({ items: [], older: null, failed: all.slice(1) });
    expect(await loadRecent(db, "acct1", "ct1")).toMatchObject({ status: "ready", page: { failed: all.slice(1) } });
  });

  it("Recent never throws: a rejected read is the error; names and persona are soft (mutation: let the read throw -> FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      listContactTimelinePageMock.mockRejectedValueOnce(new Error("down"));
      expect(await loadRecent(db, "acct1", "ct1")).toEqual({ status: "error" });
      listPeopleNamesMock.mockRejectedValueOnce(new Error("names down"));
      getVoiceProfileMock.mockRejectedValueOnce(new Error("persona down"));
      expect(await loadRecent(db, "acct1", "ct1")).toMatchObject({ status: "ready", names: {}, personaName: null });
      expect(errors.mock.calls.map((c) => String(c[0])).join("\n")).toContain("for account acct1");
    } finally { errors.mockRestore(); }
  });
```

Append to `apps/web/src/lib/contacts/lead-source.test.ts`:

```ts
describe("contactSourceHint in the reader's language (S-03 part 3 §10.1)", () => {
  it("every caption reads Spanish for a Spanish reader (mutation: ignore the locale -> FAILS)", () => {
    expect(contactSourceHint({ source: null, custom: { referred_by: "Ana" }, attribution: null }, "es")).toBe("Recomendado por Ana");
    expect(contactSourceHint({ source: null, custom: null, attribution: { first: { ref: "https://chat.openai.com/" } } }, "es")).toBe("Llegó a través de ChatGPT");
    expect(contactSourceHint({ source: "voice", custom: null, attribution: null }, "es")).toBe("Llamaron por teléfono");
    expect(contactSourceHint({ source: "form: Contact us", custom: null, attribution: null }, "es")).toBe("Guardado en su formulario “Contact us”");
    expect(contactSourceHint({ source: null, custom: null, attribution: null }, "es")).toBe("Origen desconocido");
  });
  it("English without a locale, as every caller before this read (mutation: default to es -> FAILS)", () => {
    expect(contactSourceHint({ source: null, custom: null, attribution: null })).toBe("Source unknown");
  });
  it("a typed name is inserted verbatim, $& included (mutation: a string replacement -> FAILS)", () => {
    expect(contactSourceHint({ source: null, custom: { referred_by: "Ana $& Co." }, attribution: null }, "es")).toBe("Recomendado por Ana $& Co.");
  });
});
```

- [ ] **Step 2: Run them; they fail.**

Run: `pnpm --filter web exec vitest run src/lib/record/header-actions.test.ts src/lib/record/recent-rows.test.ts src/lib/record/loaders.test.ts src/lib/contacts/lead-source.test.ts`

Expected: FAIL — `headerActionLabels is not a function`; `Failed to resolve import "./recent-rows"`; `loadRecent is not a function` (and `expected undefined to be 5`); `expected 'Referred by Ana' to be 'Recomendado por Ana'`.

- [ ] **Step 3: Implement.**

`header-actions.ts`: add to the imports

```ts
import type { MessageKey } from "@/lib/messages";
import type { RecordHeaderAction } from "@/components/record/record-header";
import type { Tr } from "./copy";
```

and append:

```ts
const ACTION_KEY = {
  call: "record.action.call", text: "record.action.text", email: "record.action.email", directions: "record.action.directions",
} as const satisfies Record<HeaderActionId, MessageKey>;

/**
 * The header's words (S-03 part 3 C8), moved here from the record page so the page and the list's
 * drawer can never say "Call" two ways. Call's aria-label names the person ("Call Ana García").
 */
export function headerActionLabels(actions: readonly HeaderAction[], tr: Tr, name: string): RecordHeaderAction[] {
  return actions.map((a) => ({
    ...a,
    label: tr.text(ACTION_KEY[a.id]),
    ariaLabel: a.id === "call" ? tr.text("record.action.callAria", { name }) : undefined,
  }));
}
```

`[contactId]/page.tsx`: delete `:54-56` (`const ACTION_KEY …`); the import at `:17` becomes `import { headerActions, headerActionLabels, canTextFrom, firstMapUrl } from "@/lib/record/header-actions";` (`MessageKey`, `:8`, stays: `:192` uses it). Replace `:175-184` with:

```tsx
  const actions: RecordHeaderAction[] = headerActionLabels(headerActions({
    phone: contact.phone ?? null,
    email: composerShown ? contact.email ?? null : null,
    canText: composerShown && canTextFrom({ phone: contact.phone ?? null, smsGate, smsBlockedLine }),
    directionsUrl: places ? firstMapUrl(places.places, contactId, places.groups) : null,
  }), tr, name);
```

Create `apps/web/src/lib/record/recent-rows.ts`:

```ts
import type { TimelineEntry } from "@bis/db";
import { splitSummaryBlocks } from "@/lib/voice/summary-blocks";
import type { AuthorMarkView } from "./author-mark";
import type { TimelineRow, TimelineStatus } from "./timeline-rows";

/**
 * One row of the list drawer's Recent (S-03 part 3 C6, §9.4), built on the server from the record
 * page's own `timelineRows`, and JSON only: the browser never receives a whole TimelineEntry (call
 * summaries, form answers) to throw most of it away. No day separator, no per-row link, no Done.
 */
export type RecentRowView = {
  key: string; kind: TimelineEntry["kind"]; mark: AuthorMarkView; verb: string; status: TimelineStatus | null;
  detail: string | null; time: string; dateTime: string;
  /** At most two lines under the head. `lang`: "" for typed text, "en" for a call summary's prose. */
  excerpt: { text: string; lang: "" | "en"; done: boolean } | null;
};

const typed = (text: string | null | undefined, done = false): RecentRowView["excerpt"] =>
  text && text.trim() ? { text, lang: "", done } : null;

/** The group timeline's per-kind body rules (`groups/[groupId]/group-timeline.tsx:92-172`), as text. */
function excerptOf(e: TimelineEntry): RecentRowView["excerpt"] {
  switch (e.kind) {
    case "note": return typed(e.note.body);
    case "task": return typed(e.task.title, Boolean(e.task.completed_at));
    case "deal": return null;
    case "submission": return null;
    case "message": return typed(e.message.subject?.trim() ? e.message.subject : e.message.body);
    case "booking": return typed(e.booking.note);
    case "call": {
      // The reason as typed; else only the summary's English prose; nothing when it carries a MISMATCH.
      const reason = e.call.reason?.trim() || null;
      if (reason) return { text: reason, lang: "", done: false };
      const blocks = splitSummaryBlocks(e.call.summary);
      if (blocks.some((b) => b.kind === "mismatch")) return null;
      const prose = blocks.filter((b) => b.kind === "prose").map((b) => b.text).join(" ");
      return prose ? { text: prose, lang: "en", done: false } : null;
    }
  }
}

export function recentRowsView(rows: readonly TimelineRow[]): RecentRowView[] {
  return rows.map((r) => ({
    key: r.key, kind: r.entry.kind, mark: r.mark, verb: r.verb, status: r.status, detail: r.detail,
    time: r.time, dateTime: r.entry.at, excerpt: excerptOf(r.entry),
  }));
}
```

`loaders.ts`: after `loadTimeline` (`:82`) add:

```ts
/** The list drawer's Recent: the newest five rows (S-03 part 3 D5). */
export const DRAWER_RECENT = 5;

export type RecentLoad =
  | { status: "ready"; page: TimelinePage; names: Record<string, string>; personaName: string | null }
  | { status: "error" };

/**
 * The list drawer's Recent (S-03 part 3 §6): the head of the record page's merged timeline, five
 * rows. No hold read and no ledger: those stand in for Done (`loadTimeline`, above), and the drawer
 * has no Done. A failed source is named in `page.failed`; all seven failed is the section's error.
 * The names on person marks and the persona are soft, exactly as on the page. Never throws.
 */
export async function loadRecent(db: SupabaseClient, accountId: string, contactId: string): Promise<RecentLoad> {
  let page: TimelinePage;
  try {
    page = await listContactTimelinePage(db, accountId, contactId, undefined, {
      limit: DRAWER_RECENT,
      onError: (source, e) => log(`recent (${source})`, accountId, e),
    });
  } catch (e) {
    log("recent", accountId, e);
    return { status: "error" };
  }
  if (page.failed.length >= TIMELINE_SOURCES.length) return { status: "error" };
  const [names, personaName] = await Promise.all([
    listPeopleNames(db, personIdsOf(page.items)).catch((e: unknown) => {
      log("recent names", accountId, e);
      return {} as Record<string, string>;
    }),
    getVoiceProfile(db, accountId).then((p) => p?.persona_name ?? null).catch((e: unknown) => {
      log("recent persona", accountId, e);
      return null;
    }),
  ]);
  return { status: "ready", page, names, personaName };
}
```

`lead-source.ts`: add `import { t } from "@/lib/i18n/t";` and `import type { Locale } from "@/lib/i18n/locale";`, and replace `:118-148` (the two functions; keep the doc comment above `machineSourceCaption`, `:105-117`) with:

```ts
function machineSourceCaption(source: string, locale: Locale): string | null {
  if (source === "voice") return t(m, "contact.source.machine.voice", locale);
  if (source === "booking") return t(m, "contact.source.machine.booking", locale);
  const formMatch = /^form: (.+)$/.exec(source);
  if (formMatch) return t(m, "contact.source.machine.form", locale, { name: formMatch[1]! });
  return null;
}

export function contactSourceHint(input: {
  source: string | null;
  /** `contacts.custom` as stored — unchecked jsonb. */
  custom: unknown;
  /** `contacts.attribution` as stored — unchecked jsonb,
   *  `{ first?: Record<string,string>; last?: Record<string,string> }`
   *  when it was `setAttribution` that wrote it. */
  attribution: unknown;
}, locale: Locale = "en"): string | null {
  // `t()` interpolates with a replacer FUNCTION (lib/i18n/t.ts:23-27), so a referral answer or a
  // channel name containing "$&" is inserted verbatim (review round 1, m1).
  const referredBy = referredByFrom(input.custom);
  if (referredBy) return t(m, "contact.source.referredBy", locale, { name: referredBy });

  const channel = channelFrom(input.attribution);
  if (channel) return t(m, "contact.source.foundThrough", locale, { channel });

  if (input.source) return machineSourceCaption(input.source, locale);
  return t(m, "contact.source.unknown", locale);
}
```

(All six keys already have `.es` twins, `messages.ts:688-716`. The channel name, "ChatGPT", is a proper noun and stays.)

- [ ] **Step 4: Run them; they pass.** Step 2's command, then every test that references the changed functions: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.test.ts" "src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.test.ts"` (the old route calls `contactSourceHint` with one argument: English, unchanged). Each named probe once, failing by name, reverted. `pnpm --filter web typecheck`; eslint on the five touched source files.

- [ ] **Step 5: Commit.**

```bash
git add -- apps/web/src/lib/record/recent-rows.ts apps/web/src/lib/record/recent-rows.test.ts
git commit -m "feat(contacts): the record's header words, its newest five timeline rows and the source caption, ready for the list's drawer and in either language (S-03 part 3)" -- apps/web/src/lib/record/header-actions.ts apps/web/src/lib/record/header-actions.test.ts apps/web/src/lib/record/recent-rows.ts apps/web/src/lib/record/recent-rows.test.ts apps/web/src/lib/record/loaders.ts apps/web/src/lib/record/loaders.test.ts apps/web/src/lib/contacts/lead-source.ts apps/web/src/lib/contacts/lead-source.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.tsx"
```

---

## Task 4: The assignee picker in the reader's language (bis-frontend)

**Review:** sonnet. **Runs beside:** Tasks 1 and 2 (a second bis-frontend instance), or after Task 1 in the same lane.

**Files**
- Modify: `apps/web/src/components/assign/assignee-field.tsx:1-125`
- Create: `apps/web/src/components/assign/assignee-field.locale.test.ts`

**Interfaces**
- Consumes: `useLocale` (`components/locale-provider.tsx:17-19`), `t` (`lib/i18n/t.ts:36`). Keys, all twinned already: `assign.unassigned` (`messages.ts:3406-3407`), `assign.field.label` (`:3408-3409`), `assign.you` (`:3412-3413`), `assign.someone` (`:3415-3416`).
- Produces: `assigneeChoices(options, locale: Locale = "en")`, `assigneeName(id, options, locale: Locale = "en")`; `AssigneeField`, `ContactAssigneeField`, `TaskAssigneeField` read the locale from `useLocale()`; their props are unchanged (Task 6 renders `ContactAssigneeField` as today).

- [ ] **Step 1: Write the failing test** `apps/web/src/components/assign/assignee-field.locale.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./assign-handlers", () => ({ applyAssignee: vi.fn(), contactAssigneeSave: () => vi.fn(), taskAssigneeSave: () => vi.fn() }));
const { assigneeChoices, assigneeName, ContactAssigneeField } = await import("./assignee-field");
const { LocaleProvider } = await import("@/components/locale-provider");

describe("the Assigned to picker in the reader's language (S-03 part 3 §10.1)", () => {
  it("the choices and the names read Spanish (mutation: keep m[\"assign.unassigned\"] -> FAILS)", () => {
    expect(assigneeChoices([], "es")[0]).toEqual({ value: "__unassigned__", label: "Sin asignar" });
    expect(assigneeName(null, [], "es")).toBe("Sin asignar");
    expect(assigneeName("u9", [], "es")).toBe("Alguien del equipo");
  });
  it("English without a locale (mutation: default to es -> FAILS)", () => {
    expect(assigneeName(null, [])).toBe("Unassigned");
  });
  it("a read-only line inside a Spanish provider says Usted for the viewer's own customer (mutation: drop useLocale -> 'You', FAILS)", () => {
    const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "es" },
      createElement(ContactAssigneeField, { accountId: "a1", contactId: "c1", value: "p1", options: [], readOnly: true, viewerId: "p1" })));
    expect(html).toContain(">Usted<");
  });
});
```

- [ ] **Step 2: Run it; it fails.** `pnpm --filter web exec vitest run src/components/assign/assignee-field.locale.test.ts` → FAIL: `expected { value: '__unassigned__', label: 'Unassigned' } to deeply equal { …label: 'Sin asignar' }` and `expected … to contain '>Usted<'`.

- [ ] **Step 3: Implement.** In `assignee-field.tsx` add `import { useLocale } from "@/components/locale-provider";`, `import { t } from "@/lib/i18n/t";`, `import type { Locale } from "@/lib/i18n/locale";` and change:

```tsx
export function assigneeChoices(options: AssigneeOption[], locale: Locale = "en"): { value: string; label: string }[] {
  return [{ value: NONE, label: t(m, "assign.unassigned", locale) }, ...options.map((o) => ({ value: o.userId, label: o.label }))];
}
```

```tsx
export function assigneeName(id: string | null, options: AssigneeOption[], locale: Locale = "en"): string {
  if (id === null) return t(m, "assign.unassigned", locale);
  return options.find((o) => o.userId === id)?.label ?? t(m, "assign.someone", locale);
}
```

In `AssigneeField` (`:44-77`): first line `const locale = useLocale();`, then `const nameOf = (id: string | null) => assigneeName(id, options, locale);` and `{assigneeChoices(options, locale).map(…)}`. In `ContactAssigneeField` (`:85-104`): `const locale = useLocale();`, `{ userId: value, label: t(m, "assign.you", locale) }`, `label={t(m, "assign.field.label", locale)}`. In `TaskAssigneeField` (`:113-125`): `const locale = useLocale();` and `label={t(m, "assign.field.label", locale)}`. `assign-handlers.ts` stays (its toasts are outside this pass, plan deviation 12).

- [ ] **Step 4: Run; it passes.** Step 2's command plus `pnpm --filter web exec vitest run src/components/assign`, each probe once by name, typecheck, eslint on the file.

- [ ] **Step 5: Commit.**

```bash
git add -- apps/web/src/components/assign/assignee-field.locale.test.ts
git commit -m "feat(design): the Assigned to picker says who holds a customer in the reader's language (S-03 part 3)" -- apps/web/src/components/assign/assignee-field.tsx apps/web/src/components/assign/assignee-field.locale.test.ts
```

---

## Task 3: Who they are, in English and Spanish, on the page and the drawer (bis-crm)

**Review:** opus (62 customer-facing Spanish lines on a legal-adjacent subject; bis-comms reviews the consent lines, Q5). **Runs beside:** Task 5. **Starts after** Task 2 has committed (`[contactId]/page.tsx`). **messages.ts #1**: its messages step is its last code step; Task 6's waits for this commit.

**Files**
- Modify: `apps/web/src/lib/consent/texts-row.ts:1-134`, `texts-row.test.ts` (append)
- Modify: `apps/web/src/lib/consent/email-row.ts:1-130`, `email-row.test.ts` (append)
- Modify: `…/contacts/texts-row.tsx:11`, `:41-75`, `:106-226` and `texts-row.test.ts` (append)
- Modify: `…/contacts/email-row.tsx:10`, `:30-63`, `:94-143` and `email-row.test.ts` (append)
- Modify: `…/contacts/source-field.tsx:3-44`, `source-field.test.ts` (append)
- Modify: `…/contacts/business-field.tsx:6`, `:15-37`, `business-field.test.ts` (append)
- Modify: `…/contacts/[contactId]/contact-fields-panel.tsx:19`, `:60-233`
- Modify: `…/contacts/[contactId]/page.tsx:234-251`, `page.test.ts:749-757`
- Modify: `apps/web/src/lib/messages.ts` (62 `.es` lines, each under its English key)

**Interfaces**
- Consumes: `t`, `Locale`, `useLocale`, `LocaleProvider` (`components/locale-provider.tsx`); `formatDateInZone(iso, zone, locale = "en")` (`lib/format.ts:84-88`); `contactSourceHint(input, locale)` (Task 2); `InlineField`'s `locale` prop (`components/inline-field.tsx:102`, `:128`).
- Produces (Task 6 relies on these; every new parameter defaults to `"en"`, so `consent-hold-actions.tsx:9-32` and the styleguide stay as they are):
  - `textsStatusWord(kind: "allowed" | "stopped" | "held", locale: Locale): string`; `howLine(how, locale = "en")`; `textsLine(view, zone, locale = "en")`; `runTextsAction(act, show, toast, o: { …; locale?: Locale })`.
  - `emailStatusWord(kind: "allowed" | "stopped", locale: Locale): string`; `emailHowLine(how, locale = "en")`; `noResumeLine(how, locale = "en")`; `emailLine(view, zone, locale = "en")`; `runEmailAction(…, o: { …; locale?: Locale })`.
  - `TextsRow`, `EmailRow`, `SourceField`, `BusinessInlineField`, `ContactDetailsBody`, `ContactTagsBody` read the locale from `useLocale()`; their props are unchanged. `FIELDS` (`contact-drawer.tsx:68-73`) is untouched here (Task 6 owns that file); the panel reads its `labelKey` through `t()`.

- [ ] **Step 1: Write the failing tests.**

Append to `apps/web/src/lib/consent/texts-row.test.ts` (add `textsStatusWord` to its import at `:3`, and `vi` to the vitest import if absent):

```ts
describe("the Texts row's words in Spanish (S-03 part 3 §10.1)", () => {
  it("how it stopped, and since when, in the reader's language (mutation: ignore the locale -> FAILS)", () => {
    expect(howLine({ kind: "staff" }, "es")).toBe("usted lo registró");
    expect(howLine({ kind: "keyword", word: "STOP" }, "es")).toBe("mandó STOP por texto");
    expect(howLine({ kind: "free_text", excerpt: "ya no", by: "Ana" }, "es")).toBe("escribió “ya no”, confirmado por Ana");
    expect(textsLine({ kind: "held", eventId: "h", since: "2026-10-03T15:00:00Z", excerpt: "remove me" }, "UTC", "es"))
      .toBe("Escribió “remove me”. Los textos están en espera.");
    expect(textsLine({ kind: "stopped", eventId: "e", since: "2026-10-03T15:00:00Z", how: { kind: "carrier" }, canResume: false }, "UTC", "es"))
      .toMatch(/^Desde el .*2026 · la compañía telefónica lo bloqueó$/);
  });
  it("the status words (mutation: textsStatusWord ignores the locale -> FAILS)", () => {
    expect([textsStatusWord("allowed", "es"), textsStatusWord("stopped", "es"), textsStatusWord("held", "es")]).toEqual(["Permitido", "Detenido", "En espera"]);
    expect(textsStatusWord("held", "en")).toBe("On hold");
  });
  it("the action's Undo and its crash line (mutation: keep m[\"common.undo\"] -> FAILS)", async () => {
    const toast = { success: vi.fn(), error: vi.fn() };
    await runTextsAction(async () => ({ ok: true, view: { kind: "allowed", newestId: null }, undo: { kind: "stop", eventId: "e1" } }), () => {}, toast,
      { success: "x", undo: async () => ({ ok: true, view: { kind: "allowed", newestId: null } }), locale: "es" });
    expect(toast.success.mock.calls[0]![1].action.label).toBe("Deshacer");
    await runTextsAction(async () => { throw new Error("stale action id"); }, () => {}, toast, { success: "x", locale: "es" });
    expect(toast.error).toHaveBeenLastCalledWith(m["inline.crashed.es"]);
  });
});
```

Append to `apps/web/src/lib/consent/email-row.test.ts` (add `emailStatusWord` to the import at `:2`; `vi` if absent):

```ts
describe("the Email row's words in Spanish (S-03 part 3 §10.1)", () => {
  it("how, since, and what to say instead of Resume (mutation: ignore the locale -> FAILS)", () => {
    expect(emailHowLine({ kind: "bounced" }, "es")).toBe("rebotó");
    expect(noResumeLine({ kind: "complained" }, "es")).toBe("Marcó un correo como spam: no le volveremos a escribir a menos que se vuelva a suscribir.");
    expect(emailLine({ kind: "stopped", eventId: "e", since: "2026-10-03T15:00:00Z", how: { kind: "staff" }, canResume: true }, "UTC", "es"))
      .toMatch(/^Desde el .*2026 · usted lo registró$/);
  });
  it("the status words (mutation: emailStatusWord ignores the locale -> FAILS)", () => {
    expect([emailStatusWord("allowed", "es"), emailStatusWord("stopped", "es")]).toEqual(["Permitido", "Detenido"]);
  });
  it("Undo on the toast reads Deshacer (mutation: keep m[\"common.undo\"] -> FAILS)", async () => {
    const toast = { success: vi.fn(), error: vi.fn() };
    await runEmailAction(async () => ({ ok: true, view: { kind: "allowed", newestId: "n" }, undo: { kind: "stop", eventId: "e1" } }), () => {}, toast,
      { success: "x", undo: async () => ({ ok: true, view: { kind: "allowed", newestId: null } }), locale: "es" });
    expect(toast.success.mock.calls[0]![1].action.label).toBe("Deshacer");
  });
});
```

Append to `…/contacts/texts-row.test.ts` (add `const { LocaleProvider } = await import("@/components/locale-provider");` after `:15`):

```ts
describe("TextsRow in Spanish (S-03 part 3 §10)", () => {
  const es = (load: TextsLoad, onRetry?: () => void) =>
    renderToStaticMarkup(createElement(LocaleProvider, { locale: "es" }, createElement(TextsRow, { accountId: "a1", contactId: "c1", load, onRetry })));
  it("Allowed reads Permitido under Mensajes, with a ghost Detener textos (mutation: keep m[\"contact.texts.allowed\"] -> FAILS)", () => {
    const out = renderedText(es(ready({ kind: "allowed", newestId: null })));
    expect(out).toMatch(/Mensajes[\s\S]*Textos\s+Permitido/);
    expect(out).toContain("Detener textos");
  });
  it("stopped by the customer: the Spanish since line and the START line (mutation: textsLine without the locale -> FAILS)", () => {
    const out = renderedText(es(ready({ kind: "stopped", eventId: "e", since: "2026-10-03T15:00:00Z", how: { kind: "keyword", word: "STOP" }, canResume: false })));
    expect(out).toMatch(/Desde el .+ · mandó STOP por texto/);
    expect(out).toContain("Puede mandar START por texto para volver a recibir textos.");
  });
  it("the error line and its Retry (mutation: keep m[\"common.retry\"] -> FAILS)", () => {
    const out = es({ status: "error" }, () => {});
    expect(out).toContain("No se pudo cargar la configuración de mensajes. Intente de nuevo.");
    expect(out).toContain(">Intentar de nuevo<");
  });
});
```

Append to `…/contacts/email-row.test.ts` (add `const { LocaleProvider } = await import("@/components/locale-provider");` after `:11`):

```ts
describe("EmailRow in Spanish (S-03 part 3 §10)", () => {
  const es = (load: EmailLoad) =>
    renderToStaticMarkup(createElement(LocaleProvider, { locale: "es" }, createElement(EmailRow, { accountId: "a1", contactId: "c1", load, showTitle: true })));
  it("Allowed reads Correo · Permitido with Detener correos (mutation: keep m[\"contact.email.allowed\"] -> FAILS)", () => {
    const out = renderedText(es(ready({ kind: "allowed", newestId: null })));
    expect(out).toMatch(/Mensajes[\s\S]*Correo\s+Permitido/);
    expect(buttons(es(ready({ kind: "allowed", newestId: null })))).toEqual(["Detener correos"]);
  });
  it("a bounced address explains itself in Spanish (mutation: noResumeLine without the locale -> FAILS)", () => {
    const out = renderedText(es(ready({ kind: "stopped", eventId: "e", since: "2026-10-03T15:00:00Z", how: { kind: "bounced" }, canResume: false })));
    expect(out).toContain("Esta dirección rebotó: los correos no se envían. Corrija la dirección para empezar de nuevo.");
  });
});
```

Append to `…/contacts/source-field.test.ts` (read its head for the existing render helper and mocks first; add `LocaleProvider` as above):

```ts
describe("SourceField in Spanish (S-03 part 3 §10.1)", () => {
  it("the label reads Origen, and the field's own chrome follows (mutation: keep m[\"contact.source.label\"] -> FAILS)", () => {
    const out = renderToStaticMarkup(createElement(LocaleProvider, { locale: "es" },
      createElement(SourceField, { accountId: "a1", contactId: "c1", source: null, sourceHint: "Origen desconocido" })));
    expect(out).toContain(">Origen<");
    expect(out).not.toContain(">Source<");
  });
});
```

Append to `…/contacts/business-field.test.ts` (read its head for the existing mocks; add `LocaleProvider`):

```ts
describe("BusinessInlineField in Spanish (S-03 part 3 §10.1)", () => {
  it("names itself Nombre del negocio (mutation: keep m[\"contact.company\"] -> FAILS)", () => {
    const out = renderToStaticMarkup(createElement(LocaleProvider, { locale: "es" },
      createElement(BusinessInlineField, { accountId: "a1", contactId: "c1", value: null })));
    expect(out).toContain("Nombre del negocio");
    expect(out).not.toContain("Business name");
  });
});
```

In `…/contacts/[contactId]/page.test.ts`, replace the case at `:749-757` with:

```ts
  it("on a Spanish page Details and Tags read Spanish with no lang=\"en\" wrapper, and only the Groups card keeps one (S-03 part 3 §10.2, D10; mutation: leave the Details wrapper -> FAILS; drop the Groups wrapper -> FAILS)", async () => {
    prefsMock.mockResolvedValue({ language: "es", theme: null });
    const html = await render();
    expect(html).toMatch(/data-record-layout[^>]*lang="es"|lang="es"[^>]*data-record-layout/);
    const wrapped = (id: string) => /<div lang="en">/.test(cardHtml(html, id));
    expect(["details", "tags", "summary", "next-up", "deals", "timeline"].filter(wrapped)).toEqual([]);
    expect(wrapped("groups")).toBe(true);
    expect(cardHtml(html, "details")).toContain(`>${m["contacts.firstName.es"]}<`);
    expect(cardHtml(html, "details")).toContain(`>${m["contact.source.label.es"]}<`);
    expect(cardHtml(html, "details")).toContain(`>${m["assign.field.label.es"]}<`);
    expect(cardHtml(html, "tags")).toContain(`placeholder="${m["contact.addTag.es"]}"`);
  });
```

- [ ] **Step 2: Run them; they fail.**

Run: `pnpm --filter web exec vitest run src/lib/consent/texts-row.test.ts src/lib/consent/email-row.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/texts-row.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/email-row.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/source-field.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/business-field.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.test.ts"`

Expected: FAIL — `textsStatusWord is not a function`; `expected 'you recorded it' to be 'usted lo registró'`; `expected … to match /Mensajes[\s\S]*Textos\s+Permitido/`; `expected … to contain '>Origen<'`; `expected … to contain 'Nombre del negocio'`; the page case `expected [ 'details', 'tags' ] to deeply equal []`.

- [ ] **Step 3: Implement the view builders.**

`lib/consent/texts-row.ts`: imports become

```ts
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { formatDateInZone } from "@/lib/format";
```

Keep `TEXTS_TREATMENT` (`:18-22`) as it is (the styleguide spreads it into `DotPill`, `styleguide/page.tsx:222-224`; an extra key would reach the DOM). Below it add:

```ts
const TEXTS_WORD = {
  allowed: "contact.texts.allowed", stopped: "contact.texts.stopped", held: "contact.texts.held",
} as const satisfies Record<keyof typeof TEXTS_TREATMENT, MessageKey>;

/** The status's word in the reader's language (rule 3: the dot never stands alone). */
export function textsStatusWord(kind: keyof typeof TEXTS_TREATMENT, locale: Locale): string {
  return t(m, TEXTS_WORD[kind], locale);
}
```

Replace `howLine` and `textsLine` (`:30-63`) with:

```ts
export function howLine(how: TextsHow, locale: Locale = "en"): string {
  switch (how.kind) {
    case "keyword": return t(m, "contact.texts.how.keyword", locale, { word: how.word });
    case "free_text": {
      const excerpt = quote(how.excerpt ?? "…");
      return how.by
        ? t(m, "contact.texts.how.freeTextBy", locale, { excerpt, name: how.by })
        : t(m, "contact.texts.how.freeText", locale, { excerpt });
    }
    case "staff": return t(m, "contact.texts.how.staff", locale);
    case "carrier": return t(m, "contact.texts.how.carrier", locale);
    case "unsubscribe_link": return t(m, "contact.texts.how.unsubscribeLink", locale);
  }
}

/** The line under the status, or null. A date that will not format drops the date, never throws in a render. */
export function textsLine(view: TextsView, zone: string, locale: Locale = "en"): string | null {
  if (view.kind === "stopped") {
    let since: string | null = null;
    try {
      since = t(m, "contact.texts.since", locale, { date: formatDateInZone(view.since, zone, locale) });
    } catch {
      since = null;
    }
    const how = howLine(view.how, locale);
    return since ? `${since} · ${how}` : how;
  }
  if (view.kind === "held") {
    const excerpt = view.excerpt;
    return excerpt ? t(m, "contact.texts.heldLine", locale, { excerpt: quote(excerpt) }) : t(m, "compose.smsHeld", locale);
  }
  return null;
}
```

In `attempt` (`:86-104`) add a `locale: Locale` parameter and use `toast.error(t(m, "inline.crashed", locale));`. In `runTextsAction` (`:107-134`): `o` gains `locale?: Locale`; `const locale = o.locale ?? "en";`; both `attempt(…)` calls pass `locale`; `label: t(m, "common.undo", locale)`; `toast.error(t(m, "contact.texts.undoBusy", locale))`.

`lib/consent/email-row.ts`: the same imports; keep `EMAIL_TREATMENT` (`email-row.ts:19-22`); add

```ts
const EMAIL_WORD = { allowed: "contact.email.allowed", stopped: "contact.email.stopped" } as const satisfies Record<keyof typeof EMAIL_TREATMENT, MessageKey>;

export function emailStatusWord(kind: keyof typeof EMAIL_TREATMENT, locale: Locale): string {
  return t(m, EMAIL_WORD[kind], locale);
}

export function emailHowLine(how: EmailHow, locale: Locale = "en"): string {
  switch (how.kind) {
    case "unsubscribe_link": return t(m, "contact.email.how.unsubscribeLink", locale);
    case "staff": return t(m, "contact.email.how.staff", locale);
    case "backfill_0049": return t(m, "contact.email.how.backfill0049", locale);
    case "bounced": return t(m, "contact.email.how.bounced", locale);
    case "complained": return t(m, "contact.email.how.complained", locale);
  }
}
```

`noResumeLine(how, locale: Locale = "en")` returns `t(m, "contact.email.bouncedExplain" | "contact.email.complainedExplain" | "contact.email.customerOnly", locale)` in the same three branches (keep its doc comment); `emailLine(view, zone, locale: Locale = "en")` builds `t(m, "contact.email.since", locale, { date: formatDateInZone(view.since, zone, locale) })` and `emailHowLine(view.how, locale)` exactly as `textsLine` above; `attempt` and `runEmailAction` take the locale as `runTextsAction` does (`contact.email.undoBusy`).

- [ ] **Step 4: Implement the components.** In each, `import { useLocale } from "@/components/locale-provider";` and `import { t } from "@/lib/i18n/t";`; every component that renders words starts with `const locale = useLocale();`; every `m["k"]` read becomes `t(m, "k", locale)` and every `m["k"].replace("{x}", v)` becomes `t(m, "k", locale, { x: v })`.
  - `texts-row.tsx`: `Block` (`:41-47`), `TextsRow` (`:49-75`), `ReadyRow` (`:77-226`). The pill keeps its classes and takes the word: replace `:163` with `{picked ? null : <DotPill {...pill} label={view.kind === "allowed" || view.kind === "stopped" || view.kind === "held" ? textsStatusWord(view.kind, locale) : pill.label} dense data-status={view.kind} />}` (the Check number pill, `PHONE_CHECK_TREATMENT`, keeps its English word, plan deviation 12). `const line = textsLine(view, load.zone, locale);`. `act()` passes `locale` into `runTextsAction(call, show, toast, { success, undo: withUndo ? undo : undefined, run, onChanged, locale })`. The toasts passed as `success` are `t(m, "contact.texts.stoppedToast", locale)` and so on.
  - `email-row.tsx`: `Block` (`:30-37`), `EmailRow` (`:39-63`), `ReadyRow`. `:111` becomes `<DotPill {...pill} label={emailStatusWord(view.kind, locale)} dense data-status={view.kind} />` (after the `no_email` return, `view.kind` is `"allowed" | "stopped"`); `emailLine(view, load.zone, locale)`; `noResumeLine(view.how, locale)`; `runEmailAction(…, { …, locale })`.
  - `source-field.tsx`: `const locale = useLocale();` in `SourceField`; `:33` `{t(m, "contact.source.label", locale)}`; the `InlineField` gets `label={t(m, "contact.source.label", locale)}` and `locale={locale}`.
  - `business-field.tsx`: `const locale = useLocale();` first in `BusinessInlineField` (before the two `useState`s); `label={t(m, "contact.company", locale)}` and `locale={locale}` on the `InlineField`.
  - `[contactId]/contact-fields-panel.tsx`: `ContactDetailsBody` gets `const locale = useLocale();`; `contactSourceHint({ … }, locale)` (`:66-68`); `:76` and `:79` `t(m, labelKey, locale)` (`labelKey` is `keyof typeof m`, a `MessageKey`); each `InlineField` gets `locale={locale}`; `:92` `t(m, "contact.company", locale)`; `:106` `t(m, "assign.field.label", locale)`; `:163` `t(m, "common.none", locale)`; `:166` `t(m, "contact.clearField", locale)`; `:192` `t(m, "common.save", locale)`. `ContactTagsBody` (`:201-233`): `const locale = useLocale();`, `:215` `aria-label={t(m, "contact.removeTag", locale, { name: t.name })}` (rename the map variable `t` to `tag` first: it shadows the `t` function), `:226-227` `t(m, "contact.addTag", locale)`.

- [ ] **Step 5: The page's wrappers.** In `[contactId]/page.tsx` replace `:234-251` with:

```tsx
    // The Groups card's copy stays English (S-03 part 3 D10; spec §16 files its translation).
    groups: { node: <div lang="en"><GroupsCard accountId={accountId} contactId={contactId} canManageGroups={assign.canAssign} headingHidden /></div> },
    properties: { node: <PlacesCard accountId={accountId} contactId={contactId} canMovePlace={assign.canAssign} headingHidden /> },
    deals: deals.status === "ready" ? { node: <DealsBody deals={deals.deals} tr={tr} /> } : cardFailed("record.card.deals"),
    // S-03 part 3 (D10): Details and Tags are bilingual, so they inherit the page's lang.
    details: fieldDefs.status === "ready"
      ? {
        node: (
          <ContactDetailsBody accountId={accountId} contactId={contactId} contact={contact} fieldDefs={fieldDefs.fieldDefs}
            email={email} texts={texts} canAssign={assign.canAssign} members={assign.members} viewerId={assign.personId} />
        ),
      }
      : cardFailed("contact.details"),
    tags: tags.status === "ready"
      ? { node: <ContactTagsBody accountId={accountId} contactId={contactId} tags={tags.tags} /> }
      : cardFailed("contact.tags"),
```

- [ ] **Step 6 (LAST code step): messages.ts, the 62 twins.** Each line goes DIRECTLY under its English key (find it with `grep -n '"<key>":' apps/web/src/lib/messages.ts`). The words are spec §10.3's, verbatim; `compose.smsHeld` is NOT in this list (plan deviation 1):

```ts
  "contacts.firstName.es": "Nombre",
  "contacts.lastName.es": "Apellido",
  "contacts.email.es": "Correo",
  "contacts.phone.es": "Teléfono",
  "contact.addTag.es": "agregar etiqueta",
  "contact.removeTag.es": "Quitar {name}",
  "common.retry.es": "Intentar de nuevo",
  "common.save.es": "Guardar",
  "common.none.es": "—",
  "contact.clearField.es": "—",
  "contact.messages.title.es": "Mensajes",
  "contact.messages.texts.es": "Textos",
  "contact.messages.email.es": "Correo",
  "contact.texts.allowed.es": "Permitido",
  "contact.texts.stopped.es": "Detenido",
  "contact.texts.held.es": "En espera",
  "contact.texts.since.es": "Desde el {date}",
  "contact.email.since.es": "Desde el {date}",
  "contact.texts.how.keyword.es": "mandó {word} por texto",
  "contact.texts.how.freeText.es": "escribió “{excerpt}”, confirmado por su equipo",
  "contact.texts.how.freeTextBy.es": "escribió “{excerpt}”, confirmado por {name}",
  "contact.texts.how.staff.es": "usted lo registró",
  "contact.email.how.staff.es": "usted lo registró",
  "contact.texts.how.carrier.es": "la compañía telefónica lo bloqueó",
  "contact.texts.how.unsubscribeLink.es": "enlace para darse de baja",
  "contact.email.how.unsubscribeLink.es": "enlace para darse de baja",
  "contact.texts.stopTexts.es": "Detener textos",
  "contact.texts.stoppedToast.es": "Se detuvieron los textos.",
  "contact.texts.resume.es": "Reanudar textos…",
  "contact.texts.resumeSubmit.es": "Reanudar textos",
  "contact.texts.resumeCancel.es": "Cancelar",
  "contact.texts.resumeNoteLabel.es": "¿Qué pidió? (obligatorio)",
  "contact.email.resumeNoteLabel.es": "¿Qué pidió? (obligatorio)",
  "contact.texts.resumedToast.es": "Los textos se reanudaron. Para detenerlos otra vez, use Detener textos.",
  "contact.texts.customerOnly.es": "Puede mandar START por texto para volver a recibir textos.",
  "contact.texts.heldLine.es": "Escribió “{excerpt}”. Los textos están en espera.",
  "contact.texts.confirmStop.es": "Confirmar que pidió parar",
  "contact.texts.notAStop.es": "No pidió parar",
  "contact.texts.confirmedToast.es": "Confirmado. Ya no se le mandan textos.",
  "contact.texts.releasedToast.es": "Se quitó la espera. Se le vuelven a mandar textos.",
  "contact.texts.loadFailed.es": "No se pudo cargar la configuración de mensajes. Intente de nuevo.",
  "contact.texts.undoBusy.es": "Su último cambio todavía se está guardando. Intente de nuevo en un momento.",
  "contact.email.undoBusy.es": "Su último cambio todavía se está guardando. Intente de nuevo en un momento.",
  "contact.phoneCountry.line.es": "Este número puede ser de México o de EE. UU.",
  "contact.phoneCountry.mx.es": "México (+52)",
  "contact.phoneCountry.us.es": "EE. UU. (+1)",
  "contact.email.allowed.es": "Permitido",
  "contact.email.stopped.es": "Detenido",
  "contact.email.how.bounced.es": "rebotó",
  "contact.email.how.complained.es": "lo marcó como spam",
  "contact.email.how.backfill0049.es": "usted lo marcó como “Sin correos de promociones”",
  "contact.email.bouncedExplain.es": "Esta dirección rebotó: los correos no se envían. Corrija la dirección para empezar de nuevo.",
  "contact.email.complainedExplain.es": "Marcó un correo como spam: no le volveremos a escribir a menos que se vuelva a suscribir.",
  "contact.email.customerOnly.es": "Puede volver a suscribirse desde el enlace para darse de baja en cualquier correo que usted le mande.",
  "contact.email.stopEmails.es": "Detener correos",
  "contact.email.stoppedToast.es": "Se detuvieron los correos.",
  "contact.email.resume.es": "Reanudar correos…",
  "contact.email.resumeSubmit.es": "Reanudar correos",
  "contact.email.resumeCancel.es": "Cancelar",
  "contact.email.resumedToast.es": "Los correos se reanudaron. Para detenerlos otra vez, use Detener correos.",
  "contact.email.loadFailed.es": "No se pudo cargar la configuración de correo. Intente de nuevo.",
  "setup.rename.empty.es": "Una empresa necesita un nombre; este no puede quedar vacío.",
```

Then count, and stop if it is not 62: `git diff -U0 -- apps/web/src/lib/messages.ts | grep -c '^+  "[^"]*\.es":'` → `62`. `START` stays the keyword (it is what the carrier acts on).

- [ ] **Step 7: Run them; they pass.** Step 2's command, then every other test reaching the changed functions: `pnpm --filter web exec vitest run src/lib/consent "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" "src/app/(dashboard)/dashboard/accounts/[accountId]/tasks" src/lib/messages.test.ts src/lib/i18n/ratchet.test.ts "src/app/(dashboard)/dashboard/styleguide"` (`…/tasks/` holds `consent-hold-actions`, which calls `runTextsAction` with no locale; `…/contacts/` holds no live test). The ratchet's parity check passes (twins only shrink the missing list) and no file's JSX-literal count rises. Each named probe once by name. `pnpm --filter web typecheck`; eslint on every touched source file.

- [ ] **Step 8: Commit.**

```bash
git commit -m "feat(contacts): who they are reads English or Spanish on the record page and in the drawer, and the Texts and Email rows say what happened in the reader's language (S-03 part 3)" -- apps/web/src/lib/consent/texts-row.ts apps/web/src/lib/consent/texts-row.test.ts apps/web/src/lib/consent/email-row.ts apps/web/src/lib/consent/email-row.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/texts-row.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/texts-row.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/email-row.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/email-row.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/source-field.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/source-field.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/business-field.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/business-field.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/contact-fields-panel.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.test.ts" apps/web/src/lib/messages.ts
```

---

## Task 5: The summary route and the drawer's parser (bis-crm)

**Review:** opus (authorisation order, the ledger client, a body every open drawer parses). **Runs beside:** Task 3. **Starts after** Task 2.

**Files**
- Create: `apps/web/src/lib/contacts/drawer-summary.ts`, `drawer-summary.test.ts`
- Rewrite: `…/summary/route.ts` (all 134 lines), `…/summary/route.test.ts` (all 272 lines)
- Modify: `apps/web/src/lib/contacts/summary.ts:1` and `summary.test.ts:2` (the old `ContactSummary` type moves INTO `summary.ts`, so the old drawer still compiles until Task 6 deletes both files; between this commit and Task 6's, an open drawer shows its "couldn't load" state: the old parser refuses the new body, `summary.test.ts:90`)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts:105-106` (one line)

**Interfaces**
- Consumes: Task 2's `headerActionLabels`, `loadRecent`, `recentRowsView`, `RecentRowView`, `contactSourceHint(input, locale)`; `headerActions`, `canTextFrom`, `firstMapUrl` (`header-actions.ts:22-51`); `loadSummary`, `loadNextUp`, `loadTags`, `loadHeaderPlaces`, `softSmsGate` (`loaders.ts:20-135`); `factsView` (`record-facts.ts:49`), `FactsView`; `nextUpView` (`next-up.ts:18`), `NextUpView`, `NextUpRow`; `timelineRows`, `timelineFailedText` (`timeline-rows.ts:99-122`); `TIMELINE_ANCHOR` (`timeline-pager.ts:5`); `makeTr` (`copy.ts:15`); `requestLocale`, `requestPseudoMode` (`lib/i18n/request-locale.ts:35`, `:78`); `getPersonPrefs` (`lib/preferences/person-prefs.ts:72`); `ledgerDb` (`lib/consent/ledger-db.ts:15`); `smsRecipientState(db, accountId, contact)` (`lib/consent/recipient-state.ts:21-37`, never throws); `composerStateLine(state, zone, locale)` (`lib/consent/composer-state.ts:48`); `apiAccountAccess` → `{ userId, isAgency } | null` (`lib/auth.ts:178-190`); `contactDisplayName` (`lib/format.ts:119`); `RecordHeaderAction` (`record-header.tsx:5`).
- Produces (Task 6 relies on these exact names, all in `lib/contacts/drawer-summary.ts`):

```ts
export type DrawerFields = { first_name: string | null; last_name: string | null; email: string | null; phone: string | null; company_name: string | null };
export type DrawerSummary = {
  locale: Locale;
  header: { name: string; subtitle: string | null; subtitleHref: string | null; actions: RecordHeaderAction[] };
  facts: { status: "ready"; view: FactsView } | { status: "error"; text: string };
  nextUp: { status: "ready"; view: NextUpView; emptyText: string } | { status: "error"; text: string };
  recent:
    | { status: "ready"; rows: RecentRowView[]; failedText: string | null; emptyText: string | null; seeAllHref: string }
    | { status: "error"; text: string };
  who: {
    source: string | null; sourceHint: string | null; assignedTo: string | null; fields: DrawerFields;
    tags: { status: "ready"; tags: { id: string; name: string }[] } | { status: "error" };
  };
};
export type ParsedWho =
  | ({ status: "ready" } & Omit<DrawerSummary["who"], "assignedTo"> & { assignedTo: string | null | undefined })
  | { status: "error"; text: string };
export type ParsedDrawerSummary = Omit<DrawerSummary, "who"> & { who: ParsedWho };
export function parseDrawerSummary(json: unknown): ParsedDrawerSummary | null;
export type DrawerLoad = { status: "error" } | { status: "ready"; body: ParsedDrawerSummary };
export async function drawerLoadFrom(res: { ok: boolean; json: () => Promise<unknown> }): Promise<DrawerLoad>;
export function drawerSummaryUrl(accountId: string, contactId: string, search: string): string;
export function drawerFieldsRow<R extends DrawerFields & { created_at: string }>(row: R, load: DrawerLoad | { status: "loading" }): R | null;
```

- [ ] **Step 1: Write the failing parser test** `apps/web/src/lib/contacts/drawer-summary.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { m } from "@/lib/messages";
import { parseDrawerSummary, drawerLoadFrom, drawerSummaryUrl, drawerFieldsRow, type DrawerSummary } from "./drawer-summary";

const ROW = { key: "booking-b1", kind: "booking", mark: { kind: "customer", label: "Customer" }, verb: "booked an appointment for Fri, Oct 16, 10:00 AM",
  status: { tone: "accent", word: "Booked" }, detail: null, time: "Oct 9, 2026, 11:12 AM", dateTime: "2026-10-09T16:12:00Z",
  excerpt: { text: "Gate code 4411", lang: "", done: false } } as const;
const GOOD: DrawerSummary = {
  locale: "en",
  header: { name: "Maria Garcia", subtitle: "García household", subtitleHref: "/dashboard/accounts/a1/groups/g1", actions: [
    { id: "call", label: "Call", href: "tel:+19565550100", ariaLabel: "Call Maria Garcia", primary: true, external: false },
    { id: "email", label: "Email", href: "/dashboard/accounts/a1/contacts/c1#compose-email", primary: false, external: false },
  ] },
  facts: { status: "ready", view: { line: ["Customer since Dec 2025"], missing: null, allFailed: false } },
  nextUp: { status: "ready", view: { rows: [{ kind: "booking", id: "b1", label: "Fri, Oct 16 · 10:00 AM", who: null }], undated: null }, emptyText: "Nothing coming up." },
  recent: { status: "ready", rows: [{ ...ROW, mark: { ...ROW.mark }, status: { ...ROW.status }, excerpt: { ...ROW.excerpt } }], failedText: null, emptyText: null,
    seeAllHref: "/dashboard/accounts/a1/contacts/c1#record-timeline" },
  who: { source: "voice", sourceHint: "They called in", assignedTo: null,
    fields: { first_name: "Maria", last_name: "Garcia", email: "maria@example.com", phone: "+19565550100", company_name: null },
    tags: { status: "ready", tags: [{ id: "t1", name: "vip" }] } },
};
const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(GOOD));

describe("parseDrawerSummary (S-03 part 3 §7.4): checked, not cast, one section at a time", () => {
  it("a good body parses to itself, ready everywhere (mutation: drop a field from any section's parse -> FAILS)", () => {
    expect(parseDrawerSummary(clone())).toEqual({ ...GOOD, who: { status: "ready", ...GOOD.who } });
  });

  it("a malformed Recent costs Recent alone, with its own words (mutation: return null for the whole body on any bad section -> FAILS)", () => {
    const body = clone();
    body.recent = { status: "ready", rows: "not rows" };
    const parsed = parseDrawerSummary(body)!;
    expect(parsed.recent).toEqual({ status: "error", text: m["record.card.failed"].replace("{title}", m["drawer.recent"]) });
    expect([parsed.facts.status, parsed.nextUp.status, parsed.who.status]).toEqual(["ready", "ready", "ready"]);
  });

  it("each section's fallback is in the body's own language (mutation: read the fallback in English -> FAILS)", () => {
    const body = clone();
    body.locale = "es";
    body.nextUp = 42;
    expect(parseDrawerSummary(body)!.nextUp).toEqual({ status: "error", text: m["record.card.failed.es"].replace("{title}", m["record.card.nextUp.es"]) });
  });

  it("a server's own error section passes through with its words", () => {
    const body = clone();
    body.facts = { status: "error", text: "Couldn't load the summary." };
    expect(parseDrawerSummary(body)!.facts).toEqual({ status: "error", text: "Couldn't load the summary." });
  });

  it("no header, or no known locale, is the whole drawer's error: nothing to title it with (mutation: default the header -> FAILS)", () => {
    const noHeader = clone(); delete noHeader.header;
    expect(parseDrawerSummary(noHeader)).toBeNull();
    const badLocale = clone(); badLocale.locale = "fr";
    expect(parseDrawerSummary(badLocale)).toBeNull();
    expect(parseDrawerSummary("<html>")).toBeNull();
  });

  it("an action whose href is not tel:, a path, an anchor or https is refused (mutation: accept any string -> FAILS)", () => {
    const body = clone();
    (body.header as { actions: { href: string }[] }).actions[0]!.href = "javascript:alert(1)";
    expect(parseDrawerSummary(body)).toBeNull();
  });

  it("a recent row of a kind this bundle does not know is dropped and the rest stay (mutation: refuse the section -> FAILS)", () => {
    const body = clone();
    (body.recent as { rows: unknown[] }).rows.unshift({ ...ROW, key: "visit-v1", kind: "visit" });
    expect(parseDrawerSummary(body)!.recent).toEqual(GOOD.recent);
  });

  it("who: a missing holder leaves Assigned to out (undefined), never Unassigned; a bad tags list costs Tags alone", () => {
    const body = clone();
    delete (body.who as Record<string, unknown>).assignedTo;
    (body.who as Record<string, unknown>).tags = { status: "ready", tags: [{ id: 1 }] };
    const who = parseDrawerSummary(body)!.who;
    expect(who).toMatchObject({ status: "ready", assignedTo: undefined, tags: { status: "error" }, source: "voice" });
  });
});

describe("drawerLoadFrom, drawerSummaryUrl, drawerFieldsRow", () => {
  it("a non-OK answer is the error and its body is never read (mutation: parse first -> FAILS)", async () => {
    const json = vi.fn(async () => GOOD);
    expect(await drawerLoadFrom({ ok: false, json })).toEqual({ status: "error" });
    expect(json).not.toHaveBeenCalled();
    expect(await drawerLoadFrom({ ok: true, json })).toMatchObject({ status: "ready", body: { locale: "en" } });
  });

  it("the QA locale rides along only when the list URL has one (C9; mutation: always append -> the bare-path case FAILS)", () => {
    expect(drawerSummaryUrl("a1", "c1", "")).toBe("/api/accounts/a1/contacts/c1/summary");
    expect(drawerSummaryUrl("a1", "c1", "?q=Retry&peek=c1")).toBe("/api/accounts/a1/contacts/c1/summary");
    expect(drawerSummaryUrl("a1", "c1", "?q=x&locale=pseudo")).toBe("/api/accounts/a1/contacts/c1/summary?locale=pseudo");
    expect(drawerSummaryUrl("a1", "c1", "?locale=%3Cscript%3E")).toBe("/api/accounts/a1/contacts/c1/summary");
  });

  it("Q1: a real row feeds the fields; a ?peek= stub waits for the route's (mutation: show the stub's blanks -> FAILS)", () => {
    const real = { id: "c1", first_name: "Ana", last_name: null, email: null, phone: null, company_name: null, created_at: "2026-09-01T00:00:00Z" };
    const stub = { ...real, first_name: null, created_at: "" };
    expect(drawerFieldsRow(real, { status: "loading" })).toBe(real);
    expect(drawerFieldsRow(stub, { status: "loading" })).toBeNull();
    const ready = { status: "ready" as const, body: parseDrawerSummary(clone())! };
    expect(drawerFieldsRow(stub, ready)).toEqual({ ...stub, ...GOOD.who.fields });
  });
});
```

- [ ] **Step 2: Write the failing route test**, replacing `…/summary/route.test.ts` whole:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The list drawer's one read (S-03 part 3 §7). Every loader is the record page's own, run for real
 * over mocked @bis/db readers, so a section's failure is proven end to end through its loader.
 */
const order: string[] = [];
const access = vi.fn();
vi.mock("@/lib/auth", () => ({ apiAccountAccess: (...a: unknown[]) => access(...a) }));
const accountRead = vi.fn(async (): Promise<{ data: unknown; error: unknown }> =>
  ({ data: { timezone: "America/Chicago", language: null }, error: null }));
const db = { from: () => { const chain = { select: () => chain, eq: () => chain, maybeSingle: () => accountRead() }; return chain; } };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => db }));
vi.mock("@/lib/zone", () => ({
  renderZone: async (z?: string) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC", source: z ? "account" : "fallback" }),
}));
const prefs = vi.fn(async () => ({ language: null as "en" | "es" | null, theme: null }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: () => { order.push("getPersonPrefs"); return prefs(); } }));
const ledger = { tag: "ledger" };
vi.mock("@/lib/consent/ledger-db", () => ({ ledgerDb: () => { order.push("ledgerDb"); return ledger; } }));
const smsState = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ kind: "ok" }));
vi.mock("@/lib/consent/recipient-state", () => ({ smsRecipientState: (...a: unknown[]) => smsState(...a) }));
const gate = vi.fn(async (): Promise<unknown> => ({ ok: false, reason: "a2p_not_approved" }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => { order.push("resolveSmsSender"); return gate(); } }));

const READY_FACTS = { bookingsMade: { ok: true, value: 0 }, lastTalked: { ok: true, value: null }, openDeals: { ok: true, value: { count: 0, amount: null } } };
const NO_PLACES = { groups: [], places: [], placeCount: 0, equipment: [], equipmentCount: 0 };
const EMPTY_PAGE = { items: [], older: null, failed: [] };
const dbMocks = {
  getContact: vi.fn(), contactFacts: vi.fn(), contactNextUp: vi.fn(), listContactTimelinePage: vi.fn(), listPeopleNames: vi.fn(),
  getVoiceProfile: vi.fn(), listContactTags: vi.fn(), listContactPlaces: vi.fn(), listContactMessages: vi.fn(), holdOpenTaskIds: vi.fn(),
};
vi.mock("@bis/db", () => ({
  ...Object.fromEntries(Object.entries(dbMocks).map(([k, f]) => [k, (...a: unknown[]) => { order.push(k); return f(...a); }])),
  TIMELINE_SOURCES: ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"],
  listContactOpportunities: async () => [], listCustomFields: async () => [],
}));

const { GET } = await import("./route");
const { parseDrawerSummary } = await import("@/lib/contacts/drawer-summary");
const { m } = await import("@/lib/messages");

const CONTACT = { id: "c1", first_name: "Maria", last_name: "Garcia", email: "maria@example.com", phone: "+19565550100", company_name: null,
  created_at: "2025-12-02T00:00:00Z", source: "voice", custom: {}, attribution: null, assigned_to: null, phone_country_unconfirmed: false };
const AT = "2026-10-09T16:12:00Z";
const BOOKING = { kind: "booking", id: "b1", at: AT, contactId: "c1", booking: { id: "b1", contact_id: "c1", created_at: AT, starts_at: "2026-10-16T15:00:00Z",
  status: "booked", note: null, author_kind: "customer", author_id: null, rescheduled_from_id: null, moved_from_starts_at: null } };
const SUBMISSION = { kind: "submission", id: "s1", at: "2026-10-08T16:12:00Z", contactId: "c1",
  submission: { id: "s1", created_at: "2026-10-08T16:12:00Z", formName: "Contact us", answers: [], author_kind: "customer" } };

const req = (q = "") => new Request(`http://x/api/accounts/a1/contacts/c1/summary${q}`);
const ctx = () => ({ params: Promise.resolve({ accountId: "a1", contactId: "c1" }) });
const body = async (q = "") => (await GET(req(q), ctx())).json();

beforeEach(() => {
  order.length = 0;
  access.mockReset().mockResolvedValue({ userId: "u1", isAgency: true });
  prefs.mockReset().mockResolvedValue({ language: null, theme: null });
  smsState.mockReset().mockResolvedValue({ kind: "ok" });
  gate.mockReset().mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
  dbMocks.getContact.mockReset().mockResolvedValue(CONTACT);
  dbMocks.contactFacts.mockReset().mockResolvedValue(READY_FACTS);
  dbMocks.contactNextUp.mockReset().mockResolvedValue({ bookings: [], datedTasks: [], undatedCount: 0 });
  dbMocks.listContactTimelinePage.mockReset().mockResolvedValue(EMPTY_PAGE);
  dbMocks.listPeopleNames.mockReset().mockResolvedValue({});
  dbMocks.getVoiceProfile.mockReset().mockResolvedValue(null);
  dbMocks.listContactTags.mockReset().mockResolvedValue([{ id: "t1", name: "vip" }]);
  dbMocks.listContactPlaces.mockReset().mockResolvedValue(NO_PLACES);
  dbMocks.listContactMessages.mockReset().mockResolvedValue([]);
  dbMocks.holdOpenTaskIds.mockReset().mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("the drawer's summary route: authorisation first", () => {
  it("without access, a 404 that reads nothing", async () => {
    access.mockResolvedValueOnce(null);
    expect((await GET(req(), ctx())).status).toBe(404);
    expect(order).toEqual([]);
  });

  it("a contact the caller cannot see is a 404 before ANY other read, the ledger client included (mutation: start the parallel block before getContact -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValueOnce(null);
    expect((await GET(req(), ctx())).status).toBe(404);
    expect(order).toEqual(["getContact"]);
  });

  it("the ledger client is built only after getContact proved the contact (mutation: build it first -> FAILS)", async () => {
    await body();
    expect(order.indexOf("ledgerDb")).toBeGreaterThan(order.indexOf("getContact"));
    expect(smsState).toHaveBeenCalledWith(ledger, "a1", CONTACT);
  });
});

describe("the drawer's summary route: each section loads and fails on its own (C2)", () => {
  it.each([
    ["facts", () => dbMocks.contactFacts.mockRejectedValueOnce(new Error("down")), (b: Record<string, { status: string }>) => b.facts],
    ["nextUp", () => dbMocks.contactNextUp.mockRejectedValueOnce(new Error("down")), (b: Record<string, { status: string }>) => b.nextUp],
    ["recent", () => dbMocks.listContactTimelinePage.mockRejectedValueOnce(new Error("down")), (b: Record<string, { status: string }>) => b.recent],
    ["tags", () => dbMocks.listContactTags.mockRejectedValueOnce(new Error("down")), (b: { who: { tags: { status: string } } }) => b.who.tags],
  ])("%s failing alone is that section's error and the rest are ready (mutation: one Promise.all without per-section loads -> the route 500s, FAILS)", async (name, fail, pick) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    fail();
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const b = await res.json();
    expect((pick as (x: unknown) => { status: string })(b).status).toBe("error");
    const others = { facts: b.facts.status, nextUp: b.nextUp.status, recent: b.recent.status, tags: b.who.tags.status };
    delete (others as Record<string, string>)[name];
    expect(Object.values(others)).toEqual(["ready", "ready", "ready"]);
    expect(errors).toHaveBeenCalled();
  });

  it("the sections' own error words, in the reader's language", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.contactFacts.mockRejectedValueOnce(new Error("down"));
    dbMocks.contactNextUp.mockRejectedValueOnce(new Error("down"));
    dbMocks.listContactTimelinePage.mockRejectedValueOnce(new Error("down"));
    const b = await body();
    expect([b.facts.text, b.nextUp.text, b.recent.text]).toEqual([m["record.summary.failed"], m["record.nextUp.failed"], m["record.activity.failed"]]);
  });
});

describe("the drawer's summary route: Recent (D5, C6)", () => {
  it("reads the head of the timeline, five rows (mutation: drop the limit -> 30, FAILS)", async () => {
    await body();
    expect(dbMocks.listContactTimelinePage).toHaveBeenCalledWith(db, "a1", "c1", undefined, expect.objectContaining({ limit: 5 }));
  });

  it("the submission once, never the inbox's form copy beside it: no direct message read (mutation: re-add today's listContactMessages read -> FAILS)", async () => {
    dbMocks.listContactMessages.mockResolvedValue([{ id: "x1", channel: "form", direction: "inbound", body: "Leak", created_at: AT }]);
    dbMocks.listContactTimelinePage.mockResolvedValueOnce({ items: [BOOKING, SUBMISSION], older: null, failed: [] });
    const b = await body();
    expect(b.recent.rows.map((r: { kind: string }) => r.kind)).toEqual(["booking", "submission"]);
    expect(dbMocks.listContactMessages).not.toHaveBeenCalled();
  });

  it("every row is marked, the booking page's booking the customer's; See all opens the record's timeline", async () => {
    dbMocks.listContactTimelinePage.mockResolvedValueOnce({ items: [BOOKING], older: null, failed: [] });
    const b = await body();
    expect(b.recent.rows[0].mark).toEqual({ kind: "customer", label: m["provenance.customer"] });
    expect(b.recent.seeAllHref).toBe("/dashboard/accounts/a1/contacts/c1#record-timeline");
    expect(b.recent.emptyText).toBeNull();
  });

  it("empty only when nothing failed; a failed source says so and keeps the rows that loaded (rule 5: a failure is not 'nothing')", async () => {
    expect((await body()).recent.emptyText).toBe(m["timeline.empty"]);
    dbMocks.listContactTimelinePage.mockResolvedValueOnce({ items: [BOOKING], older: null, failed: ["calls"] });
    const b = await body();
    expect(b.recent.emptyText).toBeNull();
    expect(b.recent.failedText).toBe(m["timeline.someFailed"].replace("{what}", m["timeline.what.calls"]));
    expect(b.recent.rows).toHaveLength(1);
  });
});

describe("the drawer's summary route: the header (D2, C7, C8)", () => {
  it("Text and Email open the record page's composer, Call is the only primary (mutation: omit composeHref -> a bare #compose-sms, FAILS)", async () => {
    gate.mockResolvedValue({ ok: true, from: "+19565559999", ownedNumbers: ["+19565559999"] });
    const b = await body();
    expect(b.header.actions.map((a: { id: string }) => a.id)).toEqual(["call", "text", "email"]);
    expect(b.header.actions.find((a: { id: string }) => a.id === "text").href).toBe("/dashboard/accounts/a1/contacts/c1#compose-sms");
    expect(b.header.actions.find((a: { id: string }) => a.id === "email").href).toBe("/dashboard/accounts/a1/contacts/c1#compose-email");
    expect(b.header.actions.filter((a: { primary: boolean }) => a.primary).map((a: { id: string }) => a.id)).toEqual(["call"]);
    expect(b.header.actions[0]).toMatchObject({ label: m["record.action.call"], ariaLabel: "Call Maria Garcia" });
  });

  it("a closed gate or a stopped number hides Text; no email hides Email; none renders disabled (mutation: ignore the consent line -> FAILS)", async () => {
    gate.mockResolvedValue({ ok: true, from: "+19565559999", ownedNumbers: ["+19565559999"] });
    smsState.mockResolvedValue({ kind: "stopped", since: "2026-10-01T00:00:00Z" });
    dbMocks.getContact.mockResolvedValue({ ...CONTACT, email: null });
    expect((await body()).header.actions.map((a: { id: string }) => a.id)).toEqual(["call"]);
  });

  it("the main group's words link to its page", async () => {
    dbMocks.listContactPlaces.mockResolvedValue({ ...NO_PLACES, groups: [{ id: "g1", kind: "household", name: "García", isPrimary: true }] });
    const b = await body();
    expect(b.header.subtitle).toBe(m["record.group.household"].replace("{group}", "García"));
    expect(b.header.subtitleHref).toBe("/dashboard/accounts/a1/groups/g1");
  });
});

describe("the drawer's summary route: one locale, resolved on the server (C1, §7.3)", () => {
  it("a client with no language of their own on a Spanish account reads Spanish (mutation: pass isOperator: true for a client -> English, FAILS)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: false });
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    const b = await body();
    expect(b.locale).toBe("es");
    expect(b.header.actions[0].label).toBe(m["record.action.call.es"]);
    expect(b.nextUp.emptyText).toBe(m["record.nextUp.empty.es"]);
    expect(b.who.sourceHint).toBe(m["contact.source.machine.voice.es"]);
  });

  it("the agency reads its own language on that account (requestLocale's role split)", async () => {
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    expect((await body()).locale).toBe("en");
  });

  it("the QA override the drawer forwards reaches the strings (C9; mutation: drop { locale } from requestPseudoMode -> FAILS)", async () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    const b = await body("?locale=pseudo");
    expect(b.header.actions[0].label).not.toBe(m["record.action.call"]);
    expect(b.locale).toBe("en");
  });
});

describe("the drawer's summary route: who they are (D6, Q1)", () => {
  it("source, its caption, the holder and the contact's own fields, off the same getContact read (mutation: drop any -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue({ ...CONTACT, assigned_to: "11111111-1111-4111-8111-111111111111", source: "form: Contact us",
      attribution: { first: { ref: "https://chat.openai.com/" } } });
    const b = await body();
    expect(b.who).toEqual({
      source: "form: Contact us", sourceHint: "Found through ChatGPT", assignedTo: "11111111-1111-4111-8111-111111111111",
      fields: { first_name: "Maria", last_name: "Garcia", email: "maria@example.com", phone: "+19565550100", company_name: null },
      tags: { status: "ready", tags: [{ id: "t1", name: "vip" }] },
    });
  });

  it("an unassigned customer sends null, never leaves the field out (mutation: send undefined -> FAILS)", async () => {
    expect(await body()).toHaveProperty(["who", "assignedTo"], null);
  });

  it("the old shape is gone: no recent labels, no phone_country_unconfirmed, no zone (D11)", async () => {
    const b = await body();
    expect(Object.keys(b).sort()).toEqual(["facts", "header", "locale", "nextUp", "recent", "who"]);
  });
});

describe("what the route sends, the drawer's parser accepts whole", () => {
  it("parses to exactly the body sent, with a row of every kind (mutation: send a field the parser drops -> FAILS)", async () => {
    gate.mockResolvedValue({ ok: true, from: "+19565559999", ownedNumbers: ["+19565559999"] });
    const items = [
      BOOKING, SUBMISSION,
      { kind: "note", id: "n1", at: AT, contactId: "c1", note: { id: "n1", body: "Prefers mornings", author_id: "u1", created_at: AT } },
      { kind: "task", id: "t1", at: AT, contactId: "c1", task: { id: "t1", title: "Call back", due_at: null, completed_at: null, created_at: AT,
        consent_event_id: null, call_id: null, assigned_to: null, created_by: "u2" } },
      { kind: "deal", id: "d1", at: AT, contactId: "c1", deal: { id: "d1", name: "Deck build", status: "open", monetary_value: 1200, created_at: AT, created_by: null } },
      { kind: "message", id: "m1", at: AT, contactId: "c1", message: { id: "m1", channel: "sms", direction: "outbound", status: "delivered", subject: null,
        body: "On our way", error: null, created_at: AT, author_kind: "person", author_id: "u1" } },
      { kind: "call", id: "k1", at: AT, contactId: "c1", call: { id: "k1", contact_id: "c1", started_at: AT, outcome: "booked", duration_secs: 180,
        reason: null, summary: "Roof leak, booked.", language: "en" } },
    ];
    dbMocks.listContactTimelinePage.mockResolvedValueOnce({ items, older: null, failed: [] });
    const b = await body();
    expect(b.recent.rows.map((r: { kind: string }) => r.kind).sort()).toEqual(["booking", "call", "deal", "message", "note", "submission", "task"]);
    const parsed = parseDrawerSummary(b)!;
    expect(parsed).toEqual({ ...b, who: { status: "ready", ...b.who } });
  });
});
```

(Read `loaders.ts:20-39` and `record.ts:155-200` before running: `contactNextUp`'s answer shape is `{ bookings, datedTasks, undatedCount }`; `nextUpView` reads exactly those three.)

- [ ] **Step 3: Run both; they fail.**

Run: `pnpm --filter web exec vitest run src/lib/contacts/drawer-summary.test.ts "src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.test.ts"`

Expected: FAIL — `Failed to resolve import "./drawer-summary"` in both files (the route test imports the parser).

- [ ] **Step 4: Implement the parser** `apps/web/src/lib/contacts/drawer-summary.ts`:

```ts
import type { AuthorKind } from "@bis/db";
import type { RecordHeaderAction } from "@/components/record/record-header";
import type { TimelineTone } from "@/components/record/timeline-item";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { FactsView } from "@/lib/record/record-facts";
import type { NextUpRow, NextUpView, NextUpWho } from "@/lib/record/next-up";
import type { RecentRowView } from "@/lib/record/recent-rows";

/** The editable fields the drawer shows for a `?peek=` stub row (Q1). */
export type DrawerFields = { first_name: string | null; last_name: string | null; email: string | null; phone: string | null; company_name: string | null };

/**
 * The list drawer's one read (S-03 part 3 §7.2). Every string in it is already in `locale`, built on
 * the server by the record page's own view builders (C1); each section carries its own status (C2).
 */
export type DrawerSummary = {
  locale: Locale;
  header: { name: string; subtitle: string | null; subtitleHref: string | null; actions: RecordHeaderAction[] };
  facts: { status: "ready"; view: FactsView } | { status: "error"; text: string };
  nextUp: { status: "ready"; view: NextUpView; emptyText: string } | { status: "error"; text: string };
  recent:
    | { status: "ready"; rows: RecentRowView[]; failedText: string | null; emptyText: string | null; seeAllHref: string }
    | { status: "error"; text: string };
  who: {
    source: string | null; sourceHint: string | null; assignedTo: string | null; fields: DrawerFields;
    tags: { status: "ready"; tags: { id: string; name: string }[] } | { status: "error" };
  };
};

type Failed = { status: "error"; text: string };
/** `assignedTo` undefined: the server did not say (an older one), so the drawer leaves the line out. */
export type ParsedWho =
  | ({ status: "ready" } & Omit<DrawerSummary["who"], "assignedTo"> & { assignedTo: string | null | undefined })
  | Failed;
export type ParsedDrawerSummary = Omit<DrawerSummary, "who"> & { who: ParsedWho };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
// `Object.hasOwn`, not `in`: "constructor" is a property of any object literal and is not a kind.
const oneOf = <T extends string>(set: Readonly<Record<T, true>>, v: unknown): v is T => typeof v === "string" && Object.hasOwn(set, v);
const LOCALES: Readonly<Record<Locale, true>> = { en: true, es: true };
const TONES: Readonly<Record<TimelineTone, true>> = { accent: true, good: true, warn: true, crit: true, muted: true };
const AUTHORS: Readonly<Record<AuthorKind, true>> = { person: true, ai: true, automation: true, customer: true, import: true };
const ROW_KINDS: Readonly<Record<RecentRowView["kind"], true>> = {
  note: true, task: true, deal: true, submission: true, message: true, booking: true, call: true,
};
/** Where a header action may point: a phone, this app, an anchor, or an https map. Never `javascript:`. */
const safeHref = (h: string) => /^(tel:|\/|#|https:\/\/)/.test(h);

function parseHeader(v: unknown): DrawerSummary["header"] | null {
  if (!isRecord(v) || !isStr(v.name) || !strOrNull(v.subtitle) || !strOrNull(v.subtitleHref) || !Array.isArray(v.actions)) return null;
  if (v.subtitleHref !== null && !safeHref(v.subtitleHref)) return null;
  const actions: RecordHeaderAction[] = [];
  for (const a of v.actions) {
    if (!isRecord(a) || !isStr(a.id) || !isStr(a.label) || !isStr(a.href) || !safeHref(a.href)) return null;
    if (a.ariaLabel !== undefined && !isStr(a.ariaLabel)) return null;
    actions.push({ id: a.id, label: a.label, href: a.href, ariaLabel: a.ariaLabel, primary: a.primary === true, external: a.external === true });
  }
  return { name: v.name, subtitle: v.subtitle, subtitleHref: v.subtitleHref, actions };
}

/** A section: the server's own error passes through; a ready one the parser accepts; anything else is `fallback`. */
function section<T>(v: unknown, ready: (r: Record<string, unknown>) => T | null, fallback: string): T | Failed {
  if (isRecord(v) && v.status === "error" && isStr(v.text)) return { status: "error", text: v.text };
  if (isRecord(v) && v.status === "ready") {
    const r = ready(v);
    if (r !== null) return r;
  }
  return { status: "error", text: fallback };
}

function parseWho(v: unknown): NextUpWho | null | undefined {
  if (v === null) return null;
  return isRecord(v) && isStr(v.name) && isBool(v.typed) ? { name: v.name, typed: v.typed } : undefined;
}

function parseNextUpRow(r: unknown): NextUpRow | null {
  if (!isRecord(r) || !isStr(r.id)) return null;
  const who = parseWho(r.who);
  if (who === undefined) return null;
  if (r.kind === "booking" && isStr(r.label)) return { kind: "booking", id: r.id, label: r.label, who };
  if (r.kind === "task" && isStr(r.title) && isStr(r.detail) && isBool(r.overdue)) {
    return { kind: "task", id: r.id, title: r.title, detail: r.detail, overdue: r.overdue, who };
  }
  return null;
}

/** A row, or "unknown" for a kind this bundle does not know (dropped), or null when malformed. */
function parseRecentRow(r: unknown): RecentRowView | "unknown" | null {
  if (!isRecord(r)) return null;
  if (!oneOf(ROW_KINDS, r.kind)) return isStr(r.kind) ? "unknown" : null;
  const mark = r.mark;
  if (!isStr(r.key) || !isRecord(mark) || !oneOf(AUTHORS, mark.kind) || !isStr(mark.label) || !isStr(r.verb)
    || !strOrNull(r.detail) || !isStr(r.time) || !isStr(r.dateTime)) return null;
  const st = r.status;
  const status = st === null ? null : isRecord(st) && oneOf(TONES, st.tone) && isStr(st.word) ? { tone: st.tone, word: st.word } : undefined;
  const ex = r.excerpt;
  const excerpt = ex === null ? null
    : isRecord(ex) && isStr(ex.text) && (ex.lang === "" || ex.lang === "en") && isBool(ex.done) ? { text: ex.text, lang: ex.lang, done: ex.done } : undefined;
  if (status === undefined || excerpt === undefined) return null;
  return { key: r.key, kind: r.kind, mark: { kind: mark.kind, label: mark.label }, verb: r.verb, status, detail: r.detail, time: r.time, dateTime: r.dateTime, excerpt };
}

const FIELD_KEYS = ["first_name", "last_name", "email", "phone", "company_name"] as const;

/**
 * The drawer's summary body, checked rather than cast (S-03 part 3 §7.4): the body comes from
 * whatever server answered, possibly older or newer than this tab's bundle, and the drawer renders
 * inside the dashboard's only error boundary. Null (the whole drawer's error) only when `locale` or
 * `header` is missing or malformed: without them there is nothing to title the drawer with. Any other
 * section that fails to parse is that section's error, in `locale`, and the rest still render. A
 * recent row of an unknown kind is dropped. Keys it does not know are not carried through.
 */
export function parseDrawerSummary(json: unknown): ParsedDrawerSummary | null {
  if (!isRecord(json) || !oneOf(LOCALES, json.locale)) return null;
  const locale = json.locale;
  const header = parseHeader(json.header);
  if (!header) return null;
  const failed = (title: MessageKey) => t(m, "record.card.failed", locale, { title: t(m, title, locale) });

  const facts = section(json.facts, (r) => {
    const v = r.view;
    return isRecord(v) && Array.isArray(v.line) && v.line.every(isStr) && strOrNull(v.missing) && isBool(v.allFailed)
      ? { status: "ready" as const, view: { line: [...v.line], missing: v.missing, allFailed: v.allFailed } } : null;
  }, t(m, "record.summary.failed", locale));

  const nextUp = section(json.nextUp, (r) => {
    const v = r.view;
    if (!isRecord(v) || !Array.isArray(v.rows) || !strOrNull(v.undated) || !isStr(r.emptyText)) return null;
    const rows = v.rows.map(parseNextUpRow);
    return rows.every((x): x is NextUpRow => x !== null)
      ? { status: "ready" as const, view: { rows, undated: v.undated }, emptyText: r.emptyText } : null;
  }, failed("record.card.nextUp"));

  const recent = section(json.recent, (r) => {
    if (!Array.isArray(r.rows) || !strOrNull(r.failedText) || !strOrNull(r.emptyText) || !isStr(r.seeAllHref) || !safeHref(r.seeAllHref)) return null;
    const rows: RecentRowView[] = [];
    for (const raw of r.rows) {
      const row = parseRecentRow(raw);
      if (row === null) return null;
      if (row !== "unknown") rows.push(row);
    }
    return { status: "ready" as const, rows, failedText: r.failedText, emptyText: r.emptyText, seeAllHref: r.seeAllHref };
  }, failed("drawer.recent"));

  const w = json.who;
  let who: ParsedWho = { status: "error", text: failed("contact.details") };
  if (isRecord(w) && strOrNull(w.source) && strOrNull(w.sourceHint) && isRecord(w.fields) && FIELD_KEYS.every((k) => strOrNull((w.fields as Record<string, unknown>)[k]))) {
    const f = w.fields as Record<(typeof FIELD_KEYS)[number], string | null>;
    const tg = w.tags;
    const tags = isRecord(tg) && tg.status === "ready" && Array.isArray(tg.tags) && tg.tags.every((x) => isRecord(x) && isStr(x.id) && isStr(x.name))
      ? { status: "ready" as const, tags: (tg.tags as { id: string; name: string }[]).map((x) => ({ id: x.id, name: x.name })) }
      : { status: "error" as const };
    who = {
      status: "ready", source: w.source, sourceHint: w.sourceHint,
      // Null is a fact ("Unassigned"); anything else says nothing, and the drawer leaves the line out.
      assignedTo: isStr(w.assignedTo) ? w.assignedTo : w.assignedTo === null ? null : undefined,
      fields: { first_name: f.first_name, last_name: f.last_name, email: f.email, phone: f.phone, company_name: f.company_name },
      tags,
    };
  }
  return { locale, header, facts, nextUp, recent, who };
}

export type DrawerLoad = { status: "error" } | { status: "ready"; body: ParsedDrawerSummary };

/** The drawer's fetch `.then` body: a non-OK answer is the error and its body is never read. */
export async function drawerLoadFrom(res: { ok: boolean; json: () => Promise<unknown> }): Promise<DrawerLoad> {
  if (!res.ok) return { status: "error" };
  const body = parseDrawerSummary(await res.json());
  return body ? { status: "ready", body } : { status: "error" };
}

// The QA override (lib/i18n/request-locale.ts); anything else on the URL is dropped, never echoed.
const QA_LOCALES = new Set(["en", "es", "pseudo"]);

/**
 * The drawer's fetch URL (C9): the list URL's `?locale=` rides along only when present (the route
 * hands it to requestLocale, which ignores it outside BIS_I18N_QA); otherwise today's exact path, so
 * the e2e's route glob (`**\/contacts/<id>/summary`) still matches.
 */
export function drawerSummaryUrl(accountId: string, contactId: string, search: string): string {
  const path = `/api/accounts/${accountId}/contacts/${contactId}/summary`;
  const locale = new URLSearchParams(search).get("locale");
  return locale !== null && QA_LOCALES.has(locale) ? `${path}?locale=${locale}` : path;
}

/**
 * Q1 (owner, 2026-10-13): the fields the drawer edits. A list row is its own; a `?peek=` deep link to
 * a contact not on this page gets the blank stub (`created_at === ""`, contacts-table.tsx:41-46), whose
 * fields come from the route's contact instead. Null while a stub waits: skeletons, never blank fields.
 */
export function drawerFieldsRow<R extends DrawerFields & { created_at: string }>(row: R, load: DrawerLoad | { status: "loading" }): R | null {
  if (row.created_at !== "") return row;
  if (load.status === "ready" && load.body.who.status === "ready") return { ...row, ...load.body.who.fields };
  return null;
}
```

- [ ] **Step 5: Implement the route**, replacing `…/summary/route.ts` whole:

```ts
import { NextResponse } from "next/server";
import { getContact } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { renderZone } from "@/lib/zone";
import { contactDisplayName } from "@/lib/format";
import { loggableError } from "@/lib/loggable-error";
import { contactSourceHint } from "@/lib/contacts/lead-source";
import type { DrawerSummary } from "@/lib/contacts/drawer-summary";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import type { Locale } from "@/lib/i18n/locale";
import { makeTr } from "@/lib/record/copy";
import { factsView } from "@/lib/record/record-facts";
import { nextUpView } from "@/lib/record/next-up";
import { timelineRows, timelineFailedText } from "@/lib/record/timeline-rows";
import { TIMELINE_ANCHOR } from "@/lib/record/timeline-pager";
import { recentRowsView } from "@/lib/record/recent-rows";
import { headerActions, headerActionLabels, canTextFrom, firstMapUrl } from "@/lib/record/header-actions";
import { loadSummary, loadNextUp, loadRecent, loadTags, loadHeaderPlaces, softSmsGate } from "@/lib/record/loaders";
import { ledgerDb } from "@/lib/consent/ledger-db";
import { smsRecipientState } from "@/lib/consent/recipient-state";
import { composerStateLine, type SmsRecipientState } from "@/lib/consent/composer-state";

export const dynamic = "force-dynamic";

/**
 * The contact list's drawer (S-03 part 3 §7): the record's quick look, built from the record page's
 * own loaders and view builders so the two never say different things. Authorisation first: the
 * contact read on the request client is a 404 before anything else starts, and the ledger client is
 * built only after it proved the contact (F-085 §7.3). Every string is in ONE locale, resolved here
 * (C1). Each section is its own status (C2): a failed read or a malformed row costs its section.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ accountId: string; contactId: string }> },
) {
  const { accountId, contactId } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access) return NextResponse.json({}, { status: 404 });
  const db = await dbForRequest(); // RLS-scoped — NEVER serviceDb here
  const contact = await getContact(db, accountId, contactId);
  if (!contact) return NextResponse.json({}, { status: 404 });

  // The QA override the drawer forwards from the list URL (C9); ignored outside BIS_I18N_QA.
  const localeParam = new URL(req.url).searchParams.get("locale") ?? undefined;
  const now = new Date();
  // The send gate's ledger fact, on the ledger client, built only now (after the proof). A missing
  // service key is "unknown", which closes Text, never a 500.
  const smsRead = async (): Promise<SmsRecipientState> => {
    try {
      return await smsRecipientState(ledgerDb(), accountId, contact);
    } catch (e) {
      console.error(`contact drawer: text consent unreadable for account ${accountId}: ${loggableError(e)}`);
      return { kind: "unknown" };
    }
  };
  const [prefs, account, summary, nextUp, recent, tags, places, smsGate, smsRecipient] = await Promise.all([
    getPersonPrefs(),
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle(),
    loadSummary(db, accountId, contactId),
    loadNextUp(db, accountId, contactId, now),
    loadRecent(db, accountId, contactId),
    loadTags(db, accountId, contactId),
    loadHeaderPlaces(db, accountId, contactId),
    softSmsGate(db, accountId),
    smsRead(),
  ]);
  if (account.error) {
    console.error(`contact drawer: account ${accountId} timezone and language read failed: ${account.error.message}`);
  }
  const accountRow = account.data as { timezone: string; language?: Locale | null } | null;
  const zone = await renderZone(accountRow?.timezone);
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: accountRow?.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, { locale: localeParam });
  const tr = makeTr(locale, requestPseudoMode({ locale: localeParam }));

  /** The page's `viewOf` ([contactId]/page.tsx:149-156): a throw while building a view costs its section. */
  const viewOf = <T,>(section: string, build: () => T): T | null => {
    try {
      return build();
    } catch (e) {
      console.error(`contact drawer: ${section} view failed for account ${accountId}: ${loggableError(e)}`);
      return null;
    }
  };

  const recordHref = `/dashboard/accounts/${accountId}/contacts/${contactId}`;
  const name = contactDisplayName(contact);
  const mainGroup = places?.groups.find((g) => g.isPrimary) ?? places?.groups[0] ?? null;
  const smsBlockedLine = composerStateLine(smsRecipient, zone.zone, locale);
  const header: DrawerSummary["header"] = {
    name,
    subtitle: mainGroup
      ? tr.text(mainGroup.kind === "household" ? "record.group.household" : "record.group.business", { group: mainGroup.name })
      : null,
    subtitleHref: mainGroup ? `/dashboard/accounts/${accountId}/groups/${mainGroup.id}` : null,
    // Text and Email open the record page's composer on that channel (D8, verified §8.2).
    actions: headerActionLabels(headerActions({
      phone: contact.phone ?? null,
      email: contact.email ?? null,
      canText: canTextFrom({ phone: contact.phone ?? null, smsGate, smsBlockedLine }),
      directionsUrl: places ? firstMapUrl(places.places, contactId, places.groups) : null,
      composeHref: recordHref,
    }), tr, name),
  };

  const facts = summary.status === "ready"
    ? viewOf("summary", () => factsView({ createdAt: contact.created_at, facts: summary.facts }, { zone: zone.zone, now, tr }))
    : null;
  const upNext = nextUp.status === "ready" ? viewOf("next up", () => nextUpView(nextUp.data, { zone: zone.zone, now, tr })) : null;
  const rows = recent.status === "ready"
    ? viewOf("recent", () => recentRowsView(timelineRows(recent.page.items, {
      zone: zone.zone, tr, author: { viewerId: access.userId, names: recent.names, personaName: recent.personaName, tr },
    })))
    : null;

  const body: DrawerSummary = {
    locale,
    header,
    facts: facts ? { status: "ready", view: facts } : { status: "error", text: tr.text("record.summary.failed") },
    nextUp: upNext
      ? { status: "ready", view: upNext, emptyText: tr.text("record.nextUp.empty") }
      : { status: "error", text: tr.text("record.nextUp.failed") },
    recent: recent.status === "ready" && rows
      ? {
        status: "ready", rows,
        failedText: timelineFailedText(recent.page.failed, tr),
        // Rule 5's empty state only when nothing failed: a failed source is not "nothing" (the page's rule).
        emptyText: rows.length === 0 && recent.page.failed.length === 0 ? tr.text("timeline.empty") : null,
        seeAllHref: `${recordHref}#${TIMELINE_ANCHOR}`,
      }
      : { status: "error", text: tr.text("record.activity.failed") },
    who: {
      source: contact.source ?? null,
      sourceHint: contactSourceHint({ source: contact.source ?? null, custom: contact.custom, attribution: contact.attribution }, locale),
      assignedTo: contact.assigned_to ?? null,
      fields: {
        first_name: contact.first_name ?? null, last_name: contact.last_name ?? null, email: contact.email ?? null,
        phone: contact.phone ?? null, company_name: contact.company_name ?? null,
      },
      tags: tags.status === "ready" ? { status: "ready", tags: tags.tags.map((t) => ({ id: t.id, name: t.name })) } : { status: "error" },
    },
  };
  return NextResponse.json(body);
}
```

(Check `composer-state.ts` for `SmsRecipientState`'s export and its `"unknown"` member before using it: `recipient-state.ts:6` imports that type from there and returns `{ kind: "unknown" }` at `:33`.)

`lib/contacts/summary.ts`: replace `:1` with the old body type, moved here so the old drawer still compiles until Task 6 deletes this file:

```ts
import type { ZoneLabel } from "@/lib/zone";

/** The OLD summary body (before S-03 part 3), kept only until Task 6 deletes this file with the old drawer. */
export type ContactSummary = {
  tags: { id: string; name: string }[];
  recent: { kind: "call" | "note" | "submission" | "message" | "opportunity"; label: string; at: string }[];
  phone_country_unconfirmed: boolean;
  phone: string | null;
  zone: ZoneLabel;
  source: string | null;
  sourceHint: string | null;
  assignedTo: string | null;
};
```

(and delete the now-duplicate `import type { ZoneLabel } from "@/lib/zone";` at `:2`). In `summary.test.ts:2` change the import to `import type { ContactSummary } from "./summary";`.

`in-account-service-reads.test.ts`: after `:106` add

```ts
  // The list drawer's summary (S-03 part 3): ledgerDb for the Text gate, only after getContact on the request client.
  "app/api/accounts/[accountId]/contacts/[contactId]/summary/route.ts": "proven-target",
```

- [ ] **Step 6: Run them; they pass.** Step 3's command, then: `pnpm --filter web exec vitest run src/lib/contacts/summary.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts" src/lib/i18n/request-locale-callers.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.wiring.test.ts"` (the old drawer's wiring test still passes: it drives the old parser over its own fixture). The allowlist probe: delete the new line → `no unlisted importer` FAILS naming the route; restore. Each other named probe once, by name. `pnpm --filter web typecheck`; eslint on the route, the parser and `summary.ts`.

- [ ] **Step 7: Commit.**

```bash
git add -- apps/web/src/lib/contacts/drawer-summary.ts apps/web/src/lib/contacts/drawer-summary.test.ts
git commit -m "feat(contacts): the drawer's summary is the record's quick look, each section on its own and in the reader's language, read after the contact is proven (S-03 part 3)" -- apps/web/src/lib/contacts/drawer-summary.ts apps/web/src/lib/contacts/drawer-summary.test.ts "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.ts" "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.test.ts" apps/web/src/lib/contacts/summary.ts apps/web/src/lib/contacts/summary.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"
```

---

## Task 6: The drawer on the kit (bis-crm)

**Review:** opus. **Starts after** Tasks 1, 3, 4 and 5 have committed. **messages.ts #2** (after Task 3's commit). The ONLY task that edits `contact-drawer.tsx` and its wiring test.

**Files**
- Rewrite: `…/contacts/contact-drawer.tsx` (all 466 lines)
- Modify: `…/contacts/contact-drawer.wiring.test.ts` (`:43-110` harness and fixtures, `:111-145` replaced, `:398-454` regexes, `:456-566` replaced; `:147-396` kept)
- Modify: `…/contacts/[contactId]/summary-card.tsx:5-17` (`onRetry`)
- Delete: `apps/web/src/lib/contacts/summary.ts`, `apps/web/src/lib/contacts/summary.test.ts`
- Modify: `apps/web/src/lib/messages.ts:836-855` (the `drawer.*` block)

**Interfaces**
- Consumes: Task 1's `RecordHeader` (`headingLevel`, `wrapHeading`, `trailing`, no `back`), `RecordSection`, `SheetContent closeLabel`; Task 5's `drawerLoadFrom`, `drawerSummaryUrl`, `drawerFieldsRow`, `DrawerLoad`, `ParsedDrawerSummary`, `RecentRowView` (Task 2); Task 3's `TextsRow`, `EmailRow`, `SourceField`, `BusinessInlineField` (props unchanged, words from `useLocale()`); `SummaryBody` (`[contactId]/summary-card.tsx`), `NextUpBody(view, emptyText, addTodoLabel)` (`next-up-card.tsx:15`); `TimelineItem`, `TimelineItemSkeleton` (`components/record/timeline-item.tsx:36-95`); `RecordCardRetry`, `RecordCardSkeleton` (`record-card.tsx:18-36`).
- Produces: `ContactDrawer` with today's props (`contacts-table.tsx:300-307` unchanged); `FIELDS` unchanged in shape (`contact-fields-panel.tsx:23` imports it); `SummaryBody({ view, retryLabel, onRetry? })`.

- [ ] **Step 1: Rewrite the wiring test's fixtures and failing cases.** In `contact-drawer.wiring.test.ts`:

Replace the mocks at `:43-59` with:

```ts
vi.mock("@/components/ui/sheet", () => {
  const pass = ({ children }: { children?: unknown }) => (harness.openSheet ? children : null);
  const none = () => null;
  // SheetTitle passes its child through: the header's h2 is wrapped by it (wrapHeading), and must render.
  return { Sheet: pass, SheetContent: pass, SheetDescription: none, SheetHeader: pass, SheetTitle: pass };
});
// RecordSection's boundary and the facts' Try again read the router; there is no app router here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// Recorded, not run: the body's locale is what the drawer hands its provider (C1).
const localeProps: unknown[] = [];
vi.mock("@/components/locale-provider", () => ({
  useLocale: () => "en",
  LocaleProvider: (p: { locale: unknown; children?: unknown }) => { localeProps.push(p.locale); return p.children; },
}));
const nextUpProps: unknown[] = [];
vi.mock("./[contactId]/next-up-card", () => ({ NextUpBody: (p: unknown) => { nextUpProps.push(p); return null; } }));
vi.mock("./actions", () => ({ updateContactFieldAction: vi.fn(), undoInlinePhoneEditAction: vi.fn(), setContactBusinessAction: vi.fn(), undoContactBusinessAction: vi.fn() }));
vi.mock("./email-actions", () => ({ stopEmailsAction: vi.fn(), undoStopEmailsAction: vi.fn(), resumeEmailsAction: vi.fn() }));
vi.mock("./[contactId]/actions", () => ({ addTagAction: vi.fn(), removeTagAction: vi.fn() }));
```

(The `relationships-card`, `groups-card` and `places-card` mocks go: the drawer no longer imports them, and the case below proves it from the source.)

Replace `GOOD` and `omit` (`:68-82`) with:

```ts
const GOOD = {
  locale: "en",
  header: { name: "Maria Garcia", subtitle: null, subtitleHref: null, actions: [
    { id: "call", label: "Call", href: "tel:+15512345678", ariaLabel: "Call Maria Garcia", primary: true, external: false },
  ] },
  facts: { status: "error", text: "Couldn't load the summary." },
  nextUp: { status: "ready", view: { rows: [], undated: null }, emptyText: "Nothing coming up." },
  recent: { status: "ready", rows: [
    { key: "note-n1", kind: "note", mark: { kind: "person", label: "You" }, verb: "added a note", status: null, detail: null,
      time: "Sep 1, 2026, 5:00 AM", dateTime: "2026-09-01T10:00:00+00:00", excerpt: { text: "Prefers mornings", lang: "", done: false } },
    { key: "booking-b1", kind: "booking", mark: { kind: "customer", label: "Customer" }, verb: "booked an appointment for Fri, Oct 16, 10:00 AM",
      status: { tone: "accent", word: "Booked" }, detail: null, time: "Aug 30, 2026, 5:00 AM", dateTime: "2026-08-30T10:00:00+00:00", excerpt: null },
  ], failedText: null, emptyText: null, seeAllHref: "/dashboard/accounts/a1/contacts/c1#record-timeline" },
  who: { source: null, sourceHint: null, assignedTo: null,
    fields: { first_name: "Maria", last_name: "Garcia", email: null, phone: null, company_name: null },
    tags: { status: "ready", tags: [{ id: "t1", name: "vip" }] } },
};
const PARSED = { ...GOOD, who: { status: "ready", ...GOOD.who } };

function omit(key: keyof typeof GOOD): Record<string, unknown> {
  const body: Record<string, unknown> = JSON.parse(JSON.stringify(GOOD));
  delete body[key];
  return body;
}
```

In `load()` (`:86-104`) and `mountPendingBody()` (`:151-166`) nothing else changes (the `fetched` state still starts at null; three effects). Replace the describe at `:111-138` with:

```ts
describe("ContactDrawer: the summary body is parsed, one section at a time (S-03 part 3 §7.4)", () => {
  it("a body without a header stores the whole drawer's error (mutation: cast the body -> FAILS)", async () => {
    expect(await load(omit("header"))).toEqual({ contactId: "c1", result: { status: "error" } });
  });
  it("a good body stores the PARSED body, extra keys dropped", async () => {
    expect(await load({ ...JSON.parse(JSON.stringify(GOOD)), zone: "UTC" })).toEqual({ contactId: "c1", result: { status: "ready", body: PARSED } });
  });
  it("a non-OK response stores the error state, even with a body that would parse", async () => {
    expect(await load(GOOD, false)).toEqual({ contactId: "c1", result: { status: "error" } });
  });
  it("a malformed Recent is Recent's error only; the rest still load (mutation: refuse the body -> FAILS)", async () => {
    const body = { ...JSON.parse(JSON.stringify(GOOD)), recent: { status: "ready", rows: 3 } };
    const stored = await load(body) as { result: { status: string; body: { recent: { status: string }; nextUp: { status: string } } } };
    expect(stored.result.status).toBe("ready");
    expect([stored.result.body.recent.status, stored.result.body.nextUp.status]).toEqual(["error", "ready"]);
  });
});

describe("ContactDrawer: the fetch URL (C9)", () => {
  async function fetchedUrl(search: string | null): Promise<string> {
    effects.length = 0;
    states.length = 0;
    if (search !== null) vi.stubGlobal("window", { location: { search } });
    const f = vi.fn(async () => ({ ok: true, json: async () => GOOD }));
    vi.stubGlobal("fetch", f);
    renderToStaticMarkup(createElement(ContactDrawer, { accountId: "a1", row: ROW, onClose: () => {} }));
    effects[0]!();
    return f.mock.calls[0]![0] as unknown as string;
  }
  it("today's exact path with no ?locale= on the list (mutation: always append -> e2e's route glob stops matching, FAILS)", async () => {
    expect(await fetchedUrl(null)).toBe("/api/accounts/a1/contacts/c1/summary");
    expect(await fetchedUrl("?q=Retry&peek=c1")).toBe("/api/accounts/a1/contacts/c1/summary");
  });
  it("the list's QA locale rides along (mutation: drop it -> the pseudo overflow check measures English, FAILS)", async () => {
    expect(await fetchedUrl("?peek=c1&locale=pseudo")).toBe("/api/accounts/a1/contacts/c1/summary?locale=pseudo");
  });
});
```

Keep `:147-396` (the stale-closure, Texts, Email, phone Undo and pick blocks) as they are; in the stale-closure block's `control` case (`:178`) `settle.resolve(GOOD)` still applies. Replace the Source-line regexes at `:404-414` with:

```ts
  it("the drawer passes the route's own source/sourceHint, never a literal null (mutation: source={null} sourceHint={null} → FAILS)", () => {
    expect(drawer).toMatch(/<SourceField[\s\S]{0,250}?source=\{who\.source\}[\s\S]{0,150}?sourceHint=\{who\.sourceHint\}/);
  });
```

(keep the panel case at `:408-410` and the key case at `:412-414`). Replace the two drawer regexes at `:432-438` with:

```ts
  it("renders ContactAssigneeField for THIS contact with the route's holder, the team as options, and readOnly = !canAssign (mutation: readOnly={false} -> FAILS)", () => {
    expect(drawer).toMatch(/<ContactAssigneeField[\s\S]{0,300}?contactId=\{row\.id\}[\s\S]{0,200}?value=\{who\.assignedTo\}[\s\S]{0,200}?options=\{members\}[\s\S]{0,200}?readOnly=\{!canAssign\}/);
  });

  it("sits in the 92px label column, labelled 'Assigned to', and only when the server said who holds the customer (mutation: render it for an undefined holder -> FAILS)", () => {
    expect(drawer).toMatch(/who\.assignedTo !== undefined \? \(\s*<div className="grid grid-cols-\[92px_minmax\(0,1fr\)\][^"]*"[^>]*>\s*<dt[^>]*>\{t\(m, "assign\.field\.label", locale\)\}<\/dt>/);
  });
```

Replace the `react` mock at `:30-42` so that ONLY the first `useState(null)` of a render (the drawer's own `fetched`, its first hook) answers the harness's value; a child rendered under an open Sheet (an `InlineField`) may start a state at null too, and must not receive the drawer's body:

```ts
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (fn: () => void | (() => void)) => { effects.push(fn); },
    useState: (init: unknown) => {
      const initial = typeof init === "function" ? (init as () => unknown)() : init;
      const set = vi.fn();
      const firstNull = initial === null && !states.some((s) => s.initial === null);
      states.push({ initial, set });
      return [firstNull && harness.readyFetched !== undefined ? harness.readyFetched : initial, set];
    },
  };
});
```

Replace everything from `:456` to the end of the file with:

```ts
/** Renders the drawer with the Sheet open and `fetched` as its load (undefined: still loading). */
function renderOpen(fetched: unknown, row: ContactRow = ROW): string {
  effects.length = 0;
  states.length = 0;
  harness.readyFetched = fetched;
  harness.openSheet = true;
  return renderToStaticMarkup(createElement(ContactDrawer, { accountId: "a1", row, onClose: () => {} }));
}
/** The element tree the drawer returns when CALLED (not rendered), so its props can be read. */
function treeOf(fetched: unknown) {
  effects.length = 0;
  states.length = 0;
  harness.readyFetched = fetched;
  harness.openSheet = true;
  const found: { type: unknown; props: Record<string, unknown> }[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!isValidElement(n)) return;
    const el = n as unknown as { type: unknown; props: Record<string, unknown> };
    found.push(el);
    walk(el.props.children);
  };
  walk(ContactDrawer({ accountId: "a1", row: ROW, onClose: () => {} }));
  return found;
}
const READY = { contactId: "c1", result: { status: "ready", body: PARSED } };
const drawerSrc = () => readFileSync(fileURLToPath(new URL("./contact-drawer.tsx", import.meta.url)), "utf8");

describe("ContactDrawer on the record kit (S-03 part 3)", () => {
  afterEach(() => { harness.readyFetched = undefined; harness.openSheet = false; nextUpProps.length = 0; });

  it("Groups, Properties and Related people have left the drawer (D7; mutation: keep one -> FAILS)", () => {
    expect(drawerSrc()).not.toMatch(/GroupsCard|PlacesCard|RelationshipsCard/);
  });

  it("the sections in the spec's order: facts, Next up, Recent, who they are, then the way to the full record (§9; mutation: move Recent below who -> FAILS)", () => {
    const src = drawerSrc();
    const order = ["facts", "next-up", "recent", "who"].map((id) => src.indexOf(`data-drawer-section="${id}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(src.indexOf('"drawer.moreOnRecord"')).toBeGreaterThan(order[3]!);
  });

  it("Next up has no Add a To-do: there is no composer in the drawer (D4; mutation: pass the label -> FAILS)", () => {
    renderOpen(READY);
    expect(nextUpProps).toHaveLength(1);
    expect((nextUpProps[0] as { addTodoLabel: unknown }).addTodoLabel).toBeNull();
  });

  it("a section's Try again re-reads without blanking the drawer (C3; mutation: setFetched(null) first -> FAILS)", async () => {
    const { RecordSection } = await import("@/components/record/record-section");
    const facts = treeOf(READY).find((e) => e.type === RecordSection && e.props.id === "facts");
    expect(facts?.props.state).toBe("error");
    const nonce = states.filter((s) => s.initial === 0);
    const fetched = states.filter((s) => s.initial === null);
    expect([nonce.length, fetched.length]).toEqual([1, 1]);
    (facts!.props.onRetry as () => void)();
    expect(nonce[0]!.set).toHaveBeenCalledTimes(1);
    expect(fetched[0]!.set).not.toHaveBeenCalled();
  });

  it("the body is wrapped in a provider of the BODY's locale, not the page's (C1; mutation: wrap with useLocale() -> FAILS)", async () => {
    const { LocaleProvider } = await import("@/components/locale-provider");
    const tree = treeOf({ contactId: "c1", result: { status: "ready", body: { ...PARSED, locale: "es" } } });
    expect(tree.find((e) => e.type === LocaleProvider)?.props.locale).toBe("es");
    expect(tree.find((e) => e.props.lang === "es")).toBeDefined();
  });

  it("each recent row is a marked TimelineItem with the e2e's hook, and See all opens the record's timeline (C10, D5; mutation: drop the testid -> FAILS)", () => {
    const html = renderOpen(READY);
    expect(html.match(/data-testid="drawer-recent-item"/g)).toHaveLength(2);
    expect(html).toMatch(/data-testid="drawer-recent-item"[\s\S]*?data-author-mark="customer"/);
    expect(html).toContain('href="/dashboard/accounts/a1/contacts/c1#record-timeline"');
    expect(html).toMatch(/<p lang=""[^>]*>Prefers mornings<\/p>/);
  });

  it("the header is the route's: Call the only primary, the name an h2 (D2; mutation: render the list row's name -> FAILS)", () => {
    const html = renderOpen({ contactId: "c1", result: { status: "ready", body: { ...PARSED, header: { ...PARSED.header, name: "Maria G. Garcia" } } } });
    expect(html).toMatch(/<h2[^>]*>Maria G\. Garcia<\/h2>/);
    const header = html.slice(html.indexOf("data-record-header"), html.indexOf("data-drawer-section"));
    expect(header.match(/data-variant="default"/g)).toHaveLength(1);
    expect(header).toMatch(/data-variant="default"[^>]*data-record-action="call"|data-record-action="call"[^>]*data-variant="default"/);
  });

  it("while loading, every section is a skeleton carrying the e2e's hook (rule 7, C10; mutation: drop the hook from a section -> FAILS)", () => {
    const html = renderOpen(undefined);
    expect((html.match(/data-testid="drawer-skeleton"/g) ?? []).length).toBe(5);
    expect(html).toMatch(/data-drawer-section="recent" data-state="loading"/);
  });

  it("a ?peek= stub row shows skeleton fields until the route's arrive (Q1; mutation: render the stub's blanks -> FAILS)", () => {
    const stub = { ...ROW, first_name: null, last_name: null, created_at: "" };
    expect(renderOpen(undefined, stub)).toContain("data-drawer-fields-skeleton");
    const ready = renderOpen(READY, stub);
    expect(ready).not.toContain("data-drawer-fields-skeleton");
    expect(ready).toMatch(/First name: Maria/);
  });
});
```

(Count read off the drawer below: while loading, the header's action line, facts, Next up, Recent and the who section's Source rows carry `drawer-skeleton`, five; a real list row's fields do not wait. If `InlineField`'s accessible name is not "`<label>: <value>`", read it off `inline-field.tsx:226` and match that.)

(Add `isValidElement` to the `react` import at `:2` — the `react` mock spreads the real module, so it is the real one.)

- [ ] **Step 2: Run it; it fails.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.wiring.test.ts"` → FAIL: the parsed-body cases (`expected { …result: { status: 'error' } } to deeply equal { …status: 'ready', body: … }`: the old parser refuses the new body), the URL case for `?locale=pseudo`, the D7 source pin (`expected … not to match /GroupsCard|PlacesCard|RelationshipsCard/`), the Source and Assigned to pins.

- [ ] **Step 3: `summary-card.tsx`** gains the retry the drawer needs (C4; today its Try again would `router.refresh()` the list behind the drawer):

```tsx
import { RecordCardRetry } from "@/components/record/record-card";
import type { FactsView } from "@/lib/record/record-facts";

/** The summary card's body (spec §9.2): the checked facts first. No generated prose in part 1 (D1).
 *  `onRetry`: the list's drawer re-reads its own route (S-03 part 3 §9.1); absent, the page refreshes. */
export function SummaryBody({ view, retryLabel, onRetry }: { view: FactsView; retryLabel: string; onRetry?: () => void }) {
  return (
    <div className="space-y-2">
      <p data-record-facts className="text-sm text-card-foreground tabular-nums [overflow-wrap:anywhere]">{view.line.join(" · ")}</p>
      {view.missing ? (
        <div data-record-facts-missing className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{view.missing}</span>
          <RecordCardRetry label={retryLabel} onRetry={onRetry} />
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `contact-drawer.tsx`:**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarCheck, CheckSquare, DollarSign, ExternalLink, FileText, MessageSquare, Phone, Plus, Square, StickyNote, X,
} from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { InlineField } from "@/components/inline-field";
import { LocaleProvider, useLocale } from "@/components/locale-provider";
import { RecordHeader } from "@/components/record/record-header";
import { RecordSection } from "@/components/record/record-section";
import { RecordCardRetry, RecordCardSkeleton } from "@/components/record/record-card";
import { TimelineItem, TimelineItemSkeleton } from "@/components/record/timeline-item";
import { ContactAssigneeField } from "@/components/assign/assignee-field";
import { contactDisplayName } from "@/lib/format";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import type { AssignMember } from "@/lib/assign/view";
import { emailLoadFrom, type EmailLoad } from "@/lib/consent/email-row";
import { textsLoadFrom, type TextsLoad } from "@/lib/consent/texts-row";
import type { EditableField } from "@/lib/contacts/field-input";
import type { PhoneInlineUndo } from "@/lib/contacts/inline-phone-undo";
import { drawerFieldsRow, drawerLoadFrom, drawerSummaryUrl, type DrawerLoad, type ParsedDrawerSummary } from "@/lib/contacts/drawer-summary";
import type { RecentRowView } from "@/lib/record/recent-rows";
import { updateContactFieldAction, undoInlinePhoneEditAction } from "./actions";
import { addTagAction, removeTagAction } from "./[contactId]/actions";
import { SummaryBody } from "./[contactId]/summary-card";
import { NextUpBody } from "./[contactId]/next-up-card";
import { EmailRow } from "./email-row";
import { TextsRow } from "./texts-row";
import { SourceField } from "./source-field";
import { BusinessInlineField } from "./business-field";
import type { ContactRow } from "./contacts-table";

// The body is PARSED (lib/contacts/drawer-summary.ts): checked, not cast, so a server older or newer
// than this tab's bundle gets an error state, not a throw during render, which the dashboard's one
// error boundary would answer by replacing the page. Paired with the id it was fetched for, the
// shape shell-data.tsx uses: "loading" for a newly-peeked contact falls out of the mismatch check in
// `load` below instead of a synchronous setState in the effect (react-hooks/set-state-in-effect).
type Fetched = { contactId: string; result: DrawerLoad } | null;

// Exported so contact-fields-panel.tsx (the full contact page) shares this vocabulary instead of
// duplicating it — one list of standard fields, two InlineField call sites (drawer + full page).
// `field` excludes "source" (its own SourceField, fed by the route) and the Business name (its own
// BusinessInlineField: it writes the contact's business GROUP, S-02 §6 row 3).
export const FIELDS: { field: Exclude<EditableField, "source" | "company_name">; labelKey: MessageKey; type: "text" | "email" | "tel" }[] = [
  { field: "first_name", labelKey: "contacts.firstName", type: "text" },
  { field: "last_name", labelKey: "contacts.lastName", type: "text" },
  { field: "email", labelKey: "contacts.email", type: "email" },
  { field: "phone", labelKey: "contacts.phone", type: "tel" },
];

const ROW_ICON: Record<RecentRowView["kind"], typeof StickyNote> = {
  note: StickyNote, task: Square, deal: DollarSign, submission: FileText, message: MessageSquare, booking: CalendarCheck, call: Phone,
};
const GHOST_LINK = cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 md:min-h-8");
const LABEL_ROW = "grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2";
type SectionState = "loading" | "ready" | "error";

/**
 * The contact list's drawer (S-03 part 3): the record's quick look on the record kit. Top to bottom:
 * the record's header (Call the one primary; Text and Email open the record page's composer), the
 * checked facts, Next up, the five newest timeline rows, who they are, and the way to the full
 * record. Each section loads and fails on its own (C2); a section's Try again re-reads the route
 * without blanking the others (C3). Every read-only word comes from the route in ONE locale (C1).
 */
export function ContactDrawer({
  accountId, row, onClose, canAssign = false, members = [], viewerId = null,
}: {
  accountId: string;
  row: ContactRow | null;
  onClose: () => void;
  /** F-085 part 1: may this caller hand the customer to someone (Owner, Staff, the agency); read-only otherwise (a Technician, M4). */
  canAssign?: boolean;
  /** The people the "Assigned to" picker offers (lib/assign/view.ts). */
  members?: AssignMember[];
  /** The viewer's own person here: "You" on a read-only line only for their own customer. */
  viewerId?: string | null;
}) {
  const [fetched, setFetched] = useState<Fetched>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const pageLocale = useLocale();
  const contactId = row?.id ?? null;

  useEffect(() => {
    if (!contactId) return;
    let stale = false;
    // C9: the list URL's QA ?locale= rides along only when present; otherwise today's exact path.
    fetch(drawerSummaryUrl(accountId, contactId, typeof window === "undefined" ? "" : window.location.search))
      .then(async (res) => {
        if (stale) return;
        const result = await drawerLoadFrom(res);
        // Checked again AFTER the body is read: the cleanup can land while `res.json()` is pending,
        // and without this a switched-away contact's result (or an older retry's) would overwrite.
        if (!stale) setFetched({ contactId, result });
      })
      .catch(() => { if (!stale) setFetched({ contactId, result: { status: "error" } }); });
    return () => { stale = true; };
  }, [accountId, contactId, retryNonce]);

  const load: DrawerLoad | { status: "loading" } =
    contactId && fetched?.contactId === contactId ? fetched.result : { status: "loading" };

  // The Texts row's own read (consent chain PR-2): re-read whenever the summary is (a phone save, a
  // pick, a row action, an Undo all bump retryNonce), with the same stale-closure guard. Never
  // initialised to `null`: the wiring test finds `fetched` above by that starting value.
  const [texts, setTexts] = useState<{ contactId: string; load: TextsLoad }>({ contactId: "", load: { status: "loading" } });
  useEffect(() => {
    if (!contactId) return;
    let stale = false;
    fetch(`/api/accounts/${accountId}/contacts/${contactId}/texts`)
      .then(async (res) => {
        if (stale) return;
        const next = await textsLoadFrom(res);
        if (!stale) setTexts({ contactId, load: next });
      })
      .catch(() => { if (!stale) setTexts({ contactId, load: { status: "error" } }); });
    return () => { stale = true; };
  }, [accountId, contactId, retryNonce]);
  const textsLoad: TextsLoad = contactId && texts.contactId === contactId ? texts.load : { status: "loading" };

  // The Email row's own read (consent PR-3), the Texts row's pattern; its starting value's SHAPE
  // differs (an `email` key), so the wiring test can tell the two apart.
  const [emailRead, setEmailRead] = useState<{ contactId: string; email: EmailLoad }>({ contactId: "", email: { status: "loading" } });
  useEffect(() => {
    if (!contactId) return;
    let stale = false;
    fetch(`/api/accounts/${accountId}/contacts/${contactId}/email`)
      .then(async (res) => {
        if (stale) return;
        const next = await emailLoadFrom(res);
        if (!stale) setEmailRead({ contactId, email: next });
      })
      .catch(() => { if (!stale) setEmailRead({ contactId, email: { status: "error" } }); });
    return () => { stale = true; };
  }, [accountId, contactId, retryNonce]);
  const emailLoad: EmailLoad = contactId && emailRead.contactId === contactId ? emailRead.email : { status: "loading" };

  const body: ParsedDrawerSummary | null = load.status === "ready" ? load.body : null;
  const locale: Locale = body?.locale ?? pageLocale;
  const tx = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  const fullHref = contactId ? `/dashboard/accounts/${accountId}/contacts/${contactId}` : "#";
  // C3: a section's Try again keeps the body on screen and re-reads the route.
  const retrySection = () => setRetryNonce((n) => n + 1);
  const stateOf = (s: { status: string } | undefined): SectionState =>
    load.status === "loading" ? "loading" : s && s.status === "ready" ? "ready" : "error";
  const who = body && body.who.status === "ready" ? body.who : null;
  const fieldsRow = row ? drawerFieldsRow(row, load) : null;

  return (
    <Sheet open={row !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md"
        closeLabel={tx("drawer.close")}
        // Radix's own Escape listener sits on `document` with `{capture: true}` and runs BEFORE any
        // bubble-phase `onKeyDown` on a field inside this sheet — including InlineField's own Escape
        // handler, which only means to cancel the field being edited. preventDefault here stops
        // Radix's dismiss for THIS keypress only; the focused field's own onKeyDown still runs right
        // after, so the edit cancels normally. Esc with no input focused still closes the drawer.
        onEscapeKeyDown={(e) => {
          const el = document.activeElement;
          if (el instanceof HTMLInputElement && e.currentTarget instanceof Node && e.currentTarget.contains(el)) {
            e.preventDefault();
          }
        }}
      >
        {row === null ? null : (
          <LocaleProvider locale={locale}>
            <div lang={locale} className="flex min-h-0 flex-1 flex-col">
              <SheetHeader>
                <RecordHeader
                  name={body?.header.name ?? contactDisplayName(row)}
                  subtitle={body?.header.subtitle ?? null}
                  subtitleHref={body?.header.subtitleHref ?? undefined}
                  actions={body?.header.actions ?? []}
                  headingLevel={2}
                  // The dialog is named by the customer's name (Radix needs a Dialog.Title).
                  wrapHeading={(h) => <SheetTitle asChild>{h}</SheetTitle>}
                  trailing={
                    <Link href={fullHref} aria-label={tx("drawer.openFull")}
                      // mr-8 clears the Sheet's absolutely placed close button (sheet.tsx:84).
                      className="mr-8 inline-flex min-h-11 items-center rounded-[var(--radius-ctl)] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8">
                      <ExternalLink className="size-4" aria-hidden />
                    </Link>
                  }
                />
                {load.status === "loading" ? <Skeleton data-testid="drawer-skeleton" className="h-11 w-2/3 rounded-[var(--radius-ctl)]" /> : null}
                <SheetDescription className="sr-only">{tx("drawer.description")}</SheetDescription>
              </SheetHeader>

              <div data-testid="drawer-scroll" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6">
                {load.status === "error" ? (
                  <Notice tone="crit" className="p-3">
                    <p className="text-muted-foreground">{tx("drawer.loadFailed")}</p>
                    <div className="mt-2 flex gap-3">
                      <Button size="sm" variant="ghost" onClick={() => {
                        // The whole drawer's error only: drop the paired fetch so `load` falls back to
                        // "loading", then refire the guarded effect (same `stale` guard as a normal load).
                        setFetched(null);
                        setRetryNonce((n) => n + 1);
                      }}>
                        {tx("common.retry")}
                      </Button>
                      <Link href={fullHref} className="text-sm underline">{tx("drawer.openFull")}</Link>
                    </div>
                  </Notice>
                ) : null}

                {/* The read-only sections exist only once the route answered or while it loads; the
                    whole drawer's error above stands in for all three (C2), the fields below stay. */}
                {load.status === "error" ? null : (<>
                <div data-drawer-section="facts" data-state={stateOf(body?.facts)}>
                  <RecordSection id="facts" label={null} state={stateOf(body?.facts)}
                    errorText={body?.facts.status === "error" ? body.facts.text : tx("record.summary.failed")}
                    retryLabel={tx("record.card.retry")} onRetry={retrySection}
                    skeleton={<div data-testid="drawer-skeleton"><RecordCardSkeleton rows={1} /></div>}>
                    {body?.facts.status === "ready"
                      ? <SummaryBody view={body.facts.view} retryLabel={tx("record.card.retry")} onRetry={retrySection} />
                      : null}
                  </RecordSection>
                </div>

                <div data-drawer-section="next-up" data-state={stateOf(body?.nextUp)}>
                  <RecordSection id="next-up" label={tx("record.card.nextUp")} state={stateOf(body?.nextUp)}
                    errorText={body?.nextUp.status === "error" ? body.nextUp.text : tx("record.nextUp.failed")}
                    retryLabel={tx("record.card.retry")} onRetry={retrySection}
                    skeleton={<div data-testid="drawer-skeleton"><RecordCardSkeleton rows={3} /></div>}>
                    {/* D4: no "Add a To-do": the composer that holds it is on the record, one link away (Q2). */}
                    {body?.nextUp.status === "ready"
                      ? <NextUpBody view={body.nextUp.view} emptyText={body.nextUp.emptyText} addTodoLabel={null} />
                      : null}
                  </RecordSection>
                </div>

                <div data-drawer-section="recent" data-state={stateOf(body?.recent)}>
                  <RecordSection id="recent" label={tx("drawer.recent")} state={stateOf(body?.recent)}
                    errorText={body?.recent.status === "error" ? body.recent.text : tx("record.activity.failed")}
                    retryLabel={tx("record.card.retry")} onRetry={retrySection}
                    skeleton={<div data-testid="drawer-skeleton"><TimelineItemSkeleton rows={5} /></div>}>
                    {body?.recent.status === "ready" ? (
                      <div className="space-y-2">
                        {body.recent.failedText ? (
                          // Some sources failed: the rows that loaded stay, and this says what could not.
                          <div role="alert" data-timeline-failed className="flex flex-wrap items-center gap-2 text-sm">
                            <p className="text-muted-foreground">{body.recent.failedText}</p>
                            <RecordCardRetry label={tx("record.card.retry")} onRetry={retrySection} />
                          </div>
                        ) : null}
                        {body.recent.emptyText ? <p className="text-sm text-muted-foreground">{body.recent.emptyText}</p> : null}
                        {body.recent.rows.length > 0 ? (
                          <ol className="flex flex-col">
                            {body.recent.rows.map((r) => (
                              <li key={r.key} data-testid="drawer-recent-item" className="border-t border-[var(--row-line)] first:border-t-0">
                                <TimelineItem kind={r.kind} icon={r.kind === "task" && r.excerpt?.done ? CheckSquare : ROW_ICON[r.kind]}
                                  mark={r.mark} verb={r.verb} status={r.status} detail={r.detail} time={r.time} dateTime={r.dateTime}>
                                  {r.excerpt ? (
                                    <p lang={r.excerpt.lang} className={cn("line-clamp-2 break-words text-sm",
                                      r.excerpt.done ? "text-muted-foreground line-through" : "text-card-foreground")}>{r.excerpt.text}</p>
                                  ) : null}
                                </TimelineItem>
                              </li>
                            ))}
                          </ol>
                        ) : null}
                        <Link href={body.recent.seeAllHref} data-drawer-see-all className={GHOST_LINK}>{tx("drawer.seeAll")}</Link>
                      </div>
                    ) : null}
                  </RecordSection>
                </div>
                </>)}

                <div data-drawer-section="who" data-state={body ? (who ? "ready" : "error") : load.status === "error" ? "error" : "loading"}>
                  {/* The fields never wait on the route (D6), except a ?peek= stub's, which come from it (Q1). */}
                  <RecordSection id="who" label={tx("contact.details")} state="ready"
                    errorText={tx("record.card.failed", { title: tx("contact.details") })}
                    retryLabel={tx("record.card.retry")} onRetry={retrySection}>
                    <div className="space-y-4">
                      {fieldsRow ? (
                        <dl className="space-y-1">
                          {FIELDS.map(({ field, labelKey, type }) => (
                            // Keyed by contact id + field (+ where the values came from): a bare `field`
                            // key would reconcile instead of remount, showing contact A's values under B.
                            <div key={`${row.id}:${field}:${fieldsRow === row ? "row" : "route"}`} className={LABEL_ROW}>
                              <dt className="text-muted-foreground text-xs">{tx(labelKey)}</dt>
                              <dd>
                                <InlineField
                                  label={tx(labelKey)}
                                  field={field}
                                  inputType={type}
                                  locale={locale}
                                  value={(fieldsRow[field] as string | null) ?? null}
                                  save={async (v) => {
                                    const saved = await updateContactFieldAction(accountId, row.id, field, v);
                                    // A phone edit can make the number ambiguous, or settle it: re-read the summary so the Check number row follows (review R3-I2).
                                    if (field === "phone") setRetryNonce((n) => n + 1);
                                    return saved;
                                  }}
                                  {...(field === "phone" ? {
                                    undoPhone: async (undo: PhoneInlineUndo) => {
                                      const r = await undoInlinePhoneEditAction(accountId, row.id, undo);
                                      // Same reason as the save above: the undo can move the flag too, so the row must re-read.
                                      if (r.ok) setRetryNonce((n) => n + 1);
                                      return r;
                                    },
                                  } : {})}
                                />
                              </dd>
                            </div>
                          ))}
                          <div key={`${row.id}:company_name`} className={LABEL_ROW}>
                            <dt className="text-muted-foreground text-xs">{tx("contact.company")}</dt>
                            <dd><BusinessInlineField accountId={accountId} contactId={row.id} value={fieldsRow.company_name ?? null} /></dd>
                          </div>
                        </dl>
                      ) : (
                        <div data-drawer-fields-skeleton data-testid="drawer-skeleton"><RecordCardSkeleton rows={5} /></div>
                      )}

                      <TextsRow accountId={accountId} contactId={row.id} load={textsLoad}
                        onChanged={() => setRetryNonce((n) => n + 1)} onRetry={() => setRetryNonce((n) => n + 1)} />
                      <EmailRow accountId={accountId} contactId={row.id} load={emailLoad}
                        showTitle={textsLoad.status === "ready" && textsLoad.view.kind === "no_number"}
                        onChanged={() => setRetryNonce((n) => n + 1)} onRetry={() => setRetryNonce((n) => n + 1)} />

                      {who ? (
                        <>
                          <dl>
                            {/* Keyed by contact id, like FIELDS' rows (review round 1, m6). */}
                            <SourceField
                              key={row.id}
                              accountId={accountId}
                              contactId={row.id}
                              source={who.source}
                              sourceHint={who.sourceHint}
                              onSaved={() => setRetryNonce((n) => n + 1)}
                            />
                            {/* F-085 part 1: left out when the server did not say, never shown as Unassigned on a guess.
                                Keyed by contact AND holder, so a re-read with a different holder remounts the field. */}
                            {who.assignedTo !== undefined ? (
                              <div className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2" data-assignee-row>
                                <dt className="text-muted-foreground text-xs">{t(m, "assign.field.label", locale)}</dt>
                                <dd className="min-w-0">
                                  <ContactAssigneeField
                                    key={`${row.id}:${who.assignedTo ?? ""}`}
                                    accountId={accountId}
                                    contactId={row.id}
                                    value={who.assignedTo}
                                    options={members}
                                    readOnly={!canAssign}
                                    viewerId={viewerId}
                                  />
                                </dd>
                              </div>
                            ) : null}
                          </dl>
                          {who.tags.status === "ready" ? (
                            <TagsRow accountId={accountId} contactId={row.id} tags={who.tags.tags} locale={locale}
                              onChanged={() => setRetryNonce((n) => n + 1)} />
                          ) : (
                            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
                              <p className="text-muted-foreground">{tx("record.card.failed", { title: tx("contact.tags") })}</p>
                              <RecordCardRetry label={tx("record.card.retry")} onRetry={retrySection} />
                            </div>
                          )}
                        </>
                      ) : load.status === "loading" ? (
                        <div data-testid="drawer-skeleton"><RecordCardSkeleton rows={3} /></div>
                      ) : body ? (
                        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
                          <p className="text-muted-foreground">{body.who.status === "error" ? body.who.text : null}</p>
                          <RecordCardRetry label={tx("record.card.retry")} onRetry={retrySection} />
                        </div>
                      ) : null}
                    </div>
                  </RecordSection>
                </div>

                {/* D7: Groups, properties and related people are on the full record, one link away. */}
                <div data-drawer-bottom className="space-y-2 border-t border-[var(--line)] pt-3">
                  <p className="text-sm text-muted-foreground">{tx("drawer.moreOnRecord")}</p>
                  <Link href={fullHref} data-drawer-open-full className={GHOST_LINK}>{tx("drawer.openFull")}</Link>
                </div>
              </div>
            </div>
          </LocaleProvider>
        )}
      </SheetContent>
    </Sheet>
  );
}

// Reuses the EXISTING FormData tag actions with the same hidden-input idiom as
// contact-fields-panel.tsx. `onChanged` fires only after a successful submission and bumps the
// drawer's `retryNonce`, so a tag add/remove re-reads the route the badges come from.
async function submitTagAction(run: () => Promise<void>, onChanged: () => void, locale: Locale): Promise<boolean> {
  try {
    await run();
    onChanged();
    return true;
  } catch {
    // A stale tab posting a content-hashed server-action id from before a redeploy REJECTS rather
    // than resolving, and that must reach the operator as a toast, not vanish silently.
    toast.error(t(m, "inline.crashed", locale));
    // Reported rather than swallowed, so the caller keeps the typed tag on screen.
    return false;
  }
}

function TagsRow({ accountId, contactId, tags, locale, onChanged }: {
  accountId: string; contactId: string; tags: { id: string; name: string }[]; locale: Locale; onChanged: () => void;
}) {
  const boundAdd = addTagAction.bind(null, accountId);
  const boundRemove = removeTagAction.bind(null, accountId);
  const hidden = <input type="hidden" name="contactId" value={contactId} />;
  const addTag = useFormSubmit(async (formData, form) => {
    const ok = await submitTagAction(() => boundAdd(formData), onChanged, locale);
    // Cleared for the next tag ONLY on success; on failure the typed tag stays.
    if (ok && form.isConnected) form.reset();
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <form
          key={tag.id}
          // Keeps the `action` prop: this form carries no typed input, so React's post-action reset
          // has nothing to discard. `void` because an action prop must return void.
          action={(formData) => void submitTagAction(() => boundRemove(formData), onChanged, locale)}
          className="inline-flex"
        >
          {hidden}
          <input type="hidden" name="tagId" value={tag.id} />
          <button type="submit" className="group rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" title={tag.name}
            aria-label={t(m, "contact.removeTag", locale, { name: tag.name })}>
            <Badge variant="secondary" className="gap-1 pr-1.5">
              <span lang="">{tag.name}</span>
              <X className="text-muted-foreground group-hover:text-foreground size-3" aria-hidden />
            </Badge>
          </button>
        </form>
      ))}
      {/* onSubmit, NOT the `action` prop: a failed add must keep the tag the operator typed (lib/forms/use-form-submit.ts). */}
      <form onSubmit={addTag.onSubmit} className="inline-flex items-center gap-1">
        {hidden}
        <Input name="tag" placeholder={t(m, "contact.addTag", locale)} className="h-7 w-28 text-xs" />
        <Button type="submit" size="icon-xs" variant="ghost" aria-label={t(m, "contact.addTag", locale)}>
          <Plus className="size-3" aria-hidden />
        </Button>
      </form>
    </div>
  );
}
```

Notes for the implementer, read off the source:
- `FIELDS.labelKey` is now `MessageKey` (it was `keyof typeof m`, the same type): `contact-fields-panel.tsx:76`/`:79` (Task 3) keep compiling.
- The wiring test's `vi.mock("./actions")` must name every export the drawer and `BusinessInlineField` read (`business-field.tsx:7`: `setContactBusinessAction`, `undoContactBusinessAction`); Step 1's mock does.
- The tag add button moves from `outline` to `ghost` (rule 8: everything in the drawer but Call is ghost).
- `relativeTime` is no longer imported; `lib/dashboard/relative-time.ts:26`'s comment naming this file goes stale (spec §16; filed, not edited).

- [ ] **Step 5 (LAST code step, after Task 3's messages commit): messages.ts.** In the `drawer.*` block (`messages.ts:836-855`): delete `drawer.recent.call`, `.note`, `.submission`, `.message`, `.opportunity` (`:839-843`), `drawer.recentEmpty` (`:848`) and the comment above them (`:836-838`); then the block reads:

```ts
  // The contact list's drawer (S-03 part 3): the record's quick look.
  "drawer.recent": "Recent",
  "drawer.recent.es": "Lo más reciente",
  "drawer.seeAll": "See all activity",
  "drawer.seeAll.es": "Ver toda la actividad",
  "drawer.moreOnRecord": "Groups, properties and related people are on the full record.",
  "drawer.moreOnRecord.es": "Los grupos, las propiedades y las personas relacionadas están en la ficha completa.",
  // The whole drawer's error only; a section's failure says its own words.
  "drawer.loadFailed": "Couldn't load this customer. Try again, or open the full record.",
  "drawer.loadFailed.es": "No se pudo cargar este cliente. Intente de nuevo o abra la ficha completa.",
  "drawer.openFull": "Open full record",
  "drawer.openFull.es": "Abrir la ficha completa",
  // The Sheet's close button, read by a screen reader (plan deviation 3).
  "drawer.close": "Close",
  "drawer.close.es": "Cerrar",
  // Screen-reader-only (Radix logs a missing-Description warning without one).
  "drawer.description": "A quick look at this customer: how to reach them, what's next and what happened lately.",
  "drawer.description.es": "Un vistazo a este cliente: cómo comunicarse, lo que sigue y lo más reciente.",
```

Then `grep -rn 'drawer\.recent\.\|drawer\.recentEmpty' apps/web/src apps/web/e2e` → only the e2e comment at `contacts-drawer.spec.ts:805` (Task 9 rewrites it).

- [ ] **Step 6: Delete the old parser.** `git rm -- apps/web/src/lib/contacts/summary.ts apps/web/src/lib/contacts/summary.test.ts`, then `grep -rn "lib/contacts/summary\"\|parseContactSummary\|summaryLoadFrom\|ContactSummary\b" apps/web/src` → nothing.

- [ ] **Step 7: Run; it passes.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" src/lib/contacts src/lib/messages.test.ts src/lib/i18n/ratchet.test.ts "src/app/api/accounts/[accountId]/contacts"` → green (the ratchet: no new key without a twin; `contact-drawer.tsx`'s JSX-literal count falls). Each named probe once, failing by name (the C3 probe: put `setFetched(null);` before `setRetryNonce` in `retrySection` → `expected "spy" to not be called`). `pnpm --filter web typecheck`; `pnpm --filter web exec eslint "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.tsx" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/summary-card.tsx"`.

- [ ] **Step 8: Commit.**

```bash
git commit -m "feat(contacts): the list's drawer is the record's quick look: its header, facts, what is next, the five newest rows and who they are, each section on its own (S-03 part 3)" -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.wiring.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/summary-card.tsx" apps/web/src/lib/contacts/summary.ts apps/web/src/lib/contacts/summary.test.ts apps/web/src/lib/messages.ts
```

---

## Task 8: Measure the reads per drawer open (bis-crm)

**Review:** sonnet. **Runs beside:** Task 6 (one new file). **Starts after** Task 5. Spec §5 and the orchestrator ruling: the ~7 → ~20 is measured, not assumed.

**Files**
- Create: `…/summary/route.reads.test.ts`

**Interfaces**
- Consumes: Task 5's `GET`; the real `@bis/db` readers and loaders (NOT mocked here); `getContact`'s select shape (read `packages/db/src/contacts.ts` for it before Step 1).
- Produces: one number for the report and the ledger: reads per open through the two clients, plus the person's own preferences read.

- [ ] **Step 1: Write the measurement** `…/summary/route.reads.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

/**
 * Reads per drawer open (S-03 part 3 §5): every from()/rpc() the route makes, through a stand-in for
 * supabase-js that answers each read empty (one row for the contact and the account), over the REAL
 * @bis/db readers and loaders. The count is a fence: a new read on this path fails it by name.
 * Measured on a customer with nothing yet; a customer with rows adds the person-names read and the
 * bookings' "Moved from" read (record.ts's listContactBookings), both bounded.
 */
type Read = { client: "request" | "ledger"; target: string };
const reads: Read[] = [];
const SINGLE: Record<string, unknown> = {
  contacts: { id: "c1", account_id: "a1", first_name: "Maria", last_name: "Garcia", email: "maria@example.com", phone: "+19565550100",
    company_name: null, created_at: "2025-12-02T00:00:00Z", source: null, custom: {}, attribution: null, assigned_to: null,
    phone_country_unconfirmed: false },
  accounts: { timezone: "America/Chicago", language: null },
};
function recordingClient(client: Read["client"]) {
  const chain = (target: string) => {
    let single = false;
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") {
          const result = single ? { data: SINGLE[target] ?? null, error: null, count: 0 } : { data: [], error: null, count: 0 };
          return (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad);
        }
        return () => { if (prop === "maybeSingle" || prop === "single") single = true; return proxy; };
      },
    });
    return proxy;
  };
  return {
    from: (table: string) => { reads.push({ client, target: table }); return chain(table); },
    rpc: (fn: string) => { reads.push({ client, target: `rpc:${fn}` }); return chain(`rpc:${fn}`); },
  };
}
const request = recordingClient("request");
const ledger = recordingClient("ledger");
vi.mock("@/lib/auth", () => ({ apiAccountAccess: async () => ({ userId: "u1", isAgency: true }) }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => request }));
vi.mock("@/lib/consent/ledger-db", () => ({ ledgerDb: () => ledger }));
// Its own one-row read of the person's users row (its own client): counted by hand, +1.
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: null, theme: null }) }));
vi.mock("@/lib/zone", () => ({ renderZone: async (z?: string) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC", source: "account" }) }));

const { GET } = await import("./route");

/** Set from the first run (Step 2) and dated; never raised without the report saying why. */
const MEASURED = Number.POSITIVE_INFINITY;

describe("reads per drawer open (S-03 part 3 §5: measured, not assumed)", () => {
  it("the contact read first, the ledger only after it, and no more reads than measured (mutation: re-add the unpaged listContactMessages read -> FAILS)", async () => {
    const res = await GET(new Request("http://x/api/accounts/a1/contacts/c1/summary"), { params: Promise.resolve({ accountId: "a1", contactId: "c1" }) });
    expect(res.status).toBe(200);
    const list = reads.map((r) => `${r.client}:${r.target}`);
    console.info(`drawer reads per open: ${reads.length} through the clients, +1 getPersonPrefs\n${list.join("\n")}`);
    expect(list[0]).toBe("request:contacts");
    expect(list.filter((r) => r.startsWith("ledger:")).length).toBeGreaterThanOrEqual(1);
    expect(reads.length).toBeLessThanOrEqual(MEASURED);
  });
});
```

- [ ] **Step 2: Measure.** `pnpm --filter web exec vitest run "src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts"` → green with `MEASURED = Infinity`; copy the printed list into the report. If a reader throws on the stand-in's empty answer (its loader catches it and the section is an error), the `from()` was still made and is still counted; say which in the report. Set `const MEASURED = <N>; // measured 2026-10-<dd>: <N> reads (+1 prefs); was 7 (+0) before S-03 part 3` with the number read off the run. Compare with the spec's estimate (about 20) and state the difference.
- [ ] **Step 3: Prove the fence fails.** Temporarily add `void listContactMessages(db, accountId, contactId);` (imported from `@bis/db`) after the `Promise.all` in `route.ts` → the test FAILS by name (`expected N+1 to be less than or equal to N`); revert.
- [ ] **Step 4: Wall time** comes from Task 9's annotation (the real stack, the per-run fixture account); this task reports only the count.
- [ ] **Step 5: Commit.**

```bash
git add -- "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts"
git commit -m "test(contacts): count the reads one drawer open makes, so a new read on that path is a decision (S-03 part 3)" -- "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts"
```

---

## Task 7: Regenerate the i18n baselines (bis-crm)

**Review:** sonnet. **Starts after** Tasks 3 and 6 have committed. The ONLY task that writes the two baseline files, and they are written ONLY by the script (`ratchet.test.ts:1-11`).

**Files**
- Modify (generated): `apps/web/src/lib/i18n/catalogue-baseline.json`, `apps/web/src/lib/i18n/ratchet-baseline.json`

- [ ] **Step 1: Regenerate.** `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts`
- [ ] **Step 2: Read the diff; it may only shrink.** `git diff --stat -- apps/web/src/lib/i18n/` and `git diff -U0 -- apps/web/src/lib/i18n/catalogue-baseline.json | grep -c '^-  "'` → **72**: the 62 twinned keys (Task 3), the four `drawer.*` keys that gained twins (`drawer.description`, `.loadFailed`, `.openFull`, `.recent`) and the six deleted (`drawer.recent.call`, `.message`, `.note`, `.opportunity`, `.submission`, `drawer.recentEmpty`); `git diff -U0 … | grep -c '^+  "'` → **0** (nothing joins the frozen list). In `ratchet-baseline.json`, `src/components/ui/sheet.tsx` leaves (its one "Close" literal is now `{closeLabel}`) and `contact-drawer.tsx`'s count may fall; no file's count rises. Stop and report if either number differs.
- [ ] **Step 3: Run.** `pnpm --filter web exec vitest run src/lib/i18n/ratchet.test.ts src/lib/messages.test.ts` → green.
- [ ] **Step 4: Commit.**

```bash
git commit -m "chore(i18n): the catalogue baseline after the drawer's bilingual pass: 72 keys leave the frozen list, none join (S-03 part 3)" -- apps/web/src/lib/i18n/catalogue-baseline.json apps/web/src/lib/i18n/ratchet-baseline.json
```

---

## Task 9: e2e (bis-e2e-qa)

**Review:** sonnet. **Starts after** Tasks 6 and 7. bis-e2e-qa writes and typechecks; **the orchestrator runs Playwright** (check for an in-progress `screenshots.yml` run first). Mutating cases on the per-run fixture account only; `contact-detail.spec.ts` and `messaging.spec.ts` stay READ-ONLY on Test Client One.

**Files**
- Modify: `apps/web/e2e/contacts-drawer.spec.ts` (`:4-7` import, `:526`, `:626`, `:650-652`, `:771-821`, `:836`; a new `describe` at the end)
- Modify: `apps/web/e2e/consent-phone-country.spec.ts:109-113`, `:124-128`
- Modify: `apps/web/e2e/places.spec.ts:373-381`
- Modify: `apps/web/e2e/contact-detail.spec.ts:47`, `apps/web/e2e/messaging.spec.ts:57` (one `.first()` each; spec §12.2 calls them unchanged, but the drawer now has TWO links named "Open full record", the ↗ and the bottom link, and Playwright's strict mode refuses an ambiguous locator)
- Modify: `apps/web/e2e/i18n-overflow.spec.ts` (a new case after `:164`)

**Interfaces**
- Consumes: the drawer's hooks (Task 6): `[data-drawer-section="<facts|next-up|recent|who>"][data-state="<loading|ready|error>"]`, `data-testid="drawer-scroll" | "drawer-skeleton" | "drawer-recent-item"`, `[data-drawer-see-all]`, `[data-drawer-open-full]`, `[data-record-action="<id>"]`, `[data-record-facts]`, `[data-author-mark="<kind>"]`; keys `drawer.openFull`, `drawer.close.es`, `record.action.call.es`, `record.card.nextUp.es`, `provenance.customer(.es)`, `contacts.firstName.es`, `contacts.lastName.es`, `timeline.booked`, `compose.email`, `compose.emailPlaceholder`. `@bis/db`: `createContact`, `addPlace`, `getOrCreateCalendar`, `createBooking` (as `record-page.spec.ts:61-78` calls them); `recordPage` (`support.ts:132`).

- [ ] **Step 1: The changed waits and reads in `contacts-drawer.spec.ts`.**
  - `:526`: `await expect(dialogB.locator('[data-drawer-section="recent"][data-state="ready"]')).toBeVisible();` (the label "Recent" now renders while loading).
  - `:626`: `dialog.getByRole("link", { name: m["drawer.openFull"] }).first().getAttribute("href")`.
  - `:650-652`:

```ts
      const body = (await res.json()) as { who: { tags: { status: string; tags?: { name: string }[] } } };
      return body.who.tags.status === "ready" && (body.who.tags.tags ?? []).some((t) => t.name === seededTagName);
```

  - `:771-821` (the scroll check): line `:778` waits on `[data-drawer-section="who"][data-state="ready"]`; the geometric check measures the LAST element in the scroller, the bottom link (plan deviation 9), replacing `:798-821`:

```ts
    // Recent now sits above who they are (S-03 part 3 §9), so after scrolling to the bottom the last
    // thing in the scroller is the way to the full record, and THAT must land inside the clipped bounds.
    const bottom = dialog.locator("[data-drawer-open-full]");
    await expect(bottom).toBeVisible();
    const scrollerBox = await scroller.boundingBox();
    const bottomBox = await bottom.boundingBox();
    expect(scrollerBox, "scroller must have a real bounding box").not.toBeNull();
    expect(bottomBox, "the bottom link must have a real bounding box").not.toBeNull();
    if (scrollerBox && bottomBox) {
      expect(bottomBox.y, "the bottom link's top must be within the scroller's clipped bounds").toBeGreaterThanOrEqual(scrollerBox.y - 1);
      expect(bottomBox.y + bottomBox.height, "the bottom link's bottom must be within the scroller's clipped bounds")
        .toBeLessThanOrEqual(scrollerBox.y + scrollerBox.height + 1);
    }
  });
```

  (Keep the overflow precondition at `:787-788`: "seeded content must overflow". If the six tags no longer overflow a 720px drawer whose Groups and Properties cards left, lower the viewport at `:772` to `{ width: 1440, height: 560 }` and say so in the report.)
  - `:836`: `await expect(drawer.locator('[data-drawer-section="recent"][data-state="ready"]')).toBeVisible();` (the client session's grants proof: Recent's seven timeline sources read under RLS).
- [ ] **Step 2: `consent-phone-country.spec.ts`** `:113` and `:128`: `await expect(page.getByRole("dialog").locator('[data-drawer-section="who"][data-state="ready"]')).toBeVisible();` (and `drawer.locator(…)` at `:128`), with the comments above them reworded: the section's `data-state` is the sign the route answered, the "Recent" text no longer is. `contact-detail.spec.ts:47` and `messaging.spec.ts:57`: append `.first()` to the `getByRole("link", { name: m["drawer.openFull"] })` locator (the ↗ beside the name).
- [ ] **Step 3: `places.spec.ts:373-381`.** The drawer's Properties card left (D7): the second member's shared place is asserted on THEIR record page, where the card is:

```ts
      // The household's SECOND member sees the same place on their own record (the drawer no longer
      // carries Properties, S-03 part 3 D7).
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${secondId}`);
      const secondCard = recordPage(page).locator('[data-record-card="properties"] [data-places-card]');
      const sharedOnSecond = secondCard.locator("[data-place-row]").filter({ hasText: SHARED_ADDRESS });
      await expect(sharedOnSecond).toBeVisible();
      await expect(sharedOnSecond.getByRole("paragraph").filter({ hasText: m["places.sharedWith"].replace("{group}", HOUSEHOLD) })).toBeVisible();
```

- [ ] **Step 4: The new cases**, at the end of `contacts-drawer.spec.ts` (add `addPlace, getOrCreateCalendar, createBooking` to the `@bis/db` import at `:4-7` and `recordPage` to the `./support` import at `:9`):

```ts
/**
 * S-03 part 3 (spec §12.2): the drawer is the record's quick look. ON THE PER-RUN FIXTURE ACCOUNT
 * (`accountId`, set by this file's beforeAll). Two contacts of this block's own: "Quick" with a phone,
 * an email, an addressed property and a booking made by the booking page's writer (the customer's);
 * "Plain" with a phone only. The booking goes before its contact (bookings.contact_id is on delete
 * restrict); the property cascades with it.
 */
test.describe("S-03 part 3: the drawer on the record kit", () => {
  const STAMP = Date.now();
  const LAST = `Quicklook ${STAMP}`;
  const PHONE = `+1956295${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const PLAIN_PHONE = `+1956297${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const made: { quick?: string; plain?: string } = {};
  let cancelToken = "";

  test.beforeAll(async () => {
    const db = serviceDb();
    const quick = await createContact(db, accountId, { firstName: "Quick", lastName: LAST, phone: PHONE, email: `quicklook-${STAMP}@example.com` }, ACTOR);
    if (quick.existing) throw new Error(`contacts-drawer e2e: ${PHONE} matched an existing contact; refusing to use (or delete) it.`);
    made.quick = quick.id;
    const plain = await createContact(db, accountId, { firstName: "Plain", lastName: LAST, phone: PLAIN_PHONE }, ACTOR);
    if (plain.existing) throw new Error(`contacts-drawer e2e: ${PLAIN_PHONE} matched an existing contact; refusing to use (or delete) it.`);
    made.plain = plain.id;
    await addPlace(db, accountId, { contactId: made.quick, groupId: null }, {
      label: null, address: "1204 Nolana Ave", landmark: null, directions: null, city: "McAllen", region: "TX", postal_code: "78504", country: "US",
    }, { subjectId: made.quick, actorId: ACTOR });
    // Sixty-one days out: past the calendar's 30-day horizon, so booking.spec never offers this slot.
    const cal = await getOrCreateCalendar(db, accountId, ACTOR);
    const start = new Date(Date.now() + 61 * 86_400_000);
    start.setUTCHours(16, STAMP % 60, 0, 0);
    const booked = await createBooking(db, accountId, {
      calendarId: cal.id, contactId: made.quick, startsAt: start, endsAt: new Date(start.getTime() + 3_600_000), ipHash: `e2e-quicklook-${STAMP}`,
    }, "public", "system");
    cancelToken = booked.cancelToken;
  });

  test.afterAll(async () => {
    const db = serviceDb();
    if (cancelToken) {
      const { error } = await db.from("bookings").delete().eq("account_id", accountId).eq("cancel_token", cancelToken);
      if (error) console.error(`contacts-drawer e2e: booking cleanup failed (the fixture sweep takes it): ${error.message}`);
    }
    const ids = [made.quick, made.plain].filter((x): x is string => Boolean(x));
    const { error } = await db.from("contacts").delete().eq("account_id", accountId).in("id", ids);
    if (error) console.error(`contacts-drawer e2e: contact cleanup failed (the fixture sweep takes it): ${error.message}`);
    const { data: left } = await db.from("contacts").select("id").in("id", ids);
    expect(left ?? []).toEqual([]);
  });

  const open = async (page: Page, first: string) => {
    await page.goto(`${base()}/contacts?q=${encodeURIComponent(LAST)}`);
    await page.getByRole("row").filter({ hasText: `${first} ${LAST}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator('[data-drawer-section="recent"][data-state="ready"]')).toBeVisible();
    return dialog;
  };

  test("the header: Call the one primary, Email and Directions, no Text on an account without A2P; a bare contact shows only Call", async ({ page }, testInfo) => {
    const summary = page.waitForResponse((r) => r.url().includes(`/contacts/${made.quick}/summary`));
    const dialog = await open(page, "Quick");
    // Wall time of the drawer's one read beside the record page's document (plan deviation 10; reported, not asserted).
    const drawerMs = (await summary).request().timing().responseEnd;
    await expect(dialog.locator("h2")).toHaveText(`Quick ${LAST}`);
    await expect(dialog.locator("[data-record-action]")).toHaveCount(3);
    expect(await dialog.locator("[data-record-action]").evaluateAll((els) => els.map((e) => e.getAttribute("data-record-action")))).toEqual(["call", "email", "directions"]);
    await expect(dialog.locator('[data-record-action="call"]')).toHaveAttribute("href", /^tel:\+1956295/);
    await expect(dialog.locator('[data-record-header] [data-variant="default"]')).toHaveCount(1);
    await expect(dialog.locator('[data-record-action="text"]')).toHaveCount(0);
    await expect(dialog.locator("[data-record-action][aria-disabled], [data-record-action][disabled]")).toHaveCount(0);
    const record = await page.goto(`${base()}/contacts/${made.quick}`);
    testInfo.annotations.push({ type: "drawer summary vs record page (ms to response end)",
      description: `${Math.round(drawerMs)} vs ${Math.round(record!.request().timing().responseEnd)}` });
    const plain = await open(page, "Plain");
    expect(await plain.locator("[data-record-action]").evaluateAll((els) => els.map((e) => e.getAttribute("data-record-action")))).toEqual(["call"]);
  });

  test("Email lands on the record with the email composer open and its body focused (D8; Text is hidden here, its target is unit-pinned)", async ({ page }) => {
    const dialog = await open(page, "Quick");
    await dialog.locator('[data-record-action="email"]').click();
    await expect(page).toHaveURL(new RegExp(`/contacts/${made.quick}#compose-email$`));
    await expect(recordPage(page).getByRole("button", { name: m["compose.email"], exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(recordPage(page).getByPlaceholder(m["compose.emailPlaceholder"])).toBeFocused();
  });

  test("Recent shows the booking page's booking as the customer's, and See all activity opens the record's timeline", async ({ page }) => {
    const dialog = await open(page, "Quick");
    const booking = dialog.getByTestId("drawer-recent-item").filter({ has: page.locator('[data-author-mark="customer"]') });
    await expect(booking).toHaveCount(1);
    await expect(booking.locator('[data-author-mark="customer"]')).toHaveText(m["provenance.customer"]);
    await expect(booking).toContainText(m["timeline.booked"].split("{when}")[0]!.trim());
    // Every row says who did it (DESIGN.md, Provenance): record-page.spec.ts:233's check, in the drawer.
    await expect(dialog.locator('[data-testid="drawer-recent-item"] [data-timeline-item]:not(:has([data-author-mark]))')).toHaveCount(0);
    await dialog.locator("[data-drawer-see-all]").click();
    await expect(page).toHaveURL(new RegExp(`/contacts/${made.quick}#record-timeline$`));
  });

  test("Esc closes the drawer", async ({ page }) => {
    await open(page, "Quick");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test.describe("in Spanish (the client session's Owner, restored in finally)", () => {
    test.use({ storageState: "e2e/.auth/client-state.json" });

    test("the drawer reads Spanish: lang, Llamar, Lo que sigue, Cliente, Nombre and Apellido, and Cerrar", async ({ page }) => {
      const db = serviceDb();
      // Exactly one Owner membership on a per-run fixture account (places.spec.ts:385-400's reasoning).
      const owner = await db.from("memberships").select("user_id")
        .eq("scope", "account").eq("account_id", accountId).eq("role", "owner").limit(1).single();
      expect(owner.error, `reading the fixture Owner's membership: ${owner.error?.message}`).toBeNull();
      const ownerId = owner.data!.user_id as string;
      const prior = await db.from("users").select("language").eq("id", ownerId).single();
      expect(prior.error, `reading the Owner's language before the switch: ${prior.error?.message}`).toBeNull();
      const priorLanguage = prior.data!.language as string | null;
      const set = await db.from("users").update({ language: "es" }).eq("id", ownerId).select("id");
      expect(set.error, `switching the Owner to Spanish: ${set.error?.message}`).toBeNull();
      expect(set.data, "switching the Owner to Spanish: one users row").toHaveLength(1);
      try {
        const dialog = await open(page, "Quick");
        await expect(dialog.locator('[lang="es"]').first()).toBeVisible();
        await expect(dialog.locator('[data-record-action="call"]')).toHaveText(m["record.action.call.es"]);
        await expect(dialog.getByText(m["record.card.nextUp.es"], { exact: true })).toBeVisible();
        await expect(dialog.locator('[data-author-mark="customer"]').first()).toHaveText(m["provenance.customer.es"]);
        await expect(dialog.getByText(m["contacts.firstName.es"], { exact: true }).first()).toBeVisible();
        await expect(dialog.getByText(m["contacts.lastName.es"], { exact: true }).first()).toBeVisible();
        await expect(dialog.getByRole("button", { name: m["drawer.close.es"] })).toBeVisible();
      } finally {
        // Every later spec in this run uses this same per-run Owner (workers: 1) and reads English.
        const reset = await db.from("users").update({ language: priorLanguage }).eq("id", ownerId).select("id");
        expect(reset.error, `resetting the Owner's language: ${reset.error?.message}`).toBeNull();
        expect(reset.data, "resetting the Owner's language: one users row").toHaveLength(1);
      }
    });
  });
});
```

(Read `contacts-drawer.spec.ts:60-200` before writing: `base()`, `accountId`, `ACTOR` (`:131`) and `serviceDb` are this file's; check that the client session's list shows the fixture account's contacts at `base()/contacts` as `:827-836` does.)

- [ ] **Step 5: The overflow case**, in `i18n-overflow.spec.ts` after the contact record page case (`:164`), on the per-run fixture account:

```ts
  test("the contact list's drawer: header actions and the fact line wrap, never clip, under the pseudo-locale (S-03 part 3)", async ({ page }) => {
    const fixture = readClientFixture();
    if (!fixture) {
      test.skip(true, "No client fixture at e2e/.auth/client-fixture.json; run the full suite.");
      return;
    }
    const db = serviceDb();
    const stamp = Date.now();
    const phone = `+1956298${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const { id, existing } = await createContact(db, fixture.accountId, {
      firstName: "Overflow", lastName: `Drawer ${stamp}`, phone, email: `overflow-drawer-${stamp}@example.com`,
    }, "e2e-i18n-overflow");
    if (existing) throw new Error(`i18n-overflow e2e: ${phone} matched an existing contact; refusing to use (or delete) it.`);
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      // C9: the list's ?locale= rides along to the drawer's route.
      await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts?locale=pseudo&peek=${id}`);
      const dialog = page.getByRole("dialog");
      await expect(dialog.locator('[data-drawer-section="facts"][data-state="ready"]')).toBeVisible();
      await expect(dialog.locator('[data-record-action="call"]')).not.toHaveText(m["record.action.call"]);
      const measured = dialog.locator("[data-record-action], [data-record-facts]");
      const count = await measured.count();
      expect(count, "no drawer header actions or fact line found").toBeGreaterThan(1);
      for (let i = 0; i < count; i++) {
        const [scrollW, clientW, text] = await measured.nth(i).evaluate((n) => [n.scrollWidth, n.clientWidth, n.textContent]);
        expect(clipFailure(scrollW, clientW, `drawer "${text}"`)).toBeNull();
      }
    } finally {
      const { error } = await db.from("contacts").delete().eq("account_id", fixture.accountId).eq("id", id);
      if (error) console.error(`i18n-overflow e2e: cleanup failed: ${error.message}`);
    }
  });
```

(The 92px label column of who-they-are (`contact-drawer.tsx`, `LABEL_ROW`) is spec §9.7's open **Assumption**: also measure `dialog.locator("[data-drawer-section=\"who\"] dt")` with the REAL Spanish locale (an `?locale=es` second visit), and report any clip rather than assert, as the sidebar case reports its pseudo clips.)

- [ ] **Step 6: Typecheck and the fixture-name guard.** `pnpm --filter web exec tsc --noEmit -p e2e` (or the e2e typecheck `apps/web/package.json` names) and `pnpm --filter web exec vitest run e2e/fixtures/fixture-names.test.ts e2e/overflow-check.test.ts` → green. The names "Quick Quicklook <stamp>", "Plain Quicklook <stamp>" and "Overflow Drawer <stamp>" carry no `E2E` prefix the sweep would need to admit (check `fixture-names.test.ts` and say so).
- [ ] **Step 7: Commit.**

```bash
git commit -m "test(e2e): the list's drawer as the record's quick look: its header, Email landing on the composer, a marked recent row, Spanish, Esc, and the pseudo-locale (S-03 part 3)" -- apps/web/e2e/contacts-drawer.spec.ts apps/web/e2e/consent-phone-country.spec.ts apps/web/e2e/places.spec.ts apps/web/e2e/contact-detail.spec.ts apps/web/e2e/messaging.spec.ts apps/web/e2e/i18n-overflow.spec.ts
```

- [ ] **Step 8 (orchestrator): run the gates**, one at a time: `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (after checking for an in-progress `screenshots.yml` run). Paste the drawer-vs-record annotation from the e2e report into the ledger with Task 8's count. The `forms.spec` unread-badge flake is unrelated.

---

## Task 10: DESIGN.md and the ledger (orchestrator)

- [ ] **Step 1.** Land spec §17's two sentences in `DESIGN.md`, verbatim:
  - In "Record page, documents and provenance" → **Record page**, appended after "…not a new top-level surface." (the paragraph ending "A household or a business has its own record page on the same kit (decided 2026-10-13): it is a record, reached from its members' pages, not a new top-level surface."): "The list's drawer is the record's quick look on the same kit (decided 2026-10-13): the record's header with Call as its one primary, the checked facts, what is next, the five newest timeline rows and who they are, in flat sections (a mono label and row rules, never a glass card inside the glass sheet); everything else is on the full record, one link away."
  - In **Rules**, rule 8, appended after "…and the cards below keep their own.": "The drawer's header is the same view: Call is its one primary, and an inline form inside the drawer keeps its own."
  Commit: `docs(design): the list's drawer is the record's quick look on the same kit (S-03 part 3)` with `git commit -- DESIGN.md`.
- [ ] **Step 2.** File in the ledger (spec §16 plus this plan's findings): the Groups card in Spanish; server-action error strings in the caller's language; the unpaged single-contact paths of `listContactSubmissions` (bis-crm) and `listContactMessages` (bis-comms) and the stale comments at `record.ts:346` and `voice.ts:949-955`; `relative-time.ts:26`'s stale caller; `compose.smsHeld.es` "en pausa" vs `contact.texts.held.es` "En espera" (bis-comms, plan deviation 1); the English left in plan deviation 12; `InlineField`'s `setup.rename.empty` without a locale (deviation 11); Task 8's count and Task 9's wall time.

---

## Task 11: Whole-branch final review (checkpoint, not an implementer task)

**Reviewer:** opus, fresh context. Runs after Tasks 7, 8, 9 and 10.

- [ ] **Step 1.** Read the spec end to end, then `git diff 619a9b75...HEAD` in `<WT>`; walk the coverage table below row by row against the diff.
- [ ] **Step 2.** Web tests by path: every test file Tasks 1–8 touched, plus `src/lib/i18n/ratchet.test.ts`, `src/lib/i18n/request-locale-callers.test.ts`, `src/lib/messages.test.ts`, `src/components/ui/material.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`, `"src/app/(dashboard)/dashboard/styleguide"`; `pnpm --filter web typecheck`. Re-run two probes of your own choosing, by name.
- [ ] **Step 3.** Hunt specifically: (a) any read in the route before `getContact`, and `ledgerDb()` anywhere but inside `smsRead`; (b) any string the drawer shows that is not in the body's locale (`m[…]` left in `contact-drawer.tsx`, `texts-row.tsx`, `email-row.tsx`, `source-field.tsx`, `business-field.tsx`, `contact-fields-panel.tsx`, `assignee-field.tsx`); (c) a second primary in the drawer (`data-variant="default"`); (d) a glass card inside the Sheet (`glass`, `bg-card` in the drawer's sections); (e) a section whose Try again calls `router.refresh()` (RecordCardRetry without `onRetry`, a boundary without `onReset`); (f) `drawer-skeleton` missing from any loading section; (g) a test that cannot fail (memory: vacuous test shapes); (h) the whole-drawer Retry still the only `setFetched(null)`.
- [ ] **Step 4.** Report findings by severity with file:line; the orchestrator routes fixes to the owning task's agent.

---

## Spec coverage

| Spec | Where |
|---|---|
| D1 quick look, order | Task 6 (sections in order; source-order test) |
| D2 header: kit, group line, Call/Text/Email/Directions, ↗, no back | Task 1 (drawer form), Task 2 (`headerActionLabels`), Task 5 (`header`), Task 6 |
| D3 facts via `loadSummary` + `factsView` | Task 5 (route), Task 6 (`SummaryBody` + `onRetry`) |
| D4 Next up without Add a To-do | Task 5, Task 6 (`addTodoLabel={null}`, test) |
| D5 Recent: 5 rows, marks, read-only, See all | Task 2 (`loadRecent`, `recentRowsView`), Task 5, Task 6, Task 9 |
| D6 who they are unchanged | Task 6 (FIELDS, Business, Texts, Email, Source, Assigned to, Tags) |
| D7 Groups/Properties/Related leave; bottom line | Task 6 (source pin), Task 9 (`places.spec`) |
| D8 Text/Email land on the composer | Task 5 (`composeHref`), Task 9 (Email end to end) |
| D9 flat sections, route rewrite, keep Sheet/peek/Esc/guards, no migration | Tasks 1, 5, 6 |
| D10 bilingual pass, page wrappers (Groups keeps its own) | Tasks 2 (`contactSourceHint`), 3, 4 |
| D11 old shapes deleted | Task 5 (body keys test), Task 6 (keys and `summary.ts` deleted), Task 7 |
| D12 tests | Tasks 1–9 |
| D13 ownership | Global Constraints |
| C1 one locale on the server, `LocaleProvider` | Task 5 (`requestLocale`), Task 6 (provider test) |
| C2 per-section status | Task 5 (`section()`, route `it.each`) |
| C3 section retry keeps the body | Task 6 (test, probe) |
| C4 `RecordSection` | Task 1 (+ deviation 4, 5) |
| C5 facts unlabelled, `record.summary.failed` | Tasks 5, 6 |
| C6 compact JSON rows | Task 2 |
| C7 Text's gate = the page's; ledger after proof | Task 5 (tests) |
| C8 header labels' one home | Task 2 |
| C9 QA locale forwarded | Task 5 (`drawerSummaryUrl`), Task 6 (URL tests), Task 9 (overflow) |
| C10 test hooks kept, `data-drawer-section` | Task 6, Task 9 |
| §4 roles (Technician 404, read-only Assigned to) | Task 5 (404 before reads), Task 6 (`readOnly={!canAssign}` pin) |
| §5 reads measured | Task 8, Task 9 (wall time) |
| §8.1 `/styleguide` | Task 1 (deviation 6) |
| §9.7 width, wrap, keyboard, Esc | Task 6 (`w-full sm:max-w-md`, Esc handler kept), Task 9 (overflow, Esc) |
| §10.3 twins | Task 3 (62, deviation 1), Task 7 |
| §11 drawer keys | Task 6 (+ `drawer.close`, deviation 3) |
| §12.1 allowlist, ratchet, kit tests | Tasks 1, 5, 7 |
| §12.2 e2e | Task 9 |
| §13 rollout: ordinary merge | Task 9 Step 8 (gates), orchestrator |
| §14 Sheet `closeLabel` (bis-frontend) | Task 1 |
| §16 follow-ups | Task 10 |
| §17 DESIGN.md | Task 10 |
| Q1 stub fields from the route | Task 5 (`who.fields`, `drawerFieldsRow`), Task 6 (test) |
| Q2–Q5 | Task 6 (no Add a To-do; no Open call), Task 9 (Email, not Text), Task 3 (bis-comms reviews the Spanish) |
