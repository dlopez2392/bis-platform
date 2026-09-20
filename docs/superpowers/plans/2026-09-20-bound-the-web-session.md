# Bound the Web Session Before It Costs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound how many Realtime sessions the "Talk to Sofía" route will mint, and leave a record of every one — so an abandoned tab, a replayed ticket, or a scripted client cannot bill indefinitely with nothing to show it happened.

**Architecture:** `apps/web/src/app/api/voice/web/session/route.ts` mints an OpenAI ephemeral client secret and hands it to the browser, which then talks to OpenAI directly over WebRTC. This server is never in the media loop afterwards, so it cannot end a session — and OpenAI exposes no server-side session-lifetime parameter, so nothing else ends it either. What this server CAN control is how many sessions it agrees to mint. A new `voice_web_sessions` table becomes three things at once: the record that a session was minted, the per-IP and per-account counter that caps minting, and — via a unique index on the ticket's nonce — the replay store `web-demo.ts:83-86` says the deployment lacks. Every check happens BEFORE the OpenAI call, so a refused request costs nothing.

**Tech Stack:** TypeScript, Next.js route handlers, Supabase/Postgres (migration + RLS + grants), vitest.

## Global Constraints

- **This does not claim to cap session LENGTH, and no comment, copy or commit message may imply it does.** Verified 2026-09-20: OpenAI's ephemeral secret expires (~1 min) for *creating* a session; once established the session may continue past that, and OpenAI exposes no server-side lifetime parameter. `WEB_DEMO_MAX_SECONDS` stays advisory — told to the model, returned to the browser. What changes is the NUMBER of sessions, not the length of one.
- **Every new check runs before the `fetch` to `api.openai.com`** (`route.ts:183`). A refused request must cost zero.
- **Grants are the security boundary, not the policy** (`0040_call_proposals.sql:77-95`): this project's default ACL auto-grants everything to `anon` AND `authenticated` on every new table. The migration must `revoke all` then grant back only what is needed. This table is written and read only by `serviceDb()`, so it is service-role-only, like `screened_calls` — no `authenticated` grant at all.
- **This is NOT a `calls` row.** `calls` feeds `ANSWERED_OUTCOMES` and the weekly report's "calls answered"; a web session landing there would inflate a number a client reads on Monday. Same reasoning as `0039_screened_calls.sql`'s and `0040`'s own refusals to be `calls` rows.
- **IP handling follows the existing rule:** never store a raw IP. `hashIp` (`apps/web/src/lib/forms/guards.ts:105-107`) is the only way an address reaches the database, and the trust assumption in `f/[publicId]/actions.ts:23-38` (Vercel overwrites `x-vercel-forwarded-for`, never appends) carries over verbatim.
- **The check-then-act race is accepted, not fixed**, exactly as `packages/db/src/forms.ts:265-275` accepts it: concurrent requests can all pass the count before any row commits. Enforcement is approximate by design; the unique nonce is the only hard guarantee.
- Gates run ONE AT A TIME, exit codes read from files: `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`. Before `pnpm check` and before e2e, run `gh run list --limit 3` and wait for any in-progress run — the db suite, the e2e suite, CI and production share ONE Supabase project.
- Branch `fix/bound-the-web-session-before-it-costs`, already created from main `505b148` with this plan on it. Commit per task; do not push.
- **The orchestrator applies the migration, exactly once. An implementer never applies one.**
- Commit trailer, verbatim, on every commit:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01UuVS5XfWB6aZdX9b83RePF`

---

## File Structure

- **Create** `packages/db/supabase/migrations/0041_voice_web_sessions.sql` — the table, its indexes, RLS, grants.
- **Create** `packages/db/src/voice-web-sessions.ts` — the three accessors. Its own module rather than an addition to `voice.ts`: `voice.ts` is the phone path's data layer and a web session is deliberately not a call.
- **Create** `packages/db/src/test/voice-web-sessions-grants.test.ts` — the per-table grants proof every new table gets (`call-proposals-grants.test.ts` is the worked example).
- **Modify** `packages/db/src/index.ts` — one additive export line.
- **Modify** `apps/web/src/lib/voice/web-demo.ts` — `verifyTicket` returns the nonce; the three new caps; correct the comment that currently claims an abandoned tab cannot run up a bill.
- **Modify** `apps/web/src/lib/voice/web-demo.test.ts` — the nonce return and the corrected claim.
- **Modify** `apps/web/src/lib/forms/guards.ts` — export `clientIp`, moved from the form action so two callers share one trust assumption.
- **Modify** `apps/web/src/app/f/[publicId]/actions.ts` — import `clientIp` instead of defining it.
- **Modify** `apps/web/src/app/api/voice/web/session/route.ts` — the caps and the record, before the mint.
- **Modify** `apps/web/src/app/api/voice/web/session/route.test.ts` — the refusals and the zero-cost property.

---

### Task 1: The table, the accessors, and the grants proof

**Files:**
- Create: `packages/db/supabase/migrations/0041_voice_web_sessions.sql`
- Create: `packages/db/src/voice-web-sessions.ts`
- Create: `packages/db/src/test/voice-web-sessions-grants.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces, for Task 2:
  ```ts
  export type WebSessionRecord = { accountId: string; ticketNonce: string; ipHash: string; origin: string | null };
  /** false when this nonce was already used — a replay. Any other failure throws. */
  export function recordWebSession(db: SupabaseClient, input: WebSessionRecord): Promise<boolean>;
  export function countWebSessionsByIp(db: SupabaseClient, ipHash: string, sinceIso: string): Promise<number>;
  export function countWebSessionsForAccount(db: SupabaseClient, accountId: string, sinceIso: string): Promise<number>;
  ```

