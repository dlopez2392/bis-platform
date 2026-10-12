# The contact record page, PR 1a: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/dashboard/accounts/[accountId]/contacts/[contactId]` as the S-03 record page's first release (1a): a record kit, a card registry, a header with Call/Text/Email/Directions, checked summary facts, Next up, one card chrome with each card failing alone, the phone order, and today's timeline moved into its card with the composer on top. No database change.

**Architecture:** A small kit under `apps/web/src/components/record/` (bis-frontend) supplies the layout, header, card chrome and per-card boundary. A registry (`apps/web/src/lib/record/record-cards.ts`) fixes each card's column and phone order. The page awaits one loader per card. Each loader returns `{status: "ready", …} | {status: "error"}` and never throws, so one failed read is that card's error state and never the page's. Pure formatters in `apps/web/src/lib/record/` turn the new read-only queries (`packages/db/src/record.ts`, plus additive reads in `booking.ts` and `voice.ts`) into the fact line, Next up and the header actions.

**Tech Stack:** Next.js 16 App Router (server page, client cards), React 19.2, Tailwind v4 container queries, supabase-js (PostgREST) through `@bis/db`, vitest (`renderToStaticMarkup`, no DOM), Playwright (bis-e2e-qa only).

**Spec:** `docs/superpowers/specs/2026-10-12-record-page-design.md` at `aa0a448b`. This plan covers **only 1a**: everything the spec does not mark **[1b]**. Out of scope: no migration, no `AuthorMark`/`TimelineItem`, no new timeline row kinds, no paging, no channel filter on the timeline.

## Global Constraints

- **Ownership (CLAUDE.md agents).** bis-frontend owns `apps/web/src/components/record/*`, the `/styleguide` entries and the DESIGN.md text. bis-crm owns the page, the registry's contents, facts/Next up, the timeline's composition, `packages/db/src/record.ts` and the contacts copy. bis-booking owns `packages/db/src/booking.ts`. bis-voice owns `packages/db/src/voice.ts`. bis-comms owns `message-composer.tsx` and `lib/sms/sender.ts`. bis-e2e-qa owns `apps/web/e2e/**`. Every task below names its owner, and **no task edits a file its owner does not own.**
- **`apps/web/src/lib/messages.ts` is shared:** Task 4 and Task 5 both append to it, so they run **one after the other** (4, then 5). No other task touches it. Keys go under the `record.` namespace, appended just above the closing `} as const;` (after `"equipment.removed.es"`, `messages.ts:3672`). Twins for existing keys sit directly under their English key.
- **i18n:** every new string goes through `t()` (`lib/i18n/t.ts:36`) or `plural()` (`:57`) with an `.es` twin, or the ratchet (`lib/i18n/ratchet.test.ts`, "every catalogue key added from today has a Spanish twin") fails. Spanish is usted and the trades' Spanish of the spec's §10.1 table. No `{{…}}`, no milestone codes (`messages.test.ts`'s `INTERNAL_MILESTONE`), no vendor jargon.
- **The `.es` and pseudo path for server strings:** server strings go through `makeTr(locale, pseudo)` (Task 5, `lib/record/copy.ts`). It wraps `t`/`plural` and applies `pseudoLocale` when `?locale=pseudo` is on (QA only, `requestPseudoMode`). Client kit strings use `useLocale()` + `t()`.
- **DESIGN.md definition of done for every UI task (4, 7, 8):** tokens only, with no hard-coded colour, radius or shadow (radii come from `rounded-xl` and `rounded-[var(--radius-ctl)]`, and dots use `bg-[var(--warn)]`/`--accent`/`--good`/`--text-3`). Each task renders in dark and light (the `.dark` class) and holds up under the blur fallback: cards use the existing `glass` utility, which already carries `@supports`, and are never blurred. Each has loaded, empty and error states, a visible `:focus-visible` ring, and controls at least 44px tall on a phone. Copy is EN+ES and survives the pseudo-locale's +35%, `lang` is set correctly, nothing animates on scroll, and `prefers-reduced-motion` is respected (`motion-reduce:transition-none`). New kit components get `/styleguide` entries (Task 4).
- **Rule 3:** a status is a dot plus a word, never colour alone. **Rule 7:** loading is a skeleton shaped like the content, never a spinner. **Rule 8:** one primary per view. The header's Call is its own view (D8), and the composer's Send stays primary in its card. **Rule 11:** a record page names no hero.
- **C5:** every card's loader returns `{ status: "ready", … } | { status: "error" }` and never throws. Each card also sits behind a client `RecordCardBoundary` (an error boundary around a `Suspense` whose fallback is the card's skeleton). React's server renderer does not run class error boundaries; a `Suspense` boundary is what keeps a server-render throw inside one card. Verified on React 19.2.4: `renderToStaticMarkup` threw "boom" with a class boundary alone, and rendered the fallback plus its sibling with `Suspense` inside.
- **C6:** DOM order is the phone order on every width. On a desk the columns are placed by CSS grid placement (`col-start-*`/`row-start-2`) under a `@container` query at 1024px of container width.
- **Tests that can fail:** every test names the mutation probe that makes it fail. Run the probe and paste the failing assertion line into the report. A probe that cannot fail must be said so and replaced.
- **Running tests.** The worktree `C:\Users\danlo\bis-platform\.claude\worktrees\s03-record` has **no `node_modules` and no `.env`**. Run `pnpm install --frozen-lockfile` once at its root before the first web test. Web unit tests need no env. Never create, copy or edit an `.env*` file.
- **Live `@bis/db` tests** (Tasks 1–3) need PostgREST and the env, which this worktree does not have. Their red and green are proven by **CI `verify`**: the orchestrator pushes the branch after Task 3, the implementer writes the test red-first against the stubbed function, and runs `pnpm --filter @bis/db typecheck` locally. Judge any db run by vitest's own summary block, never by the exit code (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` prints after real results). 1a adds no schema, so a run on bis-ci from the main checkout is allowed if the orchestrator chooses. Prefer pure unit tests wherever a pure function can carry the logic.
- **Never run gates** (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`); those are the orchestrator's. Run only the test files named in the task, plus `pnpm --filter web typecheck` and `pnpm --filter web exec eslint <touched files>` on the files the task touched.
- **e2e** (Task 9, bis-e2e-qa only): the per-run fixture account only, **never Test Client One** for a mutation. `contact-detail.spec.ts`'s first test stays read-only on Test Client One. Rows the spec makes are removed in `afterAll`. Names starting `E2E ` must be registered in `e2e/fixtures/fixture-names.test.ts`. This plan uses `Record`/`Bare`/`Overflow` first names so none are minted. No per-person state changes (Spanish comes from `?locale=es`, the QA override), so nothing needs resetting.
- **Commits:** `git add -- <new files>` then `git commit -m "<type>(<scope>): <what and why>" -- <every path>`. Never `-A` or `.`. **Never `git stash`.** If `.git/index.lock` exists, wait and retry. Never push.

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/src/record.ts` | bis-crm | `contactFacts`, `contactNextUp`: read-only facts and Next up for one customer |
| `packages/db/src/test/record.test.ts` | bis-crm | live tests for the above |
| `apps/web/src/components/record/use-phone.ts` | bis-frontend | `usePhone()`, the phone media query (server snapshot: phone) |
| `apps/web/src/components/record/record-card.tsx` | bis-frontend | `RecordCard`, `RecordCardView`, skeleton/error/retry pieces |
| `apps/web/src/components/record/record-card-boundary.tsx` | bis-frontend | per-card error boundary + `Suspense` |
| `apps/web/src/components/record/record-layout.tsx` | bis-frontend | the desk grid and the skip link; `RecordColumn` |
| `apps/web/src/components/record/record-header.tsx` | bis-frontend | name, group line, back link, actions |
| `apps/web/src/components/record/*.test.ts` (4 files) | bis-frontend | kit tests |
| `apps/web/src/app/(dashboard)/dashboard/styleguide/record-demo.tsx` (+ `.test.ts`) | bis-frontend | styleguide entries |
| `apps/web/src/lib/record/record-cards.ts` (+ test) | bis-crm | the registry |
| `apps/web/src/lib/record/copy.ts` (+ test) | bis-crm | `makeTr`: `t`/`plural` + pseudo |
| `apps/web/src/lib/record/record-facts.ts` (+ test) | bis-crm | the fact line |
| `apps/web/src/lib/record/next-up.ts` (+ test) | bis-crm | Next up rows |
| `apps/web/src/lib/record/header-actions.ts` (+ test) | bis-crm | which header actions show, in what order |
| `apps/web/src/lib/record/loaders.ts` | bis-crm | one never-throwing loader per card |
| `…/contacts/[contactId]/summary-card.tsx`, `next-up-card.tsx`, `deals-card.tsx`, `focus-field-button.tsx` (+ tests) | bis-crm | card bodies |
| `…/contacts/[contactId]/activity-timeline.order.test.ts`, `contact-fields-panel.bodies.test.ts` | bis-crm | move-in tests |
| `apps/web/e2e/record-page.spec.ts` | bis-e2e-qa | e2e |

**Modified**: `packages/db/src/booking.ts`, `packages/db/src/voice.ts`, `packages/db/src/index.ts` (additive lines), `packages/db/src/test/booking.test.ts`, `packages/db/src/test/voice.test.ts`, `apps/web/src/lib/messages.ts`, `DESIGN.md`, `…/styleguide/page.tsx`, `…/contacts/[contactId]/message-composer.tsx` (+ test), `activity-timeline.tsx`, `contact-fields-panel.tsx`, `contact-fields-panel.assignee.test.ts`, `constants.ts`, `page.tsx`, `page.test.ts`, `…/contacts/groups-card.tsx`, `places-card.tsx`, `relationships-card.tsx` and their three tests, `apps/web/e2e/contact-detail.spec.ts`, `apps/web/e2e/i18n-overflow.spec.ts`, `docs/crm-features.md`.

`…/contacts/` below means `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/`.

## Task list and order

| # | Task | Owner | Depends on |
|---|---|---|---|
| 1 | Bookings made and upcoming bookings (booking.ts) | bis-booking | none |
| 2 | Newest non-spam call (voice.ts) | bis-voice | none |
| 3 | `contactFacts` / `contactNextUp` (record.ts) | bis-crm | 1, 2 |
| 4 | The record kit, styleguide, DESIGN.md (**messages.ts, first**) | bis-frontend | none |
| 5 | Registry, copy, facts, Next up, header actions (**messages.ts, second**) | bis-crm | 3 (types), 4 (`RecordColumn`, keys) |
| 6 | The composer opens on the channel from the hash | bis-comms | none |
| 7 | Card bodies: move in and add | bis-crm | 4, 5, 6 |
| 8 | The page: loaders, layout, header, locale | bis-crm | 3, 4, 5, 6, 7 |
| 9 | e2e: record-page.spec, contact-detail, overflow | bis-e2e-qa | 8 |

Tasks 1, 2, 4 and 6 can run in parallel lanes, with only Task 4 touching `messages.ts` among them.

---

### Task 1: Bookings made and upcoming bookings, per customer (bis-booking)

**Files:**
- Modify: `packages/db/src/booking.ts` (append after `listBookingCreationsBetween`, which ends at `:932`)
- Modify: `packages/db/src/index.ts` (one line after `:87`, `export { moveBooking, … } from "./booking";`)
- Test: `packages/db/src/test/booking.test.ts` (append a `describe`, and add the two names to the `../booking` import at `:7-16`)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `countContactBookingsMade(db: SupabaseClient, accountId: string, contactId: string): Promise<number>`: throws on a read error.
  - `type UpcomingBooking = { id: string; starts_at: string }`
  - `listContactUpcomingBookings(db: SupabaseClient, accountId: string, contactId: string, nowIso: string, limit = 3): Promise<UpcomingBooking[]>`: throws on a read error.

**Spec deviation, recorded:** the spec's Next up row shows "{calendar}" and §15 asks for "the calendar's name". `calendars` has **no name column** (`0016_booking.sql:7-28`, and no later `alter table public.calendars … add column` adds one), and there is one calendar per account (`calendars_one_per_account`). So no calendar label is read; Task 5 words the row "Appointment · {when}" instead.

- [ ] **Step 1: Write the failing tests** (append to `booking.test.ts`; add `countContactBookingsMade, listContactUpcomingBookings` to the import list from `"../booking"`)

```ts
describe("per-customer booking reads for the record page (S-03 part 1)", () => {
  it("counts bookings MADE: a reschedule is not one, a later cancel still is, another customer's never (D-035/D14; mutation: drop .is('rescheduled_from_id', null) -> 3, FAILS; mutation: add .neq('status','cancelled') -> 1, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const { id: luis } = await createContact(db, accountId, { firstName: "Luis" }, "user_test");
      const at = (iso: string) => ({ startsAt: new Date(iso), endsAt: new Date(new Date(iso).getTime() + 3_600_000) });
      const first = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...at("2027-03-02T15:00:00Z") }, "user_test");
      await createBooking(db, accountId,
        { calendarId: cal.id, contactId: ana, ...at("2027-03-03T15:00:00Z"), rescheduledFromId: first.id }, "user_test");
      const later = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...at("2027-03-04T15:00:00Z") }, "user_test");
      await cancelBookingByToken(db, later.cancelToken);
      await createBooking(db, accountId, { calendarId: cal.id, contactId: luis, ...at("2027-03-05T15:00:00Z") }, "user_test");
      expect(await countContactBookingsMade(db, accountId, ana)).toBe(2);
      expect(await countContactBookingsMade(db, accountId, luis)).toBe(1);
    }));

  it("lists the customer's still-booked bookings from now on, soonest first, capped (mutation: drop .eq('status','booked') -> the cancelled Jan 20 enters, FAILS; mutation: drop .gte('starts_at') -> the past one leads, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const book = async (iso: string) => (await createBooking(db, accountId,
        { calendarId: cal.id, contactId: ana, startsAt: new Date(iso), endsAt: new Date(new Date(iso).getTime() + 3_600_000) }, "user_test"));
      await book("2026-12-31T15:00:00Z"); // before "now"
      const feb = await book("2027-02-01T15:00:00Z");
      const jan15 = await book("2027-01-15T15:00:00Z");
      const mar = await book("2027-03-01T15:00:00Z");
      const cancelled = await book("2027-01-20T15:00:00Z");
      await cancelBookingByToken(db, cancelled.cancelToken);
      await book("2027-04-01T15:00:00Z"); // fourth: past the cap of three
      const rows = await listContactUpcomingBookings(db, accountId, ana, "2027-01-01T00:00:00Z");
      expect(rows.map((r) => r.id)).toEqual([jan15.id, feb.id, mar.id]);
      expect(new Date(rows[0]!.starts_at).toISOString()).toBe("2027-01-15T15:00:00.000Z");
    }));
});
```

- [ ] **Step 2: Add stubs so the file compiles and the tests are red, then typecheck**

Append to `booking.ts`:

```ts
export type UpcomingBooking = { id: string; starts_at: string };
export async function countContactBookingsMade(_db: SupabaseClient, _accountId: string, _contactId: string): Promise<number> {
  return -1;
}
export async function listContactUpcomingBookings(
  _db: SupabaseClient, _accountId: string, _contactId: string, _nowIso: string, _limit = 3,
): Promise<UpcomingBooking[]> {
  return [];
}
```

Run: `cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record && pnpm --filter @bis/db typecheck`
Expected: exits clean. The red run is CI `verify` (see Global Constraints); with the stub, `expect(…).toBe(2)` fails as "expected -1 to be 2".

- [ ] **Step 3: Implement** (replace the stubs)

```ts
/**
 * "Booked {n} times" on a customer's record (S-03 part 1, spec C8/D14): the bookings MADE for one
 * customer, by the SAME definition as `listBookingCreationsBetween` (D-035, the ONE read behind
 * every "bookings" count): a reschedule (`rescheduled_from_id` set) is not a new booking, and a
 * booking cancelled later still counts. An exact head count, never a list. Runs on the caller's
 * client, so RLS (0068's Technician fence) decides what is counted. THROWS on a read error.
 */
export async function countContactBookingsMade(
  db: SupabaseClient, accountId: string, contactId: string,
): Promise<number> {
  const { count, error } = await db.from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("contact_id", contactId)
    .is("rescheduled_from_id", null);
  if (error) throw new Error(`countContactBookingsMade failed: ${error.message}`);
  return count ?? 0;
}

export type UpcomingBooking = { id: string; starts_at: string };

/**
 * The record's "Next up" bookings (S-03 part 1, spec §7): still `booked`, starting at or after
 * `nowIso`, soonest first, at most `limit`. No calendar label: there is one calendar per account
 * (`calendars_one_per_account`, 0016) and it has no name column. THROWS on a read error.
 */
export async function listContactUpcomingBookings(
  db: SupabaseClient, accountId: string, contactId: string, nowIso: string, limit = 3,
): Promise<UpcomingBooking[]> {
  const { data, error } = await db.from("bookings")
    .select("id, starts_at")
    .eq("account_id", accountId).eq("contact_id", contactId).eq("status", "booked")
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true }).order("id", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`listContactUpcomingBookings failed: ${error.message}`);
  return (data ?? []) as UpcomingBooking[];
}
```

Barrel, additive line after `index.ts:87`:

```ts
export { countContactBookingsMade, listContactUpcomingBookings, type UpcomingBooking } from "./booking";
```

- [ ] **Step 4: Typecheck, then mutation probes once CI is green**

Run: `cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record && pnpm --filter @bis/db typecheck`
Expected: clean. Green is `src/test/booking.test.ts` passing in CI `verify`. Probes, for the reviewer to run where PostgREST is available: drop `.is("rescheduled_from_id", null)`, and the first test fails at `expect(…).toBe(2)` with 3. Drop `.eq("status", "booked")`, and the second fails, with `cancelled.id` in the list.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record
git commit -m "feat(booking): per-customer bookings-made count and upcoming bookings for the record page" -- packages/db/src/booking.ts packages/db/src/index.ts packages/db/src/test/booking.test.ts
```

---

### Task 2: The newest non-spam call, per customer (bis-voice)

**Files:**
- Modify: `packages/db/src/voice.ts:937-946` (`listContactCalls`)
- Test: `packages/db/src/test/voice.test.ts` (inside the existing `describe("listContactCalls"` at `:555`)

**Interfaces:**
- Produces: `listContactCalls(db, accountId, contactId, limit = 3, opts: { excludeSpam?: boolean } = {})`. Additive: with no `opts` it behaves exactly as today, so the drawer's `/summary` route (`summary/route.ts`) is unchanged. `voice.ts` is `export *` in the barrel (`index.ts:123`), so there is no barrel edit.

- [ ] **Step 1: Write the failing test** (append inside `describe("listContactCalls", …)`)

```ts
  it("excludeSpam skips a call the receptionist marked spam; without it the call is still listed (S-03 part 1; mutation: ignore opts.excludeSpam -> the spam call comes back first, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const ana = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const seed = async (startedAt: string, outcome: string) => {
        const { data, error } = await db.from("calls").insert({
          account_id: accountId, phone_number_id: num.id, contact_id: ana.id, started_at: startedAt, outcome,
        }).select("id").single();
        if (error || !data) throw new Error(`seed call failed: ${error?.message}`);
        return (data as { id: string }).id;
      };
      const real = await seed("2026-10-01T15:00:00Z", "booked");
      const spam = await seed("2026-10-02T15:00:00Z", "spam");
      expect((await listContactCalls(db, accountId, ana.id, 1)).map((r) => r.id)).toEqual([spam]);
      expect((await listContactCalls(db, accountId, ana.id, 1, { excludeSpam: true })).map((r) => r.id)).toEqual([real]);
    });
  });
```

- [ ] **Step 2: Typecheck red.** Run `cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record && pnpm --filter @bis/db typecheck`. Expected: FAIL with `Expected 3-4 arguments, but got 5`. That is the compile-time red. The runtime red comes in CI after a stub that accepts and ignores `opts`.

- [ ] **Step 3: Implement**

```ts
/** The contact drawer's recent-calls source: newest few for ONE contact. `excludeSpam` is the
 *  record page's "Last talked" read (S-03 part 1, spec §7): a call the receptionist marked spam
 *  is not talking with the customer. */
