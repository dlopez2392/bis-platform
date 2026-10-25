import { describe, it, expect } from "vitest";
import { extractCallerNumber, extractCalledNumber, extractSipSignature, sipHeaderNames, sipAttestation } from "./sip-headers";

const ev = (headers: { name: unknown; value: string }[]) => ({ call_id: "c1", sip_headers: headers });

describe("extractCallerNumber", () => {
  it("parses tel:, sip:, display names, bare 10/11 digits", () => {
    expect(extractCallerNumber(ev([{ name: "From", value: "<tel:+19565550100>" }]))).toBe("+19565550100");
    expect(extractCallerNumber(ev([{ name: "From", value: '"Ana Ruiz" <sip:+19565550100@c.example>;tag=x' }]))).toBe("+19565550100");
    expect(extractCallerNumber(ev([{ name: "from", value: "<sip:9565550100@x>" }]))).toBe("+19565550100");
    expect(extractCallerNumber(ev([{ name: "From", value: "<sip:19565550100@x>" }]))).toBe("+19565550100");
    // An international caller ID keeps its own code (review R2 minor; mutation:
    // capture the digits without the "+" → "+526421234567", a Mexican number, FAILS).
    expect(extractCallerNumber(ev([{ name: "From", value: "<sip:+6421234567@x>" }]))).toBe("+6421234567");
  });
  it("anonymous and malformed → null", () => {
    expect(extractCallerNumber(ev([{ name: "From", value: '"Anonymous" <sip:anonymous@anonymous.invalid>' }]))).toBeNull();
    for (const bad of [null, undefined, {}, { sip_headers: "nope" }, { sip_headers: [] }, 42, { sip_headers: [null] }]) {
      expect(extractCallerNumber(bad)).toBeNull();
    }
  });
  it("7-digit local number rejects (e164Of enforces 8+ digits)", () => {
    expect(extractCallerNumber(ev([{ name: "From", value: "<sip:5551234@x>" }]))).toBeNull();
  });
});

describe("extractCalledNumber", () => {
  it("prefers X-BIS-Called over To over Diversion", () => {
    expect(extractCalledNumber(ev([
      { name: "To", value: "<sip:proj_abc@sip.api.openai.com>" },
      { name: "X-BIS-Called", value: "+19565550999" },
    ]))).toBe("+19565550999");
    expect(extractCalledNumber(ev([{ name: "To", value: "<sip:+19565550888@x>" }]))).toBe("+19565550888");
    expect(extractCalledNumber(ev([{ name: "Diversion", value: "<sip:9565550777@x>;reason=deflection" }]))).toBe("+19565550777");
  });
  it("a To that is only the OpenAI SIP URI (no number) → null", () => {
    expect(extractCalledNumber(ev([{ name: "To", value: "<sip:proj_abc@sip.api.openai.com;transport=tls>" }]))).toBeNull();
  });
  it("degenerate inputs → null", () => {
    for (const bad of [null, undefined, {}, { sip_headers: "nope" }, { sip_headers: [] }, 42, { sip_headers: [null] }]) {
      expect(extractCalledNumber(bad)).toBeNull();
    }
  });
});

describe("extractSipSignature", () => {
  it("reads X-BIS-Signature verbatim, any case, never coerced to a number", () => {
    const value = "1790000000000.19565550100.19565550111.abcDEF_-123";
    expect(extractSipSignature(ev([{ name: "From", value: "<sip:+19565550111@x>" }, { name: "X-BIS-Signature", value }]))).toBe(value);
    expect(extractSipSignature(ev([{ name: "x-bis-signature", value: ` ${value} ` }]))).toBe(value);
  });
  it("absent, blank and degenerate inputs → null", () => {
    expect(extractSipSignature(ev([{ name: "X-BIS-Handoff", value: "a".repeat(32) }]))).toBeNull();
    expect(extractSipSignature(ev([{ name: "X-BIS-Signature", value: "  " }]))).toBeNull();
    for (const bad of [null, undefined, {}, { sip_headers: "nope" }, { sip_headers: [] }, 42, { sip_headers: [null] }]) {
      expect(extractSipSignature(bad)).toBeNull();
    }
  });
});

