# Call Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a caller asks to speak to a person, hand the live call to a number the business provides, and record honestly what happened.

**Architecture:** Entirely in TeXML. The AI's SIP `<Dial>` gains an `action` URL, so when the AI leg ends the caller stays connected and Telnyx fetches fresh instructions from us. A `transfer_to_human` tool persists the intent, then closes the socket; the action route dials the business with a timeout; a result route reads `DialCallStatus` and either stamps the call `transferred` or speaks an honest line. No Call Control client, no SIP REFER, no new credential.

**Tech Stack:** Next.js App Router route handlers (`runtime = "nodejs"`), TypeScript, Vitest, Supabase via `@bis/db`, Telnyx TeXML, OpenAI Realtime.

**Spec:** `docs/superpowers/specs/2026-09-15-call-handoff-design.md` — read it before Task 1.

## Global Constraints

- **Branch `feat/call-handoff`, base `41f54d1`.** Never push to `main`; land through a PR. Both CI jobs (`verify`, `e2e`) must be green **on the PR's current head commit**, read from the check runs, before any merge.
- **One migration, `0037`, and the orchestrator applies it — exactly once.** Implementers write migrations and their proof; they never apply them. If a later task appears to need a second migration, stop and escalate.
- **Prove every test by mutating the code it guards and watching it fail BY NAME.** Never by reading. Record the observed failure message. The previous feature shipped ten tests that could not fail on their own claim.
- **Execute every mutation row before trusting it.** Five prescribed rows in the last plan could not fail. A row that cannot fail is the same defect as a test that cannot fail, one level up. If a row cannot fail, say so and substitute one that can.
- **Run whole test files, never a `-t` filter.** A filter matching nothing reports a green run with everything skipped; that has produced a false green here.
- **A negative fixture must be CLOSE BUT NOT A MEMBER.** For prefix, set-membership or equality logic, a far-away value proves nothing. The last feature had four defects of exactly this shape — a string prefix, a string equality, a tenant, and a time boundary.
- **An XOR assertion pins "not both and not neither" and nothing else.** Any case that must land on a particular side has to name that side.
- **A constraint stated only in prose is a constraint nobody tests.** If this plan calls something binding, it owes that thing a mutation row.
- **Copy rule:** every caller-facing sentence must read plainly to a business owner at 7 AM. No jargon, no internal codes, no `{{template_syntax}}`. Spanish copy follows the profile's `languages` the same way the greeting does (`languages === "es" ? es : en`).
- **Transfer is offered ONLY when the account has a usable target.** Sofía must never offer what she cannot deliver — the rule the alert-phone readiness work settled on 2026-09-15.

---

## The correlation design, and the race it avoids

Read this before Task 1; three tasks depend on it.

When the AI's socket closes, **two things happen concurrently**: our lifecycle runs `finishCall` (database writes, possibly email and SMS), and Telnyx sees the SIP leg end and requests the `action` URL. Telnyx can easily win that race. So **the transfer intent must be persisted by the tool, synchronously, before the socket closes** — never by `finishCall`.

To let the action route find the right call, we mint our own token rather than depending on Telnyx's `CallSid`/`ParentCallSid`/Call-Control-ID being the same value — semantics this repo cannot verify locally:

1. The TeXML route generates a random `handoffToken` per call.
2. It goes in **two** places it controls: the SIP URI as `X-BIS-Handoff` (the identical smuggling trick `X-BIS-Called` already uses) and the `action` URL's query string.
3. The OpenAI webhook reads the header and stores it on the `calls` row.
4. The action route reads the token from **its own URL**, not from any Telnyx parameter, and looks up the row.

Both ends are ours. Nothing is inferred about the carrier's identifier semantics.

**Outcome is decided by the result route, not at socket close.** At socket close the caller has spoken, so `classifyOutcome` returns `abandoned` — correct, because at that instant nobody has reached a human yet. The `served` marker suppresses the wrong text-back. The result route then upgrades the row to `transferred` only on `DialCallStatus: completed`. A ring-out stays `abandoned`, which is the truth: the caller reached no one.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/db/supabase/migrations/0037_call_handoff.sql` | **Create.** `accounts.transfer_phone`, widen `calls.outcome`, `calls.handoff_token` + `handoff_requested_at`, grants. | 1 |
| `packages/db/src/voice.ts` | **Modify.** `CallOutcome` gains `transferred`; `startCallRow` accepts the token; new `markHandoffRequested`, `getCallByHandoffToken`, `setCallOutcome`. | 1 |
| `packages/db/src/accounts.ts` | **Modify.** `getTransferPhone`, `setTransferPhone`. | 1 |
| every `CallOutcome` consumer | **Modify.** Widening the union breaks the build until each is updated — they ship in one commit with it. | 1 |
| `apps/web/src/lib/voice/call-state.ts` | **Modify.** `ServedAction` gains `"transferred"` in **Task 1**; `withTransferred` (its only producer) and the tests that exercise it stay in **Task 2**, with Task 3's tool as the first caller. Split that way on purpose: adding a union member no code produces or branches on is behaviour-neutral, whereas the producer needs the behaviour test that rides with it. See Task 2's interface list. | 1 |
| `apps/web/src/lib/voice/handoff.ts` | **Create.** Pure: is a transfer possible, and to where. | 2 |
| `apps/web/src/lib/voice/tools/schemas.ts` + `tools/registry.ts` | **Modify.** The `transfer_to_human` tool. | 3 |
| `apps/web/src/lib/voice/call-events.ts` | **Modify.** `VoiceAction` gains `{ kind: "close" }`. | 3 |
| `apps/web/src/app/api/voice/incoming/route.ts` | **Modify.** Handle the close action; store the token; put `callRowId` in `ToolContext`. | 3 |
| `apps/web/src/app/api/voice/texml/route.ts` | **Modify.** Mint the token, add `action` + `X-BIS-Handoff` to the SIP dial. | 4 |
| `apps/web/src/app/api/voice/texml/handoff/route.ts` | **Create.** The post-AI decision point. | 4 |
| `apps/web/src/app/api/voice/texml/handoff-result/route.ts` | **Create.** Reads `DialCallStatus`; stamps or speaks. | 5 |
| `apps/web/src/lib/voice/system-prompt.ts` | **Modify.** Offer a transfer only when one is possible. | 6 |
| the account's voice settings page + actions | **Modify.** The agency sets `transfer_phone`. | 6 |
| `.env.example` | **Modify.** Any new knob, documented where its siblings are. | 4 |

---

### Task 1: Widen the outcome vocabulary and add the columns

**Files:**
- Create: `packages/db/supabase/migrations/0037_call_handoff.sql`
- Modify: `packages/db/src/voice.ts`, `packages/db/src/accounts.ts`
- Modify (**only `format.ts` is compiler-forced** — verified with `tsc`, not assumed; the rest are deliberate product decisions the compiler does NOT protect): `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/format.ts`, `apps/web/src/lib/messages.ts`, `apps/web/src/lib/voice/finish-call.ts`, `apps/web/src/lib/reports/weekly-metrics.ts`, `apps/web/src/lib/sms/alerts.ts`, `apps/web/src/lib/voice/summarize.ts`
- Test: `packages/db/src/test/voice.test.ts`, `packages/db/src/test/accounts.test.ts`, plus the existing tests of each consumer above

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CallOutcome = "booked" | "lead" | "message" | "abandoned" | "spam" | "transferred"`
  - `getTransferPhone(db, accountId): Promise<string | null>`
  - `setTransferPhone(db, accountId, e164OrNull, actorId): Promise<void>`
  - `startCallRow(db, accountId, { phoneNumberId, callerE164, handoffToken })` — the third field is new and optional
  - `markHandoffRequested(db, accountId, callRowId): Promise<void>`
  - `getCallByHandoffToken(db, token): Promise<{ id, account_id, handoff_requested_at } | null>`
  - `setCallOutcome(db, accountId, callRowId, outcome): Promise<void>`

  Tasks 3, 4 and 5 consume these exact names.