export async function listContactCalls(
  db: SupabaseClient, accountId: string, contactId: string, limit = 3,
  opts: { excludeSpam?: boolean } = {},
): Promise<{ id: string; started_at: string; outcome: string }[]> {
  let query = db.from("calls")
    .select("id, started_at, outcome")
    .eq("account_id", accountId).eq("contact_id", contactId);
  if (opts.excludeSpam) query = query.neq("outcome", "spam");
  const { data, error } = await query.order("started_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`listContactCalls failed: ${error.message}`);
  return (data ?? []) as { id: string; started_at: string; outcome: string }[];
}
```

- [ ] **Step 4: Typecheck clean; green in CI `verify`.** The probe: ignore `opts.excludeSpam`, and the second `expect` fails with `[spam]`.
- [ ] **Step 5: Commit**

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record
git commit -m "feat(voice): listContactCalls can skip spam calls, for the record page's last-talked fact" -- packages/db/src/voice.ts packages/db/src/test/voice.test.ts
```

---

### Task 3: `contactFacts` and `contactNextUp` (bis-crm)

**Files:**
- Create: `packages/db/src/record.ts`
- Modify: `packages/db/src/index.ts` (append at the end, after the places block `:253-260`)
- Test: `packages/db/src/test/record.test.ts`

**Interfaces:**
- Consumes: `countContactBookingsMade`, `listContactUpcomingBookings`, `UpcomingBooking` (Task 1). `listContactCalls(…, 1, { excludeSpam: true })` (Task 2).
- Produces (exported from `@bis/db`):
  - `type Fact<T> = { ok: true; value: T } | { ok: false }`
  - `type LastTalkedChannel = "text" | "email" | "call"`; `type LastTalked = { at: string; channel: LastTalkedChannel }`
  - `type OpenDeals = { count: number; amount: number | null }`: `amount` is null past the cap.
  - `type ContactFacts = { bookingsMade: Fact<number>; lastTalked: Fact<LastTalked | null>; openDeals: Fact<OpenDeals> }`
  - `type FactName = "bookings" | "talked" | "deals"`; `const OPEN_DEALS_SUM_CAP = 100`
  - `contactFacts(db, accountId, contactId, opts?: { onError?: (name: FactName, e: unknown) => void; openDealsCap?: number }): Promise<ContactFacts>`: **never throws**.
  - `type NextUpTask = { id: string; title: string; due_at: string }`; `type ContactNextUp = { bookings: UpcomingBooking[]; datedTasks: NextUpTask[]; undatedCount: number }`
  - `contactNextUp(db, accountId, contactId, nowIso: string, limit = 3): Promise<ContactNextUp>`: **throws** on a read error (Task 8's loader turns that into the card's error).

**Spec deviation, recorded:** the spec says "each fact is `number | null`, null meaning the read failed". Last talked has three outcomes (a value, none ever, a failed read), and `null` cannot carry both "none" and "failed". So every fact is `Fact<T>`, and "failed" is `{ ok: false }`.

**Not planned, recorded:** the spec's "a Technician's client gets their customer's facts equal to an Owner's" test. `contactFacts` uses supabase-js, and this suite has no way to mint a Technician's PostgREST token (`user-client.integration.test.ts` mints only the one real dev user against Clerk). The fences these reads rely on are already pinned per table at SQL level in `technician-scope.test.ts` (bookings, calls, messages, opportunities, tasks; `:27-28`, `:65-77`). Every read here runs on the request client with no role branch and no service-role fallback.

- [ ] **Step 1: Write the failing tests** (`packages/db/src/test/record.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import "dotenv/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { createContact } from "../contacts";
import { ensureConversation, createMessage } from "../messaging";
import { getOrCreateCalendar, createBooking, cancelBookingByToken } from "../booking";
import { assignPhoneNumber } from "../voice";
import { addTask } from "../activities";
import { ensureDefaultPipeline } from "../crm-config";
import { createOpportunity } from "../opportunities";
import { contactFacts, contactNextUp } from "../record";

const ACTOR = "user_test";
const iso = (v: string) => new Date(v).toISOString();

async function seedMessage(db: SupabaseClient, accountId: string, conversationId: string,
  channel: "email" | "sms" | "form", at: string, status: string) {
  const { id } = await createMessage(db, accountId,
    { conversationId, channel, direction: channel === "form" ? "inbound" : "outbound", body: "x" }, ACTOR);
  const { error } = await db.from("messages").update({ created_at: at, status }).eq("id", id);
  if (error) throw new Error(`seed message failed: ${error.message}`);
}

describe("contactFacts (S-03 part 1, spec §7)", () => {
  it("bookingsMade counts bookings made, not reschedules; a cancelled one still counts (C8/D14)", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, ACTOR);
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const span = (v: string) => ({ startsAt: new Date(v), endsAt: new Date(Date.parse(v) + 3_600_000) });
      const first = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...span("2027-03-02T15:00:00Z") }, ACTOR);
      await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...span("2027-03-03T15:00:00Z"), rescheduledFromId: first.id }, ACTOR);
      const third = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...span("2027-03-04T15:00:00Z") }, ACTOR);
      await cancelBookingByToken(db, third.cancelToken);
      expect((await contactFacts(db, accountId, ana)).bookingsMade).toEqual({ ok: true, value: 2 });
    }));

  it("lastTalked is the newest email/text that did not fail or a call that is not spam; inbox copies never count (mutation: drop the channel filter -> the newer form copy wins, FAILS; drop the status filter -> the failed email wins, FAILS; drop excludeSpam -> the spam call wins, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const { id: conv } = await ensureConversation(db, accountId, ana, ACTOR);
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, ACTOR);
      const call = async (at: string, outcome: string) => {
        const { error } = await db.from("calls").insert({ account_id: accountId, phone_number_id: num.id, contact_id: ana, started_at: at, outcome });
        if (error) throw new Error(`seed call failed: ${error.message}`);
      };
      await seedMessage(db, accountId, conv, "sms", "2026-10-01T15:00:00Z", "delivered");
      await call("2026-10-02T15:00:00Z", "booked");
      await seedMessage(db, accountId, conv, "email", "2026-10-03T15:00:00Z", "failed");
      await seedMessage(db, accountId, conv, "form", "2026-10-05T15:00:00Z", "delivered");
      await call("2026-10-06T15:00:00Z", "spam");
      const f = await contactFacts(db, accountId, ana);
      expect(f.lastTalked.ok).toBe(true);
      const v = (f.lastTalked as { ok: true; value: { at: string; channel: string } }).value;
      expect({ at: iso(v.at), channel: v.channel }).toEqual({ at: "2026-10-02T15:00:00.000Z", channel: "call" });
      await seedMessage(db, accountId, conv, "sms", "2026-10-04T15:00:00Z", "sent");
      const g = (await contactFacts(db, accountId, ana)).lastTalked as { ok: true; value: { at: string; channel: string } };
      expect({ at: iso(g.value.at), channel: g.value.channel }).toEqual({ at: "2026-10-04T15:00:00.000Z", channel: "text" });
    }));

  it("lastTalked is a ready null for a customer nobody has talked to", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      expect((await contactFacts(db, accountId, ana)).lastTalked).toEqual({ ok: true, value: null });
    }));

  it("openDeals counts open deals and sums them; past the cap the amount is left out, never understated (mutation: sum the returned rows past the cap -> amount 300, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      for (const value of [100, 200, 300]) await createOpportunity(db, accountId, { contactId: ana, pipelineId, name: `Deal ${value}`, value }, ACTOR);
      const won = await createOpportunity(db, accountId, { contactId: ana, pipelineId, name: "Won", value: 999 }, ACTOR);
      await db.from("opportunities").update({ status: "won" }).eq("id", won.id);
      expect((await contactFacts(db, accountId, ana)).openDeals).toEqual({ ok: true, value: { count: 3, amount: 600 } });
      expect((await contactFacts(db, accountId, ana, { openDealsCap: 2 })).openDeals).toEqual({ ok: true, value: { count: 3, amount: null } });
    }));

  it("a failed read is reported by name and never thrown; the other facts still load (mutation: let settle rethrow -> contactFacts rejects, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const broken = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === "from") return (table: string) => target.from(table === "opportunities" ? "no_such_table_s03" : table);
          return Reflect.get(target, prop, receiver);
        },
      }) as SupabaseClient;
      const onError = vi.fn();
      const f = await contactFacts(broken, accountId, ana, { onError });
      expect(f.openDeals).toEqual({ ok: false });
      expect(f.bookingsMade).toEqual({ ok: true, value: 0 });
      expect(onError).toHaveBeenCalledWith("deals", expect.anything());
    }));
});

describe("contactNextUp (S-03 part 1, spec §7, C9)", () => {
  it("bookings still ahead and open dated To-dos soonest first, plus a count of open undated ones (mutation: drop .is('completed_at', null) -> the done To-do enters, FAILS; drop the due_at not-null filter -> an undated To-do enters, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, ACTOR);
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const book = (v: string) => createBooking(db, accountId, { calendarId: cal.id, contactId: ana, startsAt: new Date(v), endsAt: new Date(Date.parse(v) + 3_600_000) }, ACTOR);
      const soon = await book("2026-10-14T15:00:00Z");
      const later = await book("2026-10-30T15:00:00Z");
      await book("2026-10-05T15:00:00Z"); // before nowIso
      const gone = await book("2026-10-13T15:00:00Z");
      await cancelBookingByToken(db, gone.cancelToken);
      const task = (title: string, dueAt?: string) => addTask(db, accountId, { contactId: ana, title, dueAt }, ACTOR);
      const overdue = await task("Call back", "2026-10-01T05:00:00Z");
      const done = await task("Done one", "2026-10-02T05:00:00Z");
      await db.from("tasks").update({ completed_at: "2026-10-03T00:00:00Z" }).eq("id", done.id);
      const due20 = await task("Quote", "2026-10-20T05:00:00Z");
      const due25 = await task("Order parts", "2026-10-25T05:00:00Z");
      await task("Someday");
      await task("Someday too");
      const n = await contactNextUp(db, accountId, ana, "2026-10-12T15:00:00Z");
      expect(n.bookings.map((b) => b.id)).toEqual([soon.id, later.id]);
      expect(n.datedTasks.map((t) => t.id)).toEqual([overdue.id, due20.id, due25.id]);
      expect(n.undatedCount).toBe(2);
    }));
});
```

- [ ] **Step 2: Create the stub file so it compiles; tests red.** Create `record.ts` with the exports above returning `{ bookingsMade: { ok: false }, lastTalked: { ok: false }, openDeals: { ok: false } }` and `{ bookings: [], datedTasks: [], undatedCount: -1 }`. Run `cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record && pnpm --filter @bis/db typecheck`; expect it clean. The red is CI's: the stubs fail every `toEqual`.

- [ ] **Step 3: Implement** `packages/db/src/record.ts`

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { countContactBookingsMade, listContactUpcomingBookings, type UpcomingBooking } from "./booking";
import { listContactCalls } from "./voice";

/**
 * The contact record page's checked facts and "Next up" (S-03 part 1, 1a; spec §7). Exact head
 * counts and one-row reads, never a list. Every read runs on the caller's client, so RLS
 * (0068's Technician fences included) decides what is counted; there is no role branch here.
 */
export type Fact<T> = { ok: true; value: T } | { ok: false };
export type LastTalkedChannel = "text" | "email" | "call";
export type LastTalked = { at: string; channel: LastTalkedChannel };
export type OpenDeals = { count: number; amount: number | null };
export type ContactFacts = { bookingsMade: Fact<number>; lastTalked: Fact<LastTalked | null>; openDeals: Fact<OpenDeals> };
export type FactName = "bookings" | "talked" | "deals";
/** Past this many open deals the summary leaves the amount out rather than understate it. */
export const OPEN_DEALS_SUM_CAP = 100;

async function settle<T>(name: FactName, read: () => Promise<T>, onError?: (name: FactName, e: unknown) => void): Promise<Fact<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (e) {
    onError?.(name, e);
    return { ok: false };
  }
}

/** The newest email or text with this customer that did not fail. `form` and `voice` rows are the
 *  inbox's copies of a submission, a booking change or a call (spec C4); they are not talking. */
async function newestConversationMessage(db: SupabaseClient, accountId: string, contactId: string): Promise<LastTalked | null> {
  const { data: convo, error } = await db.from("conversations").select("id")
    .eq("account_id", accountId).eq("contact_id", contactId).maybeSingle();
  if (error) throw new Error(`newestConversationMessage failed: ${error.message}`);
  if (!convo) return null;
  const { data, error: mErr } = await db.from("messages").select("channel, created_at")
    .eq("account_id", accountId).eq("conversation_id", (convo as { id: string }).id)
    .in("channel", ["email", "sms"]).not("status", "in", "(failed,bounced)")
    .order("created_at", { ascending: false }).limit(1);
  if (mErr) throw new Error(`newestConversationMessage failed: ${mErr.message}`);
  const row = ((data ?? []) as { channel: "email" | "sms"; created_at: string }[])[0];
  return row ? { at: row.created_at, channel: row.channel === "sms" ? "text" : "email" } : null;
}

async function lastTalked(db: SupabaseClient, accountId: string, contactId: string): Promise<LastTalked | null> {
  const [message, calls] = await Promise.all([
    newestConversationMessage(db, accountId, contactId),
    listContactCalls(db, accountId, contactId, 1, { excludeSpam: true }),
  ]);
  const call: LastTalked | null = calls[0] ? { at: calls[0].started_at, channel: "call" } : null;
  if (!message) return call;
  if (!call) return message;
  return Date.parse(call.at) > Date.parse(message.at) ? call : message;
}

async function openDeals(db: SupabaseClient, accountId: string, contactId: string, cap: number): Promise<OpenDeals> {
  const { data, count, error } = await db.from("opportunities").select("monetary_value", { count: "exact" })
    .eq("account_id", accountId).eq("contact_id", contactId).eq("status", "open")
    .order("id", { ascending: true }).limit(cap);
  if (error) throw new Error(`openDeals failed: ${error.message}`);
  const rows = (data ?? []) as { monetary_value: number | string }[];
  const total = count ?? rows.length;
  if (total > rows.length) return { count: total, amount: null };
  return { count: total, amount: rows.reduce((sum, r) => sum + Number(r.monetary_value), 0) };
}

/** Never throws: a failed read is that fact's `{ ok: false }`, named to `onError` for the log. */
export async function contactFacts(
  db: SupabaseClient, accountId: string, contactId: string,
  opts: { onError?: (name: FactName, e: unknown) => void; openDealsCap?: number } = {},
): Promise<ContactFacts> {
  const cap = opts.openDealsCap ?? OPEN_DEALS_SUM_CAP;
  const [bookingsMade, talked, deals] = await Promise.all([
    settle("bookings", () => countContactBookingsMade(db, accountId, contactId), opts.onError),
    settle("talked", () => lastTalked(db, accountId, contactId), opts.onError),
    settle("deals", () => openDeals(db, accountId, contactId, cap), opts.onError),
  ]);
  return { bookingsMade, lastTalked: talked, openDeals: deals };
}

export type NextUpTask = { id: string; title: string; due_at: string };
export type ContactNextUp = { bookings: UpcomingBooking[]; datedTasks: NextUpTask[]; undatedCount: number };

/**
 * "Next up" (spec §9.3, C9): bookings still ahead, open To-dos WITH a due date (overdue ones sort
 * first because they are earliest), and a head count of open To-dos with none. An undated To-do has
 * no "next" to sort by, so it is counted, never listed. THROWS on a read error.
 */
export async function contactNextUp(
  db: SupabaseClient, accountId: string, contactId: string, nowIso: string, limit = 3,
): Promise<ContactNextUp> {
  const [bookings, dated, undated] = await Promise.all([
    listContactUpcomingBookings(db, accountId, contactId, nowIso, limit),
    db.from("tasks").select("id, title, due_at")
      .eq("account_id", accountId).eq("contact_id", contactId)
      .is("completed_at", null).not("due_at", "is", null)
      .order("due_at", { ascending: true }).order("id", { ascending: true }).limit(limit),
    db.from("tasks").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("contact_id", contactId)
      .is("completed_at", null).is("due_at", null),
  ]);
  if (dated.error) throw new Error(`contactNextUp To-dos failed: ${dated.error.message}`);
  if (undated.error) throw new Error(`contactNextUp undated count failed: ${undated.error.message}`);
  return { bookings, datedTasks: (dated.data ?? []) as NextUpTask[], undatedCount: undated.count ?? 0 };
}
```

Barrel (append at the end of `index.ts`):

```ts
// The contact record page's facts and Next up (S-03 part 1). See ./record.ts.
export {
  contactFacts, contactNextUp, OPEN_DEALS_SUM_CAP,
  type Fact, type ContactFacts, type LastTalked, type LastTalkedChannel, type OpenDeals, type FactName,
  type ContactNextUp, type NextUpTask,
} from "./record";
```

- [ ] **Step 4: Typecheck clean.** Run `cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record && pnpm --filter @bis/db typecheck`. **The orchestrator pushes after this task**; green is `src/test/record.test.ts` in CI `verify`. Report the probes as written in each test name.
- [ ] **Step 5: Commit**

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record
git add -- packages/db/src/record.ts packages/db/src/test/record.test.ts
git commit -m "feat(contacts): contactFacts and contactNextUp, the record page's read-only facts (no migration)" -- packages/db/src/record.ts packages/db/src/test/record.test.ts packages/db/src/index.ts
```

---

### Task 4: The record kit, its styleguide entries and the two DESIGN.md sentences (bis-frontend)

**messages.ts: this task goes FIRST; Task 5 waits for its commit.**

**Files:**
- Create: `apps/web/src/components/record/use-phone.ts`, `record-card-boundary.tsx`, `record-card.tsx`, `record-layout.tsx`, `record-header.tsx`
- Test: `apps/web/src/components/record/record-card.test.ts`, `record-card-boundary.test.ts`, `record-layout.test.ts`, `record-header.test.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/styleguide/record-demo.tsx`, `record-demo.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx` (a `Section` after the Properties section, `:256-258`)
- Modify: `apps/web/src/lib/messages.ts` (append four keys + twins)
- Modify: `DESIGN.md` (two sentences, §16.1 of the spec)

**Interfaces:**
- Produces:
  - `use-phone.ts`: `PHONE_QUERY = "(max-width: 767px)"`; `usePhone(): boolean` (`useSyncExternalStore`; the server snapshot is `true`, phone-first: see the decision note below).
  - `record-card-boundary.tsx`: `class RecordCardBoundaryCore` (props `{ fallback: (reset: () => void) => ReactNode; onReset: () => void; children: ReactNode }`); `RecordCardBoundary({ fallback, skeleton, children }: { fallback: (reset: () => void) => ReactNode; skeleton: ReactNode; children: ReactNode })`.
  - `record-card.tsx`: `type RecordCardState = "loading" | "ready" | "empty" | "error"`; `RecordCardSkeleton({ rows }: { rows: number })`; `RecordCardRetry({ label, onRetry? })`; `RecordCardError({ text, retryLabel, onRetry? })`; `RecordCardView(props: RecordCardViewProps)`; `RecordCard(props: RecordCardProps)`, where `RecordCardProps = { id: string; title: string; collapsibleOnPhone?: boolean; state?: RecordCardState; skeletonRows?: number; errorText?: string; onRetry?: () => void; action?: ReactNode; children?: ReactNode }`.
  - `record-layout.tsx`: `type RecordColumn = "who" | "happening" | "have"`; `type RecordLayoutColumn = { column: RecordColumn; content: ReactNode }`; `RecordLayout({ header, columns, skipLabel, lang? })`.
  - `record-header.tsx`: `type RecordHeaderAction = { id: string; label: string; href: string; ariaLabel?: string; primary?: boolean; external?: boolean }`; `RecordHeader({ name, subtitle?, back: { href: string; label: string }, actions: RecordHeaderAction[] })`.
  - Copy keys (Step 3): the kit's `record.skipToDetails`, `record.card.retry|show|failed`, plus what the styleguide demo shows: `record.back`, `record.group.*`, `record.action.*`, `record.card.summary|nextUp|activity|deals`, `record.facts.openDeals|openDealsOne`, `styleguide.recordKit`. Task 5 adds the rest of the 1a table.

**Decisions recorded for the reviewer:**
1. **Phone-first server snapshot.** "A closed card fetches nothing" (spec §8) means a collapsible card's body must not mount before the client knows it is on a desk. If the server snapshot were "desk", a phone would hydrate the bodies and fire their fetches before closing them. So the server renders the three "have" cards closed, and a desk opens them right after hydration. **Cost:** on a desk the three "have" cards show their titles only until hydration. Their bodies (Groups, Properties) fetch client-side anyway, and Deals is already in the RSC payload. A follow-up could seed the snapshot from the `Sec-CH-UA-Mobile` hint; it is not in 1a.
2. **`record.card.failed`** ("Couldn't load {title}.") is added to the spec's §10.1 table. A card with no failure copy of its own still needs an error state: Deals, Details, Tags, and any card whose render throws.
3. **Grid placement, not `grid-template-areas`.** The three "named areas" are `col-start-1/2/3 row-start-2` under `@min-[1024px]:`. Same tracks as today, `320px minmax(0,1fr) 280px` (`[contactId]/page.tsx:132`). This avoids quoted arbitrary values in class names.

- [ ] **Step 1: Write the failing kit tests**

`apps/web/src/components/record/record-card-boundary.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { RecordCardBoundary, RecordCardBoundaryCore } = await import("./record-card-boundary");

function Boom(): never { throw new Error("card render failed"); }
const fallback = () => createElement("p", null, "fell back");

describe("RecordCardBoundary (spec C5): one card's render throw never blanks the page", () => {
  it("on the server, a throw inside renders that card's skeleton and its siblings still render (mutation: drop the Suspense -> renderToStaticMarkup throws, FAILS)", () => {
    const html = renderToStaticMarkup(createElement("div", null,
      createElement(RecordCardBoundary, { fallback, skeleton: createElement("i", { "data-record-skeleton": "" }) }, createElement(Boom)),
      createElement("p", null, "sibling card")));
    expect(html).toContain("data-record-skeleton");
    expect(html).toContain("sibling card");
  });

  it("on the client, a caught error shows the fallback, and its reset clears the error and asks for a refresh (mutation: render children when failed -> FAILS)", () => {
    expect(RecordCardBoundaryCore.getDerivedStateFromError()).toEqual({ failed: true });
    const onReset = vi.fn();
    const core = new RecordCardBoundaryCore({ fallback, onReset, children: createElement("p", null, "body") });
    core.state = { failed: true };
    expect(renderToStaticMarkup(createElement("div", null, core.render()))).toContain("fell back");
    const setState = vi.spyOn(core, "setState").mockImplementation(() => {});
    core.reset();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenCalledWith({ failed: false });
  });
});
```

`apps/web/src/components/record/record-card.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { RecordCard, RecordCardView } = await import("./record-card");
const { m } = await import("@/lib/messages");

const view = (over: Partial<ComponentProps<typeof RecordCardView>> = {}, children: unknown = null) =>
  renderToStaticMarkup(createElement(RecordCardView, {
    id: "deals", title: "Deals", state: "ready", skeletonRows: 2, errorText: "Couldn't load Deals.",
    retryLabel: "Try again", showLabel: "Show Deals", disclosure: false, open: false, onToggle: () => {},
    ...over,
  }, children as never));

describe("RecordCard (spec §8): one chrome, its own states, a phone disclosure", () => {
  it("a closed phone card shows its title as a disclosure and mounts no body, so it fetches nothing (mutation: render the body hidden instead of not mounting it -> the body renders, FAILS)", () => {
    const body = vi.fn(() => createElement("p", null, "deal rows"));
    const html = view({ disclosure: true, open: false }, createElement(body));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Show Deals"');
    expect(body).not.toHaveBeenCalled();
    expect(html).not.toContain("deal rows");
  });

  it("an open disclosure says so and mounts the body (mutation: hard-code aria-expanded false -> FAILS)", () => {
    const html = view({ disclosure: true, open: true }, createElement("p", null, "deal rows"));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("deal rows");
  });

  it("not a disclosure: a plain title and the body (desk, or a card that never collapses)", () => {
    const html = view({}, createElement("p", null, "deal rows"));
    expect(html).not.toContain("aria-expanded");
    expect(html).toMatch(/<h2[^>]*>.*Deals/);
    expect(html).toContain("deal rows");
  });

  it("loading is a skeleton shaped like rows, never a spinner (rule 7)", () => {
    const html = view({ state: "loading" }, createElement("p", null, "deal rows"));
    expect(html.match(/data-slot="skeleton"/g)).toHaveLength(2);
    expect(html).not.toContain("deal rows");
    expect(html).not.toMatch(/animate-spin/);
  });

  it("error is the card's own sentence and Try again, the body not rendered (mutation: render children on error -> FAILS)", () => {
    const html = view({ state: "error" }, createElement("p", null, "deal rows"));
    expect(html).toContain("Couldn&#x27;t load Deals.");
    expect(html).toContain(">Try again<");
    expect(html).not.toContain("deal rows");
  });

  it("RecordCard on the server: a collapsible card renders closed (phone-first), a fixed one open (mutation: server snapshot false -> the collapsible body renders, FAILS)", () => {
    const body = vi.fn(() => createElement("p", null, "body"));
    const closed = renderToStaticMarkup(createElement(RecordCard, { id: "groups", title: "Groups", collapsibleOnPhone: true }, createElement(body)));
    expect(closed).toContain('aria-expanded="false"');
    expect(body).not.toHaveBeenCalled();
    const open = renderToStaticMarkup(createElement(RecordCard, { id: "details", title: "Details" }, createElement("p", null, "fields")));
    expect(open).toContain('data-record-card="details"');
    expect(open).not.toContain("aria-expanded");
    expect(open).toContain("fields");
  });

  it("RecordCard's own words come from the catalogue: the default error names the card", () => {
    const html = renderToStaticMarkup(createElement(RecordCard, { id: "deals", title: "Deals", state: "error" }));
    expect(html).toContain(m["record.card.failed"].replace("{title}", "Deals").replace("'", "&#x27;"));
    expect(html).toContain(`>${m["record.card.retry"]}<`);
  });
});
```

`apps/web/src/components/record/record-layout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordLayout } from "./record-layout";

const html = renderToStaticMarkup(createElement(RecordLayout, {
  header: createElement("header", { "data-h": "" }, "Ana"),
  skipLabel: "Skip to details",
  lang: "es",
  columns: [
    { column: "happening", content: createElement("p", null, "timeline") },
    { column: "have", content: createElement("p", null, "deals") },
    { column: "who", content: createElement("p", null, "details") },
  ],
}));

describe("RecordLayout (spec §8, C6): DOM order is the phone order", () => {
  it("keeps the columns in the order given, after the header; the desk placement is CSS only (mutation: sort columns into desk order who, happening, have -> FAILS)", () => {
    const order = [...html.matchAll(/data-record-column="(\w+)"/g)].map((x) => x[1]);
    expect(order).toEqual(["happening", "have", "who"]);
    expect(html.indexOf("data-h")).toBeLessThan(html.indexOf('data-record-column="happening"'));
  });

  it("a skip link goes straight to the who column, which can take focus (mutation: point it at #record-happening -> FAILS)", () => {
    expect(html).toMatch(/<a[^>]*href="#record-who"[^>]*>Skip to details<\/a>/);
    expect(html).toMatch(/id="record-who"[^>]*tabindex="-1"|tabindex="-1"[^>]*id="record-who"/);
  });

  it("is a container-query grid with today's tracks, and carries the page's lang", () => {
    expect(html).toContain("@container");
    expect(html).toContain("@min-[1024px]:grid-cols-[320px_minmax(0,1fr)_280px]");
    expect(html).toMatch(/data-record-layout[^>]*lang="es"|lang="es"[^>]*data-record-layout/);
  });
});
```

`apps/web/src/components/record/record-header.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordHeader } from "./record-header";

const render = (actions: Parameters<typeof RecordHeader>[0]["actions"], subtitle: string | null = "García family · Household") =>
  renderToStaticMarkup(createElement(RecordHeader, {
    name: "Ana García", subtitle, back: { href: "/dashboard/accounts/a1/contacts", label: "Contacts" }, actions,
  }));

const ALL = [
  { id: "call", label: "Call", href: "tel:+19565550100", ariaLabel: "Call Ana García", primary: true },
  { id: "text", label: "Text", href: "#compose-sms" },
  { id: "email", label: "Email", href: "#compose-email" },
  { id: "directions", label: "Directions", href: "https://www.google.com/maps/search/?api=1&query=x", external: true },
];

describe("RecordHeader (spec §9.1)", () => {
  it("the name is the page's one h1, truncating with its full text in title", () => {
    const html = render(ALL);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*title="Ana García"[^>]*>Ana García<\/h1>/);
  });

  it("renders the actions in the order given, exactly one primary (mutation: render every action primary -> FAILS)", () => {
    const html = render(ALL);
    expect([...html.matchAll(/data-record-action="(\w+)"/g)].map((x) => x[1])).toEqual(["call", "text", "email", "directions"]);
    expect(html.match(/data-variant="default"/g)).toHaveLength(1);
    expect(html).toMatch(/data-variant="default"[^>]*data-record-action="call"|data-record-action="call"[^>]*data-variant="default"/);
  });

  it("Directions opens a new tab without a referrer; Call carries its aria-label", () => {
    const html = render(ALL);
    expect(html).toMatch(/target="_blank"[^>]*rel="noreferrer"|rel="noreferrer"[^>]*target="_blank"/);
    expect(html).toContain('aria-label="Call Ana García"');
  });

  it("no actions: no action row at all; no group: no subtitle line", () => {
    const html = render([], null);
    expect(html).not.toContain("data-record-actions");
    expect(html).not.toContain("data-record-subtitle");
    expect(html).toContain('href="/dashboard/accounts/a1/contacts"');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record && pnpm --filter web exec vitest run src/components/record`
Expected: FAIL, with every file reporting `Failed to load url ./record-card-boundary` (and its siblings). Then create each file as an empty export stub (`export function RecordHeader() { return null; }`, and so on), re-run, and paste one real failing assertion line, such as `expected [] to deeply equal [ 'happening', 'have', 'who' ]`.

- [ ] **Step 3: Add the kit copy** (append to `messages.ts` above `} as const;`). These are the kit's own words, plus the header, card-title and open-deal keys the styleguide demo (Step 6) renders. Task 5 appends the rest of the 1a table and **must not repeat any key below** (a duplicate key in the object literal is `TS1117`).

```ts
  // S-03 part 1 (1a): the contact record page (spec §10.1). Usted, trades Spanish. This first block
  // is the kit's own words and what the styleguide demo shows; plan Task 5 appends the rest.
  // record.card.failed is added to the spec's table: a card with no failure sentence of its own
  // (plan Task 4, decision 2). The open-deal keys carry the count only: the amount is its own
  // segment, left out at zero or past the cap (plan Task 5).
  "record.skipToDetails": "Skip to details",
  "record.skipToDetails.es": "Ir a los datos",
  "record.card.retry": "Try again",
  "record.card.retry.es": "Intentar de nuevo",
  "record.card.show": "Show {title}",
  "record.card.show.es": "Mostrar {title}",
  "record.card.failed": "Couldn't load {title}.",
  "record.card.failed.es": "No se pudo cargar: {title}.",
  "record.back": "Contacts",
  "record.back.es": "Contactos",
  "record.group.household": "{group} · Household",
  "record.group.household.es": "{group} · Hogar",
  "record.group.business": "{group} · Business",
  "record.group.business.es": "{group} · Negocio",
  "record.action.call": "Call",
  "record.action.call.es": "Llamar",
  "record.action.callAria": "Call {name}",
  "record.action.callAria.es": "Llamar a {name}",
  "record.action.text": "Text",
  "record.action.text.es": "Mandar texto",
  "record.action.email": "Email",
  "record.action.email.es": "Mandar correo",
  "record.action.directions": "Directions",
  "record.action.directions.es": "Cómo llegar",
  "record.card.summary": "Summary",
  "record.card.summary.es": "Resumen",
  "record.card.nextUp": "Next up",
  "record.card.nextUp.es": "Lo que sigue",
  "record.card.activity": "Activity",
  "record.card.activity.es": "Actividad",
  "record.card.deals": "Deals",
  "record.card.deals.es": "Oportunidades",
  "record.facts.openDeals": "{count} open deals",
  "record.facts.openDeals.es": "{count} oportunidades abiertas",
  "record.facts.openDealsOne": "1 open deal",
  "record.facts.openDealsOne.es": "1 oportunidad abierta",
  "styleguide.recordKit": "Record kit",
  "styleguide.recordKit.es": "Ficha del cliente",
```

- [ ] **Step 4: Implement the kit**

`apps/web/src/components/record/use-phone.ts`:

```ts
"use client";

import { useSyncExternalStore } from "react";

/** A phone, for the record page's disclosures (spec §8, D6). Tailwind's `md` is 768px. */
export const PHONE_QUERY = "(max-width: 767px)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * True on a phone. The SERVER snapshot is `true` (phone-first) on purpose: a collapsible card's
 * body must not mount, and so must not fetch, before the client knows it is on a desk (spec §8,
 * "a closed card fetches nothing"). A desk opens those cards right after hydration.
 */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE_QUERY).matches, () => true);
}
```

`apps/web/src/components/record/record-card-boundary.tsx`:

```tsx
"use client";

import { Component, Suspense, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { loggableError } from "@/lib/loggable-error";

type CoreProps = { fallback: (reset: () => void) => ReactNode; onReset: () => void; children: ReactNode };

/** The client half: catches a card's render-time throw and shows that card's error state. */
export class RecordCardBoundaryCore extends Component<CoreProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: unknown): void {
    console.error(`record page: a card failed to render: ${loggableError(error)}`);
  }
  reset = (): void => {
    this.props.onReset();
    this.setState({ failed: false });
  };
  render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.reset) : this.props.children;
  }
}

/**
 * One per card (spec C5, DESIGN.md "Record page": one card's fault never blanks the page).
 * React's server renderer does not run class error boundaries, so the Suspense is what keeps a
 * server-render throw inside this card: it renders `skeleton` there and the client retries, where
 * the core catches it. Verified on React 19.2.4 (plan, Global Constraints).
 */
export function RecordCardBoundary({ fallback, skeleton, children }: {
  fallback: (reset: () => void) => ReactNode; skeleton: ReactNode; children: ReactNode;
}) {
  const router = useRouter();
  return (
    <RecordCardBoundaryCore fallback={fallback} onReset={() => router.refresh()}>
      <Suspense fallback={skeleton}>{children}</Suspense>
    </RecordCardBoundaryCore>
  );
}
```

`apps/web/src/components/record/record-card.tsx`:

```tsx
"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { usePhone } from "./use-phone";
import { RecordCardBoundary } from "./record-card-boundary";

export type RecordCardState = "loading" | "ready" | "empty" | "error";

/** Rule 7: rows shaped like the content, never a spinner. */
export function RecordCardSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2" data-record-skeleton aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn("h-4 rounded-[var(--radius-ctl)]", i % 2 === 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** "Try again": re-reads the server page unless the caller retries something narrower. */
export function RecordCardRetry({ label, onRetry }: { label: string; onRetry?: () => void }) {
  const router = useRouter();
  return (
    <Button type="button" size="sm" variant="ghost" className="min-h-11 md:min-h-8" onClick={onRetry ?? (() => router.refresh())}>
      {label}
    </Button>
  );
}

export function RecordCardError({ text, retryLabel, onRetry }: { text: string; retryLabel: string; onRetry?: () => void }) {
  return (
    <div role="status" className="space-y-2 text-sm" data-record-error>
      <p className="text-muted-foreground">{text}</p>
      <RecordCardRetry label={retryLabel} onRetry={onRetry} />
    </div>
  );
}

export type RecordCardViewProps = {
  id: string; title: string; state: RecordCardState; skeletonRows: number; errorText: string;
  retryLabel: string; showLabel: string;
  /** A phone disclosure (collapsible card on a phone); `open` is its state. */
  disclosure: boolean; open: boolean; onToggle: () => void;
  onRetry?: () => void; action?: ReactNode; children?: ReactNode;
};

/**
 * The one card chrome (spec §8): glass, a title in UI 600 at 13.5px, rows split by --row-line
 * rules inside, never a box in a glass card. A closed disclosure mounts NO body.
 */
export function RecordCardView(p: RecordCardViewProps) {
  const titleId = useId();
  const bodyId = useId();
  const closed = p.disclosure && !p.open;
  return (
    <section data-record-card={p.id} data-state={p.state} aria-labelledby={titleId}
      className="min-w-0 rounded-xl border border-border bg-card glass px-4 pt-3.5 pb-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="min-w-0 flex-1 text-[13.5px] font-semibold text-card-foreground">
          {p.disclosure ? (
            <button type="button" aria-expanded={p.open} aria-controls={bodyId}
              aria-label={closed ? p.showLabel : undefined} onClick={p.onToggle}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-[var(--radius-ctl)] text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <span className="truncate" title={p.title}>{p.title}</span>
              <ChevronDown aria-hidden className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                p.open && "rotate-180")} />
            </button>
          ) : (
            <span className="block truncate" title={p.title}>{p.title}</span>
          )}
        </h2>
        {!closed && p.action ? p.action : null}
      </div>
      {closed ? null : (
        <div id={bodyId} className="mt-2">
          {p.state === "loading" ? (
            <RecordCardSkeleton rows={p.skeletonRows} />
          ) : p.state === "error" ? (
            <RecordCardError text={p.errorText} retryLabel={p.retryLabel} onRetry={p.onRetry} />
          ) : (
            <RecordCardBoundary
              skeleton={<RecordCardSkeleton rows={p.skeletonRows} />}
              fallback={(reset) => <RecordCardError text={p.errorText} retryLabel={p.retryLabel} onRetry={reset} />}
            >
              {p.children}
            </RecordCardBoundary>
          )}
        </div>
      )}
    </section>
  );
}

export type RecordCardProps = {
  id: string; title: string; collapsibleOnPhone?: boolean; state?: RecordCardState; skeletonRows?: number;
  errorText?: string; onRetry?: () => void; action?: ReactNode; children?: ReactNode;
};

/** A record card: the chrome, its own boundary, and (when `collapsibleOnPhone`) a phone disclosure. */
export function RecordCard({ id, title, collapsibleOnPhone = false, state = "ready", skeletonRows = 3,
  errorText, onRetry, action, children }: RecordCardProps) {
  const locale = useLocale();
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  return (
    <RecordCardView id={id} title={title} state={state} skeletonRows={skeletonRows}
      errorText={errorText ?? t(m, "record.card.failed", locale, { title })}
      retryLabel={t(m, "record.card.retry", locale)} showLabel={t(m, "record.card.show", locale, { title })}
      disclosure={collapsibleOnPhone && phone} open={open} onToggle={() => setOpen((o) => !o)}
      onRetry={onRetry} action={action}>
      {children}
    </RecordCardView>
  );
}
```

`apps/web/src/components/record/record-layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type RecordColumn = "who" | "happening" | "have";
export type RecordLayoutColumn = { column: RecordColumn; content: ReactNode };

/** The desk placement of each column (spec §8). Below 1024px of CONTAINER width: one column, DOM order. */
const PLACE: Record<RecordColumn, string> = {
  who: "@min-[1024px]:col-start-1 @min-[1024px]:row-start-2",
  happening: "@min-[1024px]:col-start-2 @min-[1024px]:row-start-2",
  have: "@min-[1024px]:col-start-3 @min-[1024px]:row-start-2",
};

/**
 * The record page's desk (spec §8, C6). DOM order is the phone order. On a desk the columns are
 * PLACED (who | happening | have) without reordering the DOM, so keyboard and screen-reader order
 * keep the page's priority. The "who" column comes last in the DOM, so a skip link leads to it.
 */
export function RecordLayout({ header, columns, skipLabel, lang }: {
  header: ReactNode; columns: RecordLayoutColumn[]; skipLabel: string; lang?: string;
}) {
  return (
    <div data-record-layout lang={lang} className="@container">
      <a href="#record-who"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-[var(--radius-ctl)] focus:bg-[var(--surface-3)] focus:px-3 focus:py-2 focus:text-sm focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {skipLabel}
      </a>
      <div className="grid gap-4 p-6 @min-[1024px]:grid-cols-[320px_minmax(0,1fr)_280px] @min-[1024px]:items-start">
        <div className="min-w-0 @min-[1024px]:col-span-3">{header}</div>
        {columns.map(({ column, content }) => (
          <div key={column} id={`record-${column}`} data-record-column={column}
            tabIndex={column === "who" ? -1 : undefined}
            className={cn("min-w-0 space-y-4 outline-none", PLACE[column])}>
            {content}
          </div>
        ))}
      </div>
    </div>
  );
}
```

`apps/web/src/components/record/record-header.tsx`:

```tsx
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export type RecordHeaderAction = {
  id: string; label: string; href: string; ariaLabel?: string; primary?: boolean; external?: boolean;
};

/**
 * The record page's header (spec §9.1). The name is the page's h1 (Display 600, 22px). Under it,
 * muted, the main group as plain text (C7). The actions follow in the order given, with the one
 * primary first on every width; each is at least 44px tall, and they wrap rather than clip.
 */
export function RecordHeader({ name, subtitle, back, actions }: {
  name: string; subtitle?: string | null; back: { href: string; label: string }; actions: RecordHeaderAction[];
}) {
  return (
    <header data-record-header className="min-w-0 space-y-1.5">
      <Link href={back.href}
        className="inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-ctl)] text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8">
        <ChevronLeft className="size-4" aria-hidden />
        {back.label}
      </Link>
      <h1 title={name} className="truncate text-[22px] font-display font-[600] tracking-[-0.02em] text-card-foreground">{name}</h1>
      {subtitle ? <p data-record-subtitle className="text-sm text-muted-foreground">{subtitle}</p> : null}
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

- [ ] **Step 5: Run the kit tests to see them pass**

Run: `cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record && pnpm --filter web exec vitest run src/components/record`
Expected: `Test Files  4 passed (4)`. Run each named probe (drop the `Suspense`; render the closed body hidden; sort the columns), and paste the failing line for each.

- [ ] **Step 6: Styleguide entries.** Write the test first (`record-demo.test.ts`):

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { RecordDemo } = await import("./record-demo");

describe("styleguide: the record kit (DoD: /styleguide gains the new components; spec §15)", () => {
  const html = renderToStaticMarkup(createElement(RecordDemo));
  it("RecordLayout at a desk width and a phone width", () => {
    expect(html.match(/data-record-layout/g)).toHaveLength(2);
  });
  it("RecordHeader with every action and with none", () => {
    expect(html.match(/data-record-header/g)).toHaveLength(2);
    expect(html.match(/data-record-actions/g)).toHaveLength(1);
  });
  it("RecordCard loading, ready, empty, error and closed on a phone (mutation: drop a state -> FAILS)", () => {
    for (const s of ["loading", "ready", "empty", "error"]) expect(html).toContain(`data-sg-record-card="${s}"`);
    expect(html).toContain('data-sg-record-card="closed"');
    expect(html).toContain('aria-expanded="false"');
  });
});
```

Then `record-demo.tsx`. **Every visible string comes from the catalogue.** `record-demo.tsx` is a new file, so the ratchet allows it **zero** raw JSX text or copy attributes (`title`, `aria-label`, `label`, … — `ratchet.test.ts`, "fails a NEW file … with any count at all"). `title=` IS a copy attribute, so card titles are `m[…]` expressions, never literals. Non-copy props (`errorText`, `retryLabel`, `showLabel`, `skipLabel`, `subtitle`, `name`) and strings inside object literals are not scanned, and they still read from `m` where a key exists.

```tsx
"use client";

import { RecordCardView } from "@/components/record/record-card";
import { RecordHeader } from "@/components/record/record-header";
import { RecordLayout } from "@/components/record/record-layout";
import { m, type MessageKey } from "@/lib/messages";

/**
 * The record kit (S-03 part 1, spec §15) in every state, for the styleguide: the layout at a desk
 * and a phone width (the grid is a CONTAINER query, so a narrow box shows the phone order), the
 * header with all and with no actions, and a card in each state. Specimen words come from the
 * catalogue, so this file adds nothing to the i18n ratchet.
 */
const DEALS = m["record.card.deals"];
const failedText = (title: string) => m["record.card.failed"].replace("{title}", title);
const showText = (title: string) => m["record.card.show"].replace("{title}", title);

const card = (sg: string, over: Partial<Parameters<typeof RecordCardView>[0]> = {}, body: React.ReactNode = <p className="text-sm">{m["record.facts.openDealsOne"]}</p>) => (
  <div data-sg-record-card={sg} className="w-[280px]">
    <RecordCardView id={`sg-${sg}`} title={DEALS} state="ready" skeletonRows={3} errorText={failedText(DEALS)}
      retryLabel={m["record.card.retry"]} showLabel={showText(DEALS)} disclosure={false} open={false} onToggle={() => {}} {...over}>
      {body}
    </RecordCardView>
  </div>
);

const stub = (key: MessageKey) => (
  <RecordCardView id={`sg-${key}`} title={m[key]} state="ready" skeletonRows={2} errorText={failedText(m[key])}
    retryLabel={m["record.card.retry"]} showLabel={showText(m[key])} disclosure={false} open={false} onToggle={() => {}}>
    <p className="text-sm text-muted-foreground">…</p>
  </RecordCardView>
);

const header = (all: boolean) => (
  <RecordHeader name="Ana García" subtitle={all ? m["record.group.household"].replace("{group}", "García") : null}
    back={{ href: "/dashboard/styleguide", label: m["record.back"] }}
    actions={all ? [
      { id: "call", label: m["record.action.call"], href: "tel:+19565550100", ariaLabel: m["record.action.callAria"].replace("{name}", "Ana García"), primary: true },
      { id: "text", label: m["record.action.text"], href: "#compose-sms" },
      { id: "email", label: m["record.action.email"], href: "#compose-email" },
      { id: "directions", label: m["record.action.directions"], href: "https://www.google.com/maps/search/?api=1&query=McAllen", external: true },
    ] : []} />
);

const layout = (width: string) => (
  <div className={`${width} overflow-x-auto rounded-xl border border-dashed border-[var(--line-strong)]`}>
    <RecordLayout skipLabel={m["record.skipToDetails"]} header={header(true)} columns={[
      { column: "happening", content: <>{stub("record.card.summary")}{stub("record.card.nextUp")}{stub("record.card.activity")}</> },
      { column: "have", content: <>{stub("groups.title")}{stub("places.title")}{stub("record.card.deals")}</> },
      { column: "who", content: <>{stub("contact.details")}{stub("contact.tags")}{stub("relationships.title")}</> },
    ]} />
  </div>
);

export function RecordDemo() {
  return (
    <div className="flex w-full flex-col gap-6">
      {layout("w-[1120px]")}
      {layout("w-[390px]")}
      {header(true)}
      {header(false)}
      <div className="flex flex-wrap gap-4">
        {card("loading", { state: "loading" })}
        {card("ready")}
        {card("empty", { state: "empty" }, <p className="text-sm text-muted-foreground">{m["contact.noOpportunities"]}</p>)}
        {card("error", { state: "error" })}
        {card("closed", { disclosure: true, open: false })}
      </div>
    </div>
  );
}
```

`styleguide/page.tsx`: add `import { RecordDemo } from "./record-demo";` beside the other demo imports (`:45-49`), and after the Properties `Section` (`:256-258`):

```tsx
        {/* S-03 part 1 (spec §15): the record kit: layout at both widths, header with all and no
            actions, a card loading, ready, empty, in error and closed on a phone. */}
        <Section title={t(m, "styleguide.recordKit", "en")} file="components/record/*">
          <RecordDemo />
        </Section>
```

The section title is a new catalogue key, as `styleguide.choiceTiles` is (`page.tsx:236`). A literal `title="Record kit"` would raise `styleguide/page.tsx`'s ratchet count past its baseline of 76. Add it to Task 4's block: `"styleguide.recordKit": "Record kit",` / `"styleguide.recordKit.es": "Ficha del cliente",`. Before committing, run `pnpm --filter web exec vitest run src/lib/i18n/ratchet.test.ts`; a failure names the file and the count.

- [ ] **Step 7: DESIGN.md** (bis-frontend; additive, verbatim from spec §16.1)

In rule 8, after `   button B was going to write, they are one view and only one of them is\n   primary.`, append to the same item:

```
   A record page's header is its own view (decided 2026-10-12): its one
   primary, Call, writes nothing, so it cannot write what a card's primary
   writes, and the cards below keep their own.
```

In "Record page, documents and provenance (v2…)", after `the page (rule 5 extended to the card, not just the screen).`, append to the same paragraph:

```
On a phone it is one column (decided 2026-10-12): the header with Call
first, the summary and what is next, the timeline, what they have (closed
until tapped), then who they are.
```

- [ ] **Step 8: Run everything this task touched**

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record
pnpm --filter web exec vitest run src/components/record "src/app/(dashboard)/dashboard/styleguide/record-demo.test.ts" src/lib/i18n src/lib/messages.test.ts
pnpm --filter web typecheck
pnpm --filter web exec eslint src/components/record "src/app/(dashboard)/dashboard/styleguide/record-demo.tsx" "src/app/(dashboard)/dashboard/styleguide/page.tsx"
```
Expected: every vitest file passes (paste the `Test Files` line), typecheck is clean and eslint reports no errors.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record
git add -- apps/web/src/components/record "apps/web/src/app/(dashboard)/dashboard/styleguide/record-demo.tsx" "apps/web/src/app/(dashboard)/dashboard/styleguide/record-demo.test.ts"
git commit -m "feat(design): the record kit (layout, header, card, per-card boundary) with styleguide entries and DESIGN.md's two record-page sentences" -- apps/web/src/components/record "apps/web/src/app/(dashboard)/dashboard/styleguide/record-demo.tsx" "apps/web/src/app/(dashboard)/dashboard/styleguide/record-demo.test.ts" "apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx" apps/web/src/lib/messages.ts DESIGN.md
```

---

### Task 5: The registry, the copy, the fact line, Next up and the header actions (bis-crm)

**messages.ts: SECOND. Start only after Task 4's commit.**

**Files:**
- Create: `apps/web/src/lib/record/record-cards.ts`, `copy.ts`, `record-facts.ts`, `next-up.ts`, `header-actions.ts`
- Test: `apps/web/src/lib/record/record-cards.test.ts`, `copy.test.ts`, `record-facts.test.ts`, `next-up.test.ts`, `header-actions.test.ts`
- Modify: `apps/web/src/lib/messages.ts` (append the 1a `record.*` keys; twins under `pipeline.status.*` `:645-647`, `contact.opportunities` `:654`, `contact.noOpportunities` `:707`)

**Interfaces:**
- Consumes: `type RecordColumn` (Task 4, `@/components/record/record-layout`). `ContactFacts`, `ContactNextUp` (Task 3, `@bis/db`). `PlaceRow`, `ContactPlaceGroup` (`@bis/db`, `places.ts`). `placesInOrder`, `mapUrl` (`lib/contacts/place-view.ts:31`, `:73`). `partsInZone` (`lib/booking/slots.ts:40`, which has no imports and so is safe under a mocked `@bis/db`). `e164Of` (`lib/voice/phone-number.ts:17`). `SmsGate` (`lib/sms/sender.ts:3`). `t`, `plural`, `PluralKey` (`lib/i18n/t.ts`). `pseudoLocale` (`lib/i18n/pseudo-locale.ts:27`). `formatCurrency`, `formatDateInZone` (`lib/format.ts`).
- Produces:
  - `record-cards.ts`: `type RecordCardId = "summary" | "next-up" | "timeline" | "groups" | "properties" | "deals" | "details" | "tags" | "related-people"`; `type RecordCardDef = { id: RecordCardId; column: RecordColumn; deskOrder: number; phoneOrder: number; collapsibleOnPhone: boolean; titleKey: MessageKey; skeletonRows: number }`; `RECORD_CARDS: readonly RecordCardDef[]`; `cardsInPhoneOrder(): RecordCardDef[]`; `columnRuns(): { column: RecordColumn; cards: RecordCardDef[] }[]`.
  - `copy.ts`: `type Tr = { locale: Locale; text(key: MessageKey, params?: Record<string, string | number>): string; count(key: PluralKey<typeof m>, n: number, params?: Record<string, string | number>): string }`; `makeTr(locale: Locale, pseudo = false): Tr`.
  - `record-facts.ts`: `dayKeyIn(instant: Date, zone: string): string`; `calendarDaysAgo(at: string, now: Date, zone: string): number`; `sinceMonth(createdAt: string, zone: string, locale: Locale): string | null`; `talkedWhen(at: string, now: Date, zone: string, locale: Locale): string`; `type FactsView = { line: string[]; missing: string | null; allFailed: boolean }`; `factsView(input: { createdAt: string; facts: ContactFacts }, ctx: { zone: string; now: Date; tr: Tr }): FactsView`.
  - `next-up.ts`: `type NextUpRow = { kind: "booking"; id: string; label: string } | { kind: "task"; id: string; title: string; detail: string; overdue: boolean }`; `type NextUpView = { rows: NextUpRow[]; undated: string | null }`; `nextUpView(data: ContactNextUp, ctx: { zone: string; now: Date; tr: Tr }): NextUpView`.
  - `header-actions.ts`: `type HeaderActionId = "call" | "text" | "email" | "directions"`; `type HeaderAction = { id: HeaderActionId; href: string; primary: boolean; external: boolean }`; `telHref(phone: string | null): string | null`; `canTextFrom(input: { phone: string | null; smsGate: SmsGate | null; smsBlockedLine: string | null }): boolean`; `firstMapUrl(places: readonly PlaceRow[], subjectId: string, groups: readonly ContactPlaceGroup[]): string | null`; `headerActions(input: { phone: string | null; email: string | null; canText: boolean; directionsUrl: string | null }): HeaderAction[]`.

**Copy deviations, recorded:**
- **Open deals.** The spec's `record.facts.openDeals` carries `· {amount}` inside the key, but the amount must be left out when it is zero or past the cap, and that needs a key without it. The keys carry the count only ("{count} open deals" / "1 open deal"); the formatted amount is its own " · "-joined segment, so the rendered line reads exactly as the spec's.
- **`record.nextUp.booking`** ("Appointment · {when}" / "Cita · {when}") is added. The spec's row had a calendar name, and there is none to show (Task 1), so a bare date and time would not say what it is. A word says it.
- **`contact.noOpportunities.es`** is "Todavía no hay ninguna." The spec asks for a twin but gives no text.
- **"today / yesterday / N days ago"** come from `Intl.RelativeTimeFormat(…, { numeric: "auto" })`. That was verified on this machine: en `today | yesterday | 4 days ago`, es-US `hoy | ayer | hace 4 días`. So they need no keys.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/record/record-cards.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RECORD_CARDS, cardsInPhoneOrder, columnRuns } from "./record-cards";
import { m } from "@/lib/messages";

