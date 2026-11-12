// apps/web/src/app/api/voice/texml/owner-line-xml.ts
// The owner line's TeXML (F-032 §4.1, §4.2). NOT a route: a helper colocated with ./xml.ts.
//
// THE GATHER. Telnyx's <Gather> (https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/gather,
// read 2026-11-09 for plan Task 7 Step 1, a documentation read):
//   (a) `finishOnKey` IS a documented attribute: "The set of digits, (0-9, *, #), that indicates the end of the
//       gather", default `#`. It is written out anyway, so the document says what the caller is told.
//       `action`, `numDigits` and `timeout` (1-120, default 5) are documented too. Nothing else goes in, and no
//       `method`, for the screen's reason (route.ts screenAsk): Telnyx documents none and uses the TeXML
//       application's own method.
//   (b) What is sent when the finish key is pressed with NO digits: NOT documented. The callback reference
//       (https://developers.telnyx.com/api-reference/callbacks/texml-gather) says only that `Digits` is "only
//       present when input is dtmf", with To and From required.
//   (c) Whether a `timeout` with no input posts to `action` or falls through to the next verb: NOT documented.
//       The page says only that a callback is sent "when gather completes".
//   So BOTH may happen, and each must be today's path: Telnyx may post to owner-pin (Task 9 treats a missing
//   `Digits`, "" and "#" as today's path, re-run with the owner line skipped), or it may FALL THROUGH and run the
//   verbs after the Gather without asking us anything (route.ts's screen documents the same two cases, A and B).
// The digits are keyed into Telnyx's leg BEFORE <Dial> runs, so they never reach OpenAI, its audio or our
// transcripts (spec §2.2).
//
// THE FALLTHROUGH IS TODAY'S PATH, as the caller passes it in: today's bridge when every guard cleared (with its
// model-down ticket), or today's refusal and hang-up when an ask skipped one (Task 7 review C-1: a bridge after a
// skipped refusal would carry a ticket saying "every guard cleared" that is not true). It always carries NO owner
// pass. The one document that ends the call itself is the verified goodbye, after a call whose only purpose was
// the code.
//
// The words come from ./owner-line-copy, never the 562 KB catalogue: this file is imported statically by the
// answer route, which runs on Telnyx's answer deadline (review M-2). Nothing here reaches @bis/db (plan SC-18).
import { sayLine, xmlText } from "./xml";
import { OWNER_LINE_SAY } from "./owner-line-copy";
import { firstName } from "@/lib/owner-line/names";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

export const OWNER_PIN_TIMEOUT_SECONDS = 8;
const HEAD = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>`;

export function ownerPinUrl(origin: string): string {
  return `${origin}/api/voice/texml/owner-pin`;
}

function say(locale: Locale, text: string): string {
  return sayLine(locale === "es" ? "es" : "en", xmlText(text));
}

function gather(action: string, inner: string): string {
  return `<Gather action="${xmlText(action)}" numDigits="6" timeout="${OWNER_PIN_TIMEOUT_SECONDS}" finishOnKey="#">${inner}</Gather>`;
}

/** `fallthrough`: the verbs that follow the Gather, already TeXML: today's path for this caller (see the header). */
export function ownerPinAskXml(p: { locale: Locale; name: string | null; persona: string; action: string; retry: boolean; fallthrough: string }): string {
  const name = firstName(p.name);
  const prompt = name
    ? t(OWNER_LINE_SAY, "ownerLine.say.pinPrompt", p.locale, { name, persona: p.persona })
    : t(OWNER_LINE_SAY, "ownerLine.say.pinPromptNoName", p.locale, { persona: p.persona });
  const inner = (p.retry ? say(p.locale, t(OWNER_LINE_SAY, "ownerLine.say.pinWrong", p.locale)) : "") + say(p.locale, prompt);
  return `${HEAD}${gather(p.action, inner)}${p.fallthrough}</Response>`;
}

export function ownerVerifyAskXml(p: { locale: Locale; action: string; retry: boolean; fallthrough: string }): string {
  const inner = (p.retry ? say(p.locale, t(OWNER_LINE_SAY, "ownerLine.say.verifyWrong", p.locale)) : "")
    + say(p.locale, t(OWNER_LINE_SAY, "ownerLine.say.verifyPrompt", p.locale));
  return `${HEAD}${gather(p.action, inner)}${p.fallthrough}</Response>`;
}

/** Over the person's own daily limit: one line, then `fallthrough`, which is only ever today's cleared bridge (a
 *  person over their limit is a customer, so a refusal returns before this is reached). */
export function ownerLimitXml(p: { locale: Locale; persona: string; fallthrough: string }): string {
  return `${HEAD}${say(p.locale, t(OWNER_LINE_SAY, "ownerLine.say.limit", p.locale, { persona: p.persona }))}${p.fallthrough}</Response>`;
}

export function ownerVerifiedXml(locale: Locale): string {
  return `${HEAD}${say(locale, t(OWNER_LINE_SAY, "ownerLine.say.verifyDone", locale))}<Hangup/></Response>`;
}
