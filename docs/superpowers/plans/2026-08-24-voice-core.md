# Voice Receptionist Core (V1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the proven Sofía answering-service brain (bis-reception-demo) into bis-platform as a multi-tenant module: a call to a client's number is routed to their account, speaks from their voice profile, books their native calendar, and lands as a contact + conversation + lead alert.

**Architecture:** One shared Telnyx TeXML app bridges every client number to the platform's OWN OpenAI project (SIP connector). OpenAI's `realtime.call.incoming` webhook hits `/api/voice/incoming`, which resolves the tenant from the CALLED number, accepts the call with that account's session config, and runs one long-lived invocation holding the WebSocket. Per-call state is in-process (no Redis). Tools write through existing `@bis/db` accessors under `serviceDb()`. At hangup, a durable `calls` row + the standard lead treatment.

**Tech Stack:** Next 16 App Router (apps/web), `@bis/db` (Supabase), OpenAI Realtime (SIP + WS via `ws`), `openai` SDK (webhook unwrap only), Resend via existing `EmailProvider`.

**Spec:** `docs/superpowers/specs/2026-08-24-voice-receptionist-core-design.md`

## Deviations from the spec (flagged, all within its intent)

1. **`find_my_booking` queries contacts-by-phone → upcoming booking**, not the spec's `calls.booking_id` map. The spec's rationale for the calls map was a Cal.com limitation (no search by phone) that does not exist natively — the direct query also finds bookings made on the web with the same phone.
2. **`calls` rows are inserted at accept and updated at hangup** (spec implied end-write, the demo's pattern). Reason: daily call caps need a counter that sees in-flight calls, and we have no Redis — counting `calls` rows only works if the row exists from accept. A crash mid-call leaves an honest `abandoned` row.
3. **Staff alert email fires only for `booked`/`lead`/`message` outcomes** (the demo emailed every call, including spam). Never-lose-a-call still holds where it matters: for meaningful outcomes, DB write OR email = recorded.
4. **Tenant routing is belt-and-suspenders.** The demo never reads the called number, and the SIP leg Telnyx sends OpenAI has `To = the OpenAI SIP URI` — the dialed number may not survive. Our TeXML route DOES receive the dialed number from Telnyx (`To` request param), so it embeds it into the SIP URI as custom header `X-BIS-Called`; the webhook resolver tries `x-bis-called`, then `to`, then `diversion`. The first real call tells us which path fires; both are built.
5. **Cap-declined calls are silently not accepted** (the demo's behavior), not the spec §7 "polite refusal": speaking a cap message would mean accepting the call (which is where cost starts) or duplicating cap logic into TeXML. Unknown/disabled numbers DO get the spec's polite spoken refusal — the TeXML route looks the number up and answers `<Say>` + `<Hangup/>` (Task 11). Cap-message-on-decline is recorded as a follow-up.

## Global Constraints

- **NEVER touch `C:\Users\danlo\bis-reception-demo`** — the demo repo and BIS's live line stay exactly as they are. Port by re-implementing in this repo; reference the demo read-only.
- **Migrations 0016–0018 are APPLIED TO PROD — never re-apply.** New migration is `0019_voice_core.sql`, additive only, in `packages/db/supabase/migrations/`.
- New tables get RLS (`for all to authenticated using (app.is_agency() or account_id = app.current_account_id()) with check (same)`) and **`grant select` to authenticated ONLY** — every write goes through `serviceDb()` + an app-side agency guard (M4d precedent).
- Staff-facing email: **no `fromAddress`**. Customer-facing email: `fromAddress: account.from_email ?? undefined`, `replyTo: normalizeReplyTo(...)`.
- **Every phone number leaving the app passes `toE164()`**; `null` result = ask again, never send raw.
- Every `Intl.DateTimeFormat` pins locale `"en-US"` AND an explicit `timeZone`.
- New dependencies allowed: `openai@^6.46.0`, `ws@^8.21.0`, dev `@types/ws@^8.18.1`. Nothing else.
- Voice routes export `export const runtime = "nodejs"; export const maxDuration = 300;` — first such routes in this repo; that is expected.
- Tests are colocated (`x.test.ts` beside `x.ts`). `pnpm --filter web test` / `pnpm --filter @bis/db test` / `pnpm check` are the gates.
- ActorId/ActorType for all voice mutations: `"voice"` / `"ai"` (ActorType `"ai"` already exists in `packages/db/src/events.ts:3`).
- UI strings go in `apps/web/src/lib/messages.ts` (flat English `m` object); no string may contain an internal milestone label matching `/\bM\d[a-z]?\b/` (CI-enforced).
- Node >= 22, pnpm. Run db tests from `packages/db`, web tests from `apps/web` or via `pnpm --filter`.

---

### Task 1: Migration 0019 — voice tables + `voice` message channel

**Files:**
- Create: `packages/db/supabase/migrations/0019_voice_core.sql`
- Modify: `packages/db/src/messaging.ts:9` (widen `channel` type)
- Modify: `packages/db/src/test/fixtures.ts:23-27` (teardown list)
- Test: `packages/db/src/test/voice-schema.test.ts`

**Interfaces:**
- Produces: tables `phone_numbers`, `voice_profiles`, `calls`; `messages.channel` accepts `'voice'`; `NewMessage.channel: "email" | "form" | "voice"`.

- [ ] **Step 1: Verify the messages channel constraint name against the dev DB**

Run this via the Supabase MCP `execute_sql` (project `tlbkbmlrfafquucsmsmm`) or psql:

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.messages'::regclass and contype = 'c';
```

Expected: one row whose definition contains `channel`. Note its `conname` (likely `messages_channel_check`). If the name differs, use the real name in Step 3's `drop constraint`.

- [ ] **Step 2: Write the failing schema test**

```ts
// packages/db/src/test/voice-schema.test.ts
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";

describe("0019 voice schema", () => {
  it("phone_numbers accepts a valid row and rejects a bad e164", async () => {
    await withTestAccount(async (db, accountId) => {
      const ok = await db.from("phone_numbers")
        .insert({ account_id: accountId, e164: "+19565550111" }).select("id, status").single();
      expect(ok.error).toBeNull();
      expect(ok.data!.status).toBe("provisioned");
      const bad = await db.from("phone_numbers")
        .insert({ account_id: accountId, e164: "956-555-0111" }).select("id");
      expect(bad.error).not.toBeNull();
    });
  });

  it("voice_profiles is one-per-account with the documented defaults", async () => {
    await withTestAccount(async (db, accountId) => {
      const first = await db.from("voice_profiles")
        .insert({ account_id: accountId }).select("persona_name, languages, booking_enabled, enabled").single();
      expect(first.error).toBeNull();
      expect(first.data).toEqual({
        persona_name: "Sofía", languages: "both", booking_enabled: true, enabled: false,
      });
      const dupe = await db.from("voice_profiles").insert({ account_id: accountId }).select("id");
      expect(dupe.error).not.toBeNull(); // unique(account_id)
    });
  });

  it("calls row lifecycle: insert minimal at accept, update at finish", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await db.from("phone_numbers")
        .insert({ account_id: accountId, e164: "+19565550112" }).select("id").single();
      const call = await db.from("calls")
        .insert({ account_id: accountId, phone_number_id: num.data!.id, caller_e164: "+19562921696" })
        .select("id, outcome, transcript").single();
      expect(call.error).toBeNull();
      expect(call.data!.outcome).toBe("abandoned");
      const upd = await db.from("calls")
        .update({ outcome: "lead", ended_at: new Date().toISOString(), duration_secs: 61, turn_count: 8, summary: "s" })
        .eq("id", call.data!.id).select("outcome").single();
      expect(upd.error).toBeNull();
      expect(upd.data!.outcome).toBe("lead");
    });
  });

  it("messages accepts channel 'voice'", async () => {
    await withTestAccount(async (db, accountId) => {
      const { createContact } = await import("../contacts");
      const { ensureConversation, createMessage } = await import("../messaging");
      const c = await createContact(db, accountId, { firstName: "V", phone: "+19565550113" }, "voice", "ai");
      const convo = await ensureConversation(db, accountId, c.id, "voice", "ai");
      await expect(createMessage(db, accountId, {
        conversationId: convo.id, channel: "voice", direction: "inbound", subject: "Phone call", body: "hi",
      }, "voice", "ai")).resolves.toHaveProperty("id");
    });
  });
});
```

- [ ] **Step 3: Run it — expect FAIL (tables missing / constraint rejects 'voice')**

Run: `cd packages/db && npx vitest run src/test/voice-schema.test.ts`
Expected: failures like `relation "public.phone_numbers" does not exist` and a check-constraint violation on `channel`.

- [ ] **Step 4: Write the migration**

```sql
-- packages/db/supabase/migrations/0019_voice_core.sql
-- Voice Receptionist Core: tenant-routed phone numbers, per-account voice
-- profiles, durable call records. Additive only. Writes go through
-- serviceDb(); authenticated gets SELECT only (0018 lesson: grants are
-- per-column/per-verb and invisible to the service-role test suite).

create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  e164 text not null unique check (e164 ~ '^\+[0-9]{8,15}$'),
  telnyx_id text,
  status text not null default 'provisioned'
    check (status in ('provisioned','testing','live','released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.phone_numbers enable row level security;
create policy phone_numbers_tenant on public.phone_numbers for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());
grant select on public.phone_numbers to authenticated;

create table public.voice_profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.accounts(id) on delete restrict,
  persona_name text not null default 'Sofía',
  greeting_en text not null default '',
  greeting_es text not null default '',
  facts text not null default '',
  services text not null default '',
  languages text not null default 'both' check (languages in ('en','es','both')),
  booking_enabled boolean not null default true,
  after_hours text not null default 'hours_then_message'
    check (after_hours in ('hours_then_message','message_only')),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.voice_profiles enable row level security;
create policy voice_profiles_tenant on public.voice_profiles for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());
grant select on public.voice_profiles to authenticated;

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  phone_number_id uuid not null references public.phone_numbers(id) on delete restrict,
  contact_id uuid references public.contacts(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  caller_e164 text,
  language text not null default 'en' check (language in ('en','es')),
  outcome text not null default 'abandoned'
    check (outcome in ('booked','lead','message','abandoned','spam')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_secs integer,
  turn_count integer not null default 0,
  transcript jsonb not null default '[]'::jsonb,
  summary text not null default '',
  created_at timestamptz not null default now()
);
create index calls_account_started_idx on public.calls (account_id, started_at desc);
create index calls_caller_idx on public.calls (account_id, caller_e164, started_at desc);
alter table public.calls enable row level security;
create policy calls_tenant on public.calls for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());
grant select on public.calls to authenticated;

-- The voice channel. Constraint name verified in Step 1 — adjust if it differed.
alter table public.messages drop constraint if exists messages_channel_check;
alter table public.messages add constraint messages_channel_check
  check (channel in ('email','form','voice'));
```

- [ ] **Step 5: Apply the migration to the shared Supabase project**

Apply via Supabase MCP `apply_migration` (project `tlbkbmlrfafquucsmsmm`, name `0019_voice_core`) with the file's exact content. ⚠️ This project serves production — the migration is additive-only by design. Apply ONCE.

- [ ] **Step 6: Widen the TS channel type**

In `packages/db/src/messaging.ts`, change line 9:

```ts
  channel: "email" | "form" | "voice";