describe("the record card registry (S-03 part 1, spec §8)", () => {
  it("ids are unique", () => {
    const ids = RECORD_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("phone order is exactly D6's: summary, Next up, the timeline, what they have, who they are (mutation: swap timeline's and summary's phoneOrder -> FAILS)", () => {
    expect(cardsInPhoneOrder().map((c) => c.id)).toEqual(
      ["summary", "next-up", "timeline", "groups", "properties", "deals", "details", "tags", "related-people"]);
  });
  it("each column is ONE unbroken run in phone order, so the DOM can be the phone order on a desk too (C6; mutation: give tags phoneOrder 3.5 -> FAILS)", () => {
    expect(columnRuns().map((r) => r.column)).toEqual(["happening", "have", "who"]);
  });
  it("within a column, desk order agrees with phone order", () => {
    for (const run of columnRuns()) {
      expect(run.cards.map((c) => c.deskOrder)).toEqual([...run.cards.map((c) => c.deskOrder)].sort((a, b) => a - b));
    }
  });
  it("only the three 'what they have' cards collapse on a phone (D6)", () => {
    expect(RECORD_CARDS.filter((c) => c.collapsibleOnPhone).map((c) => c.id).sort()).toEqual(["deals", "groups", "properties"]);
  });
  it("every card has a title key in the catalogue and a skeleton shaped as the spec says", () => {
    for (const c of RECORD_CARDS) {
      expect(m[c.titleKey], c.id).toBeTruthy();
      expect(c.skeletonRows, c.id).toBeGreaterThanOrEqual(1);
    }
    expect(RECORD_CARDS.find((c) => c.id === "next-up")!.skeletonRows).toBe(3);
    expect(RECORD_CARDS.find((c) => c.id === "timeline")!.skeletonRows).toBe(5);
    expect(RECORD_CARDS.find((c) => c.id === "summary")!.skeletonRows).toBe(1);
  });
});
```

`apps/web/src/lib/record/copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTr } from "./copy";

describe("makeTr", () => {
  it("reads the Spanish twin for es and counts by Intl plural rules", () => {
    expect(makeTr("es").text("record.action.call")).toBe("Llamar");
    expect(makeTr("en").count("record.facts.booked", 1)).toBe("Booked once");
    expect(makeTr("en").count("record.facts.booked", 3)).toBe("Booked 3 times");
    expect(makeTr("es").count("record.facts.booked", 1)).toBe("Agendó una vez");
  });
  it("pseudo wraps the English string, placeholders already filled (mutation: ignore pseudo -> 'Contacts', FAILS)", () => {
    const s = makeTr("en", true).text("record.back");
    expect(s).not.toBe("Contacts");
    expect(s.length).toBeGreaterThan("Contacts".length);
  });
});
```

`apps/web/src/lib/record/record-facts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ContactFacts } from "@bis/db";
import { factsView, talkedWhen, calendarDaysAgo } from "./record-facts";
import { makeTr } from "./copy";

