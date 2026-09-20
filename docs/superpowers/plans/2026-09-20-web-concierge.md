# Web Concierge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every CRM client a text assistant they can switch on for their own website — their persona, their branding, their leads in their CRM — reachable at an unguessable per-account address, bounded by a turn cap this repo has never needed before.

**Architecture:** A `<script>` on the client's site loads the existing `/embed.js`, which for `data-concierge` builds a floating launcher and a panel holding an iframe of `/c/<publicId>`. The public id resolves the tenant exactly as `/b/[publicId]` and `/f/[publicId]` already do; the chat page paints the client's brand and mints a render token. Each turn POSTs to `/api/concierge/[publicId]/turn`, which holds the transcript and the turn counter server-side — the browser can neither forge nor reset them — makes one Chat Completions call, and files a lead through the existing `enrich()` pipeline when the model calls `capture_lead`.

**Spec:** `docs/superpowers/specs/2026-09-20-web-concierge-design.md`. Read it before Task 1; it carries the reasoning this plan only executes.

**Tech Stack:** TypeScript, Next.js App Router route handlers + server components, Supabase/Postgres (migration + RLS + grants + one SQL function), OpenAI Chat Completions, vitest, Playwright.

## Global Constraints

- **Two branches, two PRs.** Tasks 1–4 on `feat/web-concierge` produce a working, shippable concierge at `/c/<publicId>` that files leads. Tasks 5–6 on `feat/web-concierge-embed`, cut from `main` after the first merges, produce the bubble and the product surface. Each branch is green on its own gates.
- **Text, not voice. Nothing in this plan touches the voice demo.** `SOFIA_WEB_NUMBER`, `lib/voice/web-demo.ts` and `api/voice/web/session/route.ts` are unchanged. Two surfaces, two jobs.
- **Nothing here claims to cap a session LENGTH.** Text bills per turn; there is no session to bound. No comment, copy or commit message may imply otherwise. (This is the constraint #101 was written under, and it survives because the medium changed, not because it was solved.)
- **Every cost check runs BEFORE the `fetch` to `api.openai.com`, and fails CLOSED.** A refused request must cost zero. The asymmetry with the silence guard is deliberate and stays commented: that guard failing open costs one call, this one failing open costs an unbounded number.
- **Grants are the security boundary, not the policy.** This project's default ACL auto-grants ALL privileges to `anon` AND `authenticated` on every new table (`0020_voice_grants_revoke.sql` exists because of exactly that; 0033 shipped without a grant block and still carries INSERT/UPDATE/DELETE to `anon`). The migration must `revoke all` then grant back only what is needed. Service-role only — `screened_calls`' shape.
- **Never store a raw IP.** `hashIp` (`apps/web/src/lib/forms/guards.ts:128`) is the only way an address reaches the database, and `clientIp` (`guards.ts:111`) carries the Vercel trust assumption. Both are already exported; import them, do not copy them.
- **Tokens only in any UI.** No hard-coded colours, radii or shadows. Renders in dark AND light through the app's `.dark` class, and with the `@supports not (backdrop-filter)` fallback. DESIGN.md's definition of done applies to Tasks 3, 5 and 6.
- **Copy passes the "landscaper at 7 AM" read.** Never expose milestone codes, carrier jargon or template syntax to a visitor.
- Gates run ONE AT A TIME, exit codes read from files: `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`. Before `pnpm check` and before e2e, run `gh run list --limit 3` and wait for any in-progress run — the db suite, the e2e suite, CI and production share ONE Supabase project.
- **Anything mutating in e2e runs on the per-run fixture account.** Never `Test Client One`, never a live account.
- **The orchestrator applies the migration, exactly once. An implementer never applies one.** Task 1 Step 3 halts deliberately and reports.
- Commit per task; do not push. Commit trailer, verbatim, on every commit:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01UuVS5XfWB6aZdX9b83RePF`

---

## File Structure

### Branch 1 — `feat/web-concierge`

- **Create** `packages/db/supabase/migrations/0042_web_concierge.sql` — three columns on `voice_profiles`, the `concierge_conversations` table, its indexes, RLS, grants, and `concierge_claim_turn`.
- **Create** `packages/db/src/concierge.ts` — every accessor for the new column set and table. Its own module rather than an addition to `voice.ts`: `voice.ts` is the phone path's data layer, and a website chat is deliberately not a call. Same reasoning that gave `voice-web-sessions.ts` its own file.
- **Create** `packages/db/src/test/concierge-grants.test.ts` — the per-table grants proof every new table gets.
- **Create** `packages/db/src/test/concierge.test.ts` — the accessors' own test. A grants test is not an accessors' test; without this file a swapped filter column ships green.
- **Modify** `packages/db/src/voice.ts` — `VoiceProfileRow` and `PROFILE_COLS` grow by three.
- **Modify** `packages/db/src/index.ts` — one additive export line.
- **Modify** `apps/web/src/lib/voice/session-config.ts` — `VoicePromptInput` gains an optional `medium`.
- **Modify** `apps/web/src/lib/voice/system-prompt.ts` — two sentences select on it.
- **Modify** `apps/web/src/lib/voice/system-prompt.test.ts` — the byte-identity proof.
- **Create** `apps/web/src/lib/concierge/guards.ts` — the caps and the turn-cap constants. Separate from `lib/forms/guards.ts`, which it imports: the forms constants are tuned for one-POST-is-one-interaction and must not be re-tuned under the form's feet.
- **Create** `apps/web/src/lib/concierge/strings.ts` — visitor-facing copy, en/es, modelled on `lib/forms/public-strings.ts`.
- **Create** `apps/web/src/lib/concierge/prompt.ts` — the concierge system prompt's web addendum and the `capture_lead` tool schema.
- **Create** `apps/web/src/lib/concierge/prompt.test.ts`.
- **Create** `apps/web/src/app/c/[publicId]/page.tsx` — the server-rendered chat page.
- **Create** `apps/web/src/app/c/[publicId]/concierge-chat.tsx` — the client component: message list, composer, all four states.
- **Create** `apps/web/src/app/c/[publicId]/concierge.css` — the page's own tokens-only styles, mirroring `f/[publicId]/form.css`'s role.
- **Create** `apps/web/src/app/api/concierge/[publicId]/turn/route.ts` — the turn endpoint.
- **Create** `apps/web/src/app/api/concierge/[publicId]/turn/route.test.ts`.
- **Create** `apps/web/e2e/concierge.spec.ts` — one full conversation to a filed lead, on the fixture account.

### Branch 2 — `feat/web-concierge-embed`

- **Modify** `apps/web/src/lib/forms/embed-script.ts` — the `data-concierge` branch.
- **Modify** `apps/web/src/lib/forms/embed-script.test.ts` — the new branch and the unchanged old ones.
- **Create** `apps/web/src/components/embed-snippet.tsx` — the shared component, extracted.
- **Modify** `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/embed-snippet.tsx` and `.../forms/[formId]/embed-snippet.tsx` — both move onto it.
- **Modify** `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/voice-settings.tsx` and `.../voice/page.tsx` — the Website assistant card.
- **Modify** `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/actions.ts` — the enable/disable action.
- **Modify** `apps/web/src/lib/palette/registry.ts` — `/voice` keywords.
- **Modify** `apps/web/src/lib/checklist-catalogue.ts` + `apps/web/src/lib/messages.ts` — the `concierge_embed` item.
- **Modify** `apps/web/src/app/(dashboard)/styleguide/page.tsx` — the launcher and message-bubble variants.

---

# Branch 1 — the working concierge

### Task 1: The schema, the accessors, and the grants proof

**Files:**
- Create: `packages/db/supabase/migrations/0042_web_concierge.sql`
- Create: `packages/db/supabase/migrations/0043_concierge_function_grants.sql` — **written and applied by the orchestrator**, not the implementer. 0042's `revoke all on function … from public` is not enough: this project's default privileges grant EXECUTE to `anon` and `authenticated` BY NAME on every new function, and a grant to a named role is not inherited from PUBLIC. Verified after applying 0042: the ACL still read `{postgres, anon, authenticated, service_role}`. Both files are already applied; the implementer neither writes nor applies either.
- Create: `packages/db/src/concierge.ts`
- Create: `packages/db/src/test/concierge-grants.test.ts`
- Create: `packages/db/src/test/concierge.test.ts`
- Modify: `packages/db/src/voice.ts:10-16` (`VoiceProfileRow`), `:38-41` (`PROFILE_COLS`)
- Modify: `packages/db/src/account-teardown.ts:19-27` (`ACCOUNT_OWNED_TABLES`)
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `withRollback`, `actAs` from `./db`; `withTestAccount` from `./fixtures`. **Read their real signatures before writing tests** — `withRollback(fn: (c: Client) => Promise<void>)` takes ONE argument, `actAs(c, claims)` mutates the pg session in place and returns nothing, and there is no chained Supabase-style client. The previous task in this repo lost a review round to a brief that invented these.
- Produces, for Tasks 3 and 4:
  ```ts
  export type ConciergeTurn = { role: "visitor" | "assistant"; text: string; at: string };

  /** A voice profile whose concierge is switched on AND has a destination
   *  form. Returns null otherwise — an address whose widget is off is a 404,
   *  not a broken chat. */
  export type ConciergeProfile = VoiceProfileRow & {
    public_id: string; concierge_form_id: string;
  };
  export function getVoiceProfileByPublicId(
    db: SupabaseClient, publicId: string,
  ): Promise<ConciergeProfile | null>;

  /** Mints `public_id` on first enable and keeps it stable thereafter.
   *  Returns the id the snippet must carry. */
  export function enableConcierge(
    db: SupabaseClient, accountId: string, formId: string,
  ): Promise<{ publicId: string }>;
  export function disableConcierge(db: SupabaseClient, accountId: string): Promise<void>;

  export type ConciergeConversationRow = {
    id: string; account_id: string; form_id: string; ip_hash: string;
    turn_count: number; transcript: ConciergeTurn[]; submission_id: string | null;
    locale: string; attribution: Record<string, string>; origin: string | null;
  };
  export function createConciergeConversation(
    db: SupabaseClient,
    input: { accountId: string; formId: string; ipHash: string; locale: string;
             attribution: Record<string, string>; origin: string | null },
  ): Promise<{ id: string }>;
  export function getConciergeConversation(
    db: SupabaseClient, id: string,
  ): Promise<ConciergeConversationRow | null>;
  /** The new turn number, or null when the cap is already reached. ATOMIC. */
  export function claimConciergeTurn(
    db: SupabaseClient, conversationId: string, max: number,
  ): Promise<number | null>;
  export function appendConciergeTurns(
    db: SupabaseClient, conversationId: string, turns: ConciergeTurn[],
  ): Promise<void>;
  export function setConciergeSubmission(
    db: SupabaseClient, conversationId: string, submissionId: string,
  ): Promise<void>;
  export function countConciergeConversationsByIp(
    db: SupabaseClient, ipHash: string, sinceIso: string,
  ): Promise<number>;
  export function countConciergeConversationsForAccount(
    db: SupabaseClient, accountId: string, sinceIso: string,
  ): Promise<number>;
  ```

- [ ] **Step 1: Write the migration**

Create `packages/db/supabase/migrations/0042_web_concierge.sql`:

```sql
-- The web concierge: a text assistant a client embeds on their OWN website.
--
-- Three columns on voice_profiles and one new table. The profile is where
-- this belongs because the persona already lives there — persona_name, both
-- greetings, facts, services, languages, after_hours. The widget speaks as
-- THAT business because it reads THAT row. See
-- docs/superpowers/specs/2026-09-20-web-concierge-design.md.

-- The address. NULLABLE and minted lazily by app code the first time the
-- concierge is switched on: newPublicId() (packages/db/src/forms.ts:54) is
-- 12 random bytes over an app-side alphabet, so no SQL default matches it,
-- and backfilling every profile would mint addresses for accounts that will
-- never use one. Postgres allows many nulls under a unique constraint.
alter table public.voice_profiles add column public_id text unique;

-- SEPARATE from `enabled`, which is the PHONE line. A client may want the
-- website assistant without the phone receptionist, or the reverse. This
-- joins booking_enabled and textback_enabled as a third per-feature switch.
alter table public.voice_profiles
  add column concierge_enabled boolean not null default false;

-- Which form a widget-captured lead files into. enrich() takes a FormRow and
-- form_submissions.form_id is NOT NULL, so there is no path into the CRM
-- without one — the operator chooses it, and the toggle cannot be switched
-- on until they have.
--
-- `set null`, NOT `restrict`: deleting a form must not be blocked by this
-- pointer, it must turn the widget off. A null here reads as "not
-- configured" and the route refuses — the fail-closed direction.
alter table public.voice_profiles
  add column concierge_form_id uuid references public.forms(id) on delete set null;

-- One row per visitor conversation.
--
-- WHY SERVER-SIDE AT ALL. The turn cap is the one guard this repo has never
-- needed: every existing limiter assumes one POST is one interaction (5 per
-- 10 minutes). A real conversation is ten turns in four minutes. A design
-- where the browser posts the transcript and the count each turn hands the
-- counter to the attacker — they reset it by not sending it. The transcript
-- lives here for the same reason: decision 1's whole premise is that the
-- typed conversation IS the lead's record, and a record the client holds is
-- not one.
--
-- WHY NOT A `calls` ROW. `calls` feeds ANSWERED_OUTCOMES and the weekly
-- report's "calls answered", a number a client reads on Monday morning. A
-- website chat is not a call. Same refusal, same reason, as
-- 0039_screened_calls.sql, 0040_call_proposals.sql and 0041.
--
-- WHY NOT A `conversations` ROW. That table is the OPERATOR's inbox thread,
-- and enrich() already opens one when a lead is filed. This is the
-- visitor-side conversation, which exists before and mostly without a lead.
create table public.concierge_conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- Captured at conversation START, not read per turn: an operator changing
  -- the destination form mid-conversation must not strand a lead halfway.
  -- `restrict` for 0006_forms.sql:39-41's stated reason — these carry leads,
  -- and deleting a form must never be able to destroy them.
  form_id uuid not null references public.forms(id) on delete restrict,
  -- HMAC-keyed, never the raw address (forms/guards.ts's hashIp).
  ip_hash text not null,
  -- The cap's counter. Claimed atomically by concierge_claim_turn below,
  -- never read-then-written.
  turn_count int not null default 0,
  -- [{role, text, at}] — the same shape as calls.transcript's
  -- TranscriptEvent, so one reader renders both.
  transcript jsonb not null default '[]'::jsonb,
  -- Set once, when capture_lead first succeeds. Its non-null-ness is what
  -- stops a second submission for the same visitor.
  submission_id uuid references public.form_submissions(id) on delete set null,
  locale text not null default 'en',
  attribution jsonb not null default '{}'::jsonb,
  -- Which site the frame was embedded on. Nullable: Origin is a browser
  -- courtesy, not a guarantee.
  origin text,
  created_at timestamptz not null default now(),
  last_turn_at timestamptz not null default now()
);

-- The two counters the route reads before starting a conversation.
create index concierge_conversations_ip_idx
  on public.concierge_conversations (ip_hash, created_at desc);
create index concierge_conversations_account_idx
  on public.concierge_conversations (account_id, created_at desc);

-- THE TURN CLAIM, ATOMIC.
-- Read-then-write loses the race: two turns posted together both read N and
-- both write N+1, and the cap leaks. One statement cannot. Returns the new
-- count, or no row at all when the cap is already reached. Precedent:
-- increment_conversation_unread, called through db.rpc at
-- packages/db/src/messaging.ts:498.
create function public.concierge_claim_turn(p_conversation_id uuid, p_max int)
returns int language sql as $fn$
  update public.concierge_conversations
     set turn_count = turn_count + 1, last_turn_at = now()
   where id = p_conversation_id and turn_count < p_max
  returning turn_count;
$fn$;

-- ⚠️ THE GRANTS ARE THE SECURITY BOUNDARY HERE, NOT THE POLICY.
-- This project's default ACL auto-grants ALL privileges to `anon` AND
-- `authenticated` on every new table (0020_voice_grants_revoke.sql exists
-- because of exactly this; 0033 shipped without a grant block and still
-- carries INSERT/UPDATE/DELETE to `anon`). Revoke everything, then grant
-- back only what is needed.
--
-- Nothing but the concierge route reads or writes this, and the route uses
-- serviceDb(). So: service_role only, no `authenticated` grant at all — the
-- same shape as screened_calls and voice_web_sessions, narrower than
-- call_proposals, which a human reviews in the UI. No policy is needed for
-- service_role (it bypasses RLS); RLS is enabled anyway so the table is
-- never accidentally world-readable if a grant is ever widened.
alter table public.concierge_conversations enable row level security;
revoke all on public.concierge_conversations from anon, authenticated;
grant select, insert, update, delete on public.concierge_conversations to service_role;

-- The function runs as its caller, so it needs no elevated privilege; revoke
-- the default PUBLIC execute so only service_role can reach it.
revoke all on function public.concierge_claim_turn(uuid, int) from public;
grant execute on function public.concierge_claim_turn(uuid, int) to service_role;
```

- [ ] **Step 2: Write the failing grants test**

Create `packages/db/src/test/concierge-grants.test.ts`. Model it on
`packages/db/src/test/voice-web-sessions-grants.test.ts` — read that file first
and copy its shape, including the per-process `RUN` suffix for `clerk_org_id`
(that column is `unique` on the ONE Supabase project this suite shares with
production, so two concurrent runs would block each other without it).

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

const RUN = Math.random().toString(36).slice(2, 10);
const orgId = (label: string) => `org_CC_${label}_${RUN}`;

async function seedAccount(c: Client, org: string): Promise<string> {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const { rows: [account] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Fixture CC',true) returning id",
    [agency.id, org],
  );
  return account.id as string;
}

describe("concierge_conversations grants", () => {
  // EXISTENCE FIRST, and not as ceremony: "no rows in role_table_grants" is
  // also true of a table that was never created, so without this the whole
  // file is vacuously green before the migration is applied.
  it("the table exists (guards every assertion below from vacuity)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ oid: string | null }>(
        `select to_regclass('public.concierge_conversations')::text as oid`,
      );
      expect(rows[0]!.oid?.replace(/^public\./, "")).toBe("concierge_conversations");
    }));

  it("grants exactly {postgres, service_role} and nothing to anon or authenticated", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ grantee: string }>(
        `select distinct grantee from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'concierge_conversations'`,
      );
      const grantees = rows.map((r) => r.grantee).sort();
      expect(grantees).toEqual(["postgres", "service_role"]);
    }));

  it("has RLS on with zero policies (deny-all for anything but service_role)", () =>
    withRollback(async (c) => {
      const { rows: [rls] } = await c.query<{ relrowsecurity: boolean }>(
        `select relrowsecurity from pg_class where oid = 'public.concierge_conversations'::regclass`,
      );
      expect(rls!.relrowsecurity).toBe(true);
      const { rows: policies } = await c.query(
        `select 1 from pg_policies where schemaname='public' and tablename='concierge_conversations'`,
      );
      expect(policies).toHaveLength(0);
    }));

  // ⚠️ `actAs(c, { app_role: "agency_admin" })`, NEVER `actAsOwner` — that
  // one does `reset role`, making the connection the TABLE OWNER, which
  // bypasses grants entirely and passes for a reason unrelated to the
  // property under test. screened-calls-grants.test.ts makes the same point
  // in its own comment.
  //
  // And the assertion is on 42501 specifically, not "an error": 42P01
  // (relation does not exist) and a schema-cache miss look identical to a
  // passing deny, which is how a grants test goes green against a table that
  // was never created.
  for (const role of ["authenticated", "agency_admin"] as const) {
    it(`a ${role} session cannot select (privilege error 42501, not merely an error)`, () =>
      withRollback(async (c) => {
        const org = orgId(role);
        await seedAccount(c, org);
        await actAs(c, role === "agency_admin"
          ? { org_id: org, app_role: "agency_admin" }
          : { org_id: org });
        await expect(
          c.query("select id from public.concierge_conversations limit 1"),
        ).rejects.toMatchObject({ code: "42501" });
      }));

    it(`a ${role} session cannot insert (privilege error 42501)`, () =>
      withRollback(async (c) => {
        const org = orgId(`${role}_ins`);
        const accountId = await seedAccount(c, org);
        await actAs(c, role === "agency_admin"
          ? { org_id: org, app_role: "agency_admin" }
          : { org_id: org });
        await expect(
          c.query(
            `insert into public.concierge_conversations (account_id, form_id, ip_hash)
             values ($1, gen_random_uuid(), 'x')`,
            [accountId],
          ),
        ).rejects.toMatchObject({ code: "42501" });
      }));
  }

  it("concierge_claim_turn is not executable by anon or authenticated", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ grantee: string }>(
        `select distinct grantee from information_schema.role_routine_grants
          where routine_schema = 'public' and routine_name = 'concierge_claim_turn'`,
      );
      expect(rows.map((r) => r.grantee).sort()).toEqual(["postgres", "service_role"]);
    }));

  it("the three voice_profiles columns exist with the intended nullability", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable from information_schema.columns
          where table_schema='public' and table_name='voice_profiles'
            and column_name in ('public_id','concierge_enabled','concierge_form_id')
          order by column_name`,
      );
      expect(rows).toEqual([
        { column_name: "concierge_enabled", is_nullable: "NO" },
        { column_name: "concierge_form_id", is_nullable: "YES" },
        { column_name: "public_id", is_nullable: "YES" },
      ]);
    }));
});
```

- [ ] **Step 3: Run the grants test to verify it fails, then HALT and report**

Run: `pnpm --filter @bis/db test -- concierge-grants`
Expected: RED. The existence test fails with `expected undefined to be "concierge_conversations"` — the table does not exist yet.

**Do not apply the migration.** Report to the orchestrator: the migration file
is written, the grants test is RED for the right reason, and the migration is
ready to apply. Paste the RED transcript. Stop here and wait.

- [ ] **Step 4: (After the orchestrator applies the migration) write the accessors**

Create `packages/db/src/concierge.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { newPublicId } from "./forms";
import type { VoiceProfileRow } from "./voice";

