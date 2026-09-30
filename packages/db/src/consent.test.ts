import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  consentStateOf, readConsentState, recordCarrierBlock, appendConsentEvent, appendConsentEventGuarded,
  newestDecidingRow, readConsentHistory, readConsentEvent, readConsentActions, consentWriteArgs, consentAppendSql,
  CUSTOMER_STOP_METHODS, type ConsentRow,
} from "./consent";

/**
 * Spec §3's state table, pure (no database): the newest DECIDING row wins,
 * `granted` never decides (choice 28), ties break on id. The live reads and
 * writes are proven against the real table in src/test/consent-ledger-*.
 */
let seq = 0;
const row = (action: ConsentRow["action"], occurred_at: string, method: ConsentRow["method"] = "keyword", id?: string): ConsentRow =>
  ({ id: id ?? `00000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`, action, method, occurred_at });

describe("consentStateOf — spec §3's table", () => {
  it("no rows is allowed (mutation: drop the `!newest` guard → deciding[0] is undefined and newest.action throws, FAILS)", () => {
    expect(consentStateOf([])).toEqual({ state: "allowed" });
  });

  it("revoked is stopped, carrying its time, method and id", () => {
    const r = row("revoked", "2026-10-03T15:00:00Z", "keyword");
    expect(consentStateOf([r])).toEqual({ state: "stopped", since: r.occurred_at, method: "keyword", eventId: r.id });
  });

  it("held is held (mutation: collapse the ternary to always 'stopped' → FAILS)", () => {
    expect(consentStateOf([row("held", "2026-10-03T15:00:00Z", "free_text")]).state).toBe("held");
  });

  it("the same instant: revoked outranks held even when the held row has the LARGER id — a stop is never demoted by a later, restrictiveness-losing rank (review I1; mutation: rank held with or above revoked → held, FAILS)", () => {
    const stop = row("revoked", "2026-10-03T15:00:00Z", "keyword", "00000000-0000-0000-0000-00000000000a");
    const hold = row("held", "2026-10-03T15:00:00Z", "free_text", "00000000-0000-0000-0000-00000000000z");
    expect(consentStateOf([stop, hold]).state).toBe("stopped");
    expect(consentStateOf([hold, stop]).state).toBe("stopped");
  });

  it("resubscribed after revoked is allowed; revoked after resubscribed is stopped (mutation: sort ascending → FAILS)", () => {
    expect(consentStateOf([row("revoked", "2026-10-03T15:00:00Z"), row("resubscribed", "2026-10-04T15:00:00Z", "start_keyword")]).state).toBe("allowed");
    expect(consentStateOf([row("resubscribed", "2026-10-03T15:00:00Z", "start_keyword"), row("revoked", "2026-10-04T15:00:00Z")]).state).toBe("stopped");
  });

  it("a release newer than a keyword STOP lifts it, so the reducer alone cannot guard it: spec §3 line 153 puts that guard in PR-2's release function; a stop AFTER a release is stopped", () => {
    const hold = row("held", "2026-10-03T10:00:00Z", "free_text");
    const stop = row("revoked", "2026-10-03T11:00:00Z", "keyword");
    const release = row("hold_released", "2026-10-03T12:00:00Z", "staff");
    // Release newest: the order of events says allowed. PR-2's release
    // function writes hold_released ONLY while the state is held (spec §3,
    // "a keyword stop that lands in between cannot be undone by a stale
    // click"), so this row sequence never reaches the table.
    expect(consentStateOf([hold, stop, release]).state).toBe("allowed");
    expect(consentStateOf([hold, release, row("revoked", "2026-10-03T13:00:00Z")]).state).toBe("stopped");
  });

  it("granted NEVER decides, even newest (mutation: count granted as deciding → allowed, FAILS)", () => {
    const stop = row("revoked", "2026-10-03T15:00:00Z");
    expect(consentStateOf([stop, row("granted", "2026-10-05T15:00:00Z", "form")]).state).toBe("stopped");
    expect(consentStateOf([row("granted", "2026-10-05T15:00:00Z", "booking")])).toEqual({ state: "allowed" });
  });

  it("compares INSTANTS, not strings (mutation: compare occurred_at as strings → FAILS)", () => {
    // 16:00+02:00 is 14:00Z, an hour BEFORE 15:00Z, yet sorts after it as a
    // string: a string compare would call the stop newest.
    const earlier = row("revoked", "2026-10-03T16:00:00+02:00");
    const later = row("resubscribed", "2026-10-03T15:00:00+00:00", "start_keyword");
    expect(consentStateOf([earlier, later]).state).toBe("allowed");
  });

  it("the same instant: the more restrictive row wins, whatever the ids (mutation: tie-break on id only → allowed, FAILS)", () => {
    const stop = row("revoked", "2026-10-03T15:00:00Z", "keyword", "00000000-0000-0000-0000-00000000000a");
    const start = row("resubscribed", "2026-10-03T15:00:00Z", "start_keyword", "00000000-0000-0000-0000-00000000000b");
    expect(consentStateOf([stop, start]).state).toBe("stopped");
    expect(consentStateOf([start, stop]).state).toBe("stopped");
    const hold = row("held", "2026-10-03T16:00:00Z", "free_text", "00000000-0000-0000-0000-00000000000c");
    const release = row("hold_released", "2026-10-03T16:00:00Z", "staff", "00000000-0000-0000-0000-00000000000d");
    expect(consentStateOf([hold, release]).state).toBe("held");
  });

  it("the same instant and the same action: the larger id decides, deterministically (mutation: drop the id tiebreak → order-dependent, FAILS)", () => {
    const a = row("revoked", "2026-10-03T15:00:00Z", "keyword", "00000000-0000-0000-0000-00000000000a");
    const b = row("revoked", "2026-10-03T15:00:00Z", "carrier_block", "00000000-0000-0000-0000-00000000000b");
    expect(consentStateOf([a, b])).toMatchObject({ method: "carrier_block", eventId: b.id });
    expect(consentStateOf([b, a])).toMatchObject({ method: "carrier_block", eventId: b.id });
  });
});

