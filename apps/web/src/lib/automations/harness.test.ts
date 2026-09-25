import { describe, it, expect, vi, beforeEach } from "vitest";

const smsFactory = vi.hoisted(() => ({ getSmsProvider: vi.fn() }));
vi.mock("@/lib/sms", () => ({ getSmsProvider: () => smsFactory.getSmsProvider() }));
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => ({ isFake: true, send: async () => ({ providerMessageId: "e" }) }),
}));

import { buildPassContext, runPasses, lazySmsProvider } from "./harness";
import type { Pass, PassContext } from "./context";

function ctx(): PassContext {
  return buildPassContext({
    db: {} as never, now: new Date("2026-09-09T14:00:00Z"), origin: "https://app.example.com",
  });
}

beforeEach(() => {
  smsFactory.getSmsProvider.mockReset();
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

describe("buildPassContext — the SMS provider is LAZY", () => {
  it("does not construct the SMS provider until a pass asks, so a throwing factory cannot fail the tick", async () => {
    // getSmsProvider() throws in production when TELNYX_API_KEY is unset —
    // and it IS unset today, by design. An eager construction would 500 every
    // tick, reminders included. Mutation: make `sms` eager in
    // buildPassContext and this must fail.
    smsFactory.getSmsProvider.mockImplementation(() => {
      throw new Error("TELNYX_API_KEY is required in production");
    });
    const c = ctx();
    expect(smsFactory.getSmsProvider).not.toHaveBeenCalled();
    expect(() => c.sms()).toThrow(/TELNYX_API_KEY/);
    const results = await runPasses([{ key: "emailOnly", run: async () => ({ sent: 0 }) }], c);
    expect(results).toEqual({ emailOnly: { sent: 0 } });
  });

  it("memoises the SMS provider after the first successful construction", () => {
    const provider = { isFake: true, send: async () => ({ providerMessageId: "s" }) };
    smsFactory.getSmsProvider.mockReturnValue(provider);
    const c = ctx();
    expect(c.sms()).toBe(provider);
    expect(c.sms()).toBe(provider);
    expect(smsFactory.getSmsProvider).toHaveBeenCalledTimes(1);
  });
});

describe("quietSettingsReader — one read per account per tick", () => {
  it("memoises per account and drops a rejected read so the next caller retries", async () => {
    const { quietSettingsReader } = await import("./harness");
    let calls = 0;
    const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
      calls++;
      if (calls === 1) return { data: null, error: { message: "boom" } };
      return { data: { quiet_enabled: true, quiet_start: "22:00:00", quiet_end: "07:00:00" }, error: null };
    } }) }) }) } as never;
    const quiet = quietSettingsReader(db);
    await expect(quiet("a1")).rejects.toThrow(/boom/);
    expect(await quiet("a1")).toEqual({ enabled: true, start: "22:00", end: "07:00" });
    expect(await quiet("a1")).toEqual({ enabled: true, start: "22:00", end: "07:00" });
    expect(calls).toBe(2);   // mutation: memoise the rejection too → 1, and the second await rejects
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

describe("lazySmsProvider — ONE definition of lazy, shared by the cron and the inline recipe", () => {
  it("constructs nothing until called, then once — the second call returns the same provider", () => {
    // Mutation: make it eager (`const sms = getSmsProvider(); return () => sms`).
    smsFactory.getSmsProvider.mockReturnValue({ isFake: true, send: async () => ({ providerMessageId: "s" }) });
    const sms = lazySmsProvider();
    expect(smsFactory.getSmsProvider).not.toHaveBeenCalled();
    const first = sms();
    expect(sms()).toBe(first);
    expect(smsFactory.getSmsProvider).toHaveBeenCalledTimes(1);
  });

  it("a throwing factory is retried on the next call rather than cached as a failure", () => {
    smsFactory.getSmsProvider
      .mockImplementationOnce(() => { throw new Error("TELNYX_API_KEY unset"); })
      .mockReturnValue({ isFake: true, send: async () => ({ providerMessageId: "s" }) });
    const sms = lazySmsProvider();
    expect(() => sms()).toThrow("TELNYX_API_KEY unset");
    expect(sms().isFake).toBe(true);
    expect(smsFactory.getSmsProvider).toHaveBeenCalledTimes(2);
  });
});
