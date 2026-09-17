// Pure decisions behind handing a call to a person. No database, no socket,
// no route — the twin of `call-limits.ts` and `silence-guard.ts` in shape,
// for the same reason: trivially testable, so the lifecycle wiring that
// calls these stays thin.

/**
 * Where — if anywhere — a caller who asks for a person can be sent.
 *
 * A tagged union rather than a boolean because the caller of this function
 * (the handoff route, arriving in a later task) needs the REASON for its
 * own log line: "not-configured" means the business never turned this on;
 * "own-number" means it tried to send the caller right back to itself.
 */
export type HandoffTarget =
  | { available: false; reason: "not-configured" | "own-number" }
  | { available: true; to: string };

/**
 * `transferPhone` mirrors `refusesAlertLoop`'s own history
 * (`apps/web/src/lib/sms/sender.ts:71-79`): that check started out testing
 * only the single number calls arrive on and was widened to every number
 * this account owns — `testing` OR `live` — after a second, still
 * provisioning number turned out to be an unguarded loop too. Dialling a
 * transfer target that is one of THIS account's own numbers would loop the
 * caller straight back into Sofía, so the check here is against the same
 * broader set for the same reason, not the narrower one.
 *
 * No number configured is refused first — the field on the voice profile
 * IS the on/off switch for this feature, the same rule the weekly report's
 * recipients field uses.
 */
export function resolveHandoffTarget(
  transferPhone: string | null,
  ownedNumbers: string[],
): HandoffTarget {
  if (!transferPhone) return { available: false, reason: "not-configured" };
  if (ownedNumbers.includes(transferPhone)) return { available: false, reason: "own-number" };
  return { available: true, to: transferPhone };
}

/**
 * A one-time credential authorising the handoff route to dial
 * `transferPhone` on the tenant's own trunk, at the tenant's own cost. This
 * is NOT a test fixture: `crypto.randomUUID()` (122 bits of CSPRNG entropy,
 * RFC 4122 v4) with its dashes stripped satisfies the `{22,}`-char base62-ish
 * regex every consumer checks against and needs no extra dependency. The
 * only `Math.random().toString(36)` generator in this tree lives in
 * `sms/fake.ts`/`email/fake.ts`/a test's org-id fixture — correct for a
 * disposable id nobody relies on for authorisation, catastrophic here.
 */
export function newHandoffToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * A MODEL INSTRUCTION. What Sofía says before the socket closes, handing the
 * caller to a human — handed to the still-open OpenAI socket as
 * `response.instructions` the way `silenceGoodbye` is
 * (`app/api/voice/incoming/route.ts:415`), which is why it carries the "Say
 * exactly this and nothing else" wrapper: nothing about a call ending is safe
 * to let the model improvise.
 *
 * Its counterpart `transferFailedLine` below is the OTHER family — TeXML
 * `<Say>` text, spoken by a route after this socket is gone. The wrapper
 * belongs to this function ONLY; put it on that one and the caller hears it
 * read aloud.
 *
 * `both` takes English, mirroring the greeting's own rule
 * (`app/api/voice/incoming/route.ts:764`,
 * `languages === "es" ? greeting_es : greeting_en`) rather than inventing a
 * second language policy for this one line.
 */
export function handoffLine(languages: "en" | "es" | "both"): string {
  const line = languages === "es"
    ? "Un momento, por favor. Le voy a comunicar con alguien de nuestro equipo."
    : "One moment, please. I'll connect you with someone from our team.";
  return `Say exactly this and nothing else: "${line}"`;
}

/**
 * TeXML `<Say>` TEXT — a bare sentence, NOT a model instruction. What the
 * caller hears if the transfer rings out with nobody picking up.
 *
 * Its consumer is a `<Say>` element in `/api/voice/texml/handoff-result`,
 * reached only after the OpenAI socket has closed: there is no model left to
 * instruct by then, so `handoffLine`'s `Say exactly this and nothing else:`
 * wrapper would simply be READ ALOUD to the caller, quotes and all.
 * The shape to copy is `texml/route.ts`'s own `COPY` — plain sentences that
 * go straight between the tags — not `silenceGoodbye`/`handoffLine`.
 *
 * Must be honest that nobody answered — the caller was already told they
 * were being put through, so this line must NOT promise a callback nothing
 * in this flow arranges; it says plainly that no one was reachable and lets
 * the caller decide what to do next. The Spanish avoids a gendered object
 * pronoun ("comunicarlo" addresses a masculine third person) for the same
 * reason `handoffLine` uses the formal dative: we do not know who is on the
 * phone.
 *
 * `both` takes ENGLISH, not `sayXml`'s EN-then-ES pair, and that is
 * deliberate on two counts. Product: this sentence answers `handoffLine`,
 * which the same caller heard seconds earlier in English on a `both`
 * profile; the two bracket one moment and must match, or the caller is told
 * they are being connected in one language and that it failed in another.
 * Mechanical: `sayXml` can offer both languages only because it emits the
 * ELEMENTS and can hang `language="es-MX"` on the Spanish one. This function
 * returns text FOR an element, so a two-language string would be Spanish
 * read by an English voice.
 */
export function transferFailedLine(languages: "en" | "es" | "both"): string {
  return languages === "es"
    ? "Lo siento, nadie pudo contestar en este momento."
    : "Sorry, we weren't able to reach anyone just now.";
}
