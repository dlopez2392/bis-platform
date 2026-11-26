// S-47b (spec section 5.1, SD8): the text-hash pin. Server and tests only (node:crypto). The corpus runner
// prints moduleTextSha256 into every results sheet, so a graded sheet is bound to exact words.
import { createHash } from "node:crypto";
import { TRADE_MODULES, type TradeModule, type TradeModuleContext, type TradeModuleId } from "./index";
import type { VoicePromptInput } from "../session-config";
import { buildSystemPrompt } from "../system-prompt";
import { toolSchemas } from "../tools/schemas";
import { bookingMode } from "../booking-mode";
import { openingGreeting } from "../greeting";

/** Every context a block can see: 3 media x handoff x canBook x 3 language settings = 36 (12 until v2's fix
 *  round added `languages`; v1's history entry was hashed over the 12 and is never recomputed). businessName is
 *  fixed: it is data. */
export const PIN_CONTEXTS: readonly TradeModuleContext[] = (["phone", "web", "web_voice"] as const).flatMap(
  (medium) => [false, true].flatMap((handoffAvailable) => [false, true].flatMap((canBook) =>
    (["en", "es", "both"] as const).map((languages) => ({
      businessName: "Pin Test Co", medium, handoffAvailable, canBook, languages,
    })))),
);

export function moduleTextSha256(mod: Pick<TradeModule, "heading" | "block">): string {
  const h = createHash("sha256");
  h.update(mod.heading);
  for (const ctx of PIN_CONTEXTS) h.update(`\u0000${JSON.stringify(ctx)}\n${mod.block(ctx).join("\n")}`);
  return h.digest("hex");
}

/**
 * APPEND-ONLY. Index N-1 is the sha256 of VERSION N's words. Changing a module's words means: bump its
 * VERSION, APPEND the new hash here, re-run the corpus for the new version. Never edit an existing entry:
 * once a version is graded, its results sheet records this hash and corpus.test.ts fails if they differ.
 */
export const SHA256_HISTORY: Readonly<Record<TradeModuleId, readonly string[]>> = {
  insurance_pc: [
    "871d340f7626489ca98cd0dedf643da136a43e5e6520198fa30f35c349799874",
    "034a1dededa15b781fbb44524e696f4438ac0e04860a46305744daed7b9ab538", // v2, 2026-10-22: corpus run 1's fixes (+ review fix round; v2 was never graded)
    "e2ac40e1fa7ba605a944b5edbffdafe637d54887374568fe64f1083b8adcaa6f", // v3, 2026-10-22: corpus run 2's fixes (911 first, offer only on the URGENT line, email names, ask the number first)
  ],
  events: [
    "e9db9a25be740d84931d3e7ce645b2426eada6c0808abc72e1f7eee6439c697a",
    "bd4eb06f12173ecaa902138344c8a20d9aaa8da5ff1a2af724971a6fbc950278", // v2, 2026-10-22: corpus run 1's fixes (+ review fix round; v2 was never graded)
    "ce771aa40a6c456bd5a82f521108af4fe4eb674ba665353e2754f223aba73082", // v3, 2026-10-22: corpus run 2's fixes (911 first, offer only on the URGENT line, invented policy named, email names, ask the number first)
  ],
};

// Model switch plan G1/Q2 (owner, 2026-11-26): the BASE corpus slice grades the prompt a live call runs with no trade
// module, so its sheets are bound to THOSE words: everything the session is sent besides the business's own data
// (buildSystemPrompt, the tools, the greeting instruction), over every phone context a base item can play. The data is
// fixed ("Pin Test Co"), as PIN_CONTEXTS fixes businessName; structured hours, the price list and a business status
// are absent, as on the base fixture.

/** booking x handoff x 3 language settings x caller ID shown/withheld x 2 after-hours modes x 3 meeting types x
 *  disclosure = 288. Phone only (`medium` absent, as the incoming route sends it). */
export const BASE_PIN_INPUTS: readonly VoicePromptInput[] = [false, true].flatMap((bookingEnabled) =>
  [false, true].flatMap((handoffAvailable) => (["en", "es", "both"] as const).flatMap((languages) =>
    ["+19565550100", null].flatMap((callerNumber) => (["hours_then_message", "message_only"] as const).flatMap((afterHours) =>
      (["in_person", "phone", "video"] as const).flatMap((meetingType) => [false, true].map((disclosed): VoicePromptInput => ({
        personaName: "Sofía", businessName: "Pin Test Co", facts: "- Pin facts.", services: "Pin services",
        languages, bookingEnabled, timezone: "America/Chicago", slotDurationMinutes: 60, afterHours, callerNumber,
        meetingType, handoffAvailable, disclosed, tradeModule: null,
      }))))))));

const BASE_PIN_NOW = new Date("2026-12-01T16:00:00.000Z");
/** The prompt's one clock-and-ICU-dependent line, masked so the pin holds on any day and any Node build. */
const DATE_LINE = /^The current date and time is .*$/m;

/** The words the base pin hashes, in order. Exported so a test can see what is covered. */
export function basePinText(now: Date = BASE_PIN_NOW): string {
  return BASE_PIN_INPUTS.map((input) => [
    JSON.stringify(input),
    buildSystemPrompt(input, now).replace(DATE_LINE, "The current date and time is <masked>."),
    JSON.stringify(toolSchemas(bookingMode(input), input.meetingType, input.handoffAvailable === true)),
    // Blank greetings: each falls back to its fixed sentence, so the instruction's own words are what is hashed.
    openingGreeting({ languages: input.languages, greeting_en: "", greeting_es: "" }, input.businessName,
      { disclose: input.disclosed === true, personaName: input.personaName }).instruction,
  ].join("\n")).join("\u0000");
}

export function basePromptSha256(now: Date = BASE_PIN_NOW): string {
  return createHash("sha256").update(basePinText(now)).digest("hex");
}

/** The base slice's VERSION. Bump it, and APPEND the new hash below, whenever the live phone prompt's words change
 *  (system-prompt.ts, its knowledge blocks, the tool descriptions or the greeting instruction). */
export const BASE_VERSION = 1;
/** APPEND-ONLY, as SHA256_HISTORY. Index N-1 is the sha256 of base VERSION N's words. */
export const BASE_SHA256_HISTORY: readonly string[] = [
  "2c17a02f823d1dafe59a6881b8f8e7dceb02624abfc86adb483533d59a02d484", // v1, 2026-11-26: the live prompt as of 0347b7a8 (model switch PR 2)
];

/** Every corpus's history, keyed as the corpus runner names it (corpus-lib.ts's CorpusModuleId). */
export const CORPUS_SHA256_HISTORY: Readonly<Record<TradeModuleId | "base", readonly string[]>> = {
  ...SHA256_HISTORY, base: BASE_SHA256_HISTORY,
};

/** The version and hash a corpus run prints on its sheet and every transcript. */
export function corpusPin(id: TradeModuleId | "base"): { version: number; sha256: string } {
  if (id === "base") return { version: BASE_VERSION, sha256: basePromptSha256() };
  const mod = TRADE_MODULES[id];
  return { version: mod.version, sha256: moduleTextSha256(mod) };
}