/** One side of one exchange. Same shape as `calls.transcript`'s
 *  TranscriptEvent, so one reader renders both. */
export type ConciergeTurn = { role: "visitor" | "assistant"; text: string; at: string };

export type ConciergeProfile = VoiceProfileRow & {
  public_id: string; concierge_form_id: string;
};

const PROFILE_CONCIERGE_COLS =
  "id, account_id, persona_name, greeting_en, greeting_es, facts, services, " +
  "languages, booking_enabled, after_hours, enabled, textback_enabled, textback_body, " +
  "public_id, concierge_enabled, concierge_form_id";

/**
 * The tenant seam, third instance of the pattern `/b/[publicId]` and
 * `/f/[publicId]` already use: the public id IS the authorisation to talk —
 * no accountId, no auth, on purpose.
 *
 * Returns null unless the concierge is switched ON and HAS a destination
 * form. An address that resolves to a profile whose widget is off must 404,
 * not open a chat that cannot file anything. Both conditions are in the
 * query rather than checked by the caller, so a second caller cannot forget
 * one.
 */
export async function getVoiceProfileByPublicId(
  db: SupabaseClient, publicId: string,
): Promise<ConciergeProfile | null> {
  const { data, error } = await db.from("voice_profiles")
    .select(PROFILE_CONCIERGE_COLS)
    .eq("public_id", publicId)
    .eq("concierge_enabled", true)
    .not("concierge_form_id", "is", null)
    .maybeSingle();
  if (error) throw new Error(`getVoiceProfileByPublicId failed: ${error.message}`);
  return (data as ConciergeProfile | null) ?? null;
}

/**
 * Switches the concierge on and returns the address the snippet must carry.
 *
 * The public id is minted ONCE and kept: re-enabling after a disable must
 * not change the address, or every snippet already pasted on a client's
 * website silently stops working. So the mint is conditional on the current
 * value, read first.
 */
export async function enableConcierge(
  db: SupabaseClient, accountId: string, formId: string,
): Promise<{ publicId: string }> {
  const { data: existing, error: readErr } = await db.from("voice_profiles")
    .select("public_id").eq("account_id", accountId).maybeSingle();
  if (readErr) throw new Error(`enableConcierge read failed: ${readErr.message}`);
  if (!existing) throw new Error("enableConcierge failed: no voice profile for this account");

  const publicId = (existing as { public_id: string | null }).public_id ?? newPublicId();
  const { error } = await db.from("voice_profiles")
    .update({ public_id: publicId, concierge_enabled: true, concierge_form_id: formId })
    .eq("account_id", accountId);
  if (error) throw new Error(`enableConcierge failed: ${error.message}`);
  return { publicId };
}

/** Switches it off WITHOUT clearing `public_id` — see enableConcierge. */
export async function disableConcierge(
  db: SupabaseClient, accountId: string,
): Promise<void> {
  const { error } = await db.from("voice_profiles")
    .update({ concierge_enabled: false }).eq("account_id", accountId);
  if (error) throw new Error(`disableConcierge failed: ${error.message}`);
}

export type ConciergeConversationRow = {
  id: string; account_id: string; form_id: string; ip_hash: string;
  turn_count: number; transcript: ConciergeTurn[]; submission_id: string | null;
  locale: string; attribution: Record<string, string>; origin: string | null;
};

const CONVO_COLS =
  "id, account_id, form_id, ip_hash, turn_count, transcript, submission_id, " +
  "locale, attribution, origin";

export async function createConciergeConversation(
  db: SupabaseClient,
  input: { accountId: string; formId: string; ipHash: string; locale: string;
           attribution: Record<string, string>; origin: string | null },
): Promise<{ id: string }> {
  const { data, error } = await db.from("concierge_conversations").insert({
    account_id: input.accountId, form_id: input.formId, ip_hash: input.ipHash,
    locale: input.locale, attribution: input.attribution, origin: input.origin,
  }).select("id").single();
  if (error || !data) throw new Error(`createConciergeConversation failed: ${error?.message}`);
  return { id: data.id as string };
}

