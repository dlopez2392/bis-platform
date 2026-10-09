// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/call-card-panel.tsx
//
// The call card at the top of a call: who called, why, the number to call
// back and the caller's own words — what an answering service sells, readable
// in three seconds. Written by `finishCall` (lib/voice/call-card.ts) after the
// call; this is a function of its props, a server component with no state.
import type { CallCard } from "@bis/db";
import { normalisePhone } from "@bis/db/phone";
import { m } from "@/lib/messages";
import { aiAuthorMark } from "@/lib/voice/provenance";
import { CARD, CARD_HEAD } from "./card";

/** A card of three nulls is no card: a call from before cards existed, a spam
 *  call, or a call whose card leg failed. The page renders no section for it
 *  rather than a panel of "Not recorded" lines claiming the call said nothing. */
export function hasCard(card: CallCard | null): card is CallCard {
  return Boolean(card && (card.reason || card.callbackNumber || card.callerWords));
}

/**
 * A tap-to-call link only when the number's country is CERTAIN. The card
 * stores the number as the caller said it (0064), and ten digits that are
 * valid in both the US and Mexico are exactly what `normalisePhone` flags
 * `unconfirmed`: a link would dial them as +1, which is the guess F-009 took
 * out of the contact writes. Those stay text, for a person who knows their
 * callers to dial.
 */
function telHref(number: string): string | null {
  const reading = normalisePhone(number);
  return reading && !reading.unconfirmed ? `tel:${reading.e164}` : null;
}

const LABEL = "text-sm text-muted-foreground";
const VALUE = "min-w-0 text-sm leading-6 break-words text-foreground";
const MISSING = "min-w-0 text-sm leading-6 text-muted-foreground";

export function CallCardPanel({
  who, card, personaName, language,
}: {
  /** `callerLabel(call)`: the contact's name, else the caller ID. */
  who: string;
  card: CallCard;
  /** The account's own receptionist name, for the author mark. */
  personaName: string;
  /** The language the call was in — the caller's words carry it (`lang`). */
  language: "en" | "es";
}) {
  const href = card.callbackNumber ? telHref(card.callbackNumber) : null;
  return (
    <section aria-labelledby="call-card" className={CARD}>
      <div className={`${CARD_HEAD} flex items-center justify-between gap-3`}>
        <h2 id="call-card">{m["calls.card.heading"]}</h2>
        {/* DESIGN.md, Provenance: who wrote this is never left to be
            inferred. Every line on this card is the receptionist's — what
            she wrote down on the call, or her reading of it. */}
        <span>{aiAuthorMark(personaName)}</span>
      </div>
      <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-[max-content_minmax(0,1fr)]">
        <dt className={LABEL}>{m["calls.card.who"]}</dt>
        <dd className={`${VALUE} font-medium`}>{who}</dd>

        <dt className={LABEL}>{m["calls.card.reason"]}</dt>
        {card.reason ? (
          <dd className={VALUE}>{card.reason}</dd>
        ) : (
          <dd className={MISSING}>{m["calls.card.reasonUnknown"]}</dd>
        )}

        <dt className={LABEL}>{m["calls.card.callback"]}</dt>
        {card.callbackNumber ? (
          <dd className={`${VALUE} font-medium tabular-nums`}>
            {href ? (
              <a href={href} className="underline-offset-4 hover:underline">{card.callbackNumber}</a>
            ) : (
              card.callbackNumber
            )}
          </dd>
        ) : (
          <dd className={MISSING}>{m["calls.card.callbackUnknown"]}</dd>
        )}

        {card.callerWords ? (
          <>
            <dt className={LABEL}>{m["calls.card.words"]}</dt>
            <dd className={VALUE}>
              <q lang={language}>{card.callerWords}</q>
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}
