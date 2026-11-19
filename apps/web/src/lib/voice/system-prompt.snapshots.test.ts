// F-023 PR 4: the phone's and the web chat's whole prompt, byte for byte, pinned as sha256 digests computed from main
// 4b7e9147's builder (this branch's first commit, aa11e7a2), BEFORE the prompt learned which tools its session was
// offered. Every input that can change a line naming a tool is crossed with every other:
//   phone (the incoming route's input shape: no `medium`, a boolean handoff) — bookingEnabled × afterHours (together
//   every booking mode) × meetingType × handoffAvailable × trade module (none + every TRADE_MODULE_IDS) × languages ×
//   caller ID shown or withheld × the hours/status state (none, open, closed, Closed today with no hours, an
//   open-ended storm) × disclosed = 4320 prompts;
//   web chat (the concierge turn route's input shape: booking off, no caller ID, no handoff) — trade module ×
//   languages × afterHours × the hours/status state × disclosed = 180 prompts.
// Not crossed (no line naming a tool reads them): the price list and its failed read, the closed-days block,
// Running late, the persona, the facts and the services text.
//
// One digest per group (booking setting × after-hours × meeting type × handoff: 24 phone groups) plus one for the web
// chat, so a failure names its group. Groups whose prompts cannot differ (meeting type only matters with new booking
// on) share a digest. To REGENERATE after a deliberate change: run this file; the failure's diff prints every group's
// new digest. To SEE the changed text: build the failing group's prompts with this file's inputs at the base commit
// and at yours, and diff them (a phone change is a finding, never a re-baseline: plan §4 PR 4).
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt";
import type { VoicePromptInput } from "./session-config";
import { TRADE_MODULE_IDS, type TradeModuleId } from "./modules";
import type { OpenHours } from "../booking/slots";
import type { EffectiveStatus } from "../business-status/status";
import { offeredTools } from "./tools/offered";
import { digestPrompts as digestOf } from "./prompt-snapshots.fixture";
import { CUSTOMER_TOOL_NAMES, type CustomerToolName } from "../tools/customer/specs";

/** A Tuesday, 10:00 AM in Chicago. */
const NOW = new Date("2027-06-01T15:00:00Z");
const OPEN_H: OpenHours = { tue: [["08:00", "18:00"]] };
const CLOSED_H: OpenHours = { tue: [["13:00", "18:00"]], wed: [["08:00", "12:00"]] };
const S_CLOSED_TODAY: EffectiveStatus = { state: "closed_today", reopensAt: new Date("2027-06-02T13:00:00Z"), reopensTimeKnown: true };
const S_STORM_OPEN: EffectiveStatus = { state: "storm", reopensAt: null, reopensTimeKnown: false };

const STATES = {
  none: {},
  open: { businessHours: OPEN_H },
  closed: { businessHours: CLOSED_H },
  closedToday: { businessStatus: S_CLOSED_TODAY },
  storm: { businessHours: OPEN_H, businessStatus: S_STORM_OPEN },
} as const satisfies Record<string, Partial<VoicePromptInput>>;
const MODULES: readonly (TradeModuleId | null)[] = [null, ...TRADE_MODULE_IDS];
const LANGUAGES = ["en", "es", "both"] as const;
const AFTER_HOURS = ["hours_then_message", "message_only"] as const;

const common = {
  personaName: "Sofía", businessName: "Rio Roofing",
  facts: "- We repair and replace residential roofs in the RGV.",
  services: "Roof repair, full replacement, inspections",
  timezone: "America/Chicago",
};

function phoneInputs(): Record<string, VoicePromptInput> {
  const out: Record<string, VoicePromptInput> = {};
  for (const bookingEnabled of [true, false])
    for (const afterHours of AFTER_HOURS)
      for (const meetingType of ["in_person", "phone", "video"] as const)
        for (const handoffAvailable of [false, true])
          for (const tradeModule of MODULES)
            for (const languages of LANGUAGES)
              for (const callerNumber of ["+19565550196", null])
                for (const [state, extra] of Object.entries(STATES))
                  for (const disclosed of [false, true]) {
                    const key = [`booking=${bookingEnabled}`, afterHours, meetingType, `handoff=${handoffAvailable}`,
                      tradeModule ?? "no-module", languages, callerNumber ? "caller-id" : "withheld", state,
                      disclosed ? "disclosed" : "undisclosed"].join("|");
                    out[key] = {
                      ...common, languages, bookingEnabled, slotDurationMinutes: 60, afterHours, callerNumber,
                      meetingType, handoffAvailable, disclosed, tradeModule, ...extra,
                    };
                  }
  return out;
}