**This task must leave the tree green.** Widening a union that is used as `Record<CallOutcome, …>` breaks the build until every consumer has an entry, so the consumers ship in the same commit. Behaviour does not change: nothing yet produces `transferred`.

🔴 **Write the migration; do NOT apply it.** The orchestrator applies, exactly once. Report it as unapplied.

- [ ] **Step 1: Read the precedents before writing anything**

Read `packages/db/supabase/migrations/0035_alert_phone.sql` (the E.164 CHECK and the grant discipline — UPDATE granted narrowly, and the ABSENCE of a grant IS the control), `0019_voice_core.sql:44-69` (the `calls` table, its CHECK and its two indexes), and `packages/db/src/accounts.ts:180-187` (`getAlertPhone`, whose shape `getTransferPhone` mirrors).

- [ ] **Step 2: Write the migration**

Create `packages/db/supabase/migrations/0037_call_handoff.sql`. It must do exactly four things, each with a comment saying why:

1. `alter table public.accounts add column transfer_phone text` with a CHECK identical in shape to `accounts_alert_phone_check` (`transfer_phone is null or transfer_phone ~ '^\+[0-9]{8,15}$'`). The field IS the switch: null means no transfer is offered, and that is not a failure.
2. Widen `calls`'s outcome CHECK to include `'transferred'`. A CHECK cannot be altered in place — drop the existing constraint by name and add it back with the sixth value. Read the existing constraint's real name from the live schema rather than guessing it; if it is anonymous, name the new one explicitly.
3. `alter table public.calls add column handoff_token text` and `add column handoff_requested_at timestamptz`. Add a **unique** index on `handoff_token` — the action route looks a call up by it, and two calls sharing a token would transfer the wrong caller. A partial unique index (`where handoff_token is not null`) is correct here, since every pre-existing row has null.
4. Grants, following 0035's discipline exactly: `authenticated` must not gain UPDATE on the new `accounts` column, and the `calls` columns are written by `serviceDb()` only.

- [ ] **Step 3: Write the grants/schema proof test**

In `packages/db/src/test/`, following the shape of `alert-phone-grants.test.ts`, assert against the **live schema**: the `transfer_phone` column exists with its CHECK; `authenticated` has no UPDATE privilege on it; the `calls` outcome CHECK admits `'transferred'` and still rejects a value that is not in the list; `handoff_token`'s unique index exists.

The "still rejects" half matters — a widened CHECK that accidentally admits anything would pass a test that only inserts `'transferred'`.

- [ ] **Step 4: Run the proof and watch it FAIL honestly**

```bash
cd packages/db && npx vitest run src/test/<the new grants file>
```

Expected: FAIL, because the migration is not applied. Record which assertions fail and why. A positive grants test rightly fails pre-migration; do not round that up to "passing".

- [ ] **Step 5: Hand the migration to the orchestrator**

Report: the migration file path, that it is **NOT applied**, and the exact pre-flight state you observed (current latest migration, whether the columns exist). The orchestrator applies it and re-runs Step 4.

- [ ] **Step 6: Widen `CallOutcome` and add the db helpers**

In `packages/db/src/voice.ts`, add `"transferred"` to `CallOutcome` (currently at `:18`). Add, beside their siblings and matching their style, error-message convention and `.eq("account_id", …)` tenancy guard:

```ts
export async function markHandoffRequested(
  db: SupabaseClient, accountId: string, callRowId: string,
): Promise<void>
export async function getCallByHandoffToken(
  db: SupabaseClient, token: string,
): Promise<{ id: string; account_id: string; handoff_requested_at: string | null } | null>
export async function setCallOutcome(
  db: SupabaseClient, accountId: string, callRowId: string, outcome: CallOutcome,
): Promise<void>
```

`getCallByHandoffToken` is deliberately **not** account-scoped — the token IS the credential, and the caller has no account id in hand. It must therefore return the `account_id` so every subsequent read is scoped by it. Say that in a comment.

Extend `startCallRow` to accept an optional `handoffToken`.

In `packages/db/src/accounts.ts`, add `getTransferPhone` / `setTransferPhone` mirroring `getAlertPhone` and the alert-phone setter.

- [ ] **Step 7: Fix every consumer the compiler names**

```bash
cd apps/web && npx tsc --noEmit
```

Work through the errors. Each site needs a real decision, not a placeholder:

- `calls/format.ts`'s `OUTCOMES` — a new entry. Per DESIGN.md rule 3 it is dot + word, never colour alone. `transferred` is a **positive** outcome (the caller reached a person), so it belongs with `booked`/`lead`/`message` visually, not with the receding `abandoned`/`spam`. Use existing tokens only.
- `lib/messages.ts` — the `calls.outcome.transferred` label. One word a business owner reads at 7 AM.
- `finish-call.ts:106-107` `isMeaningful` — `transferred` is **NOT** meaningful. No staff alert and no alert text fire on a completed transfer: the decision runs inside `finishCall` at socket close, before the result route knows whether anyone picked up, so alerting would need a second send path inside a TeXML route — and a person who just spoke to the caller live already knows. Keep `isMeaningful` exported; a negative rule on a branch `classifyOutcome` never reaches is otherwise unfalsifiable.
- `weekly-metrics.ts:35` `ANSWERED_OUTCOMES` — add it. A call where the customer reached a person is answered by any honest reading.
- `lib/sms/alerts.ts` `composeCallAlertSms` — a fourth line beside the three at `:82-86`, same ASCII register.
- `lib/voice/summarize.ts` — the deterministic fact line must say the transcript covers only the part before the handoff. Do not let a half-call summarise as a whole one.

- [ ] **Step 8: Update each consumer's own tests, and prove them**

Every file you touched has a test. Add the `transferred` case to each, then mutate: remove `transferred` from `ANSWERED_OUTCOMES`, from `isMeaningful`, from `OUTCOMES`, and from the SMS composer, and confirm a NAMED test fails for each. Report the four messages.

- [ ] **Step 9: Run the suites**

```bash
cd apps/web && npx vitest run
cd packages/db && npx vitest run src/test/voice.test.ts src/test/accounts.test.ts
```

Both green. Report file/test counts.

- [ ] **Step 10: Commit**

```bash
git add packages/db apps/web
git commit -m "feat(db): 0037 a transfer number, and an outcome for reaching a human"
```

---

### Task 2: The pure handoff decisions

**Files:**
- Create: `apps/web/src/lib/voice/handoff.ts`, `apps/web/src/lib/voice/handoff.test.ts`
- Modify: `apps/web/src/lib/voice/call-state.ts`, `apps/web/src/lib/voice/call-state.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type HandoffTarget = { available: false; reason: "not-configured" | "own-number" } | { available: true; to: string }`
  - `resolveHandoffTarget(transferPhone: string | null, ownedNumbers: string[]): HandoffTarget` — `ownedNumbers` is every `testing` or `live` number on the account, from `listPhoneNumbersForAccount` filtered in JS
  - `newHandoffToken(): string` — 🔴 **must be `crypto.randomUUID()` or 32 crypto-random bytes. NEVER `Math.random()`.** The only token generator in the tree today is a TEST fixture using `Math.random().toString(36)`; correct there, catastrophic if copied here. This token is a credential: it authorises dialling a stranger on the tenant's trunk.
  - 🔴 **The two spoken lines belong to different families and are NOT interchangeable.** Getting this wrong is silent: the caller simply hears the wrong thing.
  - `handoffLine(languages: "en" | "es" | "both"): string` — a **MODEL INSTRUCTION**, what Sofía says before the socket closes. Handed to the still-open OpenAI socket as `response.instructions` exactly like `silenceGoodbye` (`incoming/route.ts:415`), so it carries the `Say exactly this and nothing else: "…"` wrapper. `both` → English, mirroring the greeting's rule at `incoming/route.ts:764`.
  - `transferFailedLine(languages: "en" | "es" | "both"): string` — **TeXML `<Say>` TEXT**, what the caller hears on a ring-out. Consumed by `/api/voice/texml/handoff-result` (Task 5), by which time the socket is closed and there is no model to instruct: a bare sentence, shaped like `texml/route.ts`'s `COPY`, never the wrapper. With the wrapper the caller literally hears "Say exactly this and nothing else: …". **`both` → English here too, NOT `sayXml`'s EN-then-ES pair**, for two reasons: (a) this sentence answers `handoffLine`, which the same caller heard in English seconds earlier on a `both` profile — the two bracket one moment and must match; (b) `sayXml` can offer both languages only because it emits the `<Say>` ELEMENTS and hangs `language="es-MX"` on the Spanish one, and this function returns text FOR one element, so a two-language string would be Spanish read by an English voice. The reasoning is restated in the function's own doc block.
  - `ServedAction` gains `"transferred"` **in Task 1** (behaviour-neutral union widening, no producer yet). `withTransferred(state): CallState` is **this task**, with its behaviour test.

  Tasks 3, 4 and 5 consume these exact names.

