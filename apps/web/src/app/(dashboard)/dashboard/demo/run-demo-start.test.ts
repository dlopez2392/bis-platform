import { describe, it, expect, vi } from "vitest";
import { runDemoStart, type DemoStartDeps } from "./run-demo-start";
import type { ProspectDemoStart } from "./actions";

const STARTED: ProspectDemoStart = {
  ok: true, secret: "ek_x", expiresAt: null, maxSeconds: 180, greeting: "Greet", businessName: "Garza",
};
type Mic = { id: "mic" };
type Peer = { id: "peer" };

/** Every step succeeds unless overridden; `cancelAt` flips the cancel signal as that step finishes. */
function harness(over: Partial<DemoStartDeps<Mic, Peer>> = {}, cancelAt?: "mic" | "start" | "negotiate") {
  let cancelled = false;
  const deps = {
    cancelled: () => cancelled,
    getMic: vi.fn(async (): Promise<Mic> => { if (cancelAt === "mic") cancelled = true; return { id: "mic" }; }),
    stopMic: vi.fn(),
    start: vi.fn(async () => { if (cancelAt === "start") cancelled = true; return STARTED; }),
    openPeer: vi.fn((): Peer => ({ id: "peer" })),
    negotiate: vi.fn(async () => { if (cancelAt === "negotiate") cancelled = true; }),
    closePeer: vi.fn(),
    ...over,
  };
  return deps;
}

describe("runDemoStart", () => {
  it("goes live when nothing is cancelled, holding the mic and the peer", async () => {
    const d = harness();
    await expect(runDemoStart(d)).resolves.toEqual({ kind: "live", started: STARTED, mic: { id: "mic" }, peer: { id: "peer" } });
    expect(d.stopMic).not.toHaveBeenCalled();
    expect(d.closePeer).not.toHaveBeenCalled();
  });

  it("cancelled while the mic was being granted: tracks stopped, nothing minted (mutation: skip the check after the mic -> FAILS)", async () => {
    const d = harness({}, "mic");
    await expect(runDemoStart(d)).resolves.toEqual({ kind: "cancelled" });
    expect(d.stopMic).toHaveBeenCalledWith({ id: "mic" });
    expect(d.start).not.toHaveBeenCalled();
    expect(d.openPeer).not.toHaveBeenCalled();
  });

  it("cancelled while the secret was minting: no peer is created, tracks stopped (mutation: skip the check after the mint -> FAILS)", async () => {
    const d = harness({}, "start");
    await expect(runDemoStart(d)).resolves.toEqual({ kind: "cancelled" });
    expect(d.openPeer).not.toHaveBeenCalled();
    expect(d.stopMic).toHaveBeenCalledWith({ id: "mic" });
  });

  it("cancelled while the call was connecting: the peer is closed and the tracks stopped (mutation: skip the check after connecting -> FAILS)", async () => {
    const d = harness({}, "negotiate");
    await expect(runDemoStart(d)).resolves.toEqual({ kind: "cancelled" });
    expect(d.closePeer).toHaveBeenCalledWith({ id: "peer" });
    expect(d.stopMic).toHaveBeenCalledWith({ id: "mic" });
  });

  it("a refused microphone mints nothing", async () => {
    const d = harness({ getMic: vi.fn(async () => { throw new Error("NotAllowedError"); }) });
    const r = await runDemoStart(d);
    expect(r.kind).toBe("error");
    expect(d.start).not.toHaveBeenCalled();
  });

  it("a refused mint stops the mic and opens no peer", async () => {
    const d = harness({ start: vi.fn(async (): Promise<ProspectDemoStart> => ({ ok: false, error: "capped" })) });
    await expect(runDemoStart(d)).resolves.toEqual({ kind: "error", error: "capped" });
    expect(d.stopMic).toHaveBeenCalled();
    expect(d.openPeer).not.toHaveBeenCalled();
  });

  it("a failed connection closes the peer and stops the mic", async () => {
    const d = harness({ negotiate: vi.fn(async () => { throw new Error("answer 500"); }) });
    expect((await runDemoStart(d)).kind).toBe("error");
    expect(d.closePeer).toHaveBeenCalled();
    expect(d.stopMic).toHaveBeenCalled();
  });
});
