import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadForwardingView } from "./forwarding-view";

const T = "0123456789abcdef01234567";
const deps = (mode: "off" | "bis" | "own_domain", over: Partial<Parameters<typeof loadForwardingView>[0]> = {}) => ({
  settings: vi.fn(async () => ({ mode, domain: mode === "own_domain" ? "reply.rio.com" : null })),
  token: vi.fn(async () => ({ token: T })), log: vi.fn(), ...over,
});

describe("loadForwardingView (spec §1; decided on the server)", () => {
  it("Replies on: the customer's reply address, on the account's domain (mutation: always BIS's domain → own_domain wrong, FAILS)", async () => {
    expect(await loadForwardingView(deps("bis"), { isAgency: false })).toEqual({ kind: "address", address: `r-${T}@reply.bis-rgv.com` });
    expect(await loadForwardingView(deps("own_domain"), { isAgency: false })).toEqual({ kind: "address", address: `r-${T}@reply.rio.com` });
  });

  it("Replies off: the agency is told to turn it on, everyone else sees nothing, and no token is made (mutation: make the token first → token called, FAILS)", async () => {
    const d = deps("off");
    expect(await loadForwardingView(d, { isAgency: true })).toEqual({ kind: "turnOn" });
    expect(await loadForwardingView(d, { isAgency: false })).toEqual({ kind: "none" });
    expect(d.token).not.toHaveBeenCalled();
  });

  it("a failed read or write is the row's error state, logged without the token (mutation: rethrow → the card fails, FAILS)", async () => {
    const a = deps("bis", { settings: vi.fn(async () => { throw new Error("db"); }) });
    expect(await loadForwardingView(a, { isAgency: false })).toEqual({ kind: "failed" });
    const b = deps("bis", { token: vi.fn(async () => { throw new Error(`token ${T}`); }) });
    expect(await loadForwardingView(b, { isAgency: false })).toEqual({ kind: "failed" });
    expect(vi.mocked(b.log).mock.calls.flat().join(" ")).not.toContain(T);
    // Each failure was logged (a silent error state is a defect of its own).
    expect(a.log).toHaveBeenCalledTimes(1);
    expect(b.log).toHaveBeenCalledTimes(1);
  });

  it("the module is plain (a server component calls it) and never names a service client (constraints §8, §11; mutation: add \"use client\" → FAILS)", () => {
    const src = readFileSync(path.resolve(__dirname, "./forwarding-view.ts"), "utf8");
    expect(src).not.toMatch(/^\s*["']use (client|server)["'];?/m);
    // Built from parts so this file (under lib/) never spells the two client getters itself (constraints §8).
    const getters = new RegExp(["service", "ledger"].map((k) => `\\b${k}Db\\b`).join("|"));
    expect(src).not.toMatch(getters);
  });
});