Read `apps/web/src/lib/sms/sender.ts:71-79` (`refusesAlertLoop`) first — `resolveHandoffTarget` is its twin, for the same reason, against the same broader set of owned numbers (`testing` **or** `live`).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { resolveHandoffTarget, newHandoffToken, handoffLine, transferFailedLine } from "./handoff";

describe("resolveHandoffTarget", () => {
  it("is unavailable when no number is configured — the field IS the switch", () => {
    expect(resolveHandoffTarget(null, ["+19565061545"]))
      .toEqual({ available: false, reason: "not-configured" });
  });
  it("is available when a number is set and is not ours", () => {
    expect(resolveHandoffTarget("+19562921696", ["+19565061545"]))
      .toEqual({ available: true, to: "+19562921696" });
  });
  it("REFUSES a number this account owns — transferring there loops the caller back into Sofía", () => {
    expect(resolveHandoffTarget("+19565061545", ["+19565061545"]))
      .toEqual({ available: false, reason: "own-number" });
  });
  it("refuses a SECOND owned number, not only the one calls arrive on", () => {
    // refusesAlertLoop's own history: it was widened from the single resolved
    // sender to every owned number because a second, still-provisioning number
    // was an unguarded loop.
    expect(resolveHandoffTarget("+19565550111", ["+19565061545", "+19565550111"]))
      .toEqual({ available: false, reason: "own-number" });
  });
  it("is available when the owned list is empty", () => {
    expect(resolveHandoffTarget("+19562921696", []))
      .toEqual({ available: true, to: "+19562921696" });
  });
});

describe("newHandoffToken", () => {
  it("is unguessable and unique across calls", () => {
    const seen = new Set(Array.from({ length: 500 }, () => newHandoffToken()));
    expect(seen.size).toBe(500);
    for (const t of seen) expect(t).toMatch(/^[A-Za-z0-9_-]{22,}$/);
  });
});

describe("spoken lines", () => {
  it("say something in both languages, and `both` takes English like the greeting does", () => {
    expect(handoffLine("es")).not.toBe(handoffLine("en"));
    expect(handoffLine("both")).toBe(handoffLine("en"));
    expect(transferFailedLine("both")).toBe(transferFailedLine("en"));
  });
  it("the failure line does not promise a callback nobody scheduled", () => {
    // The caller was already told they were being put through. The line must
    // say plainly that nobody picked up — not "we will call you back", which
    // nothing in this flow arranges.
    expect(transferFailedLine("en").toLowerCase()).not.toContain("call you back");
  });
});
```

For `call-state.test.ts`, add:

```ts
it("withTransferred marks the caller served, so the missed-call text-back cannot fire", () => {
  const s = withTransferred(emptyCallState());
  expect(s.served).toContain("transferred");
});
it("withTransferred is idempotent — served is append-only and deduplicated", () => {
  const s = withTransferred(withTransferred(emptyCallState()));
  expect(s.served.filter((a) => a === "transferred")).toHaveLength(1);
});
it("a transferred call still classifies abandoned at socket close — nobody has reached a human YET", () => {
  // The result route upgrades the row to `transferred` only on
  // DialCallStatus: completed. At socket close that is not yet known, and
  // claiming it would be a lie on a call that rings out.
  const s = withTransferred(withTranscript(emptyCallState(), {
    role: "caller", text: "can I speak to someone", at: new Date().toISOString(),
  }));
  expect(classifyOutcome(s)).toBe("abandoned");
});
```

- [ ] **Step 2: Run both files and verify they fail**

```bash
cd apps/web && npx vitest run src/lib/voice/handoff.test.ts src/lib/voice/call-state.test.ts
```

Expected: FAIL — `Failed to resolve import "./handoff"`, and `withTransferred is not a function`.

- [ ] **Step 3: Implement**

Create `handoff.ts`. `resolveHandoffTarget` mirrors `refusesAlertLoop`'s membership check and returns a tagged union rather than a boolean, because the caller needs the reason for its log line. `newHandoffToken` uses `crypto.randomUUID()` with the dashes stripped, or `crypto.randomBytes(16).toString("base64url")` — either satisfies the regex; pick one and say why in a comment. The two spoken lines follow the greeting's language rule (`languages === "es" ? es : en`), and the English failure line must be honest about nobody answering.

In `call-state.ts`, add `"transferred"` to `ServedAction` (`:41`) with a doc paragraph in the style of its three siblings, saying what it records and which single consumer reads it. Add `withTransferred` beside `withServed`'s existing helpers, deduplicating like they do. **Do not touch `classifyOutcome`.**

- [ ] **Step 4: Run and verify green**

```bash
cd apps/web && npx vitest run src/lib/voice/handoff.test.ts src/lib/voice/call-state.test.ts
```

- [ ] **Step 5: Prove by mutation**

| Mutation | Test that must fail |
|---|---|
| `resolveHandoffTarget` drops the owned-number check | `REFUSES a number this account owns …` |
| it checks only `ownedNumbers[0]` | `refuses a SECOND owned number …` |
| it returns `available: true` for a null number | `is unavailable when no number is configured …` |
| `resolveHandoffTarget` compares only the last 4 digits, or only a prefix | `compares the WHOLE number …` (needs BOTH near-miss fixtures — one differing in the final digit, one sharing the last four; neither catches the other's mutation) |
| `newHandoffToken` returns a constant | `is unique across calls and shaped the way every consumer's regex expects` |
| `newHandoffToken` uses `Math.random()` or a counter | `draws from the CSPRNG — not a counter, not Math.random`. **Uniqueness and character shape are not entropy** — a counter and a `Math.random()` generator both satisfy the shape test. The checkable property is the SOURCE, so the test spies on `crypto.randomUUID`. |
| `handoffLine` returns the same string for `es` and `en` | `says something different in Spanish, and \`both\` takes English …` |
| `transferFailedLine` returns the same string for `es` and `en` | `says something different in Spanish — the caller was just addressed in Spanish`. **Its own row**: the two lines are separate functions and a single row here previously let `transferFailedLine` ship with no `es ≠ en` assertion at all. |
| `transferFailedLine` is given `handoffLine`'s `Say exactly this and nothing else: "…"` wrapper | `is a BARE sentence: no model wrapper, no quote characters` — the wrapper would be read aloud to the caller by the `<Say>` |
| `transferFailedLine`'s Spanish assumes the caller is male (`comunicarlo`) | `does not guess the caller's gender` |
| `withTransferred` returns state unchanged | `withTransferred writes the marker …` (call-state) **and** `says the transcript stops at the handoff …` (summarize — which is why those tests build state through the wrapper, never `withServed(state, "transferred")`) |
| `wasServed` stops counting `"transferred"` as served | `does NOT text a caller we put THROUGH TO A PERSON` (finish-call.test.ts). **This is the behaviour mutation for the marker**, and it COMPILES — the union-member-removal mutation the spec used to prescribe is a `tsc` failure and proves nothing about the text-back. |
| `classifyOutcome` is changed to return `"transferred"` when served includes it | `a transferred call still classifies abandoned …` |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/voice/handoff.ts apps/web/src/lib/voice/handoff.test.ts apps/web/src/lib/voice/call-state.ts apps/web/src/lib/voice/call-state.test.ts
git commit -m "feat(voice): the pure decisions behind handing a call to a person"
```

