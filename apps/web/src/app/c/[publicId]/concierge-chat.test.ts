import { describe, it, expect } from "vitest";
import {
  pickTurnUpdate, pickErrorUpdate, conversationStore, type TurnResult,
  CLOSE_MESSAGE, brandMessage, shouldCloseOnKey,
} from "./concierge-chat";
import { conciergeStrings } from "@/lib/concierge/strings";

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
  const strings = conciergeStrings(undefined);

  it("shows the closing sentence and no bubble on the route's real ended shape", () => {
    // This is exactly what route.ts now sends on all three ended paths:
    // `reply: ""`, `closing` carrying the sentence.
    const data: TurnResult = { conversationId: "c1", reply: "", ended: true, closing: "This chat is closed." };
    // MUTATION: return `{ bubble: data.reply || null, closing: data.ended ?
    // (data.reply || data.closing || null) : null }` (reading the old
    // `reply`-carries-the-close shape) — this FAILS, because it would still
    // treat a non-empty `reply` on an ended turn as the closing text AND
    // leave the door open for a bubble to render it too.
    expect(pickTurnUpdate(data)).toEqual({ bubble: null, closing: "This chat is closed.", notice: null });
  });

  it("pushes a bubble and sets no closing on an ordinary, unended reply", () => {
    const data: TurnResult = { conversationId: "c1", reply: "Yes, we do.", ended: false, closing: "" };
    expect(pickTurnUpdate(data)).toEqual({ bubble: "Yes, we do.", closing: null, notice: null });
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
    expect(pickTurnUpdate(data)).toEqual({ bubble: null, closing: "Bye.", notice: null });
  });

  /**
   * The 5a/5b seam (Step 2b, reviewer-specified fix): the too-fast turn
   * answers `{ reply: "", ended: false, closing: strings.tooFast }` at 200 —
   * `ended` is false, so `closing` stays null (it is gated on `ended`, on
   * purpose: a non-ended `closing` is a transient notice, not the one fixed
   * paragraph an ended conversation gets), and `reply` is empty so no bubble
   * renders either. Without a third field, that sentence had nowhere to go —
   * the visitor's message sat there unexplained. `notice` is that third
   * field: the un-ended-gated carrier for exactly this shape.
   */
  it("carries the too-fast sentence as a notice, not a bubble or the closing paragraph", () => {
    const data: TurnResult = { conversationId: "", reply: "", ended: false, closing: strings.tooFast };
    // MUTATION: restore the `ended` gate on `notice`
    // (`notice: data.ended && data.closing ? data.closing : null`) — this
    // FAILS, because `ended` is false on this exact route shape and the gate
    // would suppress the one sentence this test exists to surface.
    expect(pickTurnUpdate(data)).toEqual({ bubble: null, closing: null, notice: strings.tooFast });
  });

  it("carries no notice on an ordinary, in-progress reply", () => {
    const data: TurnResult = { conversationId: "c1", reply: "Yes, we do.", ended: false, closing: "" };
    expect(pickTurnUpdate(data).notice).toBeNull();
  });

  it("renders each of the three real ended-path shapes as exactly one, NON-EMPTY closing sentence", () => {
    // Item 5, Branch 2 hardening: the page dropped `?? strings.ended` from
    // its JSX (`{ended && endedMessage && <p>…</p>}`), so a wiring
    // regression that leaves `closing` empty now renders NOTHING rather
    // than a fallback sentence that might contradict what the visitor
    // already read. That only stays safe if every ended shape the route can
    // really produce carries a non-empty `closing` — asserted here directly,
    // not just implied by `toBe(data.closing)` against fixtures that happen
    // to be non-empty.
    const turnCap: TurnResult = { conversationId: "c1", reply: "", ended: true, closing: "This chat is closed. If you shared your name and a way to reach you, someone from the team will follow up." };
    const startGuard: TurnResult = { conversationId: "", reply: "", ended: true, closing: "This chat is closed. If you shared your name and a way to reach you, someone from the team will follow up." };
    const expired: TurnResult = { conversationId: "", reply: "", ended: true, closing: "This page has been open a while — refresh to start a conversation." };
    for (const data of [turnCap, startGuard, expired]) {
      const update = pickTurnUpdate(data);
      expect(update.bubble).toBeNull();
      expect(update.closing).toBe(data.closing);
      expect(update.closing).toBeTruthy();
    }
  });
});

/**
 * The pure decision behind `send()`'s `!res.ok` branch (Item 1, Branch 2
 * hardening). A 429 from `POST /turn` is a real cap, not a permanent
 * refusal — `CONCIERGE_MAX_CONVERSATIONS_PER_IP`/`_ACCOUNT_PER_DAY` — so it
 * gets `strings.rateLimited` rather than the generic `strings.unavailable`,
 * and `ended` stays false: the composer stays open and the conversation id
 * already in `sessionStorage` is untouched, so the visitor can try again on
 * the same conversation. Every other non-OK status keeps the existing
 * `unavailable` sentence — this is the ONE place that decides which sentence
 * a non-OK response gets, so "429 is not a dead end" is a property this file
 * can check without a DOM.
 */
