// The prospect demo's start sequence, out of the component so it can be tested without a browser: the
// microphone, the mint, the peer, the SDP exchange. Each await can outlive the person's patience (Esc, End,
// leaving the page), so after EACH one the sequence asks whether it was cancelled and, if so, releases
// whatever it already holds: the mic's tracks, and once it exists the peer (which silences Sofía's audio).
// Without this, a page left while "Connecting…" kept a live microphone and an audible session with no
// control left on screen to stop it.
//
// A secret minted before the cancel still spent its cap row: that write happens before the mint by design
// (actions.ts), and a cancel cannot take it back.
import { m } from "@/lib/messages";
import type { ProspectDemoStart } from "./actions";

type Started = Extract<ProspectDemoStart, { ok: true }>;

export type DemoStartDeps<Mic, Peer> = {
  /** True once this attempt was cancelled (Esc, End, unmount, or a newer attempt). */
  cancelled: () => boolean;
  getMic: () => Promise<Mic>;
  stopMic: (mic: Mic) => void;
  start: () => Promise<ProspectDemoStart>;
  /** Synchronous: creates the peer and its audio, adds the mic's tracks, opens the events channel. */
  openPeer: (s: Started, mic: Mic) => Peer;
  /** The offer, the SDP exchange with OpenAI, the answer. */
  negotiate: (peer: Peer, s: Started) => Promise<void>;
  /** Closes the peer and silences its audio. Must be safe to call twice. */
  closePeer: (peer: Peer) => void;
};

export type DemoStartResult<Mic, Peer> =
  | { kind: "live"; started: Started; mic: Mic; peer: Peer }
  | { kind: "cancelled" }
  | { kind: "error"; error: string };

const CANCELLED = { kind: "cancelled" } as const;

export async function runDemoStart<Mic, Peer>(d: DemoStartDeps<Mic, Peer>): Promise<DemoStartResult<Mic, Peer>> {
  let mic: Mic;
  try {
    mic = await d.getMic();
  } catch {
    return d.cancelled() ? CANCELLED : { kind: "error", error: m["prospectDemo.error.microphone"] };
  }
  if (d.cancelled()) {
    d.stopMic(mic);
    return CANCELLED;
  }

  const res = await d.start().catch((): ProspectDemoStart => ({ ok: false, error: m["prospectDemo.error.unavailable"] }));
  if (d.cancelled() || !res.ok) {
    d.stopMic(mic);
    return res.ok || d.cancelled() ? CANCELLED : { kind: "error", error: res.error };
  }

  const peer = d.openPeer(res, mic);
  try {
    await d.negotiate(peer, res);
  } catch {
    d.closePeer(peer);
    d.stopMic(mic);
    return d.cancelled() ? CANCELLED : { kind: "error", error: m["prospectDemo.error.connect"] };
  }
  if (d.cancelled()) {
    d.closePeer(peer);
    d.stopMic(mic);
    return CANCELLED;
  }
  return { kind: "live", started: res, mic, peer };
}
