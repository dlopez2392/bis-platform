import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { consentStateOf, readConsentState, recordCarrierBlock, appendConsentEvent, type ConsentRow } from "./consent";

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

/** A PostgREST-shaped chain that records what it was asked. */
function fakeDb(o: { read?: { data: unknown; error: unknown }; insert?: { data: unknown; error: unknown } }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const k of ["select", "eq", "in", "order", "insert"]) {
    chain[k] = (...a: unknown[]) => { calls.push([k, ...a]); return chain; };
  }
  chain.limit = (...a: unknown[]) => { calls.push(["limit", ...a]); return Promise.resolve(o.read ?? { data: [], error: null }); };
  chain.single = () => Promise.resolve(o.insert ?? { data: { id: "e1" }, error: null });
  const db = { from: (t: string) => { calls.push(["from", t]); return chain; } } as unknown as SupabaseClient;
  return { db, calls };
}

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

  it("orders by occurred_at BEFORE id, both descending, in exactly that sequence (review I2a: `arrayContaining` above ignores call order, so a swap would survive it; mutation: swap the two .order() calls → FAILS)", async () => {
    const f = fakeDb({ read: { data: [], error: null } });
    await readConsentState(f.db, "a1", "sms", "+19562921696");
    const orderCalls = f.calls.filter((c) => c[0] === "order");
    expect(orderCalls).toEqual([
      ["order", "occurred_at", { ascending: false }],
      ["order", "id", { ascending: false }],
    ]);
  });

  it("guards consent-ledger-live.test.ts's premise, since that test is CI-only and cannot run here: a 20-row window truncates from whichever end the read is sorted from, and only the newest-first end keeps the deciding row that a wrong 21st-oldest row would otherwise roll off (mutation: order ascending in readConsentState — modeled here by reading the OLDEST 20 of 21 rows instead of the newest 20 — → 'stopped' instead of 'allowed', FAILS)", () => {
    const older = Array.from({ length: 20 }, (_, i) =>
      row("revoked", `2026-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`, "carrier_block"));
    const newest = row("resubscribed", "2026-09-01T10:00:00Z", "start_keyword");
    // The real query: newest-first, limit 20. Of the 21 rows, this window
    // is `newest` plus the 19 newest of `older` (the single oldest one
    // rolls off) — `newest` is the deciding row and it decides: allowed.
    const newestFirstWindow = [newest, ...older.slice(1)];
    expect(consentStateOf(newestFirstWindow).state).toBe("allowed");
    // The mutated query: oldest-first, limit 20. Of the same 21 rows, this
    // window is all 20 of `older` — `newest` is the 21st and oldest-last,
    // so it rolls off, and every row left is `revoked`: stopped.
    const oldestFirstWindow = older;
    expect(consentStateOf(oldestFirstWindow).state).toBe("stopped");
  });
});

describe("recordCarrierBlock", () => {
  it("appends revoked / carrier_block with the kind as evidence (mutation: drop `evidence: { kind: input.kind }` → evidence mismatches, FAILS)", async () => {
    const f = fakeDb({ read: { data: [], error: null } });
    expect(await recordCarrierBlock(f.db, { accountId: "a1", address: "+19562921696", contactId: "c1", kind: "voice.textback" })).toBe("appended");
    const insert = f.calls.find((c) => c[0] === "insert")?.[1];
    expect(insert).toMatchObject({ account_id: "a1", channel: "sms", address: "+19562921696", action: "revoked",
      method: "carrier_block", contact_id: "c1", evidence: { kind: "voice.textback" } });
  });

  it("an address already stopped gets NO second row (spec §4.3 idempotency; mutation: always append → FAILS)", async () => {
    const f = fakeDb({ read: { data: [row("revoked", "2026-10-03T15:00:00Z")], error: null } });
    expect(await recordCarrierBlock(f.db, { accountId: "a1", address: "+19562921696", contactId: null, kind: "voice.textback" })).toBe("already_stopped");
    expect(f.calls.some((c) => c[0] === "insert")).toBe(false);
  });

  it("a HELD address still gets a new revoked row: only 'stopped' short-circuits, never 'held' (review m3; mutation: skip whenever state !== 'allowed' → also skips 'held', FAILS)", async () => {
    const f = fakeDb({ read: { data: [row("held", "2026-10-03T15:00:00Z", "free_text")], error: null } });
    expect(await recordCarrierBlock(f.db, { accountId: "a1", address: "+19562921696", contactId: null, kind: "voice.textback" })).toBe("appended");
    expect(f.calls.some((c) => c[0] === "insert")).toBe(true);
  });
});

describe("appendConsentEvent", () => {
  it("refuses hold_released until PR-2's guarded write exists, and writes nothing (mutation: drop the refusal → the insert runs, FAILS)", async () => {
    const f = fakeDb({});
    await expect(appendConsentEvent(f.db, { accountId: "a1", channel: "sms", address: "+19565550100", action: "hold_released", method: "staff", actorId: "user_1" }))
      .rejects.toThrow("hold_released needs PR-2's guarded write");
    expect(f.calls.some((c) => c[0] === "insert")).toBe(false);
  });

  it("throws when the insert is refused — a CHECK violation is never swallowed", async () => {
    const f = fakeDb({ insert: { data: null, error: { message: "violates check constraint" } } });
    await expect(appendConsentEvent(f.db, { accountId: "a1", channel: "sms", address: "bad", action: "revoked", method: "staff" }))
      .rejects.toThrow("violates check constraint");
  });

  it("refuses an occurredAt that does not parse to a finite date, without writing (orchestrator decision; mutation: drop the parse-guard → the insert runs, FAILS)", async () => {
    const f = fakeDb({});
    await expect(appendConsentEvent(f.db, { accountId: "a1", channel: "sms", address: "+19565550100", action: "revoked", method: "carrier_block", occurredAt: "infinity" }))
      .rejects.toThrow("occurredAt does not parse to a finite date");
    expect(f.calls.some((c) => c[0] === "insert")).toBe(false);
  });
});