---

### Task 3: The tool, the close action, and the lifecycle

**Files:**
- Modify: `apps/web/src/lib/voice/tools/schemas.ts`, `apps/web/src/lib/voice/tools/registry.ts`, `apps/web/src/lib/voice/call-events.ts`, `apps/web/src/app/api/voice/incoming/route.ts`
- Test: the existing test file for each

**Interfaces:**
- Consumes: `resolveHandoffTarget`, `handoffLine`, `withTransferred` (Task 2); `markHandoffRequested`, `startCallRow`'s `handoffToken` (Task 1).
- Produces: `VoiceAction` becomes `{ kind: "send"; payload: object } | { kind: "close" }`; `ToolContext` gains `callRowId: string | null` and `handoffTarget: HandoffTarget`.

Read `apps/web/src/lib/voice/tools/registry.ts:34-43` (`ToolContext`) and `call-events.ts:30-38` (`functionCallActions`, the only producer of actions) before editing.

🔴 **The race this task exists to avoid.** The tool MUST persist the intent with `markHandoffRequested` before returning. `finishCall` runs concurrently with Telnyx's request to the action URL and can lose that race; a tool that only marked in-memory state would transfer intermittently, which is worse than not transferring at all.

- [ ] **Step 1: Write the failing tests**

**Harness facts, confirmed — use these, do not invent helpers.** `registry.test.ts` has ONE shared `const ctx: ToolContext` (`:28`), not a factory; build variants with `{ ...ctx, callRowId, handoffTarget }`. State comes from `emptyCallState()`. The real signature is **`runTool(state, ctx, name, args)`** — state first.

In `registry.test.ts`:

```ts
it("transfer_to_human persists the intent BEFORE returning — finishCall is too late", async () => {
  // Telnyx requests the Dial action URL the moment the SIP leg ends, racing
  // finishCall's database writes. If the intent were written by finishCall,
  // the action route would sometimes see no transfer and hang up on a caller
  // who had just been told they were being put through.
  const c = { ...ctx, callRowId: "call-row-1", handoffTarget: { available: true, to: "+19562921696" } };
  const { state, result } = await runTool(emptyCallState(), c, "transfer_to_human", {});
  expect(markHandoffRequestedMock).toHaveBeenCalledWith(expect.anything(), c.accountId, "call-row-1");
  expect(result).toEqual({ ok: true });
  expect(state.served).toContain("transferred");
});

it("transfer_to_human refuses when no target is available, and writes nothing", async () => {
  const c = { ...ctx, callRowId: "call-row-1", handoffTarget: { available: false, reason: "not-configured" } };
  const { state, result } = await runTool(emptyCallState(), c, "transfer_to_human", {});
  expect(result).toEqual({ ok: false, error: expect.any(String) });
  expect(markHandoffRequestedMock).not.toHaveBeenCalled();
  expect(state.served).not.toContain("transferred");
});

it("transfer_to_human refuses when there is no call row to mark", async () => {
  // startCallRow fails open (the route's step 10), so callRowId can be null on
  // a real call. Transferring then would be unrecoverable: the action route
  // has nothing to find.
  const c = { ...ctx, callRowId: null, handoffTarget: { available: true, to: "+19562921696" } };
  const { result } = await runTool(emptyCallState(), c, "transfer_to_human", {});
  expect(result).toEqual({ ok: false, error: expect.any(String) });
  expect(markHandoffRequestedMock).not.toHaveBeenCalled();
});

it("a database failure while marking does NOT report success to the model", async () => {
  markHandoffRequestedMock.mockRejectedValueOnce(new Error("boom"));
  const c = { ...ctx, callRowId: "call-row-1", handoffTarget: { available: true, to: "+19562921696" } };
  const { state, result } = await runTool(emptyCallState(), c, "transfer_to_human", {});
  expect(result).toEqual({ ok: false, error: expect.any(String) });
  expect(state.served).not.toContain("transferred");
});
```

**Harness fact, confirmed and load-bearing.** `call-events.test.ts` MOCKS the registry (`vi.mock("./tools/registry")`), so `processCallEvent` never runs a real tool there. Its `ctx` is `{} as unknown as ToolContext`. That means the close decision must be derivable from what `processCallEvent` itself sees — the tool NAME and the RESULT `runTool` returned — and each test drives `runToolMock.mockResolvedValue({ state, result })`. Do NOT add a real tool context to this file.

In `call-events.test.ts`:

```ts
it("a successful transfer_to_human yields a close action after the spoken line", async () => {
  runToolMock.mockResolvedValue({ state: emptyCallState(), result: { ok: true } });
  const { actions } = await processCallEvent(emptyCallState(), ctx, {
    type: "response.function_call_arguments.done", name: "transfer_to_human", arguments: "{}", call_id: "c1",
  });
  expect(actions.map((a) => a.kind)).toEqual(["send", "send", "close"]);
});
it("a REFUSED transfer yields no close action — the call continues with Sofía", async () => {
  runToolMock.mockResolvedValue({ state: emptyCallState(), result: { ok: false, error: "no target" } });
  const { actions } = await processCallEvent(emptyCallState(), ctx, {
    type: "response.function_call_arguments.done", name: "transfer_to_human", arguments: "{}", call_id: "c1",
  });
  expect(actions.map((a) => a.kind)).toEqual(["send", "send"]);
});
it("no other tool ever yields a close action", async () => {
  runToolMock.mockResolvedValue({ state: emptyCallState(), result: { ok: true } });
  const { actions } = await processCallEvent(emptyCallState(), ctx, {
    type: "response.function_call_arguments.done", name: "take_message",
    arguments: JSON.stringify({ body: "call me" }), call_id: "c1",
  });
  expect(actions.some((a) => a.kind === "close")).toBe(false);
});
```

In `lifecycle.test.ts`, using that file's existing `startLifecycle` / `FakeWebSocket` harness:

```ts
it("a close action closes the socket, and only after the goodbye line has been sent", async () => {
  // The model must be able to say the handoff line before the socket dies.
  // Assert the ordering, not merely that both happened.
});
it("the handoff token from the TeXML SIP header reaches startCallRow", async () => {
  expect(startCallRowMock).toHaveBeenCalledWith(
    expect.anything(), expect.any(String),
    expect.objectContaining({ handoffToken: "tok_abc" }),
  );
});
```

Fill the first body using the harness already in the file. **Assert order explicitly** — a test that only checks "a send happened and a close happened" is the ordering-shaped vacuity this repo has shipped before. Two things that test must also pin, both found missing in review (2026-09-16) with the ordering assertion already in place and green:

- **The CONTENT of what goes to the socket**, not just that two sends happened.
  `sendSpy.mock.calls[1]` must parse to `{ type: "response.create", response: { instructions: handoffLine("en") } }`
  (`calls[0]` is the `conversation.item.create` tool reply — but ONLY after
  `sendSpy.mockClear()` next to the existing `order.length = 0`, because the
  900ms greeting send otherwise sits at `calls[0]` and every index shifts by one).
  This is the end-to-end half of "the handoff line reaches the model": without
  it, `ws.send(JSON.stringify({ ...(action.payload as object), response: undefined }))`
  — which silently drops `response.instructions` from EVERY tool reply — passed
  the whole domain, 28 files / 434 tests.
- **The playout BUDGET, not only the deferral.** One line before the existing
  advance: `await vi.advanceTimersByTimeAsync(4_999); expect(closeSpy).not.toHaveBeenCalled();`
  Without it, setting this branch's delay — or `CLOSE_AFTER_GOODBYE_MS` itself —
  to `0` left the file fully green, and in production a 0ms close cuts the
  sentence entirely, because `ws.send` only queues.

