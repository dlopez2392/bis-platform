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
//   Every case of (b) and (c) is handled without knowing which: the next verb after the Gather is today's bridge,
//   and owner-pin (Task 9) treats a missing `Digits`, "" and "#" as today's path.
// The digits are keyed into Telnyx's leg BEFORE <Dial> runs, so they never reach OpenAI, its audio or our
// transcripts (spec §2.2).
//
// THE FALLTHROUGH IS TODAY'S BRIDGE. Every ask is followed by the same <Dial> a customer gets (passed in as `bridge`),
// with NO owner pass. Whatever Telnyx does when the ask times out, falling through or posting with no Digits, the
// caller reaches Sofía as a customer: "pound, or a timeout with no digits: today's normal call path" (§4.2). The
// one document that ends the call is the verified goodbye, after a call whose only purpose was the code.
//
// Imports nothing that reaches @bis/db (plan SC-18): the TeXML routes import this file statically.
import { xmlText } from "./xml";
import { firstName } from "@/lib/owner-line/names";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";

export const OWNER_PIN_TIMEOUT_SECONDS = 8;
const HEAD = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>`;

export function ownerPinUrl(origin: string): string {
  return `${origin}/api/voice/texml/owner-pin`;
}

function say(locale: Locale, text: string): string {
  return locale === "es" ? `<Say language="es-MX">${xmlText(text)}</Say>` : `<Say>${xmlText(text)}</Say>`;
}

function gather(action: string, inner: string): string {
  return `<Gather action="${xmlText(action)}" numDigits="6" timeout="${OWNER_PIN_TIMEOUT_SECONDS}" finishOnKey="#">${inner}</Gather>`;
}

export function ownerPinAskXml(p: { locale: Locale; name: string | null; persona: string; action: string; retry: boolean; bridge: string }): string {
  const name = firstName(p.name);
  const prompt = name
    ? t(m, "ownerLine.say.pinPrompt", p.locale, { name, persona: p.persona })
    : t(m, "ownerLine.say.pinPromptNoName", p.locale, { persona: p.persona });
  const inner = (p.retry ? say(p.locale, t(m, "ownerLine.say.pinWrong", p.locale)) : "") + say(p.locale, prompt);
  return `${HEAD}${gather(p.action, inner)}${p.bridge}</Response>`;
}

export function ownerVerifyAskXml(p: { locale: Locale; action: string; retry: boolean; bridge: string }): string {
  const inner = (p.retry ? say(p.locale, t(m, "ownerLine.say.verifyWrong", p.locale)) : "")
    + say(p.locale, t(m, "ownerLine.say.verifyPrompt", p.locale));
  return `${HEAD}${gather(p.action, inner)}${p.bridge}</Response>`;
}

export function ownerLimitXml(p: { locale: Locale; persona: string; bridge: string }): string {
  return `${HEAD}${say(p.locale, t(m, "ownerLine.say.limit", p.locale, { persona: p.persona }))}${p.bridge}</Response>`;
}

export function ownerVerifiedXml(locale: Locale): string {
  return `${HEAD}${say(locale, t(m, "ownerLine.say.verifyDone", locale))}<Hangup/></Response>`;
}