describe("pickErrorUpdate", () => {
  const strings = conciergeStrings(undefined);

  it("shows the rate-limited sentence, not `unavailable`, on 429", () => {
    // MUTATION: treat 429 the same as every other status (always return
    // `{ closing: strings.unavailable, ended: false }`) — this FAILS, and
    // the spec's own stated reason for choosing 429 over the anti-oracle
    // body ("a real visitor who hits one needs to know to come back later")
    // is never actually delivered.
    expect(pickErrorUpdate({ status: 429 }, strings)).toEqual({ closing: strings.rateLimited, ended: false });
  });

  it("falls back to the existing `unavailable` sentence for every other non-OK status", () => {
    expect(pickErrorUpdate({ status: 503 }, strings)).toEqual({ closing: strings.unavailable, ended: false });
    expect(pickErrorUpdate({ status: 403 }, strings)).toEqual({ closing: strings.unavailable, ended: false });
  });

  it("never ends the conversation on 429 — the visitor may try later on the same one", () => {
    expect(pickErrorUpdate({ status: 429 }, strings).ended).toBe(false);
  });
});

/**
 * `conversationStore` is the persistence Item 1 (page half) adds:
 * `conversationId` moves out of a bare `useRef` into `sessionStorage` keyed
 * by `publicId`, so a page reload mid-conversation continues it instead of
 * starting a fresh one and burning another slot of
 * `CONCIERGE_MAX_CONVERSATIONS_PER_IP`. `getStorage` is a THUNK, never
 * `window.sessionStorage` read eagerly — Safari private mode throws on the
 * PROPERTY ACCESS itself, not only on a method call — which is also what
 * makes this testable under plain node (this repo has no jsdom/`.tsx`
 * infra): a throwing thunk stands in for a blocked or private-mode
 * `sessionStorage` with no DOM involved at all.
 */
describe("conversationStore", () => {
  function fakeStorage() {
    const backing = new Map<string, string>();
    return {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v); },
      removeItem: (k: string) => { backing.delete(k); },
    };
  }

  it("returns null when storage throws on access, rather than throwing itself", () => {
    // MUTATION: drop the `try/catch` around the storage access — this
    // FAILS, because `getStorage()` throwing (the private-window case)
    // propagates out of `read()` instead of the page just starting fresh.
    const store = conversationStore("pub1", () => { throw new Error("SecurityError"); });
    expect(store.read()).toBeNull();
  });

  it("round-trips an id", () => {
    const storage = fakeStorage();
    const store = conversationStore("pub1", () => storage);
    expect(store.read()).toBeNull();
    store.write("conv-123");
    expect(store.read()).toBe("conv-123");
  });

  it("clears on ended", () => {
    const storage = fakeStorage();
    const store = conversationStore("pub1", () => storage);
    store.write("conv-123");
    store.clear();
    expect(store.read()).toBeNull();
  });

  it("keys by publicId, so two widgets on one host page never collide", () => {
    const storage = fakeStorage();
    conversationStore("pub1", () => storage).write("conv-A");
    conversationStore("pub2", () => storage).write("conv-B");
    expect(conversationStore("pub1", () => storage).read()).toBe("conv-A");
    expect(conversationStore("pub2", () => storage).read()).toBe("conv-B");
  });
});

/**
 * The close producer (review corrections): the loader's own
 * `bis-concierge-close` handling was already tested and correct — what was
 * missing was anyone inside the iframe ever SENDING it. Esc, once focus is
 * inside the iframe, never reaches the host window's own keydown listener
 * (a cross-origin iframe's keydown does not bubble out), so the chat page
 * posts this message itself, from Esc and from a header close button.
 * `CLOSE_MESSAGE` is the wire contract both sides share — embed-script.ts
 * hardcodes the same string independently, so a typo on either side is
 * exactly the kind of defect a shared literal test catches.
 */
describe("CLOSE_MESSAGE", () => {
  it("matches the loader's message-listener contract for bis-concierge-close", () => {
    // MUTATION: typo the type string (e.g. "bis-concierge-closed") — this
    // FAILS, and the loader's `data.type === "bis-concierge-close"` check in
    // embed-script.ts would never match a real close from this page again.
    expect(CLOSE_MESSAGE).toEqual({ type: "bis-concierge-close" });
  });
});

describe("shouldCloseOnKey", () => {
  it("is true only for Escape", () => {
    // MUTATION: invert the comparison (`!== "Escape"`) — this FAILS on both
    // assertions at once.
    expect(shouldCloseOnKey({ key: "Escape" })).toBe(true);
    expect(shouldCloseOnKey({ key: "Enter" })).toBe(false);
  });
});

/**
 * Brand colour by message (Adopted Minor): the chat page posts this once at
 * load, built from the SAME `--form-accent`/`--form-accent-foreground`
 * values `publicFormTheme` already paints the page with (`page.tsx`'s
 * `formAccent`) — never a second, independent colour decision. The loader
 * paints the launcher from it, `data-color` still winning as an operator
 * override. Not baked into the cached snippet at copy time, so it does not
 * rot on a rebrand.
 */
describe("brandMessage", () => {
  it("carries the accent pair in the exact shape the loader's postMessage listener expects", () => {
    // MUTATION: drop `accentForeground` from the returned object — this
    // FAILS, and the loader's `typeof data.accentForeground === "string"`
    // guard in embed-script.ts would then always refuse to repaint.
    expect(brandMessage("#112233", "#ffffff")).toEqual({
      type: "bis-concierge-brand", accent: "#112233", accentForeground: "#ffffff",
    });
  });
});