**And the cross-account boundary the spec calls "the boundary that matters"**
(`docs/superpowers/specs/2026-09-15-call-handoff-design.md:213-217`). Both
handoff reads run on `serviceDb()`, so RLS protects nothing: the account id
they are handed is the only thing between a caller and a stranger's phone.
Assert the ORDERING too — that the account was resolved from the dialled
number BEFORE either read fired, not merely that both happened:

```ts
it("both handoff reads are scoped to the account resolved FROM THE DIALLED NUMBER, and neither fires before that resolution", async () => {
  let releasePhoneRow!: (row: typeof PHONE_ROW) => void;
  getPhoneNumberByE164Mock.mockReturnValue(
    new Promise<typeof PHONE_ROW>((resolve) => { releasePhoneRow = resolve; }),
  );
  unwrapMock.mockResolvedValue(callIncomingEvent());
  const posted = POST(req());
  await flushMicrotasks();
  expect(getTransferPhoneMock).not.toHaveBeenCalled();
  expect(listPhoneNumbersForAccountMock).not.toHaveBeenCalled();
  releasePhoneRow({ ...PHONE_ROW, account_id: "acct-resolved-from-number" });
  expect((await posted).status).toBe(200);
  expect(getTransferPhoneMock).toHaveBeenCalledWith(expect.anything(), "acct-resolved-from-number");
  expect(listPhoneNumbersForAccountMock).toHaveBeenCalledWith(expect.anything(), "acct-resolved-from-number");
});
```

The account id is deliberately NOT `acct1`: it exists only on the row the
dialled-number lookup returns, so no literal anywhere in the route can reach it.

**Also add, in `src/lib/voice/session-config.test.ts`:** an OMITTED
`handoffAvailable` withholds `transfer_to_human`. The fail-closed direction of
that default was asserted only in prose (`session-config.ts:33`); relaxing
`=== true` to `!== false` passed 434 tests. There is no exposure today only
because the web demo hard-overrides `tools: []` — a different fact than the
default being safe.

- [ ] **Step 2: Run all three files and verify they fail**

```bash
cd apps/web && npx vitest run src/lib/voice/tools/registry.test.ts src/lib/voice/call-events.test.ts src/app/api/voice/incoming/lifecycle.test.ts
```

Expected: FAIL — `Unknown tool: transfer_to_human`, and no `close` kind exists.

**If any of these passes before the implementation, stop and find out why.**

- [ ] **Step 3: Implement**

**3a.** `schemas.ts` — add to `CORE_TOOLS` (so it is present regardless of `bookingEnabled`):

```ts
{ type: "function", name: "transfer_to_human",
  description: "Put the caller through to a person at the business. Use only when the caller asks to speak to someone.",
  parameters: { type: "object", properties: {}, required: [] } },
```

**Gate it on availability**: `toolSchemas` must NOT advertise this tool when `handoffTarget.available` is false, so the model cannot offer what cannot be delivered. Thread the flag in the way `bookingEnabled` already is (`schemas.ts:59-67`).

**3b.** `registry.ts` — add `"transfer_to_human"` to `ToolName`, add `callRowId` and `handoffTarget` to `ToolContext`, and add the case. Order inside it is load-bearing: check the target, check `callRowId`, `await markHandoffRequested(...)` inside a try/catch, and only then return `{ state: withTransferred(state), result: { ok: true } }`. On any refusal or throw, return `{ ok: false, error }` and leave state untouched.

**3c.** `call-events.ts` — widen `VoiceAction` to `{ kind: "send"; payload: object } | { kind: "close" }`. In the function-call branch, append `{ kind: "close" }` **after** the two existing sends, and only when the tool was `transfer_to_human` AND its result was `{ ok: true }`. A refused transfer must leave the call running.

**3d.** `incoming/route.ts` — at the single action-consumption site (`:536-540`), handle the new variant. It must close the socket **after** the queued sends have gone out; follow the cost cap's existing shape (`route.ts:340-350`) — send, then a short `setTimeout` before `ws.close()` — so the line plays out.

**The close-delay constant is `CLOSE_AFTER_GOODBYE_MS` (`route.ts:151`, 5000ms).** This plan originally said "reuse the existing close-delay constant" when there was none; it was minted during Task 3 and is now the ONE constant for all three endings — the cost cap's goodbye, the silence guard's, and the handoff line. Tasks 4–5 must reference it by name and must not mint a second literal: the cap's own tail budget (`maxSeconds`' 750s clamp) is derived from this number, so a second copy silently breaks that derivation.

**Clear `closeTimer` before arming a new one.** The handoff branch clears `capTimer` and `silenceTimer`; it must clear `closeTimer` too. Assigning over the variable leaves the previous timer armed: the cap fires at `maxSeconds`, arms its own 5s close, and a `transfer_to_human` landing inside that window arms a second one while the cap's keeps its original deadline and closes the socket mid-handoff-line. Found in review 2026-09-16, and the branch's own comment claimed this was already handled.

Also in this route: extract `X-BIS-Handoff` from the SIP headers (add a raw-value sibling to `sip-headers.ts` — the existing `numberFromHeader` coerces through `toE164` and would destroy a token), pass it to `startCallRow`, and put `callRowId` plus the resolved `handoffTarget` into `ToolContext`. The target is resolved from `getTransferPhone` and the account's owned numbers.

- [ ] **Step 4: Run and verify green**

```bash
cd apps/web && npx vitest run src/lib/voice/tools/registry.test.ts src/lib/voice/call-events.test.ts src/app/api/voice/incoming/lifecycle.test.ts src/app/api/voice/incoming/route.test.ts
```

- [ ] **Step 5: Prove by mutation**

| Mutation | Test that must fail |
|---|---|
| the tool returns `{ok:true}` without awaiting `markHandoffRequested` | `transfer_to_human persists the intent BEFORE returning …` |
| the tool marks state even when the target is unavailable | `transfer_to_human refuses when no target is available …` |
| the tool proceeds with a null `callRowId` | `transfer_to_human refuses when there is no call row …` |
| the catch reports `{ok:true}` | `a database failure while marking does NOT report success …` |
| the close action is emitted for every tool | `no other tool ever yields a close action` |
| the close action is emitted on a refused transfer | `a REFUSED transfer yields no close action …` |
| the close is emitted BEFORE the sends (`actions.unshift` in `call-events.ts`) | `call-events.test.ts > a successful transfer_to_human yields a close action after the spoken line` |
| a SYNCHRONOUS `ws.close()` in the route's action loop, in place of the deferred one | `lifecycle.test.ts > a close action closes the socket, and only after …` |
| `CLOSE_AFTER_GOODBYE_MS`, or the handoff branch's own delay, set to `0` | `lifecycle.test.ts > a close action closes the socket, and only after …` |
| the handoff branch assigns `closeTimer` without `clearTimeout`ing the old one | `lifecycle.test.ts > a transfer requested inside the cost cap's own 5s playout window …` |
| `ws.send(JSON.stringify({ ...(action.payload as object), response: undefined }))` | `lifecycle.test.ts > a close action closes the socket, and only after …` |
| either handoff read given a literal `"acct-someone-else"` instead of `accountId` | `lifecycle.test.ts > both handoff reads are scoped to the account resolved FROM THE DIALLED NUMBER …` |
| a handoff read fired above `getPhoneNumberByE164` (a prefetch/`Promise.all` refactor) | same test — its `not.toHaveBeenCalled()` half |
| `input.handoffAvailable === true` relaxed to `!== false` | `session-config.test.ts > an OMITTED handoffAvailable withholds transfer_to_human …` |
| `toolSchemas` advertises the tool with no target available | add a row if none exists — the model must not be offered it |
| `startCallRow` is called without the token | `the handoff token from the TeXML SIP header reaches startCallRow` |

