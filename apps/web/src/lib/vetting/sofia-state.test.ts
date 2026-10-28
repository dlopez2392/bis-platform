import { describe, it, expect } from "vitest";
import { sofiaIsOn, switchesSofiaOn } from "./sofia-state";

const P = (enabled: boolean, concierge = false) => ({ enabled, concierge_enabled: concierge });

describe("sofiaIsOn (callAnswerable over every active number)", () => {
  it("a testing number answers whether or not the profile is enabled", () => {
    expect(sofiaIsOn(P(false), [{ status: "testing" }]).answering).toBe(true);
  });
  it("a live number answers only with an enabled profile", () => {
    expect(sofiaIsOn(P(true), [{ status: "live" }]).answering).toBe(true);
    expect(sofiaIsOn(P(false), [{ status: "live" }]).answering).toBe(false);
  });
  it("no profile, or only provisioned/released numbers, means not answering", () => {
    expect(sofiaIsOn(null, [{ status: "testing" }]).answering).toBe(false);
    expect(sofiaIsOn(P(true), [{ status: "provisioned" }, { status: "released" }]).answering).toBe(false);
  });
  it("the web chat is on exactly when concierge_enabled is", () => {
    expect(sofiaIsOn(P(false, true), []).chat).toBe(true);
    expect(sofiaIsOn(P(false, false), []).chat).toBe(false);
    expect(sofiaIsOn(null, []).chat).toBe(false);
  });
});

describe("switchesSofiaOn (false -> true only; everything else only subtracts)", () => {
  it("hole A: live -> testing with a disabled profile switches her on (mutation: compare number status only -> FAILS)", () => {
    expect(switchesSofiaOn({ profile: P(false), numbers: [{ status: "live" }] }, { profile: P(false), numbers: [{ status: "testing" }] })).toBe(true);
  });
  it("hole B: a first profile beside a testing number switches her on, Receptionist off or not", () => {
    expect(switchesSofiaOn({ profile: null, numbers: [{ status: "testing" }] }, { profile: P(false), numbers: [{ status: "testing" }] })).toBe(true);
    expect(switchesSofiaOn({ profile: null, numbers: [{ status: "testing" }] }, { profile: P(true), numbers: [{ status: "testing" }] })).toBe(true);
  });
  it("Receptionist enabled off -> on beside a live number switches her on", () => {
    expect(switchesSofiaOn({ profile: P(false), numbers: [{ status: "live" }] }, { profile: P(true), numbers: [{ status: "live" }] })).toBe(true);
  });
  it("testing -> live with a disabled profile, enabled on with no number, and anything already answering are not switch-ons", () => {
    expect(switchesSofiaOn({ profile: P(false), numbers: [{ status: "testing" }] }, { profile: P(false), numbers: [{ status: "live" }] })).toBe(false);
    expect(switchesSofiaOn({ profile: P(false), numbers: [] }, { profile: P(true), numbers: [] })).toBe(false);
    expect(switchesSofiaOn({ profile: P(true), numbers: [{ status: "live" }] }, { profile: P(true), numbers: [{ status: "testing" }] })).toBe(false);
  });
  it("turning off is never a switch-on", () => {
    expect(switchesSofiaOn({ profile: P(true, true), numbers: [{ status: "live" }] }, { profile: P(false, false), numbers: [{ status: "live" }] })).toBe(false);
    expect(switchesSofiaOn({ profile: P(true), numbers: [{ status: "live" }] }, { profile: P(true), numbers: [{ status: "released" }] })).toBe(false);
  });
  it("the chat going false -> true is a switch-on too, and staying on is not", () => {
    expect(switchesSofiaOn({ profile: P(false), numbers: [] }, { profile: P(false, true), numbers: [] })).toBe(true);
    expect(switchesSofiaOn({ profile: P(false, true), numbers: [] }, { profile: P(false, true), numbers: [] })).toBe(false);
  });
});
