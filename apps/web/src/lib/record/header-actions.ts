import type { PlaceRow, ContactPlaceGroup } from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import { e164Of } from "@/lib/voice/phone-number";
import { mapUrl, placesInOrder } from "@/lib/contacts/place-view";

export type HeaderActionId = "call" | "text" | "email" | "directions";
export type HeaderAction = { id: HeaderActionId; href: string; primary: boolean; external: boolean };

/** `tel:` with the E.164 form when the number normalises, else its digits; null with none. */
export function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const e164 = e164Of(phone);
  if (e164) return `tel:${e164}`;
  const digits = phone.replace(/\D/g, "");
  return digits ? `tel:${digits}` : null;
}

/**
 * Exactly when the composer's text form would open (spec §9.1): a usable number, an open gate, no
 * consent line. An empty line is no line, as `smsFormBlock` reads it; the parity test pins the two.
 */
export function canTextFrom(input: { phone: string | null; smsGate: SmsGate | null; smsBlockedLine: string | null }): boolean {
  return Boolean(e164Of(input.phone)) && input.smsGate !== null && input.smsGate.ok && !input.smsBlockedLine;
}

/** D13: the first property in the Properties card's order that has an address. */
export function firstMapUrl(places: readonly PlaceRow[], subjectId: string, groups: readonly ContactPlaceGroup[]): string | null {
  for (const p of placesInOrder(places, subjectId, groups).active) {
    const url = mapUrl(p);
    if (url) return url;
  }
  return null;
}

/** Call, Text, Email, Directions in that order on every width; an action with nothing behind it is hidden (D3). */
export function headerActions(input: { phone: string | null; email: string | null; canText: boolean; directionsUrl: string | null }): HeaderAction[] {
  const out: HeaderAction[] = [];
  const tel = telHref(input.phone);
  if (tel) out.push({ id: "call", href: tel, primary: true, external: false });
  if (input.canText) out.push({ id: "text", href: "#compose-sms", primary: false, external: false });
  if (input.email) out.push({ id: "email", href: "#compose-email", primary: false, external: false });
  if (input.directionsUrl) out.push({ id: "directions", href: input.directionsUrl, primary: false, external: true });
  return out;
}
