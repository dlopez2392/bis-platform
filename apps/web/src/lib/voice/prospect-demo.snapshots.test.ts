// F-023 PR 4: the prospect demo's whole instructions (prompt + prospectDemoNotice), byte for byte, from the typed
// form through buildProspectDemoSession: every trade that has a module plus one that has none × languages × open or
// closed right now = 18 prompts. Three are kept as full text (one per trade, open and closed); the other 15 are one
// digest. See prompt-snapshots.fixture.ts for how to rewrite the samples and see a digest's changed text.
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { parseProspectDemo, buildProspectDemoSession, type ProspectDemoForm } from "./prospect-demo";
import { checkSamples, digestPrompts } from "./prompt-snapshots.fixture";
import { CUSTOMER_TOOL_NAMES } from "../tools/customer/specs";

const FIXTURE = fileURLToPath(new URL("./prospect-demo.prompt-samples.json", import.meta.url));
const SAMPLES = ["landscaping|en|closed", "insurance|both|open", "events|es|open"];
/** sha256 (digestPrompts) over the 15 prompts that are not SAMPLES, in enumeration order: F-023 PR 4's re-baseline. */
const NOTICE_HEADING = "## This conversation is a preview in a web browser, not the phone line";
/** Every way the prompt has said "take a message" or "they will be called back", in English and in Spanish. */
const MESSAGE_WORDS = /take a message|take their details|call (them|you) back|(tomar|dejar|tomarle|dejarle) (un|su) (mensaje|recado)|le (van a|vamos a) llamar/i;
const REST_DIGEST ="60c0821d7215adb365244ea9b2b45247c847f22e59c87f1e5df15a4fd87feb12";
/** A Monday, 9:00 AM in Chicago: the weekday row decides open or closed. */
const NOW = new Date("2026-11-16T15:00:00Z");

const HOURS = {
  open: { open: true, from: "08:00", to: "17:00" },
  closed: { open: true, from: "13:00", to: "17:00" },
} as const;

function instructions(trade: string, languages: ProspectDemoForm["languages"], weekdays: keyof typeof HOURS): string {
  const parsed = parseProspectDemo({
    businessName: "Garza Lawn & Garden", trade, tradeOther: "", languages,
    hours: {
      weekdays: HOURS[weekdays],
      saturday: { open: true, from: "08:00", to: "12:00" },
      sunday: { open: false, from: "", to: "" },
    },
    services: [{ name: "Lawn mowing", price: "45", minutes: "40" }, { name: "Hedge trimming", price: "", minutes: "" }],
  } satisfies ProspectDemoForm);
  if (!parsed.ok) throw new Error(`fixture refused: ${parsed.error}`);
  return buildProspectDemoSession(parsed.profile, NOW).session.instructions;
}

function allInstructions(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const trade of ["landscaping", "insurance", "events"])
    for (const languages of ["en", "es", "both"] as const)
      for (const weekdays of ["open", "closed"] as const)
        out[`${trade}|${languages}|${weekdays}`] = instructions(trade, languages, weekdays);
  return out;
}

describe("the prospect demo's whole instructions, byte for byte (F-023 PR 4)", () => {
  it("every combination is exactly the captured one (18 of them: 3 samples in full, 15 as a digest)", () => {
    const actual = allInstructions();
    expect(Object.keys(actual).length).toBe(18);
    const r = checkSamples(FIXTURE, Object.fromEntries(SAMPLES.map((k) => [k, actual[k]!])));
    expect(r.written, "WRITE_PROMPT_SNAPSHOTS=1 rewrote the samples; run again without it").toBe(false);
    expect(r.keys).toEqual(SAMPLES);
    for (const m of r.mismatched) expect.soft(m.actual, m.key).toBe(m.expected);
    const rest = Object.entries(actual).filter(([k]) => !SAMPLES.includes(k)).map(([, p]) => p);
    expect(rest.length).toBe(15);
    expect.soft(digestPrompts(rest), "the 15 prompts that are not samples").toBe(REST_DIGEST);
  });

  // Owner decision 2026-11-19: nothing reaches anyone from a demo, so above its notice the prompt never tells her to
  // take a message or have someone call back; it points to the notice, which is there, after a blank line.
  it("never tells her to take a message, in any combination, and always carries the notice after a blank line", () => {
    const wrong = Object.entries(allInstructions()).flatMap(([key, text]) => {
      const at = text.indexOf(`\n\n${NOTICE_HEADING}`);
      if (at < 0) return [`${key}: no notice after a blank line`];
      const above = text.slice(0, at);
      return MESSAGE_WORDS.test(above) ? [`${key}: ${above.split("\n").find((l) => MESSAGE_WORDS.test(l))}`] : [];
    });
    expect(wrong).toEqual([]);
  });

  // The F-023 §2 defect's regression test: the session is minted with `tools: []`, so its prompt may name no tool.
  it("names no customer tool, in any combination: the session has none", () => {
    const named = Object.entries(allInstructions())
      .flatMap(([key, text]) => CUSTOMER_TOOL_NAMES.filter((n) => text.includes(n)).map((n) => `${key}: ${n}`));
    expect(named).toEqual([]);
  });
});