/** A PostgREST-shaped chain that records what it was asked; `rpc` answers the write function. */
function fakeDb(o: {
  read?: { data: unknown; error: unknown };
  single?: { data: unknown; error: unknown };
  rpc?: { data: unknown; error: unknown };
} = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const k of ["select", "eq", "in", "order"]) {
    chain[k] = (...a: unknown[]) => { calls.push([k, ...a]); return chain; };
  }
  chain.limit = (...a: unknown[]) => { calls.push(["limit", ...a]); return Promise.resolve(o.read ?? { data: [], error: null }); };
  chain.maybeSingle = () => { calls.push(["maybeSingle"]); return Promise.resolve(o.single ?? { data: null, error: null }); };
  // readConsentActions ends at `.in(...)`: make the chain awaitable there.
  (chain as { then?: unknown }).then = (res: (v: unknown) => unknown) => res(o.read ?? { data: [], error: null });
  const appended = { data: [{ outcome: "appended", event_id: "e1", prior_id: null, prior_action: null, prior_method: null, prior_evidence: null }], error: null };
  const db = {
    from: (t: string) => { calls.push(["from", t]); return chain; },
    rpc: (fn: string, args: unknown) => { calls.push(["rpc", fn, args]); return Promise.resolve(o.rpc ?? appended); },
  } as unknown as SupabaseClient;
  return { db, calls };
}
const rpcArgs = (calls: Array<[string, ...unknown[]]>) => calls.find((c) => c[0] === "rpc")?.[2] as Record<string, unknown> | undefined;

describe("readConsentState", () => {
  it("asks for the newest deciding rows of that address, newest first, and takes 20 so every row at the newest instant reaches the tie-break (review R1-M2; mutation: .limit(1) → FAILS)", async () => {
    const f = fakeDb({ read: { data: [], error: null } });
    expect(await readConsentState(f.db, "a1", "sms", "+19562921696")).toEqual({ state: "allowed" });
    expect(f.calls).toEqual(expect.arrayContaining([
      ["from", "consent_events"],
      ["eq", "account_id", "a1"], ["eq", "channel", "sms"], ["eq", "address", "+19562921696"],
      ["in", "action", ["revoked", "held", "hold_released", "resubscribed"]],
      ["order", "occurred_at", { ascending: false }], ["order", "id", { ascending: false }],
      ["limit", 20],
    ]));
  });

  it("THROWS on a read error (the gate fails closed on it; mutation: return allowed → FAILS)", async () => {
    const f = fakeDb({ read: { data: null, error: { message: "permission denied" } } });
    await expect(readConsentState(f.db, "a1", "sms", "+19562921696")).rejects.toThrow("readConsentState failed: permission denied");
  });

  it("orders by occurred_at BEFORE id, both descending, in exactly that sequence (review I2a; mutation: swap the two .order() calls → FAILS)", async () => {
    const f = fakeDb({ read: { data: [], error: null } });
    await readConsentState(f.db, "a1", "sms", "+19562921696");
    expect(f.calls.filter((c) => c[0] === "order")).toEqual([
      ["order", "occurred_at", { ascending: false }],
      ["order", "id", { ascending: false }],
    ]);
  });
});