- [ ] **Step 1: Write the migration**

Create `packages/db/supabase/migrations/0041_voice_web_sessions.sql`:

```sql
-- One row per Realtime session this platform agreed to mint for a browser.
--
-- WHY THIS EXISTS. `api/voice/web/session` mints an OpenAI ephemeral client
-- secret and hands it to the visitor's browser, which then talks to OpenAI
-- DIRECTLY over WebRTC. This server is never in the media loop again, so it
-- cannot end that session — and OpenAI exposes no server-side session
-- lifetime parameter (verified 2026-09-20), so nothing else ends it either.
-- Before this table there was also no RECORD that a session happened: no
-- `calls` row, no counter, only a console.log. So an abandoned tab, a
-- replayed ticket or a scripted client could bill indefinitely and nobody
-- could tell. This table is what makes the one thing this server still
-- controls — HOW MANY sessions it agrees to mint — measurable and capped.
--
-- WHY THIS IS NOT A `calls` ROW. `calls` feeds ANSWERED_OUTCOMES and the
-- weekly report's "calls answered", a number a client reads on Monday
-- morning. A browser session is not a call and must never inflate it. Same
-- refusal, for the same reason, as 0039_screened_calls.sql and
-- 0040_call_proposals.sql.
create table public.voice_web_sessions (
  id uuid primary key default gen_random_uuid(),
  -- The tenant whose Sofía answered. Cascade so an account teardown carries
  -- these away, like call_proposals.
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- THE REPLAY STORE. web-demo.ts's ticket was documented as "not
  -- single-use, because there is no shared replay store in this deployment".
  -- There is one now: this column, unique, is it. A replayed ticket inside
  -- its 120s window hits this constraint instead of minting a second
  -- session.
  ticket_nonce text not null,
  -- HMAC-keyed, never the raw address (forms/guards.ts's hashIp). 32 hex
  -- chars.
  ip_hash text not null,
  -- Which allowlisted site vouched for this visitor. Nullable because the
  -- Origin header is a browser courtesy, not a guarantee.
  origin text,
  created_at timestamptz not null default now()
);

-- Single-use tickets, enforced by the database rather than by a check the
-- route could race against itself.
create unique index voice_web_sessions_nonce_key
  on public.voice_web_sessions (ticket_nonce);

-- The two counters the route reads before minting.
create index voice_web_sessions_ip_idx
  on public.voice_web_sessions (ip_hash, created_at desc);
create index voice_web_sessions_account_idx
  on public.voice_web_sessions (account_id, created_at desc);

alter table public.voice_web_sessions enable row level security;

-- ⚠️ THE GRANTS ARE THE SECURITY BOUNDARY HERE, NOT THE POLICY.
-- This project's default ACL auto-grants ALL privileges to `anon` AND
-- `authenticated` on every new table (0020_voice_grants_revoke.sql exists
-- because of exactly this; 0033 shipped without a grant block and still
-- carries INSERT/UPDATE/DELETE to `anon`). Revoke everything, then grant
-- back only what is needed.
--
-- Nothing but the route reads or writes this, and the route uses
-- serviceDb(). So: service_role only, no `authenticated` grant at all —
-- the same shape as screened_calls, and narrower than call_proposals,
-- which a human reviews in the UI. No policy is needed for service_role
-- (it bypasses RLS); RLS is enabled anyway so the table is never
-- accidentally world-readable if a grant is ever widened.
revoke all on public.voice_web_sessions from anon, authenticated;
grant select, insert, update, delete on public.voice_web_sessions to service_role;
```