export async function getConciergeConversation(
  db: SupabaseClient, id: string,
): Promise<ConciergeConversationRow | null> {
  const { data, error } = await db.from("concierge_conversations")
    .select(CONVO_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(`getConciergeConversation failed: ${error.message}`);
  return (data as ConciergeConversationRow | null) ?? null;
}

/**
 * Claims one turn. Returns the new count, or NULL when the cap is already
 * reached.
 *
 * Atomic on purpose: two turns posted together would both read N and both
 * write N+1 under a read-then-write, and the cap would leak. The SQL
 * function does it in one statement.
 */
export async function claimConciergeTurn(
  db: SupabaseClient, conversationId: string, max: number,
): Promise<number | null> {
  const { data, error } = await db.rpc("concierge_claim_turn", {
    p_conversation_id: conversationId, p_max: max,
  });
  if (error) throw new Error(`claimConciergeTurn failed: ${error.message}`);
  return (data as number | null) ?? null;
}

/**
 * Appends to the stored transcript. Read-modify-write is acceptable here and
 * nowhere else in this module: turns within ONE conversation are serialized
 * by `claimConciergeTurn`, which has already refused the concurrent second
 * turn before this is ever reached.
 */
export async function appendConciergeTurns(
  db: SupabaseClient, conversationId: string, turns: ConciergeTurn[],
): Promise<void> {
  const current = await getConciergeConversation(db, conversationId);
  if (!current) throw new Error("appendConciergeTurns failed: conversation not found");
  const { error } = await db.from("concierge_conversations")
    .update({ transcript: [...current.transcript, ...turns] })
    .eq("id", conversationId);
  if (error) throw new Error(`appendConciergeTurns failed: ${error.message}`);
}

/** Records the one submission this conversation produced. The `is` filter is
 *  the guard: a second capture_lead finds no row to update and writes
 *  nothing, so one visitor can never become two leads. */
export async function setConciergeSubmission(
  db: SupabaseClient, conversationId: string, submissionId: string,
): Promise<void> {
  const { error } = await db.from("concierge_conversations")
    .update({ submission_id: submissionId })
    .eq("id", conversationId).is("submission_id", null);
  if (error) throw new Error(`setConciergeSubmission failed: ${error.message}`);
}

/** Conversations STARTED by this hashed IP since `sinceIso`. */
export async function countConciergeConversationsByIp(
  db: SupabaseClient, ipHash: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("concierge_conversations")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash).gte("created_at", sinceIso);
  if (error) throw new Error(`countConciergeConversationsByIp failed: ${error.message}`);
  return count ?? 0;
}

/** Conversations started against this account since `sinceIso`. The
 *  per-tenant ceiling: one client's public page must not spend alone. */
export async function countConciergeConversationsForAccount(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("concierge_conversations")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).gte("created_at", sinceIso);
  if (error) throw new Error(`countConciergeConversationsForAccount failed: ${error.message}`);
  return count ?? 0;
}
```

Then modify `packages/db/src/voice.ts`. `VoiceProfileRow` gains three fields:

```ts
export type VoiceProfileRow = {
  id: string; account_id: string; persona_name: string;
  greeting_en: string; greeting_es: string; facts: string; services: string;
  languages: "en" | "es" | "both"; booking_enabled: boolean;
  after_hours: "hours_then_message" | "message_only"; enabled: boolean;
  textback_enabled: boolean; textback_body: string;
  public_id: string | null; concierge_enabled: boolean;
  concierge_form_id: string | null;
};
```

and `PROFILE_COLS` grows to match, or every existing reader gets `undefined`
for the three new fields:

```ts
const PROFILE_COLS =
  "id, account_id, persona_name, greeting_en, greeting_es, facts, services, " +
  "languages, booking_enabled, after_hours, enabled, textback_enabled, textback_body, " +
  "public_id, concierge_enabled, concierge_form_id";
```

Add to `packages/db/src/index.ts`, beside the `voice-web-sessions` line:

```ts
export * from "./concierge";
```

**And add the table to `ACCOUNT_OWNED_TABLES`** (`packages/db/src/account-teardown.ts:19-27`), immediately before `"form_submissions"`:

```ts
export const ACCOUNT_OWNED_TABLES = [
  "site_traffic_breakdown", "site_traffic_daily", "sites",
  "calls", "bookings", "calendars", "events",
  "concierge_conversations", "form_submissions", "forms",
  ...
```

This is NOT optional and it is not the same case as `voice_web_sessions`,
which was deliberately left off. That table's only FK to owned data is
`account_id … on delete cascade`, which puts it in the documented exempt class
alongside `screened_calls`. `concierge_conversations` has a second FK —
`form_id … on delete restrict` — and `forms` IS on this list and is deleted by
the loop long before `accounts` itself. Left off, teardown fails with "cleanup
failed on forms", which that file's own comment predicts: *"A table added with
the usual `restrict` and left off the list is a different story and still a
bug."* It surfaces as a teardown error in `withTestAccount`, i.e. in Step 5's
own fixtures rather than in an assertion, which is the confusing way to find it.

`submission_id … on delete set null` needs no ordering of its own — nulling is
not blocked — so before `"form_submissions"` is a tidy position, not a required
one. `"forms"` is the constraint.

- [ ] **Step 5: Write the accessors' own test**

A grants test is not an accessors' test. Proving the ROW is protected says
nothing about whether the FUNCTION reads the right column — swap two `.eq()`
columns and every grants test still passes. Create
`packages/db/src/test/concierge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";
import { createForm } from "../forms";
import {
  enableConcierge, disableConcierge, getVoiceProfileByPublicId,
  createConciergeConversation, getConciergeConversation, claimConciergeTurn,
  appendConciergeTurns, setConciergeSubmission,
  countConciergeConversationsByIp, countConciergeConversationsForAccount,
} from "../concierge";

describe("concierge accessors", () => {
  it("enableConcierge mints a public id, and re-enabling keeps the SAME one", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const first = await enableConcierge(db, accountId, form.id);
      // `newPublicId`'s ALPHABET is "abcdefghijkmnpqrstuvwxyz23456789"
      // (forms.ts:52) — lowercase only, no `l`, no `o`, digits 2-9. A looser
      // /^[A-Za-z0-9]{12}$/ is a superset that would pass for an id this
      // function cannot produce.
      expect(first.publicId).toMatch(/^[a-km-z2-9]{12}$/);
      await disableConcierge(db, accountId);
      const second = await enableConcierge(db, accountId, form.id);
      // MUTATION: drop the `?? newPublicId()` guard and always mint —
      // this FAILS, because every snippet already on a client's site would
      // have silently stopped working.
      expect(second.publicId).toBe(first.publicId);
    }));

  it("getVoiceProfileByPublicId returns null when the concierge is OFF", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { publicId } = await enableConcierge(db, accountId, form.id);
      expect(await getVoiceProfileByPublicId(db, publicId)).not.toBeNull();
      await disableConcierge(db, accountId);
      // MUTATION: drop `.eq("concierge_enabled", true)` — this FAILS.
      expect(await getVoiceProfileByPublicId(db, publicId)).toBeNull();
    }));

  it("getVoiceProfileByPublicId returns null when no destination form is set", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { publicId } = await enableConcierge(db, accountId, form.id);
      await db.from("voice_profiles")
        .update({ concierge_form_id: null }).eq("account_id", accountId);
      // MUTATION: drop `.not("concierge_form_id", "is", null)` — this FAILS.
      expect(await getVoiceProfileByPublicId(db, publicId)).toBeNull();
    }));

  it("claimConciergeTurn counts up and returns null at the cap", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { id } = await createConciergeConversation(db, {
        accountId, formId: form.id, ipHash: "aaa", locale: "en",
        attribution: {}, origin: null,
      });
      expect(await claimConciergeTurn(db, id, 2)).toBe(1);
      expect(await claimConciergeTurn(db, id, 2)).toBe(2);
      // MUTATION: change the SQL's `turn_count < p_max` to `<=` — this FAILS.
      expect(await claimConciergeTurn(db, id, 2)).toBeNull();
    }));

  it("two concurrent claims at the boundary yield exactly one success", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { id } = await createConciergeConversation(db, {
        accountId, formId: form.id, ipHash: "bbb", locale: "en",
        attribution: {}, origin: null,
      });
      const results = await Promise.all([
        claimConciergeTurn(db, id, 1), claimConciergeTurn(db, id, 1),
      ]);
      // MUTATION: replace the SQL function with a read-then-write pair in
      // the accessor — this FAILS intermittently, which is why the cap is
      // one statement.
      expect(results.filter((r) => r !== null)).toHaveLength(1);
    }));

  it("appendConciergeTurns appends rather than replacing", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { id } = await createConciergeConversation(db, {
        accountId, formId: form.id, ipHash: "ccc", locale: "en",
        attribution: {}, origin: null,
      });
      await appendConciergeTurns(db, id, [
        { role: "visitor", text: "hi", at: new Date().toISOString() },
      ]);
      await appendConciergeTurns(db, id, [
        { role: "assistant", text: "hello", at: new Date().toISOString() },
      ]);
      const row = await getConciergeConversation(db, id);
      // MUTATION: drop the spread and write `turns` alone — this FAILS.
      expect(row!.transcript.map((t) => t.text)).toEqual(["hi", "hello"]);
    }));

  it("setConciergeSubmission writes once and ignores a second capture", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const { id } = await createConciergeConversation(db, {
        accountId, formId: form.id, ipHash: "ddd", locale: "en",
        attribution: {}, origin: null,
      });
      const { data: s1 } = await db.from("form_submissions")
        .insert({ account_id: accountId, form_id: form.id }).select("id").single();
      const { data: s2 } = await db.from("form_submissions")
        .insert({ account_id: accountId, form_id: form.id }).select("id").single();
      await setConciergeSubmission(db, id, s1!.id);
      await setConciergeSubmission(db, id, s2!.id);
      // MUTATION: drop `.is("submission_id", null)` — this FAILS, and one
      // visitor becomes two leads.
      expect((await getConciergeConversation(db, id))!.submission_id).toBe(s1!.id);
    }));

  // The ordering proof, as a pure assertion with no DB in it so it cannot be
  // flaky or vacuous. The other tests in this file prove it a second way,
  // implicitly: each creates a conversation and lets withTestAccount tear the
  // account down, which throws "cleanup failed on forms" if the ordering is
  // wrong. MUTATION: move the entry after "forms" — this FAILS.
  it("is torn down before forms, which its restrict FK points at", () => {
    const i = ACCOUNT_OWNED_TABLES.indexOf("concierge_conversations");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(ACCOUNT_OWNED_TABLES.indexOf("forms"));
  });

  // BOTH SIDES OF BOTH FILTERS. A counter tested against a table holding
  // only its own rows cannot fail a swapped filter column.
  it("the counters filter on the right column and the right window", () =>
    withTestAccount(async (db, accountId) => {
      const form = await createForm(db, accountId, { name: "Leads" }, accountId);
      const mine = { accountId, formId: form.id, locale: "en",
                     attribution: {}, origin: null };
      await createConciergeConversation(db, { ...mine, ipHash: "mine" });
      await createConciergeConversation(db, { ...mine, ipHash: "theirs" });
      const old = await createConciergeConversation(db, { ...mine, ipHash: "mine" });
      await db.from("concierge_conversations")
        .update({ created_at: "2020-01-01T00:00:00Z" }).eq("id", old.id);

      const since = new Date(Date.now() - 600_000).toISOString();
      // MUTATION: swap `ip_hash` for `account_id` in the by-IP counter — it
      // would return 3 here, not 1.
      expect(await countConciergeConversationsByIp(db, "mine", since)).toBe(1);
      // MUTATION: drop the `.gte("created_at", …)` — it would return 3.
      expect(await countConciergeConversationsForAccount(db, accountId, since)).toBe(2);
    }));
});
```

- [ ] **Step 6: Run both suites to verify they pass**

Run: `pnpm --filter @bis/db test -- concierge`
Expected: PASS, both files, every test.

Then run the mutations named in the comments above, one at a time, reverting
each before the next, and paste the RED transcript for each. After the last
revert, run `git diff` on `packages/db/src/concierge.ts` and
`packages/db/supabase/migrations/0042_web_concierge.sql` and confirm it prints
nothing — no mutation may leak into the commit.

- [ ] **Step 7: Commit**

```bash
git add packages/db/supabase/migrations/0042_web_concierge.sql packages/db/src/concierge.ts packages/db/src/test/concierge-grants.test.ts packages/db/src/test/concierge.test.ts packages/db/src/voice.ts packages/db/src/index.ts
git commit -m "$(cat <<'EOF'
Give the voice profile an address, a switch, and a place to file a lead