```

- [ ] **Step 7: Add the new tables to the fixture teardown**

In `packages/db/src/test/fixtures.ts`, the teardown table list must delete `"calls"` FIRST (it FKs bookings/contacts/conversations with `set null`, and phone_numbers with restrict), and `"voice_profiles"`, `"phone_numbers"` after `"contacts"` (before the `blueprints`/`accounts` cleanup):

```ts
    for (const table of ["calls", "bookings", "calendars", "events", "form_submissions", "forms",
                         "messages", "conversations",
                         "checklist_items", "contact_tags", "notes", "tasks",
                         "opportunities", "pipeline_stages", "pipelines", "custom_fields",
                         "custom_values", "tags", "contacts",
                         "voice_profiles", "phone_numbers"]) {
```

- [ ] **Step 8: Also add the three tables to the e2e sweep**

Open `apps/web/e2e` and find `sweep.ts` (`deleteAccountCascade`). Add `"calls"` before its bookings delete and `"voice_profiles"`, `"phone_numbers"` before its accounts delete, in the same style the file already uses. (Booking's ledger records this file already misses bookings/calendars — if that is still true, fix the ordering for those too while here and note it in the ledger.)

- [ ] **Step 9: Run the schema test — expect PASS**

Run: `cd packages/db && npx vitest run src/test/voice-schema.test.ts`
Expected: 4 passed.

- [ ] **Step 10: Run the full db suite + typecheck**

Run: `cd packages/db && npx vitest run && npx tsc --noEmit`
Expected: all green (rerun a flaked file alone before investigating — known shared-DB contention).

- [ ] **Step 11: Commit**

```bash
git add packages/db/supabase/migrations/0019_voice_core.sql packages/db/src/messaging.ts packages/db/src/test/fixtures.ts packages/db/src/test/voice-schema.test.ts apps/web/e2e
git commit -m "feat(voice): migration 0019 — phone_numbers, voice_profiles, calls + voice channel"
```

---

### Task 2: `@bis/db` voice accessors

**Files:**
- Create: `packages/db/src/voice.ts`
- Modify: `packages/db/src/index.ts` (re-export)
- Test: `packages/db/src/test/voice.test.ts`

**Interfaces:**
- Consumes: `emit`/`ActorType` (`events.ts`), `SupabaseClient`.
- Produces (exact, later tasks import these from `@bis/db`):

```ts
export type PhoneNumberStatus = "provisioned" | "testing" | "live" | "released";
export type PhoneNumberRow = {
  id: string; account_id: string; e164: string;
  telnyx_id: string | null; status: PhoneNumberStatus;
};
export type VoiceProfileRow = {
  id: string; account_id: string; persona_name: string;
  greeting_en: string; greeting_es: string; facts: string; services: string;
  languages: "en" | "es" | "both"; booking_enabled: boolean;
  after_hours: "hours_then_message" | "message_only"; enabled: boolean;
};
export type VoiceProfilePatch = Partial<Omit<VoiceProfileRow, "id" | "account_id">>;
export type CallOutcome = "booked" | "lead" | "message" | "abandoned" | "spam";
export type TranscriptEvent = { role: "caller" | "assistant"; text: string; at: string };
export type FinishCallPatch = {
  outcome: CallOutcome; endedAt: Date; durationSecs: number; turnCount: number;
  transcript: TranscriptEvent[]; summary: string; language: "en" | "es";
  contactId?: string; conversationId?: string; bookingId?: string;
};

export async function getPhoneNumberByE164(db: SupabaseClient, e164: string): Promise<PhoneNumberRow | null>;
export async function assignPhoneNumber(db: SupabaseClient, accountId: string,
  input: { e164: string; telnyxId?: string; status?: PhoneNumberStatus },
  actorId: string, actorType?: ActorType): Promise<PhoneNumberRow>;   // emits phone_number.assigned
export async function setPhoneNumberStatus(db: SupabaseClient, accountId: string,
  phoneNumberId: string, status: PhoneNumberStatus, actorId: string): Promise<void>; // emits phone_number.status_changed; throws on 0 rows
export async function getVoiceProfile(db: SupabaseClient, accountId: string): Promise<VoiceProfileRow | null>;
export async function upsertVoiceProfile(db: SupabaseClient, accountId: string,
  patch: VoiceProfilePatch, actorId: string): Promise<VoiceProfileRow>; // insert-or-update on account_id; emits voice_profile.updated
export async function startCallRow(db: SupabaseClient, accountId: string,
  input: { phoneNumberId: string; callerE164: string | null }): Promise<{ id: string }>;
export async function finishCallRow(db: SupabaseClient, accountId: string,
  callId: string, patch: FinishCallPatch): Promise<void>; // throws on 0 rows (select("id") guard — the M3 setBranding lesson)
export async function countCallsSince(db: SupabaseClient, accountId: string, sinceIso: string): Promise<number>;
export async function countCallsByCallerSince(db: SupabaseClient, accountId: string,
  callerE164: string, sinceIso: string): Promise<number>;
export async function findUpcomingBookingForPhone(db: SupabaseClient, accountId: string,
  phoneE164: string, nowIso: string): Promise<{ bookingId: string; startsAt: string } | null>;
export async function getBookingById(db: SupabaseClient, accountId: string,
  bookingId: string): Promise<{ id: string; contact_id: string; calendar_id: string; starts_at: string; ends_at: string; status: string } | null>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/src/test/voice.test.ts
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { getOrCreateCalendar, createBooking } from "../booking";
import {
  assignPhoneNumber, getPhoneNumberByE164, setPhoneNumberStatus,
  getVoiceProfile, upsertVoiceProfile,
  startCallRow, finishCallRow, countCallsSince, countCallsByCallerSince,
  findUpcomingBookingForPhone, getBookingById,
} from "../voice";

describe("voice accessors", () => {
  it("phone number assign → lookup → status walk", async () => {
    await withTestAccount(async (db, accountId) => {
      const row = await assignPhoneNumber(db, accountId, { e164: "+19565550120" }, "user_test");
      expect(row.status).toBe("provisioned");
      expect(await getPhoneNumberByE164(db, "+19565550120")).toMatchObject({ account_id: accountId });
      expect(await getPhoneNumberByE164(db, "+19999999999")).toBeNull();
      await setPhoneNumberStatus(db, accountId, row.id, "live", "user_test");
      expect((await getPhoneNumberByE164(db, "+19565550120"))!.status).toBe("live");
      // wrong account must throw, not silently no-op
      await expect(setPhoneNumberStatus(db, "00000000-0000-0000-0000-000000000000", row.id, "released", "user_test"))
        .rejects.toThrow();
    });
  });

  it("voice profile upsert is insert-then-update on one row", async () => {
    await withTestAccount(async (db, accountId) => {
      expect(await getVoiceProfile(db, accountId)).toBeNull();
      const created = await upsertVoiceProfile(db, accountId, { greeting_en: "Hi!", enabled: true }, "user_test");
      expect(created.greeting_en).toBe("Hi!");
      const updated = await upsertVoiceProfile(db, accountId, { persona_name: "Ana" }, "user_test");
      expect(updated.persona_name).toBe("Ana");
      expect(updated.greeting_en).toBe("Hi!");      // patch semantics, not replace
      expect(updated.id).toBe(created.id);          // same row
    });
  });

  it("call rows: start → finish; finish on a wrong id throws", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: "+19565550121" }, "user_test");
      const { id } = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: "+19562921696" });
      await finishCallRow(db, accountId, id, {
        outcome: "message", endedAt: new Date(), durationSecs: 45, turnCount: 6,
        transcript: [{ role: "caller", text: "hola", at: new Date().toISOString() }],
        summary: "RECORDED — Messages: 1.", language: "es",
      });
      await expect(finishCallRow(db, accountId, "00000000-0000-0000-0000-000000000000", {
        outcome: "spam", endedAt: new Date(), durationSecs: 0, turnCount: 0,
        transcript: [], summary: "", language: "en",
      })).rejects.toThrow();
    });
  });

  it("cap counters count in-flight (unfinished) calls too", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: "+19565550122" }, "user_test");
      const since = new Date(Date.now() - 60_000).toISOString();
      await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: "+19565550001" });
      await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: "+19565550001" });
      await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: "+19565550002" });
      expect(await countCallsSince(db, accountId, since)).toBe(3);
      expect(await countCallsByCallerSince(db, accountId, "+19565550001", since)).toBe(2);
    });
  });

  it("findUpcomingBookingForPhone: matches contact phone, skips past and cancelled", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Maria", phone: "+19565550130" }, "user_test");
      const now = new Date("2027-05-01T12:00:00Z");
      await createBooking(db, accountId, { calendarId: cal.id, contactId,
        startsAt: new Date("2027-04-30T15:00:00Z"), endsAt: new Date("2027-04-30T16:00:00Z") }, "user_test"); // past
      const future = await createBooking(db, accountId, { calendarId: cal.id, contactId,
        startsAt: new Date("2027-05-03T15:00:00Z"), endsAt: new Date("2027-05-03T16:00:00Z") }, "user_test");
      const hit = await findUpcomingBookingForPhone(db, accountId, "+19565550130", now.toISOString());
      expect(hit).toMatchObject({ bookingId: future.id });
      expect(await findUpcomingBookingForPhone(db, accountId, "+19999999998", now.toISOString())).toBeNull();
      const row = await getBookingById(db, accountId, future.id);
      expect(row).toMatchObject({ contact_id: contactId, status: "booked" });
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `cd packages/db && npx vitest run src/test/voice.test.ts`
Expected: `Cannot find module '../voice'` (or unresolved imports).

- [ ] **Step 3: Implement `packages/db/src/voice.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";

export type PhoneNumberStatus = "provisioned" | "testing" | "live" | "released";
export type PhoneNumberRow = {
  id: string; account_id: string; e164: string;
  telnyx_id: string | null; status: PhoneNumberStatus;
};
export type VoiceProfileRow = {
  id: string; account_id: string; persona_name: string;
  greeting_en: string; greeting_es: string; facts: string; services: string;
  languages: "en" | "es" | "both"; booking_enabled: boolean;
  after_hours: "hours_then_message" | "message_only"; enabled: boolean;
};
export type VoiceProfilePatch = Partial<Omit<VoiceProfileRow, "id" | "account_id">>;
export type CallOutcome = "booked" | "lead" | "message" | "abandoned" | "spam";
export type TranscriptEvent = { role: "caller" | "assistant"; text: string; at: string };
export type FinishCallPatch = {
  outcome: CallOutcome; endedAt: Date; durationSecs: number; turnCount: number;
  transcript: TranscriptEvent[]; summary: string; language: "en" | "es";
  contactId?: string; conversationId?: string; bookingId?: string;
};

const PHONE_COLS = "id, account_id, e164, telnyx_id, status";
const PROFILE_COLS =
  "id, account_id, persona_name, greeting_en, greeting_es, facts, services, " +
  "languages, booking_enabled, after_hours, enabled";

export async function getPhoneNumberByE164(
  db: SupabaseClient, e164: string,
): Promise<PhoneNumberRow | null> {
  const { data, error } = await db.from("phone_numbers")
    .select(PHONE_COLS).eq("e164", e164).maybeSingle();
  if (error) throw new Error(`getPhoneNumberByE164 failed: ${error.message}`);
  return (data as PhoneNumberRow | null) ?? null;
}

export async function assignPhoneNumber(
  db: SupabaseClient, accountId: string,
  input: { e164: string; telnyxId?: string; status?: PhoneNumberStatus },
  actorId: string, actorType: ActorType = "user",
): Promise<PhoneNumberRow> {
  const { data, error } = await db.from("phone_numbers")
    .insert({
      account_id: accountId, e164: input.e164,
      telnyx_id: input.telnyxId ?? null, status: input.status ?? "provisioned",
    })
    .select(PHONE_COLS).single();
  if (error || !data) throw new Error(`assignPhoneNumber failed: ${error?.message}`);
  await emit(db, accountId, "phone_number.assigned", actorId,
    { phoneNumberId: (data as PhoneNumberRow).id, e164: input.e164 }, actorType);
  return data as PhoneNumberRow;
}

export async function setPhoneNumberStatus(
  db: SupabaseClient, accountId: string, phoneNumberId: string,
  status: PhoneNumberStatus, actorId: string,
): Promise<void> {
  const { data, error } = await db.from("phone_numbers")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", phoneNumberId).eq("account_id", accountId).select("id");
  if (error) throw new Error(`setPhoneNumberStatus failed: ${error.message}`);
  // PostgREST returns no error AND no rows for an update matching nothing —
  // the setBranding lesson. A wrong id/account must be loud.
  if (!data || data.length === 0) throw new Error("setPhoneNumberStatus matched no row");
  await emit(db, accountId, "phone_number.status_changed", actorId, { phoneNumberId, status });
}

export async function getVoiceProfile(
  db: SupabaseClient, accountId: string,
): Promise<VoiceProfileRow | null> {
  const { data, error } = await db.from("voice_profiles")
    .select(PROFILE_COLS).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`getVoiceProfile failed: ${error.message}`);
  return (data as VoiceProfileRow | null) ?? null;
}

export async function upsertVoiceProfile(
  db: SupabaseClient, accountId: string, patch: VoiceProfilePatch, actorId: string,
): Promise<VoiceProfileRow> {
  const existing = await getVoiceProfile(db, accountId);
  if (!existing) {
    const { data, error } = await db.from("voice_profiles")
      .insert({ account_id: accountId, ...patch })
      .select(PROFILE_COLS).single();
    if (error || !data) throw new Error(`upsertVoiceProfile insert failed: ${error?.message}`);
    await emit(db, accountId, "voice_profile.updated", actorId, { fields: Object.keys(patch) });
    return data as VoiceProfileRow;
  }
  const { data, error } = await db.from("voice_profiles")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).select(PROFILE_COLS).single();
  if (error || !data) throw new Error(`upsertVoiceProfile update failed: ${error?.message}`);
  await emit(db, accountId, "voice_profile.updated", actorId, { fields: Object.keys(patch) });
  return data as VoiceProfileRow;
}

export async function startCallRow(
  db: SupabaseClient, accountId: string,
  input: { phoneNumberId: string; callerE164: string | null },
): Promise<{ id: string }> {
  const { data, error } = await db.from("calls")
    .insert({ account_id: accountId, phone_number_id: input.phoneNumberId, caller_e164: input.callerE164 })
    .select("id").single();
  if (error || !data) throw new Error(`startCallRow failed: ${error?.message}`);
  return { id: (data as { id: string }).id };
}

export async function finishCallRow(
  db: SupabaseClient, accountId: string, callId: string, patch: FinishCallPatch,
): Promise<void> {
  const { data, error } = await db.from("calls")
    .update({
      outcome: patch.outcome, ended_at: patch.endedAt.toISOString(),
      duration_secs: patch.durationSecs, turn_count: patch.turnCount,
      transcript: patch.transcript, summary: patch.summary, language: patch.language,
      contact_id: patch.contactId ?? null, conversation_id: patch.conversationId ?? null,
      booking_id: patch.bookingId ?? null,
    })
    .eq("id", callId).eq("account_id", accountId).select("id");
  if (error) throw new Error(`finishCallRow failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error("finishCallRow matched no row");
}

export async function countCallsSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("calls")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).gte("started_at", sinceIso);
  if (error) throw new Error(`countCallsSince failed: ${error.message}`);
  return count ?? 0;
}

export async function countCallsByCallerSince(
  db: SupabaseClient, accountId: string, callerE164: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("calls")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("caller_e164", callerE164).gte("started_at", sinceIso);
  if (error) throw new Error(`countCallsByCallerSince failed: ${error.message}`);
  return count ?? 0;
}

export async function findUpcomingBookingForPhone(
  db: SupabaseClient, accountId: string, phoneE164: string, nowIso: string,
): Promise<{ bookingId: string; startsAt: string } | null> {
  const { data: contacts, error: cErr } = await db.from("contacts")
    .select("id").eq("account_id", accountId).eq("phone", phoneE164);
  if (cErr) throw new Error(`findUpcomingBookingForPhone contacts failed: ${cErr.message}`);
  const ids = (contacts ?? []).map((c: { id: string }) => c.id);
  if (ids.length === 0) return null;
  const { data, error } = await db.from("bookings")
    .select("id, starts_at").eq("account_id", accountId)
    .in("contact_id", ids).eq("status", "booked").gt("starts_at", nowIso)
    .order("starts_at", { ascending: true }).limit(1);
  if (error) throw new Error(`findUpcomingBookingForPhone bookings failed: ${error.message}`);
  const row = (data ?? [])[0] as { id: string; starts_at: string } | undefined;
  return row ? { bookingId: row.id, startsAt: row.starts_at } : null;
}

export async function getBookingById(
  db: SupabaseClient, accountId: string, bookingId: string,
): Promise<{ id: string; contact_id: string; calendar_id: string; starts_at: string; ends_at: string; status: string } | null> {
  const { data, error } = await db.from("bookings")
    .select("id, contact_id, calendar_id, starts_at, ends_at, status")
    .eq("id", bookingId).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`getBookingById failed: ${error.message}`);
  return (data as any) ?? null;
}
```

- [ ] **Step 4: Re-export from the barrel**

In `packages/db/src/index.ts`, add alongside the existing exports:

```ts
export * from "./voice";
```

- [ ] **Step 5: Run — expect PASS**

Run: `cd packages/db && npx vitest run src/test/voice.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Full db suite + typecheck, then commit**

Run: `cd packages/db && npx vitest run && npx tsc --noEmit`

```bash
git add packages/db/src/voice.ts packages/db/src/index.ts packages/db/src/test/voice.test.ts
git commit -m "feat(voice): @bis/db accessors — numbers, profiles, calls, phone→booking lookup"
```

---

### Task 3: Pure voice modules — E.164, SIP headers, turn detection, call state

**Files:**
- Create: `apps/web/src/lib/voice/phone-number.ts`
- Create: `apps/web/src/lib/voice/sip-headers.ts`
- Create: `apps/web/src/lib/voice/turn-detection.ts`
- Create: `apps/web/src/lib/voice/call-state.ts`
- Test: one `.test.ts` beside each

**Interfaces:**
- Produces:
  - `toE164(raw: string | null | undefined): string | null`
  - `extractCallerNumber(eventData: unknown): string | null`
  - `extractCalledNumber(eventData: unknown): string | null` — tries header names `x-bis-called`, `to`, `diversion` in that order
  - `sipHeaderNames(eventData: unknown): string[]` — names only, NEVER values (PII)
  - `readTurnDetection(env?: NodeJS.ProcessEnv): TurnDetection`
  - `CallState`, `emptyCallState(): CallState`, `classifyOutcome(state: CallState): CallOutcome`, plus mirror helpers `withBooking`, `withBookingCancelled`, `withLead`, `withMessage`, `withTranscript`

