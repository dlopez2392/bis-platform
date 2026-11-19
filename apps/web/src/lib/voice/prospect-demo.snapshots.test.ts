// F-023 PR 4: the prospect demo's whole instructions (prompt + prospectDemoNotice), byte for byte, from the typed
// form through buildProspectDemoSession: every trade that has a module plus one that has none × languages × open or
// closed right now = 18 prompts. See prompt-snapshots.fixture.ts for the encoding and how to write it.
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { parseProspectDemo, buildProspectDemoSession, type ProspectDemoForm } from "./prospect-demo";
import { checkSnapshots, readSnapshot } from "./prompt-snapshots.fixture";

const FIXTURE = fileURLToPath(new URL("./prospect-demo.snapshots.json", import.meta.url));
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
  it("every combination is exactly the captured one (18 of them)", () => {
    const actual = allInstructions();
    expect(Object.keys(actual).length).toBe(18);
    const r = checkSnapshots(FIXTURE, "lines", actual);
    expect(r.written, "WRITE_PROMPT_SNAPSHOTS=1 rewrote the fixture; run again without it").toBe(false);
    expect(r.missingKeys).toEqual([]);
    expect(r.extraKeys).toEqual([]);
    const first = r.mismatched[0];
    if (first) expect(actual[first], first).toBe(readSnapshot(FIXTURE, first));
    expect(r.mismatched).toEqual([]);
  });
});