const ZONE = "America/Chicago";
const NOW = new Date("2026-10-12T14:00:00Z"); // 9:00 AM in Chicago (CDT)
const ok = <T,>(value: T) => ({ ok: true as const, value });
const FAILED = { ok: false as const };
const facts = (over: Partial<ContactFacts> = {}): ContactFacts => ({
  bookingsMade: ok(0), lastTalked: ok(null), openDeals: ok({ count: 0, amount: null }), ...over,
});
const view = (over: Partial<ContactFacts> = {}, locale: "en" | "es" = "en", createdAt = "2026-01-01T05:30:00Z") =>
  factsView({ createdAt, facts: facts(over) }, { zone: ZONE, now: NOW, tr: makeTr(locale) });

describe("the summary's fact line (spec §9.2)", () => {
  it("'since' is the month in the ACCOUNT's zone: created Dec 31, 11:30 PM Chicago reads Dec 2025 (mutation: format in UTC -> 'Jan 2026', FAILS)", () => {
    expect(view().line).toEqual(["On your list since Dec 2025"]);
    expect(view({}, "es").line).toEqual(["En su lista desde dic 2025"]);
  });

  it("a zero is left out, never printed (mutation: print 'Booked 0 times' -> FAILS)", () => {
    const v = view();
    expect(v.line).toHaveLength(1);
    expect(v.missing).toBeNull();
    expect(v.allFailed).toBe(false);
  });

  it("counts read in words", () => {
    expect(view({ bookingsMade: ok(1) }).line[1]).toBe("Booked once");
    expect(view({ bookingsMade: ok(4) }).line[1]).toBe("Booked 4 times");
    expect(view({ openDeals: ok({ count: 2, amount: 2400 }) }).line.slice(1)).toEqual(["2 open deals", "$2,400"]);
    expect(view({ openDeals: ok({ count: 1, amount: 0 }) }).line.slice(1)).toEqual(["1 open deal"]);
    expect(view({ openDeals: ok({ count: 120, amount: null }) }).line.slice(1)).toEqual(["120 open deals"]);
    expect(view({ openDeals: ok({ count: 1, amount: 500 }) }, "es").line.slice(1)).toEqual(["1 oportunidad abierta", "$500"]);
  });

  it("a failed read is left out AND named, never shown as a zero (mutation: treat a failed read as 0 -> missing is null, FAILS)", () => {
    const v = view({ bookingsMade: FAILED, openDeals: FAILED });
    expect(v.line).toEqual(["On your list since Dec 2025"]);
    expect(v.missing).toBe("Couldn't count bookings and open deals.");
    expect(v.allFailed).toBe(false);
    expect(view({ bookingsMade: FAILED }, "es").missing).toBe("No se pudo contar: las citas.");
  });

  it("all three failing is the card's error state", () => {
    expect(view({ bookingsMade: FAILED, lastTalked: FAILED, openDeals: FAILED }).allFailed).toBe(true);
  });

  it("last talked counts CALENDAR days in the account's zone: 11:30 PM yesterday, 9.5 hours ago, is 'yesterday' (mutation: 24-hour arithmetic -> 'today', FAILS)", () => {
    expect(calendarDaysAgo("2026-10-12T04:30:00Z", NOW, ZONE)).toBe(1);
    expect(view({ lastTalked: ok({ at: "2026-10-12T04:30:00Z", channel: "call" }) }).line[1]).toBe("Last talked yesterday (call)");
    expect(view({ lastTalked: ok({ at: "2026-10-12T13:00:00Z", channel: "text" }) }).line[1]).toBe("Last talked today (text)");
    expect(view({ lastTalked: ok({ at: "2026-10-08T15:00:00Z", channel: "email" }) }, "es").line[1]).toBe("Última conversación hace 4 días (correo)");
  });

  it("past 30 days 'when' is the date", () => {
    expect(talkedWhen("2026-08-01T15:00:00Z", NOW, ZONE, "en")).toBe("Aug 1, 2026");
  });

  it("an unreadable created_at drops 'since' instead of throwing in a render", () => {
    expect(view({}, "en", "not a date").line).toEqual([]);
  });
});
```

`apps/web/src/lib/record/next-up.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ContactNextUp } from "@bis/db";
import { nextUpView } from "./next-up";
import { makeTr } from "./copy";

const ZONE = "America/Chicago";
const data = (over: Partial<ContactNextUp> = {}): ContactNextUp => ({ bookings: [], datedTasks: [], undatedCount: 0, ...over });
const view = (d: ContactNextUp, now = new Date("2026-10-12T17:00:00Z"), locale: "en" | "es" = "en") =>
  nextUpView(d, { zone: ZONE, now, tr: makeTr(locale) });

describe("Next up (spec §9.3, C9)", () => {
  it("overdue To-dos first, then soonest, capped at three (mutation: list bookings before To-dos -> FAILS; mutation: drop the cap -> four rows, FAILS)", () => {
    const v = view(data({
      bookings: [{ id: "b1", starts_at: "2026-10-13T15:00:00Z" }, { id: "b2", starts_at: "2026-10-20T15:00:00Z" }],
      datedTasks: [{ id: "t-over", title: "Call back", due_at: "2026-10-01T05:00:00Z" }, { id: "t-today", title: "Quote", due_at: "2026-10-12T05:00:00Z" }],
    }));
    expect(v.rows.map((r) => r.id)).toEqual(["t-over", "t-today", "b1"]);
  });

  it("a To-do reads overdue (with a dot), due today or due later, by the ACCOUNT's calendar day (mutation: compare UTC days -> 10 PM Oct 12 in Chicago is Oct 13 in UTC and 'today' turns overdue, FAILS)", () => {
    const tasks = [
      { id: "a", title: "Call back", due_at: "2026-10-01T05:00:00Z" },
      { id: "b", title: "Quote", due_at: "2026-10-12T05:00:00Z" },
      { id: "c", title: "Order parts", due_at: "2026-10-20T05:00:00Z" },
    ];
    const v = view(data({ datedTasks: tasks }), new Date("2026-10-13T03:00:00Z"));
    expect(v.rows).toEqual([
      { kind: "task", id: "a", title: "Call back", detail: "Overdue · was due Oct 1, 2026", overdue: true },
      { kind: "task", id: "b", title: "Quote", detail: "Due today", overdue: false },
      { kind: "task", id: "c", title: "Order parts", detail: "Due Oct 20, 2026", overdue: false },
    ]);
  });

  it("a booking reads its day and time in the account's zone", () => {
    const v = view(data({ bookings: [{ id: "b", starts_at: "2026-10-16T15:00:00Z" }] }));
    // ICU 72+ may put U+202F (narrow no-break space) before AM; this machine's Node 24 printed 0x20.
    const row = v.rows[0] as { kind: string; id: string; label: string };
    expect({ ...row, label: row.label.replace(/ /g, " ") }).toEqual({ kind: "booking", id: "b", label: "Appointment · Fri, Oct 16 · 10:00 AM" });
    expect((view(data({ bookings: [{ id: "b", starts_at: "2026-10-16T15:00:00Z" }] }), undefined, "es").rows[0] as { label: string }).label)
      .toMatch(/^Cita · /);
  });

  it("undated To-dos are counted, never listed (C9; mutation: list them -> FAILS)", () => {
    expect(view(data({ undatedCount: 2 }))).toEqual({ rows: [], undated: "2 more To-dos have no date." });
    expect(view(data({ undatedCount: 1 })).undated).toBe("1 more To-do has no date.");
    expect(view(data()).undated).toBeNull();
  });
});
```

`apps/web/src/lib/record/header-actions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { PlaceRow } from "@bis/db";
import { headerActions, canTextFrom, firstMapUrl, telHref } from "./header-actions";

const base = { phone: "+19565550100", email: "ana@example.com", canText: true, directionsUrl: "https://maps.example/x" };

