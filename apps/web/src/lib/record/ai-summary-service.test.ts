import { describe, it, expect, vi } from "vitest";
import { serveRecordSummary, type SummaryDeps } from "./ai-summary-service";
import { inputDigest, type SummaryInputs } from "./ai-summary-inputs";
import { SUMMARY_PROMPT_VERSION } from "./ai-summary-prompt";
import { AI_REFUSALS } from "@/lib/ai/gateway";

const INPUTS: SummaryInputs = {
  who: { firstName: "SENTINEL-NAME-7f3", language: null, since: "2025-12", source: null },
  facts: { bookingsMade: 1, lastTalked: null, openDeals: { count: 0, amount: 0 } },
  bookings: [{ at: "2026-10-20 10:00", status: "booked" }], nextBooking: null, deals: [], todos: [], documents: [], calls: [],
};
const DIGEST = inputDigest(INPUTS, SUMMARY_PROMPT_VERSION);
const OLD = "0".repeat(64);
const OPEN = { globalEnabled: true, accountEnabled: true, budgetMicroUsd: 10_000_000, monthSpendMicroUsd: 0, recordSummariesToday: 0 };
const NOW = new Date("2026-10-18T14:42:00.000Z");
const ROW = (digest: string) => ({ body: "Cached paragraph.", inputDigest: digest, model: "gpt-4o-mini", generatedAt: "2026-10-17T14:00:00.000Z" });

// Every dependency call is recorded by the wrapper, whether the default or an override answers it, so an
// override can never hide a call the service made.
function deps(over: Partial<SummaryDeps> = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const impl: SummaryDeps = {
    gate: async () => OPEN,
    cached: async () => null,
    claim: async () => ({ status: "won", leaseId: "L1" }),
    complete: async () => ({ ok: true, text: "  SENTINEL-OUTPUT-7f3 booked.  ", usage: { inputTokens: 100, outputTokens: 20, costMicroUsd: 27 } }),
    save: async () => true,
    release: async () => {},
    now: () => NOW,
    log: (line) => { logs.push(line); },
    ...over,
  };
  const d: SummaryDeps = {
    gate: () => { calls.push("gate"); return impl.gate(); },
    cached: () => { calls.push("cached"); return impl.cached(); },
    claim: (digest, force) => { calls.push(`claim ${digest === DIGEST ? "new" : "other"} ${force}`); return impl.claim(digest, force); },
    complete: (messages) => { calls.push("complete"); return impl.complete(messages); },
    save: (s) => { calls.push(`save ${s.leaseId} ${s.body} ${s.digest === DIGEST} ${s.generatedAt}`); return impl.save(s); },
    release: (l) => { calls.push(`release ${l}`); return impl.release(l); },
    now: () => impl.now(),
    log: (line) => impl.log(line),
  };
  return { d, calls, logs };
}
const serve = (d: SummaryDeps, force = false) => serveRecordSummary(d, { inputs: INPUTS, language: "es", force, stamp: (iso) => `stamp ${iso}` });