0042 adds voice_profiles.public_id (minted lazily), concierge_enabled
(separate from the phone line's `enabled`) and concierge_form_id, plus the
concierge_conversations table that holds the transcript and the turn counter
server-side. The turn claim is one SQL statement because read-then-write
leaks the cap under concurrency.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UuVS5XfWB6aZdX9b83RePF
EOF
)"
```

### Task 1 — revisions after review (these GOVERN over the code blocks above)

The review of `f62605d` found one Critical and six Important issues. Two were
plan-mandated — that is, my plan text was wrong, not a deliberate choice — and
the corrections below serve the spec's own constraints rather than contradicting
them. Migration **`0044_concierge_atomic_writes.sql` is already written and
applied by the orchestrator**; no implementer writes or applies a migration.

1. **`VoiceProfileRow` is a cross-package type and only one side was changed.**
   Widening it breaks `apps/web`'s typecheck, so `pnpm check` — which CI's
   `verify` job runs and the `main` ruleset requires — is RED at `f62605d`.
   `DEFAULT_PROFILE` in `.../voice/voice-settings.tsx` and `PROFILE` in
   `.../voice/page.test.ts` must gain `public_id: null`,
   `concierge_enabled: false`, `concierge_form_id: null`, in the same commit
   that widens the type. **Whenever a task widens a shared type, its own commit
   fixes every consumer** — leaving it to a later task means the gate is red in
   between.

2. **`appendConciergeTurns` becomes `db.rpc("concierge_append_turns", …)`.**
   My comment claimed `claimConciergeTurn` serialises turns within a
   conversation. **That is false at every cap above 1.** The claim refuses only
   at `turn_count >= p_max`; below the cap two concurrent POSTs both succeed
   (the second blocks on the row lock, re-reads `1 < 24`, returns 2), both read
   the same transcript, and the later write replaces the earlier — an exchange
   vanishes with no error. The 0042 test passed only because it used `max = 1`,
   the one value at which the claim holds. 0044's function does
   `transcript = transcript || p_turns` in one statement and returns the new
   length, so a test can tell an append from a replace. Delete the false
   comment; do not soften it.

3. **`enableConcierge` becomes `db.rpc("concierge_enable", …)`.** The old shape
   read, minted in JS, wrote, and returned **its own mint rather than what the
   row holds**. Two concurrent enables each get a different id while the row
   keeps one, so the losing snippet points at a `/c/<publicId>` that resolves to
   nothing forever. The unique index cannot catch it — both statements target
   the same row. 0044's `coalesce(public_id, p_new_public_id)` mints only when
   there is nothing to keep and `returning` hands back the stored value. It
   returns **null when the account has no `voice_profiles` row**, which is a
   real state, not an error — see revision 7.

4. **`setConciergeSubmission` returns `Promise<boolean>`** — true when it
   claimed the slot — and throws when zero rows matched but the conversation
   exists. A zero-row update was indistinguishable from success, and this repo
   already has the precedent three functions away: `setPhoneNumberTelnyxId`
   (`packages/db/src/voice.ts:125-129`) does `.select("id")` and throws
   `"matched no row"`. **`disableConcierge` gets the same treatment** — today it
   reports success for an account with no profile row.

5. **`PROFILE_COLS` is exported from `voice.ts` and reused.**
   `PROFILE_CONCIERGE_COLS` was a character-identical copy, and the `as
   ConciergeProfile` cast hides the drift: add a fourth column — exactly what
   this task just did — and the concierge query silently returns a row missing
   it, typed as present, with no type error and no failing test.

6. **The counters test seeds a SECOND account** (a nested `withTestAccount`,
   never a bare `createAccount` outside a try) and asserts the by-account count
   ignores it. Every row belonged to one account, so dropping
   `.eq("account_id", …)` left the test green — the live table is empty outside
   a run, so the mutant returns the same number. That filter is the per-tenant
   cost ceiling: counting globally would let one account's traffic throttle
   every other client's widget, cross-tenant, with no error anywhere.
   The `ip_hash` literals also take the grants test's per-process `RUN` suffix
   — `countConciergeConversationsByIp` is deliberately not account-scoped, so
   `toBe(1)` is an assertion about the whole table on the project shared with
   production, and two overlapping runs each see 2.
   ⚠️ The mutation "swap `ip_hash` for `account_id`" is **not constructible** —
   the column is `uuid` and the swap throws a cast error first. The prescribed
   mutation is **drop `.eq("ip_hash", ipHash)`**.

7. **For Tasks 5 and 6:** an account that has never saved voice settings has NO
   `voice_profiles` row (`voice-settings.tsx:20-23` documents this), so
   `concierge_enable` returns null. The Website-assistant card must render that
   as a stated reason — "set up the assistant's persona first" — not an
   unhandled throw. This is correct behaviour, not a gap: there is no persona to
   embed yet.

8. **Test commands in this plan were wrong where they said
   `pnpm --filter web test --` followed by a pattern.** That does not scope; it
   runs all 213 files, because the `--` reaches vitest as a passthrough
   separator rather than a filter. The scoping form is
   **`pnpm --filter web exec vitest run <pattern>`**
   (measured: 1 file, 22 tests, 396ms). Use `exec` everywhere below.

9. Step 7's `git add` list omits `account-teardown.ts`, which Step 4 mandates,
   and the two `apps/web` files from revision 1. Add all three.

---

### Task 2: One Sofía, two mediums

The prompt is phone-shaped and the web demo never fixed it: it appends a notice
saying the conversation is on the website while the base text still says "You
are {persona}, the **phone receptionist**" (`system-prompt.ts:30`) and "This is
a **phone call**" (`:46`). The concierge does not inherit that contradiction.

**Files:**
- Modify: `apps/web/src/lib/voice/session-config.ts:10-26` (`VoicePromptInput`)
- Modify: `apps/web/src/lib/voice/system-prompt.ts:30,46`
- Modify: `apps/web/src/lib/voice/system-prompt.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces, for Task 4: `VoicePromptInput` gains `medium?: "phone" | "web"`,
  defaulting to `"phone"`. `buildSystemPrompt(input, now)` is otherwise unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/lib/voice/system-prompt.test.ts`:

```ts
import { buildSystemPrompt } from "./system-prompt";
import type { VoicePromptInput } from "./session-config";

const BASE: VoicePromptInput = {
  personaName: "Sofía", businessName: "956 Woodworks", greeting: "Hi!",
  facts: "We build custom furniture.", services: "Tables, cabinets",
  languages: "both", bookingEnabled: false, timezone: "America/Chicago",
  slotDurationMinutes: 30, afterHours: "message_only",
  callerNumber: null, meetingType: "in_person",
};
const NOW = new Date("2026-09-20T15:00:00Z");