function chatInputs(): Record<string, VoicePromptInput> {
  const out: Record<string, VoicePromptInput> = {};
  for (const tradeModule of MODULES)
    for (const languages of LANGUAGES)
      for (const afterHours of AFTER_HOURS)
        for (const [state, extra] of Object.entries(STATES))
          for (const disclosed of [false, true]) {
            const key = ["web", tradeModule ?? "no-module", languages, afterHours, state, disclosed ? "disclosed" : "undisclosed"].join("|");
            out[key] = {
              ...common, languages, bookingEnabled: false, slotDurationMinutes: 30, afterHours, callerNumber: null,
              meetingType: "in_person", medium: "web", disclosed, tradeModule, ...extra,
            };
          }
  return out;
}

const PHONE_INPUTS = phoneInputs();
const CHAT_INPUTS = chatInputs();

function prompts(inputs: Record<string, VoicePromptInput>): Record<string, string> {
  return Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, buildSystemPrompt(i, NOW)]));
}
/** Built once and read by both describes below: the file runs alongside the whole suite, so it stays cheap. */
let phonePrompts: Record<string, string> | undefined;
const PHONE_PROMPTS = () => (phonePrompts ??= prompts(PHONE_INPUTS));
/** The phone inputs with one language and one disclosure (neither changes a line naming a tool): 720. */
const SURFACE_INPUTS = Object.entries(PHONE_INPUTS).filter(([, i]) => i.languages === "both" && !i.disclosed);

describe("the whole system prompt, byte for byte, as digests (F-023 PR 4: captured before the prompt read its offered tools)", () => {
  it("covers 4320 phone combinations and 180 web chat combinations (guards the comparison from an empty loop)", () => {
    expect(Object.keys(PHONE_INPUTS).length).toBe(4320);
    expect(Object.keys(CHAT_INPUTS).length).toBe(180);
  });

  it("every group's prompts hash to the digest captured from main's builder (a failure names the group)", () => {
    const groups: Record<string, string[]> = {};
    for (const [k, p] of Object.entries(PHONE_PROMPTS())) (groups[k.split("|").slice(0, 4).join("|")] ??= []).push(p);
    groups["web chat"] = Object.values(prompts(CHAT_INPUTS));
    expect(Object.values(groups).map((ps) => ps.length)).toEqual(Array(25).fill(180));
    expect(Object.fromEntries(Object.entries(groups).map(([g, ps]) => [g, digestOf(ps)]))).toEqual(DIGESTS);
  }, 30_000); // 4500 prompts, under a second idle: room so a loaded runner cannot time it out
});

