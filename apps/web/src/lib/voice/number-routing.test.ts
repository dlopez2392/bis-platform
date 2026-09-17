import { describe, it, expect } from "vitest";
import {
  canRepairRouting, indexByE164, missingRoutingConfig, routingStatus,
  type TelnyxNumberFacts,
} from "./number-routing";

const OURS = "conn_bis_texml";
const at = (connectionId: string | null, connectionName: string | null = null): TelnyxNumberFacts =>
  ({ id: "tn_1", connectionId, connectionName });

describe("routingStatus", () => {
  it("reports a number pointed at our TeXML app as routed", () => {
    expect(routingStatus(at(OURS, "BIS Platform Voice"), OURS)).toBe("routed");
  });

  /**
   * The 2026-09-16 case: the number existed, was healthy at the carrier, and
   * sent its calls to a connection that is not ours — so the platform
   * answered for whatever number it actually received instead.
   */
  it("reports a number on someone else's connection as elsewhere", () => {
    expect(routingStatus(at("conn_something_else", "Old Forwarder"), OURS)).toBe("elsewhere");
  });

  it("reports a number with no connection at all as unrouted", () => {
    expect(routingStatus(at(null), OURS)).toBe("unrouted");
    // Telnyx has been seen to send "" rather than null for an unset field.
    expect(routingStatus(at(""), OURS)).toBe("unrouted");
  });

  it("reports a number Telnyx does not have as absent, not as misrouted", () => {
    // Different remedy entirely: absent means another carrier or another
    // Telnyx account, and nothing here can repair it.
    expect(routingStatus(null, OURS)).toBe("absent");
  });

  /**
   * The safety property that lets this column be believed.
   *
   * With no configured connection id there is no yardstick. Folding that into
   * "elsewhere" would paint every number in the account as broken the moment
   * an env var went missing — and an operator who sees a healthy number
   * reported as broken stops reading the column at all.
   */
  it("says unchecked, never elsewhere, when we have no yardstick", () => {
    // Mutation: return "elsewhere" for a missing expected id — this fails.
    expect(routingStatus(at(OURS), null)).toBe("unchecked");
    expect(routingStatus(at("conn_other"), null)).toBe("unchecked");
    expect(routingStatus(at(null), "")).toBe("unchecked");
    expect(routingStatus(null, null)).toBe("unchecked");
  });
});

describe("canRepairRouting", () => {
  it("offers a repair for the two states a PATCH actually fixes", () => {
    expect(canRepairRouting("elsewhere")).toBe(true);
    expect(canRepairRouting("unrouted")).toBe(true);
  });

  it("offers nothing for a number that is already correct", () => {
    expect(canRepairRouting("routed")).toBe(false);
  });

  it("offers nothing for a number Telnyx does not have", () => {
    // There is no id to PATCH. A button that can only fail is worse than none.
    expect(canRepairRouting("absent")).toBe(false);
  });

  /**
   * The dangerous one. Writing a carrier setting on a number we never managed
   * to inspect is how a working phone line gets broken by a diagnostic.
   */
  it("never offers a repair for a number we could not inspect", () => {
    expect(canRepairRouting("unchecked")).toBe(false);
  });
});

describe("indexByE164", () => {
  it("matches on the exact E.164", () => {
    const idx = indexByE164([
      { id: "tn_a", phoneNumber: "+19565550100", connectionId: OURS, connectionName: null },
      { id: "tn_b", phoneNumber: "+19567055146", connectionId: null, connectionName: null },
    ]);
    expect(idx.get("+19565550100")?.id).toBe("tn_a");
    expect(idx.get("+19567055146")?.id).toBe("tn_b");
  });

  /**
   * Telnyx's `filter[phone_number]` matches on as few as three digits, so a
   * lookup can return neighbours. Nothing but an exact key may ever match, or
   * one number's routing verdict gets read off another number's record.
   */
  it("never matches a number that merely contains the digits", () => {
    const idx = indexByE164([
      { id: "tn_a", phoneNumber: "+19565550100", connectionId: OURS, connectionName: null },
    ]);
    expect(idx.get("+15550100")).toBeUndefined();
    expect(idx.get("9565550100")).toBeUndefined();
    expect(idx.get("+195655501000")).toBeUndefined();
  });

  it("handles an empty carrier account", () => {
    expect(indexByE164([]).size).toBe(0);
  });
});

describe("missingRoutingConfig", () => {
  it("names nothing when both halves are present", () => {
    expect(missingRoutingConfig("key", "conn")).toEqual([]);
  });

  it("names the API key alone", () => {
    expect(missingRoutingConfig(null, "conn")).toEqual(["TELNYX_API_KEY"]);
  });

  it("names the connection id alone", () => {
    expect(missingRoutingConfig("key", null)).toEqual(["TELNYX_VOICE_CONNECTION_ID"]);
  });

  /**
   * Both, not just the first. Reporting one would send an operator to set it,
   * redeploy, and rediscover the other — which is two deploys to learn what
   * one sentence can say.
   */
  it("names BOTH when both are missing", () => {
    expect(missingRoutingConfig(null, null))
      .toEqual(["TELNYX_API_KEY", "TELNYX_VOICE_CONNECTION_ID"]);
  });
});