describe("the header's actions (spec §9.1)", () => {
  it("all four, in order, and Call is the ONLY primary (mutation: make Text primary -> FAILS)", () => {
    const a = headerActions(base);
    expect(a.map((x) => x.id)).toEqual(["call", "text", "email", "directions"]);
    expect(a.filter((x) => x.primary).map((x) => x.id)).toEqual(["call"]);
    expect(a.find((x) => x.id === "text")!.href).toBe("#compose-sms");
    expect(a.find((x) => x.id === "email")!.href).toBe("#compose-email");
    expect(a.find((x) => x.id === "directions")).toMatchObject({ href: "https://maps.example/x", external: true });
  });
  it.each([
    ["no phone hides Call", { phone: null }, "call"],
    ["no email hides Email", { email: null }, "email"],
    ["a closed text gate hides Text", { canText: false }, "text"],
    ["no addressed property hides Directions", { directionsUrl: null }, "directions"],
  ])("%s, never disabled", (_n, over, gone) => {
    const ids = headerActions({ ...base, ...over }).map((x) => x.id);
    expect(ids).not.toContain(gone);
    expect(ids).toHaveLength(3);
  });
  it("Call dials the E.164 form, else the digits; a phone with no digits has no Call", () => {
    expect(telHref("(956) 555-0100")).toBe("tel:+19565550100");
    expect(telHref("ext 55-01")).toBe("tel:5501");
    expect(telHref("call me")).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});

describe("canTextFrom: exactly when the composer's text form would open", () => {
  const gate = { ok: true as const, from: "+19565559999", ownedNumbers: ["+19565559999"] };
  it("open only with a usable number, an open gate and no consent line (mutation: ignore smsBlockedLine -> FAILS)", () => {
    expect(canTextFrom({ phone: "+19565550100", smsGate: gate, smsBlockedLine: null })).toBe(true);
    expect(canTextFrom({ phone: null, smsGate: gate, smsBlockedLine: null })).toBe(false);
    expect(canTextFrom({ phone: "+19565550100", smsGate: { ok: false, reason: "a2p_not_approved" }, smsBlockedLine: null })).toBe(false);
    expect(canTextFrom({ phone: "+19565550100", smsGate: null, smsBlockedLine: null })).toBe(false);
    expect(canTextFrom({ phone: "+19565550100", smsGate: gate, smsBlockedLine: "Stopped texts on Oct 3" })).toBe(false);
  });
});

describe("firstMapUrl (D13): the first ADDRESSED property in the Properties card's own order", () => {
  const stamp = { account_id: "a", created_by: null, updated_at: "2026-10-01T00:00:00Z" };
  const place = (over: Partial<PlaceRow>): PlaceRow => ({
    id: "p", contact_id: "ana", client_group_id: null, label: null, address: null, landmark: null, directions: null,
    city: null, region: null, postal_code: null, country: null, archived_at: null, created_at: "2026-10-01T00:00:00Z", ...stamp, ...over,
  });
  it("own before the group's, oldest first, skipping removed and address-less ones (mutation: take the last -> the group's Third St, FAILS)", () => {
    const places = [
      place({ id: "g", contact_id: null, client_group_id: "g1", address: "3 Third St", created_at: "2026-09-01T00:00:00Z" }),
      place({ id: "old", address: "0 Gone St", archived_at: "2026-10-05T00:00:00Z", created_at: "2026-09-15T00:00:00Z" }),
      place({ id: "land", landmark: "past the canal", created_at: "2026-09-20T00:00:00Z" }),
      place({ id: "first", address: "1 First St", created_at: "2026-10-01T00:00:00Z" }),
      place({ id: "second", address: "2 Second St", created_at: "2026-10-02T00:00:00Z" }),
    ];
    const url = firstMapUrl(places, "ana", [{ id: "g1", kind: "household", name: "García", isPrimary: true }]);
    expect(url).toContain(encodeURIComponent("1 First St"));
    expect(firstMapUrl([place({ landmark: "x" })], "ana", [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record && pnpm --filter web exec vitest run src/lib/record`
Expected: FAIL. The five files error with `Failed to load url ./record-cards` (and the others). Stub the modules, re-run, and paste one assertion line.

- [ ] **Step 3: Add the copy** (append to `messages.ts` after Task 4's block; add twins under the three existing keys)

Under `"pipeline.status.open": "Open",` etc.:

```ts
  "pipeline.status.open.es": "Abierta",
  "pipeline.status.won.es": "Ganada",
  "pipeline.status.lost.es": "Perdida",
```

Under `"contact.opportunities": "Opportunities",`: `"contact.opportunities.es": "Oportunidades",`. Under `"contact.noOpportunities": "None yet.",`: `"contact.noOpportunities.es": "Todavía no hay ninguna.",`

Appended block, directly after Task 4's `record.*` block. Task 4 already landed `record.back`, `record.group.*`, `record.action.*`, `record.card.*` and `record.facts.openDeals`/`openDealsOne`: do **not** repeat them.

```ts
  // S-03 part 1 (1a), continued (spec §10.1). record.nextUp.booking stands in for the calendar
  // name the schema has not got (plan Task 1).
  "record.activity.failed": "Couldn't load the activity.",
  "record.activity.failed.es": "No se pudo cargar la actividad.",
  "record.facts.since": "On your list since {month}",
  "record.facts.since.es": "En su lista desde {month}",
  "record.facts.booked": "Booked {count} times",
  "record.facts.booked.es": "Agendó {count} veces",
  "record.facts.bookedOne": "Booked once",
  "record.facts.bookedOne.es": "Agendó una vez",
  "record.facts.lastTalked": "Last talked {when} ({channel})",
  "record.facts.lastTalked.es": "Última conversación {when} ({channel})",
  "record.facts.channel.text": "text",
  "record.facts.channel.text.es": "texto",
  "record.facts.channel.email": "email",
  "record.facts.channel.email.es": "correo",
  "record.facts.channel.call": "call",
  "record.facts.channel.call.es": "llamada",
  "record.facts.couldntCount": "Couldn't count {what}.",
  "record.facts.couldntCount.es": "No se pudo contar: {what}.",
  "record.facts.what.bookings": "bookings",
  "record.facts.what.bookings.es": "las citas",
  "record.facts.what.talked": "the last conversation",
  "record.facts.what.talked.es": "la última conversación",
  "record.facts.what.deals": "open deals",
  "record.facts.what.deals.es": "las oportunidades abiertas",
  "record.summary.failed": "Couldn't load the summary.",
  "record.summary.failed.es": "No se pudo cargar el resumen.",
  "record.nextUp.booking": "Appointment · {when}",
  "record.nextUp.booking.es": "Cita · {when}",
  "record.nextUp.due": "Due {date}",
  "record.nextUp.due.es": "Vence el {date}",
  "record.nextUp.dueToday": "Due today",
  "record.nextUp.dueToday.es": "Vence hoy",
  "record.nextUp.overdue": "Overdue · was due {date}",
  "record.nextUp.overdue.es": "Atrasado · vencía el {date}",
  "record.nextUp.undated": "{count} more To-dos have no date.",
  "record.nextUp.undated.es": "{count} pendientes más no tienen fecha.",
  "record.nextUp.undatedOne": "1 more To-do has no date.",
  "record.nextUp.undatedOne.es": "1 pendiente más no tiene fecha.",
  "record.nextUp.empty": "Nothing coming up. Bookings ahead and To-dos with a due date show here.",
  "record.nextUp.empty.es": "No hay nada próximo. Aquí aparecen las citas que vienen y los pendientes con fecha.",
  "record.nextUp.addTodo": "Add a To-do",
  "record.nextUp.addTodo.es": "Agregar un pendiente",
  "record.nextUp.failed": "Couldn't load what's next.",
  "record.nextUp.failed.es": "No se pudo cargar lo que sigue.",
```

- [ ] **Step 4: Implement**

`apps/web/src/lib/record/record-cards.ts`:

```ts
import type { RecordColumn } from "@/components/record/record-layout";
import type { MessageKey } from "@/lib/messages";

export type RecordCardId =
  | "summary" | "next-up" | "timeline" | "groups" | "properties" | "deals" | "details" | "tags" | "related-people";

/** One core card of the contact record page (spec §8). The page binds each id to its body. */
export type RecordCardDef = {
  id: RecordCardId; column: RecordColumn; deskOrder: number; phoneOrder: number;
  collapsibleOnPhone: boolean; titleKey: MessageKey; skeletonRows: number;
};

/** The spec's §8 table, verbatim. Packs (later modules) add rows here, never pages. */
export const RECORD_CARDS: readonly RecordCardDef[] = [
  { id: "summary", column: "happening", deskOrder: 1, phoneOrder: 1, collapsibleOnPhone: false, titleKey: "record.card.summary", skeletonRows: 1 },
  { id: "next-up", column: "happening", deskOrder: 2, phoneOrder: 2, collapsibleOnPhone: false, titleKey: "record.card.nextUp", skeletonRows: 3 },
  { id: "timeline", column: "happening", deskOrder: 3, phoneOrder: 3, collapsibleOnPhone: false, titleKey: "record.card.activity", skeletonRows: 5 },
  { id: "groups", column: "have", deskOrder: 1, phoneOrder: 4, collapsibleOnPhone: true, titleKey: "groups.title", skeletonRows: 2 },
  { id: "properties", column: "have", deskOrder: 2, phoneOrder: 5, collapsibleOnPhone: true, titleKey: "places.title", skeletonRows: 2 },
  { id: "deals", column: "have", deskOrder: 3, phoneOrder: 6, collapsibleOnPhone: true, titleKey: "record.card.deals", skeletonRows: 2 },
  { id: "details", column: "who", deskOrder: 1, phoneOrder: 7, collapsibleOnPhone: false, titleKey: "contact.details", skeletonRows: 4 },
  { id: "tags", column: "who", deskOrder: 2, phoneOrder: 8, collapsibleOnPhone: false, titleKey: "contact.tags", skeletonRows: 1 },
  { id: "related-people", column: "who", deskOrder: 3, phoneOrder: 9, collapsibleOnPhone: false, titleKey: "relationships.title", skeletonRows: 2 },
];

export function cardsInPhoneOrder(): RecordCardDef[] {
  return [...RECORD_CARDS].sort((a, b) => a.phoneOrder - b.phoneOrder);
}

/** Consecutive same-column runs in phone order: the DOM order RecordLayout renders (C6). */
export function columnRuns(): { column: RecordColumn; cards: RecordCardDef[] }[] {
  const runs: { column: RecordColumn; cards: RecordCardDef[] }[] = [];
  for (const card of cardsInPhoneOrder()) {
    const last = runs.at(-1);
    if (last && last.column === card.column) last.cards.push(card);
    else runs.push({ column: card.column, cards: [card] });
  }
  return runs;
}
```

**Recorded:** the spec puts `Skeleton` and `render` on `RecordCardDef`. Here the skeleton is data (`skeletonRows`, rendered by the kit's `RecordCardSkeleton`), and the page binds `render` through an exhaustive `satisfies Record<RecordCardId, …>` map (Task 8). Rendering needs the page's loads, and a `.ts` registry that imported every card body would pull client and server components into one module.

`apps/web/src/lib/record/copy.ts`:

```ts
import { m, type MessageKey } from "@/lib/messages";
import { t, plural, type PluralKey } from "@/lib/i18n/t";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import type { Locale } from "@/lib/i18n/locale";

type Params = Record<string, string | number>;

/** The record page's server strings: `t`/`plural`, plus the QA pseudo-locale (dashboard/page.tsx's `p()`). */
export type Tr = {
  locale: Locale;
  text: (key: MessageKey, params?: Params) => string;
  count: (key: PluralKey<typeof m>, n: number, params?: Params) => string;
};

export function makeTr(locale: Locale, pseudo = false): Tr {
  const wrap = (s: string) => (pseudo ? pseudoLocale(s) : s);
  return {
    locale,
    text: (key, params) => wrap(t(m, key, locale, params)),
    count: (key, n, params) => wrap(plural(m, key, n, locale, { count: n, ...params })),
  };
}
```

`apps/web/src/lib/record/record-facts.ts`:

```ts
import type { ContactFacts } from "@bis/db";
import { partsInZone } from "@/lib/booking/slots";
import { formatCurrency, formatDateInZone } from "@/lib/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Tr } from "./copy";

const tag = (locale: Locale) => (locale === "es" ? "es-US" : "en-US");

/** `YYYY-MM-DD` as the account's zone sees `instant` (the booking engine's own conversion). */
export function dayKeyIn(instant: Date, zone: string): string {
  const p = partsInZone(instant, zone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

const utcDay = (key: string) => {
  const [y, mo, d] = key.split("-").map(Number);
  return Date.UTC(y!, mo! - 1, d!);
};

/** Whole CALENDAR days between `at` and `now`, both read in `zone`; never 24-hour arithmetic. */
export function calendarDaysAgo(at: string, now: Date, zone: string): number {
  return Math.round((utcDay(dayKeyIn(now, zone)) - utcDay(dayKeyIn(new Date(at), zone))) / 86_400_000);
}

/** "Dec 2025": the month the customer joined, in the account's zone; null if unreadable. */
export function sinceMonth(createdAt: string, zone: string, locale: Locale): string | null {
  try {
    return new Intl.DateTimeFormat(tag(locale), { timeZone: zone, month: "short", year: "numeric" }).format(new Date(createdAt));
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

/** "today", "yesterday", "4 days ago" (Intl, numeric auto), then the date past 30 days. */
export function talkedWhen(at: string, now: Date, zone: string, locale: Locale): string {
  const days = calendarDaysAgo(at, now, zone);
  if (days > 30) return formatDateInZone(at, zone, locale);
  return new Intl.RelativeTimeFormat(tag(locale), { numeric: "auto" }).format(-Math.max(0, days), "day");
}

export type FactsView = { line: string[]; missing: string | null; allFailed: boolean };

/**
 * The summary's one line of facts (spec §9.2). A zero is left out; a failed read is left out AND
 * named under the line ("Couldn't count …"), so a missing fact never reads as a zero (DESIGN.md,
 * the weekly report: omitted, never zeroed).
 */
export function factsView(input: { createdAt: string; facts: ContactFacts }, ctx: { zone: string; now: Date; tr: Tr }): FactsView {
  const { tr, zone, now } = ctx;
  const line: string[] = [];
  const missing: string[] = [];
  const month = sinceMonth(input.createdAt, zone, tr.locale);
  if (month) line.push(tr.text("record.facts.since", { month }));

  const booked = input.facts.bookingsMade;
  if (!booked.ok) missing.push(tr.text("record.facts.what.bookings"));
  else if (booked.value > 0) line.push(tr.count("record.facts.booked", booked.value));

  const talked = input.facts.lastTalked;
  if (!talked.ok) missing.push(tr.text("record.facts.what.talked"));
  else if (talked.value) {
    line.push(tr.text("record.facts.lastTalked", {
      when: talkedWhen(talked.value.at, now, zone, tr.locale),
      channel: tr.text(`record.facts.channel.${talked.value.channel}` as const),
    }));
  }

  const deals = input.facts.openDeals;
  if (!deals.ok) missing.push(tr.text("record.facts.what.deals"));
  else if (deals.value.count > 0) {
    line.push(tr.count("record.facts.openDeals", deals.value.count));
    if (deals.value.amount !== null && deals.value.amount > 0) line.push(formatCurrency(deals.value.amount, tr.locale));
  }

  return {
    line,
    missing: missing.length > 0
      ? tr.text("record.facts.couldntCount", { what: new Intl.ListFormat(tag(tr.locale), { type: "conjunction" }).format(missing) })
      : null,
    allFailed: missing.length === 3,
  };
}
```

`apps/web/src/lib/record/next-up.ts`:

```ts
import type { ContactNextUp } from "@bis/db";
import { formatDateInZone } from "@/lib/format";
import { dayKeyIn } from "./record-facts";
import type { Tr } from "./copy";

export type NextUpRow =
  | { kind: "booking"; id: string; label: string }
  | { kind: "task"; id: string; title: string; detail: string; overdue: boolean };
export type NextUpView = { rows: NextUpRow[]; undated: string | null };

/**
 * Up to three rows, soonest first (spec §9.3). An overdue To-do's due date is in the past, so it
 * sorts first on its own. Days are the ACCOUNT's (a due date is midnight there, D-006).
 */
export function nextUpView(data: ContactNextUp, ctx: { zone: string; now: Date; tr: Tr }, limit = 3): NextUpView {
  const { zone, now, tr } = ctx;
  const tag = tr.locale === "es" ? "es-US" : "en-US";
  const today = dayKeyIn(now, zone);
  const dated = [
    ...data.datedTasks.map((t) => ({ at: t.due_at, rank: 0, row: (): NextUpRow => {
      const day = dayKeyIn(new Date(t.due_at), zone);
      const date = formatDateInZone(t.due_at, zone, tr.locale);
      const overdue = day < today;
      const detail = overdue ? tr.text("record.nextUp.overdue", { date })
        : day === today ? tr.text("record.nextUp.dueToday") : tr.text("record.nextUp.due", { date });
      return { kind: "task", id: t.id, title: t.title, detail, overdue };
    } })),
    ...data.bookings.map((b) => ({ at: b.starts_at, rank: 1, row: (): NextUpRow => {
      const instant = new Date(b.starts_at);
      const day = new Intl.DateTimeFormat(tag, { timeZone: zone, weekday: "short", month: "short", day: "numeric" }).format(instant);
      const time = new Intl.DateTimeFormat(tag, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(instant);
      return { kind: "booking", id: b.id, label: tr.text("record.nextUp.booking", { when: `${day} · ${time}` }) };
    } })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.rank - b.rank);
  return {
    rows: dated.slice(0, limit).map((d) => d.row()),
    undated: data.undatedCount > 0 ? tr.count("record.nextUp.undated", data.undatedCount) : null,
  };
}
```

`apps/web/src/lib/record/header-actions.ts`:

```ts
import type { PlaceRow, ContactPlaceGroup } from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import { e164Of } from "@/lib/voice/phone-number";
import { mapUrl, placesInOrder } from "@/lib/contacts/place-view";

export type HeaderActionId = "call" | "text" | "email" | "directions";
export type HeaderAction = { id: HeaderActionId; href: string; primary: boolean; external: boolean };

/** `tel:` with the E.164 form when the number normalises, else its digits; null with none. */
export function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const e164 = e164Of(phone);
  if (e164) return `tel:${e164}`;
  const digits = phone.replace(/\D/g, "");
  return digits ? `tel:${digits}` : null;
}

/** Exactly when the composer's text form would open (spec §9.1): a usable number, an open gate, no consent line. */
export function canTextFrom(input: { phone: string | null; smsGate: SmsGate | null; smsBlockedLine: string | null }): boolean {
  return Boolean(e164Of(input.phone)) && input.smsGate !== null && input.smsGate.ok && input.smsBlockedLine === null;
}

/** D13: the first property in the Properties card's order that has an address. */
export function firstMapUrl(places: readonly PlaceRow[], subjectId: string, groups: readonly ContactPlaceGroup[]): string | null {
  for (const p of placesInOrder(places, subjectId, groups).active) {
    const url = mapUrl(p);
    if (url) return url;
  }
  return null;
}

/** Call, Text, Email, Directions in that order on every width; an action with nothing behind it is hidden (D3). */
export function headerActions(input: { phone: string | null; email: string | null; canText: boolean; directionsUrl: string | null }): HeaderAction[] {
  const out: HeaderAction[] = [];
  const tel = telHref(input.phone);
  if (tel) out.push({ id: "call", href: tel, primary: true, external: false });
  if (input.canText) out.push({ id: "text", href: "#compose-sms", primary: false, external: false });
  if (input.email) out.push({ id: "email", href: "#compose-email", primary: false, external: false });
  if (input.directionsUrl) out.push({ id: "directions", href: input.directionsUrl, primary: false, external: true });
  return out;
}
```

- [ ] **Step 5: Run the tests to see them pass, then the probes**

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record
pnpm --filter web exec vitest run src/lib/record src/lib/i18n src/lib/messages.test.ts
pnpm --filter web typecheck
pnpm --filter web exec eslint src/lib/record
```
Expected: `Test Files  N passed`, typecheck clean. Run the named probes and paste a failing line for each: the `UTC` month, 24-hour days, the UTC day in Next up, taking the last place, and a primary Text.

If `telHref("(956) 555-0100")` does not normalise to `+19565550100` with this repo's `normalisePhone`, fix the **test's input** to a number `e164Of` accepts (check `packages/db/src/phone.ts`) and say so in the report. Never weaken the assertion.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record
git add -- apps/web/src/lib/record
git commit -m "feat(contacts): record card registry, fact line, Next up and header actions for the record page (EN+ES)" -- apps/web/src/lib/record apps/web/src/lib/messages.ts
```

---

### Task 6: The composer opens on the channel the header asked for (bis-comms)

**Files:**
- Modify: `…/contacts/[contactId]/message-composer.tsx`
- Test: `…/contacts/[contactId]/message-composer.test.ts`

**Interfaces:**
- Consumes: `SmsGate` (`lib/sms/sender.ts:3`).
- Produces:
  - `type ComposeMode = "note" | "email" | "sms"` (the file's `Mode`, exported).
  - `composeModeFromHash(hash: string): "email" | "sms" | null`: `#compose-sms` maps to `"sms"`, `#compose-email` to `"email"`, anything else to null.
  - `smsFormBlock(gate: SmsGate | null, contactHasPhone: boolean, blockedLine: string | null): { text: string; consent: boolean } | null`. `null` means the text form shows.
  - `MessageComposer`'s `smsGate` prop widens to `SmsGate | null`: `null` is "the gate read failed", and the Text tab then says `compose.smsStateUnknown` (spec §7, "failing closed").
  - DOM: the composer root carries anchors `id="compose-sms"` and `id="compose-email"`.

- [ ] **Step 1: Write the failing tests** (append to `message-composer.test.ts`; extend its import to `import { MessageComposer, composeModeFromHash, smsFormBlock } from "./message-composer";`, and add `import { m } from "@/lib/messages";`)

```ts
describe("the header's Text and Email land on the composer (S-03 part 1, spec §9.1)", () => {
  it("maps exactly the two hashes to their channels (mutation: return 'sms' for #compose-email -> FAILS)", () => {
    expect(composeModeFromHash("#compose-sms")).toBe("sms");
    expect(composeModeFromHash("#compose-email")).toBe("email");
    expect(composeModeFromHash("")).toBeNull();
    expect(composeModeFromHash("#record-who")).toBeNull();
    expect(composeModeFromHash("#compose-note")).toBeNull();
  });

  it("carries both anchors, so the links scroll to the composer even without JavaScript (mutation: drop an anchor -> FAILS)", () => {
    const html = render();
    expect(html).toContain('id="compose-sms"');
    expect(html).toContain('id="compose-email"');
  });
});

describe("smsFormBlock: the one line the Text tab shows instead of the form", () => {
  const open = { ok: true as const, from: "+19565550000", ownedNumbers: ["+19565550000"] };
  it("an unreadable gate fails CLOSED with the unknown line, never an open form (spec §7; mutation: treat null as open -> FAILS)", () => {
    expect(smsFormBlock(null, true, null)).toEqual({ text: m["compose.smsStateUnknown"], consent: false });
  });
  it("keeps today's order: gate, then number, then the consent line", () => {
    expect(smsFormBlock({ ok: false, reason: "a2p_not_approved" }, true, null)).toEqual({ text: m["compose.smsBlockedA2p"], consent: false });
    expect(smsFormBlock({ ok: false, reason: "no_live_number" }, true, null)).toEqual({ text: m["compose.smsBlockedNoNumber"], consent: false });
    expect(smsFormBlock(open, false, "held")).toEqual({ text: m["compose.noPhoneOnContact"], consent: false });
    expect(smsFormBlock(open, true, "held")).toEqual({ text: "held", consent: true });
    expect(smsFormBlock(open, true, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record && pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer.test.ts"`
Expected: FAIL with `composeModeFromHash is not a function`.

- [ ] **Step 3: Implement** (edits to `message-composer.tsx`)

Imports: `import { useEffect, useRef, useState } from "react";`. Rename `type Mode` to an exported `ComposeMode` (with `type Mode = ComposeMode;` kept locally), and widen the prop to `smsGate: SmsGate | null;` (comment: "null: the gate read failed (spec §7); the Text tab says so, never an open form"). Add above the component:

```ts
export type ComposeMode = "note" | "email" | "sms";
type Mode = ComposeMode;

/** The record header's Text/Email links (S-03 part 1, spec §9.1): `#compose-sms`, `#compose-email`. */
export function composeModeFromHash(hash: string): "email" | "sms" | null {
  if (hash === "#compose-sms") return "sms";
  if (hash === "#compose-email") return "email";
  return null;
}

/** The line the Text tab shows in place of its form, in today's order; null when the form shows.
 *  `consent` marks the recipient's own line (the one `data-testid="composer-sms-blocked"` names). */
export function smsFormBlock(gate: SmsGate | null, contactHasPhone: boolean, blockedLine: string | null): { text: string; consent: boolean } | null {
  if (gate === null) return { text: m["compose.smsStateUnknown"], consent: false };
  if (!gate.ok) return { text: gate.reason === "a2p_not_approved" ? m["compose.smsBlockedA2p"] : m["compose.smsBlockedNoNumber"], consent: false };
  if (!contactHasPhone) return { text: m["compose.noPhoneOnContact"], consent: false };
  return blockedLine ? { text: blockedLine, consent: true } : null;
}
```

Inside the component, after `const [body, setBody] = useState("");`:

```tsx
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const modeRef = useRef<Mode>(mode);
  const [focusNonce, setFocusNonce] = useState(0);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // The record header's Text and Email (spec §9.1): open on that channel and focus the body. A
  // hashchange covers a deep link and a first click; the click listener covers clicking the same
  // link twice (no hashchange then). Only the note boundary clears the draft, as the tabs do.
  useEffect(() => {
    const open = (hash: string) => {
      const target = composeModeFromHash(hash);
      if (!target) return;
      const current = modeRef.current;
      if (target !== current) {
        setMode(target);
        if (current === "note") setBody("");
      }
      setFocusNonce((n) => n + 1);
    };
    const onHash = () => open(window.location.hash);
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href^='#compose-']");
      if (link) open(link.getAttribute("href") ?? "");
    };
    // Deferred, not called in the effect body: React's set-state-in-effect rule, and the page's
    // own hash is read after hydration either way.
    const first = window.setTimeout(onHash, 0);
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick);
    };
  }, []);
  useEffect(() => { if (focusNonce > 0) bodyRef.current?.focus(); }, [focusNonce]);
  const smsBlock = isSms ? smsFormBlock(smsGate, contactHasPhone, smsBlockedLine) : null;
```

In the JSX: the root becomes `<div className="w-full space-y-2">` with the two anchors first:

```tsx
      <span id="compose-sms" className="block scroll-mt-24" aria-hidden />
      <span id="compose-email" className="block scroll-mt-24" aria-hidden />
```

Replace the three SMS branches of the ladder (`isSms && !smsGate.ok`, `isSms && !contactHasPhone`, `isSms && smsBlockedLine`) with one:

```tsx
      ) : smsBlock ? (
        <p className="text-xs text-muted-foreground" data-testid={smsBlock.consent ? "composer-sms-blocked" : undefined}>{smsBlock.text}</p>
      ) : (
```

and give the `Textarea` `ref={bodyRef}`. Everything else (send handlers, toasts, the D-015 textarea) stays unchanged.

- [ ] **Step 4: Run the tests to see them pass, then lint**

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record
pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer.test.ts"
pnpm --filter web exec eslint "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer.tsx"
pnpm --filter web typecheck
```
Expected: `Tests  N passed`. Eslint has no errors. Typecheck **may fail** in `activity-timeline.tsx`/`page.tsx` only if they pass `null`, which they do not yet; widening a prop does not break a caller.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record
git --literal-pathspecs commit -m "feat(sms): the contact composer opens on the channel the record header links to, and an unreadable gate says so" -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer.test.ts"
```

---

### Task 7: Card bodies: today's cards moved in unchanged, plus Summary, Next up and Deals (bis-crm)

**Files** (all under `…/contacts/`):
- Modify: `[contactId]/contact-fields-panel.tsx` (split into two bodies, drop both `Card`s)
- Modify: `[contactId]/contact-fields-panel.assignee.test.ts` (render `ContactDetailsBody`)
- Modify: `[contactId]/activity-timeline.tsx` (drop the `Card`, move the composer to the top, id the To-do field, accept `SmsGate | null`)
- Modify: `[contactId]/constants.ts` (+ `ADD_TODO_FIELD_ID`)
- Modify: `groups-card.tsx`, `places-card.tsx`, `relationships-card.tsx` (+ `headingHidden`)
- Modify (append one `it` each): `groups-card.test.ts`, `places-card.test.ts`, `relationships-card.test.ts`
- Create: `[contactId]/summary-card.tsx`, `next-up-card.tsx`, `deals-card.tsx`, `focus-field-button.tsx`
- Test: `[contactId]/summary-card.test.ts`, `next-up-card.test.ts`, `deals-card.test.ts`, `activity-timeline.order.test.ts`, `contact-fields-panel.bodies.test.ts`

**Interfaces:**
- Consumes: `RecordCardRetry` (Task 4). `FactsView`, `NextUpView`, `Tr`, `makeTr` (Task 5). `SmsGate | null` on `MessageComposer` (Task 6).
- Produces:
  - `ContactDetailsBody(props)`: the old panel's props minus `tags` (`accountId, contactId, contact, fieldDefs, email, texts, canAssign?, members?, viewerId?`).
  - `ContactTagsBody({ accountId, contactId, tags })`.
  - `ActivityTimeline`: same props, with `smsGate: SmsGate | null`. It renders no card chrome or title, and the composer comes first.
  - `ADD_TODO_FIELD_ID = "record-add-todo"` (`constants.ts`).
  - `GroupsCard`/`GroupsCardView`, `PlacesCard`/`PlacesCardView`, `RelationshipsCard`/`RelationshipsCardView`: optional `headingHidden?: boolean`. When set, the card's own `h3` keeps its id for `aria-labelledby` but is `sr-only`.
  - `SummaryBody({ view: FactsView; retryLabel: string })`. `NextUpBody({ view: NextUpView; emptyText: string; addTodoLabel: string })`. `DealsBody({ deals: DealRow[]; tr: Tr })`, where `type DealRow = { id: string; name: string; status: string; monetary_value: number | string }`. `FocusFieldButton({ targetId: string; label: string })`.

- [ ] **Step 1: Write the failing tests**

`[contactId]/activity-timeline.order.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => createElement("div", { "data-composer-stub": "" }) }));
const { ActivityTimeline } = await import("./activity-timeline");
const { m } = await import("@/lib/messages");

const html = renderToStaticMarkup(createElement(ActivityTimeline, {
  accountId: "a1", contactId: "c1", contactHasEmail: true, contactHasPhone: false, smsGate: null,
  smsBlockedLine: null, emailNoticeLine: null,
  notes: [{ id: "n1", created_at: "2026-10-05T10:00:00Z", body: "first note" }],
  tasks: [], holdOpenTaskIds: [], opportunities: [], submissions: [], messages: [],
  emailAction: async () => {}, smsAction: async () => {}, timezone: "America/Chicago",
} as never));

describe("the timeline in its record card (S-03 part 1, spec §9.4)", () => {
  it("the composer comes first, then the add-To-do row, then the rows (mutation: move the composer back to the foot -> FAILS)", () => {
    const composer = html.indexOf("data-composer-stub");
    const todo = html.indexOf('id="record-add-todo"');
    const row = html.indexOf("first note");
    expect(composer).toBeGreaterThan(-1);
    expect(composer).toBeLessThan(todo);
    expect(todo).toBeLessThan(row);
  });
  it("carries no card chrome or title of its own: RecordCard's 'Activity' is the one seen (mutation: keep the Card -> FAILS)", () => {
    expect(html).not.toContain('data-slot="card"');
    expect(html).not.toContain(`>${m["contact.activity"]}<`);
  });
});
```

`[contactId]/contact-fields-panel.bodies.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("./actions", () => ({ updateContactAction: async () => {}, addTagAction: async () => {}, removeTagAction: async () => {} }));
vi.mock("../actions", () => ({ updateContactFieldAction: async () => ({ ok: true }), undoInlinePhoneEditAction: async () => ({ ok: true }) }));
vi.mock("../texts-row", () => ({ TextsRow: () => null }));
vi.mock("../email-row", () => ({ EmailRow: () => null }));
vi.mock("@/components/assign/assignee-field", () => ({ ContactAssigneeField: () => null }));
const { ContactDetailsBody, ContactTagsBody } = await import("./contact-fields-panel");

const CONTACT = { id: "ct1", first_name: "Ana", last_name: "Reyes", email: null, phone: null, company_name: null, custom: {}, source: null, attribution: null, assigned_to: null };

describe("the fields panel's two bodies, moved into record cards unchanged (spec §8)", () => {
  it("neither body carries a Card of its own (mutation: keep the Card wrapper -> FAILS)", () => {
    const details = renderToStaticMarkup(createElement(ContactDetailsBody, {
      accountId: "a1", contactId: "ct1", contact: CONTACT as never, fieldDefs: [], email: { status: "error" }, texts: { status: "error" },
    }));
    const tags = renderToStaticMarkup(createElement(ContactTagsBody, { accountId: "a1", contactId: "ct1", tags: [{ id: "t1", name: "VIP" }] as never }));
    expect(details).not.toContain('data-slot="card"');
    expect(tags).not.toContain('data-slot="card"');
    expect(details).toContain("data-assignee-row");
    expect(tags).toContain("VIP");
  });
});
```

`[contactId]/summary-card.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { SummaryBody } = await import("./summary-card");

describe("SummaryBody (spec §9.2)", () => {
  it("joins the facts with a middle dot", () => {
    const html = renderToStaticMarkup(createElement(SummaryBody, { view: { line: ["On your list since Dec 2025", "Booked once"], missing: null, allFailed: false }, retryLabel: "Try again" }));
    expect(html).toContain("On your list since Dec 2025 · Booked once");
    expect(html).not.toContain("Try again");
  });
  it("names what it could not count, with Try again (mutation: drop the missing line -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(SummaryBody, { view: { line: ["On your list since Dec 2025"], missing: "Couldn't count bookings.", allFailed: false }, retryLabel: "Try again" }));
    expect(html).toContain("Couldn&#x27;t count bookings.");
    expect(html).toContain(">Try again<");
  });
});
```

`[contactId]/next-up-card.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextUpBody } from "./next-up-card";

const props = { emptyText: "Nothing coming up.", addTodoLabel: "Add a To-do" };

describe("NextUpBody (spec §9.3)", () => {
  it("an overdue To-do is a dot AND a word (rule 3; mutation: drop the dot -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(NextUpBody, { ...props, view: { undated: null, rows: [
      { kind: "task", id: "t", title: "Call back", detail: "Overdue · was due Oct 1, 2026", overdue: true },
      { kind: "booking", id: "b", label: "Appointment · Fri, Oct 16 · 10:00 AM" },
    ] } }));
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*bg-\[var\(--warn\)\][^"]*"><\/span><span[^>]*>Overdue · was due Oct 1, 2026/);
    expect(html).toContain('data-next-up-row="booking"');
    expect(html).toContain("Appointment · Fri, Oct 16 · 10:00 AM");
  });
  it("empty: one sentence of what shows here and the action that causes it, plus the undated count", () => {
    const html = renderToStaticMarkup(createElement(NextUpBody, { ...props, view: { rows: [], undated: "2 more To-dos have no date." } }));
    expect(html).toContain("Nothing coming up.");
    expect(html).toContain(">Add a To-do<");
    expect(html).toContain("2 more To-dos have no date.");
  });
});
```

`[contactId]/deals-card.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DealsBody } from "./deals-card";
import { makeTr } from "@/lib/record/copy";