**Why row 7 changed (recorded 2026-09-16).** It originally named the lifecycle
test, and that was false: `actions.unshift({ kind: "close" })` leaves
`lifecycle.test.ts` fully green (verified — 39 passed) while failing
`call-events.test.ts`. The route does not consume the array's order at all; it
defers the close by a timer, so an array position is invisible to it. The
route-level mutation that DOES work is a synchronous `ws.close()` in the action
loop (row 2 above), which fails the lifecycle test by name. **Generalise:** when
one layer buffers or defers what another layer ordered, an ordering mutation in
the producing layer can only be caught in the producing layer's own test.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/voice apps/web/src/app/api/voice/incoming
git commit -m "feat(voice): a tool that hands the caller over, and the action that ends the AI leg"
```

🔴 **Sequencing, for the ledger and for Task 6.** From the moment Task 3 lands,
the PROMISE is reachable: any account whose `transfer_phone` is non-null gets
`transfer_to_human` advertised on its next call, and a caller who asks for a
person hears "one moment, I'll put you through" — and then the AI leg closes
and **nothing dials anyone**, because the TeXML continuation (Task 4) and the
result route (Task 5) do not exist yet. The caller is hung up on mid-promise.

The only thing standing between a real caller and that experience today is that
no account has a `transfer_phone` value, and the only way to set one is the
settings field in **Task 6**. Therefore: **Task 6's settings UI must not land
ahead of Tasks 4–5.** If Task 6 is pulled forward for any reason, the field
must ship disabled or the tool gated off, not merely "not documented yet".

---

### Task 4: The TeXML continuation

**Files:**
- Modify: `apps/web/src/app/api/voice/texml/route.ts`, `apps/web/src/app/api/voice/texml/route.test.ts`
- Create: `apps/web/src/app/api/voice/texml/handoff/route.ts`, `apps/web/src/app/api/voice/texml/handoff/route.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `newHandoffToken`, `resolveHandoffTarget` (Task 2); `getCallByHandoffToken`, `getTransferPhone` (Task 1).
- Produces: the `/api/voice/texml/handoff` route. Task 5 adds the result route it points at.

Read `apps/web/src/app/api/voice/texml/route.ts` in full, especially `dialXml` and the `forwardXml`/`forwardTarget` pair, whose `callerId` reasoning (`:182-184` — Telnyx requires an owned number on the outbound leg) applies here unchanged.

- [ ] **Step 1: Write the failing tests**

For `route.test.ts` (the existing TeXML suite, which already mocks `@bis/db` wholesale):

```ts
it("the SIP dial carries an action URL and a handoff token", async () => {
  const xml = await get({ To: "+19565061545", From: "+19562921696" });
  expect(xml).toMatch(/<Dial[^>]*action="[^"]*\/api\/voice\/texml\/handoff\?t=[A-Za-z0-9_-]+"/);
  expect(xml).toContain("X-BIS-Handoff=");
});
it("the token in the action URL and the token on the SIP URI are the SAME token", async () => {
  // Two different tokens would mean the action route can never find the call.
  const xml = await get({ To: "+19565061545", From: "+19562921696" });
  const inAction = /action="[^"]*\?t=([A-Za-z0-9_-]+)"/.exec(xml)![1];
  const inUri = /X-BIS-Handoff=([A-Za-z0-9_-]+)/.exec(xml)![1];
  expect(inAction).toBe(inUri);
});
it("a fresh token per call — two calls never share one", async () => {
  const a = /X-BIS-Handoff=([A-Za-z0-9_-]+)/.exec(await get({ To: "+19565061545", From: "+1956...1" }))![1];
  const b = /X-BIS-Handoff=([A-Za-z0-9_-]+)/.exec(await get({ To: "+19565061545", From: "+1956...2" }))![1];
  expect(a).not.toBe(b);
});
it("the existing X-BIS-Called header is still present and unchanged", async () => {
  const xml = await get({ To: "+19565061545", From: "+19562921696" });
  expect(xml).toContain("X-BIS-Called=%2B19565061545");
});
```

For the new `handoff/route.test.ts`:

```ts
it("a call that asked to be transferred gets a Dial to the business number", async () => {
  getCallByHandoffTokenMock.mockResolvedValue({ id: "c1", account_id: "acct1", handoff_requested_at: "2026-09-16T00:00:00Z" });
  getTransferPhoneMock.mockResolvedValue("+19562921696");
  const xml = await post("tok_abc");
  expect(xml).toContain("<Dial");
  expect(xml).toContain(">+19562921696<");
  expect(xml).toContain('passDiversionHeader="true"');
  expect(xml).toMatch(/timeout="\d+"/);
  expect(xml).toMatch(/action="[^"]*handoff-result\?t=tok_abc"/);
});
it("a call that did NOT ask is hung up — this is the ordinary end of every other call", async () => {
  getCallByHandoffTokenMock.mockResolvedValue({ id: "c1", account_id: "acct1", handoff_requested_at: null });
  const xml = await post("tok_abc");
  expect(xml).toContain("<Hangup");
  expect(xml).not.toContain("<Dial");
});
it("an unknown token hangs up rather than dialling a default", async () => {
  getCallByHandoffTokenMock.mockResolvedValue(null);
  const xml = await post("tok_nope");
  expect(xml).toContain("<Hangup");
  expect(xml).not.toContain("<Dial");
});
it("a missing token hangs up", async () => {
  const xml = await post(undefined);
  expect(xml).toContain("<Hangup");
  expect(xml).not.toContain("<Dial");
});
it("the transfer number is read for the account the TOKEN resolved to, never one from the request", async () => {
  // The whole tenancy boundary of this feature. A transfer must never reach a
  // number belonging to a different account.
  getCallByHandoffTokenMock.mockResolvedValue({ id: "c1", account_id: "acct1", handoff_requested_at: "2026-09-16T00:00:00Z" });
  getTransferPhoneMock.mockResolvedValue("+19562921696");
  await post("tok_abc", { AccountSid: "acct-ATTACKER" });
  expect(getTransferPhoneMock).toHaveBeenCalledWith(expect.anything(), "acct1");
});
it("a target that is one of the account's own numbers is refused, not dialled", async () => {
  getCallByHandoffTokenMock.mockResolvedValue({ id: "c1", account_id: "acct1", handoff_requested_at: "2026-09-16T00:00:00Z" });
  getTransferPhoneMock.mockResolvedValue("+19565061545");
  listPhoneNumbersForAccountMock.mockResolvedValue([{ e164: "+19565061545", status: "testing" }]);
  const xml = await post("tok_abc");
  expect(xml).not.toContain("<Dial");
});
it("a database failure hangs up rather than 500ing at the carrier", async () => {
  getCallByHandoffTokenMock.mockRejectedValue(new Error("boom"));
  const res = await POST(req("tok_abc"));
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("<Hangup");
});
```

- [ ] **Step 2: Run both and verify they fail**

```bash
cd apps/web && npx vitest run src/app/api/voice/texml/route.test.ts src/app/api/voice/texml/handoff/route.test.ts
```

- [ ] **Step 3: Implement**

**3a.** In `texml/route.ts`, `dialXml` mints a token via `newHandoffToken()`, appends `X-BIS-Handoff={token}` to the SIP URI (URL-encoded, beside `X-BIS-Called`) **separated by `&amp;`, never a raw `&`**, and adds `action="{origin}/api/voice/texml/handoff?t={token}"` and `method="POST"` to the `<Dial>`. The origin must come from the same source the rest of the app uses for absolute URLs — find it, do not invent a new env var unless none exists; if you must add one, document it in `.env.example` beside its siblings.

🔴 **The `&` between the two URI parameters is the plan's own bug, corrected 2026-09-16 after it shipped.** That URI is XML CHARACTER DATA inside `<Sip>`, and a bare `&` is a fatal well-formedness error (XML 1.0 §2.4) — a parser reads `&X-BIS-Handoff` as an entity reference. The bridge carried ONE parameter and no separator until this task, so the document was valid until the moment a second one was added, and every real inbound call takes this path: a strict parser means total voice outage on deploy, a lenient one silently strips the token and fails every handoff closed with no symptom. The shipped fix escapes at the point the value becomes XML (`xmlText` in `texml/route.ts`), which also covers the `action` attribute and anything appended later. Emitting `&amp;` directly is equally correct; emitting `&` is not.

