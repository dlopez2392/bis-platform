import type { InboundSettings } from "@bis/db";
import { loggableError } from "@/lib/loggable-error";
import { replyAddressFor } from "./address";

/**
 * S-06 part 2, spec §1: what the record's Forwarding address row shows, decided on the SERVER (plan
 * G15, amended by the owner 2026-10-17: the address is made on CLICK, never on page view). The caller
 * passes READ-ONLY thunks, so this module never names a service client and a view never writes: a
 * customer with no token yet gets the "get" kind, whose button calls the record's server action.
 * Never logs the token.
 */
export type ForwardingView =
  | { kind: "address"; address: string } | { kind: "get" } | { kind: "turnOn" } | { kind: "none" } | { kind: "failed" };
export type ForwardingDeps = {
  settings: () => Promise<InboundSettings>;
  /** The customer's LIVE token, read only (`readReplyToken`); null when none has been made. */
  token: () => Promise<{ token: string } | null>;
  log: (line: string) => void;
};

/** Review minor 4: an address can be formed only on BIS's domain, or on the account's own once set. */
export function canFormReplyAddress(s: InboundSettings): boolean {
  return s.mode === "bis" || (s.mode === "own_domain" && Boolean(s.domain));
}

/** Minor 5: the error's kind for the log, with anything token-shaped struck out. */
export const tokenSafeError = (e: unknown) => loggableError(e).replace(/\b[0-9a-f]{24}\b/g, "[token]");

export async function loadForwardingView(d: ForwardingDeps, viewer: { isAgency: boolean }): Promise<ForwardingView> {
  let s: InboundSettings;
  try {
    s = await d.settings();
  } catch (e) {
    d.log(`the Replies setting could not be read; the forwarding row shows its error: ${tokenSafeError(e)}`);
    return { kind: "failed" };
  }
  // Off, or an own domain not yet set: nothing to hand out. The agency is pointed at Settings.
  if (!canFormReplyAddress(s)) return viewer.isAgency ? { kind: "turnOn" } : { kind: "none" };
  try {
    const found = await d.token();
    if (!found) return { kind: "get" };
    const address = replyAddressFor(found.token, s);
    return address ? { kind: "address", address } : { kind: "none" };
  } catch (e) {
    d.log(`the forwarding address could not be read; the forwarding row shows its error: ${tokenSafeError(e)}`);
    return { kind: "failed" };
  }
}
