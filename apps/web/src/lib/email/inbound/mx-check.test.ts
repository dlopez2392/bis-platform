import { describe, it, expect, vi } from "vitest";
import { inboundMxReady, cleanInboundDomain } from "./mx-check";

describe("inboundMxReady (spec 'Turning it on'; ASSUMPTION A3)", () => {
  it("ready when any MX points at Resend's inbound host (mutation: require priority 10 → the priority-20 case is missing, FAILS)", async () => {
    expect(await inboundMxReady("reply.rio.com", vi.fn().mockResolvedValue([{ exchange: "inbound-smtp.us-east-1.amazonaws.com", priority: 10 }]))).toBe("ready");
    expect(await inboundMxReady("reply.rio.com", vi.fn().mockResolvedValue([{ exchange: "mx.google.com", priority: 1 }, { exchange: "inbound-smtp.eu-west-1.amazonaws.com.", priority: 20 }]))).toBe("ready");
  });

  it("missing when no MX is Resend's, or none exists; lookup_failed on any other DNS error (mutation: treat ENOTFOUND as lookup_failed → FAILS)", async () => {
    expect(await inboundMxReady("reply.rio.com", vi.fn().mockResolvedValue([{ exchange: "mx.google.com", priority: 1 }]))).toBe("missing");
    expect(await inboundMxReady("reply.rio.com", vi.fn().mockRejectedValue(Object.assign(new Error("x"), { code: "ENOTFOUND" })))).toBe("missing");
    expect(await inboundMxReady("reply.rio.com", vi.fn().mockRejectedValue(Object.assign(new Error("x"), { code: "ENODATA" })))).toBe("missing");
    expect(await inboundMxReady("reply.rio.com", vi.fn().mockRejectedValue(Object.assign(new Error("x"), { code: "ETIMEOUT" })))).toBe("lookup_failed");
  });
});

describe("cleanInboundDomain", () => {
  it("lowercases and trims a dotted hostname; refuses BIS's own and anything else (mutation: accept reply.bis-rgv.com → FAILS)", () => {
    expect(cleanInboundDomain("  Reply.Rio.COM ")).toBe("reply.rio.com");
    for (const bad of ["reply.bis-rgv.com", "rio", "reply rio.com", "http://reply.rio.com", "", "-a.com"]) expect(cleanInboundDomain(bad), bad).toBeNull();
  });
});