describe("newestDecidingRow — consentStateOf's own order, exported for the Texts row's CAS", () => {
  it("skips grants, takes the newest instant, then the more restrictive action (mutation: return rows[0] → the older revoked row wins, FAILS)", () => {
    const stop = row("revoked", "2026-10-03T15:00:00Z", "keyword", "00000000-0000-0000-0000-00000000000a");
    const lift = row("resubscribed", "2026-10-04T15:00:00Z", "start_keyword", "00000000-0000-0000-0000-00000000000b");
    const grant = row("granted", "2026-10-05T15:00:00Z", "form", "00000000-0000-0000-0000-00000000000c");
    expect(newestDecidingRow([stop, lift, grant])?.id).toBe(lift.id);
    expect(newestDecidingRow([grant])).toBeNull();
  });
});

describe("readConsentHistory / readConsentEvent / readConsentActions", () => {
  it("history reads the same 20 newest deciding rows WITH evidence, note and actor, filtered by account, channel and address (review I1; mutation: drop evidence from the select → FAILS; mutation: drop the account/channel/address filter → FAILS)", async () => {
    const f = fakeDb({ read: { data: [], error: null } });
    await readConsentHistory(f.db, "a1", "sms", "+19562921696");
    expect(f.calls).toEqual(expect.arrayContaining([
      ["select", "id, action, method, occurred_at, evidence, note, actor_id"],
      ["eq", "account_id", "a1"], ["eq", "channel", "sms"], ["eq", "address", "+19562921696"],
      ["in", "action", ["revoked", "held", "hold_released", "resubscribed"]], ["limit", 20],
    ]));
  });

  it("history THROWS on a read error — closeHoldTodo calls this with serviceDb(), so the account filter is the only tenant barrier and a swallowed error would read as an empty history (review I1; mutation: drop the throw → FAILS)", async () => {
    const f = fakeDb({ read: { data: null, error: { message: "permission denied" } } });
    await expect(readConsentHistory(f.db, "a1", "sms", "+19562921696")).rejects.toThrow("readConsentHistory failed: permission denied");
  });

  it("one event is read by account AND id, so another account's id reads nothing (mutation: drop the account filter → FAILS)", async () => {
    const f = fakeDb({ single: { data: null, error: null } });
    expect(await readConsentEvent(f.db, "a1", "e9")).toBeNull();
    expect(f.calls).toEqual(expect.arrayContaining([["eq", "account_id", "a1"], ["eq", "id", "e9"]]));
  });

  it("event THROWS on a read error (review I1; mutation: drop the throw → FAILS)", async () => {
    const f = fakeDb({ single: { data: null, error: { message: "permission denied" } } });
    await expect(readConsentEvent(f.db, "a1", "e9")).rejects.toThrow("readConsentEvent failed: permission denied");
  });

  it("actions by id: no ids is no read at all, and a real read is filtered by account AND the id list (mutation: read with an empty list → the chain is asked, FAILS; mutation: drop the account filter → FAILS)", async () => {
    const f = fakeDb();
    expect(await readConsentActions(f.db, "a1", [])).toEqual(new Map());
    expect(f.calls).toEqual([]);
    const g = fakeDb({ read: { data: [{ id: "e1", action: "held" }], error: null } });
    expect(await readConsentActions(g.db, "a1", ["e1"])).toEqual(new Map([["e1", "held"]]));
    expect(g.calls).toEqual(expect.arrayContaining([["eq", "account_id", "a1"], ["in", "id", ["e1"]]]));
  });

  it("actions THROWS on a read error (review I1; the title above no longer claims this untested — this is the real case; mutation: drop the throw → FAILS)", async () => {
    const f = fakeDb({ read: { data: null, error: { message: "permission denied" } } });
    await expect(readConsentActions(f.db, "a1", ["e1"])).rejects.toThrow("readConsentActions failed: permission denied");
  });
});

