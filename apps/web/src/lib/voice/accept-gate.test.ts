import { describe, it, expect } from "vitest";
import { callAnswerable } from "./accept-gate";

describe("callAnswerable", () => {
  it("testing + disabled profile → answerable (testing means callable during setup)", () => {
    expect(callAnswerable({ status: "testing", profile: { enabled: false } }))
      .toEqual({ answerable: true });
  });

  it("live + disabled profile → not answerable, reason disabled", () => {
    expect(callAnswerable({ status: "live", profile: { enabled: false } }))
      .toEqual({ answerable: false, reason: "disabled" });
  });

  it("testing + no profile row → not answerable, reason no-profile", () => {
    expect(callAnswerable({ status: "testing", profile: null }))
      .toEqual({ answerable: false, reason: "no-profile" });
  });

  it("live + enabled profile → answerable", () => {
    expect(callAnswerable({ status: "live", profile: { enabled: true } }))
      .toEqual({ answerable: true });
  });
});