**3b.** Create `handoff/route.ts`, `runtime = "nodejs"`. It:
1. Reads `t` from its **own** query string. No token → `<Hangup/>`.
2. Looks the call up by token. Not found, or `handoff_requested_at` is null → `<Hangup/>`.
3. Reads `transfer_phone` **for the account the token resolved to**, and the account's owned numbers, and runs `resolveHandoffTarget`. Unavailable → `<Hangup/>` with a log line naming the reason.

   🔴 **Get the owned numbers from `listPhoneNumbersForAccount` (`packages/db/src/voice.ts:294`), filtering to `testing` or `live` in JS. Do NOT use `resolveSmsSender`.** It looks like the right helper — it already returns an `ownedNumbers` array widened to exactly that set — but it returns `{ ok: false, reason: "no_live_number" }` when an account has only a `testing` number, and a caller of it would then have no list at all. The loop guard would silently not run on precisely the accounts this feature is first tested against. Task 6's save-time guard must use the same source, for the same reason.
4. Otherwise returns `<Dial callerId="{the account's own number}" timeout="20" passDiversionHeader="true" action="{origin}/api/voice/texml/handoff-result?t={token}" method="POST">{target}</Dial>`.
5. The whole body sits in a try/catch that returns `<Hangup/>` — a 5xx to Telnyx mid-call is worse than a clean hangup. Note this is the one place in the voice path that deliberately does NOT fail open, because "open" here means dialling an unknown number.

Signature verification: match whatever `texml/route.ts` does today for its own POST, so the two routes cannot drift.

- [ ] **Step 4: Run and verify green**

- [ ] **Step 5: Prove by mutation**

| Mutation | Test that must fail |
|---|---|
| `dialXml` uses two separately-minted tokens | `the token in the action URL and the token on the SIP URI are the SAME token` |
| the token is a module-level constant | `a fresh token per call …` |
| the handoff route ignores `handoff_requested_at` | `a call that did NOT ask is hung up …` |
| it falls back to a default number when the token is unknown | `an unknown token hangs up rather than dialling a default` |
| it reads the account id from the request body instead of the token lookup | `the transfer number is read for the account the TOKEN resolved to …` |
| it skips `resolveHandoffTarget` | `a target that is one of the account's own numbers is refused …` |
| the catch rethrows | `a database failure hangs up rather than 500ing …` |
| `passDiversionHeader` is dropped | `a call that asked to be transferred gets a Dial …` |
| the `&` between the two SIP URI parameters is emitted unescaped | `the bridge WITH a dialed number — the document every real inbound call gets` (`texml/wellformed.test.ts`) |
| the caller id is "any owned number" instead of `calls.phone_number_id` | `the caller id is the number the caller DIALLED, not merely one the account owns` |
| the handoff route ignores how old `handoff_requested_at` is | `a stamp from an hour ago is refused — a logged token is not a key forever` |
| the token is also accepted from the request body | `a token in the BODY is not a credential — only the query string we wrote is` |
| `listPhoneNumbersForAccount` rejecting falls through to an empty list | `the owned-numbers read failing hangs up — the loop guard's input must never open` |

🔴 **No substring assertion can tell valid TeXML from invalid TeXML.** Applying the `&` fix above changed nothing in the suite: 130/130 green before and after, because every assertion measured that a token was PRESENT. `apps/web/src/app/api/voice/texml/wellformed.test.ts` parses every document either route emits and is the only test that catches the next parameter someone appends. It carries its own parser (this workspace has no `jsdom`, no `DOMParser` on Node 24, and no XML dependency) with negative controls that prove the parser can reject.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/voice/texml .env.example
git commit -m "feat(voice): continue the call after the AI leg, and dial the business"
```

---

### Task 5: The result route

**Files:**
- Create: `apps/web/src/app/api/voice/texml/handoff-result/route.ts` and its test

**Interfaces:**
- Consumes: `getCallByHandoffToken`, `setCallOutcome` (Task 1); `transferFailedLine` (Task 2).
- Produces: nothing.

🔴 **This route is reached with the SAME token Task 4 minted** — Task 4 points
its dial at `handoff-result?t=<that token>`, so `getCallByHandoffToken` here
resolves the same row. Two consequences. First, Task 4 deliberately does NOT
consume or clear the token, and must not be "hardened" to: doing so would break
this route before it is written. Second, if one-shot consumption is ever wanted,
it belongs at the END of this route — after the outcome is stamped and the
document is built — and nowhere earlier. Task 4 instead bounds the token by
RECENCY (`MAX_TOKEN_AGE_MS`, 10 minutes from `handoff_requested_at`), because
the token travels in a query string and therefore into carrier and platform
logs. That window is NOT inherited here and copying it would be a bug: this
route is fetched when the HUMAN conversation ends, which can be an hour after
`handoff_requested_at`. If this route wants a bound, it must measure from its
own fact — the moment the transfer dial started — not from when the caller
asked.

- [ ] **Step 1: Write the failing tests**

```ts
it("a completed transfer stamps the call `transferred`", async () => {
  await post("tok_abc", { DialCallStatus: "completed" });
  expect(setCallOutcomeMock).toHaveBeenCalledWith(expect.anything(), "acct1", "c1", "transferred");
});

it.each(["no-answer", "busy", "failed"])("%s speaks an honest line, never silence", async (status) => {
  // The caller was already told they were being put through. Silence is the
  // one unacceptable ending.
  const xml = await post("tok_abc", { DialCallStatus: status });
  expect(xml).toContain("<Say");
  expect(xml).toContain("<Hangup");
});

it.each(["no-answer", "busy", "failed"])("%s does NOT stamp the call transferred — nobody was reached", async (status) => {
  await post("tok_abc", { DialCallStatus: status });
  expect(setCallOutcomeMock).not.toHaveBeenCalled();
});

it("speaks Spanish for an es profile", async () => {
  getVoiceProfileMock.mockResolvedValue({ ...profile, languages: "es" });
  const xml = await post("tok_abc", { DialCallStatus: "no-answer" });
  expect(xml).toContain('language="es-MX"');
});

it("an unknown token does nothing and hangs up", async () => {
  getCallByHandoffTokenMock.mockResolvedValue(null);
  const xml = await post("tok_nope", { DialCallStatus: "completed" });
  expect(setCallOutcomeMock).not.toHaveBeenCalled();
  expect(xml).toContain("<Hangup");
});