- [ ] **Step 1: Write the failing tests** (port the demo's proven cases — reference read-only: `bis-reception-demo/src/lib/phone/*.test.ts`)

```ts
// apps/web/src/lib/voice/phone-number.test.ts
import { describe, it, expect } from "vitest";
import { toE164 } from "./phone-number";

describe("toE164", () => {
  it.each([
    ["9562921696", "+19562921696"],
    ["(956) 292-1696", "+19562921696"],
    ["19562921696", "+19562921696"],
    ["+19562921696", "+19562921696"],
    ["525512345678", "+525512345678"],
  ])("%s → %s", (raw, want) => expect(toE164(raw)).toBe(want));
  it.each([["", null], ["12345", null], [null, null], [undefined, null],
    ["12345678901234567890", null]])("invalid %s → null", (raw, want) =>
    expect(toE164(raw as any)).toBe(want));
});
```

```ts
// apps/web/src/lib/voice/sip-headers.test.ts
import { describe, it, expect } from "vitest";
import { extractCallerNumber, extractCalledNumber, sipHeaderNames } from "./sip-headers";

const ev = (headers: { name: string; value: string }[]) => ({ call_id: "c1", sip_headers: headers });

describe("extractCallerNumber", () => {
  it("parses tel:, sip:, display names, bare 10/11 digits", () => {
    expect(extractCallerNumber(ev([{ name: "From", value: "<tel:+19565550100>" }]))).toBe("+19565550100");
    expect(extractCallerNumber(ev([{ name: "From", value: '"Ana Ruiz" <sip:+19565550100@c.example>;tag=x' }]))).toBe("+19565550100");
    expect(extractCallerNumber(ev([{ name: "from", value: "<sip:9565550100@x>" }]))).toBe("+19565550100");
    expect(extractCallerNumber(ev([{ name: "From", value: "<sip:19565550100@x>" }]))).toBe("+19565550100");
  });
  it("anonymous and malformed → null", () => {
    expect(extractCallerNumber(ev([{ name: "From", value: '"Anonymous" <sip:anonymous@anonymous.invalid>' }]))).toBeNull();
    for (const bad of [null, undefined, {}, { sip_headers: "nope" }, { sip_headers: [] }, 42, { sip_headers: [null] }]) {
      expect(extractCallerNumber(bad)).toBeNull();
    }
  });
});

describe("extractCalledNumber", () => {
  it("prefers X-BIS-Called over To over Diversion", () => {
    expect(extractCalledNumber(ev([
      { name: "To", value: "<sip:proj_abc@sip.api.openai.com>" },
      { name: "X-BIS-Called", value: "+19565550999" },
    ]))).toBe("+19565550999");
    expect(extractCalledNumber(ev([{ name: "To", value: "<sip:+19565550888@x>" }]))).toBe("+19565550888");
    expect(extractCalledNumber(ev([{ name: "Diversion", value: "<sip:9565550777@x>;reason=deflection" }]))).toBe("+19565550777");
  });
  it("a To that is only the OpenAI SIP URI (no number) → null", () => {
    expect(extractCalledNumber(ev([{ name: "To", value: "<sip:proj_abc@sip.api.openai.com;transport=tls>" }]))).toBeNull();
  });
});

describe("sipHeaderNames", () => {
  it("returns names only", () => {
    expect(sipHeaderNames(ev([{ name: "From", value: "SECRET" }, { name: "To", value: "SECRET" }])))
      .toEqual(["From", "To"]);
    expect(sipHeaderNames({})).toEqual([]);
  });
});
```

```ts
// apps/web/src/lib/voice/turn-detection.test.ts
import { describe, it, expect } from "vitest";
import { readTurnDetection } from "./turn-detection";

describe("readTurnDetection", () => {
  it("defaults to semantic_vad at medium", () => {
    expect(readTurnDetection({} as any)).toEqual({
      type: "semantic_vad", eagerness: "medium", create_response: true, interrupt_response: true,
    });
  });
  it("PHONE_TURN_DETECTION=server yields clamped server_vad", () => {
    expect(readTurnDetection({
      PHONE_TURN_DETECTION: "server", PHONE_VAD_SILENCE_MS: "100", PHONE_VAD_THRESHOLD: "9",
    } as any)).toEqual({
      type: "server_vad", threshold: 1, prefix_padding_ms: 300, silence_duration_ms: 200,
      create_response: true, interrupt_response: true,
    });
  });
  it("junk eagerness falls back to medium", () => {
    expect(readTurnDetection({ PHONE_VAD_EAGERNESS: "warp" } as any))
      .toMatchObject({ type: "semantic_vad", eagerness: "medium" });
  });
});
```

```ts
// apps/web/src/lib/voice/call-state.test.ts
import { describe, it, expect } from "vitest";
import {
  emptyCallState, classifyOutcome, withBooking, withBookingCancelled,
  withLead, withMessage, withTranscript,
} from "./call-state";

describe("classifyOutcome priority", () => {
  it("booked > lead > message > abandoned > spam", () => {
    let s = emptyCallState();
    expect(classifyOutcome(s)).toBe("spam");
    s = withTranscript(s, { role: "caller", text: "hello?", at: "t" });
    expect(classifyOutcome(s)).toBe("abandoned");
    s = withMessage(s, { body: "call me", at: "t" });
    expect(classifyOutcome(s)).toBe("message");
    s = withLead(s, { fields: { fullName: "Ana" } });
    expect(classifyOutcome(s)).toBe("lead");
    s = withBooking(s, { id: "b1", contactName: "Ana", startsAt: "2027-01-01T15:00:00Z", endsAt: "2027-01-01T16:00:00Z" });
    expect(classifyOutcome(s)).toBe("booked");
    expect(classifyOutcome(withBookingCancelled(s, "b1"))).toBe("lead"); // cancelled booking no longer counts
  });
  it("assistant-only transcript is still spam (caller never spoke)", () => {
    const s = withTranscript(emptyCallState(), { role: "assistant", text: "Thanks for calling", at: "t" });
    expect(classifyOutcome(s)).toBe("spam");
  });
  it("withBooking replaces a re-used id instead of duplicating", () => {
    let s = withBooking(emptyCallState(), { id: "b1", contactName: "A", startsAt: "x", endsAt: "y" });
    s = withBooking(s, { id: "b1", contactName: "A", startsAt: "z", endsAt: "w" });
    expect(s.bookings).toHaveLength(1);
    expect(s.bookings[0]!.startsAt).toBe("z");
  });
});
```

- [ ] **Step 2: Run — expect FAIL (modules missing)**

Run: `cd apps/web && npx vitest run src/lib/voice`

- [ ] **Step 3: Implement the four modules**

```ts
// apps/web/src/lib/voice/phone-number.ts
// E.164 or nothing. Live-verified 2026-07-26 in the reception demo: external
// APIs reject "9562921696", "(956) 292-1696", "956-292-1696", "19562921696";
// only "+19562921696" passes. Every number leaving this app goes through here.
export function toE164(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}
```

```ts
// apps/web/src/lib/voice/sip-headers.ts
// sip_headers is an ARRAY of {name, value} (openai SDK RealtimeCallIncomingWebhookEvent.Data).
// Values carry caller PII — sipHeaderNames exists so logs can prove shape without leaking.
const NUMBER_RE = /(?:tel:|sip:)\+?([0-9]{7,15})/i;

type Header = { name?: unknown; value?: unknown };

function headers(eventData: unknown): Header[] {
  if (!eventData || typeof eventData !== "object") return [];
  const h = (eventData as { sip_headers?: unknown }).sip_headers;
  return Array.isArray(h) ? (h as Header[]) : [];
}

function numberFromHeader(list: Header[], name: string): string | null {
  const hit = list.find((h) => h && typeof h === "object" && String(h.name).toLowerCase() === name);
  if (!hit || typeof hit.value !== "string") return null;
  // X-BIS-Called carries a bare E.164 we wrote ourselves; SIP URIs need the regex.
  if (name === "x-bis-called") {
    const direct = hit.value.match(/^\+[0-9]{8,15}$/) ? hit.value : null;
    if (direct) return direct;
  }
  const match = hit.value.match(NUMBER_RE);
  if (!match) return null;
  const digits = match[1]!;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function extractCallerNumber(eventData: unknown): string | null {
  return numberFromHeader(headers(eventData), "from");
}

/** The tenant router's input. Order matters: x-bis-called is written by OUR
 *  TeXML route and is authoritative; To/Diversion are carrier-dependent
 *  fallbacks (the To of the leg reaching OpenAI is usually the OpenAI SIP
 *  URI itself, which contains no phone number and correctly yields null). */
export function extractCalledNumber(eventData: unknown): string | null {
  const list = headers(eventData);
  return numberFromHeader(list, "x-bis-called")
    ?? numberFromHeader(list, "to")
    ?? numberFromHeader(list, "diversion");
}

export function sipHeaderNames(eventData: unknown): string[] {
  return headers(eventData)
    .filter((h) => h && typeof h === "object")
    .map((h) => String(h.name));
}
```

```ts
// apps/web/src/lib/voice/turn-detection.ts
// Ported verbatim from the reception demo (its tuning history is the value):
// server_vad@500ms interrupted callers → semantic/low paused too long →
// semantic/medium is the setting danlo judged right on real calls. Env knobs
// exist so the feel costs a redeploy, not a code change.
export type Eagerness = "low" | "medium" | "high" | "auto";

export type TurnDetection =
  | { type: "semantic_vad"; eagerness: Eagerness; create_response: true; interrupt_response: true }
  | {
      type: "server_vad"; threshold: number; prefix_padding_ms: number;
      silence_duration_ms: number; create_response: true; interrupt_response: true;
    };

const EAGERNESS: Eagerness[] = ["low", "medium", "high", "auto"];
const DEFAULTS = { eagerness: "medium" as Eagerness, silenceMs: 800, thresholdRaw: 0.6, prefixPaddingMs: 300 };

function num(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function readTurnDetection(env: NodeJS.ProcessEnv = process.env): TurnDetection {
  const mode = (env.PHONE_TURN_DETECTION ?? "").trim().toLowerCase();
  if (mode === "server") {
    return {
      type: "server_vad",
      threshold: num(env.PHONE_VAD_THRESHOLD, DEFAULTS.thresholdRaw, 0, 1),
      prefix_padding_ms: num(env.PHONE_VAD_PREFIX_PADDING_MS, DEFAULTS.prefixPaddingMs, 0, 2000),
      silence_duration_ms: num(env.PHONE_VAD_SILENCE_MS, DEFAULTS.silenceMs, 200, 4000),
      create_response: true, interrupt_response: true,
    };
  }
  const raw = (env.PHONE_VAD_EAGERNESS ?? "").trim().toLowerCase() as Eagerness;
  return {
    type: "semantic_vad",
    eagerness: EAGERNESS.includes(raw) ? raw : DEFAULTS.eagerness,
    create_response: true, interrupt_response: true,
  };
}
```

```ts
// apps/web/src/lib/voice/call-state.ts
// Per-call state lives in ONE invocation and dies with it — no store, no
// migrations. The mirroring rule is the demo's BUG-5 lesson: any tool that
// changes external state must reflect it here, or classification and the
// recorded row silently lie.
import type { CallOutcome, TranscriptEvent } from "@bis/db";

export type MirroredBooking = {
  id: string; contactName: string; startsAt: string; endsAt: string;
  status?: "booked" | "cancelled";
};
export type CapturedLead = { fields: Record<string, string> };
export type TakenMessage = { body: string; callbackNumber?: string; at: string };

export interface CallState {
  contactId: string | null;
  bookings: (MirroredBooking & { status: "booked" | "cancelled" })[];
  leads: CapturedLead[];
  messages: TakenMessage[];
  transcript: TranscriptEvent[];
  summary?: string;
}

export function emptyCallState(): CallState {
  return { contactId: null, bookings: [], leads: [], messages: [], transcript: [] };
}

export function classifyOutcome(state: CallState): CallOutcome {
  if (state.bookings.some((b) => b.status === "booked")) return "booked";
  if (state.leads.length > 0) return "lead";
  if (state.messages.length > 0) return "message";
  if (state.transcript.some((t) => t.role === "caller" && t.text.trim())) return "abandoned";
  return "spam";
}

export function withBooking(state: CallState, b: MirroredBooking): CallState {
  const booking = { ...b, status: "booked" as const };
  return { ...state, bookings: [...state.bookings.filter((x) => x.id !== b.id), booking] };
}

export function withBookingCancelled(state: CallState, bookingId: string): CallState {
  return {
    ...state,
    bookings: state.bookings.map((b) => (b.id === bookingId ? { ...b, status: "cancelled" as const } : b)),
  };
}

export function withLead(state: CallState, lead: CapturedLead): CallState {
  return { ...state, leads: [...state.leads, lead] };
}

export function withMessage(state: CallState, msg: TakenMessage): CallState {
  return { ...state, messages: [...state.messages, msg] };
}

export function withTranscript(state: CallState, ev: TranscriptEvent): CallState {
  return { ...state, transcript: [...state.transcript, ev] };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd apps/web && npx vitest run src/lib/voice`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/voice
git commit -m "feat(voice): pure modules — E.164, SIP header routing, turn detection, call state"
```

---

### Task 4: System prompt + realtime session config

**Files:**
- Create: `apps/web/src/lib/voice/system-prompt.ts`
- Create: `apps/web/src/lib/voice/session-config.ts`
- Test: `apps/web/src/lib/voice/system-prompt.test.ts`, `apps/web/src/lib/voice/session-config.test.ts`

**Interfaces:**
- Consumes: `readTurnDetection` (Task 3), `toolSchemas(bookingEnabled: boolean)` (Task 6 — for THIS task, define the import and a placeholder is NOT allowed: session-config imports `toolSchemas` from `./tools/schemas`, which Task 6 creates. To keep tasks independent, THIS task creates `apps/web/src/lib/voice/tools/schemas.ts` with the full schema list (it is pure data), and Task 6 consumes it.)
- Produces:

```ts
export type VoicePromptInput = {
  personaName: string; businessName: string;
  greeting: string;                 // the language-appropriate greeting line
  facts: string; services: string;
  languages: "en" | "es" | "both";
  bookingEnabled: boolean;
  timezone: string;                 // account timezone
  slotDurationMinutes: number;
  afterHours: "hours_then_message" | "message_only";
  callerNumber: string | null;      // so she can confirm "the number you're calling from"
};
export function buildSystemPrompt(input: VoicePromptInput, now: Date): string;
export function buildRealtimeSessionConfig(input: VoicePromptInput, now: Date): object;
export const REALTIME_MODEL: string; // env REALTIME_MODEL || "gpt-realtime"
```

- [ ] **Step 1: Create the tool schemas data file** (pure data, no logic — full content):

```ts
// apps/web/src/lib/voice/tools/schemas.ts
// Flat GA Realtime tool format: type/name/description/parameters at top
// level, no function: wrapper. Ported from the reception demo and re-pointed
// at platform semantics (booking ids, not Cal uids).
const BOOKING_TOOLS = [
  { type: "function", name: "check_availability",
    description: "List open appointment start times for a date.",
    parameters: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD in the business's timezone" } }, required: ["date"] } },
  { type: "function", name: "book_appointment",
    description: "Book an appointment at an available ISO start time. Requires the caller's name and a phone number (their caller ID is used if they don't give one). Email is optional but is where the written confirmation goes.",
    parameters: { type: "object", properties: { startsAt: { type: "string" }, name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, notes: { type: "string" } }, required: ["startsAt", "name"] } },
  { type: "function", name: "reschedule_appointment",
    description: "Move an existing booking to a new ISO start time.",
    parameters: { type: "object", properties: { bookingId: { type: "string" }, startsAt: { type: "string" } }, required: ["bookingId", "startsAt"] } },
  { type: "function", name: "cancel_appointment",
    description: "Cancel an existing booking.",
    parameters: { type: "object", properties: { bookingId: { type: "string" } }, required: ["bookingId"] } },
  { type: "function", name: "find_my_booking",
    description: "Find the caller's upcoming booking using their phone number.",
    parameters: { type: "object", properties: { phone: { type: "string" } }, required: [] } },
] as const;

const CORE_TOOLS = [
  { type: "function", name: "capture_lead",
    description: "Record who the caller is and what they need.",
    parameters: { type: "object", properties: { fields: { type: "object", additionalProperties: { type: "string" } } }, required: ["fields"] } },
  { type: "function", name: "take_message",
    description: "Leave a message for a human callback.",
    parameters: { type: "object", properties: { body: { type: "string" }, callbackNumber: { type: "string" } }, required: ["body"] } },
  { type: "function", name: "log_transcript",
    description: "Log a spoken turn for staff review.",
    parameters: { type: "object", properties: { role: { type: "string", enum: ["caller", "assistant"] }, text: { type: "string" } }, required: ["role", "text"] } },
] as const;

export function toolSchemas(bookingEnabled: boolean) {
  return bookingEnabled ? [...BOOKING_TOOLS, ...CORE_TOOLS] : [...CORE_TOOLS];
}
```

- [ ] **Step 2: Write the failing prompt/config tests**

```ts
// apps/web/src/lib/voice/system-prompt.test.ts
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt";

const base = {
  personaName: "Sofía", businessName: "Rio Roofing",
  greeting: "Thanks for calling Rio Roofing. How can I help?",
  facts: "- We repair and replace residential roofs in the RGV.",
  services: "Roof repair, full replacement, inspections",
  languages: "both" as const, bookingEnabled: true,
  timezone: "America/Chicago", slotDurationMinutes: 60,
  afterHours: "hours_then_message" as const, callerNumber: "+19562921696",
};
const now = new Date("2027-06-01T15:00:00Z");

describe("buildSystemPrompt", () => {
  it("carries identity disclosure, business fence, and the hard limits", () => {
    const p = buildSystemPrompt(base, now);
    expect(p).toContain("Never claim to be human");
    expect(p).toContain("Rio Roofing");
    expect(p).toContain(base.facts);
    expect(p).toContain("Never invent facts");
    expect(p).toContain("Never quote a price");
  });
  it("booking disabled removes the booking sections and tool instructions", () => {
    const p = buildSystemPrompt({ ...base, bookingEnabled: false }, now);
    expect(p).not.toContain("book_appointment");
    expect(p).not.toContain("BOOKING");
    expect(p).toContain("take_message");
  });
  it("languages=en drops the bilingual rule; both keeps it", () => {
    expect(buildSystemPrompt({ ...base, languages: "en" }, now)).not.toContain("Spanish");
    expect(buildSystemPrompt(base, now)).toContain("Spanish");
  });
  it("anchors the current date-time in the account timezone with pinned locale", () => {
    const p = buildSystemPrompt(base, now);
    expect(p).toContain("2027"); // rendered date present
    expect(p).toContain("phone number");
  });
  it("uses the persona name the client chose", () => {
    const p = buildSystemPrompt({ ...base, personaName: "Alex" }, now);
    expect(p).toContain("Alex");
    expect(p).not.toContain("Sofía");
  });
});
```

```ts
// apps/web/src/lib/voice/session-config.test.ts
import { describe, it, expect } from "vitest";
import { buildRealtimeSessionConfig } from "./session-config";

const base = {
  personaName: "Sofía", businessName: "Rio Roofing", greeting: "Hi.",
  facts: "-", services: "-", languages: "both" as const, bookingEnabled: true,
  timezone: "America/Chicago", slotDurationMinutes: 60,
  afterHours: "hours_then_message" as const, callerNumber: null,
};

describe("buildRealtimeSessionConfig", () => {
  it("is the FLAT session shape with tools, transcription, VAD and voice", () => {
    const c = buildRealtimeSessionConfig(base, new Date()) as any;
    expect(c.type).toBe("realtime");
    expect(typeof c.model).toBe("string");
    expect(typeof c.instructions).toBe("string");
    expect(Array.isArray(c.tools)).toBe(true);
    expect(c.tools.map((t: any) => t.name)).toContain("book_appointment");
    expect(c.audio.input.transcription).toEqual({ model: "gpt-4o-mini-transcribe" });
    expect(c.audio.input.noise_reduction).toEqual({ type: "near_field" });
    expect(c.audio.input.turn_detection.type).toBe("semantic_vad");
    expect(c.audio.output.voice).toBe("marin");
    expect(c.session).toBeUndefined(); // FLAT — the accept endpoint rejects nesting
  });
  it("booking disabled drops booking tools from the session", () => {
    const c = buildRealtimeSessionConfig({ ...base, bookingEnabled: false }, new Date()) as any;
    expect(c.tools.map((t: any) => t.name)).not.toContain("book_appointment");
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `cd apps/web && npx vitest run src/lib/voice/system-prompt.test.ts src/lib/voice/session-config.test.ts`

- [ ] **Step 4: Implement the prompt**

```ts
// apps/web/src/lib/voice/system-prompt.ts
// The Sofía prompt, generalized: business is DATA, not code. The rule set is
// the demo's paid-for lessons — disclosure, no-invented-facts, no prices,
// digit-by-digit readback, email-asked-once, take_message as the floor.
// The demo shipped an internal tension (email-first vs phone-first booking);
// resolved here deliberately: PHONE is the required contact (caller ID is a
// strong default), email is asked once because it is where the platform's
// written confirmation and cancel link go. No email = book anyway, say the
// business will confirm by phone.
import type { VoicePromptInput } from "./session-config";

export function buildSystemPrompt(input: VoicePromptInput, now: Date): string {
  const currentDateTime = new Intl.DateTimeFormat("en-US", {
    timeZone: input.timezone, weekday: "long", year: "numeric",
    month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(now);

  const lines: string[] = [
    `You are ${input.personaName}, the phone receptionist for ${input.businessName}.`,
    "",
    `IDENTITY — Do not volunteer that you are automated and do not introduce yourself by name unless asked. Just answer as ${input.businessName} and get straight to what the caller needs. If a caller asks directly whether they are speaking with a person, a human, a bot, a robot, or an AI, answer honestly and briefly that you are an automated assistant, then offer to take a message if they would rather talk to a person. Never claim to be human.`,
    "",
  ];

  if (input.languages === "both") {
    lines.push(
      `LANGUAGE — You are fully bilingual. ALWAYS reply in the same language the caller uses (English or Spanish) and switch fluidly if they switch.`,
      "",
    );
  } else if (input.languages === "es") {
    lines.push(`LANGUAGE — Speak Spanish. If a caller uses English, you may answer in English, but default to Spanish.`, "");
  }

  lines.push(
    `TONE — Warm, brief, and competent. This is a phone call: short sentences, one question at a time, no bulleted lists read aloud. Never read the business facts verbatim; answer conversationally in your own words.`,
    "",
    `The current date and time is ${currentDateTime} (${input.timezone}).`,
    input.callerNumber
      ? `The caller is calling from ${input.callerNumber}. Treat that as their callback number unless they give a different one.`
      : `The caller's number is not visible. Ask for a callback number when you need one.`,
    "",
    `WHAT YOU KNOW ABOUT ${input.businessName.toUpperCase()} (answer from this and nothing else):`,
    input.facts,
    input.services ? `Services: ${input.services}` : "",
    "",
    "HARD LIMITS:",
    `- Never invent facts about ${input.businessName} — no capabilities, client names, statistics, or timelines that are not stated above.`,
    `- Never quote a price, rate, or estimate unless one is stated above. If asked, say the business will confirm pricing and offer to take their details.`,
    "- If you do not know something, say so and take a message rather than guessing.",
    "- Never give legal, medical, or compliance advice.",
    "",
    "TOOLS — you MUST use tools for anything that reads or changes real state. Never claim something is recorded or booked without a successful tool result:",
    "- capture_lead(fields) — record who the caller is and what they need. Required fields: fullName, need. Also capture when offered: email, businessName.",
    "- take_message(body, callbackNumber) — when you cannot help, when a human must call back, or when a request cannot be completed.",
    "- log_transcript is called automatically; never mention it.",
  );

  if (input.bookingEnabled) {
    lines.push(
      "- check_availability(date) — list open times for a date before offering any.",
      "- book_appointment(startsAt, name, email, phone, notes) — book only a time check_availability returned.",
      "- find_my_booking(phone) — when a caller wants to change or cancel an existing appointment, call this FIRST with the number they are calling from.",
      "- reschedule_appointment(bookingId, startsAt) / cancel_appointment(bookingId) — only after find_my_booking found it.",
      "",
      `BOOKING — Appointments are ${input.slotDurationMinutes} minutes. To book you need the caller's NAME and PHONE NUMBER; their email is optional but worth asking for once, because it is where the written confirmation and the cancellation link go.`,
      "- If they are calling from their own phone, confirm you should use the number they are calling from; otherwise take the number and READ IT BACK DIGIT BY DIGIT and wait for them to confirm before you book.",
      "- Ask once if they would like an email confirmation. If they give an address, READ IT BACK character by character and confirm it. If they decline, cannot spell it clearly, or you get it wrong twice, book with the phone number alone and say the business will confirm by phone. Never guess an email address.",
      "- Only if you cannot get a phone number either: stop trying to book, use take_message instead.",
      "- If no suitable time exists, offer another day or take a message. Confirm the details back to the caller before you book.",
    );
  } else {
    lines.push(
      "",
      "This business does not take bookings by phone. If a caller asks to schedule something, take a message with their details and say someone will call them back to arrange it.",
    );
  }

  if (input.afterHours === "message_only") {
    lines.push(
      "",
      "AFTER HOURS — If the business is closed right now, say so briefly and take a message; do not attempt anything else.",
    );
  }

  return lines.filter((l) => l !== null && l !== undefined).join("\n");
}
```

- [ ] **Step 5: Implement the session config**

```ts
// apps/web/src/lib/voice/session-config.ts
// The ONE session shape, used FLAT (not nested under `session`) by the SIP
// accept endpoint — nesting it is the documented way to get a silent 4xx.
import { readTurnDetection } from "./turn-detection";
import { toolSchemas } from "./tools/schemas";
import { buildSystemPrompt } from "./system-prompt";

export const REALTIME_MODEL = process.env.REALTIME_MODEL || "gpt-realtime";

export type VoicePromptInput = {
  personaName: string; businessName: string; greeting: string;
  facts: string; services: string;
  languages: "en" | "es" | "both";
  bookingEnabled: boolean;
  timezone: string; slotDurationMinutes: number;
  afterHours: "hours_then_message" | "message_only";
  callerNumber: string | null;
};

export function buildRealtimeSessionConfig(input: VoicePromptInput, now: Date) {
  return {
    type: "realtime",
    model: REALTIME_MODEL,
    instructions: buildSystemPrompt(input, now),
    tools: toolSchemas(input.bookingEnabled),
    audio: {
      input: {
        transcription: { model: "gpt-4o-mini-transcribe" },
        noise_reduction: { type: "near_field" },
        turn_detection: readTurnDetection(),
      },
      output: { voice: "marin" },
    },
  };
}
```

(`system-prompt.ts` imports the `VoicePromptInput` type from here — that is intentional; config is the owner of the input shape.)

- [ ] **Step 6: Run — expect PASS, then commit**

Run: `cd apps/web && npx vitest run src/lib/voice`

```bash
git add apps/web/src/lib/voice
git commit -m "feat(voice): per-account system prompt + realtime session config + tool schemas"
```

---

### Task 5: Extract `computeAllSlots` into a shared module (pure refactor)

**Files:**
- Create: `apps/web/src/lib/booking/availability.ts`
- Modify: `apps/web/src/app/b/[publicId]/actions.ts` (delete the private copy, import the shared one)
- Test: `apps/web/src/lib/booking/availability.test.ts`

**Interfaces:**
- Produces:
  - `export async function computeAllSlots(db: SupabaseClient, calendar: CalendarRow, timezone: string, now: Date): Promise<{ startsAt: Date; endsAt: Date }[]>` — byte-for-byte the behavior of the private function currently at `apps/web/src/app/b/[publicId]/actions.ts:92-94` (listBookedRanges with the +2 day headroom window, ISO→Date mapping, `computeSlots`).
  - `export function dayKeyInZone(instant: Date, timeZone: string): string` — ALSO moved verbatim from its private definition in the same actions file (it is what `getSlotsAction` filters days with). Task 6's registry imports it from here — do NOT re-derive it from `partsInZone`, whose return shape this plan has not verified.

- [ ] **Step 1: Write a characterization test against the NEW module path**

```ts
// apps/web/src/lib/booking/availability.test.ts
import { describe, it, expect, vi } from "vitest";

const listBookedRangesMock = vi.fn();
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<object>();
  return { ...real, listBookedRanges: (...a: unknown[]) => listBookedRangesMock(...a) };
});

import { computeAllSlots } from "./availability";

const calendar = {
  id: "cal1", account_id: "a1", public_id: "p1", enabled: true,
  slot_duration_minutes: 60, buffer_minutes: 0, min_notice_hours: 0,
  max_advance_days: 2, open_hours: { tue: [["09:00", "12:00"]] }, notify_emails: [],
} as any;

describe("computeAllSlots", () => {
  it("returns Date ranges for open hours minus booked ranges", async () => {
    // Tue 2027-06-01, zone UTC for a deterministic test
    listBookedRangesMock.mockResolvedValue([
      { starts_at: "2027-06-01T09:00:00.000Z", ends_at: "2027-06-01T10:00:00.000Z" },
    ]);
    const now = new Date("2027-06-01T00:00:00Z");
    const slots = await computeAllSlots({} as any, calendar, "UTC", now);
    const starts = slots.map((s) => s.startsAt.toISOString());
    expect(starts).toContain("2027-06-01T10:00:00.000Z");
    expect(starts).toContain("2027-06-01T11:00:00.000Z");
    expect(starts).not.toContain("2027-06-01T09:00:00.000Z"); // booked
    expect(slots[0]!.startsAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `cd apps/web && npx vitest run src/lib/booking/availability.test.ts`

- [ ] **Step 3: Move the function**

Open `apps/web/src/app/b/[publicId]/actions.ts`, locate the private `computeAllSlots` (around line 92) and MOVE its exact body to the new module (adjust imports; `listBookedRanges` and `CalendarRow` come from `@bis/db`, `computeSlots`/`normalizeOpenHours` from `@/lib/booking/slots`):

```ts
// apps/web/src/lib/booking/availability.ts
// Extracted verbatim from b/[publicId]/actions.ts so the voice tools and the
// public booking page compute availability from ONE implementation. Any
// drift between the two would let the AI offer times the page would refuse.
import type { SupabaseClient } from "@supabase/supabase-js";
import { listBookedRanges, type CalendarRow } from "@bis/db";
import { computeSlots, normalizeOpenHours, type Range } from "@/lib/booking/slots";

export async function computeAllSlots(
  db: SupabaseClient, calendar: CalendarRow, timezone: string, now: Date,
): Promise<Range[]> {
  // ... paste the EXACT current body here (the +2 day headroom window on
  // listBookedRanges, ISO→Date mapping, computeSlots call). Do not edit logic.
}
```

Then in `actions.ts`: delete the private function, add `import { computeAllSlots } from "@/lib/booking/availability";`. **Diff discipline: the two call sites in `actions.ts` must be otherwise untouched.**

- [ ] **Step 4: Run the new test AND the full existing booking suites — all green**

Run: `cd apps/web && npx vitest run src/lib/booking src/app/b`
Expected: new test passes; every pre-existing `b/[publicId]` test unchanged and green (they are the real characterization suite for this refactor).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/booking/availability.ts apps/web/src/lib/booking/availability.test.ts "apps/web/src/app/b/[publicId]/actions.ts"
git commit -m "refactor(booking): extract computeAllSlots for shared voice/web availability"
```

⚠️ Use Read/Write/Edit for the bracketed route path — never shell-`cp` it (recorded corruption trap).

### Task 6: Tool registry I — context, availability, lookup, lead, message, transcript

**Files:**
- Create: `apps/web/src/lib/voice/tools/registry.ts`
- Test: `apps/web/src/lib/voice/tools/registry.test.ts`

**Interfaces:**
- Consumes: `computeAllSlots` (Task 5), call-state helpers (Task 3), `toE164` (Task 3), `findUpcomingBookingForPhone` (Task 2), `toolSchemas` (Task 4).
- Produces (Task 7 extends the same file; Task 8 consumes `runTool`):

```ts
export type ToolName =
  | "check_availability" | "book_appointment" | "reschedule_appointment"
  | "cancel_appointment" | "find_my_booking"
  | "capture_lead" | "take_message" | "log_transcript";

export interface ToolContext {
  db: SupabaseClient;
  accountId: string; accountName: string; timezone: string;
  calendar: CalendarRow;
  profile: VoiceProfileRow;
  branding: Branding; fromEmail: string | null;
  callerNumber: string | null;
  origin: string;              // deployment origin from the webhook req.url
  now?: () => Date;            // injectable clock for tests; defaults to () => new Date()
}

export async function runTool(
  state: CallState, ctx: ToolContext, name: ToolName, args: any,
): Promise<{ state: CallState; result: unknown }>;
```

- [ ] **Step 1: Write the failing tests for the five non-booking-write tools**

```ts
// apps/web/src/lib/voice/tools/registry.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const computeAllSlotsMock = vi.fn();
vi.mock("@/lib/booking/availability", () => ({
  computeAllSlots: (...a: unknown[]) => computeAllSlotsMock(...a),
}));
const dbMocks = vi.hoisted(() => ({
  findUpcomingBookingForPhone: vi.fn(),
  createContact: vi.fn(), createBooking: vi.fn(),
  setBookingStatus: vi.fn(), getBookingById: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<object>();
  return { ...real, ...dbMocks, SlotTakenError: (real as any).SlotTakenError };
});
vi.mock("@/lib/email", () => ({ getEmailProvider: () => ({ send: vi.fn() }) }));

import { runTool, type ToolContext } from "./registry";
import { emptyCallState } from "../call-state";

const ctx: ToolContext = {
  db: {} as any, accountId: "a1", accountName: "Rio Roofing",
  timezone: "America/Chicago",
  calendar: { id: "cal1", account_id: "a1", public_id: "pub1", enabled: true,
    slot_duration_minutes: 60, buffer_minutes: 0, min_notice_hours: 0,
    max_advance_days: 30, open_hours: {}, notify_emails: [] } as any,
  profile: { booking_enabled: true } as any,
  branding: { brandName: null, brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
  fromEmail: null, callerNumber: "+19562921696", origin: "https://x.example",
  now: () => new Date("2027-06-01T12:00:00Z"),
};

beforeEach(() => { Object.values(dbMocks).forEach((m) => m.mockReset()); computeAllSlotsMock.mockReset(); });

describe("check_availability", () => {
  it("returns ISO starts for the requested day only, in the account zone", async () => {
    computeAllSlotsMock.mockResolvedValue([
      { startsAt: new Date("2027-06-01T14:00:00Z"), endsAt: new Date("2027-06-01T15:00:00Z") }, // Jun 1 in Chicago
      { startsAt: new Date("2027-06-02T14:00:00Z"), endsAt: new Date("2027-06-02T15:00:00Z") }, // Jun 2
    ]);
    const { result } = await runTool(emptyCallState(), ctx, "check_availability", { date: "2027-06-01" });
    expect(result).toEqual({ slots: ["2027-06-01T14:00:00.000Z"] });
  });
  it("rejects a malformed date without calling the engine", async () => {
    const { result } = await runTool(emptyCallState(), ctx, "check_availability", { date: "tomorrow" });
    expect(result).toMatchObject({ ok: false });
    expect(computeAllSlotsMock).not.toHaveBeenCalled();
  });
});

describe("find_my_booking", () => {
  it("uses caller ID when no phone arg, E.164-normalizes an explicit one", async () => {
    dbMocks.findUpcomingBookingForPhone.mockResolvedValue({ bookingId: "b9", startsAt: "2027-06-03T14:00:00Z" });
    const r1 = await runTool(emptyCallState(), ctx, "find_my_booking", {});
    expect(dbMocks.findUpcomingBookingForPhone).toHaveBeenCalledWith({}, "a1", "+19562921696", expect.any(String));
    expect(r1.result).toEqual({ found: true, bookingId: "b9", startsAt: "2027-06-03T14:00:00Z" });
    await runTool(emptyCallState(), ctx, "find_my_booking", { phone: "(956) 555-0100" });
    expect(dbMocks.findUpcomingBookingForPhone).toHaveBeenLastCalledWith({}, "a1", "+19565550100", expect.any(String));
  });
  it("no caller ID and no arg → found:false, no query", async () => {
    const r = await runTool(emptyCallState(), { ...ctx, callerNumber: null }, "find_my_booking", {});
    expect(r.result).toEqual({ found: false });
    expect(dbMocks.findUpcomingBookingForPhone).not.toHaveBeenCalled();
  });
});

describe("capture_lead / take_message / log_transcript mutate state only", () => {
  it("capture_lead requires fullName and need", async () => {
    const miss = await runTool(emptyCallState(), ctx, "capture_lead", { fields: { fullName: "Ana" } });
    expect(miss.result).toMatchObject({ ok: false, missing: ["need"] });
    expect(miss.state.leads).toHaveLength(0);
    const ok = await runTool(emptyCallState(), ctx, "capture_lead",
      { fields: { fullName: "Ana", need: "roof quote" } });
    expect(ok.result).toMatchObject({ ok: true });
    expect(ok.state.leads[0]!.fields.need).toBe("roof quote");
  });
  it("take_message defaults callbackNumber to caller ID", async () => {
    const { state, result } = await runTool(emptyCallState(), ctx, "take_message", { body: "call me back" });
    expect(result).toMatchObject({ ok: true });
    expect(state.messages[0]).toMatchObject({ body: "call me back", callbackNumber: "+19562921696" });
  });
  it("log_transcript appends and coerces role", async () => {
    const { state } = await runTool(emptyCallState(), ctx, "log_transcript", { role: "assistant", text: "hi" });
    expect(state.transcript[0]).toMatchObject({ role: "assistant", text: "hi" });
    const { state: s2 } = await runTool(state, ctx, "log_transcript", { role: "weird", text: "x" });
    expect(s2.transcript[1]!.role).toBe("caller");
  });
  it("unknown tool name throws (caller converts to an error result)", async () => {
    await expect(runTool(emptyCallState(), ctx, "nope" as any, {})).rejects.toThrow(/Unknown tool/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd apps/web && npx vitest run src/lib/voice/tools/registry.test.ts`

- [ ] **Step 3: Implement registry.ts (booking write tools land in Task 7 — for now they throw `Unknown tool` via the default branch being unreachable is WRONG; instead give them explicit `not implemented` stubs that Task 7 replaces, so the ToolName type is complete and honest):**

```ts
// apps/web/src/lib/voice/tools/registry.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findUpcomingBookingForPhone,
  type CalendarRow, type VoiceProfileRow, type Branding,
} from "@bis/db";
import { computeAllSlots, dayKeyInZone } from "@/lib/booking/availability";
import { toE164 } from "../phone-number";
import {
  type CallState, withLead, withMessage, withTranscript,
} from "../call-state";

export type ToolName =
  | "check_availability" | "book_appointment" | "reschedule_appointment"
  | "cancel_appointment" | "find_my_booking"
  | "capture_lead" | "take_message" | "log_transcript";

export interface ToolContext {
  db: SupabaseClient;
  accountId: string; accountName: string; timezone: string;
  calendar: CalendarRow;
  profile: VoiceProfileRow;
  branding: Branding; fromEmail: string | null;
  callerNumber: string | null;
  origin: string;
  now?: () => Date;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_LEAD_FIELDS = ["fullName", "need"] as const;

export async function runTool(
  state: CallState, ctx: ToolContext, name: ToolName, args: any,
): Promise<{ state: CallState; result: unknown }> {
  const now = ctx.now?.() ?? new Date();
  switch (name) {
    case "check_availability": {
      const date = String(args?.date ?? "");
      if (!DAY_RE.test(date)) {
        return { state, result: { ok: false, error: "date must be YYYY-MM-DD" } };
      }
      const all = await computeAllSlots(ctx.db, ctx.calendar, ctx.timezone, now);
      const slots = all
        .filter((s) => dayKeyInZone(s.startsAt, ctx.timezone) === date)
        .slice(0, 20)
        .map((s) => s.startsAt.toISOString());
      return { state, result: { slots } };
    }

    case "find_my_booking": {
      const phone = toE164(args?.phone) ?? ctx.callerNumber;
      if (!phone) return { state, result: { found: false } };
      const hit = await findUpcomingBookingForPhone(ctx.db, ctx.accountId, phone, now.toISOString());
      return { state, result: hit ? { found: true, ...hit } : { found: false } };
    }

    case "capture_lead": {
      const fields: Record<string, string> = {};
      const raw = (args?.fields && typeof args.fields === "object") ? args.fields : {};
      for (const [k, v] of Object.entries(raw)) fields[k] = String(v ?? "").trim();
      if (!fields.callbackNumber && ctx.callerNumber) fields.callbackNumber = ctx.callerNumber;
      const missing = REQUIRED_LEAD_FIELDS.filter((f) => !fields[f]);
      if (missing.length > 0) return { state, result: { ok: false, missing } };
      return { state: withLead(state, { fields }), result: { ok: true } };
    }

    case "take_message": {
      const body = String(args?.body ?? "").trim();
      if (!body) return { state, result: { ok: false, error: "message body required" } };
      const callbackNumber = toE164(args?.callbackNumber) ?? ctx.callerNumber ?? undefined;
      return {
        state: withMessage(state, { body, callbackNumber, at: now.toISOString() }),
        result: { ok: true },
      };
    }

    case "log_transcript": {
      const role = args?.role === "assistant" ? "assistant" : "caller";
      return {
        state: withTranscript(state, { role, text: String(args?.text ?? ""), at: now.toISOString() }),
        result: { ok: true },
      };
    }

    case "book_appointment":
    case "reschedule_appointment":
    case "cancel_appointment":
      // Implemented in Task 7 (bookAppointmentTool / rescheduleTool / cancelTool).
      return { state, result: { ok: false, error: "booking is not available yet" } };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
```

- [ ] **Step 4: Run — expect PASS, then commit**

Run: `cd apps/web && npx vitest run src/lib/voice/tools/registry.test.ts`

```bash
git add apps/web/src/lib/voice/tools
git commit -m "feat(voice): tool registry — availability, booking lookup, lead, message, transcript"
```

---

### Task 7: Tool registry II — book, reschedule, cancel (native calendar + confirmation email)

**Files:**
- Modify: `apps/web/src/lib/voice/tools/registry.ts` (replace the three stubs)
- Test: extend `apps/web/src/lib/voice/tools/registry.test.ts`

**Interfaces:**
- Consumes: `createContact`, `createBooking`, `SlotTakenError`, `setBookingStatus`, `getBookingById` (`@bis/db`); `computeAllSlots`; `emailBrand`/`bookingConfirmationEmail`/`normalizeReplyTo`/`getEmailProvider`; `formatWhen`, `safeZone` from `@/lib/booking/time`; `withBooking`, `withBookingCancelled`.
- Produces: the three tool branches. Booking rules (the demo's blood-written ones):
  - phone = `toE164(args.phone) ?? ctx.callerNumber`; **no phone AND no email → refuse with an ask-again error** (never book uncontactable).
  - startsAt must be one of `computeAllSlots` (open-hours + notice validity — the overlap constraint alone would happily take 3 AM).
  - `SlotTakenError` → `{ ok:false, error: "that time was just taken", slotTaken: true }`.
  - Contact: reuse `state.contactId` if set, else `createContact` (name split: last space → firstName/lastName; `source: "voice"`; actor `"voice"`/`"ai"`) and store id in state.
  - Confirmation email ONLY if an email was given: brand via `emailBrand(ctx.branding, ctx.accountName)`, cancel URL `${ctx.origin}/b/${ctx.calendar.public_id}/cancel/${cancelToken}`, `fromAddress: ctx.fromEmail ?? undefined` (customer-facing), send failure is caught and reported as `{ ok:true, emailFailed: true }` — a sent booking must never be reported as failed (the demo's Group-C ordering lesson).
  - Reschedule = **book new first, cancel old second** (never strand the caller with nothing); old booking looked up via `getBookingById` for its contact.
  - Every success mirrors into state (`withBooking` / `withBookingCancelled`) — the BUG-5 rule.

- [ ] **Step 1: Add the failing tests**

Append to `registry.test.ts`:

```ts
describe("book_appointment", () => {
  const slot = { startsAt: new Date("2027-06-01T14:00:00Z"), endsAt: new Date("2027-06-01T15:00:00Z") };
  beforeEach(() => {
    computeAllSlotsMock.mockResolvedValue([slot]);
    dbMocks.createContact.mockResolvedValue({ id: "ct1", existing: false });
    dbMocks.createBooking.mockResolvedValue({ id: "bk1", cancelToken: "tok123" });
  });

  it("books an offered slot, mirrors state, remembers the contact", async () => {
    const { state, result } = await runTool(emptyCallState(), ctx, "book_appointment",
      { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz" });
    expect(result).toMatchObject({ ok: true, bookingId: "bk1" });
    expect(dbMocks.createContact).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ firstName: "Ana", lastName: "Ruiz", phone: "+19562921696", source: "voice" }),
      "voice", "ai");
    expect(dbMocks.createBooking).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ calendarId: "cal1", contactId: "ct1" }), "voice", "ai");
    expect(state.bookings[0]).toMatchObject({ id: "bk1", status: "booked" });
    expect(state.contactId).toBe("ct1");
  });

  it("refuses a time that was never offered", async () => {
    const { result } = await runTool(emptyCallState(), ctx, "book_appointment",
      { startsAt: "2027-06-01T03:00:00.000Z", name: "Ana" });
    expect(result).toMatchObject({ ok: false });
    expect(dbMocks.createBooking).not.toHaveBeenCalled();
  });

  it("refuses when there is no phone and no email", async () => {
    const { result } = await runTool(emptyCallState(), { ...ctx, callerNumber: null },
      "book_appointment", { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana" });
    expect(result).toMatchObject({ ok: false });
    expect(dbMocks.createContact).not.toHaveBeenCalled();
  });

  it("maps SlotTakenError to a race answer", async () => {
    const { SlotTakenError } = await import("@bis/db");
    dbMocks.createBooking.mockRejectedValue(new (SlotTakenError as any)());
    const { result } = await runTool(emptyCallState(), ctx, "book_appointment",
      { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana" });
    expect(result).toMatchObject({ ok: false, slotTaken: true });
  });
});

describe("reschedule / cancel", () => {
  it("reschedule books the new slot BEFORE cancelling the old", async () => {
    const calls: string[] = [];
    computeAllSlotsMock.mockResolvedValue([{ startsAt: new Date("2027-06-02T14:00:00Z"), endsAt: new Date("2027-06-02T15:00:00Z") }]);
    dbMocks.getBookingById.mockResolvedValue({ id: "old1", contact_id: "ct1", calendar_id: "cal1",
      starts_at: "2027-06-01T14:00:00Z", ends_at: "2027-06-01T15:00:00Z", status: "booked" });
    dbMocks.createBooking.mockImplementation(async () => { calls.push("book"); return { id: "new1", cancelToken: "t" }; });
    dbMocks.setBookingStatus.mockImplementation(async () => { calls.push("cancel"); });
    const { state, result } = await runTool(emptyCallState(), ctx, "reschedule_appointment",
      { bookingId: "old1", startsAt: "2027-06-02T14:00:00.000Z" });
    expect(result).toMatchObject({ ok: true, bookingId: "new1" });
    expect(calls).toEqual(["book", "cancel"]);
    expect(state.bookings.find((b) => b.id === "old1")).toBeUndefined(); // replaced, not duplicated
    expect(state.bookings.find((b) => b.id === "new1")).toMatchObject({ status: "booked" });
  });
  it("cancel marks status and mirrors", async () => {
    dbMocks.getBookingById.mockResolvedValue({ id: "b1", contact_id: "ct1", calendar_id: "cal1",
      starts_at: "2027-06-01T14:00:00Z", ends_at: "x", status: "booked" });
    dbMocks.setBookingStatus.mockResolvedValue(undefined);
    const pre = { ...emptyCallState(), bookings: [{ id: "b1", contactName: "A", startsAt: "x", endsAt: "y", status: "booked" as const }] };
    const { state, result } = await runTool(pre, ctx, "cancel_appointment", { bookingId: "b1" });
    expect(result).toEqual({ ok: true });
    expect(dbMocks.setBookingStatus).toHaveBeenCalledWith({}, "a1", "b1", "cancelled", "voice");
    expect(state.bookings[0]!.status).toBe("cancelled");
  });
  it("cancel of an unknown booking is a clean error", async () => {
    dbMocks.getBookingById.mockResolvedValue(null);
    const { result } = await runTool(emptyCallState(), ctx, "cancel_appointment", { bookingId: "ghost" });
    expect(result).toMatchObject({ ok: false });
    expect(dbMocks.setBookingStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL (stubs answer "not available yet")**

- [ ] **Step 3: Replace the three stubs**

```ts
    case "book_appointment": {
      const name = String(args?.name ?? "").trim();
      if (!name) return { state, result: { ok: false, error: "name required" } };
      const phone = toE164(args?.phone) ?? ctx.callerNumber;
      const email = String(args?.email ?? "").trim() || null;
      if (args?.phone?.trim && args.phone.trim() && !toE164(args.phone)) {
        return { state, result: { ok: false, error: "That phone number doesn't look complete — could you give it to me again?" } };
      }
      if (!phone && !email) {
        return { state, result: { ok: false, error: "need a phone number or an email to book" } };
      }
      const wanted = String(args?.startsAt ?? "");
      const all = await computeAllSlots(ctx.db, ctx.calendar, ctx.timezone, now);
      const slot = all.find((s) => s.startsAt.toISOString() === new Date(wanted).toISOString());
      if (!slot) return { state, result: { ok: false, error: "that time isn't available — offer one from check_availability" } };

      let contactId = state.contactId;
      if (!contactId) {
        const space = name.lastIndexOf(" ");
        const firstName = space > 0 ? name.slice(0, space) : name;
        const lastName = space > 0 ? name.slice(space + 1) : undefined;
        const created = await createContact(ctx.db, ctx.accountId,
          { firstName, lastName, phone: phone ?? undefined, email: email ?? undefined, source: "voice" },
          "voice", "ai");
        contactId = created.id;
      }

      let bookingId: string; let cancelToken: string;
      try {
        ({ id: bookingId, cancelToken } = await createBooking(ctx.db, ctx.accountId, {
          calendarId: ctx.calendar.id, contactId,
          startsAt: slot.startsAt, endsAt: slot.endsAt,
          note: String(args?.notes ?? "").trim() || undefined,
        }, "voice", "ai"));
      } catch (e) {
        if (e instanceof SlotTakenError) {
          return { state: { ...state, contactId }, result: { ok: false, slotTaken: true, error: "that time was just taken — offer another" } };
        }
        throw e;
      }

      let emailFailed = false;
      if (email) {
        try {
          const brand = emailBrand(ctx.branding, ctx.accountName);
          const whenCompanyZone = formatWhen(slot.startsAt, ctx.timezone);
          const cancelUrl = `${ctx.origin}/b/${ctx.calendar.public_id}/cancel/${cancelToken}`;
          const { html, text } = bookingConfirmationEmail({
            brand, whenBookerZone: whenCompanyZone, whenCompanyZone, cancelUrl,
          });
          await getEmailProvider().send({
            to: email, fromName: brand.name, fromAddress: ctx.fromEmail ?? undefined,
            replyTo: normalizeReplyTo(ctx.branding.replyToEmail),
            subject: "You're booked in", body: text, html,
          });
        } catch (e) {
          emailFailed = true;
          console.error(`voice booking ${bookingId}: confirmation email failed: ${String(e)}`);
        }
      }

      const next = withBooking({ ...state, contactId }, {
        id: bookingId, contactName: name,
        startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(),
      });
      return { state: next, result: { ok: true, bookingId, startsAt: slot.startsAt.toISOString(), ...(emailFailed ? { emailFailed: true } : {}) } };
    }

    case "reschedule_appointment": {
      const bookingId = String(args?.bookingId ?? "");
      const old = bookingId ? await getBookingById(ctx.db, ctx.accountId, bookingId) : null;
      if (!old || old.status !== "booked") {
        return { state, result: { ok: false, error: "no such booking — use find_my_booking first" } };
      }
      const wanted = String(args?.startsAt ?? "");
      const all = await computeAllSlots(ctx.db, ctx.calendar, ctx.timezone, now);
      const slot = all.find((s) => s.startsAt.toISOString() === new Date(wanted).toISOString());
      if (!slot) return { state, result: { ok: false, error: "that time isn't available" } };
      // Book the NEW slot first — never leave the caller with nothing.
      let newId: string;
      try {
        ({ id: newId } = await createBooking(ctx.db, ctx.accountId, {
          calendarId: old.calendar_id, contactId: old.contact_id,
          startsAt: slot.startsAt, endsAt: slot.endsAt,
        }, "voice", "ai"));
      } catch (e) {
        if (e instanceof SlotTakenError) return { state, result: { ok: false, slotTaken: true, error: "that time was just taken" } };
        throw e;
      }
      await setBookingStatus(ctx.db, ctx.accountId, bookingId, "cancelled", "voice");
      const next = withBooking(
        { ...state, bookings: state.bookings.filter((b) => b.id !== bookingId) },
        { id: newId, contactName: "", startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() },
      );
      return { state: next, result: { ok: true, bookingId: newId, startsAt: slot.startsAt.toISOString() } };
    }

    case "cancel_appointment": {
      const bookingId = String(args?.bookingId ?? "");
      const row = bookingId ? await getBookingById(ctx.db, ctx.accountId, bookingId) : null;
      if (!row || row.status !== "booked") {
        return { state, result: { ok: false, error: "no such booking — use find_my_booking first" } };
      }
      await setBookingStatus(ctx.db, ctx.accountId, bookingId, "cancelled", "voice");
      return { state: withBookingCancelled(state, bookingId), result: { ok: true } };
    }
```

Add the imports this needs at the top of `registry.ts`:

```ts
import {
  createContact, createBooking, SlotTakenError, setBookingStatus, getBookingById,
  findUpcomingBookingForPhone,
  type CalendarRow, type VoiceProfileRow, type Branding,
} from "@bis/db";
import { getEmailProvider } from "@/lib/email";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingConfirmationEmail } from "@/lib/email/templates/booking";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { formatWhen } from "@/lib/booking/time";
import { withBooking, withBookingCancelled } from "../call-state";
```

- [ ] **Step 4: Run all registry tests — expect PASS, then commit**

Run: `cd apps/web && npx vitest run src/lib/voice/tools/registry.test.ts`

```bash
git add apps/web/src/lib/voice/tools/registry.ts apps/web/src/lib/voice/tools/registry.test.ts
git commit -m "feat(voice): booking tools — native calendar book/reschedule/cancel with confirmation email"
```

---

### Task 8: `processCallEvent` — the WS event → tool dispatch seam

**Files:**
- Create: `apps/web/src/lib/voice/call-events.ts`
- Test: `apps/web/src/lib/voice/call-events.test.ts`

**Interfaces:**
- Consumes: `runTool`/`ToolContext` (Tasks 6-7), `withTranscript`.
- Produces:

```ts
export interface VoiceAction { kind: "send"; payload: object }
export async function processCallEvent(
  state: CallState, ctx: ToolContext, event: any,
): Promise<{ state: CallState; actions: VoiceAction[] }>;
```

Exactly three event types (the demo's contract): `response.output_audio_transcript.done` → assistant transcript; `conversation.item.input_audio_transcription.completed` → caller transcript; `response.function_call_arguments.done` → parse args, `runTool`, reply with the two-message pattern (`conversation.item.create` with `function_call_output` + `response.create`). A tool throw becomes `{ ok: false, error: "unknown tool" }` sent back — never a crashed call. Everything else: no-op.

- [ ] **Step 1: Failing tests**

```ts
// apps/web/src/lib/voice/call-events.test.ts
import { describe, it, expect, vi } from "vitest";

const runToolMock = vi.fn();
vi.mock("./tools/registry", () => ({ runTool: (...a: unknown[]) => runToolMock(...a) }));

import { processCallEvent } from "./call-events";
import { emptyCallState } from "./call-state";

const ctx = {} as any;

describe("processCallEvent", () => {
  it("assistant transcript event appends and produces no actions", async () => {
    const { state, actions } = await processCallEvent(emptyCallState(), ctx,
      { type: "response.output_audio_transcript.done", transcript: "How can I help?" });
    expect(state.transcript[0]).toMatchObject({ role: "assistant", text: "How can I help?" });
    expect(actions).toEqual([]);
  });
  it("caller transcript event appends as caller", async () => {
    const { state } = await processCallEvent(emptyCallState(), ctx,
      { type: "conversation.item.input_audio_transcription.completed", transcript: "hola" });
    expect(state.transcript[0]).toMatchObject({ role: "caller", text: "hola" });
  });
  it("empty transcript is ignored", async () => {
    const { state } = await processCallEvent(emptyCallState(), ctx,
      { type: "response.output_audio_transcript.done", transcript: "" });
    expect(state.transcript).toHaveLength(0);
  });
  it("function call dispatches runTool and replies with output + response.create", async () => {
    runToolMock.mockResolvedValue({ state: emptyCallState(), result: { ok: true, x: 1 } });
    const { actions } = await processCallEvent(emptyCallState(), ctx,
      { type: "response.function_call_arguments.done", name: "take_message", call_id: "fc1", arguments: '{"body":"hi"}' });
    expect(runToolMock).toHaveBeenCalledWith(expect.anything(), ctx, "take_message", { body: "hi" });
    expect(actions).toEqual([
      { kind: "send", payload: { type: "conversation.item.create",
        item: { type: "function_call_output", call_id: "fc1", output: JSON.stringify({ ok: true, x: 1 }) } } },
      { kind: "send", payload: { type: "response.create" } },
    ]);
  });
  it("a throwing tool still answers the model instead of crashing the call", async () => {
    runToolMock.mockRejectedValue(new Error("Unknown tool: nope"));
    const { actions } = await processCallEvent(emptyCallState(), ctx,
      { type: "response.function_call_arguments.done", name: "nope", call_id: "fc2", arguments: "{}" });
    expect((actions[0]!.payload as any).item.output).toBe(JSON.stringify({ ok: false, error: "unknown tool" }));
  });
  it("bad JSON args become {}", async () => {
    runToolMock.mockResolvedValue({ state: emptyCallState(), result: { ok: true } });
    await processCallEvent(emptyCallState(), ctx,
      { type: "response.function_call_arguments.done", name: "take_message", call_id: "fc3", arguments: "{{{" });
    expect(runToolMock).toHaveBeenCalledWith(expect.anything(), ctx, "take_message", {});
  });
  it("unknown event types are a no-op", async () => {
    const { state, actions } = await processCallEvent(emptyCallState(), ctx, { type: "session.updated" });
    expect(actions).toEqual([]);
    expect(state.transcript).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement**

```ts
// apps/web/src/lib/voice/call-events.ts
// The pure seam between the OpenAI Realtime WS and the tool registry.
// Everything testable about a live call funnels through here.
import { runTool, type ToolContext, type ToolName } from "./tools/registry";
import { withTranscript, type CallState } from "./call-state";

export interface VoiceAction { kind: "send"; payload: object }

function safeParse(raw: unknown): object {
  if (typeof raw !== "string") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}

function functionCallActions(callId: string, result: unknown): VoiceAction[] {
  return [
    { kind: "send", payload: {
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(result) },
    } },
    { kind: "send", payload: { type: "response.create" } },
  ];
}

export async function processCallEvent(
  state: CallState, ctx: ToolContext, event: any,
): Promise<{ state: CallState; actions: VoiceAction[] }> {
  switch (event?.type) {
    case "response.output_audio_transcript.done": {
      if (!event.transcript) return { state, actions: [] };
      return {
        state: withTranscript(state, { role: "assistant", text: String(event.transcript), at: new Date().toISOString() }),
        actions: [],
      };
    }
    case "conversation.item.input_audio_transcription.completed": {
      if (!event.transcript) return { state, actions: [] };
      return {
        state: withTranscript(state, { role: "caller", text: String(event.transcript), at: new Date().toISOString() }),
        actions: [],
      };
    }
    case "response.function_call_arguments.done": {
      const args = safeParse(event.arguments);
      try {
        const { state: next, result } = await runTool(state, ctx, event.name as ToolName, args);
        return { state: next, actions: functionCallActions(event.call_id, result) };
      } catch {
        return { state, actions: functionCallActions(event.call_id, { ok: false, error: "unknown tool" }) };
      }
    }
    default:
      return { state, actions: [] };
  }
}
```

- [ ] **Step 4: Run — PASS. Step 5: Commit**

```bash
git add apps/web/src/lib/voice/call-events.ts apps/web/src/lib/voice/call-events.test.ts
git commit -m "feat(voice): processCallEvent — WS event to tool dispatch seam"
```

---

### Task 9: Summary pipeline — the three honesty layers + the model call

**Files:**
- Create: `apps/web/src/lib/voice/summarize.ts` (pure)
- Create: `apps/web/src/lib/voice/summary-service.ts` (fetch)
- Test: `apps/web/src/lib/voice/summarize.test.ts`, `apps/web/src/lib/voice/summary-service.test.ts`

**Interfaces:**
- Produces:

```ts
// summarize.ts (pure)
export function buildSummaryInput(state: CallState): string;      // (none) markers — layer 1
export function summaryFactLine(state: CallState): string;        // authoritative RECORDED line — layer 2
export function checkSummaryAgainstState(summary: string, state: CallState): { claimsBooking: boolean; claimsIntake: boolean };
export function composeSummary(prose: string, state: CallState): string; // fact line → optional ⚠ MISMATCH → prose — layer 3
// summary-service.ts
export async function generateSummary(state: CallState, deps?: { fetchImpl?: typeof fetch }): Promise<string>;
```

Port from `bis-reception-demo/src/lib/ai/summarize.ts` and `summary-service.ts` (read-only reference), adapted to `CallState`: BOOKED section from `state.bookings` with `status === "booked"` (`- ${contactName} @ ${startsAt}`), INTAKE from `state.leads` with ≥1 non-blank field, the exact `BOOKING_CLAIM`/`INTAKE_CLAIM`/`NEGATION` regexes, the lookbehind sentence split, the ⚠ MISMATCH banner text ("The caller may have been told otherwise on the call. Check before following up."), prose kept never discarded. Model call: raw `fetch` to `https://api.openai.com/v1/chat/completions`, model `"gpt-4o-mini"`, the demo's 7-rule system message verbatim (staff-facing English, authoritative-records rules), returns `composeSummary(prose, state)`; `prose = ""` when the request fails (fact line still stands). No store — the caller holds state.

- [ ] **Step 1: Failing tests** — the three production-regression shapes:

```ts
// apps/web/src/lib/voice/summarize.test.ts
import { describe, it, expect } from "vitest";
import { buildSummaryInput, summaryFactLine, checkSummaryAgainstState, composeSummary } from "./summarize";
import { emptyCallState, withBooking, withLead, withTranscript } from "./call-state";

describe("layer 1 — buildSummaryInput", () => {
  it("renders (none) markers, never blanks", () => {
    const input = buildSummaryInput(emptyCallState());
    expect(input).toContain("BOOKED:\n(none)");
    expect(input).toContain("INTAKE:\n(none)");
    expect(input).toContain("(no speech captured)");
  });
});

describe("layer 2 — summaryFactLine", () => {
  it("states the negative plainly", () => {
    expect(summaryFactLine(emptyCallState())).toContain("no appointment was recorded");
  });
  it("names a real booking", () => {
    const s = withBooking(emptyCallState(), { id: "b1", contactName: "Ana", startsAt: "2027-06-01T14:00:00Z", endsAt: "x" });
    expect(summaryFactLine(s)).toContain("Ana");
  });
});

describe("layer 3 — mismatch detection (the 3 production fabrications)", () => {
  it("flags 'successfully booked' against an empty state — even with a trailing negation elsewhere", () => {
    const prose = "The caller requested an appointment, which has been successfully booked. No follow-up is needed at this time.";
    const check = checkSummaryAgainstState(prose, emptyCallState());
    expect(check.claimsBooking).toBe(true);
    expect(composeSummary(prose, emptyCallState())).toContain("⚠ MISMATCH");
  });
  it("does NOT flag an honest negative", () => {
    const prose = "The caller hung up before speaking. No appointment was booked.";
    expect(checkSummaryAgainstState(prose, emptyCallState()).claimsBooking).toBe(false);
  });
  it("does NOT flag a claim that state supports", () => {
    const s = withBooking(emptyCallState(), { id: "b1", contactName: "Ana", startsAt: "x", endsAt: "y" });
    expect(checkSummaryAgainstState("An appointment was booked for Ana.", s).claimsBooking).toBe(false);
  });
  it("keeps the prose under the banner (the caller may have been told)", () => {
    const out = composeSummary("An appointment was scheduled.", emptyCallState());
    expect(out).toContain("An appointment was scheduled.");
    expect(out.indexOf("RECORDED")).toBeLessThan(out.indexOf("⚠ MISMATCH"));
    expect(out.indexOf("⚠ MISMATCH")).toBeLessThan(out.indexOf("An appointment was scheduled."));
  });
  it("flags intake claims against empty leads", () => {
    const prose = "The caller's phone number was captured for follow-up.";
    expect(checkSummaryAgainstState(prose, emptyCallState()).claimsIntake).toBe(true);
    const s = withLead(emptyCallState(), { fields: { fullName: "Ana" } });
    expect(checkSummaryAgainstState(prose, s).claimsIntake).toBe(false);
  });
});
```

```ts
// apps/web/src/lib/voice/summary-service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSummary } from "./summary-service";
import { emptyCallState, withTranscript } from "./call-state";

beforeEach(() => { process.env.OPENAI_API_KEY = "sk-test"; });

describe("generateSummary", () => {
  it("sends gpt-4o-mini with the authoritative-records system rules and composes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: "Caller asked about hours. No appointment was recorded." } }] }),
    });
    const s = withTranscript(emptyCallState(), { role: "caller", text: "what are your hours?", at: "t" });
    const out = await generateSummary(s, { fetchImpl: fetchImpl as any });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[0].content).toContain("authoritative");
    expect(out).toContain("RECORDED");
    expect(out).toContain("Caller asked about hours.");
  });
  it("a failed request still yields the fact line", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("down"));
    const out = await generateSummary(emptyCallState(), { fetchImpl: fetchImpl as any });
    expect(out).toContain("RECORDED");
    expect(out).toContain("no appointment was recorded");
  });
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement both modules** (port the demo's regexes and system message verbatim; `generateSummary` wraps the fetch in try/catch → `prose = ""`; system message must include the word "authoritative" as in the demo's line "The BOOKED and INTAKE sections are the system's own records and are authoritative.").

- [ ] **Step 4: Run — PASS. Step 5: Commit**

```bash
git add apps/web/src/lib/voice/summarize.ts apps/web/src/lib/voice/summary-service.ts apps/web/src/lib/voice/summarize.test.ts apps/web/src/lib/voice/summary-service.test.ts
git commit -m "feat(voice): call summary — three honesty layers + gpt-4o-mini service"
```

---

### Task 10: `finishCall` — durable record + lead treatment + staff alert

**Files:**
- Create: `apps/web/src/lib/voice/finish-call.ts`
- Create: `apps/web/src/lib/email/templates/voice.ts`
- Test: `apps/web/src/lib/voice/finish-call.test.ts`, `apps/web/src/lib/email/templates/voice.test.ts`

**Interfaces:**
- Consumes: `classifyOutcome`, `generateSummary`, `finishCallRow`, `createContact`, `ensureConversation`, `createMessage`, `incrementUnreadCount`, `emit`, `emailBrand`, `getEmailProvider`, `toE164`.
- Produces:

```ts
// templates/voice.ts — follows the house template contract: returns {html,text}, formats nothing
export type VoiceCallAlertInput = {
  brand: EmailBrand; outcome: string; summary: string;
  callerDisplay: string;                 // "+1956..." or "Unknown caller"
  contactUrl: string | null;
};
export function voiceCallAlertEmail(input: VoiceCallAlertInput): { html: string; text: string };

// finish-call.ts
export interface FinishContext {
  db: SupabaseClient; accountId: string; accountName: string;
  branding: Branding; notifyEmails: string[];
  callerNumber: string | null; origin: string;
  profileLanguage: "en" | "es" | "both";
}
export interface FinishMeta { callRowId: string | null; startedAt: Date; endedAt: Date }
export async function finishCall(state: CallState, ctx: FinishContext, meta: FinishMeta):
  Promise<{ stored: boolean; notified: boolean; outcome: CallOutcome }>;
// NEVER throws — runs after hangup; the log line is the alert (demo rule).
```

Behavior:
1. `outcome = classifyOutcome(state)`; `summary = await generateSummary(state)` (its own catch → `summaryFactLine`).
2. If outcome is `booked`/`lead`/`message`: resolve contact (`state.contactId` ?? create from lead fields: fullName split, `phone: toE164(fields.callbackNumber) ?? ctx.callerNumber`, `email: fields.email`, `source: "voice"`; if NO lead fields and no contactId but caller number exists, create a minimal contact `firstName: "Caller"`, phone) → `ensureConversation` → `createMessage({ channel: "voice", direction: "inbound", subject: "Phone call", body: summary })` → `incrementUnreadCount`. Each in ONE try — a failure logs and continues to the alert (alert must not be suppressed; the form action's split).
3. Staff alert (same outcomes only): `voiceCallAlertEmail` to every `ctx.notifyEmails` with per-recipient try/catch; **no fromAddress**; subject `` `Call — ${outcome} — ${callerDisplay}` ``.
4. `finishCallRow` with everything (its own try/catch → `stored=false`). `language`: `"es"` if `ctx.profileLanguage === "es"` else `"en"`. `durationSecs` from meta. `bookingId` = first state booking with status "booked".
5. `stored || notified` false AND outcome meaningful → `console.error("CALL LOST ...")`.
6. `emit(db, accountId, "call.recorded", "voice", { callId, outcome }, "ai")` best-effort.

- [ ] **Step 1: Failing tests**

```ts
// apps/web/src/lib/voice/finish-call.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  finishCallRow: vi.fn(), createContact: vi.fn(), ensureConversation: vi.fn(),
  createMessage: vi.fn(), incrementUnreadCount: vi.fn(), emit: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const sendMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email", () => ({ getEmailProvider: () => ({ send: (...a: unknown[]) => sendMock(...a) }) }));
vi.mock("./summary-service", () => ({ generateSummary: vi.fn().mockResolvedValue("RECORDED — test.") }));

import { finishCall, type FinishContext } from "./finish-call";
import { emptyCallState, withLead, withMessage, withTranscript, withBooking } from "./call-state";

const ctx: FinishContext = {
  db: {} as any, accountId: "a1", accountName: "Rio Roofing",
  branding: { brandName: null, brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
  notifyEmails: ["staff@example.com"], callerNumber: "+19562921696",
  origin: "https://x.example", profileLanguage: "both",
};
const meta = { callRowId: "call1", startedAt: new Date("2027-06-01T12:00:00Z"), endedAt: new Date("2027-06-01T12:02:00Z") };

beforeEach(() => {
  Object.values(dbMocks).forEach((m) => m.mockReset());
  sendMock.mockReset().mockResolvedValue({ providerMessageId: "x" });
  dbMocks.createContact.mockResolvedValue({ id: "ct1", existing: false });
  dbMocks.ensureConversation.mockResolvedValue({ id: "cv1", created: true });
  dbMocks.createMessage.mockResolvedValue({ id: "m1" });
  dbMocks.finishCallRow.mockResolvedValue(undefined);
});

describe("finishCall", () => {
  it("a lead call runs the full treatment: contact → conversation → message(voice) → unread → alert → row", async () => {
    const s = withLead(withTranscript(emptyCallState(), { role: "caller", text: "hi", at: "t" }),
      { fields: { fullName: "Ana Ruiz", need: "roof quote", callbackNumber: "+19562921696" } });
    const r = await finishCall(s, ctx, meta);
    expect(r).toMatchObject({ stored: true, notified: true, outcome: "lead" });
    expect(dbMocks.createContact).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ firstName: "Ana", lastName: "Ruiz", phone: "+19562921696", source: "voice" }), "voice", "ai");
    expect(dbMocks.createMessage).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ channel: "voice", direction: "inbound" }), "voice", "ai");
    expect(dbMocks.incrementUnreadCount).toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sent = sendMock.mock.calls[0]![0];
    expect(sent.fromAddress).toBeUndefined();              // staff mail: platform From
    expect(dbMocks.finishCallRow).toHaveBeenCalledWith({}, "a1", "call1",
      expect.objectContaining({ outcome: "lead", contactId: "ct1", conversationId: "cv1", durationSecs: 120 }));
  });
  it("an abandoned call records the row but creates nothing and alerts nobody", async () => {
    const s = withTranscript(emptyCallState(), { role: "caller", text: "uh", at: "t" });
    const r = await finishCall(s, ctx, meta);
    expect(r.outcome).toBe("abandoned");
    expect(dbMocks.createContact).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMocks.finishCallRow).toHaveBeenCalled();
  });
  it("DB down + email up → stored:false notified:true, and it never throws", async () => {
    dbMocks.finishCallRow.mockRejectedValue(new Error("db down"));
    dbMocks.createContact.mockRejectedValue(new Error("db down"));
    const s = withMessage(emptyCallState(), { body: "call me", at: "t" });
    const r = await finishCall(s, ctx, meta);
    expect(r).toMatchObject({ stored: false, notified: true });
  });
  it("both legs down → CALL LOST logged, still no throw", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.finishCallRow.mockRejectedValue(new Error("db down"));
    dbMocks.createContact.mockRejectedValue(new Error("db down"));
    sendMock.mockRejectedValue(new Error("mail down"));
    const s = withMessage(emptyCallState(), { body: "call me", at: "t" });
    const r = await finishCall(s, ctx, meta);
    expect(r).toMatchObject({ stored: false, notified: false });
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes("CALL LOST"))).toBe(true);
    errSpy.mockRestore();
  });
  it("a booked call reuses state.contactId instead of creating a duplicate", async () => {
    const s = { ...withBooking(emptyCallState(), { id: "bk1", contactName: "Ana", startsAt: "x", endsAt: "y" }), contactId: "ct-existing" };
    await finishCall(s, ctx, meta);
    expect(dbMocks.createContact).not.toHaveBeenCalled();
    expect(dbMocks.finishCallRow).toHaveBeenCalledWith({}, "a1", "call1",
      expect.objectContaining({ outcome: "booked", contactId: "ct-existing", bookingId: "bk1" }));
  });
});
```

```ts
// apps/web/src/lib/email/templates/voice.test.ts
import { describe, it, expect } from "vitest";
import { voiceCallAlertEmail } from "./voice";

const brand = { name: "Rio Roofing", logoUrl: null, accent: "violet" as any };

describe("voiceCallAlertEmail", () => {
  it("carries outcome, summary and caller in both html and text", () => {
    const { html, text } = voiceCallAlertEmail({
      brand, outcome: "lead", summary: "RECORDED — Intake: captured.",
      callerDisplay: "+19562921696", contactUrl: "https://x/dashboard/accounts/a1/contacts/ct1",
    });
    for (const out of [html, text]) {
      expect(out).toContain("lead");
      expect(out).toContain("RECORDED");
      expect(out).toContain("+19562921696");
    }
    expect(html).toContain("https://x/dashboard/accounts/a1/contacts/ct1");
  });
  it("escapes html in the summary", () => {
    const { html } = voiceCallAlertEmail({
      brand, outcome: "message", summary: "<script>alert(1)</script>", callerDisplay: "Unknown caller", contactUrl: null,
    });
    expect(html).not.toContain("<script>");
  });
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement both files.** Template follows `templates/booking.ts` structure (shell + escapeHtml + button for contactUrl).

- [ ] **Step 4: Run — PASS. Step 5: Commit**

```bash
git add apps/web/src/lib/voice/finish-call.ts apps/web/src/lib/voice/finish-call.test.ts apps/web/src/lib/email/templates/voice.ts apps/web/src/lib/email/templates/voice.test.ts
git commit -m "feat(voice): finishCall — durable record, lead treatment, staff alert (never throws)"
```

---

### Task 11: TeXML route — dynamic, embeds the called number

**Files:**
- Create: `apps/web/src/app/api/voice/texml/route.ts`
- Test: `apps/web/src/app/api/voice/texml/route.test.ts`

**Interfaces:**
- Consumes: `toE164` (Task 3), `getPhoneNumberByE164`/`serviceDb` (`@bis/db`, **lazy-imported inside the handler** — the demo's build trap: module-scope DB imports break `next build` during page-data collection). Env: `VOICE_OPENAI_PROJECT_ID`.
- Produces: GET+POST returning `application/xml`. Telnyx sends the dialed number as the `To` parameter (query on GET, form body on POST). Behavior:
  - Number known AND status `testing`/`live` → `<Dial>` to the OpenAI SIP URI with `X-BIS-Called` embedded.
  - Number unknown, or status `provisioned`/`released` → the spec §7 polite refusal: `<Say>Sorry, this number can't take your call right now. Please try again later.</Say><Hangup/>` — never a crash, never another tenant's greeting.
  - DB lookup THROWS → **fail-open: dial anyway** (the webhook's own resolver still gates; losing a real customer to a DB blip costs more than one declined-at-webhook call).
  - `To` missing/garbage → dial without the header (webhook falls back to `to`/`diversion`).

- [ ] **Step 1: Failing tests**

```ts
// apps/web/src/app/api/voice/texml/route.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { GET, POST } from "./route";

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getPhoneNumberByE164: (...a: unknown[]) => lookupMock(...a),
}));

beforeEach(() => {
  process.env.VOICE_OPENAI_PROJECT_ID = "proj_test123";
  lookupMock.mockReset().mockResolvedValue({ id: "pn1", account_id: "a1", e164: "+19565550999", telnyx_id: null, status: "live" });
});

describe("texml route", () => {
  it("GET on a live number embeds X-BIS-Called on the SIP URI", async () => {
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999") as any);
    const xml = await res.text();
    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(xml).toContain("<Dial answerOnBridge=\"true\">");
    expect(xml).toContain("sip:proj_test123@sip.api.openai.com;transport=tls?X-BIS-Called=%2B19565550999");
  });
  it("POST reads To from the form body", async () => {
    const body = new URLSearchParams({ To: "+19565550888", From: "+19562921696" });
    const res = await POST(new Request("https://x.example/api/voice/texml", {
      method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" },
    }) as any);
    expect(await res.text()).toContain("X-BIS-Called=%2B19565550888");
  });
  it("an unknown number gets the polite refusal, never a Dial", async () => {
    lookupMock.mockResolvedValue(null);
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19560000000") as any);
    const xml = await res.text();
    expect(xml).toContain("<Say>");
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Dial");
  });
  it("a released number is refused like an unknown one", async () => {
    lookupMock.mockResolvedValue({ id: "pn1", account_id: "a1", e164: "+19565550999", telnyx_id: null, status: "released" });
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999") as any);
    expect(await res.text()).toContain("<Hangup/>");
  });
  it("a DB failure fails OPEN — dials anyway, webhook still gates", async () => {
    lookupMock.mockRejectedValue(new Error("db down"));
    const res = await GET(new Request("https://x.example/api/voice/texml?To=%2B19565550999") as any);
    expect(await res.text()).toContain("X-BIS-Called=%2B19565550999");
  });
  it("a missing/garbage To still dials without the header (webhook falls back)", async () => {
    const res = await GET(new Request("https://x.example/api/voice/texml") as any);
    const xml = await res.text();
    expect(xml).toContain("<Sip>sip:proj_test123@sip.api.openai.com;transport=tls</Sip>");
    expect(xml).not.toContain("X-BIS-Called");
    expect(lookupMock).not.toHaveBeenCalled();
  });
  it("missing project id speaks the misconfig instead of dead air", async () => {
    delete process.env.VOICE_OPENAI_PROJECT_ID;
    const res = await GET(new Request("https://x.example/api/voice/texml") as any);
    expect(await res.text()).toContain("<Say>");
  });
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement**

```ts
// apps/web/src/app/api/voice/texml/route.ts
// Telnyx hits this for every inbound call on any client number and we answer
// with TeXML that bridges the call to the platform's OpenAI SIP connector.
// Telnyx TELLS US the dialed number (To param) — the SIP leg to OpenAI does
// not reliably carry it — so we smuggle it onto the SIP URI as X-BIS-Called.
// URI ?X-headers ride the INVITE and surface in the webhook's sip_headers.
// A number we don't know (or one not testing/live) gets a POLITE spoken
// refusal, never a crash and never another tenant's greeting (spec §7). A DB
// failure fails OPEN and dials — the webhook resolver still gates.
import { NextResponse } from "next/server";
import { toE164 } from "@/lib/voice/phone-number";

export const runtime = "nodejs";

const REFUSAL = `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say>Sorry, this number can't take your call right now. Please try again later.</Say><Hangup/></Response>`;

async function isRoutable(calledE164: string): Promise<boolean | null> {
  // Lazy import: a module-scope DB import here breaks `next build` during
  // page-data collection (the demo's documented trap). null = lookup failed.
  try {
    const { serviceDb, getPhoneNumberByE164 } = await import("@bis/db");
    const row = await getPhoneNumberByE164(serviceDb(), calledE164);
    return !!row && (row.status === "testing" || row.status === "live");
  } catch (e) {
    console.error(`texml lookup failed for ${calledE164}: ${String(e)}`);
    return null; // fail open
  }
}

function dialXml(calledE164: string | null): string {
  const projectId = process.env.VOICE_OPENAI_PROJECT_ID;
  if (!projectId) {
    // Speak the misconfig: a broken deploy should be audible on a test call,
    // never silent dead air (demo lesson).
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say>Configuration error: the project identifier is not set.</Say><Hangup/></Response>`;
  }
  const base = `sip:${projectId}@sip.api.openai.com;transport=tls`;
  const uri = calledE164 ? `${base}?X-BIS-Called=${encodeURIComponent(calledE164)}` : base;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Dial answerOnBridge="true"><Sip>${uri}</Sip></Dial></Response>`;
}

function xmlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

async function respond(calledE164: string | null): Promise<NextResponse> {
  if (calledE164) {
    const routable = await isRoutable(calledE164);
    if (routable === false) return xmlResponse(REFUSAL);
    // true → dial; null (lookup failed) → fail open, dial
  }
  return xmlResponse(dialXml(calledE164));
}

export async function GET(req: Request): Promise<NextResponse> {
  const to = new URL(req.url).searchParams.get("To");
  return respond(toE164(to));
}

export async function POST(req: Request): Promise<NextResponse> {
  let to: string | null = null;
  try {
    const form = await req.formData();
    to = String(form.get("To") ?? "") || null;
  } catch { /* fall through — still dial */ }
  return respond(toE164(to));
}
```

- [ ] **Step 4: Run — PASS. Step 5: Commit**

```bash
git add apps/web/src/app/api/voice/texml
git commit -m "feat(voice): TeXML route — bridges to OpenAI SIP with the called number embedded"
```

---

### Task 12: `/api/voice/incoming` — webhook, tenant resolve, caps, accept, call lifecycle

**Files:**
- Create: `apps/web/src/app/api/voice/incoming/route.ts`
- Create: `apps/web/src/lib/voice/call-limits.ts`
- Test: `apps/web/src/app/api/voice/incoming/route.test.ts`, `apps/web/src/lib/voice/call-limits.test.ts`
- Modify: `apps/web/package.json` (add `openai@^6.46.0`, `ws@^8.21.0`, dev `@types/ws@^8.18.1` — run `pnpm --filter web add openai@^6.46.0 ws@^8.21.0` and `pnpm --filter web add -D @types/ws@^8.18.1`)

**Interfaces:**
- Consumes: everything above. Env: `OPENAI_API_KEY`, `OPENAI_WEBHOOK_SECRET`, optional `PHONE_*`.
- Produces: `POST` handler; `export const runtime = "nodejs"; export const maxDuration = 300;`

`call-limits.ts` (pure — ported decide logic, counts come from `@bis/db`):

```ts
export type LimitConfig = { perNumberPerDay: number; perAccountPerDay: number };
export type LimitVerdict = { allowed: true } | { allowed: false; reason: "per-number" | "per-account" };
export function readLimitConfig(env?: NodeJS.ProcessEnv): LimitConfig;   // PHONE_MAX_CALLS_PER_NUMBER_PER_DAY def 5, PHONE_MAX_CALLS_PER_ACCOUNT_PER_DAY def 50
export function decideLimit(counts: { forNumber: number; forAccount: number }, cfg: LimitConfig): LimitVerdict; // strictly-greater-than (the Nth call passes)
export function utcDayStart(now: Date): string;  // "YYYY-MM-DDT00:00:00.000Z"
```

Route flow (each numbered check has a test):

1. `OPENAI_WEBHOOK_SECRET`/`OPENAI_API_KEY` missing → 500 `{error:"server not configured"}` — zero queries.
2. `await req.text()` FIRST, then `new OpenAI({apiKey}).webhooks.unwrap(rawBody, req.headers, secret)`; failure → 400 `{error:"invalid signature"}`.
3. `event.type !== "realtime.call.incoming"` → 200 `{ok:true}`.
4. `callId = event.data.call_id`; `callerNumber = extractCallerNumber(event.data)`; `calledNumber = extractCalledNumber(event.data)`; log `{ callId, callerNumber, calledNumber, sipHeaderNames: sipHeaderNames(event.data) }` — **names, never values**; this log line IS the verify-first instrument for routing.
5. `!calledNumber` → log + 200 `{ok:true, declined:"unroutable"}`.
6. `serviceDb()`; `getPhoneNumberByE164` → null or status not in (`testing`,`live`) → 200 `{ok:true, declined:"unknown-number"}`.
7. `getVoiceProfile(accountId)` → null or `!enabled` → 200 `{ok:true, declined:"disabled"}`.
8. Caps: `countCallsSince(accountId, utcDayStart(now))` + (callerNumber ? `countCallsByCallerSince` : 0) — the started-at-accept rows make these see in-flight calls. Wrap BOTH counts in try/catch → **fail-open** (`{allowed:true}`); decline → 200 `{ok:true, declined: reason}`.
9. Load account context: one `accounts` select of `name, timezone, brand_name, brand_logo_path, brand_color, brand_neutral, brand_corners, brand_type, brand_mode, reply_to_email, from_email` (the `ACCOUNT_BRAND_COLS` shape from `packages/db/src/booking.ts:286` — import the accessor if exported, else select inline with an `.error` throw); `getOrCreateCalendar(db, accountId, "voice", "ai")`.
10. `startCallRow` in try/catch → `callRowId: string | null` (a DB blip must not lose the call — fail-open, finishCall falls back to alert-only recording).
11. Build `VoicePromptInput` (greeting: `languages === "es" ? greeting_es : greeting_en`, with a default of `` `Thanks for calling ${accountName}. How can I help you today?` `` when blank), `acceptCall(callId, buildRealtimeSessionConfig(input, now))` — flat body, `encodeURIComponent(callId)` in the URL; failure → log + 200.
12. `after(() => runCallLifecycle({...}))` → 200 `{ok:true}`.

`runCallLifecycle` (in the route file, ported shape): `new WebSocket(\`wss://api.openai.com/v1/realtime?call_id=${callId}\`, { headers: { Authorization: \`Bearer ${apiKey}\` } })`; greeting timer (`PHONE_GREETING_DELAY_MS` def 900) sends `response.create` with `instructions: \`Greet the caller with exactly: ${greeting}\``; cap timer (`PHONE_MAX_CALL_SECONDS` def 240) sends a wrap-up `response.create` then `ws.close()` after 5s; `message` handler: parse → `processCallEvent(state, toolCtx, event)` → reassign `state` → send actions; `close`/`error` → `finish(reason)`: idempotent (`settled` flag), clears all timers, `await finishCall(state, finishCtx, { callRowId, startedAt, endedAt: new Date() })`. State is a local `let state = emptyCallState()` — in-process, no store.

- [ ] **Step 1: Write `call-limits.ts` + tests first (pure, fast)** — cases: defaults; strictly-greater (5th call allowed, 6th declined); per-number reason wins over per-account; junk env → defaults.

- [ ] **Step 2: Write the route tests** — mock `@bis/db` (the Task-6 pattern: `getPhoneNumberByE164`, `getVoiceProfile`, `countCallsSince`, `countCallsByCallerSince`, `startCallRow`, `getOrCreateCalendar`, `serviceDb: () => ({...select chain for accounts...})`), mock `openai` (`vi.mock("openai", () => ({ default: class { webhooks = { unwrap: unwrapMock } } }))`), mock `ws`, mock `next/server`'s `after` to a pass-through recorder. Cases:
  - missing secret → 500, `unwrapMock` never called
  - bad signature (unwrap throws) → 400
  - non-call event → 200, no db calls
  - unroutable (no called number) → 200 `declined:"unroutable"`, no db calls
  - unknown number / released status → 200 `declined:"unknown-number"`
  - profile disabled → declined
  - caps: `countCallsByCallerSince` returning 6 with defaults → declined `per-number`; counts THROWING → call proceeds (fail-open — accept fetch mocked 200)
  - happy path: accept fetch called once with FLAT body (`body.session === undefined`, `body.tools` array present), `after` registered, response 200 `{ok:true}`
  - accept non-ok → still 200 (never 5xx OpenAI's webhook — it does not usefully retry)

  PLUS one **un-mocked signing test** in a separate file `apps/web/src/app/api/voice/incoming/webhook-signing.test.ts` that does NOT mock `openai`: construct a real payload and sign it per the documented standard-webhooks scheme (headers `webhook-id`/`webhook-timestamp`/`webhook-signature`; signed content `` `${id}.${timestamp}.${body}` ``; key = base64-decoded remainder of the `whsec_`-prefixed secret; signature `v1,` + base64 HMAC-SHA256), then assert `new OpenAI({apiKey:"sk-t"}).webhooks.unwrap(body, headers, secret)` resolves for the good signature and rejects for a tampered body. This is the CI-runnable webhook-simulation harness the spec §9 requires — it proves our signing assumptions against the real SDK with zero network. (Reference implementation of the signer: `bis-reception-demo/src/app/api/phone/incoming/route.test.ts:5-14`, read-only.)

- [ ] **Step 3: Run — FAIL. Step 4: Implement `call-limits.ts` and the route.** Follow the flow above exactly; keep `runCallLifecycle` in the route file (it is glue over tested seams). Header comment must carry: flat-accept-body contract, accept-returns-at-RINGING (greeting delay), fail-open rationale, and that this route + texml are the only two voice entry points.

- [ ] **Step 5: Run the full web suite + typecheck + build**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit && pnpm build`
Expected: all green; build must pass WITHOUT voice env vars set (no module-scope env reads outside handlers — `REALTIME_MODEL`'s module-scope read has a `|| "gpt-realtime"` fallback, which is safe).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/voice/incoming apps/web/src/lib/voice/call-limits.ts apps/web/src/lib/voice/call-limits.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(voice): incoming-call webhook — tenant resolve, caps, accept, call lifecycle"
```

---

### Task 13: Agency Voice settings page (v1 admin surface)

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/page.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/actions.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/voice-settings.tsx`
- Modify: `apps/web/src/lib/messages.ts` (new `voice.*` strings)
- Modify: the account sidebar nav (find the file that lists the account nav items — grep for the `calendar.title` message key usage or the `/calendar` href — and add a Voice item beside Calendar, **agency-only**: follow exactly how an existing agency-only item is gated there; if none is, gate in the page itself like below)
- Test: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/actions.test.ts`

**Interfaces:**
- Consumes: `getVoiceProfile`, `upsertVoiceProfile`, `assignPhoneNumber`, `setPhoneNumberStatus`, `getPhoneNumberByE164`, `toE164`.
- Produces server actions:

```ts
export async function saveVoiceProfileAction(accountId: string, formData: FormData):
  Promise<{ ok: true } | { ok: false; error: string }>;
export async function assignNumberAction(accountId: string, formData: FormData):
  Promise<{ ok: true } | { ok: false; error: string }>;   // fields: e164, telnyxId (optional)
export async function setNumberStatusAction(accountId: string, phoneNumberId: string, status: string):
  Promise<{ ok: true } | { ok: false; error: string }>;
```

**Guard rule (the M4d Critical):** the new tables have NO authenticated write grants, so `dbForRequest()` writes would fail for everyone while suites stay green. Every action: ① authenticate + verify AGENCY role the same way the branding actions do — **open `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/branding/actions.ts`, copy its exact auth/guard preamble** — ② then write via `serviceDb()`. E164 inputs pass `toE164` and reject null. Status must be one of the four; `live` requires a profile with a non-empty greeting or facts (an enabled line that knows nothing is a liability — return `{ok:false, error:"Fill in the voice profile before going live"}`).

Page: server component loading profile + numbers (via `serviceDb` reads after the same agency guard), rendering `voice-settings.tsx` (client) with: persona name, greeting EN/ES textareas, facts textarea, services, language select, booking toggle, after-hours select, enabled toggle, number assign form (e164 + telnyx id), per-number status select. Reuse the house form components (`SubmitButton`, the Card/Label/Input primitives the branding page uses — mirror its imports). Strings in `m` as `voice.title`, `voice.settings.*` etc., English, no milestone labels.

- [ ] **Step 1: Failing action tests.** FIRST open `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/branding/actions.ts` and note (a) the exact auth/guard preamble and (b) how its own test file mocks that guard — mirror both. Then (adjust the guard mock to what you found):

```ts
// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  upsertVoiceProfile: vi.fn(), assignPhoneNumber: vi.fn(),
  setPhoneNumberStatus: vi.fn(), getVoiceProfile: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}),
}));
// Guard mock: EXACTLY the module/shape the branding actions' test mocks.
// If branding uses e.g. Clerk's auth() + an app_role check, replicate that
// mock here verbatim, with a switchable "agency vs client" fixture.
// <mirror the branding actions.test.ts guard mock here>

import { saveVoiceProfileAction, assignNumberAction, setNumberStatusAction } from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  Object.values(dbMocks).forEach((m) => m.mockReset());
  dbMocks.getVoiceProfile.mockResolvedValue({ greeting_en: "Hi", facts: "stuff" });
  // <set the guard fixture to AGENCY here>
});

describe("voice settings actions", () => {
  it("a non-agency caller is rejected before any db call", async () => {
    // <set the guard fixture to CLIENT here>
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "Sofía" }));
    expect(r).toMatchObject({ ok: false });
    expect(dbMocks.upsertVoiceProfile).not.toHaveBeenCalled();
  });
  it("saves the profile through serviceDb accessors", async () => {
    dbMocks.upsertVoiceProfile.mockResolvedValue({});
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "Alex", greeting_en: "Hello", languages: "both" }));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.upsertVoiceProfile).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ persona_name: "Alex" }), expect.any(String));
  });
  it("rejects a non-E164-able number with no db call", async () => {
    const r = await assignNumberAction("a1", fd({ e164: "not-a-number" }));
    expect(r).toMatchObject({ ok: false });
    expect(dbMocks.assignPhoneNumber).not.toHaveBeenCalled();
  });
  it("normalizes and assigns a valid number", async () => {
    dbMocks.assignPhoneNumber.mockResolvedValue({ id: "pn1" });
    const r = await assignNumberAction("a1", fd({ e164: "(956) 555-0100", telnyxId: "uuid-1" }));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.assignPhoneNumber).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ e164: "+19565550100", telnyxId: "uuid-1" }), expect.any(String));
  });
  it("going live requires a filled profile", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ greeting_en: "", facts: "" });
    const r = await setNumberStatusAction("a1", "pn1", "live");
    expect(r).toMatchObject({ ok: false });
    expect(dbMocks.setPhoneNumberStatus).not.toHaveBeenCalled();
  });
  it("a normal status walk goes through", async () => {
    dbMocks.setPhoneNumberStatus.mockResolvedValue(undefined);
    const r = await setNumberStatusAction("a1", "pn1", "testing");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.setPhoneNumberStatus).toHaveBeenCalledWith({}, "a1", "pn1", "testing", expect.any(String));
  });
  it("an invalid status string is rejected", async () => {
    const r = await setNumberStatusAction("a1", "pn1", "banana");
    expect(r).toMatchObject({ ok: false });
    expect(dbMocks.setPhoneNumberStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement actions, page, client component, nav item, strings.**
- [ ] **Step 4: Run web suite + `pnpm build` — green. Step 5: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice" apps/web/src/lib/messages.ts <nav file>
git commit -m "feat(voice): agency Voice settings page — profile, number assignment, go-live gate"
```

---

### Task 14: Env, runbook, ledger, final gates

**Files:**
- Modify: `apps/web/.env.example` (if the repo's env example lives elsewhere, use that): add `OPENAI_API_KEY`, `OPENAI_WEBHOOK_SECRET`, `VOICE_OPENAI_PROJECT_ID`, `REALTIME_MODEL` (optional), `PHONE_*` (optional, documented defaults)
- Create: `docs/runbooks/voice-setup.md`
- Modify: `.superpowers/sdd/progress.md` (ledger)

- [ ] **Step 1: Write the runbook** — the owner (danlo) steps, in order, each with its verification:
  1. OpenAI: create a NEW project "BIS Platform Voice" → note project id (`proj_…`) → create an API key in it → project Settings → Webhooks → add endpoint `https://bis-platform-six.vercel.app/api/voice/incoming` for `realtime.call.incoming` → note the `whsec_…` secret.
  2. Vercel (bis-platform, Production): add `OPENAI_API_KEY` (Sensitive), `OPENAI_WEBHOOK_SECRET` (Sensitive), `VOICE_OPENAI_PROJECT_ID`. ⚠️ Vercel silently no-ops "Add New" on an existing name — Remove-then-Add. Redeploy after.
  3. Telnyx: create TeXML app "BIS Platform Voice" → Voice Method GET → webhook URL `https://bis-platform-six.vercel.app/api/voice/texml` → Inbound: enable OPUS codec → Outbound: attach the existing OVP.
  4. Buy a TEST number (any RGV local) → assign it to the new TeXML app (Numbers → Voice tab → Routing).
  5. Platform: account page → Voice → assign the number (E.164 + Telnyx id), fill the profile, status `testing`, enabled ON.
  6. **THE EXIT GATE — a real call:** call the test number. Verify in order: Sofía answers with the profile greeting · have a short conversation, ask a question from the facts, leave a message or book · hang up · **read the rows**: `calls` row (outcome, transcript, summary), contact + conversation with unread badge in the dashboard, staff alert email. Check the Vercel function logs for the `sipHeaderNames` line — record WHICH header carried the called number (x-bis-called expected).
  7. Booking leg: call again, book a slot, verify the booking on the Calendar page + confirmation email (if an email was given) + the slot vanishing from `/b/<publicId>`.
- [ ] **Step 2: Update `.env.example` with commented documentation per var.**
- [ ] **Step 3: Ledger entry in `.superpowers/sdd/progress.md`** summarizing tasks, deviations, and the exit-gate checklist status.
- [ ] **Step 4: Full gates from the repo root**

Run: `pnpm check && pnpm --filter web build`
Expected: typecheck 0 · lint 0 · db + web suites green (rerun known flakes alone) · build 0. Also run `pnpm --filter web test:e2e` if the suite exists in `package.json` — judge by wall clock (warm ≈ 2.1–2.6 min; two consecutive reds are still not proof).

- [ ] **Step 5: Commit**

```bash
git add apps/web/.env.example docs/runbooks/voice-setup.md
git commit -m "docs(voice): env vars + owner setup runbook with real-call exit gate"
```

---

## Post-plan verification notes (for the controller, not a task)

- **The real-call exit gate is the milestone gate.** Five reception bugs were invisible to green suites; nothing in this plan ships to a client until step 6-7 of the runbook has been walked and the rows read.
- The `sipHeaderNames` log line from the first real call settles spec verify-item #1. If `x-bis-called` does NOT appear in the names, the fallbacks (`to`, `diversion`) are already built; record which one fired in the ledger and keep both.
- Migration 0019 is applied ONCE during Task 1 and never again. 0016–0018 are never touched.
- No task modifies `bis-reception-demo`. If an implementer needs demo code, they READ it at `C:\Users\danlo\bis-reception-demo` and re-type it here.
