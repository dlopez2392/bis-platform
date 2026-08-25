import { describe, it, expect } from "vitest";
import { extractCallerNumber, extractCalledNumber, sipHeaderNames } from "./sip-headers";

const ev = (headers: { name: string; value: string }[]) => ({ call_id: "c1", sip_headers: headers });

describe("extractCallerNumber", () => {
  it("parses tel:, sip:, display names, bare 10/11 digits", () => {
    expect(extractCallerNumber(ev([{ name: "From", value: "<tel:+19565550100>" }]))).toBe("+19565550100");
    expect(extractCallerNumber(ev([{ name: "From", value: '"Ana Ruiz" <sip:+19565550100@c.example>;tag=x' }]))).toBe("+19565550100");
    expect(extractCallerNumber(ev([{ name: "from", value: "<sip:9565550100@x>" }]))).toBe("+19565550100");
    expect(extractCallerNumber(ev([{ name: "From", value: "<sip:19565550100@x>" }]))).toBe("+19565550100");
  });
  it("anonymous and malformed → null", () => {
    expect(extractCallerNumber(ev([{ name: "From", value: '"Anonymous" <sip:anonymous@anonymous.invalid>' }]))).toBeNull();
    for (const bad of [null, undefined, {}, { sip_headers: "nope" }, { sip_headers: [] }, 42, { sip_headers: [null] }]) {
      expect(extractCallerNumber(bad)).toBeNull();
    }
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
});

describe("sipHeaderNames", () => {
  it("returns names only", () => {
    expect(sipHeaderNames(ev([{ name: "From", value: "SECRET" }, { name: "To", value: "SECRET" }])))
      .toEqual(["From", "To"]);
    expect(sipHeaderNames({})).toEqual([]);
  });
});
