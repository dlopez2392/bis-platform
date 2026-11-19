// F-023 PR 4: the prospect demo's whole instructions (prompt + prospectDemoNotice), byte for byte, from the typed
// form through buildProspectDemoSession: every trade that has a module plus one that has none × languages × open or
// closed right now = 18 prompts. Three are kept as full text (one per trade, open and closed); the other 15 are one
// digest. See prompt-snapshots.fixture.ts for how to rewrite the samples and see a digest's changed text.
//
// The samples and the digest are MAIN's (e0b651b8, F-023 PR 4) and stay so: the prospect demo keeps the phone's words
// (its notice says to answer exactly as the real line would, and handles a booking or a message itself), and the one
// change since is the blank line before the notice heading. The comparison takes that blank line out first, and a
// separate test proves it is there.
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { parseProspectDemo, buildProspectDemoSession, type ProspectDemoForm } from "./prospect-demo";
import { checkSamples, digestPrompts } from "./prompt-snapshots.fixture";
import { CUSTOMER_TOOL_NAMES } from "../tools/customer/specs";

const FIXTURE = fileURLToPath(new URL("./prospect-demo.prompt-samples.json", import.meta.url));
const SAMPLES = ["landscaping|en|closed", "insurance|both|open", "events|es|open"];
/** sha256 (digestPrompts) over the 15 prompts that are not SAMPLES, in enumeration order, as main built them. */
const REST_DIGEST = "60c0821d7215adb365244ea9b2b45247c847f22e59c87f1e5df15a4fd87feb12";
const NOTICE_HEADING = "## This conversation is a preview in a web browser, not the phone line";
/** The instructions as main built them: the notice heading directly after the prompt's last line. */
const asOnMain = (text: string): string => text.replace(`\n\n${NOTICE_HEADING}`, `\n${NOTICE_HEADING}`);
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
  it("every combination is main's prompt, byte for byte, apart from the blank line (18: 3 samples in full, 15 as a digest)", () => {
    const actual = Object.fromEntries(Object.entries(allInstructions()).map(([k, t]) => [k, asOnMain(t)]));
    expect(Object.keys(actual).length).toBe(18);
    const r = checkSamples(FIXTURE, Object.fromEntries(SAMPLES.map((k) => [k, actual[k]!])));
    expect(r.written, "WRITE_PROMPT_SNAPSHOTS=1 rewrote the samples; run again without it").toBe(false);
    expect(r.keys).toEqual(SAMPLES);
    for (const m of r.mismatched) expect.soft(m.actual, m.key).toBe(m.expected);
    const rest = Object.entries(actual).filter(([k]) => !SAMPLES.includes(k)).map(([, p]) => p);
    expect(rest.length).toBe(15);
    expect.soft(digestPrompts(rest), "the 15 prompts that are not samples").toBe(REST_DIGEST);
  });

  it("carries its notice once, after a blank line, in every combination", () => {
    const wrong = Object.entries(allInstructions())
      .filter(([, text]) => text.split(`\n\n${NOTICE_HEADING}`).length !== 2 || text.split(NOTICE_HEADING).length !== 2)
      .map(([key]) => key);
    expect(wrong).toEqual([]);
  });

  // The F-023 §2 defect's regression test: the session is minted with `tools: []`, so its prompt may name no tool.
  it("names no customer tool, in any combination: the session has none", () => {
    const named = Object.entries(allInstructions())
      .flatMap(([key, text]) => CUSTOMER_TOOL_NAMES.filter((n) => text.includes(n)).map((n) => `${key}: ${n}`));
    expect(named).toEqual([]);
  });
});