const DEALS = [
  { id: "d1", name: "Deck build", status: "open", monetary_value: "2400.00" },
  { id: "d2", name: "Fence", status: "won", monetary_value: 900 },
  { id: "d3", name: "Gate", status: "lost", monetary_value: 0 },
];

describe("DealsBody (spec §9.5, C10)", () => {
  it("each status is a dot AND a word (rule 3; mutation: drop the dot span -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(DealsBody, { deals: DEALS, tr: makeTr("en") }));
    expect(html.match(/data-deal-status="(open|won|lost)"/g)).toHaveLength(3);
    expect(html.match(/<span aria-hidden="true" class="size-\[7px\]/g)).toHaveLength(3);
    expect(html).toContain("$2,400");
    expect(html).toContain(">Open<");
  });
  it("Spanish words for the statuses and the empty state", () => {
    expect(renderToStaticMarkup(createElement(DealsBody, { deals: DEALS, tr: makeTr("es") }))).toContain(">Ganada<");
    expect(renderToStaticMarkup(createElement(DealsBody, { deals: [], tr: makeTr("es") }))).toContain("Todavía no hay ninguna.");
  });
});
```

`headingHidden`: append one `it` to each card test, using that file's own helpers and imports.

`groups-card.test.ts` (inside `describe("GroupsCardView"`):

```ts
  it("headingHidden keeps the heading for aria-labelledby but hides it, so RecordCard's title is the one seen (S-03 §8; mutation: ignore the prop -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(GroupsCardView, {
      accountId: "a1", contactId: "c1", canManageGroups: true, headingHidden: true, load: { status: "loading" } as never, onRetry: () => {}, onChanged: () => {},
    }));
    expect(html).toMatch(/<h3 id="([^"]+)" class="sr-only">/);
    const id = html.match(/<h3 id="([^"]+)"/)![1];
    expect(html).toContain(`aria-labelledby="${id}"`);
    expect(view({ status: "loading" })).not.toContain('class="sr-only"');
  });
```

`places-card.test.ts`:

```ts
  it("headingHidden hides the heading but keeps it labelling the section (S-03 §8; mutation: ignore the prop -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "en" } as ComponentProps<typeof LocaleProvider>,
      createElement(PlacesCardView, { accountId: "a1", contactId: C1, canMovePlace: true, headingHidden: true, load: { status: "loading" }, onRetry: noop, handlers })));
    expect(html).toMatch(/<h3 id="[^"]+" class="sr-only">/);
    expect(render("en", { status: "loading" })).not.toMatch(/<h3[^>]*class="sr-only"/);
  });
```

`relationships-card.test.ts`:

```ts
  it("headingHidden hides the heading but keeps it labelling the section (S-03 §8; mutation: ignore the prop -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "en" } as ComponentProps<typeof LocaleProvider>,
      createElement(RelationshipsCardView, { accountId: "a1", load: { status: "loading" }, onRetry: noop, onToggle: noop, onForm: noop, onRemove: noop, addSlot: null, headingHidden: true })));
    expect(html).toMatch(/<h3 id="[^"]+" class="sr-only">/);
    expect(render("en", { status: "loading" })).not.toMatch(/<h3[^>]*class="sr-only"/);
  });
```

Update `contact-fields-panel.assignee.test.ts`: `const { ContactDetailsBody } = await import("./contact-fields-panel");`, then `createElement(ContactDetailsBody, { … })` with the same props minus `tags`. Assertions are unchanged.

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record && pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts"`
Expected: the new files fail (`Failed to load url ./summary-card`; `ContactDetailsBody` undefined; the composer index after the row; no `sr-only` heading). Every pre-existing file in that directory still passes.

- [ ] **Step 3: Implement**

`constants.ts`, append:

```ts
/** The timeline's add-To-do title field; Next up's empty state focuses it (S-03 part 1, spec §9.3). */
export const ADD_TODO_FIELD_ID = "record-add-todo";
```

`activity-timeline.tsx`:
- Remove the `Card, CardContent, CardFooter, CardHeader, CardTitle` import. Import `ADD_TODO_FIELD_ID` from `./constants`. Change the prop type to `smsGate: SmsGate | null;`.
- Replace the returned tree with the following. The rows block (`items.length === 0 ? <EmptyState …/> : <ol>…</ol>`) moves unchanged.

```tsx
  return (
    // S-03 part 1 (spec §9.4): inside its RecordCard ("Activity"), so no card chrome or title here.
    // The composer comes first, where the header's Text and Email land; the rows are unchanged.
    <div className="space-y-4">
      <div className="border-b border-[var(--row-line)] pb-4" data-timeline-composer>
        <MessageComposer
          contactId={contactId}
          contactHasEmail={contactHasEmail}
          contactHasPhone={contactHasPhone}
          smsGate={smsGate}
          smsBlockedLine={smsBlockedLine}
          emailNoticeLine={emailNoticeLine}
          noteAction={boundAddNote}
          emailAction={emailAction}
          smsAction={smsAction}
        />
      </div>
      <form action={boundAddTask} aria-label={m["contact.tasks"]}
        className="flex flex-wrap items-center gap-2 rounded-[var(--radius-ctl)] border border-dashed border-[var(--line-strong)] p-2">
        {hidden}
        <Input id={ADD_TODO_FIELD_ID} name="title" placeholder={m["contact.addTask"]} className="h-8 min-w-[140px] flex-1 text-sm" />
        <Input name="dueAt" type="date" className="h-8 w-36 text-sm" />
        <Button type="submit" variant="outline" size="sm">{m["common.add"]}</Button>
      </form>
      {/* …the unchanged `items.length === 0 ? (<EmptyState …/>) : (<ol>…</ol>)` block… */}
    </div>
  );
```

`contact-fields-panel.tsx`: delete the `Card…` import and `ContactFieldsPanel`. Export the two bodies below. The inner JSX is moved verbatim from `:91-213` and `:222-247`, so the wiring test's source pins (`contact-drawer.wiring.test.ts:272-313`, `:402-410`) still match.

```tsx
type DetailsProps = {
  accountId: string; contactId: string; contact: Contact; fieldDefs: CustomFieldDef[];
  email: EmailLoad; texts: TextsLoad; canAssign?: boolean; members?: AssignMember[]; viewerId?: string | null;
};

/** The record page's "Contact Details" card body (S-03 §8): moved in unchanged, minus its Card. */
export function ContactDetailsBody({ accountId, contactId, contact, fieldDefs, email, texts, canAssign = false, members = [], viewerId = null }: DetailsProps) {
  const router = useRouter();
  const custom = (contact.custom ?? {}) as Record<string, unknown>;
  const sourceHint = contactSourceHint({ source: contact.source ?? null, custom: contact.custom, attribution: contact.attribution });
  const hidden = <input type="hidden" name="contactId" value={contactId} />;
  const boundUpdateContact = updateContactAction.bind(null, accountId);
  return (
    <div className="space-y-3">
      {/* :91-213 verbatim: the <dl> of FIELDS, Business name, SourceField, the Assigned-to row,
          TextsRow, EmailRow, and the custom-fields form. */}
    </div>
  );
}

/** The record page's "Tags" card body (S-03 §8): moved in unchanged, minus its Card. */
export function ContactTagsBody({ accountId, contactId, tags }: { accountId: string; contactId: string; tags: Tag[] }) {
  const hidden = <input type="hidden" name="contactId" value={contactId} />;
  const boundAddTag = addTagAction.bind(null, accountId);
  const boundRemoveTag = removeTagAction.bind(null, accountId);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* :223-246 verbatim: each tag's remove form, then the add-tag form. */}
    </div>
  );
}
```

`groups-card.tsx`: widen `type ViewProps` (`:35`) to `{ accountId: string; contactId: string; canManageGroups: boolean; headingHidden?: boolean }`, destructure `headingHidden` in `GroupsCardView` (`:219`), and set the `h3` (`:225`) to `className={headingHidden ? "sr-only" : "text-[13.5px] font-semibold text-card-foreground"}`. `GroupsCard` already spreads `props` into the view.

`places-card.tsx`: add `headingHidden?: boolean` to `PlacesCardView`'s props (`:282-283`) and to `PlacesCard`'s (`:328`), and pass it through. The `h3` (`:296`) becomes `className={headingHidden ? "sr-only" : "text-[13.5px] font-semibold text-card-foreground"}`.

`relationships-card.tsx`: add `headingHidden?: boolean;` to `CardViewProps` (`:22-30`) and to `RelationshipsCard`'s props (`:142`), and pass it. The `h3` (`:113`) becomes `className={headingHidden ? "sr-only" : "text-sm font-medium"}`.

`[contactId]/focus-field-button.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";

/** Next up's empty-state action (spec §9.3): moves focus to the timeline's To-do field. */
export function FocusFieldButton({ targetId, label }: { targetId: string; label: string }) {
  return (
    <Button type="button" size="sm" variant="ghost" className="min-h-11 md:min-h-8"
      onClick={() => {
        const el = document.getElementById(targetId);
        el?.scrollIntoView({ block: "center" });
        el?.focus();
      }}>
      {label}
    </Button>
  );
}
```

`[contactId]/summary-card.tsx`:

```tsx
import { RecordCardRetry } from "@/components/record/record-card";
import type { FactsView } from "@/lib/record/record-facts";

/** The summary card's body (spec §9.2): the checked facts first. No generated prose in part 1 (D1). */
export function SummaryBody({ view, retryLabel }: { view: FactsView; retryLabel: string }) {
  return (
    <div className="space-y-2">
      <p data-record-facts className="text-sm text-card-foreground tabular-nums [overflow-wrap:anywhere]">{view.line.join(" · ")}</p>
      {view.missing ? (
        <div data-record-facts-missing className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{view.missing}</span>
          <RecordCardRetry label={retryLabel} />
        </div>
      ) : null}
    </div>
  );
}
```

`[contactId]/next-up-card.tsx`:

```tsx
import type { NextUpView } from "@/lib/record/next-up";
import { ADD_TODO_FIELD_ID } from "./constants";
import { FocusFieldButton } from "./focus-field-button";

/** Next up (spec §9.3): read-only rows; Done stays on the timeline. Rows are --row-line rules. */
export function NextUpBody({ view, emptyText, addTodoLabel }: { view: NextUpView; emptyText: string; addTodoLabel: string }) {
  const undated = view.undated ? <p className="text-xs text-muted-foreground">{view.undated}</p> : null;
  if (view.rows.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{emptyText}</p>
        {undated}
        <FocusFieldButton targetId={ADD_TODO_FIELD_ID} label={addTodoLabel} />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <ul className="flex flex-col text-sm">
        {view.rows.map((r) => (
          <li key={`${r.kind}-${r.id}`} data-next-up-row={r.kind} className="border-t border-[var(--row-line)] py-[7px] first:border-t-0">
            {r.kind === "booking" ? (
              <p className="tabular-nums text-card-foreground">{r.label}</p>
            ) : (
              <>
                <p className="truncate font-medium text-card-foreground" title={r.title}>{r.title}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                  {r.overdue ? <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-[var(--warn)]" /> : null}
                  <span className={r.overdue ? "text-[var(--warn)]" : undefined}>{r.detail}</span>
                </p>
              </>
            )}
          </li>
        ))}
      </ul>
      {undated}
    </div>
  );
}
```

`[contactId]/deals-card.tsx`:

```tsx
import { formatCurrency } from "@/lib/format";
import type { Tr } from "@/lib/record/copy";

export type DealRow = { id: string; name: string; status: string; monetary_value: number | string };

const STATUS = {
  open: { key: "pipeline.status.open", dot: "bg-[var(--accent)]" },
  won: { key: "pipeline.status.won", dot: "bg-[var(--good)]" },
  lost: { key: "pipeline.status.lost", dot: "bg-[var(--text-3)]" },
} as const;

/** Deals (spec §9.5, C10): today's rows, now with a dot on the status word, in the page's language. */
export function DealsBody({ deals, tr }: { deals: DealRow[]; tr: Tr }) {
  if (deals.length === 0) return <p className="text-sm text-muted-foreground">{tr.text("contact.noOpportunities")}</p>;
  return (
    <ul className="flex flex-col text-sm">
      {deals.map((o) => {
        const s = STATUS[o.status as keyof typeof STATUS];
        return (
          <li key={o.id} className="border-t border-[var(--row-line)] py-[7px] first:border-t-0">
            <p className="truncate font-medium" title={o.name}>{o.name}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
              {formatCurrency(Number(o.monetary_value), tr.locale)} ·
              <span data-deal-status={o.status} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`size-[7px] shrink-0 rounded-full ${s?.dot ?? "bg-[var(--text-3)]"}`} />
                <span>{s ? tr.text(s.key) : o.status}</span>
              </span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Run them to see them pass, plus the directory and the ratchet**

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record
pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" src/lib/i18n/ratchet.test.ts
pnpm --filter web typecheck
pnpm --filter web exec eslint "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts"
```
Expected: every file passes, including the untouched `activity-timeline.*.test.ts` (the spec requires they pass unchanged), `contact-drawer.wiring.test.ts` and `groups-card.wiring.test.ts`. `typecheck` **fails in `[contactId]/page.tsx`** (it still imports `ContactFieldsPanel`), which is expected until Task 8; paste that single error. The ratchet passes, since the new files' copy all goes through `tr`/props. Paste the probe lines: the composer at the foot, a kept Card, a dropped dot, an ignored `headingHidden`.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record
C="apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts"
D="$C/[contactId]"
NEW=("$D/summary-card.tsx" "$D/summary-card.test.ts" "$D/next-up-card.tsx" "$D/next-up-card.test.ts" "$D/deals-card.tsx" "$D/deals-card.test.ts" "$D/focus-field-button.tsx" "$D/activity-timeline.order.test.ts" "$D/contact-fields-panel.bodies.test.ts")
git --literal-pathspecs add -- "${NEW[@]}"
git --literal-pathspecs commit -m "feat(contacts): record card bodies: timeline composer first, fields split, Summary/Next up/Deals, hidden card headings" -- "${NEW[@]}" "$D/activity-timeline.tsx" "$D/contact-fields-panel.tsx" "$D/contact-fields-panel.assignee.test.ts" "$D/constants.ts" "$C/groups-card.tsx" "$C/groups-card.test.ts" "$C/places-card.tsx" "$C/places-card.test.ts" "$C/relationships-card.tsx" "$C/relationships-card.test.ts"
```

(Explicit files only, never the directory: the worktree may be shared, and `page.tsx` is Task 8's. `--literal-pathspecs` stops `[accountId]`/`[contactId]` being read as glob character classes; git also matched them literally in a check on this worktree, but the flag removes the doubt.)

---

### Task 8: The page: one loader per card, the layout, the header and the locale (bis-crm)

**Files:**
- Create: `apps/web/src/lib/record/loaders.ts`
- Modify: `…/contacts/[contactId]/page.tsx` (rebuilt)
- Test: `…/contacts/[contactId]/page.test.ts` (mocks extended, two expectations updated, a new `describe`)
- Modify: `docs/crm-features.md:801`, `:805` (marked shipped; spec §15 puts this on the orchestrator, and it ships here because 1a is the PR that carries the record page)

**Interfaces:**
- Consumes: everything from Tasks 3–7. `requestLocale`/`requestPseudoMode` (`lib/i18n/request-locale.ts:35`, `:85`). `getPersonPrefs` (`lib/preferences/person-prefs.ts:72`). `LocaleProvider` (`components/locale-provider.tsx`).
- Produces (`loaders.ts`):
  - `type SummaryLoad = { status: "ready"; facts: ContactFacts } | { status: "error" }`. `loadSummary(db, accountId, contactId): Promise<SummaryLoad>` returns error only when all three facts failed, or if `contactFacts` itself threw.
  - `type NextUpLoad = { status: "ready"; data: ContactNextUp } | { status: "error" }`. `loadNextUp(db, accountId, contactId, now: Date)`.
  - `type TimelineLoad = { status: "ready"; notes; tasks; opportunities; submissions; messages; holdOpen: string[] } | { status: "error" }`. `loadTimeline(db, ledger, accountId, contactId)`.
  - `type DealsLoad = { status: "ready"; deals: DealRow[] } | { status: "error" }`. `loadDeals(db, accountId, contactId)`.
  - `type TagsLoad`, `type FieldDefsLoad`; `loadTags(db, accountId, contactId)`, `loadFieldDefs(db, accountId)`.
  - `loadHeaderPlaces(db, accountId, contactId): Promise<ContactPlaces | null>` (soft); `softSmsGate(db, accountId): Promise<SmsGate | null>` (soft).

**Deviations, recorded:**
1. **One header read, not two.** The spec names `listContactGroups` for the group line and `listContactPlaces` for Directions. `listContactPlaces` already returns the customer's groups, primary first with `isPrimary` (`places.ts:149-158`). `listContactGroups` costs one more read **per group** for its "others" list (`client-groups.ts:107-117`). The header makes the one `listContactPlaces` read; a failure drops both the group line and Directions, and logs.
2. **Tags and the custom-field definitions become soft loads too.** The spec lists them under no PR, but they are the Details and Tags cards' own reads, and a throw there is the same "page blanks" defect C5 closes.
3. **`lang`.** The page root carries `lang={locale}` (spec §9.6). The two bodies that stay English in 1a (the timeline rows, the fields panel) are wrapped in `lang="en"`, so a Spanish page does not mark English text as Spanish. This follows the account layout's own decision D (`[accountId]/layout.tsx:66-70`: `lang` only on converted parts).
4. **`requestLocale`'s `account` argument is a named variable**, not an inline `{ language }` literal. `request-locale-callers.test.ts:17` scans each call with a lazy `\{([\s\S]*?)\}\s*[,)]`, which would stop at an inner object's `}` and miss `userLanguage`.

- [ ] **Step 1: Extend `page.test.ts` first (failing)**

Mocks, at the top of the file:
- In the `vi.mock("@bis/db", …)` factory (`:52-65`), add:

```ts
  contactFacts: (...args: unknown[]) => contactFactsMock(...args),
  contactNextUp: (...args: unknown[]) => contactNextUpMock(...args),
  listContactPlaces: (...args: unknown[]) => listContactPlacesMock(...args),
  listContactOpportunities: (...args: unknown[]) => listContactOpportunitiesMock(...args),
  listNotes: (...args: unknown[]) => listNotesMock(...args),