describe("buildSystemPrompt medium", () => {
  // THE PROPERTY THAT MATTERS MOST: every existing caller passes no `medium`
  // at all, and their prompt must not move by one byte. A prompt change is a
  // behaviour change on a live phone line.
  it("is byte-identical when no medium is given and when medium is phone", () => {
    expect(buildSystemPrompt({ ...BASE, medium: "phone" }, NOW))
      .toBe(buildSystemPrompt(BASE, NOW));
  });

  it("says phone receptionist and phone call by default", () => {
    const p = buildSystemPrompt(BASE, NOW);
    expect(p).toContain("the phone receptionist for 956 Woodworks");
    expect(p).toContain("This is a phone call");
  });

  it("says neither of those on the web", () => {
    const p = buildSystemPrompt({ ...BASE, medium: "web" }, NOW);
    expect(p).not.toContain("phone receptionist");
    expect(p).not.toContain("This is a phone call");
    expect(p).toContain("the assistant on the website for 956 Woodworks");
    expect(p).toContain("This is a text chat");
  });

  it("keeps the tenant's own facts, limits and tools on both mediums", () => {
    for (const medium of ["phone", "web"] as const) {
      const p = buildSystemPrompt({ ...BASE, medium }, NOW);
      expect(p).toContain("We build custom furniture.");
      expect(p).toContain("Never quote a price");
      expect(p).toContain("capture_lead");
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter web exec vitest run system-prompt`
Expected: FAIL — `medium` is not a property of `VoicePromptInput` (typecheck),
and the web assertions fail on the phone wording.

- [ ] **Step 3: Add the medium**

In `apps/web/src/lib/voice/session-config.ts`, add to `VoicePromptInput`:

```ts
  /**
   * Which surface this conversation is happening on. OPTIONAL and defaulting
   * to "phone" so every existing caller's prompt is byte-identical — a
   * prompt change is a behaviour change on a live phone line.
   *
   * The web demo (`api/voice/web/session`) deliberately does NOT pass this:
   * it is voice, over WebRTC, and it keeps the `webDemoNotice` it has always
   * appended. Only the text concierge passes "web".
   */
  medium?: "phone" | "web";
```

In `apps/web/src/lib/voice/system-prompt.ts`, replace the two hard-coded
sentences. Before the `lines` array:

```ts
  // The two sentences that were phone-shaped. Everything else in this prompt
  // — identity, language, the business facts, the HARD LIMITS block — is the
  // tenant's own and is identical on both surfaces. There is ONE Sofía; this
  // is not a second prompt.
  const onWeb = input.medium === "web";
  const role = onWeb
    ? `the assistant on the website for ${input.businessName}`
    : `the phone receptionist for ${input.businessName}`;
  const toneMedium = onWeb
    ? "This is a text chat: short messages, one question at a time, no long lists."
    : "This is a phone call: short sentences, one question at a time, no bulleted lists read aloud.";
```

Then `:30` becomes `` `You are ${input.personaName}, ${role}.` `` and `:46`'s
sentence becomes `` `TONE — Warm, brief, and competent. ${toneMedium} Never read the business facts verbatim; answer conversationally in your own words.` ``

Add, in the web branch only, after the TOOLS block:

```ts
  if (onWeb) {
    lines.push(
      "",
      "YOU CANNOT BOOK FROM HERE — you have no calendar on this surface. If someone wants an appointment, say the team will set it up, and use capture_lead to get their name and either an email or a phone number so they can be reached.",
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter web exec vitest run system-prompt`
Expected: PASS, including the byte-identity test.

Then the mutation: delete `input.medium === "web"`'s `=== "web"` so `onWeb` is
truthy for every caller. Expected: the byte-identity test and the default-wording
test go RED. Revert, and confirm `git diff` on `system-prompt.ts` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/voice/session-config.ts apps/web/src/lib/voice/system-prompt.ts apps/web/src/lib/voice/system-prompt.test.ts
git commit -m "$(cat <<'EOF'
Sofía can say where she is without becoming a second Sofía

buildSystemPrompt takes a medium, defaulting to phone so every existing
caller's prompt is byte-identical. Only two sentences move; the persona,
the facts and the hard limits are the tenant's own on both surfaces.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UuVS5XfWB6aZdX9b83RePF
EOF
)"
```

---

### Task 3: The chat page at `/c/[publicId]`

**Files:**
- Create: `apps/web/src/lib/concierge/strings.ts`
- Create: `apps/web/src/lib/concierge/guards.ts`
- Create: `apps/web/src/app/c/[publicId]/page.tsx`
- Create: `apps/web/src/app/c/[publicId]/concierge-chat.tsx`
- Create: `apps/web/src/app/c/[publicId]/concierge.css`
- Create: `apps/web/src/app/c/[publicId]/page.test.ts`

**Interfaces:**
- Consumes: `getVoiceProfileByPublicId` (Task 1); `signRenderToken`,
  `HONEYPOT_FIELD`, `RENDER_TOKEN_FIELD`, `parseAttribution` from
  `@/lib/forms/guards`; `publicFormTheme`, `parseHostMode` from
  `@/lib/branding/public-form-theme`; `PublicBrand` from `@/components/public-brand`.
- Produces, for Task 4: the constants in `lib/concierge/guards.ts` —
  ```ts
  export const CONCIERGE_MAX_TURNS = 24;
  export const CONCIERGE_MAX_CONVERSATIONS_PER_IP = 3;
  export const CONCIERGE_IP_WINDOW_MS = 600_000;
  export const CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY = 300;
  export const CONCIERGE_ACCOUNT_WINDOW_MS = 86_400_000;
  export const CONCIERGE_MAX_MESSAGE_CHARS = 2_000;
  ```
  and the POST contract the chat component calls:
  ```
  POST /api/concierge/<publicId>/turn
  { conversationId: string | null, text: string, bis_rt?: string,
    bis_hp?: string, locale?: "en"|"es", attribution?: Record<string,string> }
  → 200 { conversationId: string, reply: string, ended: boolean }
  → 429 { error: "rate_limited" } · 403 { error: "forbidden" } · 404 · 503
  ```

- [ ] **Step 1: Write the constants and the copy**

Create `apps/web/src/lib/concierge/guards.ts`:

```ts
/**
 * The concierge's own limits, deliberately NOT lib/forms/guards.ts's.
 *
 * Every existing limiter in this repo assumes one POST is one interaction:
 * RATE_LIMIT_MAX 5 per RATE_LIMIT_WINDOW_MS 600s. A real conversation is ten
 * turns in four minutes and would be cut off at turn five; raising that
 * constant to fit a conversation would stop it working as a flood guard for
 * the public form and the booking page, which share it. So these are two
 * limits doing two different jobs, in two files.
 */

/** Turns per conversation, full stop. Generous enough for a real back and
 *  forth, small enough that one visitor cannot bill without bound. */
export const CONCIERGE_MAX_TURNS = 24;

/** How many conversations one visitor may START in the window. Counted on
 *  turn 1 only — turns inside a conversation are governed by the cap above. */
export const CONCIERGE_MAX_CONVERSATIONS_PER_IP = 3;
export const CONCIERGE_IP_WINDOW_MS = 600_000;

/** The per-tenant ceiling, so one client's public page cannot spend alone.
 *  Named rather than inlined, because both windows are tuning knobs and a
 *  bare 86_400_000 hides one of them. */
export const CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY = 300;
export const CONCIERGE_ACCOUNT_WINDOW_MS = 86_400_000;

/** One visitor message. Longer is truncated by the route, never rejected —
 *  a visitor who pasted a long question should get an answer, not an error. */
export const CONCIERGE_MAX_MESSAGE_CHARS = 2_000;
```

Create `apps/web/src/lib/concierge/strings.ts`, modelled on
`lib/forms/public-strings.ts` (same `as const` + widened-type technique, for
the reason that file documents):

```ts
const STRINGS = {
  en: {
    placeholder: "Type your message…",
    send: "Send",
    sending: "Sending…",
    thinking: "Typing…",
    unavailable: "Something went wrong. Please try again.",
    ended: "Thanks for chatting. Leave your name and a number or email and the team will pick this up.",
    poweredBy: "Powered by BIS",
    title: "Chat",
  },
  es: {
    placeholder: "Escribe tu mensaje…",
    send: "Enviar",
    sending: "Enviando…",
    thinking: "Escribiendo…",
    unavailable: "Algo salió mal. Vuelve a intentarlo.",
    ended: "Gracias por escribir. Déjanos tu nombre y un teléfono o correo y el equipo te contactará.",
    poweredBy: "Con tecnología de BIS",
    title: "Chat",
  },
} as const;

export type ConciergeStrings = { [K in keyof (typeof STRINGS)["en"]]: string };

export function conciergeStrings(locale: string | undefined): ConciergeStrings {
  return locale === "es" ? STRINGS.es : STRINGS.en;
}
```

- [ ] **Step 2: Write the failing page test**

Create `apps/web/src/app/c/[publicId]/page.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getVoiceProfileByPublicIdMock = vi.fn();
const getBrandingMock = vi.fn();
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getVoiceProfileByPublicId: getVoiceProfileByPublicIdMock,
  getBranding: getBrandingMock,
  brandLogoUrl: () => null,
}));

import { generateMetadata } from "./page";

const PROFILE = {
  id: "p1", account_id: "a1", persona_name: "Sofía",
  greeting_en: "Hi! How can I help?", greeting_es: "¡Hola!",
  facts: "f", services: "s", languages: "both", booking_enabled: false,
  after_hours: "message_only", enabled: true, textback_enabled: false,
  textback_body: "", public_id: "abc123", concierge_enabled: true,
  concierge_form_id: "f1",
};

beforeEach(() => {
  getVoiceProfileByPublicIdMock.mockReset();
  getBrandingMock.mockReset();
});

describe("/c/[publicId] metadata", () => {
  // robots is the one thing that must not depend on a database read: an
  // indexed chat page would surface a client's widget, and its query string,
  // in search results for someone who never visited their site.
  it("is noindex even when the branding read throws", async () => {
    getVoiceProfileByPublicIdMock.mockResolvedValue(PROFILE);
    getBrandingMock.mockRejectedValue(new Error("db down"));
    const meta = await generateMetadata({ params: Promise.resolve({ publicId: "abc123" }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("is noindex for an unknown public id", async () => {
    getVoiceProfileByPublicIdMock.mockResolvedValue(null);
    const meta = await generateMetadata({ params: Promise.resolve({ publicId: "nope" }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run c/\\[publicId\\]`
Expected: FAIL — `./page` does not exist.

- [ ] **Step 4: Write the page**

Create `apps/web/src/app/c/[publicId]/page.tsx`. Read
`apps/web/src/app/f/[publicId]/page.tsx` first and follow it exactly: the
`cache()`d loaders so `generateMetadata` and the component share one query
each, the branding read that returns `UNBRANDED` on failure rather than
throwing, `force-dynamic`, and the unconditional `robots`.

```tsx
import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { serviceDb, getVoiceProfileByPublicId, getBranding, brandLogoUrl,
         type Branding } from "@bis/db";
import { signRenderToken, parseAttribution } from "@/lib/forms/guards";
import { conciergeStrings } from "@/lib/concierge/strings";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
import { PublicBrand } from "@/components/public-brand";
import { ConciergeChat } from "./concierge-chat";
import "@/styles/public-brand.css";
import "./concierge.css";

export const dynamic = "force-dynamic";

const loadProfile = cache(
  (publicId: string) => getVoiceProfileByPublicId(serviceDb(), publicId),
);

/** Null on failure rather than throwing, for the reason the public form
 *  already documents: without the profile there is nothing to render, but
 *  without the branding there is still a chat that captures the lead. A
 *  database blip must not cost the client the customer. */
const loadBranding = cache(async (accountId: string, publicId: string) => {
  try {
    return await getBranding(serviceDb(), accountId);
  } catch (e) {
    console.error(`concierge ${publicId}: branding read failed for account ${accountId}: ${String(e)}`);
    return null;
  }
});

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};

export async function generateMetadata(
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Metadata> {
  const { publicId } = await params;
  const profile = await loadProfile(publicId);
  const branding = profile ? await loadBranding(profile.account_id, publicId) : null;
  return {
    title: branding?.brandName ?? "Chat",
    // Unconditional, and NOT dependent on a database read succeeding.
    robots: { index: false, follow: false },
  };
}

export default async function ConciergePage({
  params, searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { publicId } = await params;
  const sp = await searchParams;
  const profile = await loadProfile(publicId);
  if (!profile) notFound();

  const branding = (await loadBranding(profile.account_id, publicId)) ?? UNBRANDED;
  const locale = normalizeLocale(
    typeof sp.locale === "string" ? sp.locale : undefined,
    profile.languages === "es" ? "es" : "en",
  );
  const strings = conciergeStrings(locale);
  const greeting = locale === "es" ? profile.greeting_es : profile.greeting_en;

  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") query.set(k, v);
  }

  return (
    <main
      className="bis-concierge"
      style={publicFormTheme(branding, parseHostMode(
        typeof sp.theme === "string" ? sp.theme : undefined,
      ))}
    >
      <PublicBrand name={branding.brandName} logoUrl={brandLogoUrl(branding)} />
      <ConciergeChat
        publicId={publicId}
        greeting={greeting}
        locale={locale}
        strings={strings}
        renderToken={signRenderToken(publicId, Date.now())}
        attribution={parseAttribution(query)}
      />
      <p className="bis-concierge-footer">{strings.poweredBy}</p>
    </main>
  );
}
```

- [ ] **Step 5: Write the chat component and its styles**

Create `apps/web/src/app/c/[publicId]/concierge-chat.tsx`. All four DESIGN.md
states live here: the greeting IS the empty state, a message-shaped skeleton
is the loading state (never a spinner, DESIGN.md rule 7), a one-sentence error
leaves the composer usable, and the turn cap's end is its own copy rather than
an error, because it is not one.

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { HONEYPOT_FIELD, RENDER_TOKEN_FIELD } from "@/lib/forms/guards";
import { CONCIERGE_MAX_MESSAGE_CHARS } from "@/lib/concierge/guards";
import type { ConciergeStrings } from "@/lib/concierge/strings";

type Msg = { role: "visitor" | "assistant"; text: string };

export function ConciergeChat({
  publicId, greeting, locale, strings, renderToken, attribution,
}: {
  publicId: string; greeting: string; locale: "en" | "es";
  strings: ConciergeStrings; renderToken: string;
  attribution: Record<string, string>;
}) {
  // The greeting IS the empty state. It is the tenant's own copy, from their
  // own profile row — there is nothing to invent here.
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", text: greeting }]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const conversationId = useRef<string | null>(null);
  const honeypot = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages, pending]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || pending || ended) return;
    setDraft("");
    setError(null);
    setMessages((m) => [...m, { role: "visitor", text }]);
    setPending(true);
    try {
      const res = await fetch(`/api/concierge/${encodeURIComponent(publicId)}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId.current,
          text: text.slice(0, CONCIERGE_MAX_MESSAGE_CHARS),
          locale,
          attribution,
          [RENDER_TOKEN_FIELD]: renderToken,
          [HONEYPOT_FIELD]: honeypot.current?.value ?? "",
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { conversationId: string; reply: string; ended: boolean };
      conversationId.current = data.conversationId;
      setMessages((m) => [...m, { role: "assistant", text: data.reply }]);
      if (data.ended) setEnded(true);
    } catch {
      // One sentence, and the composer stays usable — a visitor mid-question
      // must not be dead-ended by one failed turn.
      setError(strings.unavailable);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bis-concierge-panel">
      <ol className="bis-concierge-log" aria-live="polite">
        {messages.map((msg, i) => (
          <li key={i} className={`bis-msg bis-msg-${msg.role}`}>{msg.text}</li>
        ))}
        {/* Skeleton shaped like the content, not a spinner. */}
        {pending && (
          <li className="bis-msg bis-msg-assistant bis-msg-skeleton" aria-label={strings.thinking}>
            <span /><span /><span />
          </li>
        )}
        <div ref={bottom} />
      </ol>

      {error && <p className="bis-concierge-error" role="status">{error}</p>}
      {/* Not an error state: a conversation that reached its cap still wants
          to become a lead, so the copy asks for one. */}
      {ended && <p className="bis-concierge-ended" role="status">{strings.ended}</p>}

      <form className="bis-concierge-composer" onSubmit={send}>
        <input
          ref={honeypot} type="text" name={HONEYPOT_FIELD}
          tabIndex={-1} autoComplete="off" aria-hidden="true"
          className="bis-hp"
        />
        <label className="bis-sr-only" htmlFor="bis-concierge-input">{strings.placeholder}</label>
        <input
          id="bis-concierge-input" value={draft} disabled={ended}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={strings.placeholder} maxLength={CONCIERGE_MAX_MESSAGE_CHARS}
          autoComplete="off"
        />
        <button type="submit" disabled={pending || ended || !draft.trim()}>
          {pending ? strings.sending : strings.send}
        </button>
      </form>
    </div>
  );
}
```

Create `apps/web/src/app/c/[publicId]/concierge.css`. **Tokens only** — read
`apps/web/src/app/f/[publicId]/form.css` first and take its approach. Every
colour is `var(--surface-*)`, `var(--text-*)`, `var(--line*)` or
`var(--accent*)`; radii are `var(--radius-ctl)` (8px) and `var(--radius-card)`
(12px) and nothing else; spacing on the 4px grid; a visible `:focus-visible`
ring on the input and the button; `@media (prefers-reduced-motion: reduce)`
disables the skeleton's pulse. The visitor's bubble sits on `--accent-dim`,
the assistant's on `--surface-2`, and `.bis-hp` is the honeypot's
off-screen rule copied from the public form's own stylesheet.

- [ ] **Step 6: Run the page test and the typecheck**

Run: `pnpm --filter web exec vitest run c/\\[publicId\\]`
Expected: PASS.

Run: `pnpm --filter web exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/concierge apps/web/src/app/c
git commit -m "$(cat <<'EOF'
A chat page at /c/<publicId>, branded by the client it belongs to

Resolves the tenant from the public id the way /b and /f already do, paints
their brand, and carries all four states — the greeting is the empty state,
the loading state is a message-shaped skeleton, an error keeps the composer
usable, and reaching the turn cap asks for a name instead of apologising.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UuVS5XfWB6aZdX9b83RePF
EOF
)"
```

---

### Task 4: The turn endpoint

**Files:**
- Create: `apps/web/src/lib/concierge/prompt.ts`
- Create: `apps/web/src/lib/concierge/prompt.test.ts`
- Create: `apps/web/src/app/api/concierge/[publicId]/turn/route.ts`
- Create: `apps/web/src/app/api/concierge/[publicId]/turn/route.test.ts`
- Create: `apps/web/e2e/concierge.spec.ts`

**Interfaces:**
- Consumes: every accessor from Task 1; `buildSystemPrompt` with
  `medium: "web"` from Task 2; the constants and the POST contract from Task 3.
- Produces: nothing later in this plan depends on it.

- [ ] **Step 1: Write the tool schema and its test**

Create `apps/web/src/lib/concierge/prompt.ts`:

```ts
/**
 * The concierge's ONE tool.
 *
 * Defined here rather than taken from lib/voice/tools/registry.ts: `runTool`
 * resolves against a voice-shaped context (ctx.callRowId, ctx.callerNumber)
 * that does not exist on the web, and transfer_to_human requires a phone leg
 * the web has never had.
 *
 * Booking stays OFF. Giving an anonymous stranger a path into a tenant's
 * calendar is a larger decision than v1 needs, and the existing web demo
 * already refuses it by forcing tools: [].
 *
 * Why a tool at all, when the voice demo could not have one: on text THIS
 * SERVER makes the model call, so a tool call comes straight back in the
 * response body. `processCallEvent` being wired only to the phone path's
 * socket was a WebRTC problem, and text does not have it.
 */
export const CAPTURE_LEAD_TOOL = {
  type: "function" as const,
  function: {
    name: "capture_lead",
    description:
      "Record who this visitor is so the business can get back to them. Call this as soon as they give a name AND either an email address or a phone number. Do not guess or invent any value.",
    parameters: {
      type: "object",
      properties: {
        fullName: { type: "string", description: "The visitor's name, as they gave it." },
        email: { type: "string", description: "Their email address, if they gave one." },
        phone: { type: "string", description: "Their phone number, if they gave one." },
        need: { type: "string", description: "One sentence on what they are asking for." },
      },
      required: ["fullName", "need"],
      additionalProperties: false,
    },
  },
};

export type CaptureLeadArgs = {
  fullName?: unknown; email?: unknown; phone?: unknown; need?: unknown;
};

/** A model may return anything. Nothing reaches the CRM without passing this. */
export function parseCaptureLead(raw: string): {
  fullName: string; email: string; phone: string; need: string;
} | null {
  let parsed: CaptureLeadArgs;
  try { parsed = JSON.parse(raw) as CaptureLeadArgs; } catch { return null; }
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const fullName = str(parsed.fullName);
  if (!fullName) return null;
  return { fullName, email: str(parsed.email), phone: str(parsed.phone), need: str(parsed.need) };
}
```

Create `apps/web/src/lib/concierge/prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCaptureLead, CAPTURE_LEAD_TOOL } from "./prompt";

describe("parseCaptureLead", () => {
  it("returns null on malformed JSON rather than throwing", () => {
    expect(parseCaptureLead("{not json")).toBeNull();
  });
  it("returns null without a name — a lead nobody can be called back is not one", () => {
    expect(parseCaptureLead(JSON.stringify({ email: "a@b.co" }))).toBeNull();
  });
  it("coerces non-strings to empty rather than into the CRM", () => {
    const out = parseCaptureLead(JSON.stringify({ fullName: "Ana", email: 42, need: null }));
    // MUTATION: return parsed.email directly — this FAILS, and a number
    // reaches enrich() as an email address.
    expect(out).toEqual({ fullName: "Ana", email: "", phone: "", need: "" });
  });
  it("offers exactly one tool, and it is not booking", () => {
    expect(CAPTURE_LEAD_TOOL.function.name).toBe("capture_lead");
  });
});
```

- [ ] **Step 2: Write the failing route tests**

Create `apps/web/src/app/api/concierge/[publicId]/turn/route.test.ts`. Read
`apps/web/src/app/api/voice/web/session/route.test.ts` first — it is the worked
example for mocking `@bis/db` and for the "refused requests cost nothing"
assertion this file repeats.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  getVoiceProfileByPublicId: vi.fn(),
  createConciergeConversation: vi.fn(),
  getConciergeConversation: vi.fn(),
  claimConciergeTurn: vi.fn(),
  appendConciergeTurns: vi.fn(),
  setConciergeSubmission: vi.fn(),
  countConciergeConversationsByIp: vi.fn(),
  countConciergeConversationsForAccount: vi.fn(),
  getForm: vi.fn(),
  createSubmission: vi.fn(),
  getBranding: vi.fn(),
};
vi.mock("@bis/db", () => ({ serviceDb: () => ({}), ...db }));
const enrichMock = vi.fn();
vi.mock("@/lib/forms/enrich", () => ({ enrich: enrichMock }));

import { POST } from "./route";
import { signRenderToken, RENDER_TOKEN_FIELD, HONEYPOT_FIELD } from "@/lib/forms/guards";
import { CONCIERGE_MAX_CONVERSATIONS_PER_IP, CONCIERGE_MAX_TURNS } from "@/lib/concierge/guards";

const PUBLIC_ID = "abc123abc123";
const PROFILE = {
  id: "p1", account_id: "a1", persona_name: "Sofía",
  greeting_en: "Hi", greeting_es: "Hola", facts: "f", services: "s",
  languages: "both", booking_enabled: false, after_hours: "message_only",
  enabled: true, textback_enabled: false, textback_body: "",
  public_id: PUBLIC_ID, concierge_enabled: true, concierge_form_id: "form1",
};

let fetchSpy: ReturnType<typeof vi.spyOn>;

function modelReplies(text: string) {
  return { ok: true, json: async () => ({ choices: [{ message: { content: text } }] }) };
}

function post(body: Record<string, unknown>) {
  return POST(
    new Request("https://app.test/api/concierge/x/turn", {
      method: "POST",
      headers: { "content-type": "application/json", "x-vercel-forwarded-for": "1.2.3.4" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ publicId: PUBLIC_ID }) },
  );
}

function firstTurn(extra: Record<string, unknown> = {}) {
  return post({
    conversationId: null, text: "do you build tables?",
    [RENDER_TOKEN_FIELD]: signRenderToken(PUBLIC_ID, Date.now() - 3_000),
    [HONEYPOT_FIELD]: "", locale: "en", attribution: {}, ...extra,
  });
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  for (const fn of Object.values(db)) fn.mockReset();
  enrichMock.mockReset();
  db.getVoiceProfileByPublicId.mockResolvedValue(PROFILE);
  db.countConciergeConversationsByIp.mockResolvedValue(0);
  db.countConciergeConversationsForAccount.mockResolvedValue(0);
  db.createConciergeConversation.mockResolvedValue({ id: "c1" });
  db.getConciergeConversation.mockResolvedValue({
    id: "c1", account_id: "a1", form_id: "form1", ip_hash: "h",
    turn_count: 1, transcript: [], submission_id: null, locale: "en",
    attribution: {}, origin: null,
  });
  db.claimConciergeTurn.mockResolvedValue(1);
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    modelReplies("Yes, we do.") as unknown as Response,
  );
});

describe("POST /api/concierge/[publicId]/turn", () => {
  it("answers a first turn and returns the conversation id", async () => {
    const res = await firstTurn();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ conversationId: "c1", reply: "Yes, we do.", ended: false });
  });

  it("404s an unknown or switched-off public id, with zero model calls", async () => {
    db.getVoiceProfileByPublicId.mockResolvedValue(null);
    const res = await firstTurn();
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses once this IP is over its conversation cap, BEFORE the model call", async () => {
    db.countConciergeConversationsByIp.mockResolvedValue(CONCIERGE_MAX_CONVERSATIONS_PER_IP);
    const res = await firstTurn();
    expect(res.status).toBe(429);
    // MUTATION: move the fetch above the cap check — this FAILS, and a
    // refused request starts costing money.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.createConciergeConversation).not.toHaveBeenCalled();
  });

  it("refuses once this ACCOUNT is over its daily cap, BEFORE the model call", async () => {
    db.countConciergeConversationsForAccount.mockResolvedValue(10_000);
    const res = await firstTurn();
    expect(res.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.createConciergeConversation).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED when a counter throws", async () => {
    db.countConciergeConversationsByIp.mockRejectedValue(new Error("db down"));
    const res = await firstTurn();
    // MUTATION: catch and continue — this FAILS. A guard failing open here
    // costs an unbounded number of model calls, not one.
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a filled honeypot with the SAME body a good turn gets", async () => {
    const good = await (await firstTurn()).json();
    const bad = await (await firstTurn({ [HONEYPOT_FIELD]: "bot" })).json();
    // Anti-oracle: a widget that answers differently tells a spammer which
    // guard it tripped.
    expect(Object.keys(bad).sort()).toEqual(Object.keys(good).sort());
    expect(db.createConciergeConversation).toHaveBeenCalledTimes(1);
  });

  it("refuses a first turn that arrived too fast to have been typed", async () => {
    await firstTurn({ [RENDER_TOKEN_FIELD]: signRenderToken(PUBLIC_ID, Date.now()) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does NOT re-check the render token on turn 2, even hours later", async () => {
    const res = await post({
      conversationId: "c1", text: "and a bench?",
      [RENDER_TOKEN_FIELD]: signRenderToken(PUBLIC_ID, Date.now() - 4 * 3_600_000),
      [HONEYPOT_FIELD]: "", locale: "en",
    });
    // MUTATION: verify the token on every turn — this FAILS, and a panel
    // left open for half an hour dies mid-sentence.
    expect(res.status).toBe(200);
  });

  it("refuses a conversation belonging to another account", async () => {
    db.getConciergeConversation.mockResolvedValue({
      id: "c1", account_id: "SOMEONE_ELSE", form_id: "form1", ip_hash: "h",
      turn_count: 1, transcript: [], submission_id: null, locale: "en",
      attribution: {}, origin: null,
    });
    const res = await post({ conversationId: "c1", text: "hi", [HONEYPOT_FIELD]: "" });
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ends the conversation at the turn cap without calling the model", async () => {
    db.claimConciergeTurn.mockResolvedValue(null);
    const res = await post({ conversationId: "c1", text: "hi", [HONEYPOT_FIELD]: "" });
    expect(res.status).toBe(200);
    expect((await res.json()).ended).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("files a lead through enrich with consentWithheld TRUE, always", async () => {
    db.getForm.mockResolvedValue({
      id: "form1", account_id: "a1", public_id: "f", name: "Leads",
      status: "published", fields: [
        { key: "n", kind: "core.first_name", label: "Name", required: true },
        { key: "e", kind: "core.email", label: "Email", required: false },
      ],
      theme: {}, success_mode: "message", success_message: null,
      redirect_url: null, notify_emails: ["op@x.co"], locale_default: "en",
      created_at: "", updated_at: "",
    });
    db.createSubmission.mockResolvedValue({ id: "s1" });
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: {
        content: "Got it.",
        tool_calls: [{ id: "t1", type: "function", function: {
          name: "capture_lead",
          arguments: JSON.stringify({ fullName: "Ana", email: "ana@x.co", need: "a table" }),
        } }],
      } }] }),
    } as unknown as Response);

    await post({ conversationId: "c1", text: "I'm Ana, ana@x.co", [HONEYPOT_FIELD]: "" });

    // The form above carries NO consent field. MUTATION: derive
    // consentWithheld from the form's fields — this FAILS, and a widget lead
    // triggers an automatic text nobody agreed to.
    const consentWithheld = enrichMock.mock.calls[0]![7];
    expect(consentWithheld).toBe(true);
  });

  it("files at most one submission per conversation", async () => {
    db.getConciergeConversation.mockResolvedValue({
      id: "c1", account_id: "a1", form_id: "form1", ip_hash: "h",
      turn_count: 3, transcript: [], submission_id: "already", locale: "en",
      attribution: {}, origin: null,
    });
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: {
        content: "Thanks.",
        tool_calls: [{ id: "t2", type: "function", function: {
          name: "capture_lead",
          arguments: JSON.stringify({ fullName: "Ana", email: "ana@x.co", need: "again" }),
        } }],
      } }] }),
    } as unknown as Response);
    await post({ conversationId: "c1", text: "me again", [HONEYPOT_FIELD]: "" });
    // MUTATION: drop the submission_id guard — this FAILS, and one visitor
    // becomes two contacts.
    expect(enrichMock).not.toHaveBeenCalled();
  });

  it("answers with a usable message when the model call fails", async () => {
    fetchSpy.mockRejectedValue(new Error("timeout"));
    const res = await post({ conversationId: "c1", text: "hi", [HONEYPOT_FIELD]: "" });
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter web exec vitest run concierge`
Expected: FAIL — `./route` does not exist.

- [ ] **Step 4: Write the route**

Create `apps/web/src/app/api/concierge/[publicId]/turn/route.ts`:

```ts
// One turn of a website conversation.
//
// This endpoint holds what the browser must not: the transcript and the turn
// counter. A design where the client posts both hands the cap to whoever
// wants to ignore it.
//
// ORDER IS THE POINT. Every cost check runs before the fetch to
// api.openai.com, and a throwing counter REFUSES rather than continuing —
// the same asymmetry api/voice/web/session documents: a guard failing open
// here costs an unbounded number of model calls, not one.
//
// This bounds how many turns and how many conversations. It claims nothing
// about duration, because text has none to claim.
import { NextResponse } from "next/server";
import { buildSystemPrompt } from "@/lib/voice/session-config";
import {
  clientIp, hashIp, verifyRenderToken, MIN_FILL_MS,
  HONEYPOT_FIELD, RENDER_TOKEN_FIELD, isValidEmail, isValidPhone,
} from "@/lib/forms/guards";
import {
  CONCIERGE_MAX_TURNS, CONCIERGE_MAX_CONVERSATIONS_PER_IP,
  CONCIERGE_IP_WINDOW_MS, CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY,
  CONCIERGE_ACCOUNT_WINDOW_MS, CONCIERGE_MAX_MESSAGE_CHARS,
} from "@/lib/concierge/guards";
import { CAPTURE_LEAD_TOOL, parseCaptureLead } from "@/lib/concierge/prompt";
import { conciergeStrings } from "@/lib/concierge/strings";
import { enrich } from "@/lib/forms/enrich";

export const runtime = "nodejs";

function log(msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: "concierge/turn", msg, ...extra }));
}

