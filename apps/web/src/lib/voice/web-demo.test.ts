import { describe, it, expect } from "vitest";
import {
  WEB_DEMO_MAX_SECONDS, webDemoMinutes, webDemoNotice,
  parseAllowedOrigins, originAllowed,
  signTicket, verifyTicket, TICKET_MAX_AGE_MS,
} from "./web-demo";

describe("webDemoMinutes", () => {
  it("renders the ceiling in whole minutes", () => {
    expect(webDemoMinutes(180)).toBe(3);
  });
  it("never says zero minutes, however short the ceiling", () => {
    expect(webDemoMinutes(20)).toBe(1);
  });
});

describe("webDemoNotice", () => {
  const both = { bookingUrl: "https://app.bis-rgv.com/b/abc", phoneNumber: "(956) 506-1545" };

  it("forbids claiming a booking, a note or a passed-along message", () => {
    const n = webDemoNotice(both);
    expect(n).toMatch(/CANNOT book, reschedule or cancel/);
    expect(n).toMatch(/Do not say you have booked, noted, saved or passed anything along/);
  });

  it("carries the ceiling it was given, not the default", () => {
    expect(webDemoNotice({ ...both, maxSeconds: 300 })).toContain("about 5 minutes");
  });

  it("defaults to the module's own ceiling", () => {
    expect(webDemoNotice(both)).toContain(`about ${webDemoMinutes(WEB_DEMO_MAX_SECONDS)} minutes`);
  });

  it("routes a booking request to the scheduling page and the line", () => {
    const n = webDemoNotice(both);
    expect(n).toContain("https://app.bis-rgv.com/b/abc");
    expect(n).toContain("(956) 506-1545");
  });

  it("still gives somewhere to go when neither is configured", () => {
    const n = webDemoNotice({ bookingUrl: null, phoneNumber: null });
    expect(n).toContain("contact form");
    expect(n).not.toContain("undefined");
    expect(n).not.toContain("null");
  });

  it("omits the line that has no value rather than printing an empty one", () => {
    const n = webDemoNotice({ bookingUrl: null, phoneNumber: "(956) 506-1545" });
    expect(n).not.toContain("To book:");
    expect(n).toContain("(956) 506-1545");
  });

  it("tells her she does not have the visitor's number", () => {
    expect(webDemoNotice(both)).toMatch(/you do not have their phone number/);
  });
});

describe("parseAllowedOrigins", () => {
  it("splits, trims and drops blanks", () => {
    expect(parseAllowedOrigins(" https://a.com , https://b.com ,, "))
      .toEqual(["https://a.com", "https://b.com"]);
  });
  it("treats unset as no origins at all, never as a wildcard", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});

describe("originAllowed", () => {
  const allowed = ["https://bis-rgv.com", "https://www.bis-rgv.com"];

  it("allows an exact match", () => {
    expect(originAllowed("https://bis-rgv.com", allowed)).toBe(true);
  });

  it("refuses a request with no Origin header at all", () => {
    expect(originAllowed(null, allowed)).toBe(false);
  });

  it("refuses a lookalike that merely ENDS WITH an allowed host", () => {
    expect(originAllowed("https://bis-rgv.com.attacker.example", allowed)).toBe(false);
  });

  it("refuses a lookalike that merely CONTAINS an allowed host", () => {
    expect(originAllowed("https://attacker.example/?x=https://bis-rgv.com", allowed)).toBe(false);
  });

  it("refuses the same host on the wrong scheme", () => {
    expect(originAllowed("http://bis-rgv.com", allowed)).toBe(false);
  });

  it("refuses everything when nothing is configured", () => {
    expect(originAllowed("https://bis-rgv.com", [])).toBe(false);
  });
});

describe("verifyTicket", () => {
  const SECRET = "shared-secret-value";
  const NOW = 1_760_000_000_000;

  it("accepts a ticket this secret just minted", () => {
    expect(verifyTicket(SECRET, signTicket(SECRET, NOW), NOW)).toEqual({ ok: true });
  });

  it("refuses a ticket signed with a different secret", () => {
    const foreign = signTicket("some-other-secret", NOW);
    expect(verifyTicket(SECRET, foreign, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a tampered timestamp — the time is signed, not just carried", () => {
    const t = signTicket(SECRET, NOW - 10 * 60_000);
    const [, nonce, sig] = t.split(".");
    expect(verifyTicket(SECRET, `${NOW}.${nonce}.${sig}`, NOW))
      .toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a stale ticket", () => {
    const t = signTicket(SECRET, NOW);
    expect(verifyTicket(SECRET, t, NOW + TICKET_MAX_AGE_MS + 1))
      .toEqual({ ok: false, reason: "expired" });
  });

  it("accepts one right on the age boundary", () => {
    const t = signTicket(SECRET, NOW);
    expect(verifyTicket(SECRET, t, NOW + TICKET_MAX_AGE_MS)).toEqual({ ok: true });
  });

  it("refuses a ticket dated far in the future", () => {
    const t = signTicket(SECRET, NOW + 10 * 60_000);
    expect(verifyTicket(SECRET, t, NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses junk without throwing, whatever the shape", () => {
    for (const junk of ["", "a", "a.b", "a.b.c.d", "...", `${NOW}..sig`]) {
      expect(() => verifyTicket(SECRET, junk, NOW)).not.toThrow();
      expect(verifyTicket(SECRET, junk, NOW).ok).toBe(false);
    }
  });

  it("refuses a signature of the wrong LENGTH without throwing", () => {
    const t = signTicket(SECRET, NOW);
    const [iat, nonce] = t.split(".");
    expect(verifyTicket(SECRET, `${iat}.${nonce}.short`, NOW))
      .toEqual({ ok: false, reason: "bad_signature" });
  });

  it("gives a different signature per call, so tickets are not interchangeable strings", () => {
    expect(signTicket(SECRET, NOW)).not.toBe(signTicket(SECRET, NOW));
  });
});