```

  replacing the two existing `async () => []` lines for `listNotes`/`listContactOpportunities`. Declare above it:

```ts
const READY_FACTS = { bookingsMade: { ok: true, value: 0 }, lastTalked: { ok: true, value: null }, openDeals: { ok: true, value: { count: 0, amount: null } } };
const NO_PLACES = { groups: [], places: [], placeCount: 0, equipment: [], equipmentCount: 0 };
const contactFactsMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => READY_FACTS);
const contactNextUpMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ bookings: [], datedTasks: [], undatedCount: 0 }));
const listContactPlacesMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => NO_PLACES);
const listContactOpportunitiesMock = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const listNotesMock = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const prefsMock = vi.fn(async () => ({ language: null as "en" | "es" | null, theme: null }));
const timelineThrows = vi.hoisted(() => ({ on: false }));
```

- Add:

```ts
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: () => prefsMock() }));
// A desk: the three "have" cards render open, so their props and markers can be read.
vi.mock("@/components/record/use-phone", () => ({ usePhone: () => false, PHONE_QUERY: "(max-width: 767px)" }));
```

- Change the `ActivityTimeline` mock to throw on demand: `ActivityTimeline: (props: Record<string, unknown>) => { timelineProps(props); if (timelineThrows.on) throw new Error("timeline render boom"); return null; }`.
- Make `resolveSmsSender` a spy-able function: `vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => resolveSmsSenderMock(...a) }));` with `const resolveSmsSenderMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ ok: false, reason: "a2p_not_approved" }));`.
- `CONTACT` gains `created_at: "2026-01-01T05:30:00Z"`.

Update two existing expectations. Their probes still stand.
- Relationships (`:519`): `toContainEqual({ accountId: "acct1", contactId: "ct1", headingHidden: true })`.
- Properties (`:534-551`): props become `{ accountId: "acct1", contactId: "ct1", canMovePlace: true, headingHidden: true }` (and `false` for the Technician). Replace the `data-places-aside`/`contact.opportunities` index check with a registry-order check: `expect(order(html).slice(3, 6)).toEqual(["groups", "properties", "deals"])`, using the helper below.

New `describe` at the end:

```ts
const order = (html: string) => [...html.matchAll(/data-record-card="([\w-]+)"/g)].map((x) => x[1]);
const cardHtml = (html: string, id: string) => html.match(new RegExp(`<section[^>]*data-record-card="${id}"[\\s\\S]*?</section>`))?.[0] ?? "";

