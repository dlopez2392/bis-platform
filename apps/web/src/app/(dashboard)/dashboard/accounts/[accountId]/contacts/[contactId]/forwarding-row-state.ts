import type { ForwardingView } from "@/lib/email/inbound/forwarding-view";

/**
 * What the Forwarding address row shows, derived on EVERY render (fix round 2, Important 3). The
 * server's view decides; a click's address (`made`) only fills the one gap the server left, "get".
 * So a row that mounted as "get" follows the server to "address" after any refresh, the server's
 * own address outranks an older click's, and a server that no longer offers one (Replies turned
 * off, a failed read) wins over a click. A plain module (no directive): pure, unit-tested without a DOM.
 */
export function forwardingShown(view: ForwardingView, made: string | null): ForwardingView {
  if (view.kind === "get" && made) return { kind: "address", address: made };
  return view;
}
