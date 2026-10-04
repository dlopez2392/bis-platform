import { describe, it, expect } from "vitest";
import { fallbackDrillActive, FALLBACK_DRILL_SIP_BASE } from "./fallback-drill";

const env = (to?: string, from?: string) =>
  ({ VOICE_FALLBACK_DRILL_TO: to, VOICE_FALLBACK_DRILL_FROM: from }) as unknown as NodeJS.ProcessEnv;
const LINE = "+19565550999";
const ME = "+19565550111";

describe("the model-down fallback drill switch", () => {
  it("engages only for the drill line called FROM the drill caller", () => {
    expect(fallbackDrillActive(LINE, ME, env(LINE, ME))).toBe(true);
    expect(fallbackDrillActive("+19565550998", ME, env(LINE, ME))).toBe(false);
  });

  it("another caller to the drill line still reaches Sofía (mutation: match on the called number alone → FAILS)", () => {
    expect(fallbackDrillActive(LINE, "+19565550222", env(LINE, ME))).toBe(false);
    expect(fallbackDrillActive(LINE, null, env(LINE, ME))).toBe(false);
  });

  it("is off when either half is unset, blank or malformed — a half-configured drill never cuts Sofía off", () => {
    expect(fallbackDrillActive(LINE, ME, env())).toBe(false);
    expect(fallbackDrillActive(LINE, ME, env(LINE))).toBe(false);
    expect(fallbackDrillActive(LINE, ME, env(undefined, ME))).toBe(false);
    expect(fallbackDrillActive(LINE, ME, env("  ", ME))).toBe(false);
    expect(fallbackDrillActive("9565550999", ME, env("9565550999", ME))).toBe(false);
    expect(fallbackDrillActive(null, null, env("", ""))).toBe(false);
  });

  it("tolerates surrounding whitespace in the env values", () => {
    expect(fallbackDrillActive(LINE, ME, env(` ${LINE} `, `${ME}\n`))).toBe(true);
  });

  it("dials a name reserved never to resolve (RFC 6761), so no traffic leaves for OpenAI or anyone", () => {
    expect(FALLBACK_DRILL_SIP_BASE).toMatch(/^sip:[^@]+@[a-z0-9-]+\.invalid;transport=tls$/);
    expect(FALLBACK_DRILL_SIP_BASE).not.toContain("openai");
  });
});
