import { describe, it, expect } from "vitest";
import { pickTurnUpdate, type TurnResult } from "./concierge-chat";

/**
 * IMPORTANT B (second-round review of 108b822): the turn route used to send
 * the closing sentence back as `reply` on two of its three ended paths, and
 * the page ALSO rendered a fixed `.bis-concierge-ended` paragraph carrying
 * its own copy of `strings.ended` — so a visitor read the close twice (or,
 * on the expired-token path, read two DIFFERENT and contradictory
 * sentences: a bubble promising a chat that ran, a paragraph promising a
 * follow-up nothing had captured).
 *
 * `pickTurnUpdate` is the decision `send()` in concierge-chat.tsx applies to
 * every turn response — extracted so "exactly one closing sentence, never a
 * bubble on top of it" is a property this file can check directly, without
 * a DOM. It mirrors the route's own contract: `reply` is a chat bubble,
 * `closing` (present only when `ended`) is the ONE sentence the page shows
 * for the close.
 */
describe("pickTurnUpdate", () => {
  it("shows the closing sentence and no bubble on the route's real ended shape", () => {
    // This is exactly what route.ts now sends on all three ended paths:
    // `reply: ""`, `closing` carrying the sentence.
    const data: TurnResult = { conversationId: "c1", reply: "", ended: true, closing: "This chat is closed." };
    // MUTATION: return `{ bubble: data.reply || null, closing: data.ended ?
    // (data.reply || data.closing || null) : null }` (reading the old
    // `reply`-carries-the-close shape) — this FAILS, because it would still
    // treat a non-empty `reply` on an ended turn as the closing text AND
    // leave the door open for a bubble to render it too.
    expect(pickTurnUpdate(data)).toEqual({ bubble: null, closing: "This chat is closed." });
  });

  it("pushes a bubble and sets no closing on an ordinary, unended reply", () => {
    const data: TurnResult = { conversationId: "c1", reply: "Yes, we do.", ended: false, closing: "" };
    expect(pickTurnUpdate(data)).toEqual({ bubble: "Yes, we do.", closing: null });
  });

  it("never renders a bubble on an ended turn, even if `reply` were non-empty", () => {
    // Defensive: the route's contract guarantees `reply === ""` whenever
    // `ended` is true, but the render decision does not lean on the SERVER
    // keeping that promise — it suppresses the bubble on `ended` itself, so
    // a malformed response can never print two sentences.
    // MUTATION: push `data.reply` as the bubble regardless of `ended` — this
    // FAILS, and a visitor would read the closing paragraph AND a bubble
    // carrying whatever `reply` held.
    const data: TurnResult = { conversationId: "c1", reply: "stray", ended: true, closing: "Bye." };
    expect(pickTurnUpdate(data)).toEqual({ bubble: null, closing: "Bye." });
  });

  it("renders each of the three real ended-path shapes as exactly one closing sentence", () => {
    const turnCap: TurnResult = { conversationId: "c1", reply: "", ended: true, closing: "This chat is closed. If you shared your name and a way to reach you, someone from the team will follow up." };
    const startGuard: TurnResult = { conversationId: "", reply: "", ended: true, closing: "This chat is closed. If you shared your name and a way to reach you, someone from the team will follow up." };
    const expired: TurnResult = { conversationId: "", reply: "", ended: true, closing: "This page has been open a while — refresh to start a conversation." };
    for (const data of [turnCap, startGuard, expired]) {
      const update = pickTurnUpdate(data);
      expect(update.bubble).toBeNull();
      expect(update.closing).toBe(data.closing);
    }
  });
});
