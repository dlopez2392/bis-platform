import type { InboundSettings } from "@bis/db";
import { replyAddressFor } from "./address";

/**
 * S-06 part 2, spec §1: what the record's Forwarding address row shows, decided on the SERVER (plan
 * G15). The caller passes thunks so this module never names a service client. Never logs the token.
 */
export type ForwardingView = { kind: "address"; address: string } | { kind: "turnOn" } | { kind: "none" } | { kind: "failed" };
export type ForwardingDeps = { settings: () => Promise<InboundSettings>; token: () => Promise<{ token: string }>; log: (line: string) => void };

export async function loadForwardingView(d: ForwardingDeps, viewer: { isAgency: boolean }): Promise<ForwardingView> {
  let s: InboundSettings;
  try {
    s = await d.settings();
  } catch {
    d.log("the Replies setting could not be read; the forwarding row shows its error");
    return { kind: "failed" };
  }
  if (s.mode === "off") return viewer.isAgency ? { kind: "turnOn" } : { kind: "none" };
  try {
    const { token } = await d.token();
    const address = replyAddressFor(token, s);
    return address ? { kind: "address", address } : { kind: "none" };
  } catch {
    d.log("the forwarding address could not be made; the forwarding row shows its error");
    return { kind: "failed" };
  }
}
