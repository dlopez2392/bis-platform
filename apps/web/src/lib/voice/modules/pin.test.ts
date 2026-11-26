import { describe, it, expect } from "vitest";
import { TRADE_MODULES } from "./index";
import {
  BASE_PIN_INPUTS, BASE_VERSION, BASE_SHA256_HISTORY, CORPUS_SHA256_HISTORY, SHA256_HISTORY,
  basePinText, basePromptSha256, corpusPin, moduleTextSha256,
} from "./pin";

// Model switch plan G1/Q2 (owner, 2026-11-26): the base corpus slice grades the prompt a live call runs with no
// trade module. Its pin binds a graded sheet to those words, as SHA256_HISTORY binds a module's sheet to its block.
describe("the base corpus pin: change a word of the live phone prompt and this fails until BASE_VERSION is bumped and a hash appended", () => {
  it("hashes 288 phone inputs: booking x handoff x 3 language settings x caller ID x after-hours mode x 3 meeting types x disclosure, none with a trade module (mutation: drop a meeting type -> FAILS)", () => {
    expect(BASE_PIN_INPUTS.length).toBe(288);
    expect(new Set(BASE_PIN_INPUTS.map((i) => JSON.stringify(i))).size).toBe(288);
    for (const i of BASE_PIN_INPUTS) {
      expect(i.medium).toBeUndefined();
      expect(i.tradeModule).toBeNull();
    }
    expect(new Set(BASE_PIN_INPUTS.map((i) => i.meetingType))).toEqual(new Set(["in_person", "phone", "video"]));
    expect(new Set(BASE_PIN_INPUTS.map((i) => i.callerNumber === null))).toEqual(new Set([true, false]));
  });

  it("history length is BASE_VERSION, the last entry is today's prompt, and no two versions share a hash (mutations: change one word of system-prompt.ts -> FAILS; bump BASE_VERSION without appending -> FAILS)", () => {
    expect(Number.isInteger(BASE_VERSION) && BASE_VERSION >= 1).toBe(true);
    expect(BASE_SHA256_HISTORY.length).toBe(BASE_VERSION);
    expect(BASE_SHA256_HISTORY[BASE_VERSION - 1]).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(BASE_SHA256_HISTORY[BASE_VERSION - 1]).toBe(basePromptSha256());
    expect(new Set(BASE_SHA256_HISTORY).size).toBe(BASE_SHA256_HISTORY.length);
  });

  it("the hash does not move with the clock: the prompt's date line is masked, so the pin holds on any day and any ICU build (mutation: drop the mask -> FAILS)", () => {
    expect(basePromptSha256(new Date("2026-12-01T16:00:00Z"))).toBe(basePromptSha256(new Date("2027-07-04T03:30:00Z")));
    expect(basePinText(new Date("2026-12-01T16:00:00Z"))).toContain("The current date and time is <masked>");
  });

  it("covers what the session is sent besides the prompt: the tools and the greeting instruction (mutation: hash the prompt alone -> FAILS)", () => {
    const text = basePinText();
    expect(text).toContain('"name":"transfer_to_human"');
    expect(text).toContain('"name":"find_my_booking"');
    expect(text).toContain("Greet the caller with these two greetings, word for word");
    expect(text).toContain("Greet the caller with exactly: ");
  });

  it("corpusPin names the version and hash each corpus's sheet prints: a module's own, or the base prompt's", () => {
    expect(corpusPin("events")).toEqual({ version: TRADE_MODULES.events.version, sha256: moduleTextSha256(TRADE_MODULES.events) });
    expect(corpusPin("insurance_pc")).toEqual({ version: TRADE_MODULES.insurance_pc.version, sha256: moduleTextSha256(TRADE_MODULES.insurance_pc) });
    expect(corpusPin("base")).toEqual({ version: BASE_VERSION, sha256: basePromptSha256() });
  });

  it("CORPUS_SHA256_HISTORY holds the two modules' histories unchanged plus the base one", () => {
    expect(CORPUS_SHA256_HISTORY).toEqual({ ...SHA256_HISTORY, base: BASE_SHA256_HISTORY });
  });
});