describe("sipHeaderNames", () => {
  it("returns names only", () => {
    expect(sipHeaderNames(ev([{ name: "From", value: "SECRET" }, { name: "To", value: "SECRET" }])))
      .toEqual(["From", "To"]);
    expect(sipHeaderNames({})).toEqual([]);
  });
  it("skips headers with non-string names", () => {
    expect(sipHeaderNames(ev([{ name: {}, value: "x" }, { name: "To", value: "y" }])))
      .toEqual(["To"]);
  });
});

describe("sipAttestation", () => {
  it("no headers -> \"none\"", () => {
    expect(sipAttestation(ev([]))).toBe("none");
  });

  it("a plain attestation-looking field name prints its value", () => {
    expect(sipAttestation(ev([{ name: "X-Attest-Level", value: "B" }]))).toBe("X-Attest-Level=B");
  });

  it("an Identity header prints only the attest claim (A, B, or C), never the token or the orig number (mutation: return the raw token instead of identityAttest's result -> FAILS)", () => {
    for (const attest of ["A", "B", "C"]) {
      const payload = Buffer.from(JSON.stringify({ attest, orig: { tn: "19565550142" } })).toString("base64url");
      const value = `h.${payload}.s`;
      const line = sipAttestation(ev([{ name: "Identity", value }]));
      expect(line).toBe(`identity=attest:${attest}`);
      expect(line).not.toContain("19565550142");
      expect(line).not.toContain(payload);
    }
  });

  it("a malformed token, a payload over 4096 characters, and an unrecognized attest letter all read as (present)", () => {
    expect(sipAttestation(ev([{ name: "Identity", value: "not-a-jwt" }]))).toBe("identity=(present)");
    const hugePayload = "a".repeat(4097);
    expect(sipAttestation(ev([{ name: "Identity", value: `h.${hugePayload}.s` }]))).toBe("identity=(present)");
    const dPayload = Buffer.from(JSON.stringify({ attest: "D" })).toString("base64url");
    expect(sipAttestation(ev([{ name: "Identity", value: `h.${dPayload}.s` }]))).toBe("identity=(present)");
  });

  it("a verstat parameter inside From prints as a short word", () => {
    expect(sipAttestation(ev([{ name: "From", value: "<sip:+19565550142@x;verstat=TN-Validation-Passed>;tag=1" }])))
      .toBe("from.verstat=TN-Validation-Passed");
  });

  it("a verstat past 40 characters is unprintable", () => {
    const long = "a".repeat(41);
    expect(sipAttestation(ev([{ name: "From", value: `<sip:+19565550142@x;verstat=${long}>;tag=1` }])))
      .toBe("from.verstat=(unprintable)");
  });

  it("a generic stir/shaken field holding 7+ digits is redacted", () => {
    expect(sipAttestation(ev([{ name: "X-Stir-Orig", value: "19565550142" }]))).toBe("X-Stir-Orig=(redacted)");
  });

  it("bounded at MAX_ATTESTATION: 12 matching headers print only 10 (mutation: drop the cap -> FAILS)", () => {
    const headers = Array.from({ length: 12 }, (_, i) => ({ name: `X-Attest-${i}`, value: "B" }));
    const line = sipAttestation(ev(headers));
    expect(line.split(",")).toHaveLength(10);
    expect(line).not.toContain("X-Attest-10");
    expect(line).not.toContain("X-Attest-11");
  });

  it("a header name that could forge a log line is counted, not printed", () => {
    expect(sipAttestation(ev([{ name: "bad\nname", value: "x" }]))).toBe("none (+1 unprintable)");
  });
});
