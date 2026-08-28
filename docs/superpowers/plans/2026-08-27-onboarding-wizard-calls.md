# Onboarding Wizard + Calls Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guided Setup wizard (derived-state, built thin over existing pages), per-client Calls list/detail pages with a daily usage meter, and the ten Voice Core follow-ups.

**Architecture:** Wizard step completion is *computed from live rows at render time* (never stored, except two manual ticks reusing `checklist_items` under `setup:` keys). Calls pages read via `dbForRequest()` so RLS + the 0020 SELECT-only grants enforce tenancy. All voice-path writes stay guard-then-`serviceDb()` (Task 13 precedent). Spec: `docs/superpowers/specs/2026-08-27-onboarding-wizard-calls-design.md`.

**Tech Stack:** Next.js App Router (apps/web), Supabase/PostgREST via @bis/db, Clerk auth, vitest, Playwright e2e, Tailwind.

## Global Constraints

- **Design quality is first-class** (spec §Scope 8): every new UI surface (Setup panel, Calls list, Call detail) gets the frontend-design skill treatment — invoke `frontend-design:frontend-design` before writing the UI in Tasks 10, 11, 13. Match the existing dashboard's component idiom (PageHeader, empty-state, tokens) — elevate within it, don't fork it.
- **Migrations 0001–0020 are APPLIED to prod — NEVER re-apply.** This milestone adds ONLY 0021. The controller (not the implementer) applies 0021 to the Supabase project `tlbkbmlrfafquucsmsmm` at Task 1 completion.
- Reads on in-account pages use `dbForRequest()` (`apps/web/src/lib/db.ts`) — never `serviceDb()` on a page. Writes: guard first, then `serviceDb()` (`voice/actions.ts` precedent).
- Setup page + all wizard actions are agency-only (`requireAgencyOnlyAccountAccess` for pages; the `voice/actions.ts` guard idiom for actions). Calls pages are both audiences (`requireAccountAccess`).
- apps/web has NO direct `@supabase/supabase-js` dep — db params in apps/web use `ReturnType<typeof serviceDb>` or the `SupabaseClient` re-export from `@bis/db`.
- All user-facing strings go through `m` (`apps/web/src/lib/messages.ts`). No hardcoded copy in JSX.
- New `@bis/db` exports must be added to `packages/db/src/index.ts`.
- Every number leaving the app goes through `toE164` (`apps/web/src/lib/voice/phone-number.ts`).
- A derived setup check that errors must render "couldn't check", never done.
- `fillContactBlanks` failures must never fail a booking or a call record (rule ③ precedent).
- Gates per task: `pnpm --filter <pkg> test` for the touched package + `tsc --noEmit`; full `pnpm check` + build + e2e in Task 16. ESLint runs in `pnpm check` — do not accumulate lint debt (Task 14 lesson from Voice Core).
- Commits: conventional prefixes (`feat(voice):`, `feat(db):`, `fix(...)`, `docs(...)`), one commit per green test cycle.

---

### Task 1: DB — migration 0021 + phone-number accessors (list, list-all, reassign, calendar read)

**Files:**
- Create: `packages/db/supabase/migrations/0021_phone_numbers_telnyx_unique.sql`
- Modify: `packages/db/src/voice.ts` (append accessors)
- Modify: `packages/db/src/booking.ts` (append `getCalendarForAccount`)
- Modify: `packages/db/src/index.ts` (export new names)
- Test: `packages/db/src/test/voice.test.ts` (extend)

**Interfaces:**
- Consumes: existing `PhoneNumberRow`, `emit`, `ActorType`, `CalendarRow`, `CALENDAR_COLS`.
- Produces (later tasks rely on these exact names):
  - `listPhoneNumbersForAccount(db, accountId): Promise<PhoneNumberRow[]>`
  - `listAllPhoneNumbers(db): Promise<(PhoneNumberRow & { account: { name: string } | null })[]>`
  - `reassignPhoneNumber(db, phoneNumberId, toAccountId, actorId, actorType?): Promise<PhoneNumberRow>`
  - `getCalendarForAccount(db, accountId): Promise<CalendarRow | null>` (read-only — `getOrCreateCalendar` WRITES and must not be called from a render path)

- [ ] **Step 1: Write the migration** (no test cycle — schema only)

```sql
-- 0021: the same Telnyx number must never be attached twice (wizard makes
-- assignment/reassignment a button; this is the DB-level guardrail).
-- Partial: telnyx_id is nullable — manually assigned numbers may omit it.
create unique index phone_numbers_telnyx_id_unique
  on public.phone_numbers (telnyx_id) where telnyx_id is not null;
```

Do NOT apply it anywhere from the implementer side. The controller applies it to prod once, after review.

