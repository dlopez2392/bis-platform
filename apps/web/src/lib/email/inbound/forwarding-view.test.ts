import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadForwardingView, canFormReplyAddress } from "./forwarding-view";

const T = "0123456789abcdef01234567";
type Mode = "off" | "bis" | "own_domain";
const deps = (mode: Mode, over: Partial<Parameters<typeof loadForwardingView>[0]> = {}, domain: string | null = mode === "own_domain" ? "reply.rio.com" : null) => ({
  settings: vi.fn(async () => ({ mode, domain })),
  token: vi.fn(async (): Promise<{ token: string } | null> => ({ token: T })), log: vi.fn(), ...over,
});

describe("loadForwardingView (spec §1; decided on the server; owner ruling 2026-10-17: a page view never writes)", () => {
  it("Replies on and a token already made: the customer's reply address, on the account's domain (mutation: always BIS's domain → own_domain wrong, FAILS)", async () => {
    expect(await loadForwardingView(deps("bis"), { isAgency: false })).toEqual({ kind: "address", address: `r-${T}@reply.bis-rgv.com` });
    expect(await loadForwardingView(deps("own_domain"), { isAgency: false })).toEqual({ kind: "address", address: `r-${T}@reply.rio.com` });
  });

  it("Replies on and no token yet: the Get button, never a made token (the deps can only READ; mutation: answer none → FAILS)", async () => {
    const d = deps("bis", { token: vi.fn(async () => null) });
    expect(await loadForwardingView(d, { isAgency: false })).toEqual({ kind: "get" });
    expect(await loadForwardingView(d, { isAgency: true })).toEqual({ kind: "get" });
  });

  it("Replies off: the agency is told to turn it on, everyone else sees nothing, and the token is not even read (mutation: read the token first → token called, FAILS)", async () => {
    const d = deps("off");
    expect(await loadForwardingView(d, { isAgency: true })).toEqual({ kind: "turnOn" });
    expect(await loadForwardingView(d, { isAgency: false })).toEqual({ kind: "none" });
    expect(d.token).not.toHaveBeenCalled();
  });

  it("own domain with no domain set cannot form an address: treated as off, no Get button (review minor 4; mutation: offer Get whenever mode is not off → FAILS)", async () => {
    const d = deps("own_domain", {}, null);
    expect(await loadForwardingView(d, { isAgency: true })).toEqual({ kind: "turnOn" });
    expect(await loadForwardingView(d, { isAgency: false })).toEqual({ kind: "none" });
    expect(d.token).not.toHaveBeenCalled();
  });

  it("a failed read is the row's error state, logged with the error's kind and never the token (minor 5; mutation: rethrow → the card fails, FAILS)", async () => {
    const a = deps("bis", { settings: vi.fn(async () => { throw new Error("db down"); }) });
    expect(await loadForwardingView(a, { isAgency: false })).toEqual({ kind: "failed" });
    const b = deps("bis", { token: vi.fn(async () => { throw new TypeError(`read failed near ${T}`); }) });
    expect(await loadForwardingView(b, { isAgency: false })).toEqual({ kind: "failed" });
    const aLog = vi.mocked(a.log).mock.calls.flat().join(" ");
    const bLog = vi.mocked(b.log).mock.calls.flat().join(" ");
    expect(aLog).toContain("the Replies setting could not be read; the forwarding row shows its error: Error: db down");
    expect(bLog).toContain("the forwarding address could not be read; the forwarding row shows its error: TypeError: read failed near [token]");
    expect(bLog).not.toContain(T);
    expect(a.log).toHaveBeenCalledTimes(1);
    expect(b.log).toHaveBeenCalledTimes(1);
  });

  it("canFormReplyAddress: BIS's domain always, an own domain only once it is set, never with Replies off", () => {
    expect(canFormReplyAddress({ mode: "bis", domain: null })).toBe(true);
    expect(canFormReplyAddress({ mode: "own_domain", domain: "reply.rio.com" })).toBe(true);
    expect(canFormReplyAddress({ mode: "own_domain", domain: null })).toBe(false);
    expect(canFormReplyAddress({ mode: "off", domain: "reply.rio.com" })).toBe(false);
  });

  it("the module is plain (a server component calls it) and never names a service client (constraints §8, §11; mutation: add \"use client\" → FAILS)", () => {
    const src = readFileSync(path.resolve(__dirname, "./forwarding-view.ts"), "utf8");
    expect(src).not.toMatch(/^\s*["']use (client|server)["'];?/m);
    // Built from parts so this file (under lib/) never spells the two client getters itself (constraints §8).
    const getters = new RegExp(["service", "ledger"].map((k) => `\\b${k}Db\\b`).join("|"));
    expect(src).not.toMatch(getters);
  });
});