it("a stamping failure still returns valid TeXML, never a 5xx", async () => {
  setCallOutcomeMock.mockRejectedValue(new Error("boom"));
  const res = await POST(req("tok_abc", { DialCallStatus: "completed" }));
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Run and verify it fails**

- [ ] **Step 3: Implement**

`runtime = "nodejs"`. Read `t` from the query string and `DialCallStatus` from the form body. Look the call up by token; unknown → `<Hangup/>`. On `completed`, `setCallOutcome(..., "transferred")` and return `<Hangup/>` (the caller is already talking to a person; this document only ends our side of the flow). On anything else, speak `transferFailedLine` in the profile's language and hang up, leaving the outcome as `finishCall` recorded it. Wrap everything so a failure still returns 200 with valid TeXML.

🔴 `transferFailedLine` returns **TeXML `<Say>` text — a bare sentence**, not a model instruction: the OpenAI socket closed before this route ran, so `handoffLine`'s `Say exactly this and nothing else: "…"` wrapper has no model to instruct and would be read aloud to the caller, quotes and all. Emit it as `<Say>{line}</Say>`, adding `language="es-MX"` when the profile's language is `es` (that attribute is what makes the Spanish sound Spanish). `both` resolves to English inside `transferFailedLine`, deliberately — it must match the `handoffLine` this caller heard seconds earlier, which also takes English on `both` — so this route does NOT emit `sayXml`'s EN-then-ES pair here.

- [ ] **Step 4: Run and verify green**

- [ ] **Step 5: Prove by mutation**

| Mutation | Test that must fail |
|---|---|
| stamp `transferred` regardless of status | `%s does NOT stamp the call transferred …` |
| treat `no-answer` as success | same |
| return `<Hangup/>` with no `<Say>` on failure | `%s speaks an honest line, never silence` |
| always use English | `speaks Spanish for an es profile` |
| stamp before checking the token | `an unknown token does nothing and hangs up` |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/voice/texml/handoff-result
git commit -m "feat(voice): stamp a completed handoff, and say something when nobody answers"
```

---

### Task 6: The prompt and the settings field

**Files:**
- Modify: `apps/web/src/lib/voice/system-prompt.ts` + test
- Modify: the account's voice settings page and its actions, plus `apps/web/src/lib/messages.ts`
- Test: the settings action test, and the page's own test

**Interfaces:**
- Consumes: `setTransferPhone` (Task 1), `HandoffTarget` (Task 2).
- Produces: nothing.

🔴 **The save-time owned-number guard reads `listPhoneNumbersForAccount`
filtered to `testing`/`live` in JS — never `resolveSmsSender`.** Same source and
same filter as the runtime guard Task 4 shipped in `handoff/route.ts`. If this
one uses `resolveSmsSender` instead, the two guards disagree on exactly the
accounts this feature ships to first: `resolveSmsSender` returns
`{ ok: false, reason: "no_live_number" }` for an account holding only a
`testing` number, so its caller gets no list, and the settings screen would
happily save a transfer number that the runtime guard then refuses to dial —
a business that thinks it is set up, and a caller who hears a hangup.

🔴 **Do not land this task ahead of Tasks 4–5.** See the sequencing note at the
end of Task 3: the settings field is the only way an account gets a non-null
`transfer_phone`, and a non-null `transfer_phone` is the only thing making
Sofía's "one moment, I'll put you through" reachable. Between Task 3 and Task 5
that promise is followed by a closed socket and no dial at all. This field is
the safety interlock, not a finishing touch.

- [ ] **Step 1: Write the failing tests**

```ts
// system-prompt.test.ts — buildSystemPrompt(input, now) takes TWO arguments
// (system-prompt.ts:11). Reuse the file's existing input fixture and clock.
it("offers to put the caller through when a transfer target is available", () => {
  const p = buildSystemPrompt({ ...input, handoffAvailable: true }, now);
  expect(p).toContain("transfer_to_human");
});
it("keeps today's take-a-message copy when no target is configured", () => {
  const p = buildSystemPrompt({ ...input, handoffAvailable: false }, now);
  expect(p).not.toContain("transfer_to_human");
  expect(p).toContain("offer to take a message");
});
```

```ts
// settings action test
it("saves a transfer number the agency typed", async () => { /* … */ });
it("refuses a number that is not E.164", async () => { /* … */ });
it("refuses a number this account owns, with a reason the operator can act on", async () => {
  // Same guard as the call path, checked at save time so the operator finds
  // out now rather than a caller finding out mid-call.
});
it("a blank value clears it — the field IS the switch", async () => { /* … */ });
it("a client-role user cannot set it", async () => {
  // Agency-only, like every other voice setting on this page.
});
```

- [ ] **Step 2: Run and verify they fail**

- [ ] **Step 3: Implement**

`system-prompt.ts` gains one conditional block, in the shape of the existing after-hours block (`:105-110`): when `handoffAvailable`, replace the "offer to take a message" clause in the IDENTITY line with an instruction to offer to put the caller through, and name the tool. When false, the current text is unchanged byte-for-byte.

The settings field follows the page's existing pattern for an agency-only value. It must run the same owned-number guard at save time and surface the reason. Copy lives in `messages.ts` with its siblings; no inline strings.

This is a UI change, so DESIGN.md's definition of done applies: tokens only, both themes through the `.dark` class, the blur fallback, loaded/empty/error states, keyboard, and the 7 AM copy read. If a new component or variant appears, `/styleguide` gets an entry.

- [ ] **Step 4: Run and verify green**

- [ ] **Step 5: Prove by mutation**

| Mutation | Test that must fail |
|---|---|
| the prompt always includes the transfer instruction | `keeps today's take-a-message copy when no target is configured` |
| it never includes it | `offers to put the caller through …` |
| the save path drops the owned-number guard | `refuses a number this account owns …` |
| the save path accepts any string | `refuses a number that is not E.164` |
| the agency-only check is removed | `a client-role user cannot set it` |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(voice): offer a person when there is one, and let the agency say who"
```

---

### Task 7: Gates, and the two things only a real call can settle

**Files:** none modified unless a gate fails.

- [ ] **Step 1: Run the three merge gates, ONE AT A TIME**

They share the one Supabase project, which also serves production. Capture each exit code to a file and read it.

```bash
pnpm check
pnpm --filter web build
pnpm --filter web test:e2e
```

Report the db/web file and test totals and the e2e pass count. If `demo-seed.test.ts` times out, that is a known load-induced flake — it takes ~90s alone against a 240s limit — but say so rather than silently re-running.

- [ ] **Step 2: Verify on a real call, twice**

Nothing in this repo can prove the carrier behaves as documented. Two calls to the testing number `+19565061545`, on production after merge, with the business's `transfer_phone` set to a phone you can answer:

1. **Ask for a person and answer.** Confirm: Sofía says the handoff line, the phone rings, the call connects, and the `calls` row ends `transferred` with `served` containing `transferred`. Confirm **no "Sorry we missed you" text arrives** — that is the defect this design exists to prevent, and it is the single most important observation.
2. **Ask for a person and do NOT answer.** Confirm the caller hears the failure line rather than silence, and the row is NOT stamped `transferred`.

Read the logs for the handoff route and the result route, and record the actual `DialCallStatus` values observed. If the action URL is never requested, the `<Dial action>` contract does not hold as documented and the whole flow needs rethinking — report that rather than working around it.

- [ ] **Step 3: Open the PR**

Title: **"Let a caller reach a person"**. The body must state: the TeXML-only mechanism and why no Call Control client was needed; the text-back defect and how `ServedAction` prevents it; that `transfer_phone` is agency-set and NOT possession-verified, with the asymmetry named; the migration; and the real-call results from Step 2.

- [ ] **Step 4: Do not merge until both checks are green ON THE PR's HEAD SHA**

`gh api repos/{owner}/{repo}/commits/{sha}/check-runs`. Read them; do not infer from the PR summary or an earlier run.

---

## Self-Review

**Spec coverage.** Transfer target column → Task 1. Owned-number guard → Tasks 2 (predicate), 4 (call path), 6 (save time). Caller-asks-only → Tasks 3 and 6. The flow's six steps → Tasks 3, 4, 5. `ServedAction` fourth member → Task 2. `calls.outcome` widening and every consumer → Task 1. Transcript honesty → Task 1 Step 7 (the fact line). Ring-out handling → Task 5. Caller ID and `passDiversionHeader` → Task 4. Cost bounding (`timeLimit`) → Task 4 Step 3. Testing section's tenancy boundary → Task 4's account-from-token test. Real-call verification → Task 7.

**Deliberately not in any task**, per the spec's out-of-scope: IVR menus, call queues, multiple destinations, warm transfer, recording the human half, possession-verifying `transfer_phone`, and any rule-based (after-hours) trigger. `VOICE_FORWARD_TO` is untouched.

**Type consistency.** `HandoffTarget` is the tagged union from Task 2 and is what `ToolContext` carries in Task 3 and what the handoff route computes in Task 4. `resolveHandoffTarget(transferPhone, ownedNumbers)` keeps that argument order at all three call sites. `newHandoffToken()` produces the string that travels as `X-BIS-Handoff`, is stored by `startCallRow`'s `handoffToken`, and is read back by `getCallByHandoffToken(db, token)`. `setCallOutcome(db, accountId, callRowId, outcome)` takes the account id because the token lookup returns it. `CallOutcome` includes `"transferred"` from Task 1 onward.

**One risk stated plainly.** The entire flow rests on Telnyx requesting the `<Dial action>` URL when the SIP leg ends. That is documented behaviour, but this repo has never used the attribute, and no test here can prove a carrier's conduct. Task 7 Step 2 is where it is settled, and it is a merge blocker rather than a PR blocker.