describe("appendConsentEventGuarded — the one write", () => {
  it("names the function and passes all thirteen arguments; a string guard has no expected id, { ifNewest } is `if_newest` with it (mutation: send { ifNewest } as its own string → FAILS)", async () => {
    expect(consentWriteArgs({ accountId: "a1", channel: "sms", address: "+19565550100", action: "revoked", method: "keyword" }, "unless_customer_stopped")).toEqual({
      p_account_id: "a1", p_channel: "sms", p_address: "+19565550100", p_action: "revoked", p_method: "keyword",
      p_guard: "unless_customer_stopped", p_expect_id: null, p_contact_id: null, p_actor_id: null, p_note: null,
      p_source_ref: null, p_evidence: {}, p_occurred_at: null,
    });
    expect(consentWriteArgs({ accountId: "a1", channel: "sms", address: "+1", action: "held", method: "staff_undo", actorId: "u" }, { ifNewest: "e7" }))
      .toMatchObject({ p_guard: "if_newest", p_expect_id: "e7", p_actor_id: "u" });
    expect(consentWriteArgs({ accountId: "a1", channel: "sms", address: "+1", action: "revoked", method: "staff" }, { ifNewest: null }))
      .toMatchObject({ p_guard: "if_newest", p_expect_id: null });
    const f = fakeDb();
    await appendConsentEventGuarded(f.db, { accountId: "a1", channel: "sms", address: "+19565550100", action: "revoked", method: "keyword" }, "unless_customer_stopped");
    expect(f.calls[0]?.[0]).toBe("rpc");
    expect(f.calls[0]?.[1]).toBe("append_consent_event");
  });

  it("maps each answer: appended carries the prior row, duplicate the first id, refused no id (mutation: map duplicate to appended → FAILS)", async () => {
    const prior = { prior_id: "p1", prior_action: "revoked", prior_method: "keyword", prior_evidence: { language: "es" } };
    const ok = fakeDb({ rpc: { data: [{ outcome: "appended", event_id: "e2", ...prior }], error: null } });
    expect(await appendConsentEventGuarded(ok.db, { accountId: "a", channel: "sms", address: "+1", action: "resubscribed", method: "start_keyword" }, "if_stopped_or_held"))
      .toEqual({ outcome: "appended", id: "e2", prior: { id: "p1", action: "revoked", method: "keyword", evidence: { language: "es" } } });
    const dup = fakeDb({ rpc: { data: [{ outcome: "duplicate", event_id: "e1", prior_id: null, prior_action: null, prior_method: null, prior_evidence: null }], error: null } });
    expect(await appendConsentEventGuarded(dup.db, { accountId: "a", channel: "sms", address: "+1", action: "revoked", method: "keyword" }, "none"))
      .toEqual({ outcome: "duplicate", id: "e1" });
    const no = fakeDb({ rpc: { data: [{ outcome: "refused", event_id: null, prior_id: null, prior_action: null, prior_method: null, prior_evidence: null }], error: null } });
    expect(await appendConsentEventGuarded(no.db, { accountId: "a", channel: "sms", address: "+1", action: "held", method: "free_text" }, "if_allowed"))
      .toEqual({ outcome: "refused", prior: null });
  });

  it("an RPC error, no row, or an unknown answer THROWS — a write is never assumed (mutation: return refused on error → FAILS)", async () => {
    const e = { accountId: "a", channel: "sms" as const, address: "+1", action: "revoked" as const, method: "keyword" as const };
    await expect(appendConsentEventGuarded(fakeDb({ rpc: { data: null, error: { message: "timeout" } } }).db, e, "none")).rejects.toThrow("append_consent_event failed: timeout");
    await expect(appendConsentEventGuarded(fakeDb({ rpc: { data: [], error: null } }).db, e, "none")).rejects.toThrow("returned no row");
    await expect(appendConsentEventGuarded(fakeDb({ rpc: { data: [{ outcome: "maybe" }], error: null } }).db, e, "none")).rejects.toThrow("unexpected answer");
    // review F3: 0055's future-occurred_at RAISE (errcode 22023) is a PostgREST error like any
    // other — it must surface as a THROWN error here too, never as a swallowed 'refused':
    await expect(appendConsentEventGuarded(
      fakeDb({ rpc: { data: null, error: { message: "p_occurred_at is in the future", code: "22023" } } }).db, e, "none",
    )).rejects.toThrow("append_consent_event failed: p_occurred_at is in the future");
  });

  it("refuses an occurredAt that does not parse to a finite date, without writing (mutation: drop the parse-guard → the rpc runs, FAILS)", async () => {
    const f = fakeDb();
    await expect(appendConsentEventGuarded(f.db, { accountId: "a1", channel: "sms", address: "+19565550100", action: "revoked", method: "carrier_block", occurredAt: "infinity" }, "none"))
      .rejects.toThrow("occurredAt does not parse to a finite date");
    expect(f.calls.some((c) => c[0] === "rpc")).toBe(false);
  });
});