/** Every refusal that is not a 404 answers with the SAME shape a good turn
 *  does, so the widget is never an oracle telling a spammer which guard they
 *  tripped. */
function quiet(conversationId: string, reply: string, ended = false) {
  return NextResponse.json({ conversationId, reply, ended });
}

export async function POST(
  req: Request, { params }: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await params;
  const {
    serviceDb, getVoiceProfileByPublicId, getForm,
    createConciergeConversation, getConciergeConversation, claimConciergeTurn,
    appendConciergeTurns, setConciergeSubmission, createSubmission,
    countConciergeConversationsByIp, countConciergeConversationsForAccount,
  } = await import("@bis/db");

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const text = typeof body.text === "string"
    ? body.text.trim().slice(0, CONCIERGE_MAX_MESSAGE_CHARS) : "";
  const locale = body.locale === "es" ? "es" : "en";
  const strings = conciergeStrings(locale);
  if (!text) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const db = serviceDb();
  const profile = await getVoiceProfileByPublicId(db, publicId);
  // Unknown id, concierge off, or no destination form — all one answer. The
  // accessor makes those three indistinguishable on purpose.
  if (!profile) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const ipHash = hashIp(clientIp(req.headers));
  const origin = req.headers.get("origin");
  const priorId = typeof body.conversationId === "string" ? body.conversationId : null;

  let conversationId: string;
  let conversation: Awaited<ReturnType<typeof getConciergeConversation>>;

  if (!priorId) {
    // ── TURN 1 ────────────────────────────────────────────────────────────
    // The render token, the honeypot and the fill-time floor gate the START
    // of a conversation and nothing after it. MAX_TOKEN_AGE_MS is 30
    // minutes; re-checking on every turn would kill a panel left open past
    // that, mid-sentence, for a reason no visitor could understand.
    const token = typeof body[RENDER_TOKEN_FIELD] === "string"
      ? body[RENDER_TOKEN_FIELD] as string : "";
    const verdict = verifyRenderToken(token, Date.now(), publicId);
    const honeypot = typeof body[HONEYPOT_FIELD] === "string"
      ? body[HONEYPOT_FIELD] as string : "";
    if (honeypot || !verdict.ok || Date.now() - verdict.issuedAtMs < MIN_FILL_MS) {
      log("refused: start guard", { publicId });
      return quiet("", strings.unavailable, true);
    }

    // EVERY COST CHECK HAPPENS HERE, BEFORE THE MODEL CALL. Fail CLOSED.
    try {
      const [byIp, byAccount] = await Promise.all([
        countConciergeConversationsByIp(
          db, ipHash, new Date(Date.now() - CONCIERGE_IP_WINDOW_MS).toISOString()),
        countConciergeConversationsForAccount(
          db, profile.account_id,
          new Date(Date.now() - CONCIERGE_ACCOUNT_WINDOW_MS).toISOString()),
      ]);
      if (byIp >= CONCIERGE_MAX_CONVERSATIONS_PER_IP) {
        log("refused: ip cap", { byIp });
        return NextResponse.json({ error: "rate_limited" }, { status: 429 });
      }
      if (byAccount >= CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY) {
        log("refused: account cap", { accountId: profile.account_id, byAccount });
        return NextResponse.json({ error: "rate_limited" }, { status: 429 });
      }
    } catch (e) {
      log("refused: counter failed", { error: String(e) });
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }

    const created = await createConciergeConversation(db, {
      accountId: profile.account_id, formId: profile.concierge_form_id,
      ipHash, locale,
      attribution: (body.attribution ?? {}) as Record<string, string>,
      origin,
    });
    conversationId = created.id;
    conversation = await getConciergeConversation(db, conversationId);
  } else {
    // ── TURN 2+ ───────────────────────────────────────────────────────────
    conversationId = priorId;
    conversation = await getConciergeConversation(db, conversationId);
    // The conversation row is the authorisation now, and it must belong to
    // the tenant this address resolves to — otherwise a leaked id could be
    // driven through another client's widget.
    if (!conversation || conversation.account_id !== profile.account_id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }
  if (!conversation) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  // THE TURN CAP. Atomic, so two turns posted together cannot both pass.
  const claimed = await claimConciergeTurn(db, conversationId, CONCIERGE_MAX_TURNS);
  if (claimed === null) return quiet(conversationId, strings.ended, true);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const messages = [
    { role: "system", content: buildSystemPrompt({
      personaName: profile.persona_name, businessName: profile.persona_name,
      greeting: locale === "es" ? profile.greeting_es : profile.greeting_en,
      facts: profile.facts, services: profile.services,
      languages: profile.languages, bookingEnabled: false,
      timezone: "UTC", slotDurationMinutes: 30,
      afterHours: profile.after_hours, callerNumber: null,
      meetingType: "in_person", medium: "web",
    }, new Date()) },
    ...conversation.transcript.map((t) => ({
      role: t.role === "visitor" ? "user" : "assistant", content: t.text,
    })),
    { role: "user", content: text },
  ];

  let reply = "";
  let toolArgs: string | null = null;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini", messages, tools: [CAPTURE_LEAD_TOOL],
      }),
      // A hung connection never rejects and never resolves; without this the
      // invocation stalls until Vercel kills it and the visitor sees nothing.
      // Same defence summary-service.ts already runs in production.
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`openai ${r.status}`);
    const data = await r.json();
    const message = data?.choices?.[0]?.message;
    reply = message?.content ?? "";
    const call = message?.tool_calls?.find(
      (c: { function?: { name?: string } }) => c.function?.name === "capture_lead");
    toolArgs = call?.function?.arguments ?? null;
  } catch (e) {
    log("model call failed", { error: String(e) });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const now = new Date().toISOString();
  await appendConciergeTurns(db, conversationId, [
    { role: "visitor", text, at: now },
    { role: "assistant", text: reply, at: now },
  ]);

  // Lead capture, at most once per conversation.
  if (toolArgs && !conversation.submission_id) {
    const lead = parseCaptureLead(toolArgs);
    if (lead) await fileLead(lead);
  }

  return quiet(conversationId, reply || strings.unavailable, false);

  async function fileLead(lead: { fullName: string; email: string; phone: string; need: string }) {
    try {
      const form = await getForm(db, profile!.account_id, profile!.concierge_form_id);
      if (!form || form.status !== "published") return;
      // Mapped by KIND, not by position: kinds this form does not carry are
      // dropped, exactly as enrich's own byKind map expects. Required flags
      // are NOT enforced — a conversation that produced a name and a way to
      // reach someone is a lead, and refusing it because a fifth field is
      // blank throws away the thing this widget exists to catch.
      const value = (kind: string) =>
        kind === "core.first_name" ? lead.fullName
        : kind === "core.email" ? (isValidEmail(lead.email) ? lead.email : "")
        : kind === "core.phone" ? (isValidPhone(lead.phone) ? lead.phone : "")
        : kind === "message" ? lead.need : "";
      const answers = form.fields
        .map((f) => ({ key: f.key, label: f.label, value: value(f.kind) }))
        .filter((a) => a.value !== "");
      if (!answers.length) return;

      // SubmissionInput's optional fields are `?: string`, NOT `| null`
      // (packages/db/src/forms.ts:147-155) — omit what you do not have
      // rather than passing null, which does not typecheck.
      const submission = await createSubmission(db, form.account_id, form.id, {
        answers, attribution: conversation!.attribution, consent: [],
        locale, ipHash,
      });
      await setConciergeSubmission(db, conversationId, submission.id);
      await enrich(
        db, form, submission.id, answers, conversation!.attribution,
        origin, locale,
        // TRUE, ALWAYS, and NOT derived from whether this form happens to
        // carry a consent field. A conversation cannot tick a box under its
        // exact wording — #99 records every consent field as given: false for
        // exactly this reason — and a form WITHOUT one would otherwise let a
        // widget lead trigger an automatic text nobody agreed to. The
        // operator replies by hand from Conversations; that is the design,
        // not a gap.
        true,
      );
    } catch (e) {
      // A failed lead must not cost the visitor their answer — they are
      // mid-conversation and the transcript is already stored.
      log("lead capture failed", { error: String(e) });
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter web exec vitest run concierge`
Expected: PASS, all files.

- [ ] **Step 6: Mutation proof**

Run each mutation named in the route test's comments, one at a time, reverting
before the next, and paste the RED transcript for each:

1. Move the `fetch` above the IP-cap check → the cap tests go RED.
2. Catch-and-continue in the counter's `try` → the fail-closed test goes RED.
3. Verify the render token on every turn → the turn-2 test goes RED.
4. Derive `consentWithheld` from `form.fields.some(f => f.kind === "consent")`
   → the consent test goes RED.
5. Drop the `!conversation.submission_id` guard → the one-submission test goes RED.

**If any mutation cannot fail — for example because it targets code the test
mocks out — say so, prove it with the green run, and substitute a mutation on
the same side of the mock that can.** A green mutation row is a finding, not a
pass.

After the last revert, `git diff` on `route.ts` must print nothing.

- [ ] **Step 7: Write the e2e spec**

Create `apps/web/e2e/concierge.spec.ts`. It runs on the **per-run fixture
account** — read `apps/web/e2e/` for the existing fixture helper and use it;
never `Test Client One`. The spec enables the concierge on the fixture account
with a fixture form, opens `/c/<publicId>`, asserts the greeting renders, sends
one message, and asserts a reply appears. It does NOT assert the model's
wording. Skip the whole file when `OPENAI_API_KEY` is absent, with the same
explicit-skip shape the other conditional specs use — a silent skip is how a
suite passes without running.

- [ ] **Step 8: Run the gates, one at a time, exit codes from files**

```bash
gh run list --limit 3    # wait for any in-progress run before the next two
pnpm check;                   echo $? > /tmp/check.exit
pnpm --filter web build;      echo $? > /tmp/build.exit
gh run list --limit 3
pnpm --filter web test:e2e;   echo $? > /tmp/e2e.exit
cat /tmp/check.exit /tmp/build.exit /tmp/e2e.exit
```

Expected: `0 0 0`. Report the counts and the e2e duration, and say explicitly
whether a "skipped" line appeared.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/concierge apps/web/src/app/api/concierge apps/web/e2e/concierge.spec.ts
git commit -m "$(cat <<'EOF'
A conversation the server counts, and a lead the operator answers by hand

The turn endpoint holds the transcript and the counter so the browser cannot
reset either. Every cost check runs before the model call and fails closed.
capture_lead files through the same enrich() the public form uses, with
consentWithheld always true — a conversation cannot tick a box under its
exact wording, so a widget lead never triggers an automatic text.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UuVS5XfWB6aZdX9b83RePF
EOF
)"
```

**Branch 1 ends here.** Open the PR, read the check runs FOR THE HEAD SHA
(`gh api repos/:owner/:repo/commits/<sha>/check-runs`), never infer from an
earlier run, and merge only on green.

---

# Branch 2 — the bubble and the product surface

Cut `feat/web-concierge-embed` from `main` after Branch 1 merges.

### Task 5: The floating bubble, and one snippet component instead of three

**Files:**
- Modify: `apps/web/src/lib/forms/embed-script.ts:9-97`
- Modify: `apps/web/src/lib/forms/embed-script.test.ts`
- Create: `apps/web/src/components/embed-snippet.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/embed-snippet.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/forms/[formId]/embed-snippet.tsx`

**Interfaces:**
- Consumes: `/c/[publicId]` from Task 3.
- Produces, for Task 6:
  ```tsx
  export function EmbedSnippet({ attribute, publicId, origin, title }: {
    attribute: "data-form" | "data-booking" | "data-concierge";
    publicId: string; origin: string; title: string;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing loader tests**

Add to `apps/web/src/lib/forms/embed-script.test.ts`. That file evaluates the
exact `EMBED_SCRIPT` string rather than a parallel copy, so these run against
what ships.

```ts
describe("the concierge branch", () => {
  it("builds a launcher and a panel instead of an inline iframe", () => {
    const { doc } = run({ "data-concierge": "abc123" });
    expect(doc.created.find((el) => el.tag === "button")).toBeTruthy();
    const iframe = doc.created.find((el) => el.tag === "iframe")!;
    expect(iframe.src).toContain("/c/abc123");
  });

  it("starts closed", () => {
    const { doc } = run({ "data-concierge": "abc123" });
    const panel = doc.created.find((el) => el.tag === "div" && el.style.position === "fixed")!;
    // MUTATION: render the panel open — this FAILS, and every visitor to
    // every client's site gets a chat shoved in front of them.
    expect(panel.style.display).toBe("none");
  });

  it("still passes attribution through, as the form branch does", () => {
    const { doc } = run({ "data-concierge": "abc123" }, { search: "?utm_source=google" });
    expect(doc.created.find((el) => el.tag === "iframe")!.src).toContain("utm_source=google");
  });

  it("leaves data-form and data-booking behaviour byte-identical", () => {
    // MUTATION: route data-form down the concierge branch — this FAILS.
    expect(run({ "data-form": "f1" }).doc.created.find((el) => el.tag === "iframe")!.src)
      .toContain("/f/f1");
    expect(run({ "data-booking": "b1" }).doc.created.find((el) => el.tag === "iframe")!.src)
      .toContain("/b/b1");
  });

  it("keeps BOTH postMessage checks on the concierge branch", () => {
    const { fire, doc } = run({ "data-concierge": "abc123" });
    const panel = doc.created.find((el) => el.tag === "div" && el.style.position === "fixed")!;
    // Wrong source, right origin.
    fire({ source: {}, origin: doc.origin, data: { type: "bis-concierge-close" } });
    expect(panel.style.display).toBe("none");
  });
});
```

(Use the existing `run` / `fire` fakes in that file; read it before writing —
it supplies `window`, `document`, `URL` and `URLSearchParams` as free
variables, which is why the assertions above read `doc.created`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter web exec vitest run embed-script`
Expected: FAIL — `data-concierge` is not read, so the script returns early.

- [ ] **Step 3: Add the concierge branch**

In `apps/web/src/lib/forms/embed-script.ts`, after the `data-booking` fallback,
add a third:

```js
  var concierge = false;
  if (!publicId) {
    publicId = script.getAttribute("data-concierge");
    path = "/c/";
    defaultTitle = "Chat";
    concierge = true;
  }
  if (!publicId) return;
```

and replace the single `insertBefore` with a branch. The inline path is
unchanged, byte for byte. The concierge path builds:

```js
  if (concierge) {
    // The conversation still lives entirely in the iframe — CSS isolation by
    // construction, no shadow DOM, no injected styles, no collision, because
    // none of the client-facing UI runs in the host page's DOM. Only this
    // chrome does.
    //
    // z-index is the one thing an embed cannot win outright on someone
    // else's page. A high explicit value, overridable with data-z, is the
    // honest mitigation — not a solution.
    var z = script.getAttribute("data-z") || "2147483000";
    var panel = document.createElement("div");
    panel.style.position = "fixed";
    panel.style.right = "16px";
    panel.style.bottom = "88px";
    panel.style.width = "380px";
    panel.style.maxWidth = "calc(100vw - 32px)";
    panel.style.height = "min(620px, calc(100vh - 120px))";
    panel.style.zIndex = z;
    panel.style.display = "none";
    panel.style.borderRadius = "12px";
    panel.style.overflow = "hidden";
    panel.style.boxShadow = "0 12px 40px rgba(24, 16, 48, .28)";

    iframe.style.width = "100%";
    iframe.style.height = "100%";
    panel.appendChild(iframe);

    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-label", script.getAttribute("data-title") || defaultTitle);
    launcher.style.position = "fixed";
    launcher.style.right = "16px";
    launcher.style.bottom = "16px";
    launcher.style.zIndex = z;
    launcher.style.width = "56px";
    launcher.style.height = "56px";
    launcher.style.borderRadius = "999px";
    launcher.style.border = "0";
    launcher.style.cursor = "pointer";
    launcher.style.background = script.getAttribute("data-color") || "#6D28D9";
    launcher.style.color = "#fff";
    launcher.style.fontSize = "22px";
    launcher.textContent = "\\u{1F4AC}";

    function setOpen(open) {
      panel.style.display = open ? "block" : "none";
      launcher.setAttribute("aria-expanded", open ? "true" : "false");
    }
    launcher.addEventListener("click", function () {
      setOpen(panel.style.display === "none");
    });
    // Esc closes the overlay, on the HOST page too — the panel is an overlay
    // over someone else's content and must behave like one.
    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setOpen(false);
    });

    document.body.appendChild(panel);
    document.body.appendChild(launcher);
  } else {
    script.parentNode.insertBefore(iframe, script.nextSibling);
  }
```

In the existing `message` listener, add the close message **inside** the two
checks that are already there — they are not moved or weakened:

```js
    if (data.type === "bis-concierge-close") {
      var launcherEl = document.querySelector("[data-bis-concierge-launcher]");
      if (launcherEl) launcherEl.setAttribute("aria-expanded", "false");
      return;
    }
```

- [ ] **Step 4: Run the loader tests to verify they pass**

Run: `pnpm --filter web exec vitest run embed-script`
Expected: PASS, including the two "unchanged" assertions for `data-form` and
`data-booking`.

- [ ] **Step 5: Extract the shared snippet component**

`calendar/embed-snippet.tsx` says in its own comment that it "mirrors
`forms/[formId]/embed-snippet.tsx` exactly". A third copy is this repo's own
three-copies threshold. Create `apps/web/src/components/embed-snippet.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";

/**
 * The one copy-the-snippet card.
 *
 * Extracted when the concierge would have been the THIRD copy —
 * calendar/embed-snippet.tsx already said in its own comment that it
 * "mirrors forms/[formId]/embed-snippet.tsx exactly". Both call sites moved
 * onto this in the same commit, so the extraction is proved by its callers
 * rather than asserted.
 */
export function EmbedSnippet({ attribute, publicId, origin, title }: {
  attribute: "data-form" | "data-booking" | "data-concierge";
  publicId: string; origin: string; title: string;
}) {
  const [copied, setCopied] = useState(false);
  const snippet = `<script src="${origin}/embed.js" ${attribute}="${publicId}" async></script>`;

  return (
    <div className="space-y-2">
      <p className="text-sm text-[var(--text-2)]">{title}</p>
      <pre className="overflow-x-auto rounded-[var(--radius-ctl)] bg-[var(--surface-2)] p-3 text-xs">
        <code>{snippet}</code>
      </pre>
      <Button
        variant="ghost"
        onClick={() => {
          void navigator.clipboard.writeText(snippet);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? m["embed.copied"] : m["embed.copy"]}
      </Button>
    </div>
  );
}
```

Then replace the bodies of both existing `embed-snippet.tsx` files with a call
to it, keeping each file's own export name so no importer changes. Read both
files first and preserve any prop or copy either one carries that the component
above does not — if one has something the other does not, that difference goes
into the shared component as a prop, not into a fork.

- [ ] **Step 6: Run the gates, one at a time**

```bash
gh run list --limit 3
pnpm check;                   echo $? > /tmp/check.exit
pnpm --filter web build;      echo $? > /tmp/build.exit
gh run list --limit 3
pnpm --filter web test:e2e;   echo $? > /tmp/e2e.exit
cat /tmp/check.exit /tmp/build.exit /tmp/e2e.exit
```

Expected: `0 0 0`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/forms/embed-script.ts apps/web/src/lib/forms/embed-script.test.ts apps/web/src/components/embed-snippet.tsx "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/embed-snippet.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/forms/[formId]/embed-snippet.tsx"
git commit -m "$(cat <<'EOF'
A bubble a visitor will actually open, and one snippet card instead of three

data-concierge joins data-form and data-booking in the same cached loader.
The conversation still lives entirely in the iframe — only the launcher and
the panel run in the host page's DOM, and both postMessage checks stay.
The snippet card is extracted at the third copy, as the calendar one's own
comment invited.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UuVS5XfWB6aZdX9b83RePF
EOF
)"
```

---

### Task 6: Standard for every client

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/voice-settings.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/actions.ts`
- Modify: `apps/web/src/lib/palette/registry.ts:56`
- Modify: `apps/web/src/lib/checklist-catalogue.ts`
- Modify: `apps/web/src/lib/messages.ts`
- Modify: `apps/web/src/lib/checklist-catalogue.test.ts`
- Modify: `apps/web/src/lib/palette/registry.test.ts`
- Modify: `apps/web/src/app/(dashboard)/styleguide/page.tsx`

**Interfaces:**
- Consumes: `enableConcierge`, `disableConcierge` (Task 1); `EmbedSnippet` (Task 5).
- Produces: nothing.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/lib/checklist-catalogue.test.ts`:

```ts
it("carries the concierge item, internal, so it reaches every new client", () => {
  const item = CHECKLIST_CATALOGUE.find((i) => i.key === "concierge_embed");
  expect(item).toBeDefined();
  // MUTATION: mark it external — this FAILS. The work happens in this app,
  // on the Voice page, and a "Done outside BIS" badge on it would be a lie
  // the checklist tells daily.
  expect(item!.external).toBe(false);
});
```

Add to `apps/web/src/lib/palette/registry.test.ts`:

```ts
it("finds the website assistant by the words an operator would type", () => {
  const entries = buildPaletteEntries(BASE, true);
  const voice = entries.find((e) => e.id === `nav:${BASE}/voice`)!;
  // MUTATION: remove the NAV_KEYWORDS entry — this FAILS, and an operator
  // typing "widget" finds nothing.
  for (const word of ["website", "widget", "chat", "concierge"]) {
    expect(voice.keywords).toContain(word);
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter web exec vitest run "checklist-catalogue|palette"`
Expected: FAIL on both.

- [ ] **Step 3: Add the catalogue item and the keywords**

In `apps/web/src/lib/checklist-catalogue.ts`, add to `CHECKLIST_CATALOGUE`:

```ts
  // Not external: this is done in this app, on the Voice page. No href — the
  // catalogue is a static module with no account id in scope, so the help
  // text names the destination, as every internal item does.
  { key: "concierge_embed", title: m["checklist.concierge_embed.title"],
    help: m["checklist.concierge_embed.help"], external: false },
```

In `apps/web/src/lib/messages.ts`, add the two keys. Copy that passes the
"landscaper at 7 AM" read — no "concierge", no "widget", no "embed":

```ts
  "checklist.concierge_embed.title": "Put the assistant on your website",
  "checklist.concierge_embed.help":
    "Turn on the website assistant from the Voice page, pick where its leads should land, then paste one line of code into your site. It answers questions and takes names around the clock.",
```

In `apps/web/src/lib/palette/registry.ts:56`, extend the `/voice` entry:

```ts
  "/voice": ["receptionist", "sofia", "ai", "website", "widget", "chat", "concierge", "bubble"],
```

⚠️ Do **not** add an entry to `SETTINGS_SECTIONS`. That list hard-codes
`${base}/settings#${anchor}` (`registry.ts:117`), and this section lives on
`/voice` — an entry there would emit a link to an anchor that does not exist.
The `/voice` destination is already a palette entry derived from
`buildNavGroups`, so DESIGN.md's registration rule is met by construction.

- [ ] **Step 4: Build the Website assistant card**

In `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/actions.ts`,
add a server action that calls `enableConcierge` / `disableConcierge` and
returns the public id. Guard it with the same `requireAccountAccess` the file's
existing actions use — read them and match.

In `voice-settings.tsx`, add the card, beside the `booking_enabled` and
`textback_enabled` checkboxes it is a sibling of:

- The toggle. **Disabled, with the reason stated in words, until a destination
  form is chosen** — the setup wizard's "locked, with a reason" shape. A
  control that can be clicked and does nothing is a control that lies.
- The destination-form select: published forms only, pre-selected when the
  account has exactly one. If the account has NO published form, the card says
  so in one sentence and links to Forms — that is the empty state, and it
  sells the next step rather than reporting a failure.
- `<EmbedSnippet attribute="data-concierge" publicId={...} origin={...} />`,
  shown only once the concierge is on and a public id exists.

Tokens only. One primary button on the view (DESIGN.md rule 8) — the page
already has one, so this card's actions are ghost.

- [ ] **Step 5: Add the styleguide entries**

In `apps/web/src/app/(dashboard)/styleguide/page.tsx`, add the message bubble
(both roles, plus the skeleton) and the launcher. DESIGN.md's definition of
done requires it for any new component or variant.

- [ ] **Step 6: Verify both themes and the blur fallback**

Run the app and check `/c/<publicId>` and the Voice card in dark AND light
through the app's `.dark` class — **not** `data-theme` — and with
`@supports not (backdrop-filter)`. Confirm the aurora reads THROUGH the card in
light, since `--surface-1` is translucent there too.

Run: `pnpm --filter web exec vitest run branding/theme`
Expected: PASS — the composite contrast sweep in both themes.

- [ ] **Step 7: Run the gates, one at a time**

```bash
gh run list --limit 3
pnpm check;                   echo $? > /tmp/check.exit
pnpm --filter web build;      echo $? > /tmp/build.exit
gh run list --limit 3
pnpm --filter web test:e2e;   echo $? > /tmp/e2e.exit
cat /tmp/check.exit /tmp/build.exit /tmp/e2e.exit
```

Expected: `0 0 0`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/checklist-catalogue.ts apps/web/src/lib/checklist-catalogue.test.ts apps/web/src/lib/messages.ts apps/web/src/lib/palette/registry.ts apps/web/src/lib/palette/registry.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice" "apps/web/src/app/(dashboard)/styleguide/page.tsx"
git commit -m "$(cat <<'EOF'
The website assistant is a switch every client has, not a favour we do one

A card on the Voice page turns it on, picks where its leads land, and hands
over the line to paste. A checklist item puts it in front of every new
client instead of depending on the agency remembering, and ⌘K finds it by
the words an operator would actually type.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UuVS5XfWB6aZdX9b83RePF
EOF
)"
```

---

## Self-review

**Spec coverage.** Every section of
`docs/superpowers/specs/2026-09-20-web-concierge-design.md` maps to a task:
the lead seam and Data → Task 1; the prompt's phone-shaped copy → Task 2;
tenant resolution and Screens → Tasks 1 and 3; the guards and the model call →
Tasks 3 and 4; consent → Task 4; delivery → Task 5; product surface → Task 6.
The spec's ten named test properties appear as: (1) and (2) in Task 1 Step 5
and Task 4 Step 2, (3) (4) (5) (6) (7) in Task 4 Step 2, (8) in Task 2 Step 1,
(9) in Task 1 Step 5, (10) in Task 5 Step 1.

**Known gap, stated rather than hidden.** The spec's `/c/[publicId]` visual
work (Task 3 Step 5's CSS) is specified by rule — tokens only, the 4px grid,
the two radii, the focus ring, reduced motion — rather than by literal
declarations, because DESIGN.md is the contract and `f/[publicId]/form.css` is
the worked example an implementer must read. Every other code step carries its
actual content. A reviewer should hold Task 3 to DESIGN.md's definition of
done, not to this plan's prose.

**Type consistency.** `ConciergeTurn`'s `role` is `"visitor" | "assistant"`
everywhere — the table comment, the accessor, the chat component's `Msg`, and
the route's mapping to OpenAI's `"user" | "assistant"`. `ConciergeProfile`
narrows `public_id` and `concierge_form_id` to non-null, which is what lets
Task 4 pass `profile.concierge_form_id` to `createConciergeConversation`
without a null check. `claimConciergeTurn` returns `number | null` in the
interface block, the accessor and the route's `claimed === null` test.
`enrich`'s eighth argument is `consentWithheld`, matching
`lib/forms/enrich.ts:33-45`'s real signature and the route test's
`mock.calls[0]![7]`.

**Two things the implementer must read before writing, not assume:** the real
signatures of `withRollback` / `actAs` / `withTestAccount` in
`packages/db/src/test/db.ts` and `fixtures.ts`, and the real fakes in
`embed-script.test.ts`. The last two tasks in this repo each lost a review
round to a brief that invented one of these.

**Three signatures corrected in this plan after it was first written**, by
reading the tree rather than trusting the draft — recorded so a reviewer can
see they were caught rather than missed:
`withTestAccount(fn: (db, accountId) => …)` takes TWO arguments and supplies
the client (`fixtures.ts:139`), so the tests above do not call `serviceDb()`;
`withRollback` takes ONE (`db.ts:4`) and `actAs(c, claims)` mutates the pg
session in place (`db.ts:22`); and `SubmissionInput`'s optional fields are
`?: string`, not `| null` (`forms.ts:147-155`). If anything else in this
plan's code disagrees with the tree, **the tree wins** — use the real
signature and record the deviation in the task report.