/** sha256 over each group's prompts in enumeration order, each followed by NUL, from main 4b7e9147's builder. */
const DIGESTS: Record<string, string> = {
  "booking=true|hours_then_message|in_person|handoff=false": "64a30ab03c9f2a3f46b2b1c8037e229a1a421a384dac7d8709200f3707a70e5e",
  "booking=true|hours_then_message|in_person|handoff=true": "bb149afee9a9ccac3ed1fbda727b7438078ee388436e1526d9a95d37e25277e1",
  "booking=true|hours_then_message|phone|handoff=false": "64a30ab03c9f2a3f46b2b1c8037e229a1a421a384dac7d8709200f3707a70e5e",
  "booking=true|hours_then_message|phone|handoff=true": "bb149afee9a9ccac3ed1fbda727b7438078ee388436e1526d9a95d37e25277e1",
  "booking=true|hours_then_message|video|handoff=false": "30f5715ec3ac8446b3248d3f24e572a213db15fc160abd265abf3136978cfe7c",
  "booking=true|hours_then_message|video|handoff=true": "bd3c5c970e786ff0391f1069d52dc0211183749f241495a11ab63388e15d4b3b",
  "booking=true|message_only|in_person|handoff=false": "5307ee2ca1d8d937ec652d05eec8e7bd983bd1d9b2cf82c6dc176b4a1f5ab47d",
  "booking=true|message_only|in_person|handoff=true": "7a8e4c45fd462aef88a1df7a06627bb98f5edf765f8c3240e6278c475a0a0371",
  "booking=true|message_only|phone|handoff=false": "5307ee2ca1d8d937ec652d05eec8e7bd983bd1d9b2cf82c6dc176b4a1f5ab47d",
  "booking=true|message_only|phone|handoff=true": "7a8e4c45fd462aef88a1df7a06627bb98f5edf765f8c3240e6278c475a0a0371",
  "booking=true|message_only|video|handoff=false": "5307ee2ca1d8d937ec652d05eec8e7bd983bd1d9b2cf82c6dc176b4a1f5ab47d",
  "booking=true|message_only|video|handoff=true": "7a8e4c45fd462aef88a1df7a06627bb98f5edf765f8c3240e6278c475a0a0371",
  "booking=false|hours_then_message|in_person|handoff=false": "f4e53c72c3d3404cb5cedacdd235a8dc56fbe3fb9da9ea7bc5ed8bb27974f231",
  "booking=false|hours_then_message|in_person|handoff=true": "9c2419a5dc435607556b7ef5a787c00cea057e8c69e798d42791c8b424a3bd39",
  "booking=false|hours_then_message|phone|handoff=false": "f4e53c72c3d3404cb5cedacdd235a8dc56fbe3fb9da9ea7bc5ed8bb27974f231",
  "booking=false|hours_then_message|phone|handoff=true": "9c2419a5dc435607556b7ef5a787c00cea057e8c69e798d42791c8b424a3bd39",
  "booking=false|hours_then_message|video|handoff=false": "f4e53c72c3d3404cb5cedacdd235a8dc56fbe3fb9da9ea7bc5ed8bb27974f231",
  "booking=false|hours_then_message|video|handoff=true": "9c2419a5dc435607556b7ef5a787c00cea057e8c69e798d42791c8b424a3bd39",
  "booking=false|message_only|in_person|handoff=false": "e1f22a1255299f7ccf888b8b328d5892a375e1c827fe1d06e8f33fbcb2adc6f3",
  "booking=false|message_only|in_person|handoff=true": "9330d30430c0842e1df0bd2f36e8009b023bc3897b548f9495550dfad1531b8d",
  "booking=false|message_only|phone|handoff=false": "e1f22a1255299f7ccf888b8b328d5892a375e1c827fe1d06e8f33fbcb2adc6f3",
  "booking=false|message_only|phone|handoff=true": "9330d30430c0842e1df0bd2f36e8009b023bc3897b548f9495550dfad1531b8d",
  "booking=false|message_only|video|handoff=false": "e1f22a1255299f7ccf888b8b328d5892a375e1c827fe1d06e8f33fbcb2adc6f3",
  "booking=false|message_only|video|handoff=true": "9330d30430c0842e1df0bd2f36e8009b023bc3897b548f9495550dfad1531b8d",
  "web chat": "a4b35c36f5ecf5f381d4f389bd65f5ab9d6d3f16dacabb30fe301a523095c40e",
};

/** Every customer tool the prompt names. */
function named(prompt: string): CustomerToolName[] {
  return CUSTOMER_TOOL_NAMES.filter((n) => prompt.includes(n));
}

// F-023 PR 4 (plan §3.5): a line naming a tool appears only when the session is offered that tool. The phone inputs
// are also run as each other surface, the profiles those surfaces never send included (booking on, a transfer
// number), so the rule is checked on the inputs, not only on what today's routes happen to pass.
describe("the prompt names only the tools its session is offered (F-023 PR 4)", () => {
  it("the phone, in every combination", () => {
    const wrong = Object.entries(PHONE_INPUTS).flatMap(([k, i]) => {
      const offered = offeredTools(i);
      return named(PHONE_PROMPTS()[k]!).filter((n) => !offered.has(n)).map((n) => `${k}: ${n}`);
    });
    expect(wrong).toEqual([]);
  });

  it("a browser demo (web_voice) names no tool at all, whatever the profile says", () => {
    expect(SURFACE_INPUTS.length).toBe(720);
    const wrong = SURFACE_INPUTS.flatMap(([k, i]) =>
      named(buildSystemPrompt({ ...i, medium: "web_voice" }, NOW)).map((n) => `${k}: ${n}`));
    expect(wrong).toEqual([]);
  });

  it("the web chat names capture_lead and nothing else, apart from the one line that says the phone's two do not exist here", () => {
    const ONLY = "- capture_lead is the ONLY tool you have here.";
    const wrong = [...SURFACE_INPUTS, ...Object.entries(CHAT_INPUTS)].flatMap(([k, i]) => {
      const p = buildSystemPrompt({ ...i, medium: "web" }, NOW).split("\n").filter((l) => !l.startsWith(ONLY)).join("\n");
      return named(p).filter((n) => n !== "capture_lead").map((n) => `${k}: ${n}`);
    });
    expect(wrong).toEqual([]);
  });
});