describe("appendConsentEvent — the unguarded wrapper", () => {
  it("refuses hold_released outright: that row is written only with { ifNewest } on the hold (mutation: drop the refusal → the rpc runs with guard none, FAILS)", async () => {
    const f = fakeDb();
    await expect(appendConsentEvent(f.db, { accountId: "a1", channel: "sms", address: "+19565550100", action: "hold_released", method: "staff", actorId: "user_1" }))
      .rejects.toThrow("hold_released is written only by appendConsentEventGuarded");
    expect(f.calls.some((c) => c[0] === "rpc")).toBe(false);
  });

  it("writes with guard none and throws when the function refused, naming what it refused after (mutation: return a fake id on refusal → FAILS)", async () => {
    const f = fakeDb();
    expect(await appendConsentEvent(f.db, { accountId: "a1", channel: "sms", address: "+19565550100", action: "granted", method: "form" })).toEqual({ id: "e1" });
    expect(rpcArgs(f.calls)).toMatchObject({ p_guard: "none", p_action: "granted" });
    const g = fakeDb({ rpc: { data: [{ outcome: "refused", event_id: null, prior_id: "p", prior_action: "revoked", prior_method: "keyword", prior_evidence: {} }], error: null } });
    await expect(appendConsentEvent(g.db, { accountId: "a1", channel: "sms", address: "+1", action: "held", method: "free_text" }))
      .rejects.toThrow("refused (held after revoked)");
  });
});

describe("CUSTOMER_STOP_METHODS", () => {
  it("is exactly the five stops only the customer can lift (choice 19; the schema test 'unless_customer_stopped matches CUSTOMER_STOP_METHODS …' in consent-writes-schema.test.ts proves 0055's SQL list matches this export, method by method — this test only pins the TS constant itself; mutation: drop 'backfill_telnyx' → FAILS)", () => {
    expect([...CUSTOMER_STOP_METHODS].sort()).toEqual(["backfill_telnyx", "carrier_block", "keyword", "one_click", "unsubscribe_link"]);
  });
});

describe("recordCarrierBlock", () => {
  it("appends revoked / carrier_block with the kind as evidence, guarded unless_customer_stopped (mutation: guard 'none' → FAILS)", async () => {
    const f = fakeDb();
    expect(await recordCarrierBlock(f.db, { accountId: "a1", address: "+19562921696", contactId: "c1", kind: "voice.textback" })).toBe("appended");
    expect(rpcArgs(f.calls)).toMatchObject({ p_account_id: "a1", p_channel: "sms", p_address: "+19562921696", p_action: "revoked",
      p_method: "carrier_block", p_contact_id: "c1", p_evidence: { kind: "voice.textback" }, p_guard: "unless_customer_stopped" });
  });

  it("an address already stopped is 'already_stopped', decided inside the function's lock (spec §4.3 idempotency; mutation: map refused to appended → FAILS)", async () => {
    const f = fakeDb({ rpc: { data: [{ outcome: "refused", event_id: null, prior_id: "p", prior_action: "revoked", prior_method: "keyword", prior_evidence: {} }], error: null } });
    expect(await recordCarrierBlock(f.db, { accountId: "a1", address: "+19562921696", contactId: null, kind: "voice.textback" })).toBe("already_stopped");
  });
});

describe("consentAppendSql — the backfill's statement", () => {
  it("calls the function once with every argument a typed literal, quotes doubled (mutation: skip the quote doubling → the O'Brien name breaks out of its literal, FAILS)", () => {
    const sql = consentAppendSql({
      accountId: "11111111-1111-4111-8111-111111111111", channel: "sms", address: "+19565550100", action: "revoked",
      method: "backfill_telnyx", sourceRef: "telnyx_optout:+19565550000:+19565550100", occurredAt: "2026-04-28T12:00:38Z",
      evidence: { keyword: "STOP", note: "O'Brien" },
    }, "unless_customer_stopped");
    expect(sql).toBe(
      "select outcome, event_id from public.append_consent_event(" +
      "'11111111-1111-4111-8111-111111111111'::uuid, 'sms'::text, '+19565550100'::text, 'revoked'::text, 'backfill_telnyx'::text, " +
      "'unless_customer_stopped'::text, null::uuid, null::uuid, null::text, null::text, 'telnyx_optout:+19565550000:+19565550100'::text, " +
      "'{\"keyword\":\"STOP\",\"note\":\"O''Brien\"}'::jsonb, '2026-04-28T12:00:38Z'::timestamptz);");
  });

  it("refuses a value that would carry a backslash into the MCP (memory bis-mcp-sql-escapes; mutation: drop the backslash check → the statement is returned, FAILS)", () => {
    expect(() => consentAppendSql({ accountId: "a", channel: "sms", address: "+1", action: "revoked", method: "backfill_telnyx", evidence: { keyword: "ST\"OP" } }, "unless_customer_stopped"))
      .toThrow("backslash");
  });
});
