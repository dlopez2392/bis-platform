import { describe, it, expect, vi, beforeEach } from "vitest";

const gate = vi.hoisted(() => ({ smsSenderFor: vi.fn() }));
vi.mock("@/lib/consent/gate", () => gate);
const emailGate = vi.hoisted(() => ({ emailSenderFor: vi.fn() }));
vi.mock("@/lib/consent/email-gate", () => emailGate);

import { buildPassContext, runPasses } from "./harness";
import type { Pass, PassContext } from "./context";

function ctx(): PassContext {
  return buildPassContext({
    db: {} as never, now: new Date("2026-09-09T14:00:00Z"), origin: "https://app.example.com",
  });
}

beforeEach(() => {
  gate.smsSenderFor.mockReset().mockReturnValue(vi.fn());
  emailGate.emailSenderFor.mockReset().mockReturnValue({ isFake: true, send: vi.fn() });
});

describe("runPasses — independent error isolation, the finishCall-legs pattern", () => {
  it("a pass that rejects OUTRIGHT is reported under its own key as errored, and the next pass still runs", async () => {
    // Not a send inside a pass (each pass catches those itself) — the pass's
    // own `run` blowing up, e.g. its due-query throwing. Mutation: remove the
    // try/catch around `pass.run(ctx)` in harness.ts and this must fail.
    const ran: string[] = [];
    const boom: Pass = { key: "boom", run: async () => { throw new Error("db exploded"); } };
    const fine: Pass = { key: "fine", run: async () => { ran.push("fine"); return { sent: 2 }; } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const results = await runPasses([boom, fine], ctx());

    expect(results).toEqual({ boom: { errored: 1 }, fine: { sent: 2 } });
    expect(ran).toEqual(["fine"]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("boom"));
    spy.mockRestore();
  });

  it("runs passes in registry order, each handed the SAME context", async () => {
    const seen: PassContext[] = [];
    const order: string[] = [];
    const mk = (key: string): Pass => ({
      key, run: async (c) => { seen.push(c); order.push(key); return {}; },
    });
    const c = ctx();
    await runPasses([mk("a"), mk("b"), mk("c")], c);
    expect(order).toEqual(["a", "b", "c"]);
    expect(seen.every((s) => s === c)).toBe(true);
  });
});

describe("buildPassContext — texts go through the send gate, bound to the tick", () => {
  it("ctx.sms IS the gate bound to this tick's own client, and building it constructs no SMS provider (mutation: bind the gate to another client → FAILS)", () => {
    const bound = vi.fn();
    gate.smsSenderFor.mockReturnValue(bound);
    const db = { tick: "db" } as never;
    const c = buildPassContext({ db, now: new Date("2026-09-09T14:00:00Z"), origin: "https://app.example.com" });
    expect(gate.smsSenderFor).toHaveBeenCalledWith(db);
    expect(c.sms).toBe(bound);
  });
});

describe("PassContext — structurally cannot carry the agency's internal label", () => {
  it("has no accountName (pnpm typecheck fails here if someone adds one)", () => {
    const c = ctx();
    // @ts-expect-error accountName is deliberately absent from PassContext.
    // If it is ever added, this directive becomes unused and `tsc` refuses it.
    expect(c.accountName).toBeUndefined();
  });
});

describe("buildPassContext — email goes through the email gate, bound to the tick (consent PR-3)", () => {
  it("ctx.email IS the email gate's sender for this tick's client (mutation: build it from getEmailProvider again → emailSenderFor is never called, FAILS)", () => {
    const db = { tag: "tick-db" } as never;
    const sender = { isFake: false, send: vi.fn() };
    emailGate.emailSenderFor.mockReturnValue(sender);
    const c = buildPassContext({ db, now: new Date("2026-09-09T14:00:00Z"), origin: "https://app.example.com" });
    expect(c.email).toBe(sender);
    expect(emailGate.emailSenderFor).toHaveBeenCalledWith(db);
  });
});

describe("runPasses — the operational floor's heartbeats (spec §1)", () => {
  it("writes one heartbeat per pass, ok or error, then cron.tick, in order (mutation: drop the per-pass beat → FAILS)", async () => {
    const beats: [string, unknown][] = [];
    const beat = async (_c: PassContext, key: string, outcome: unknown) => { beats.push([key, outcome]); };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom: Pass = { key: "boom", run: async () => { throw new Error("db exploded"); } };
    const fine: Pass = { key: "fine", run: async () => ({ sent: 1 }) };

    await runPasses([boom, fine], ctx(), beat);

    expect(beats).toEqual([
      ["cron.pass.boom", { ok: false, error: "Error: db exploded" }],
      ["cron.pass.fine", { ok: true }],
      ["cron.tick", { ok: true }],
    ]);
    spy.mockRestore();
  });

  it("a heartbeat writer that throws never fails a pass or the tick (mutation: drop safeBeat's try → FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const beat = async () => { throw new Error("heartbeat table gone"); };
    const fine: Pass = { key: "fine", run: async () => ({ sent: 3 }) };

    await expect(runPasses([fine], ctx(), beat)).resolves.toEqual({ fine: { sent: 3 } });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("heartbeat cron.pass.fine not written"));
    spy.mockRestore();
  });

  it("the heartbeat for a pass is written AFTER that pass and BEFORE the next one runs, so the alert pass (last) reads this tick", async () => {
    const order: string[] = [];
    const beat = async (_c: PassContext, key: string) => { order.push(`beat:${key}`); };
    const mk = (key: string): Pass => ({ key, run: async () => { order.push(`run:${key}`); return {}; } });
    await runPasses([mk("a"), mk("b")], ctx(), beat);
    expect(order).toEqual(["run:a", "beat:cron.pass.a", "run:b", "beat:cron.pass.b", "beat:cron.tick"]);
  });
});