- [ ] **Step 2: Write the failing grants test**

Create `packages/db/src/test/voice-web-sessions-grants.test.ts`.

**Read `packages/db/src/test/db.ts` FIRST and take the real signatures from it — the sketch below is illustrative, not authoritative, and its earlier version had two bugs worth knowing about:**

1. It invented `withRollback(async (db, fixture) => …)`. Read what `withRollback` actually passes.
2. Worse, it simulated the agency with **`actAsOwner`, which does `reset role`** — making the connection the TABLE OWNER, which bypasses grants entirely, so a "an agency admin cannot read this" test would have passed while proving nothing. Use `actAs(c, { app_role: "agency_admin" })`. `screened-calls-grants.test.ts` warns about this exact mistake in its own comment; read it.

**And assert the SHAPE of each denial, not merely that one occurred.** A missing table (`42P01`), a PostgREST schema-cache miss, and a real privilege denial (`42501`) all satisfy `expect(error).not.toBeNull()`. Only `42501` proves a grant. Pin the code.

Model the file on `packages/db/src/test/call-proposals-grants.test.ts`, including the random per-process `clerk_org_id` suffix, which exists because this suite shares production's one Supabase project. A guard that the table EXISTS belongs at the top: without it every "cannot" assertion below is vacuously true before the migration is applied.