describe("the record page (S-03 part 1, 1a): every card loads and fails on its own", () => {
  beforeEach(() => {
    getContactMock.mockReset().mockResolvedValue(CONTACT);
    recipientState.mockReset().mockResolvedValue({ kind: "ok" });
    emailRecipientStateMock.mockReset().mockResolvedValue({ kind: "ok" });
    readTextsView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    readEmailView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    contactFactsMock.mockReset().mockResolvedValue(READY_FACTS);
    contactNextUpMock.mockReset().mockResolvedValue({ bookings: [], datedTasks: [], undatedCount: 0 });
    listContactPlacesMock.mockReset().mockResolvedValue(NO_PLACES);
    listContactOpportunitiesMock.mockReset().mockResolvedValue([]);
    listNotesMock.mockReset().mockResolvedValue([]);
    prefsMock.mockReset().mockResolvedValue({ language: null, theme: null });
    resolveSmsSenderMock.mockReset().mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    timelineProps.mockClear();
    timelineThrows.on = false;
  });

  it("renders the nine cards in the phone order, which is the DOM order on every width (C6; mutation: render the who column first -> FAILS)", async () => {
    expect(order(await render())).toEqual(["summary", "next-up", "timeline", "groups", "properties", "deals", "details", "tags", "related-people"]);
  });

  it("the timeline's reads failing is the timeline's error, and every other card still renders (mutation: let loadTimeline rethrow, as today's Promise.all did -> the render rejects, FAILS)", async () => {
    listNotesMock.mockRejectedValue(new Error("notes read down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render();
      expect(cardHtml(html, "timeline")).toContain(m["record.activity.failed"].replace("'", "&#x27;"));
      expect(timelineProps).not.toHaveBeenCalled();
      expect(cardHtml(html, "summary")).toContain("On your list since Dec 2025");
      expect(cardHtml(html, "next-up")).toContain(m["record.nextUp.empty"]);
    } finally { errors.mockRestore(); }
  });

  it("the summary failing is the summary's error, the rest stand (mutation: let loadSummary rethrow -> FAILS)", async () => {
    contactFactsMock.mockRejectedValue(new Error("facts down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render();
      expect(cardHtml(html, "summary")).toContain(m["record.summary.failed"].replace("'", "&#x27;"));
      expect(timelineProps).toHaveBeenCalled();
    } finally { errors.mockRestore(); }
  });

  it("Next up failing is Next up's error, the rest stand (mutation: let loadNextUp rethrow -> FAILS)", async () => {
    contactNextUpMock.mockRejectedValue(new Error("next up down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render();
      expect(cardHtml(html, "next-up")).toContain(m["record.nextUp.failed"].replace("'", "&#x27;"));
      expect(cardHtml(html, "summary")).toContain("On your list since Dec 2025");
    } finally { errors.mockRestore(); }
  });

  it("Deals failing is Deals' error and the timeline still renders (its own read of the same table succeeds; mutation: let loadDeals rethrow -> FAILS)", async () => {
    // Promise.all invokes loadTimeline before loadDeals, and each makes its read synchronously at
    // its start: the first call is the timeline's, the second the Deals card's.
    listContactOpportunitiesMock.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("deals down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render();
      expect(cardHtml(html, "deals")).toContain("data-record-error");
      expect(timelineProps).toHaveBeenCalled();
    } finally { errors.mockRestore(); }
  });

  it("a render throw inside one card is that card's skeleton on the server, and the page still renders (C5; mutation: drop RecordCardBoundary's Suspense -> the render rejects, FAILS)", async () => {
    timelineThrows.on = true;
    const html = await render();
    expect(cardHtml(html, "timeline")).toContain("data-record-skeleton");
    expect(cardHtml(html, "summary")).toContain("On your list since Dec 2025");
  });

  it("the header: Call is the one primary, Email links to its composer, Text is hidden while the gate is closed, Directions takes the first addressed property, and the group is plain text (§9.1, C7)", async () => {
    getContactMock.mockResolvedValue({ ...CONTACT, phone: "+19565550100" });
    listContactPlacesMock.mockResolvedValue({
      ...NO_PLACES, groups: [{ id: "g1", kind: "household", name: "García", isPrimary: true }],
      places: [{ id: "p1", account_id: "acct1", contact_id: "ct1", client_group_id: null, label: null, address: "1204 Nolana Ave",
        landmark: null, directions: null, city: "McAllen", region: "TX", postal_code: "78504", country: "US", archived_at: null,
        created_by: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
    });
    const html = await render();
    expect([...html.matchAll(/data-record-action="(\w+)"/g)].map((x) => x[1])).toEqual(["call", "email", "directions"]);
    expect(html).toContain('href="tel:+19565550100"');
    expect(html).toContain('href="#compose-email"');
    expect(html.match(/data-variant="default"[^>]*data-record-action|data-record-action="call"[^>]*data-variant="default"/g)).toHaveLength(1);
    expect(html).toContain(encodeURIComponent("1204 Nolana Ave"));
    expect(html).toMatch(/data-record-subtitle[^>]*>García · Household</);
  });

  it("a failed places read drops the group line and Directions, never the header (spec §7; mutation: let loadHeaderPlaces rethrow -> FAILS)", async () => {
    listContactPlacesMock.mockRejectedValue(new Error("places down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render();
      expect(html).toContain("data-record-header");
      expect(html).not.toContain("data-record-subtitle");
      expect(html).not.toContain('data-record-action="directions"');
    } finally { errors.mockRestore(); }
  });

  it("a person whose language is Spanish gets the converted parts in Spanish, with lang set (§9.6; mutation: drop userLanguage from requestLocale -> English, FAILS)", async () => {
    prefsMock.mockResolvedValue({ language: "es", theme: null });
    getContactMock.mockResolvedValue({ ...CONTACT, phone: "+19565550100" });
    const html = await render();
    expect(html).toMatch(/data-record-layout[^>]*lang="es"|lang="es"[^>]*data-record-layout/);
    expect(html).toContain(`>${m["record.action.call.es"]}<`);
    expect(html).toContain(m["record.card.nextUp.es"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record && pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.test.ts"`
Expected: FAIL. The page still imports `ContactFieldsPanel` (removed in Task 7), so the suite fails to load with `does not provide an export named 'ContactFieldsPanel'`. After a quick stub fix, the new assertions fail on `order(...)` being `[]`.

- [ ] **Step 3: Implement `apps/web/src/lib/record/loaders.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contactFacts, contactNextUp, listNotes, listContactTasks, holdOpenTaskIds, listContactOpportunities,
  listContactSubmissions, listContactMessages, listContactPlaces, listContactTags, listCustomFields,
  type ContactFacts, type ContactNextUp, type ContactPlaces, type CustomFieldDef,
} from "@bis/db";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { loggableError } from "@/lib/loggable-error";

/**
 * One loader per record card (S-03 part 1, spec C5): each returns a load and NEVER throws, so one
 * card's failed read is that card's error state and never the page's. Logs name the card and the
 * account, never the customer's data (spec §11).
 */
const log = (card: string, accountId: string, e: unknown) =>
  console.error(`record page: ${card} read failed for account ${accountId}: ${loggableError(e)}`);

export type SummaryLoad = { status: "ready"; facts: ContactFacts } | { status: "error" };
export async function loadSummary(db: SupabaseClient, accountId: string, contactId: string): Promise<SummaryLoad> {
  try {
    const facts = await contactFacts(db, accountId, contactId, { onError: (name, e) => log(`summary (${name})`, accountId, e) });
    const allFailed = !facts.bookingsMade.ok && !facts.lastTalked.ok && !facts.openDeals.ok;
    return allFailed ? { status: "error" } : { status: "ready", facts };
  } catch (e) {
    log("summary", accountId, e);
    return { status: "error" };
  }
}

export type NextUpLoad = { status: "ready"; data: ContactNextUp } | { status: "error" };
export async function loadNextUp(db: SupabaseClient, accountId: string, contactId: string, now: Date): Promise<NextUpLoad> {
  try {
    return { status: "ready", data: await contactNextUp(db, accountId, contactId, now.toISOString()) };
  } catch (e) {
    log("next up", accountId, e);
    return { status: "error" };
  }
}

type Notes = NonNullable<Awaited<ReturnType<typeof listNotes>>>;
type Tasks = Awaited<ReturnType<typeof listContactTasks>>;
type Opps = NonNullable<Awaited<ReturnType<typeof listContactOpportunities>>>;
type Subs = Awaited<ReturnType<typeof listContactSubmissions>>;
type Msgs = Awaited<ReturnType<typeof listContactMessages>>;
export type TimelineLoad =
  | { status: "ready"; notes: Notes; tasks: Tasks; opportunities: Opps; submissions: Subs; messages: Msgs; holdOpen: string[] }
  | { status: "error" };

/** Today's five reads plus the hold check, unchanged and still uncapped (1b pages them), now inside the card. */
export async function loadTimeline(db: SupabaseClient, ledger: SupabaseClient, accountId: string, contactId: string): Promise<TimelineLoad> {
  let notes: Notes, tasks: Tasks, opportunities: Opps, submissions: Subs, messages: Msgs;
  try {
    [notes, tasks, opportunities, submissions, messages] = await Promise.all([
      listNotes(db, accountId, contactId).then((r) => r ?? []),
      listContactTasks(db, accountId, contactId),
      listContactOpportunities(db, accountId, contactId).then((r) => r ?? []),
      listContactSubmissions(db, accountId, contactId),
      listContactMessages(db, accountId, contactId),
    ]);
  } catch (e) {
    log("activity", accountId, e);
    return { status: "error" };
  }
  // Review R3-N1 (G21): a To-do whose number is still on hold is closed by deciding the hold, never by
  // "Done". A failed read fails CLOSED: every open linked To-do gets the hint (moved from page.tsx).
  let holdOpen: string[];
  try {
    holdOpen = await holdOpenTaskIds(db, accountId, tasks, ledger);
  } catch (e) {
    console.error(`contact page: hold To-dos unreadable for contact ${contactId}: ${loggableError(e)}`);
    holdOpen = tasks.filter((t) => !t.completed_at && t.consent_event_id).map((t) => t.id);
  }
  return { status: "ready", notes, tasks, opportunities, submissions, messages, holdOpen };
}

// The read's own row type (DealsBody's `DealRow` is structurally the same); lib never imports from app/.
export type DealsLoad = { status: "ready"; deals: Opps } | { status: "error" };
export async function loadDeals(db: SupabaseClient, accountId: string, contactId: string): Promise<DealsLoad> {
  try {
    return { status: "ready", deals: (await listContactOpportunities(db, accountId, contactId)) ?? [] };
  } catch (e) {
    log("deals", accountId, e);
    return { status: "error" };
  }
}

type Tags = Awaited<ReturnType<typeof listContactTags>>;
export type TagsLoad = { status: "ready"; tags: Tags } | { status: "error" };
export async function loadTags(db: SupabaseClient, accountId: string, contactId: string): Promise<TagsLoad> {
  try {
    return { status: "ready", tags: await listContactTags(db, accountId, contactId) };
  } catch (e) {
    log("tags", accountId, e);
    return { status: "error" };
  }
}

export type FieldDefsLoad = { status: "ready"; fieldDefs: CustomFieldDef[] } | { status: "error" };
export async function loadFieldDefs(db: SupabaseClient, accountId: string): Promise<FieldDefsLoad> {
  try {
    return { status: "ready", fieldDefs: await listCustomFields(db, accountId, "contact") };
  } catch (e) {
    log("custom fields", accountId, e);
    return { status: "error" };
  }
}

/** The header's group line and Directions (spec §7): soft, so a failure drops them, never the header. */
export async function loadHeaderPlaces(db: SupabaseClient, accountId: string, contactId: string): Promise<ContactPlaces | null> {
  try {
    return await listContactPlaces(db, accountId, contactId);
  } catch (e) {
    log("header places", accountId, e);
    return null;
  }
}

/** THE send gate, read soft (spec §7): null on a failed read, which hides Text and makes the composer say "unknown". */
export async function softSmsGate(db: SupabaseClient, accountId: string): Promise<SmsGate | null> {
  try {
    return await resolveSmsSender(db, accountId);
  } catch (e) {
    log("text gate", accountId, e);
    return null;
  }
}
```

If `listContactTags`/`listCustomFields`/`listContactSubmissions` return types differ from what is assumed here, read them from `packages/db/src/contacts.ts`/`crm-config.ts`/`forms.ts` and type to the source (working rule 1). Say so in the report.

- [ ] **Step 4: Implement `page.tsx`** (full replacement)

```tsx
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getContact } from "@bis/db";
import { contactDisplayName } from "@/lib/format";
import { dbForRequest } from "@/lib/db";
import { requireAccountAccess } from "@/lib/auth";
import { loadAssignView, type AssignView } from "@/lib/assign/view";
import type { MessageKey } from "@/lib/messages";
import { LocaleProvider } from "@/components/locale-provider";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordHeader, type RecordHeaderAction } from "@/components/record/record-header";
import { RecordCard, type RecordCardState } from "@/components/record/record-card";
import { columnRuns, type RecordCardId } from "@/lib/record/record-cards";
import { makeTr } from "@/lib/record/copy";
import { factsView } from "@/lib/record/record-facts";
import { nextUpView } from "@/lib/record/next-up";
import { headerActions, canTextFrom, firstMapUrl, type HeaderActionId } from "@/lib/record/header-actions";
import {
  loadSummary, loadNextUp, loadTimeline, loadDeals, loadTags, loadFieldDefs, loadHeaderPlaces, softSmsGate,
} from "@/lib/record/loaders";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import type { Locale } from "@/lib/i18n/locale";
import { ContactDetailsBody, ContactTagsBody } from "./contact-fields-panel";
import { RelationshipsCard } from "../relationships-card";
import { ActivityTimeline } from "./activity-timeline";
import { GroupsCard } from "../groups-card";
import { PlacesCard } from "../places-card";
import { SummaryBody } from "./summary-card";
import { NextUpBody } from "./next-up-card";
import { DealsBody } from "./deals-card";
import { sendEmailAction, sendSmsAction } from "../../conversations/actions";
import { e164Of } from "@/lib/voice/phone-number";
import { smsRecipientState, emailRecipientState } from "@/lib/consent/recipient-state";
import { readTextsView } from "@/lib/consent/texts-view";
import type { TextsLoad } from "@/lib/consent/texts-row";
import { readEmailView } from "@/lib/consent/email-view";
import { ledgerDb } from "@/lib/consent/ledger-db";
import type { EmailLoad } from "@/lib/consent/email-row";
import { loggableError } from "@/lib/loggable-error";
import { composerStateLine, composerEmailNotice } from "@/lib/consent/composer-state";
import { renderZone } from "@/lib/zone";

export const dynamic = "force-dynamic";

/** "Assigned to" with nothing known: no picker, no team, no viewer (M4). */
const READ_ONLY_ASSIGN: AssignView = {
  who: "all", personId: null, assignee: undefined, canAssign: false, showMine: false, members: [],
};

const ACTION_KEY = {
  call: "record.action.call", text: "record.action.text", email: "record.action.email", directions: "record.action.directions",
} as const satisfies Record<HeaderActionId, MessageKey>;

type Slot = { node: ReactNode; state?: RecordCardState; errorText?: string };

/**
 * The contact record page (S-03 part 1, 1a; spec §§8–9). Three columns on a desk (who they are |
 * what is happening | what they have); one column on a phone in the order a person acts in. Every
 * card has its own loader (never throws) and its own boundary, so one card's fault never blanks the page.
 */
export default async function ContactDetailPage({
  params, searchParams,
}: {
  params: Promise<{ accountId: string; contactId: string }>;
  // Optional, as dashboard/page.tsx's: the QA locale override (`?locale=es|pseudo`, BIS_I18N_QA only).
  searchParams?: Promise<{ locale?: string }>;
}) {
  const { accountId, contactId } = await params;
  const { locale: localeParam } = (await searchParams) ?? {};
  // F-085 part 1 (spec §9): the caller's role decides whether "Assigned to" is a picker.
  const access = await requireAccountAccess(accountId);
  const db = await dbForRequest();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) notFound();
  // F-085 (spec §7.3): consent DISPLAY reads go through the ledger client, built only here, after
  // getContact on the request client proved the contact is the caller's to see.
  const ledger = ledgerDb();
  const now = new Date();
  const [prefs, tags, fieldDefs, smsGate, account, smsRecipient, assign, summary, nextUp, timeline, deals, places] = await Promise.all([
    getPersonPrefs(),
    loadTags(db, accountId, contactId),
    loadFieldDefs(db, accountId),
    softSmsGate(db, accountId),
    // The account's zone (dates) and language (a client's default locale), one row.
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle(),
    smsRecipientState(ledger, accountId, contact),
    loadAssignView(db, accountId, access, undefined, { members: true, viewer: true }).catch((e: unknown) => {
      console.error(`contact page: assignment read failed for account ${accountId}, Assigned to is read-only: ${loggableError(e)}`);
      return READ_ONLY_ASSIGN;
    }),
    loadSummary(db, accountId, contactId),
    loadNextUp(db, accountId, contactId, now),
    loadTimeline(db, ledger, accountId, contactId),
    loadDeals(db, accountId, contactId),
    loadHeaderPlaces(db, accountId, contactId),
  ]);
  const emailRecipient = await emailRecipientState(ledger, accountId, contact);
  if (account.error) {
    console.error(`contact page: account ${accountId} timezone read failed: ${account.error.message}`);
  }
  const accountRow = account.data as { timezone: string; language?: Locale | null } | null;
  const zone = await renderZone(accountRow?.timezone);
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: accountRow?.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, { locale: localeParam });
  const tr = makeTr(locale, requestPseudoMode({ locale: localeParam }));

  let texts: TextsLoad;
  try {
    texts = { status: "ready", view: await readTextsView(ledger, accountId, contact), zone: zone.zone, phone: contact.phone ?? null };
  } catch (e) {
    console.error(`contact page: Texts row unreadable for contact ${contactId}: ${loggableError(e)}`);
    texts = { status: "error" };
  }
  let email: EmailLoad;
  try {
    email = { status: "ready", view: await readEmailView(ledger, accountId, contact), zone: zone.zone };
  } catch (e) {
    console.error(`contact page: Email row unreadable for contact ${contactId}: ${loggableError(e)}`);
    email = { status: "error" };
  }

  const smsBlockedLine = composerStateLine(smsRecipient, zone.zone);
  const name = contactDisplayName(contact);
  const mainGroup = places?.groups.find((g) => g.isPrimary) ?? places?.groups[0] ?? null;
  const subtitle = mainGroup
    ? tr.text(mainGroup.kind === "household" ? "record.group.household" : "record.group.business", { group: mainGroup.name })
    : null;
  const actions: RecordHeaderAction[] = headerActions({
    phone: contact.phone ?? null,
    email: contact.email ?? null,
    canText: canTextFrom({ phone: contact.phone ?? null, smsGate, smsBlockedLine }),
    directionsUrl: places ? firstMapUrl(places.places, contactId, places.groups) : null,
  }).map((a) => ({
    ...a,
    label: tr.text(ACTION_KEY[a.id]),
    ariaLabel: a.id === "call" ? tr.text("record.action.callAria", { name }) : undefined,
  }));

  const failed = (errorText: string): Slot => ({ node: null, state: "error", errorText });
  const cardFailed = (titleKey: MessageKey) => failed(tr.text("record.card.failed", { title: tr.text(titleKey) }));
  const slots = {
    summary: summary.status === "ready"
      ? { node: <SummaryBody view={factsView({ createdAt: contact.created_at, facts: summary.facts }, { zone: zone.zone, now, tr })} retryLabel={tr.text("record.card.retry")} /> }
      : failed(tr.text("record.summary.failed")),
    "next-up": nextUp.status === "ready"
      ? { node: <NextUpBody view={nextUpView(nextUp.data, { zone: zone.zone, now, tr })} emptyText={tr.text("record.nextUp.empty")} addTodoLabel={tr.text("record.nextUp.addTodo")} /> }
      : failed(tr.text("record.nextUp.failed")),
    timeline: timeline.status === "ready"
      ? {
        node: (
          // The rows stay English in 1a (spec §9.6); 1b makes them bilingual.
          <div lang="en">
            <ActivityTimeline
              accountId={accountId}
              contactId={contactId}
              contactHasEmail={Boolean(contact.email)}
              contactHasPhone={Boolean(e164Of(contact.phone))}
              smsGate={smsGate}
              smsBlockedLine={smsBlockedLine}
              emailNoticeLine={composerEmailNotice(emailRecipient, zone.zone)}
              notes={timeline.notes}
              tasks={timeline.tasks}
              holdOpenTaskIds={timeline.holdOpen}
              opportunities={timeline.opportunities}
              submissions={timeline.submissions}
              messages={timeline.messages}
              emailAction={sendEmailAction.bind(null, accountId)}
              smsAction={sendSmsAction.bind(null, accountId)}
              timezone={zone.zone}
              canAssign={assign.canAssign}
              members={assign.members}
            />
          </div>
        ),
      }
      : failed(tr.text("record.activity.failed")),
    groups: { node: <GroupsCard accountId={accountId} contactId={contactId} canManageGroups={assign.canAssign} headingHidden /> },
    properties: { node: <PlacesCard accountId={accountId} contactId={contactId} canMovePlace={assign.canAssign} headingHidden /> },
    deals: deals.status === "ready" ? { node: <DealsBody deals={deals.deals} tr={tr} /> } : cardFailed("record.card.deals"),
    details: fieldDefs.status === "ready"
      ? {
        node: (
          // The fields panel stays English until part 3 (D12).
          <div lang="en">
            <ContactDetailsBody accountId={accountId} contactId={contactId} contact={contact} fieldDefs={fieldDefs.fieldDefs}
              email={email} texts={texts} canAssign={assign.canAssign} members={assign.members} viewerId={assign.personId} />
          </div>
        ),
      }
      : cardFailed("contact.details"),
    tags: tags.status === "ready"
      ? { node: <div lang="en"><ContactTagsBody accountId={accountId} contactId={contactId} tags={tags.tags} /></div> }
      : cardFailed("contact.tags"),
    "related-people": { node: <RelationshipsCard accountId={accountId} contactId={contactId} headingHidden /> },
  } satisfies Record<RecordCardId, Slot>;

  const columns = columnRuns().map(({ column, cards }) => ({
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
    // The page's own locale reaches the client cards too (a `?locale=` QA override the layout never sees).
    <LocaleProvider locale={locale}>
      <RecordLayout
        lang={locale}
        skipLabel={tr.text("record.skipToDetails")}
        header={<RecordHeader name={name} subtitle={subtitle} actions={actions}
          back={{ href: `/dashboard/accounts/${accountId}/contacts`, label: tr.text("record.back") }} />}
        columns={columns}
      />
    </LocaleProvider>
  );
}
```

- [ ] **Step 5: `docs/crm-features.md`.** Replace line 801:

```
| **Fixed 2026-10-09 (D-010, `9bf19e0b`):** timeline times and the list's "Created" date render in the company's zone, not the server's or browser's | `.../contacts/[contactId]/activity-timeline.tsx:211-218`; `.../contacts/contacts-table.tsx:294` | shipped |
```

and line 805:

```
| **Fixed 2026-10-08 (D-014, `752c070f`):** the timeline prints the status label ("Failed", "Sent"), not the raw value | `.../contacts/[contactId]/activity-timeline.tsx:376-386` | shipped |
```

The cited lines were checked when this plan was written, at `aa0a448b`: `activity-timeline.tsx:211-218` and `:376-386`, `contacts-table.tsx:294`. Re-check them after Task 7 moves code; the line numbers will shift, so cite whatever the file then shows. Line `:2623`'s "draws dates in the server's zone" and "prints raw statuses" are stale for the same reason: **report it for the orchestrator, do not edit it.** It is §6.3's prose, and the spec did not assign it.

- [ ] **Step 6: Run the page, the directory, the guards and the typecheck**

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record
pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" src/lib/record src/components/record src/lib/i18n src/lib/messages.test.ts
pnpm --filter web typecheck
pnpm --filter web exec eslint src/lib/record "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.tsx"
```
Expected: every file passes. Paste the `Test Files` line, including `request-locale-callers.test.ts` with the page counted, and a clean typecheck. Run each probe named in the new `describe` and paste its failing line: `loadTimeline` rethrowing; `RecordCardBoundary` without `Suspense`; `userLanguage` dropped. If `contact.created_at` is not typed `string` on `getContact`'s return, read `contacts.ts:58-59` (`COLS` includes `created_at`) and cast at the call with a comment.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record
C="apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]"
git add -- apps/web/src/lib/record/loaders.ts
git --literal-pathspecs commit -m "feat(contacts): the contact record page on the kit: each card loads and fails alone, a header with Call/Text/Email/Directions, facts and Next up in English and Spanish" -- apps/web/src/lib/record/loaders.ts "$C/page.tsx" "$C/page.test.ts" docs/crm-features.md
```

---

### Task 9: e2e for 1a (bis-e2e-qa)

**Files:**
- Create: `apps/web/e2e/record-page.spec.ts`
- Modify: `apps/web/e2e/contact-detail.spec.ts` (second test opens the composer from the header)
- Modify: `apps/web/e2e/i18n-overflow.spec.ts` (+ one test)

**Interfaces:**
- Consumes: the page's markers. `data-record-layout` (with `lang`), `data-record-header`, `data-record-actions`, `data-record-action="call|text|email|directions"`, `data-variant`. `data-record-column="who|happening|have"`, `data-record-card="<id>"` with an `aria-expanded` disclosure button on a phone. `data-next-up-row="booking|task"`, `data-record-facts`. The composer tabs' `aria-pressed`.

**Deviations, recorded:**
1. **"Text lands on the text composer" cannot run as written on the fixture account.** It has no approved A2P registration (`consent-texts.spec.ts:21-23`), so the gate is closed and the header's Text is **hidden by design**. The spec asserts Text is hidden there instead. The landing mechanism is proved through Email (the same code path), and through a `#compose-sms` deep link that opens the Text tab. Approving A2P on the shared fixture account would change what `consent-texts.spec.ts` relies on.
2. **Spanish comes from `?locale=es`** (the QA override, `BIS_I18N_QA=1`, `playwright.config.ts:211`), not from writing `users.language`. The default identity is the shared agency user, and changing its language would leak into every later spec. With no per-person state written, nothing needs resetting.
3. **Names.** First names are `Record`, `Bare` and `Overflow` with a stamped last name, so no `E2E …` literal is minted and `fixtures/fixture-names.test.ts` needs no entry (it scans only `E2E `-prefixed templates, `:46`).

- [ ] **Step 1: Write the spec** `apps/web/e2e/record-page.spec.ts`

```ts
import { test, expect } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact, addPlace, getOrCreateCalendar } from "@bis/db";
import { m } from "../src/lib/messages";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-03 part 1, 1a (spec §12.1): the contact record page on the kit. ON THE PER-RUN FIXTURE ACCOUNT
 * ONLY, never Test Client One (CLAUDE.md). Two contacts with a stamped last name ("Record" with a
 * phone, an email, an addressed property and an upcoming booking; "Bare" with nothing), deleted in
 * afterAll. The property and the booking go with their contact (both cascade on contacts.id).
 * Spanish is the QA override `?locale=es`, so no person's language is written. Serial: one setup.
 */
test.describe.configure({ mode: "serial", timeout: 60_000 });

const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
function fixture(): { accountId: string } {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`client fixture missing at ${FIXTURE_FILE}: run the full suite (the "setup" project).`);
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as { accountId: string };
}

const stamp = Date.now();
const ACTOR = "e2e-record-page";
const LAST = `Page ${stamp}`;
const PHONE = `+1956292${String(Math.floor(Math.random() * 9000) + 1000)}`;
const made: { full?: string; bare?: string } = {};
const PHONE_ORDER = ["summary", "next-up", "timeline", "groups", "properties", "deals", "details", "tags", "related-people"];
const url = (id: string, q = "") => `/dashboard/accounts/${fixture().accountId}/contacts/${id}${q}`;

test.beforeAll(async () => {
  const { accountId } = fixture();
  const db = serviceDb();
  made.full = (await createContact(db, accountId, { firstName: "Record", lastName: LAST, phone: PHONE, email: `record-${stamp}@example.com` }, ACTOR)).id;
  made.bare = (await createContact(db, accountId, { firstName: "Bare", lastName: LAST }, ACTOR)).id;
  await addPlace(db, accountId, { contactId: made.full, groupId: null }, {
    label: null, address: "1204 Nolana Ave", landmark: null, directions: null, city: "McAllen", region: "TX", postal_code: "78504", country: "US",
  }, { subjectId: made.full, actorId: ACTOR });
  // Sixty days out: past the calendar's 30-day booking horizon, so booking.spec never offers this slot.
  const cal = await getOrCreateCalendar(db, accountId, ACTOR);
  const start = new Date(Date.now() + 60 * 86_400_000);
  start.setUTCHours(15, stamp % 60, 0, 0);
  const { error } = await db.from("bookings").insert({
    account_id: accountId, calendar_id: cal.id, contact_id: made.full,
    starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3_600_000).toISOString(), cancel_token: `e2e-record-${stamp}`,
  });
  if (error) throw new Error(`record-page e2e: booking seed failed: ${error.message}`);
});

test.afterAll(async () => {
  const { accountId } = fixture();
  const db = serviceDb();
  const ids = [made.full, made.bare].filter((x): x is string => Boolean(x));
  const { error } = await db.from("contacts").delete().eq("account_id", accountId).in("id", ids);
  if (error) console.error(`record-page e2e: cleanup failed (the fixture sweep takes it): ${error.message}`);
  const { data: left } = await db.from("contacts").select("id").in("id", ids);
  expect(left ?? []).toEqual([]);
});

test("at 1280px the three columns hold their cards, and Call is the one primary", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url(made.full!));
  const who = page.locator('[data-record-column="who"]');
  const happening = page.locator('[data-record-column="happening"]');
  const have = page.locator('[data-record-column="have"]');
  await expect(happening.locator('[data-record-card="summary"]')).toBeVisible();
  await expect(have.locator('[data-record-card="deals"]')).toBeVisible();
  await expect(who.locator('[data-record-card="details"]')).toBeVisible();
  const [w, h, v] = await Promise.all([who.boundingBox(), happening.boundingBox(), have.boundingBox()]);
  expect(w!.x).toBeLessThan(h!.x);
  expect(h!.x).toBeLessThan(v!.x);
  const actions = page.locator("[data-record-actions]");
  await expect(actions.locator('[data-variant="default"]')).toHaveCount(1);
  await expect(actions.locator('[data-record-action="call"]')).toHaveAttribute("data-variant", "default");
  await expect(actions.locator('[data-record-action="call"]')).toHaveAttribute("href", `tel:${PHONE}`);
  // The desk opens the "have" cards after hydration (phone-first server render, plan Task 4).
  await expect(page.locator("[data-groups-card]")).toBeVisible();
});

test("at 390px the order is header, summary, Next up, timeline, the closed 'have' cards, then who they are", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url(made.full!));
  await expect(page.locator("[data-record-header]")).toBeVisible();
  const ids = await page.locator("[data-record-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-record-card")));
  expect(ids).toEqual(PHONE_ORDER);
  const headerFirst = await page.evaluate(() => {
    const header = document.querySelector("[data-record-header]")!;
    const first = document.querySelector("[data-record-card]")!;
    return Boolean(header.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(headerFirst).toBe(true);
  for (const id of ["groups", "properties", "deals"]) {
    await expect(page.locator(`[data-record-card="${id}"] button[aria-expanded]`)).toHaveAttribute("aria-expanded", "false");
  }
  await expect(page.locator("[data-groups-card]")).toHaveCount(0);
  await expect(page.locator('[data-record-card="details"] button[aria-expanded]')).toHaveCount(0);
  await page.locator('[data-record-card="deals"] button[aria-expanded]').click();
  await expect(page.locator('[data-record-card="deals"] button[aria-expanded]')).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('[data-record-card="deals"]')).toContainText(m["contact.noOpportunities"]);
});

test("an action with nothing behind it is hidden: no email, no address, no phone, and Text while the gate is closed", async ({ page }) => {
  await page.goto(url(made.bare!));
  await expect(page.locator("[data-record-header]")).toBeVisible();
  await expect(page.locator("[data-record-action]")).toHaveCount(0);
  await page.goto(url(made.full!));
  await expect(page.locator('[data-record-action="email"]')).toBeVisible();
  await expect(page.locator('[data-record-action="directions"]')).toHaveAttribute("href", /google\.com\/maps/);
  // The fixture account has no approved A2P registration, so the text gate is closed: no Text.
  await expect(page.locator('[data-record-action="text"]')).toHaveCount(0);
});

test("Email lands on the email composer with its body focused; #compose-sms opens the Text tab", async ({ page }) => {
  await page.goto(url(made.full!));
  await page.locator('[data-record-action="email"]').click();
  await expect(page.getByRole("button", { name: m["compose.email"], exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByPlaceholder(/write an email/i)).toBeFocused();
  await page.goto(url(made.full!, "#compose-sms"));
  await expect(page.getByRole("button", { name: m["compose.sms"], exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("a seeded upcoming booking shows in Next up", async ({ page }) => {
  await page.goto(url(made.full!));
  await expect(page.locator('[data-record-card="next-up"] [data-next-up-row="booking"]')).toHaveCount(1);
});

test("in Spanish the converted parts read Spanish and the page says so", async ({ page }) => {
  await page.goto(url(made.full!, "?locale=es"));
  await expect(page.locator("[data-record-layout]")).toHaveAttribute("lang", "es");
  await expect(page.locator('[data-record-action="call"]')).toHaveText(m["record.action.call.es"]);
  await expect(page.getByRole("heading", { name: m["record.card.nextUp.es"] })).toBeVisible();
});
```

- [ ] **Step 2: `contact-detail.spec.ts`.** In the second test, replace `await page.getByRole("button", { name: "Email", exact: true }).click();` with:

```ts
    // S-03 part 1: the header's Email opens the composer on its channel (the composer now sits at
    // the top of the Activity card). The tab is still the composer's, pressed by the link.
    await page.locator('[data-record-action="email"]').click();
    await expect(page.getByRole("button", { name: "Email", exact: true })).toHaveAttribute("aria-pressed", "true");
```

The first test (read-only on Test Client One) is unchanged. Its `getByRole("heading", { name })` now finds the `RecordHeader`'s h1, and the Email inline field stays visible because the Details card is open on a desk.

- [ ] **Step 3: `i18n-overflow.spec.ts`.** Add inside the `describe`:

```ts
  test("the contact record page: header actions and the fact line wrap, never clip, under the pseudo-locale", async ({ page }) => {
    const fixture = readClientFixture();
    if (!fixture) {
      test.skip(true, "No client fixture at e2e/.auth/client-fixture.json; run the full suite.");
      return;
    }
    const db = serviceDb();
    const { id } = await createContact(db, fixture.accountId, {
      firstName: "Overflow", lastName: `Check ${Date.now()}`, phone: "+19562920199", email: `overflow-${Date.now()}@example.com`,
    }, "e2e-i18n-overflow");
    try {
      await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts/${id}?locale=pseudo`);
      const measured = page.locator("[data-record-action], [data-record-facts]");
      const count = await measured.count();
      expect(count, "no record header actions or fact line found").toBeGreaterThan(1);
      for (let i = 0; i < count; i++) {
        const [scrollW, clientW, text] = await measured.nth(i).evaluate((n) => [n.scrollWidth, n.clientWidth, n.textContent]);
        expect(clipFailure(scrollW, clientW, `record page "${text}"`)).toBeNull();
      }
    } finally {
      const { error } = await db.from("contacts").delete().eq("id", id);
      if (error) console.error(`i18n-overflow e2e: cleanup failed: ${error.message}`);
    }
  });
```

with imports `import { config as loadEnv } from "dotenv"; import { serviceDb, createContact } from "@bis/db";` plus the two `loadEnv` lines. Also amend the file's header comment: it is no longer read-only, and this test creates and deletes its own contact on the per-run fixture account.

- [ ] **Step 4: Static checks only** (Playwright is the orchestrator's gate)

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record
pnpm --filter web typecheck
pnpm --filter web exec eslint e2e/record-page.spec.ts e2e/contact-detail.spec.ts e2e/i18n-overflow.spec.ts
pnpm --filter web exec vitest run e2e/fixtures/fixture-names.test.ts
```
Expected: clean, and `fixture-names.test.ts` passes, with no new `E2E` literal. **Static mutation probe** (the orchestrator's run gives the real red and green): with Task 4's `PHONE_QUERY` changed to `(max-width: 0px)`, the 390px test's `aria-expanded="false"` assertion would fail, because the cards would never be closed.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s03-record
git add -- apps/web/e2e/record-page.spec.ts
git commit -m "test(e2e): the contact record page: desk and phone order, header actions shown and hidden, composer landing, Next up, Spanish, pseudo overflow" -- apps/web/e2e/record-page.spec.ts apps/web/e2e/contact-detail.spec.ts apps/web/e2e/i18n-overflow.spec.ts
```

---

## Self-review (run against the spec, 2026-10-12)

**Spec coverage (1a only):**
- D2 kit + registry: Tasks 4 and 5.
- D3 header (Call primary, Text, Email, Directions; hidden not disabled; no status or language chip): Tasks 5 and 8.
- D4/§9.2 summary (zero omitted, failure named, account zone, error state): Tasks 3, 5, 7 and 8.
- §9.3 Next up (three rows, overdue first, undated counted, empty with "Add a To-do", error): Tasks 3, 5, 7 and 8.
- D6/C6 phone order, grid placement, skip link: Tasks 4, 5 and 8, e2e in Task 9.
- §8 one chrome, phone disclosure that mounts nothing: Task 4. Each card behind its own boundary (C5): Tasks 4 and 8.
- §9.4 timeline in its card, composer on top, error state: Tasks 7 and 8. Composer opening from `#compose-*`: Task 6.
- §9.5 Deals dot+word and Spanish; `headingHidden`; fields panel bodies: Task 7.
- §9.6 `requestLocale` with `userLanguage`, `lang`, `useLocale` in client cards, pseudo: Tasks 5 and 8, overflow in Task 9.
- §10.1 copy: Tasks 4 and 5.
- §12.1 tests: queries (Tasks 1–3), pure (Task 5), each card failing alone and the boundary (Tasks 4 and 8), the kit (Task 4), e2e (Task 9).
- §16.1 the two 1a DESIGN.md sentences: Task 4. §15 the orchestrator's crm-features rows: Task 8.
- §13 served-HTML marker: the "Next up" title is rendered by Task 8.

**Spec items not planned or changed** (each is also recorded in its task):
1. The calendar name in Next up: no such column exists, so the row reads "Appointment · {when}" (Tasks 1 and 5).
2. The Technician-equivalence facts test: no Technician PostgREST token in the suite. The fences are pinned in `technician-scope.test.ts` (Task 3).
3. "Text lands on the text composer" e2e: Text is correctly hidden on the fixture account. Landing is proved via Email and a `#compose-sms` deep link (Task 9).
4. `users.language` set and reset in e2e: replaced by `?locale=es` (Task 9).
5. `RecordCardDef.Skeleton`/`render`: skeleton as data, render bound in the page (Task 5).
6. `number | null` facts: `Fact<T>` instead (Task 3).
7. One header read (`listContactPlaces`) instead of two (Task 8).
8. `record.facts.openDeals` without `· {amount}` inside the key. `record.card.failed` and `record.nextUp.booking` added (Tasks 4 and 5).

**Placeholder scan:** the two "verbatim" moves in Task 7 (`contact-fields-panel.tsx`'s inner JSX, the timeline's rows block) are line-cited moves of existing code, not unwritten code. Two places tell the implementer to read the source and adjust if an assumed type differs (`telHref`'s sample number, the loaders' return types). Both are working rule 1, not open design.

**Re-read fixes made before the commit:**
- A vacuous ternary assertion in `record-card.test.ts` was replaced.
- The styleguide demo was rewritten so every string comes from the catalogue: a new file is allowed zero ratchet hits, and `title=` is a copy attribute.
- The Task 4/5 key split was made explicit, so neither task can produce a duplicate key.
- `loaders.ts` no longer imports a type from `app/`.
- The booking-time assertion tolerates ICU's U+202F.
- Task 7's commit names files instead of a directory.

**Type consistency:** `SmsGate | null` runs through `softSmsGate`, `canTextFrom`, `ActivityTimeline` and `MessageComposer`. `RecordColumn` runs from `record-layout.tsx` into `record-cards.ts`. `FactsView`, `NextUpView`, `Tr` and `DealRow` each have one producer and every consumer uses the same name. The `ContactFacts`/`Fact<T>` shape matches across `record.ts`, `record-facts.ts` and `loaders.ts`. `ADD_TODO_FIELD_ID` is shared by `activity-timeline.tsx` and `next-up-card.tsx`. The `headingHidden` prop name is the same on all three cards and in `page.tsx`.