describe("serveRecordSummary (spec 4.2, 4.4-4.6; plan deviations 2, 3, 21)", () => {
  it("missing -> claims, writes, saves under its lease and answers ready (mutation: skip save -> FAILS)", async () => {
    const { d, calls } = deps();
    expect(await serve(d)).toEqual({ state: "ready", text: "SENTINEL-OUTPUT-7f3 booked.", generatedAt: NOW.toISOString(), language: "es", stamp: `stamp ${NOW.toISOString()}` });
    expect(calls).toEqual(["gate", "cached", "claim new false", "complete", `save L1 SENTINEL-OUTPUT-7f3 booked. true ${NOW.toISOString()}`]);
  });
  it("same digest -> serves the cache with no claim and no completion (mutation: compare against a constant digest -> FAILS)", async () => {
    const { d, calls } = deps({ cached: async () => ROW(DIGEST) });
    expect(await serve(d)).toMatchObject({ state: "ready", text: "Cached paragraph.", generatedAt: "2026-10-17T14:00:00.000Z" });
    expect(calls).toEqual(["gate", "cached"]);
  });
  it("changed digest -> regenerates (mutation: serve any cached body -> FAILS)", async () => {
    const { d, calls } = deps({ cached: async () => ROW(OLD) });
    expect((await serve(d)).state).toBe("ready");
    expect(calls).toContain("complete");
  });
  it("Regenerate forces past a fresh cache (mutation: ignore force -> no claim -> FAILS)", async () => {
    const { d, calls } = deps({ cached: async () => ROW(DIGEST) });
    await serve(d, true);
    expect(calls).toContain("claim new true");
  });
  it("Regenerate within the minute answers the paragraph unchanged (plan deviation 21; mutation: map too_soon to generating -> FAILS)", async () => {
    const { d, calls } = deps({ cached: async () => ROW(DIGEST), claim: async () => ({ status: "too_soon" }) });
    expect(await serve(d, true)).toMatchObject({ state: "ready", text: "Cached paragraph." });
    expect(calls).not.toContain("complete");
  });
  it("a fresh or too_soon claim serves the re-read row only when it matches today's digest (review I-1; probe n: serve the first read -> FAILS)", async () => {
    // Our first read was stale; meanwhile another reader wrote the new paragraph, so the claim answers fresh.
    let reads = 0;
    const newer = { ...ROW(DIGEST), body: "Newer paragraph.", generatedAt: "2026-10-18T14:41:00.000Z" };
    const won = deps({ cached: async () => (reads++ === 0 ? ROW(OLD) : newer), claim: async () => ({ status: "fresh" }) });
    expect(await serve(won.d)).toMatchObject({ state: "ready", text: "Newer paragraph.", generatedAt: "2026-10-18T14:41:00.000Z" });
    expect(won.calls).not.toContain("complete");
    // The re-read finds nothing, or a row still on the old digest: never the stale paragraph, generating instead.
    for (const second of [null, ROW(OLD)]) {
      let n = 0;
      const { d } = deps({ cached: async () => (n++ === 0 ? ROW(OLD) : second), claim: async () => ({ status: "fresh" }) });
      expect(await serve(d)).toEqual({ state: "generating" });
    }
    let m = 0;
    const gone = deps({ cached: async () => (m++ === 0 ? ROW(DIGEST) : null), claim: async () => ({ status: "too_soon" }) });
    expect(await serve(gone.d, true)).toEqual({ state: "generating" });
  });
  it("another reader holds the lease -> generating, no completion (I4; mutation: complete anyway -> FAILS)", async () => {
    const { d, calls } = deps({ claim: async () => ({ status: "busy" }) });
    expect(await serve(d)).toEqual({ state: "generating" });
    expect(calls).not.toContain("complete");
  });
  it("switched off (either switch) or over budget -> none, even with a fresh cache, and nothing is claimed (G6, I13; mutation: serve the fresh cache when off -> FAILS)", async () => {
    for (const gate of [{ ...OPEN, globalEnabled: false }, { ...OPEN, accountEnabled: false }, { ...OPEN, monthSpendMicroUsd: 10_000_000 }]) {
      const { d, calls } = deps({ gate: async () => gate, cached: async () => ROW(DIGEST) });
      expect(await serve(d)).toEqual({ state: "none" });
      expect(calls).toEqual(["gate"]);
    }
  });
  it("an unreadable gate is none (I9, fail closed; mutation: proceed on a gate error -> FAILS)", async () => {
    const { d, calls } = deps({ gate: async () => { throw new Error("gate down"); } });
    expect(await serve(d)).toEqual({ state: "none" });
    expect(calls).toEqual(["gate"]);
  });
  it("past the cap: a fresh cache is served, a stale or missing one is capped, and Regenerate is capped too (spec 4.6; mutations: cap at > instead of >= -> FAILS; hide a fresh cache -> FAILS)", async () => {
    const capped = { ...OPEN, recordSummariesToday: 200 };
    expect((await serve(deps({ gate: async () => capped, cached: async () => ROW(DIGEST) }).d)).state).toBe("ready");
    expect(await serve(deps({ gate: async () => capped, cached: async () => ROW(OLD) }).d)).toEqual({ state: "capped" });
    expect(await serve(deps({ gate: async () => capped }).d)).toEqual({ state: "capped" });
    const { d, calls } = deps({ gate: async () => ({ ...OPEN, recordSummariesToday: 199 }) });
    expect((await serve(d)).state).toBe("ready");
    expect(calls).toContain("complete");
    // Regenerate past the cap: the fresh paragraph unchanged, and NOTHING claimed or written (plan fix I5;
    // mutation: check the cap after the claim -> "claim new true" and "complete" appear -> FAILS).
    const forcedFresh = deps({ gate: async () => capped, cached: async () => ROW(DIGEST) });
    expect(await serve(forcedFresh.d, true)).toMatchObject({ state: "ready", text: "Cached paragraph.", generatedAt: "2026-10-17T14:00:00.000Z" });
    expect(forcedFresh.calls).toEqual(["gate", "cached"]);
    const forcedStale = deps({ gate: async () => capped, cached: async () => ROW(OLD) });
    expect(await serve(forcedStale.d, true)).toEqual({ state: "capped" });
    expect(forcedStale.calls).toEqual(["gate", "cached"]);
  });
  // Orchestrator ruling M7: switched off, over budget, no key and an unpriced model are configuration, not
  // transient: nothing is shown. Only a timeout, a provider error or an unreadable gate is "failed", with Retry.
  const NONE_REASONS = ["global_off", "account_off", "over_budget", "no_key", "unknown_model"];
  it.each(AI_REFUSALS)("a %s answer releases the lease and answers none or failed, never ready (G6, M7; mutations: skip release -> FAILS; drop no_key from QUIET -> its row answers failed -> FAILS)", async (reason) => {
    const { d, calls } = deps({ complete: async () => ({ ok: false, reason }) });
    const r = await serve(d);
    expect(r).toEqual({ state: NONE_REASONS.includes(reason) ? "none" : "failed" });
    expect(calls).toContain("release L1");
  });
  it("the failed set is exactly timeout, provider_error and gate_unreadable (M7; mutation: add a reason to QUIET -> FAILS)", () => {
    expect(AI_REFUSALS.filter((r) => !NONE_REASONS.includes(r)).sort()).toEqual(["gate_unreadable", "provider_error", "timeout"]);
  });
  it.each(["global_off", "account_off", "over_budget"] as const)("a quiet %s stays none even when the release throws (orchestrator ruling M11; mutation: let the release error reach the outer catch -> failed -> FAILS)", async (reason) => {
    const { d, logs } = deps({ complete: async () => ({ ok: false, reason }), release: async () => { throw new Error("release failed"); } });
    expect(await serve(d)).toEqual({ state: "none" });
    expect(logs.some((l) => l.includes("release failed"))).toBe(true);
  });
  it("an empty answer is failed and releases (mutation: save an empty body -> FAILS)", async () => {
    const { d, calls } = deps({ complete: async () => ({ ok: true, text: "  ", usage: { inputTokens: 1, outputTokens: 0, costMicroUsd: 1 } }) });
    expect(await serve(d)).toEqual({ state: "failed" });
    expect(calls).toContain("release L1");
  });
  it("a lost lease still shows the paragraph it paid for, and says so in the log (mutations: answer failed when save is false -> FAILS; drop the log -> FAILS)", async () => {
    const { d, logs } = deps({ save: async () => false });
    expect(await serve(d)).toEqual({ state: "ready", text: "SENTINEL-OUTPUT-7f3 booked.", generatedAt: NOW.toISOString(), language: "es", stamp: `stamp ${NOW.toISOString()}` });
    expect(logs).toEqual(["lease lapsed before the save; showing this answer, not storing it"]);
  });
  it("a save that THROWS after a paid answer still shows it, releases the lease and logs (orchestrator ruling M-2; mutations: answer failed -> FAILS; skip the release -> FAILS)", async () => {
    const { d, calls, logs } = deps({ save: async () => { throw new Error("db down"); } });
    expect(await serve(d)).toEqual({ state: "ready", text: "SENTINEL-OUTPUT-7f3 booked.", generatedAt: NOW.toISOString(), language: "es", stamp: `stamp ${NOW.toISOString()}` });
    expect(calls.slice(-2)).toEqual([`save L1 SENTINEL-OUTPUT-7f3 booked. true ${NOW.toISOString()}`, "release L1"]);
    expect(logs).toEqual(["save failed; showing this answer, not storing it: Error: db down"]);
  });
  it("a throw while the lease is held releases it in the outer catch, and a failed release there is logged (review I-2, M-1; probe m: drop the outer release -> FAILS)", async () => {
    const held = deps({ complete: async () => { throw new Error("boom"); } });
    expect(await serve(held.d)).toEqual({ state: "failed" });
    expect(held.calls.slice(-2)).toEqual(["complete", "release L1"]);
    const both = deps({ complete: async () => { throw new Error("boom"); }, release: async () => { throw new Error("release down"); } });
    expect(await serve(both.d)).toEqual({ state: "failed" });
    expect(both.logs).toEqual(["summary failed: Error: boom", "lease release failed: Error: release down"]);
  });
  it("a throwing dependency is failed, never a throw (mutation: drop the outer try -> rejects -> FAILS)", async () => {
    await expect(serve(deps({ claim: async () => { throw new Error("db down"); } }).d)).resolves.toEqual({ state: "failed" });
    await expect(serve(deps({ cached: async () => { throw new Error("no table"); } }).d)).resolves.toEqual({ state: "failed" });
  });
  it("never logs the inputs or the answer (the never-logs probe; mutation: log the answer's text on a failed save -> FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { d, calls, logs } = deps({ save: async () => { throw new Error("save failed"); } });
    expect(await serve(d)).toMatchObject({ state: "ready" });
    expect(calls).toContain("release L1");
    const all = [...logs, ...spy.mock.calls.flat().map(String)].join("\n");
    expect(all).not.toContain("SENTINEL-OUTPUT-7f3");
    expect(all).not.toContain("SENTINEL-NAME-7f3");
    expect(logs.length).toBeGreaterThan(0);
    spy.mockRestore();
  });
});