Illustrative sketch — signatures to be corrected against `db.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withRollback, actAs, actAsOwner } from "./db";

// Mirrors call-proposals-grants.test.ts's shape. The claim under test is
// NARROWER than that table's: nothing but the service role may touch this
// one at all, because only the session route reads or writes it.
describe("voice_web_sessions grants", () => {
  it("a client user cannot select, insert, update or delete", async () => {
    await withRollback(async (db, fixture) => {
      const asClient = await actAs(db, fixture);
      for (const attempt of [
        asClient.from("voice_web_sessions").select("id").limit(1),
        asClient.from("voice_web_sessions").insert({
          account_id: fixture.accountId, ticket_nonce: `n_${Date.now()}`, ip_hash: "x".repeat(32),
        }),
        asClient.from("voice_web_sessions").update({ ip_hash: "y".repeat(32) }).eq("account_id", fixture.accountId),
        asClient.from("voice_web_sessions").delete().eq("account_id", fixture.accountId),
      ]) {
        const { error } = await attempt;
        expect(error, "expected a privilege error").not.toBeNull();
      }
    });
  });

  it("an agency admin cannot either — this table is service-role only", async () => {
    await withRollback(async (db, fixture) => {
      const asAgency = await actAsOwner(db, fixture);
      const { error } = await asAgency.from("voice_web_sessions").select("id").limit(1);
      expect(error, "expected a privilege error").not.toBeNull();
    });
  });

  it("the service role can write and read back", async () => {
    await withRollback(async (db, fixture) => {
      const nonce = `n_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const { error: insErr } = await db.from("voice_web_sessions").insert({
        account_id: fixture.accountId, ticket_nonce: nonce, ip_hash: "a".repeat(32), origin: "https://x.test",
      });
      expect(insErr).toBeNull();
      const { data, error } = await db.from("voice_web_sessions")
        .select("ticket_nonce").eq("ticket_nonce", nonce);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  });

  it("the same ticket nonce cannot be inserted twice — this is the replay guard", async () => {
    await withRollback(async (db, fixture) => {
      const nonce = `n_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const row = { account_id: fixture.accountId, ticket_nonce: nonce, ip_hash: "b".repeat(32) };
      const { error: first } = await db.from("voice_web_sessions").insert(row);
      expect(first).toBeNull();
      const { error: second } = await db.from("voice_web_sessions").insert(row);
      expect(second?.code, "expected a unique violation").toBe("23505");
    });
  });
});
```

- [ ] **Step 3: Run the grants test to verify it fails**

Run: `pnpm --filter @bis/db exec vitest run src/test/voice-web-sessions-grants.test.ts`
Expected: FAIL — the relation does not exist. **The migration has NOT been applied; the orchestrator applies it.** Record the failure, then report to the orchestrator that Task 1 is waiting on the migration, and STOP until told it is applied. Do not apply it yourself and do not work around it.

- [ ] **Step 4: (After the orchestrator applies the migration) write the accessors**

Create `packages/db/src/voice-web-sessions.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One minted browser session. `ticketNonce` is the website ticket's own
 * nonce (web-demo.ts's `<issuedAtMs>.<nonce>.<hmac>`), which the unique
 * index turns into single-use.
 */
export type WebSessionRecord = {
  accountId: string; ticketNonce: string; ipHash: string; origin: string | null;
};

/**
 * Records a minted session. Returns FALSE when this nonce was already used —
 * a replay, which the caller refuses — and throws on anything else.
 *
 * The distinction matters: a replay is an expected, refusable outcome of a
 * ticket that is valid but spent, while a broken database is not something
 * to answer with "forbidden". 23505 is the unique-violation code, the same
 * one createContact's duplicate-flag insert treats as the designed outcome
 * (contacts.ts).
 */
export async function recordWebSession(
  db: SupabaseClient, input: WebSessionRecord,
): Promise<boolean> {
  const { error } = await db.from("voice_web_sessions").insert({
    account_id: input.accountId,
    ticket_nonce: input.ticketNonce,
    ip_hash: input.ipHash,
    origin: input.origin,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`recordWebSession failed: ${error.message}`);
}

/** Sessions minted for this hashed IP since `sinceIso`. */
export async function countWebSessionsByIp(
  db: SupabaseClient, ipHash: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("voice_web_sessions")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash).gte("created_at", sinceIso);
  if (error) throw new Error(`countWebSessionsByIp failed: ${error.message}`);
  return count ?? 0;
}

/** Sessions minted against this account since `sinceIso`. The per-tenant
 *  ceiling: one client's public page must not exhaust a budget alone. */
export async function countWebSessionsForAccount(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("voice_web_sessions")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).gte("created_at", sinceIso);
  if (error) throw new Error(`countWebSessionsForAccount failed: ${error.message}`);
  return count ?? 0;
}
```

Add one line to `packages/db/src/index.ts`, beside the other `export *` lines (see `index.ts:76`'s `export * from "./voice";`):

```ts
export * from "./voice-web-sessions";
```

- [ ] **Step 5: Run the grants test to verify it passes**

Run: `pnpm --filter @bis/db exec vitest run src/test/voice-web-sessions-grants.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 6: Commit**

```bash
git add packages/db/supabase/migrations/0041_voice_web_sessions.sql packages/db/src/voice-web-sessions.ts packages/db/src/test/voice-web-sessions-grants.test.ts packages/db/src/index.ts
git commit -F - <<'MSG'
feat(db): record every web session so minting can be counted

The session route mints an OpenAI ephemeral secret and hands it to the
browser, which talks to OpenAI directly. This server is never in the media
loop again and OpenAI exposes no session-lifetime parameter, so nothing
can end a session once started. Before this table there was not even a
record one happened — no calls row, no counter, only a console.log.

One row per minted session makes the one thing this server still controls
countable: how many it agrees to mint. The unique index on the ticket's
nonce is also the replay store web-demo.ts documented as absent.

Not a calls row, deliberately: calls feeds the weekly report's "calls
answered", and a browser session must never inflate a number a client
reads on Monday. Service-role only — nothing but the route touches it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UuVS5XfWB6aZdX9b83RePF
MSG
```

---

### Task 2: Cap the minting, and stop claiming a cap that does not exist

**Files:**
- Modify: `apps/web/src/lib/voice/web-demo.ts` (the header comment at `:13-17`; `verifyTicket` at `:104-130`; new constants)
- Modify: `apps/web/src/lib/voice/web-demo.test.ts`
- Modify: `apps/web/src/lib/forms/guards.ts` (export `clientIp`)
- Modify: `apps/web/src/app/f/[publicId]/actions.ts` (import it instead of defining it)
- Modify: `apps/web/src/app/api/voice/web/session/route.ts`
- Modify: `apps/web/src/app/api/voice/web/session/route.test.ts`

**Interfaces:**
- Consumes from Task 1: `recordWebSession`, `countWebSessionsByIp`, `countWebSessionsForAccount` from `@bis/db`.
- Produces: `verifyTicket` now returns `{ ok: true; nonce: string }` on success; `WEB_SESSION_MAX_PER_IP`, `WEB_SESSION_WINDOW_MS`, `WEB_SESSION_MAX_PER_ACCOUNT_PER_DAY` exported from `web-demo.ts`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/lib/voice/web-demo.test.ts`, add:

```ts
  it("a verified ticket returns its nonce — the replay store keys on it", () => {
    const secret = "s3cret";
    const signed = signTicket(secret, 1_000_000, "nonce-abc");
    const verdict = verifyTicket(secret, signed, 1_000_000);
    expect(verdict).toEqual({ ok: true, nonce: "nonce-abc" });
  });
```

In `apps/web/src/app/api/voice/web/session/route.test.ts`, add — following the file's existing mocking shape for `@bis/db` and `fetch`:

```ts
  it("refuses a replayed ticket without calling OpenAI", async () => {
    // recordWebSession returns false when the nonce is already spent.
    recordWebSessionMock.mockResolvedValue(false);
    const res = await POST(requestWithValidTicket());
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses once this IP is over its window cap, without calling OpenAI", async () => {
    countWebSessionsByIpMock.mockResolvedValue(WEB_SESSION_MAX_PER_IP);
    const res = await POST(requestWithValidTicket());
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recordWebSessionMock).not.toHaveBeenCalled();
  });

  it("refuses once this ACCOUNT is over its daily cap, without calling OpenAI", async () => {
    countWebSessionsForAccountMock.mockResolvedValue(WEB_SESSION_MAX_PER_ACCOUNT_PER_DAY);
    const res = await POST(requestWithValidTicket());
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records the session BEFORE minting — a mint that is never recorded cannot be counted", async () => {
    const order: string[] = [];
    recordWebSessionMock.mockImplementation(async () => { order.push("record"); return true; });
    fetchMock.mockImplementation(async () => { order.push("mint"); return okClientSecretResponse(); });
    await POST(requestWithValidTicket());
    expect(order).toEqual(["record", "mint"]);
  });

  it("a counter that throws refuses the session rather than minting an uncounted one", async () => {
    // Fail CLOSED. This route spends money; a broken counter must not become
    // an open tap. Contrast the silence guard, which fails open because the
    // cost of its failure is one extra call, not an unbounded one.
    countWebSessionsByIpMock.mockRejectedValue(new Error("db down"));
    const res = await POST(requestWithValidTicket());
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter web exec vitest run src/lib/voice/web-demo.test.ts src/app/api/voice/web/session/route.test.ts`
Expected: FAIL — `verifyTicket` returns `{ok:true}` with no nonce; the route has no caps and calls `fetch` in every case. Record the failing names (RED evidence).

- [ ] **Step 3: Return the nonce, add the constants, correct the false claim**

In `apps/web/src/lib/voice/web-demo.ts`, change the `TicketResult` type and `verifyTicket`'s success return:

```ts
export type TicketResult =
  | { ok: true; nonce: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };
```

and at the end of `verifyTicket`, replace `return { ok: true };` with:

```ts
  // The nonce rides back out because it is the replay key: the caller
  // inserts it into voice_web_sessions, whose unique index is what finally
  // makes this ticket single-use. Until 0041 there was no store to do that
  // with, which is what the comment at the top of this file used to say.
  return { ok: true, nonce };
```

Update that top comment (`web-demo.ts:83-86`) from "not single-use, because there is no shared replay store in this deployment" to:

```ts
// Same shape and the same reasoning as `forms/guards.ts`'s render token, and
// single-use since 0041: the nonce returned by `verifyTicket` is inserted
// into `voice_web_sessions`, whose unique index refuses the second use. The
// short life is still the first line of defence; the store is the second.
```

Correct the false claim at `web-demo.ts:13-17`. It currently says the session "carries its own ceiling, told to Sofía AND enforced by the client", and that "an abandoned tab cannot run up a bill" (`:22-25`). The second half is untrue. Replace both passages with:

```ts
//   - A length the model is TOLD but nobody can enforce. A phone call runs
//     on a socket this server holds, so PHONE_MAX_CALL_SECONDS is a real
//     ceiling. A browser session does not: this server mints an ephemeral
//     secret and the browser talks to OpenAI directly, so it is never in
//     the media loop again — and OpenAI exposes no server-side session
//     lifetime (verified 2026-09-20). WEB_DEMO_MAX_SECONDS is therefore
//     ADVISORY: told to Sofía so she paces herself, returned to the client
//     so a well-behaved page can end the session. A page that does not, or
//     a client that skips the JS entirely, runs as long as it likes.
//     What IS enforced — server-side, before a secret is ever minted — is
//     HOW MANY sessions this route will agree to: see the three caps below
//     and `voice_web_sessions` (migration 0041).
```

Add the three constants beside `WEB_DEMO_MAX_SECONDS`:

```ts
/**
 * The caps that ARE enforced, all counted in the database before a secret is
 * minted (`voice_web_sessions`, 0041). They bound the NUMBER of sessions,
 * which is the only thing this server still controls once the browser is
 * talking to OpenAI directly.
 *
 * Deliberately not env-tunable, unlike the phone path's knobs: those were
 * tuned against real calls, and there is no comparable traffic here yet.
 * The day a real number justifies a change, that is a code change with a
 * reason in its commit message rather than a value someone set in a
 * dashboard and nobody can explain.
 */
export const WEB_SESSION_WINDOW_MS = 600_000;
/** Per hashed IP, per window. Matches forms' RATE_LIMIT_MAX: a visitor with
 *  a real question does not need a sixth session in ten minutes. */
export const WEB_SESSION_MAX_PER_IP = 5;
/** Per account, per rolling 24h. The per-tenant ceiling: one client's public
 *  page must not be able to exhaust a shared budget on its own. */
export const WEB_SESSION_MAX_PER_ACCOUNT_PER_DAY = 200;
```

- [ ] **Step 4: Share `clientIp` rather than copying it**

In `apps/web/src/lib/forms/guards.ts`, move `clientIp` in from `apps/web/src/app/f/[publicId]/actions.ts:23-43` — the whole function AND its doc comment, verbatim, since the trust assumption it states is the reason it can be trusted at all — and export it:

```ts
export function clientIp(h: Headers): string {
```

In `apps/web/src/app/f/[publicId]/actions.ts`, delete the local definition and add `clientIp` to the existing import from `@/lib/forms/guards`.

- [ ] **Step 5: Wire the route**

In `apps/web/src/app/api/voice/web/session/route.ts`:

Add to the `web-demo` import at `:22-24`: `WEB_SESSION_WINDOW_MS, WEB_SESSION_MAX_PER_IP, WEB_SESSION_MAX_PER_ACCOUNT_PER_DAY`. Add `import { clientIp, hashIp } from "@/lib/forms/guards";`.

Add the three accessors to the lazy `@bis/db` import at `:98-100`: `recordWebSession, countWebSessionsByIp, countWebSessionsForAccount`.

Then, inside the existing `try` block, AFTER `accountId` is resolved and the profile check passes (`route.ts:115`) and BEFORE the account brand read (`route.ts:121`), insert:

```ts
    // EVERY COST CHECK HAPPENS HERE, BEFORE THE MINT. A refused request must
    // cost nothing — no OpenAI call, and none of the work below it either.
    //
    // FAIL CLOSED, unlike the silence guard, which disarms itself when its
    // own predicate throws. The asymmetry is the point: that guard failing
    // open costs one extra call, this one failing open costs an unbounded
    // number of them.
    const ipHash = hashIp(clientIp(req.headers));
    const windowStart = new Date(Date.now() - WEB_SESSION_WINDOW_MS).toISOString();
    const dayStart = new Date(Date.now() - 86_400_000).toISOString();
    const [byIp, byAccount] = await Promise.all([
      countWebSessionsByIp(db, ipHash, windowStart),
      countWebSessionsForAccount(db, accountId, dayStart),
    ]);
    if (byIp >= WEB_SESSION_MAX_PER_IP) {
      log("refused: ip cap", { byIp });
      return refuse(429, "rate_limited", origin);
    }
    if (byAccount >= WEB_SESSION_MAX_PER_ACCOUNT_PER_DAY) {
      log("refused: account cap", { accountId, byAccount });
      return refuse(429, "rate_limited", origin);
    }
    // The record IS the replay guard: a nonce already spent hits 0041's
    // unique index and comes back false. Written BEFORE the mint, because a
    // session that is minted but never recorded is one the next request
    // cannot count.
    const fresh = await recordWebSession(db, {
      accountId, ticketNonce: verdict.nonce, ipHash, origin,
    });
    if (!fresh) {
      log("refused: ticket replayed", { accountId });
      return refuse(403, "forbidden", origin);
    }
```

The existing `catch` at `:177-180` already answers 503 on a throw, which is the fail-closed behaviour the test in Step 1 asserts — confirm that by reading it rather than adding a second catch.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter web exec vitest run src/lib/voice/web-demo.test.ts src/app/api/voice/web/session/route.test.ts src/app/f`
Expected: PASS, every test in all of them — including the form action's existing suite, which must be unaffected by the `clientIp` move.

- [ ] **Step 7: Mutation proof — the caps must be able to fail**

Run each, record which test goes red by name, revert before the next:

| Mutation | Must turn red |
|---|---|
| Move the `recordWebSession` call to AFTER the `fetch` | "records the session BEFORE minting" |
| Change `byIp >= WEB_SESSION_MAX_PER_IP` to `byIp > WEB_SESSION_MAX_PER_IP` | "refuses once this IP is over its window cap" |
| Make `recordWebSession` return `true` on 23505 instead of `false` | "refuses a replayed ticket" |

If any mutation leaves the suite green, STOP and report DONE_WITH_CONCERNS: the test is not guarding its claim.

- [ ] **Step 8: Run the gates, one at a time, exit codes from files**

Before `pnpm check` and before e2e: `gh run list --limit 3`, wait for any in-progress run.

1. `pnpm check` — expected exit 0, only the pre-existing `sms/alerts.test.ts` lint warning.
2. `pnpm --filter web build` — expected exit 0.
3. `pnpm --filter web test:e2e` — expected exit 0, `98 passed`, no `skipped` line.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/voice/web-demo.ts apps/web/src/lib/voice/web-demo.test.ts apps/web/src/lib/forms/guards.ts "apps/web/src/app/f/[publicId]/actions.ts" apps/web/src/app/api/voice/web/session/route.ts apps/web/src/app/api/voice/web/session/route.test.ts
git commit -F - <<'MSG'
fix(voice): bound how many web sessions we agree to mint

This route mints an OpenAI ephemeral secret and hands it to the browser,
which then talks to OpenAI directly. This server is never in the media
loop again, and OpenAI exposes no server-side session lifetime, so
WEB_DEMO_MAX_SECONDS was only ever advice to a page we do not own. The
file said an abandoned tab "cannot run up a bill". It could.

What this server can still control is how many sessions it agrees to
mint, so that is now enforced before any secret exists: a per-IP window
cap, a per-account daily cap, and single-use tickets via 0041's unique
nonce index — the replay store this file documented as absent. Every
check runs before the OpenAI call, so a refused request costs nothing,
and a counter that throws refuses rather than minting an uncounted
session: failing open here costs an unbounded number of calls, not one.

The comment claiming a ceiling nobody enforces is corrected rather than
left to mislead the next reader.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UuVS5XfWB6aZdX9b83RePF
MSG
```

---

## Self-review

**Spec coverage.** "A row per mint" → Task 1. "DB-backed per-IP and per-account-per-day caps on minting" → Task 2 Steps 3, 5. "Single-use tickets (needs the replay store)" → Task 1's unique index + Task 2's nonce return. "A plan must not imply a cap it cannot enforce" → the first Global Constraint, the corrected comment in Step 3, and the commit message. "Every check before the OpenAI call" → Step 5's placement plus the two `expect(fetchMock).not.toHaveBeenCalled()` assertions.

**Placeholder scan.** None; every code step carries its code. The one deliberate stop is Task 1 Step 3, where the implementer halts for the orchestrator to apply the migration — stated explicitly, not left implicit.

**Type consistency.** `verifyTicket` returns `{ ok: true; nonce: string }` (Task 2 Step 3) and the route reads `verdict.nonce` (Step 5). `recordWebSession` returns `Promise<boolean>` (Task 1) and Step 5 branches on `!fresh`. `WebSessionRecord.origin` is `string | null` and the route passes `origin`, typed `string | null` at `route.ts:60`. The two count functions take `(db, key, sinceIso)` in Task 1 and are called that way in Step 5.

**One thing this plan does NOT do, stated so nobody assumes otherwise:** it cannot end a session already running. That would need this server in the media loop (as the phone path is) or a lifetime parameter OpenAI does not offer. If session LENGTH ever needs a real bound, that is a different design — proxying the media, or moving the web path onto the same server-held socket the phone path uses — and it is not this.
