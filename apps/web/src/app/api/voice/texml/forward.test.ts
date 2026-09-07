import { describe, it, expect } from "vitest";
import { forwardTarget, forwardXml } from "./route";

/**
 * The override exists because Telnyx refuses its own per-number forwarding on
 * a TeXML-utilizing number and points you at TeXML instead. Its danger is not
 * being wrong, it is being left on — so these pin both that it works and that
 * it is off unless deliberately set.
 */

/** A ProcessEnv carrying only what a case is about. NODE_ENV is required by
 *  the type and irrelevant to every assertion here. */
function env(vars: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...vars } as NodeJS.ProcessEnv;
}

describe("forwardTarget", () => {
  it("is off when unset — the normal state of the world", () => {
    expect(forwardTarget(env())).toBeNull();
  });

  it("is off for an empty or whitespace value, not accidentally on", () => {
    expect(forwardTarget(env({ VOICE_FORWARD_TO: "" }))).toBeNull();
    expect(forwardTarget(env({ VOICE_FORWARD_TO: "   " }))).toBeNull();
  });

  it("normalises a number typed the way a human types it", () => {
    expect(forwardTarget(env({ VOICE_FORWARD_TO: "(956) 292-1696" }))).toBe("+19562921696");
    expect(forwardTarget(env({ VOICE_FORWARD_TO: "+19562921696" }))).toBe("+19562921696");
  });

  it("is off for something that is not a phone number at all", () => {
    expect(forwardTarget(env({ VOICE_FORWARD_TO: "yes" }))).toBeNull();
  });
});

describe("forwardXml", () => {
  it("dials the target over the PSTN, not over SIP", () => {
    const xml = forwardXml("+19562921696", "+19565061545");
    expect(xml).toContain("<Dial");
    expect(xml).toContain(">+19562921696</Dial>");
    expect(xml).not.toContain("<Sip>");
    expect(xml).not.toContain("sip.api.openai.com");
  });

  it("presents OUR number as the caller id — Telnyx requires an owned number", () => {
    expect(forwardXml("+19562921696", "+19565061545")).toContain('callerId="+19565061545"');
  });

  it("omits callerId rather than emitting an empty one when we do not know it", () => {
    const xml = forwardXml("+19562921696", null);
    expect(xml).not.toContain("callerId");
    expect(xml).toContain(">+19562921696</Dial>");
  });

  it("is well-formed TeXML with a timeout", () => {
    const xml = forwardXml("+19562921696", "+19565061545");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<Response>");
    expect(xml).toContain("</Response>");
    expect(xml).toContain('timeout="30"');
  });
});
