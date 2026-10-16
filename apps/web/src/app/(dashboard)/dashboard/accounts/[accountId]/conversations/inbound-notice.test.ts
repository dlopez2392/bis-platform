import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import type { InboundMeta } from "./inbound-meta";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("./inbound-actions", () => ({ undoReplyStopAction: vi.fn(), stopEmailsFromReplyAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { InboundNotice } = await import("./inbound-notice");

/**
 * Task 11 (S-06 part 1), bis-frontend half: the thread bubble's inbound-email
 * details — who sent it (a household member's name, when there was one),
 * how many attachments landed (not yet saved anywhere), and the emailed stop
 * or May-want-to-stop chip, each a dot + word (DESIGN.md rule 3), each button
 * ghost (rule 8: the bubble names no primary). `readInboundMeta`'s own tests
 * moved to `inbound-meta.test.ts` (fix round 1: that reader now lives in a
 * plain, non-"use client" module).
 */
const BASE = { accountId: "a", conversationId: "c", contactId: "k", canAct: true, stopIsCurrent: true, initiallyExpired: false, chipActionable: true };

describe("InboundNotice, English and Spanish", () => {
  const html = (meta: InboundMeta, locale: "en" | "es") =>
    renderToStaticMarkup(createElement(InboundNotice, { meta, locale, ...BASE }));

  it("names a household member, counts attachments, and shows the stop as a dot and words with a ghost Undo (mutation: drop the dot → FAILS; Undo as default → FAILS)", () => {
    const meta: InboundMeta = { attachmentCount: 2, sender: { name: "Luis Ruiz" }, consent: { kind: "stopped", eventId: "ev_1" } };
    const en = html(meta, "en"); const es = html(meta, "es");
    expect(renderedText(en)).toContain("from Luis Ruiz");
    expect(renderedText(es)).toContain("de Luis Ruiz");
    expect(renderedText(en)).toContain("2 attachments — not saved yet");
    expect(renderedText(es)).toContain("2 archivos adjuntos — aún no se guardan");
    expect(renderedText(en)).toContain("Stopped marketing emails · from their reply");
    expect(renderedText(es)).toContain("Se detuvieron los correos de promoción · por su respuesta");
    expect(en).toMatch(/data-reply-stopped[^>]*>\s*<span[^>]*data-dot/);
    expect(renderedText(en)).toContain("Undo");
    expect(renderedText(es)).toContain("Deshacer");
    expect(en).not.toContain('data-variant="default"');
  });

  it("an unclear stop is a chip 'May want to stop' with Stop emails BESIDE it, not inside; one attachment reads singular (mutation: use the plural key for 1 → FAILS)", () => {
    const meta: InboundMeta = { attachmentCount: 1, sender: null, consent: { kind: "maybe" } };
    const en = html(meta, "en");
    expect(renderedText(en)).toContain("1 attachment — not saved yet");
    expect(renderedText(en)).toContain("May want to stop");
    expect(renderedText(en)).toContain("Stop emails");
    // Minor 7: the button is a SIBLING of the chip span, never a descendant of it — the chip's
    // own span closes before any <button> opens.
    const chip = en.match(/<span data-reply-maybe[^>]*>([^]*?)<\/span>/);
    expect(chip?.[1]).not.toContain("<button");
    expect(renderedText(html(meta, "es"))).toContain("Quizás quiere dejar de recibirlos");
    expect(renderedText(html(meta, "es"))).toContain("Detener correos");
    expect(en).not.toContain('data-variant="default"');
  });

  it("nothing to say renders nothing (mutation: always render a wrapper → FAILS)", () => {
    expect(html({ attachmentCount: 0, sender: null, consent: { kind: "none" } }, "en")).toBe("");
  });

  it("carries lang on the notice's own wrapper, in both languages (mutation: drop the lang attribute → FAILS)", () => {
    const meta: InboundMeta = { attachmentCount: 1, sender: null, consent: { kind: "none" } };
    expect(html(meta, "en")).toMatch(/<div lang="en"/);
    expect(html(meta, "es")).toMatch(/<div lang="es"/);
  });

  it("a household member with no stored name reads the localized noName fallback, never an empty 'from' (mutation: drop the fallback → FAILS)", () => {
    const meta: InboundMeta = { attachmentCount: 0, sender: { name: "" }, consent: { kind: "none" } };
    expect(renderedText(html(meta, "en"))).toContain("from (no name)");
    expect(renderedText(html(meta, "es"))).toContain("de (sin nombre)");
  });
});

/**
 * Orchestrator ruling (Task 11, visibility): a Technician may not act for a
 * household member they cannot see — `canAct` is false for a bubble whose
 * sender is NOT in the viewer's visible set (page.tsx's own request-client
 * read). The status itself (dot + word) still shows; only the button that
 * would write for that contact is withheld.
 */
describe("InboundNotice withholds the button when the sender is not visible to the viewer", () => {
  const html = (meta: InboundMeta, canAct: boolean) =>
    renderToStaticMarkup(createElement(InboundNotice, { meta, locale: "en", ...BASE, canAct }));

  it("the stop still reads as a dot and words, but no Undo button (mutation: render the button regardless of canAct → FAILS)", () => {
    const meta: InboundMeta = { attachmentCount: 0, sender: { name: "Luis Ruiz" }, consent: { kind: "stopped", eventId: "ev_1" } };
    const text = renderedText(html(meta, false));
    expect(text).toContain("Stopped marketing emails · from their reply");
    expect(text).not.toContain("Undo");
    expect(html(meta, false)).not.toContain("<button");
  });

  it("the May-want-to-stop chip still shows, but no Stop-emails button", () => {
    const meta: InboundMeta = { attachmentCount: 0, sender: { name: "Luis Ruiz" }, consent: { kind: "maybe" } };
    const text = renderedText(html(meta, false));
    expect(text).toContain("May want to stop");
    expect(text).not.toContain("Stop emails");
    expect(html(meta, false)).not.toContain("<button");
  });
});

/**
 * Fix round 1 (UI review, important #2): the notice reflects the stop's
 * CURRENT state, not its filing-time snapshot. All three flags are
 * server-computed (`message-thread.tsx`'s `currentStopState`, from
 * `lib/consent/email-view.ts`) and passed in — never guessed client-side.
 */
describe("InboundNotice reflects the stop's current state (fix round 1)", () => {
  const html = (meta: InboundMeta, flags: Partial<typeof BASE>, locale: "en" | "es" = "en") =>
    renderToStaticMarkup(createElement(InboundNotice, { meta, locale, ...BASE, ...flags }));

  it("day 6 (under the 7-day window): Undo shows (mutation: force initiallyExpired true → FAILS)", () => {
    const meta: InboundMeta = { attachmentCount: 0, sender: null, consent: { kind: "stopped", eventId: "ev_1" } };
    const text = renderedText(html(meta, { stopIsCurrent: true, initiallyExpired: false }));
    expect(text).toContain("Undo");
    expect(text).not.toContain("Only the customer can turn these emails back on");
  });

  it("day 8 (past the 7-day window): keeps the word \"Stopped\", adds the expired sentence SEPARATED from it, no button (minor 6; fix round 2 minor #2: mutation: run the two sentences together with no separator → FAILS)", () => {
    const meta: InboundMeta = { attachmentCount: 0, sender: null, consent: { kind: "stopped", eventId: "ev_1" } };
    const en = html(meta, { stopIsCurrent: true, initiallyExpired: true });
    const es = html(meta, { stopIsCurrent: true, initiallyExpired: true }, "es");
    // The two sentences are NEVER adjacent with just a space (that reads as one run-on
    // sentence: "...from their reply Only the customer...") — a middle dot separates them,
    // the same convention `conversations.reply.stopped` itself already uses internally.
    expect(renderedText(en)).toContain("Stopped marketing emails · from their reply · Only the customer can turn these emails back on.");
    expect(renderedText(en)).not.toContain("reply Only the customer");
    expect(renderedText(es)).toContain("Se detuvieron los correos de promoción · por su respuesta · Solo el cliente puede volver a activar estos correos.");
    expect(renderedText(es)).not.toContain("respuesta Solo el cliente");
    expect(en).not.toContain("<button");
  });

  it("after a staff Undo (this stop is no longer the newest row): no stop notice and no button at all (mutation: ignore stopIsCurrent → FAILS)", () => {
    const meta: InboundMeta = { attachmentCount: 0, sender: null, consent: { kind: "stopped", eventId: "ev_1" } };
    const html2 = html(meta, { stopIsCurrent: false, initiallyExpired: false });
    expect(html2).not.toContain("data-reply-stopped");
    expect(html2).not.toContain("<button");
  });

  it("the chip's Stop-emails button shows only while the address is still allowed (mutation: ignore chipActionable → FAILS)", () => {
    const meta: InboundMeta = { attachmentCount: 0, sender: null, consent: { kind: "maybe" } };
    const stillAllowed = renderedText(html(meta, { chipActionable: true }));
    const alreadyStopped = renderedText(html(meta, { chipActionable: false }));
    expect(stillAllowed).toContain("Stop emails");
    expect(stillAllowed).toContain("May want to stop");
    expect(alreadyStopped).not.toContain("Stop emails");
    expect(alreadyStopped).toContain("May want to stop");
  });
});