- [ ] **Step 2: Write failing tests** in `packages/db/src/test/voice.test.ts` (follow the file's existing `withTestAccount` fixture idiom — read the file first and reuse its setup):

```ts
describe("listPhoneNumbersForAccount / listAllPhoneNumbers / reassignPhoneNumber", () => {
  it("lists only the account's numbers, oldest first", async () => {
    // two accounts, one number each (use unique e164s per the file's idiom)
    const a = await assignPhoneNumber(db, accountA, { e164: "+15550000001" }, "t");
    await assignPhoneNumber(db, accountB, { e164: "+15550000002" }, "t");
    const rows = await listPhoneNumbersForAccount(db, accountA);
    expect(rows.map((r) => r.id)).toEqual([a.id]);
  });

  it("listAllPhoneNumbers returns every account's numbers with the account name embedded", async () => {
    await assignPhoneNumber(db, accountA, { e164: "+15550000003" }, "t");
    const all = await listAllPhoneNumbers(db);
    const mine = all.find((r) => r.e164 === "+15550000003");
    expect(mine?.account?.name).toBeTruthy();
  });

  it("reassignPhoneNumber moves the row to the target account and resets status to provisioned", async () => {
    const n = await assignPhoneNumber(db, accountA, { e164: "+15550000004", status: "live" }, "t");
    const moved = await reassignPhoneNumber(db, n.id, accountB, "t");
    expect(moved.account_id).toBe(accountB);
    expect(moved.status).toBe("provisioned");
    expect((await listPhoneNumbersForAccount(db, accountA)).find((r) => r.id === n.id)).toBeUndefined();
  });

  it("reassignPhoneNumber throws on an unknown id", async () => {
    await expect(reassignPhoneNumber(db, "00000000-0000-0000-0000-000000000000", accountB, "t"))
      .rejects.toThrow(/matched no row|not found/);
  });

  it("getCalendarForAccount returns null when no calendar exists, the row after getOrCreateCalendar", async () => {
    expect(await getCalendarForAccount(db, accountFresh)).toBeNull();
    await getOrCreateCalendar(db, accountFresh, "t");
    expect((await getCalendarForAccount(db, accountFresh))?.account_id).toBe(accountFresh);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `pnpm --filter @bis/db test` → FAIL (functions not exported).

- [ ] **Step 4: Implement** in `packages/db/src/voice.ts`:

```ts
export async function listPhoneNumbersForAccount(
  db: SupabaseClient, accountId: string,
): Promise<PhoneNumberRow[]> {
  const { data, error } = await db.from("phone_numbers")
    .select(PHONE_COLS).eq("account_id", accountId).order("created_at");
  if (error) throw new Error(`listPhoneNumbersForAccount failed: ${error.message}`);
  return (data ?? []) as PhoneNumberRow[];
}

/** Agency surface only (the wizard's number step). RLS's app.is_agency()
 *  branch is what makes this visible cross-account under dbForRequest. */
export async function listAllPhoneNumbers(
  db: SupabaseClient,
): Promise<(PhoneNumberRow & { account: { name: string } | null })[]> {
  const { data, error } = await db.from("phone_numbers")
    .select(`${PHONE_COLS}, account:accounts(name)`).order("created_at");
  if (error) throw new Error(`listAllPhoneNumbers failed: ${error.message}`);
  return (data ?? []) as unknown as (PhoneNumberRow & { account: { name: string } | null })[];
}

/**
 * Moves a number to another account. NOT release-then-assign: e164 is
 * globally unique (0019), so a second insert can never express a move.
 * Status resets to 'provisioned' — a moved number must walk the wizard's
 * test-call + go-live steps again before it is live for the new tenant.
 * Emits on BOTH accounts so each timeline records its side of the move.
 */
export async function reassignPhoneNumber(
  db: SupabaseClient, phoneNumberId: string, toAccountId: string,
  actorId: string, actorType: ActorType = "user",
): Promise<PhoneNumberRow> {
  const { data: current, error: readErr } = await db.from("phone_numbers")
    .select(PHONE_COLS).eq("id", phoneNumberId).maybeSingle();
  if (readErr) throw new Error(`reassignPhoneNumber read failed: ${readErr.message}`);
  if (!current) throw new Error("reassignPhoneNumber matched no row");
  const from = current as PhoneNumberRow;

  const { data, error } = await db.from("phone_numbers")
    .update({ account_id: toAccountId, status: "provisioned", updated_at: new Date().toISOString() })
    .eq("id", phoneNumberId).select(PHONE_COLS).single();
  if (error || !data) throw new Error(`reassignPhoneNumber failed: ${error?.message}`);

  await emit(db, from.account_id, "phone_number.released", actorId,
    { phoneNumberId, e164: from.e164, movedTo: toAccountId }, actorType);
  await emit(db, toAccountId, "phone_number.assigned", actorId,
    { phoneNumberId, e164: from.e164, movedFrom: from.account_id }, actorType);
  return data as PhoneNumberRow;
}
```

And in `packages/db/src/booking.ts` (near `getOrCreateCalendar`):

```ts
/** Read-only sibling of getOrCreateCalendar for render paths — the setup
 *  page must never CREATE a calendar as a side effect of looking at it. */
export async function getCalendarForAccount(
  db: SupabaseClient, accountId: string,
): Promise<CalendarRow | null> {
  const { data, error } = await db.from("calendars")
    .select(CALENDAR_COLS).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`getCalendarForAccount failed: ${error.message}`);
  return (data as CalendarRow | null) ?? null;
}
```

Export all four from `packages/db/src/index.ts` (match the file's existing export style).

- [ ] **Step 5: Run tests** — `pnpm --filter @bis/db test` → PASS. `pnpm --filter @bis/db exec tsc --noEmit` → clean.

- [ ] **Step 6: Commit** — `feat(db): phone number list/reassign accessors, calendar read accessor, 0021 telnyx_id unique`

---

### Task 2: DB — calls read accessors (listCalls, getCall)

**Files:**
- Modify: `packages/db/src/voice.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/test/voice.test.ts` (extend)

**Interfaces:**
- Consumes: `startCallRow`, `finishCallRow`, `assignPhoneNumber`, `createContact` (test seeding).
- Produces:
  - `type CallListRow = { id: string; started_at: string; duration_secs: number | null; outcome: CallOutcome; language: "en" | "es"; caller_e164: string | null; contact_id: string | null; contact: { first_name: string | null; last_name: string | null } | null }`
  - `type CallDetailRow = CallListRow & { ended_at: string | null; turn_count: number; transcript: TranscriptEvent[]; summary: string; conversation_id: string | null; booking_id: string | null }`
  - `listCalls(db, accountId, opts?: { limit?: number; before?: string }): Promise<CallListRow[]>` — newest first; `before` is a `started_at` ISO cursor (strictly `<`), for the list page's paging links.
  - `getCall(db, accountId, callId): Promise<CallDetailRow | null>`

- [ ] **Step 1: Write failing tests**:

```ts
describe("listCalls / getCall", () => {
  it("lists newest-first, embeds the contact name, respects limit and before-cursor", async () => {
    const n = await assignPhoneNumber(db, accountA, { e164: "+15550000010" }, "t");
    const c = await createContact(db, accountA, { firstName: "Maria", lastName: "Garcia", phone: "+15550000011" }, "t");
    const r1 = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: "+15550000011" });
    await finishCallRow(db, accountA, r1.id, {
      outcome: "booked", endedAt: new Date(), durationSecs: 62, turnCount: 9,
      transcript: [{ role: "caller", text: "hola", at: new Date().toISOString() }],
      summary: "s", language: "es", contactId: c.id,
    });
    const r2 = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: null });

    const rows = await listCalls(db, accountA);
    expect(rows[0]!.id).toBe(r2.id);                       // newest first
    const booked = rows.find((r) => r.id === r1.id)!;
    expect(booked.contact?.first_name).toBe("Maria");
    expect(booked.language).toBe("es");

    const paged = await listCalls(db, accountA, { before: rows[0]!.started_at, limit: 1 });
    expect(paged.map((r) => r.id)).toEqual([r1.id]);
  });

  it("getCall returns the full row for the account and null cross-account or unknown", async () => {
    const n = await assignPhoneNumber(db, accountA, { e164: "+15550000012" }, "t");
    const r = await startCallRow(db, accountA, { phoneNumberId: n.id, callerE164: null });
    const detail = await getCall(db, accountA, r.id);
    expect(detail?.transcript).toEqual([]);
    expect(await getCall(db, accountB, r.id)).toBeNull();  // tenant boundary
    expect(await getCall(db, accountA, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL (not exported).

- [ ] **Step 3: Implement** in `packages/db/src/voice.ts`:

```ts
export type CallListRow = {
  id: string; started_at: string; duration_secs: number | null;
  outcome: CallOutcome; language: "en" | "es"; caller_e164: string | null;
  contact_id: string | null;
  contact: { first_name: string | null; last_name: string | null } | null;
};
export type CallDetailRow = CallListRow & {
  ended_at: string | null; turn_count: number; transcript: TranscriptEvent[];
  summary: string; conversation_id: string | null; booking_id: string | null;
};

const CALL_LIST_COLS =
  "id, started_at, duration_secs, outcome, language, caller_e164, contact_id, " +
  "contact:contacts(first_name, last_name)";
const CALL_DETAIL_COLS =
  CALL_LIST_COLS + ", ended_at, turn_count, transcript, summary, conversation_id, booking_id";

export async function listCalls(
  db: SupabaseClient, accountId: string, opts: { limit?: number; before?: string } = {},
): Promise<CallListRow[]> {
  let q = db.from("calls").select(CALL_LIST_COLS)
    .eq("account_id", accountId)
    .order("started_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.before) q = q.lt("started_at", opts.before);
  const { data, error } = await q;
  if (error) throw new Error(`listCalls failed: ${error.message}`);
  return (data ?? []) as unknown as CallListRow[];
}

export async function getCall(
  db: SupabaseClient, accountId: string, callId: string,
): Promise<CallDetailRow | null> {
  const { data, error } = await db.from("calls").select(CALL_DETAIL_COLS)
    .eq("account_id", accountId).eq("id", callId).maybeSingle();
  if (error) throw new Error(`getCall failed: ${error.message}`);
  return (data as unknown as CallDetailRow | null) ?? null;
}
```

Export both functions + both types from `index.ts`.

- [ ] **Step 4: Run tests** → PASS; tsc clean.
- [ ] **Step 5: Commit** — `feat(db): calls list/detail read accessors with contact embed`

---

### Task 3: fillContactBlanks + wire into voice dedupe sites

**Files:**
- Modify: `packages/db/src/contacts.ts`, `packages/db/src/index.ts`
- Modify: `apps/web/src/lib/voice/tools/registry.ts` (book_appointment)
- Modify: `apps/web/src/lib/voice/finish-call.ts` (resolveContactId lead path)
- Test: `packages/db/src/test/contacts.test.ts`, `apps/web/src/lib/voice/tools/registry.test.ts`, `apps/web/src/lib/voice/finish-call.test.ts` (all extend)

**Interfaces:**
- Produces: `fillContactBlanks(db, accountId, contactId, input: { firstName?: string; lastName?: string; email?: string; phone?: string }, actorId, actorType?): Promise<string[]>` — returns the column names actually filled (`[]` when nothing was blank).
- Consumes: `createContact`'s `{ id, existing }` return (both call sites already receive it).

**Rules (from spec — the iron rule is the whole point):**
1. Never overwrite a non-blank value. Blank = `null` or `""` after trim.
2. `first_name === "Caller"` with a blank `last_name` is OUR OWN placeholder (finish-call writes it) and counts as fillable — but only by a non-blank incoming firstName; when it fills, an incoming lastName rides along in the same update.
3. Email is trimmed + lowercased before writing (matches `createContact`).
4. Precedent: `f/[publicId]/actions.ts` already does read-first fill for returning web leads — same philosophy, now as a shared accessor. Do NOT refactor f/actions in this task.

- [ ] **Step 1: Failing db tests** (`contacts.test.ts`):

```ts
describe("fillContactBlanks", () => {
  it("fills only blank fields and reports them", async () => {
    const c = await createContact(db, accountA, { firstName: "Ana", phone: "+15550000020" }, "t");
    const filled = await fillContactBlanks(db, accountA, c.id,
      { firstName: "Ignored", email: "ANA@Example.com " }, "t");
    expect(filled.sort()).toEqual(["email"]);
    const row = await getContact(db, accountA, c.id);
    expect(row!.first_name).toBe("Ana");            // IRON RULE: not overwritten
    expect(row!.email).toBe("ana@example.com");     // normalized
  });

  it("replaces the 'Caller' placeholder with a real name (lastName rides along)", async () => {
    const c = await createContact(db, accountA, { firstName: "Caller", phone: "+15550000021" }, "t");
    const filled = await fillContactBlanks(db, accountA, c.id,
      { firstName: "Dan", lastName: "Lopez" }, "t");
    expect(filled.sort()).toEqual(["first_name", "last_name"]);
    const row = await getContact(db, accountA, c.id);
    expect(row!.first_name).toBe("Dan");
    expect(row!.last_name).toBe("Lopez");
  });

  it("does NOT treat a real first name with blank last name as a placeholder", async () => {
    const c = await createContact(db, accountA, { firstName: "Madonna", phone: "+15550000022" }, "t");
    expect(await fillContactBlanks(db, accountA, c.id, { firstName: "Dan" }, "t")).toEqual([]);
  });

  it("no-ops cleanly when nothing is blank (no update, no event)", async () => {
    const c = await createContact(db, accountA,
      { firstName: "A", lastName: "B", email: "a@b.co", phone: "+15550000023" }, "t");
    expect(await fillContactBlanks(db, accountA, c.id,
      { firstName: "X", lastName: "Y", email: "x@y.co", phone: "+15550000024" }, "t")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** in `contacts.ts`:

```ts
/**
 * Fills ONLY blank fields on an existing contact — the voice dedupe
 * follow-up (a returning caller's name/email must not stay "Caller"/NULL,
 * but a misheard name must never clobber a good record). Blank = null or
 * empty after trim. "Caller" with no last name is our own finish-call
 * placeholder and counts as blank for the name pair only.
 * Returns the column names actually written; [] means no update ran.
 */
export async function fillContactBlanks(
  db: SupabaseClient, accountId: string, contactId: string,
  input: { firstName?: string; lastName?: string; email?: string; phone?: string },
  actorId: string, actorType: ActorType = "user",
): Promise<string[]> {
  const row = await getContact(db, accountId, contactId);
  if (!row) throw new Error("fillContactBlanks: no such contact");
  const blank = (v: unknown) => v == null || String(v).trim() === "";

  const patch: Record<string, unknown> = {};
  const nameIsPlaceholder = row.first_name === "Caller" && blank(row.last_name);
  const incomingFirst = input.firstName?.trim();
  if (incomingFirst && (blank(row.first_name) || nameIsPlaceholder)) {
    patch.first_name = incomingFirst;
    const incomingLast = input.lastName?.trim();
    if (incomingLast && blank(row.last_name)) patch.last_name = incomingLast;
  }
  const incomingEmail = input.email?.trim().toLowerCase();
  if (incomingEmail && blank(row.email)) patch.email = incomingEmail;
  const incomingPhone = input.phone?.trim();
  if (incomingPhone && blank(row.phone)) patch.phone = incomingPhone;

  const filled = Object.keys(patch);
  if (filled.length === 0) return [];

  const { error } = await db.from("contacts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", contactId);
  if (error) throw new Error(`fillContactBlanks failed: ${error.message}`);
  await emit(db, accountId, "contact.updated", actorId, { contactId, fields: filled }, actorType);
  return filled;
}
```

Export from `index.ts`. Run db tests → PASS. Commit — `feat(db): fillContactBlanks accessor (never overwrites non-blank)`.

- [ ] **Step 4: Failing web tests, then wire the two voice call sites.**

`registry.ts`, in `book_appointment`, replace the contact block:

```ts
      let contactId = state.contactId;
      if (!contactId) {
        const space = name.lastIndexOf(" ");
        const firstName = space > 0 ? name.slice(0, space) : name;
        const lastName = space > 0 ? name.slice(space + 1) : undefined;
        const created = await createContact(ctx.db, ctx.accountId,
          { firstName, lastName, phone: phone ?? undefined, email: email ?? undefined, source: "voice" },
          "voice", "ai");
        contactId = created.id;
        if (created.existing) {
          // Dedupe returns the existing row untouched — backfill blanks so a
          // repeat caller stops being "Caller" with no email (the unsendable-
          // reminder casualty). Failure here must NEVER fail the booking.
          try {
            await fillContactBlanks(ctx.db, ctx.accountId, contactId,
              { firstName, lastName, email: email ?? undefined, phone: phone ?? undefined },
              "voice", "ai");
          } catch (e) {
            console.error(`voice fillContactBlanks failed for ${contactId}: ${String(e)}`);
          }
        }
      }
```

`finish-call.ts`, in `resolveContactId`'s lead branch, after `createContact`:

```ts
    const created = await createContact(ctx.db, ctx.accountId, {
      firstName: firstName || "Caller",
      lastName,
      phone: toE164(fields.callbackNumber) ?? ctx.callerNumber ?? undefined,
      email: fields.email,
      source: "voice",
    }, ACTOR_ID, ACTOR_TYPE);
    if (created.existing) {
      try {
        await fillContactBlanks(ctx.db, ctx.accountId, created.id,
          { firstName: firstName || undefined, lastName, email: fields.email,
            phone: toE164(fields.callbackNumber) ?? ctx.callerNumber ?? undefined },
          ACTOR_ID, ACTOR_TYPE);
      } catch (e) {
        console.error(`finishCall fillContactBlanks failed for ${created.id}: ${String(e)}`);
      }
    }
    return created.id;
```

(And the caller-ID-only branch below it: same `if (created.existing)` treatment with `{ phone: ctx.callerNumber ?? undefined }` — a bare caller-ID has no name/email to fill, but keep the shape symmetric so a future field rides free.)

Web tests (extend `registry.test.ts` — mock `fillContactBlanks` in the file's existing `@bis/db` mock):
- `book_appointment` on an existing contact calls `fillContactBlanks` with the split name + email + phone.
- **The never-break pin:** `fillContactBlanks` mock rejects → `book_appointment` still returns `{ ok: true, bookingId }`.
- New contact (`existing: false`) → `fillContactBlanks` NOT called.
- `finish-call.test.ts`: lead path with `existing: true` calls it; rejection still yields a stored row + alert (assert `finishCall` resolves with `stored: true`).

- [ ] **Step 5: Run** — `pnpm --filter web test -- voice` → PASS; tsc clean.
- [ ] **Step 6: Commit** — `feat(voice): backfill blank contact fields on dedupe (booking + lead paths)`

---

### Task 4: Spoken-language detection → calls.language

**Files:**
- Create: `apps/web/src/lib/voice/language.ts`
- Modify: `apps/web/src/lib/voice/finish-call.ts` (one line)
- Test: `apps/web/src/lib/voice/language.test.ts` (new), `finish-call.test.ts` (extend)

**Interfaces:**
- Produces: `detectSpokenLanguage(transcript: TranscriptEvent[], profileLanguages: "en" | "es" | "both"): "en" | "es"`
- The `calls.language` column already exists (0019) and `finishCallRow` already writes it — the ONLY gap is that `finishCall` passes the configured profile language. No migration.

- [ ] **Step 1: Failing tests** (`language.test.ts`):

```ts
import { detectSpokenLanguage } from "./language";
const t = (texts: string[], role: "caller" | "assistant" = "caller") =>
  texts.map((text) => ({ role, text, at: "2026-08-27T00:00:00.000Z" }));

describe("detectSpokenLanguage", () => {
  it("fixed-language profiles pass through", () => {
    expect(detectSpokenLanguage(t(["hola buenos días"]), "en")).toBe("en");
    expect(detectSpokenLanguage(t(["hello there"]), "es")).toBe("es");
  });
  it("bilingual profile: Spanish caller detected", () => {
    expect(detectSpokenLanguage(
      t(["hola, necesito una cita para mañana por favor"]), "both")).toBe("es");
  });
  it("bilingual profile: English caller detected", () => {
    expect(detectSpokenLanguage(
      t(["hi, I need an appointment for tomorrow please"]), "both")).toBe("en");
  });
  it("only CALLER turns count — an English caller with a bilingual greeting stays en", () => {
    const mixed = [...t(["Gracias por llamar, ¿en qué puedo ayudarle?"], "assistant"),
                   ...t(["yes hi, do you do roof repair?"])];
    expect(detectSpokenLanguage(mixed, "both")).toBe("en");
  });
  it("empty or inconclusive transcript defaults to en (today's behavior)", () => {
    expect(detectSpokenLanguage([], "both")).toBe("en");
    expect(detectSpokenLanguage(t(["ok"]), "both")).toBe("en");
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**:

```ts
// Which language the CALLER actually spoke, for the calls.language column
// and the Calls page badge. Heuristic word-marker scoring over caller turns
// only — the assistant may greet bilingually, which says nothing about the
// caller. Deliberately coarse: this labels a row, it never routes anything.
import type { TranscriptEvent } from "@bis/db";

const ES_MARKERS = /(?:^|[^a-záéíóúñü])(hola|gracias|buenos|buenas|cita|necesito|quiero|por favor|mañana|día|días|tardes|noches|sí|señor|señora|hablar|ayuda|servicio|cuánto|cuando|dónde|está|tiene|para|pero|porque|también|usted)(?=$|[^a-záéíóúñü])/g;
const EN_MARKERS = /(?:^|[^a-z])(the|and|please|appointment|thanks|thank|hello|hi|yes|need|want|tomorrow|morning|afternoon|help|service|how|much|when|where|have|for|but|because|also|you)(?=$|[^a-z])/g;
const ES_CHARS = /[áéíóúñü¿¡]/g;

function score(text: string, re: RegExp): number {
  return (text.toLowerCase().match(re) ?? []).length;
}

export function detectSpokenLanguage(
  transcript: TranscriptEvent[], profileLanguages: "en" | "es" | "both",
): "en" | "es" {
  if (profileLanguages !== "both") return profileLanguages;
  const callerText = transcript.filter((e) => e.role === "caller").map((e) => e.text).join(" ");
  const es = score(callerText, ES_MARKERS) + score(callerText, ES_CHARS);
  const en = score(callerText, EN_MARKERS);
  // ≥2 Spanish hits AND a majority — a lone "gracias" from an English
  // caller must not flip the row. Ties and empties stay "en" (the column's
  // own default, so behavior only ever *improves* on today's).
  return es >= 2 && es > en ? "es" : "en";
}
```

`finish-call.ts`: import it; replace `language: ctx.profileLanguage === "es" ? "es" : "en",` with `language: detectSpokenLanguage(state.transcript, ctx.profileLanguage),`. Extend `finish-call.test.ts`: a `both`-profile call whose caller turns are Spanish stores `language: "es"` (assert the `finishCallRow` mock's patch).

- [ ] **Step 4: Run** → PASS; tsc clean. **Step 5: Commit** — `feat(voice): record the spoken language on the calls row`

---

### Task 5: Prompt — char-by-char email rule + capture_lead on failed bookings

**Files:**
- Modify: `apps/web/src/lib/voice/system-prompt.ts`
- Test: `apps/web/src/lib/voice/system-prompt.test.ts` (extend; check existing assertions against the replaced line first)

**Interfaces:** none new — `buildSystemPrompt(input, now): string` unchanged.

- [ ] **Step 1: Failing tests**:

```ts
it("email rule demands per-character read-back and disambiguates spoken symbol words", () => {
  const p = buildSystemPrompt(baseInput({ bookingEnabled: true }), now);
  expect(p).toMatch(/character by character/i);
  expect(p).toMatch(/'plus'/);
  expect(p).toMatch(/nonexistent address/);
});
it("failed bookings must capture_lead before take_message", () => {
  const p = buildSystemPrompt(baseInput({ bookingEnabled: true }), now);
  expect(p).toMatch(/FIRST call capture_lead/);
  expect(p).toMatch(/Never end a call knowing the caller's name/);
});
it("booking-disabled prompt carries neither booking rule", () => {
  const p = buildSystemPrompt(baseInput({ bookingEnabled: false }), now);
  expect(p).not.toMatch(/FIRST call capture_lead/);
});
```

(Use the file's existing input-builder helper; add one if it has none.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** — in the `bookingEnabled` block, REPLACE the current email line (`"- Ask once if they would like an email confirmation. ..."`) with:

```ts
      "- EMAIL ADDRESSES — never trust your first hearing. ALWAYS spell the address back character by character — letters, digits, and symbols one at a time — and wait for the caller to confirm before using it. Say 'at' for @ and 'dot' for the period. If you hear the word 'plus', 'dash', 'underscore', or 'dot' INSIDE the address, ask whether they mean the symbol (+, -, _, .) — callers usually mean the symbol, and writing the word instead sends their confirmation to a nonexistent address. Ask once if they would like an email confirmation. If they decline, cannot spell it clearly, or you get it wrong twice, book with the phone number alone and say the business will confirm by phone. Never guess an email address.",
```

And APPEND to the same block (after the "If no suitable time exists" line):

```ts
      "- If a booking cannot be completed — no open time works, details are missing, or a tool fails — do NOT let the caller's details evaporate: FIRST call capture_lead with their name and what they needed, THEN take_message. Never end a call knowing the caller's name without having recorded it through a tool.",
```

- [ ] **Step 4: Run the whole voice suite** (other prompt tests may pin the replaced sentence — update any that assert the OLD email line's exact text, keeping their intent) → PASS; tsc clean.
- [ ] **Step 5: Commit** — `feat(voice): email char-by-char + symbol-word rule; capture_lead on failed bookings`

---

### Task 6: APP_ORIGIN override for email links

**Files:**
- Modify: `apps/web/src/lib/email/origin.ts`
- Modify: `apps/web/src/app/api/cron/reminders/route.ts` (line ~46)
- Modify: `apps/web/src/app/api/voice/incoming/route.ts` (line ~450)
- Modify: `.env.example` (repo root — the confirmed single source)
- Test: `apps/web/src/lib/email/origin.test.ts` (extend)

**Interfaces:**
- Produces: `configuredOrigin(env?: NodeJS.ProcessEnv): string | null` (exported from origin.ts; both routes call it).
- `originFrom(h: Headers)` keeps its signature but now prefers the configured origin.

**Context the implementer must know:** `originFrom`'s doc comment currently argues there should deliberately be NO env var. That decision predates the deliverability root cause (Gmail discards mail whose link domain ≠ sender domain; the cron and voice routes derive `vercel.app` from `req.url`). REWRITE the comment to record the reversal honestly — do not silently delete the old rationale; state why it changed (2026-08-27, deliverability saga, app.bis-rgv.com).

- [ ] **Step 1: Failing tests** (`origin.test.ts` — follow its existing style):

```ts
it("configuredOrigin reads APP_ORIGIN, trims, strips trailing slashes, null when unset/blank", () => {
  expect(configuredOrigin({ APP_ORIGIN: " https://app.bis-rgv.com/ " } as NodeJS.ProcessEnv))
    .toBe("https://app.bis-rgv.com");
  expect(configuredOrigin({} as NodeJS.ProcessEnv)).toBeNull();
  expect(configuredOrigin({ APP_ORIGIN: "  " } as NodeJS.ProcessEnv)).toBeNull();
});
it("originFrom prefers APP_ORIGIN over the Host header", () => {
  vi.stubEnv("APP_ORIGIN", "https://app.bis-rgv.com");
  expect(originFrom(new Headers({ host: "bis-platform-six.vercel.app" })))
    .toBe("https://app.bis-rgv.com");
  vi.unstubAllEnvs();
});
it("originFrom still derives from Host when APP_ORIGIN is unset", () => {
  expect(originFrom(new Headers({ host: "x.example" }))).toBe("https://x.example");
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**:

```ts
export function configuredOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.APP_ORIGIN?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function originFrom(h: Headers): string | null {
  const configured = configuredOrigin();
  if (configured) return configured;
  const host = h.get("host");
  if (!host) return null;
  const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0]!.trim();
  return `${proto}://${host}`;
}
```

Both routes: replace `const origin = new URL(req.url).origin;` with

```ts
  const origin = configuredOrigin() ?? new URL(req.url).origin;
```

(import `configuredOrigin` from `@/lib/email/origin`), and update the adjacent comment in each: the request-URL origin is the *fallback* — a cron/webhook invocation's `req.url` is the deployment's vercel.app URL, which is exactly the link/sender mismatch Gmail discards over.

`.env.example`: add under the email section:

```
# Absolute origin for links inside outbound email (and dashboard links in
# alerts). Set to the custom domain; when unset, links derive from the
# triggering request — which for cron/webhook invocations is the vercel.app
# deployment URL, the exact link/sender mismatch Gmail silently discards.
APP_ORIGIN=https://app.bis-rgv.com
```

- [ ] **Step 4: Run** — origin + cron + voice suites → PASS; tsc clean.
- [ ] **Step 5: Commit** — `feat(email): APP_ORIGIN overrides link origins (cron + voice were leaking vercel.app)`

---

### Task 7: Web-boundary phone normalization

**Files:**
- Modify: `apps/web/src/app/b/[publicId]/actions.ts` (~line 251)
- Modify: `apps/web/src/app/f/[publicId]/actions.ts` (~line 294 create path, ~line 381 fill-blanks pairs)
- Test: the two actions' existing test files (extend)

**Interfaces:** consumes `toE164` from `@/lib/voice/phone-number`. Rule (spec): parseable US numbers → E.164; unparseable input stored **as typed** (never mangled, never rejected for a bad phone beyond the existing `isValidPhone` gates).

- [ ] **Step 1: Failing tests** (both action test files, following each file's mock idiom):
  - booking action with phone `"(956) 555-1234"` → `createContact` receives `phone: "+19565551234"`.
  - form action same for the create path.
  - form fill-blanks path: existing contact with blank phone + incoming `"956-555-1234"` → update writes `"+19565551234"`.
  - unparseable-but-valid-per-`isValidPhone` input passes through as typed (construct from `isValidPhone`'s actual acceptance — read `guards.ts` first; if every `isValidPhone`-accepted string is `toE164`-parseable, assert THAT equivalence in a test instead, so the fallback is provably dead code and documented as such).

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** In `b/[publicId]/actions.ts`:

```ts
    const created = await createContact(db, calendar.account_id, {
      firstName, lastName: lastName || undefined, email,
      // Voice stores E.164; storing web input as-typed made the same person
      // two contacts and hid web bookings from find_my_booking. Parseable →
      // E.164, unparseable → as typed (never mangled, never rejected here).
      phone: phone ? (toE164(phone) ?? phone) : undefined,
      source: "booking",
    }, ACTOR_ID, ACTOR_TYPE);
```

In `f/[publicId]/actions.ts` create path: `phone: byKind.get("core.phone") ? (toE164(byKind.get("core.phone")) ?? byKind.get("core.phone")) : undefined` (adapt to the file's local variable style — hoist `const rawPhone = byKind.get("core.phone") || "";` if cleaner). In the fill-blanks `pairs` array, normalize the phone pair's incoming value the same way before comparison/write.

- [ ] **Step 4: Run** both suites → PASS; tsc clean.
- [ ] **Step 5: Commit** — `feat(web): normalize public-form and booking phones to E.164 at the boundary`
- [ ] **Step 6 (controller, recorded not coded):** prod has ONE real contact — controller read-audits its `phone` and hand-fixes format if needed at exit-gate time. No backfill machinery.

---

### Task 8: TeXML — spoken refusal for disabled profiles + call-cap refusal (bilingual)

**Files:**
- Modify: `apps/web/src/app/api/voice/texml/route.ts`
- Test: its existing test file (find via `Glob apps/web/src/app/api/voice/texml/*`; extend)

**Interfaces:** route-internal only. Consumes `getVoiceProfile`, `countCallsSince`, `countCallsByCallerSince`, `readLimitConfig`, `decideLimit`, `utcDayStart` (all existing exports).

**Behavior contract:**
1. Unknown/non-testing/live number → existing REFUSAL (unchanged).
2. Known number, profile missing or `enabled: false` → spoken refusal in the profile's configured language(s) — TODAY this decline is webhook-side and SILENT (recorded follow-up). Profile missing → English.
3. Known+enabled but over the daily cap (same `decideLimit` semantics as the webhook, counted with `From`) → spoken cap refusal. Cap-count failure fails OPEN (consistent with the webhook's step 8).
4. Any other DB failure keeps failing OPEN to dial — the webhook still gates authoritatively.
5. The webhook's own checks are NOT removed — TeXML is the UX layer, the webhook stays the enforcement layer.

- [ ] **Step 1: Failing route tests** (follow the existing test file's request-construction idiom):
  - known number + `enabled: false` profile → body contains `<Say>` and `Hangup`, no `<Dial>`.
  - profile `languages: "es"` → refusal body contains `language="es-MX"` and the Spanish copy.
  - `languages: "both"` → both `<Say>` elements present.
  - over per-account cap (mock counts ≥ config) → cap copy present, no `<Dial>`.
  - under cap + enabled → `<Dial>` present (existing behavior intact).
  - count lookup throws → `<Dial>` present (fail-open pin).

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Shape (adapt into the file, keeping its lazy-import + fail-open structure):

```ts
type Routability =
  | { kind: "dial" }
  | { kind: "refuse"; languages: "en" | "es" | "both" }
  | { kind: "cap"; languages: "en" | "es" | "both" };

const COPY = {
  refuse: {
    en: "Sorry, this number can't take your call right now. Please try again later.",
    es: "Lo sentimos, este número no puede atender su llamada en este momento. Por favor intente más tarde.",
  },
  cap: {
    en: "We're sorry — we can't take more calls today. Please call back tomorrow.",
    es: "Lo sentimos — hoy ya no podemos atender más llamadas. Por favor llame mañana.",
  },
} as const;

function sayXml(languages: "en" | "es" | "both", copy: { en: string; es: string }): string {
  const en = `<Say>${copy.en}</Say>`;
  const es = `<Say language="es-MX">${copy.es}</Say>`;
  const says = languages === "es" ? es : languages === "both" ? en + es : en;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${says}<Hangup/></Response>`;
}

async function classify(calledE164: string, callerE164: string | null): Promise<Routability> {
  try {
    const { serviceDb, getPhoneNumberByE164, getVoiceProfile,
            countCallsSince, countCallsByCallerSince } = await import("@bis/db");
    const { readLimitConfig, decideLimit, utcDayStart } = await import("@/lib/voice/call-limits");
    const db = serviceDb();
    const row = await getPhoneNumberByE164(db, calledE164);
    if (!row || (row.status !== "testing" && row.status !== "live")) {
      return { kind: "refuse", languages: "en" };
    }
    const profile = await getVoiceProfile(db, row.account_id);
    if (!profile || !profile.enabled) {
      return { kind: "refuse", languages: profile?.languages ?? "en" };
    }
    // Cap UX only — the caller deserves words, not dead air. The incoming
    // webhook re-checks with the same decideLimit and stays authoritative.
    try {
      const dayStart = utcDayStart(new Date());
      const forAccount = await countCallsSince(db, row.account_id, dayStart);
      const forNumber = callerE164
        ? await countCallsByCallerSince(db, row.account_id, callerE164, dayStart) : 0;
      if (!decideLimit({ forNumber, forAccount }, readLimitConfig()).allowed) {
        return { kind: "cap", languages: profile.languages };
      }
    } catch (e) {
      console.error(`texml cap count failed for ${calledE164}: ${String(e)}`); // fail open
    }
    return { kind: "dial" };
  } catch (e) {
    console.error(`texml lookup failed for ${calledE164}: ${String(e)}`);
    return { kind: "dial" }; // fail open — the webhook still gates
  }
}
```

`respond(...)` gains the caller number parameter (POST already parses the form — pass `From` through `toE164`; GET reads the `From` query param), switches on `classify`, and keeps `dialXml` for `kind: "dial"`. Keep the old `REFUSAL` constant's copy as `COPY.refuse.en` (byte-identical English sentence — an existing test may pin it).

- [ ] **Step 4: Run** → PASS; tsc clean.
- [ ] **Step 5: Commit** — `feat(voice): spoken TeXML refusals for disabled profiles and the daily call cap`

---

### Task 9: TeXML — Telnyx webhook signature validation

**Files:**
- Create: `apps/web/src/lib/voice/telnyx-signature.ts`
- Create: `apps/web/src/lib/voice/telnyx-signature.test.ts`
- Modify: `apps/web/src/app/api/voice/texml/route.ts`
- Modify: `.env.example`
- Test: texml route tests (extend)

**Interfaces:**
- Produces: `verifyTelnyxSignature(input: { rawBody: string; timestamp: string | null; signatureB64: string | null; publicKeyB64: string }): boolean`

**Behavior contract:**
- `TELNYX_PUBLIC_KEY` unset → today's behavior exactly (no validation; the runbook tells danlo when to set it).
- Set → POST must carry a valid Ed25519 signature (`telnyx-signature-ed25519` + `telnyx-timestamp` headers, message = `${timestamp}|${rawBody}`, Telnyx v2 scheme) or get **403** with a log line; GET returns **405** (the diagnostic path closes in hardened mode — it would otherwise hand out the SIP project URI unauthenticated).
- POST must read `await req.text()` FIRST and parse the form from that string (`new URLSearchParams(raw)`) — `req.formData()` consumes the body and the signature is over the exact raw bytes.

- [ ] **Step 1: Failing unit tests** (`telnyx-signature.test.ts`) — generate a real keypair, no fixtures:

```ts
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { verifyTelnyxSignature } from "./telnyx-signature";

function makeSigned(body: string, timestamp: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const sig = cryptoSign(null, Buffer.from(`${timestamp}|${body}`, "utf8"), privateKey);
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return { publicKeyB64: spki.subarray(spki.length - 32).toString("base64"),
           signatureB64: sig.toString("base64") };
}

describe("verifyTelnyxSignature", () => {
  const body = "To=%2B19565061545&From=%2B19562921696";
  const ts = "1756300000";
  it("accepts a valid signature", () => {
    const { publicKeyB64, signatureB64 } = makeSigned(body, ts);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: ts, signatureB64, publicKeyB64 })).toBe(true);
  });
  it("rejects a tampered body", () => {
    const { publicKeyB64, signatureB64 } = makeSigned(body, ts);
    expect(verifyTelnyxSignature({ rawBody: body + "&x=1", timestamp: ts, signatureB64, publicKeyB64 })).toBe(false);
  });
  it("rejects a wrong timestamp, missing headers, and garbage keys without throwing", () => {
    const { publicKeyB64, signatureB64 } = makeSigned(body, ts);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: "999", signatureB64, publicKeyB64 })).toBe(false);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: null, signatureB64, publicKeyB64 })).toBe(false);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: ts, signatureB64: null, publicKeyB64 })).toBe(false);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: ts, signatureB64, publicKeyB64: "!!!" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**:

```ts
// Telnyx v2 webhook signatures: Ed25519 over `${timestamp}|${rawBody}`,
// headers telnyx-signature-ed25519 + telnyx-timestamp, public key from the
// Telnyx portal as base64 raw 32 bytes. Never throws — a malformed header
// or key is simply not a valid signature.
import { createPublicKey, verify as cryptoVerify } from "node:crypto";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyTelnyxSignature(input: {
  rawBody: string; timestamp: string | null; signatureB64: string | null; publicKeyB64: string;
}): boolean {
  if (!input.timestamp || !input.signatureB64) return false;
  try {
    const raw = Buffer.from(input.publicKeyB64, "base64");
    if (raw.length !== 32) return false;
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki",
    });
    return cryptoVerify(
      null,
      Buffer.from(`${input.timestamp}|${input.rawBody}`, "utf8"),
      key,
      Buffer.from(input.signatureB64, "base64"),
    );
  } catch {
    return false;
  }
}
```

Route changes:

```ts
export async function GET(req: Request): Promise<NextResponse> {
  if (process.env.TELNYX_PUBLIC_KEY?.trim()) {
    // Hardened mode: Telnyx only ever POSTs; an unauthenticated GET would
    // hand out the SIP project URI to anyone who finds the route.
    return new NextResponse(null, { status: 405 });
  }
  // ...existing GET body unchanged...
}

export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text();
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  if (publicKey) {
    const ok = verifyTelnyxSignature({
      rawBody,
      timestamp: req.headers.get("telnyx-timestamp"),
      signatureB64: req.headers.get("telnyx-signature-ed25519"),
      publicKeyB64: publicKey,
    });
    if (!ok) {
      console.error("texml: rejected request with invalid Telnyx signature");
      return new NextResponse(null, { status: 403 });
    }
  }
  const form = new URLSearchParams(rawBody);
  const to = form.get("To") || null;
  const from = form.get("From") || null;
  return respond(toE164(to), toE164(from));
}
```

Route tests: unset-key → old behavior (existing tests keep passing); key set + no headers → 403; key set + valid signature (sign in the test with the same keypair helper) → normal XML; GET with key set → 405.

`.env.example`: add `TELNYX_PUBLIC_KEY=` with a comment (Telnyx portal → account settings → public key; unset = validation off).

- [ ] **Step 4: Run** → PASS; tsc clean.
- [ ] **Step 5: Commit** — `feat(voice): Telnyx Ed25519 signature validation on the TeXML route`

---

### Task 10: Calls list page + nav + daily usage meter

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/page.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/calls-table.tsx`
- Modify: `apps/web/src/components/app-sidebar.tsx` (nav item, BOTH audiences)
- Modify: `apps/web/src/lib/messages.ts` (keys below)
- Test: `calls/page.test.ts` colocated if the repo tests pages (check — most page logic here is trivial reads; the real coverage is Task 15's e2e). Unit-test the one pure piece: outcome/duration formatting helpers in `calls-table.tsx` → extract to `calls/format.ts` + `calls/format.test.ts`.

**Interfaces:**
- Consumes: `listCalls`, `CallListRow` (Task 2); `countCallsSince`, `utcDayStart`, `readLimitConfig` (existing); `requireAccountAccess`, `dbForRequest`, `PageHeader`, `m`.
- Produces: route `/dashboard/accounts/[accountId]/calls` with `?before=<iso>` cursor paging (server-rendered links, no client state); `formatDuration(secs: number | null): string` ("1:02", "—" for null) and `callerLabel(row: CallListRow): string` (contact name > caller_e164 > "Unknown caller") in `calls/format.ts` — Task 11 reuses both.

**BEFORE writing the UI: invoke the `frontend-design:frontend-design` skill** (Global Constraints). Required content, whatever the visual treatment: PageHeader "Calls"; usage meter "N of CAP calls today" with a progress bar reading `countCallsSince(db, accountId, utcDayStart(new Date()))` against `readLimitConfig().perAccountPerDay` — the SAME functions enforcement uses, never a second formula; table/rows: started time (account-timezone formatted), caller (contact name linked to `/contacts/[contactId]` when `contact_id`, else `caller_e164`), duration, outcome badge (booked/lead/message/abandoned/spam — distinct colors, `booked` positive), language badge (EN/ES); each row links to `calls/[id]`; empty state via the existing `empty-state.tsx` component; "Older calls →" link with `?before=` when a full page came back.

Messages keys (add; exact copy):

```ts
  "nav.calls": "Calls",
  "calls.title": "Calls",
  "calls.usage": "{n} of {cap} calls today",
  "calls.empty.title": "No calls yet",
  "calls.empty.body": "When your AI receptionist answers a call, it will appear here with its transcript and outcome.",
  "calls.col.when": "When",
  "calls.col.caller": "Caller",
  "calls.col.duration": "Duration",
  "calls.col.outcome": "Outcome",
  "calls.col.language": "Language",
  "calls.older": "Older calls",
  "calls.unknownCaller": "Unknown caller",
  "calls.outcome.booked": "Booked",
  "calls.outcome.lead": "Lead",
  "calls.outcome.message": "Message",
  "calls.outcome.abandoned": "Abandoned",
  "calls.outcome.spam": "Spam",
```

(If `m` values elsewhere use `{param}` interpolation, follow that idiom; if not, build the usage string in the component from two keys.)

Nav: in `app-sidebar.tsx`'s `items`, insert after Conversations, for BOTH audiences (no `isAgency` guard): `{ href: \`${base}/calls\`, label: m["nav.calls"], icon: PhoneIncoming }` (import `PhoneIncoming` from lucide-react — `Phone` is taken by agency Voice).

Page skeleton (server component — complete this, then design-elevate):

```tsx
import { listCalls, countCallsSince } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { readLimitConfig, utcDayStart } from "@/lib/voice/call-limits";
import { m } from "@/lib/messages";
import { CallsTable } from "./calls-table";

export const dynamic = "force-dynamic";

export default async function CallsPage({ params, searchParams }: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { accountId } = await params;
  const { before } = await searchParams;
  await requireAccountAccess(accountId);
  const db = await dbForRequest();
  const [rows, todayCount] = await Promise.all([
    listCalls(db, accountId, { limit: 50, before }),
    countCallsSince(db, accountId, utcDayStart(new Date())),
  ]);
  const cap = readLimitConfig().perAccountPerDay;
  return (/* PageHeader + meter + <CallsTable rows accountId/> + older-link */);
}
```

- [ ] **Step 1:** failing `format.test.ts` (duration 0→"0:00", 62→"1:02", null→"—"; callerLabel precedence incl. first+last join and the Unknown fallback). **Step 2:** run FAIL. **Step 3:** implement format.ts + page + table (frontend-design pass). **Step 4:** run web suite + tsc → PASS. **Step 5:** commit — `feat(web): per-client Calls page with daily usage meter`

---

### Task 11: Call detail page

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/page.tsx`
- Create: `.../calls/[callId]/transcript-view.tsx`
- Modify: `apps/web/src/lib/messages.ts`
- Test: extract + test the pure summary-block splitter: `calls/[callId]/summary-blocks.ts` + `.test.ts`

**Interfaces:**
- Consumes: `getCall`, `CallDetailRow` (Task 2); `formatDuration`, `callerLabel` (Task 10); `notFound` from `next/navigation`.
- Produces: `splitSummaryBlocks(summary: string): { kind: "facts" | "mismatch" | "prose"; text: string }[]` — the stored summary is `composeSummary` output: fact line first, optional `⚠ MISMATCH —` paragraph, then prose, joined by blank lines. Split on double newlines; a block starting with `⚠ MISMATCH` is `kind: "mismatch"`; the first block is `facts`; the rest `prose`.

**BEFORE the UI: frontend-design skill.** Required content: header (outcome badge, started at, duration, language); summary section — fact line prominent, mismatch block visually a WARNING (this is the honesty layer; it must not blend in), prose after; transcript as a two-sided conversation (caller left, assistant right, timestamps subtle) rendered from `transcript` jsonb as **plain text** (React escaping only — never `dangerouslySetInnerHTML`); sidebar/footer links, each rendered ONLY when its id is non-null: contact → `/dashboard/accounts/[accountId]/contacts/[contactId]`, conversation → `.../conversations` (the list page — there is no per-thread route; verify with a Glob before linking deeper), booking → `.../calendar`. `getCall` null → `notFound()`.

Messages keys:

```ts
  "calls.detail.title": "Call",
  "calls.detail.summary": "Summary",
  "calls.detail.transcript": "Transcript",
  "calls.detail.viewContact": "View contact",
  "calls.detail.viewConversation": "View conversation",
  "calls.detail.viewBooking": "View booking",
  "calls.detail.assistant": "Assistant",
  "calls.detail.caller": "Caller",
  "calls.detail.noTranscript": "No transcript was recorded for this call.",
```

- [ ] **Step 1:** failing `summary-blocks.test.ts`: plain fact-line-only summary → one `facts` block; composed summary with the exact `⚠ MISMATCH — the notes below mention an appointment...` paragraph → `["facts","mismatch","prose"]` kinds; empty string → `[]`.
- [ ] **Step 2:** run FAIL. **Step 3:** implement splitter + pages (frontend-design pass). **Step 4:** web suite + tsc + `pnpm --filter web build` (route-collection catches server/client boundary mistakes) → PASS. **Step 5:** commit — `feat(web): call detail page with honest summary and conversation transcript`

---

### Task 12: deriveSetupStatus — the wizard's pure reality checks

**Files:**
- Create: `apps/web/src/lib/setup/setup-status.ts`
- Test: `apps/web/src/lib/setup/setup-status.test.ts`

**Interfaces (Tasks 13/14 rely on these exact names):**

```ts
export type SetupStepKey =
  | "account" | "branding" | "hours" | "voice_profile" | "number"
  | "email" | "forwarding" | "test_call" | "go_live";
export type SetupStepState = { key: SetupStepKey; done: boolean; skipped: boolean };
export type SetupInputs = {
  brandName: string | null;
  fromEmail: string | null;
  calendar: Pick<CalendarRow, "enabled" | "open_hours"> | null;
  profile: Pick<VoiceProfileRow, "greeting_en" | "greeting_es" | "facts" | "enabled" | "languages"> | null;
  numbers: Pick<PhoneNumberRow, "status">[];
  callCount: number;
  ticks: { emailSkipped: boolean; forwardingDone: boolean };
};
export function deriveSetupStatus(inputs: SetupInputs): SetupStepState[]; // always all 9, in order
export function goLivePrereqsMet(steps: SetupStepState[]): boolean;      // hours && voice_profile && number && test_call
export const SETUP_TICK_KEYS = {
  emailSkipped: "setup:email_skipped",
  forwardingDone: "setup:forwarding_done",
} as const;
```

**Checks (from the spec's table — each one testable in BOTH directions):**
- `account`: always `done: true`.
- `branding`: `brandName` non-blank after trim.
- `hours`: `calendar?.enabled === true` AND at least one day in `open_hours` has a non-empty window array.
- `voice_profile`: profile exists, `facts` non-blank, AND the primary-language greeting non-blank (`languages === "es"` → `greeting_es`, else `greeting_en` — mirror of the incoming route's step-11 greeting pick).
- `number`: any number with status `provisioned` | `testing` | `live` (a lone `released` row does not count).
- `email`: `fromEmail` non-blank → done; else `ticks.emailSkipped` → `done: false, skipped: true` (the card renders "skipped", the pending reminder stays honest).
- `forwarding`: `ticks.forwardingDone`.
- `test_call`: `callCount > 0`.
- `go_live`: `profile?.enabled === true` AND some number status `live`.

- [ ] **Step 1:** failing tests — for EVERY check: one input where it is done and one where it is not (hours: enabled-but-empty-object `{}` NOT done — this is the exact wiped-config bug from exit-gate call #1, name it in the test title; enabled with `{ mon: [["09:00","17:00"]] }` done; disabled with hours NOT done. voice_profile: es-profile with only greeting_es done; es-profile with only greeting_en NOT done. number: `[{status:"released"}]` NOT done. email: skipped → `done false, skipped true`.) Plus `goLivePrereqsMet`: true only when hours+voice_profile+number+test_call all done (email/forwarding explicitly NOT required — assert a met-case with email undone).
- [ ] **Step 2:** run FAIL. **Step 3:** implement (pure, no db import beyond types from `@bis/db`). **Step 4:** run PASS + tsc. **Step 5:** commit — `feat(web): deriveSetupStatus — wizard reality checks as a pure module`

---

### Task 13: Setup page + panel UI, tick actions, entry redirect, back-links, nav

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/setup/page.tsx`
- Create: `.../setup/setup-panel.tsx`
- Create: `.../setup/actions.ts` (tick action only — go-live/move-number are Task 14)
- Create: `apps/web/src/components/back-to-setup.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/actions.ts` (redirect → `/setup`)
- Modify: pages `branding/page.tsx`, `calendar/page.tsx`, `voice/page.tsx`, `settings/page.tsx` (render `BackToSetup` when `?from=setup`)
- Modify: `app-sidebar.tsx` (agency-only Setup item), `messages.ts`
- Test: `setup/actions.test.ts`; back-link + page composition covered by Task 15 e2e

**Interfaces:**
- Consumes: `deriveSetupStatus`, `goLivePrereqsMet`, `SETUP_TICK_KEYS` (Task 12); `getCalendarForAccount`, `listPhoneNumbersForAccount` (Task 1); `getVoiceProfile`, `listChecklistState`, `setChecklistItem`, `countCallsSince` (existing); `requireAgencyOnlyAccountAccess`.
- Produces: `setSetupTickAction(accountId: string, tick: "emailSkipped" | "forwardingDone", done: boolean): Promise<{ ok: boolean }>`; `<BackToSetup accountId={string} />`; SetupPanel props: `{ accountId: string; steps: SetupStepState[]; prereqsMet: boolean; assignedNumber: string | null; goLive: ...(Task 14 wires); moveNumber: ...(Task 14) }` — Task 13 renders the go-live button DISABLED with a title explaining what's missing; Task 14 wires the action.

**Page reads (all `dbForRequest()` — the grant-blindness countermeasure is that these run as the signed-in agency user):** account row `select("name, brand_name, from_email")` inline (checklist-page style); `getCalendarForAccount` (NEVER `getOrCreateCalendar` — it writes); `getVoiceProfile`; `listPhoneNumbersForAccount`; `listChecklistState` → read `SETUP_TICK_KEYS` rows (`done_at` non-null = ticked; keys not in the checklist catalogue never render there — verified `mergeChecklist` behavior); `countCallsSince(db, accountId, "1970-01-01T00:00:00.000Z")` for test_call. **Wrap each read's usage so a thrown read renders the step as "couldn't check" — never `done`** (catch per-read, pass `null`/`0` plus an `errored` flag the panel renders distinctly; a simple approach: `Promise.allSettled` and map rejections to an `unknown` render state; the derive function still only sees clean inputs for the settled ones).

`setSetupTickAction` (follow `voice/actions.ts`'s guard idiom exactly — read that file first):

```ts
"use server";
import { requireAccountAccess } from "@/lib/auth";
import { serviceDb, setChecklistItem } from "@bis/db";
import { SETUP_TICK_KEYS } from "@/lib/setup/setup-status";

export async function setSetupTickAction(
  accountId: string, tick: keyof typeof SETUP_TICK_KEYS, done: boolean,
): Promise<{ ok: boolean }> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false };                    // reject BEFORE any db call
  await setChecklistItem(serviceDb(), accountId, SETUP_TICK_KEYS[tick], { done }, userId);
  return { ok: true };
}
```

`createClientAccount` redirect: change `/checklist${...}` → `/setup${applyOutcome === "partial" ? "?apply=partial" : ""}` and add the same `apply === "partial"` warning banner to the setup page (copy the checklist page's `role="alert"` block; the checklist page keeps its own).

`BackToSetup`: a small server component — `<Link href={\`/dashboard/accounts/${accountId}/setup\`}>← {m["setup.backToSetup"]}</Link>` styled as a quiet breadcrumb above PageHeader. Each of the four target pages: read `searchParams`' `from`, render `{from === "setup" ? <BackToSetup accountId={accountId} /> : null}`. (Three of the four already read searchParams or can add it — `checklist/page.tsx` shows the idiom.)

Nav: agency-only item after Voice: `{ href: \`${base}/setup\`, label: m["nav.setup"], icon: ListChecks }`.

**BEFORE the panel UI: frontend-design skill.** Required content per card: step number + title + one-line help; state = done (check) / open (circle) / skipped (for email) / couldn't-check (distinct, never green); action button → target page with `?from=setup` (branding → `/branding`, hours → `/calendar`, voice_profile + number → `/voice`, email → `/settings`); forwarding card shows the assigned number to forward to (from `listPhoneNumbersForAccount`, first non-released e164) + a manual tick button; email card: tick button "Skip for now" + un-skip; test_call card: "Call {e164} and it will appear here" + link to `/calls`; go_live card: the button (disabled until Task 14 wires it; disabled-reason from unmet steps). This page is the product's showroom — design like it.

Messages keys:

```ts
  "nav.setup": "Setup",
  "setup.title": "Client setup",
  "setup.backToSetup": "Back to setup",
  "setup.state.done": "Done",
  "setup.state.open": "To do",
  "setup.state.skipped": "Skipped",
  "setup.state.unknown": "Couldn't check — reload to retry",
  "setup.step.account.title": "Create the account",
  "setup.step.account.help": "This company exists — you're looking at it.",
  "setup.step.branding.title": "Branding",
  "setup.step.branding.help": "Set the brand name your client's customers will see on every email and page.",
  "setup.step.hours.title": "Business hours",
  "setup.step.hours.help": "Enable the calendar and set open hours — without them, callers hear \"no availability\" for every day.",
  "setup.step.voice_profile.title": "Voice profile",
  "setup.step.voice_profile.help": "Greeting, business facts, and persona for the AI receptionist.",
  "setup.step.number.title": "Phone number",
  "setup.step.number.help": "Assign a BIS number to this client. Buy numbers in the Telnyx dashboard, then assign here.",
  "setup.step.email.title": "Email identity",
  "setup.step.email.help": "Send from the client's own domain. Optional — until it's set, mail sends from the platform address.",
  "setup.step.email.skip": "Skip for now",
  "setup.step.email.unskip": "Un-skip",
  "setup.step.forwarding.title": "Call forwarding",
  "setup.step.forwarding.help": "The client forwards their business line to the number below at their carrier. Tick when confirmed.",
  "setup.step.forwarding.tick": "Forwarding is set up",
  "setup.step.forwarding.untick": "Not set up yet",
  "setup.step.test_call.title": "Test call",
  "setup.step.test_call.help": "Call the assigned number. The call will appear on the Calls page and turn this step green.",
  "setup.step.go_live.title": "Go live",
  "setup.step.go_live.help": "Enables the receptionist and marks the number live. Callers get real answers from here on.",
  "setup.goLive.button": "Go live",
  "setup.goLive.blocked": "Finish these steps first: {steps}",
  "setup.viewCalls": "View calls",
  "setup.openStep": "Open",
```

- [ ] **Step 1:** failing `setup/actions.test.ts`: client session (`isAgency: false` mock) → `{ ok: false }` and `setChecklistItem` NOT called (the reject-before-db pin); agency → called with `serviceDb()` result, `"setup:email_skipped"`, `{ done: true }`, userId.
- [ ] **Step 2:** run FAIL. **Step 3:** implement action → PASS → commit `feat(web): setup tick action (agency-only, checklist-backed)`.
- [ ] **Step 4:** build page + panel (frontend-design pass) + BackToSetup + the four page edits + redirect change + nav + messages. `pnpm --filter web build` (catches server/client boundary + searchParams typing) + full web suite (the accounts actions test may pin the old redirect — update it to `/setup`).
- [ ] **Step 5:** commit — `feat(web): Setup wizard page — derived step states over live rows`

---

### Task 14: Go-live + move-number actions, wired into the panel

**Files:**
- Modify: `.../setup/actions.ts` (add `goLiveAction`)
- Modify: `.../voice/actions.ts` (add `moveNumberAction`)
- Modify: `.../setup/setup-panel.tsx` (wire both; number step's move UI)
- Test: `setup/actions.test.ts`, `voice/actions.test.ts` (extend)

**Interfaces:**
- Produces: `goLiveAction(accountId: string): Promise<{ ok: true } | { ok: false; error: string }>`; `moveNumberAction(accountId: string, phoneNumberId: string): Promise<{ ok: true } | { ok: false; error: string }>`.
- Consumes: `reassignPhoneNumber`, `listPhoneNumbersForAccount`, `listAllPhoneNumbers`, `getCalendarForAccount` (Task 1); `deriveSetupStatus`, `goLivePrereqsMet` (Task 12); `upsertVoiceProfile`, `setPhoneNumberStatus`, `getVoiceProfile`, `listChecklistState`, `countCallsSince` (existing).

`goLiveAction` — **the server-side re-check IS the enforcement** (a disabled button is UI courtesy):

```ts
export async function goLiveAction(
  accountId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["setup.goLive.denied"] };
  const db = serviceDb();
  // Re-derive from live rows AT CLICK TIME — the page's render is stale the
  // moment it paints, and a bypassed disabled button must hit this wall.
  const [calendar, profile, numbers, callCount, ticks] = await Promise.all([
    getCalendarForAccount(db, accountId),
    getVoiceProfile(db, accountId),
    listPhoneNumbersForAccount(db, accountId),
    countCallsSince(db, accountId, "1970-01-01T00:00:00.000Z"),
    listChecklistState(db, accountId),
  ]);
  // brandName/fromEmail don't gate go-live; pass nulls rather than fetching.
  const steps = deriveSetupStatus({
    brandName: null, fromEmail: null, calendar, profile, numbers, callCount,
    ticks: {
      emailSkipped: ticks.some((t) => t.item_key === SETUP_TICK_KEYS.emailSkipped && t.done_at),
      forwardingDone: ticks.some((t) => t.item_key === SETUP_TICK_KEYS.forwardingDone && t.done_at),
    },
  });
  if (!goLivePrereqsMet(steps)) return { ok: false, error: m["setup.goLive.notReady"] };

  const target = numbers.find((n) => n.status !== "released");
  if (!target) return { ok: false, error: m["setup.goLive.notReady"] };
  await upsertVoiceProfile(db, accountId, { enabled: true }, userId);
  await setPhoneNumberStatus(db, accountId, target.id, "live", userId);
  return { ok: true };
}
```

`moveNumberAction` in `voice/actions.ts` (same guard idiom as that file's other actions; read them first and match exactly — including their result-shape convention):

```ts
export async function moveNumberAction(
  accountId: string, phoneNumberId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["voice.denied"] };  // reuse the file's denial copy
  try {
    await reassignPhoneNumber(serviceDb(), phoneNumberId, accountId, userId);
    return { ok: true };
  } catch (e) {
    console.error(`moveNumberAction failed: ${String(e)}`);
    return { ok: false, error: m["voice.moveFailed"] };
  }
}
```

Panel number-step UI: when the account has no active number, list `listAllPhoneNumbers` (page fetches it agency-side and passes down) — each row: e164 + current account name + "Move here" button → `moveNumberAction`; plus the static "buy in Telnyx, assign on the Voice page" help linking to `/voice?from=setup`. Go-live button: enabled when `prereqsMet`, calls `goLiveAction`, refreshes (router.refresh()) on `{ok:true}`, shows the returned error inline otherwise. New messages keys: `"setup.goLive.denied": "Only the agency can take a client live."`, `"setup.goLive.notReady": "Not everything is ready — finish the open steps above."`, `"voice.moveFailed": "Couldn't move that number — check it isn't in use and try again."`, `"setup.number.moveHere": "Move here"`, `"setup.number.currentlyOn": "currently on {account}"`.

- [ ] **Step 1:** failing tests: `goLiveAction` client session → denied, NO db mock touched; prereqs unmet (empty open_hours!) → `{ok:false}` and neither `upsertVoiceProfile` nor `setPhoneNumberStatus` called (**the server-guard pin**); prereqs met → both called, number status `"live"`; `moveNumberAction` client denied before db, agency happy-path calls `reassignPhoneNumber(serviceDb(), phoneNumberId, accountId, userId)`, thrown reassign → `{ok:false}`.
- [ ] **Step 2:** run FAIL. **Step 3:** implement + wire panel. **Step 4:** web suite + tsc + build → PASS. **Step 5:** commit — `feat(web): go-live and move-number actions with server-side prerequisite re-check`

---

### Task 15: e2e — setup, calls, audience visibility

**Files:**
- Create: `apps/web/e2e/setup.spec.ts`
- Create: `apps/web/e2e/calls.spec.ts`
- Modify: `apps/web/e2e/support.ts` (seeding helpers if needed)

**Context:** read `support.ts`, `auth.setup.ts`, and one existing spec (`contacts.spec.ts`) FIRST — reuse their storage-state fixtures (`state.json` = agency, `client-state.json` = client), account-id discovery, and seeding idioms. Seed via a service-role Supabase client the way the suite already does (or add a helper). These e2e sessions are the ONLY layer that can see grant gaps (two shipped defects) — that is this task's whole reason to exist.

- [ ] **Step 1: `setup.spec.ts`** — agency session:
  - `/dashboard/accounts/<id>/setup` renders all 9 step cards.
  - The hours card reflects reality: with the test account's calendar hours EMPTIED via the service client, the card shows "To do"; after restoring hours + enabled, reload shows "Done". (**This is the wiped-open_hours regression guard, at the only layer that reads through real grants.**)
  - Email card: click "Skip for now" → state becomes "Skipped" after reload (tick persisted).
  - Go-live button disabled (test fixture has no calls) with the blocked reason visible.
  - Client session: navigating to `/setup` lands on `/dashboard/accounts/<id>/dashboard` (the `requireAgencyOnlyAccountAccess` redirect), and the sidebar has NO "Setup" item.

- [ ] **Step 2: `calls.spec.ts`**:
  - Seed one finished call row (service client: insert `phone_numbers` row + `calls` row with a 2-turn transcript, outcome `booked`, language `es`, linked to a seeded contact).
  - Agency session: `/calls` lists it — caller name, outcome badge "Booked", "ES" badge, usage meter shows "1 of 50 calls today" (or the env-configured cap).
  - Row click → detail: summary visible, both transcript turns rendered, "View contact" link present and navigates.
  - Client session: `/calls` renders the same row (client CAN see calls — the 0020 SELECT grant through real RLS), and the sidebar SHOWS Calls.
  - Cleanup: delete seeded rows (the suite's teardown idiom).

- [ ] **Step 3:** run the two specs alone (`pnpm --filter web test:e2e -- setup.spec.ts calls.spec.ts`) → PASS. (Red-spec protocol: re-run the failing spec ALONE before investigating — judge by wall clock.)
- [ ] **Step 4:** commit — `test(e2e): setup wizard and calls pages through real signed-in sessions`

---

### Task 16: Final gates, runbook, env docs, ledger

**Files:**
- Modify: `docs/runbooks/voice-setup.md`
- Modify: `.env.example` (verify Tasks 6/9 additions landed; sweep for gaps)
- Modify: `.superpowers/sdd/progress.md` (ledger)

- [ ] **Step 1:** Full gates, in order: `pnpm check` (typecheck 0 · lint 0 errors · db suite · web suite) exit 0 → `pnpm --filter web build` clean → `pnpm --filter web test:e2e` full suite green (expect ~33+ specs now; warm run 2.1–2.6 min + the new specs).
- [ ] **Step 2:** Runbook: add a "Client onboarding (wizard)" section — the Setup page now walks steps 1–9; buy-number stays a Telnyx-dashboard step; document `TELNYX_PUBLIC_KEY` with the ACTIVATION PROCEDURE (corrected during Task 9 review — the prod TeXML app currently uses **Voice Method GET**, and setting the key while it does would 405 every live call): ① flip the TeXML app's Voice Method to POST in the Telnyx portal, ② verify a test call still routes, ③ set `TELNYX_PUBLIC_KEY` in Vercel (portal → Keys & Credentials → Public Key), ④ one more test call — a 403 in logs means Telnyx isn't signing as expected; rollback = remove the key. REWRITE runbook step 3's "Voice Method: GET" instruction and its verification line (voice-setup.md ~lines 68-69 and 75) to the POST-first procedure. ALSO document `APP_ORIGIN` (set to `https://app.bis-rgv.com`; why: link/sender match). Update the old step-5/6/7 text to point at the wizard.
- [ ] **Step 3:** Ledger: new `═══ WIZARD + CALLS (SUB-PROJECT 2) ═══` section — tasks complete, gates, the two env vars danlo must set (`APP_ORIGIN`, `TELNYX_PUBLIC_KEY`), migration 0021 applied-by-controller note, deferred follow-ups carried from the spec (agency-wide roll-up, Telnyx purchase API, checklist consolidation), and the exit-gate checklist (dry-run steps from the spec §Exit gate).
- [ ] **Step 4:** Commit — `docs: wizard runbook section, env docs, ledger for sub-project 2`

---

## Plan Self-Review (run before handoff)

1. **Spec coverage:** wizard steps/checks → T12/13/14; thin reuse + back-links + redirect → T13; number reassignment → T1/T14; Calls list/detail/meter → T2/10/11; follow-up 1 → T3; 2 → T6; 3+4 → T5; 5 → T9; 6+7 → T8; 8 → T1; 9 → T7; 10 → T4; e2e/grant countermeasure → T15; gates/runbook/ledger → T16; design-quality → global constraint + T10/11/13; daily-cap correction → spec updated + T10.
2. **Type consistency:** `SetupStepState`/`SetupInputs`/`SETUP_TICK_KEYS` defined T12, consumed T13/14 by those names; `CallListRow`/`CallDetailRow`/`listCalls`/`getCall` defined T2, consumed T10/11; `fillContactBlanks` T3 signature matches both call sites; `reassignPhoneNumber(db, phoneNumberId, toAccountId, actorId, actorType?)` T1 = T14's call; `configuredOrigin` T6 used in both routes; `formatDuration`/`callerLabel` T10 → T11.
3. **Verified-against-source claims:** `assignPhoneNumber` insert-only (voice.ts:38) · `createContact` returns `{id, existing}` (contacts.ts:72) · cap is per-DAY (call-limits.ts) · `calls.language` column exists with `'en'` default (0019) · `finishCall` writes profile language (finish-call.ts:218) · `getOrCreateCalendar` writes (booking.ts:77 — hence `getCalendarForAccount`) · `mergeChecklist` drops non-catalogue keys (checklist-catalogue.ts:51) · `createClientAccount` redirects to `/checklist` (accounts/actions.ts:56) · texml POST uses `req.formData()` today (route.ts:65 — hence the raw-body refactor in T9).
