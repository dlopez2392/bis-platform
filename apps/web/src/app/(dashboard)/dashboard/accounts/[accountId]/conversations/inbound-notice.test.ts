import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("./inbound-actions", () => ({ undoReplyStopAction: vi.fn(), stopEmailsFromReplyAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { readInboundMeta, InboundNotice } = await import("./inbound-notice");
type InboundMeta = import("./inbound-notice").InboundMeta;

/**
 * Task 11 (S-06 part 1), bis-frontend half: the thread bubble's inbound-email
 * details — who sent it (a household member's name, when there was one),
 * how many attachments landed (not yet saved anywhere), and the emailed stop
 * or May-want-to-stop chip, each a dot + word (DESIGN.md rule 3), each button
 * ghost (rule 8: the bubble names no primary).
 */
describe("readInboundMeta", () => {
  it("reads an inbound email's meta, and null for anything else (mutation: answer {} for a plain message → a notice renders on SMS, FAILS)", () => {
    expect(readInboundMeta({
      inbound_email_id: "re_1", attachment_count: 2,
      sender: { contact_id: "l", first_name: "Luis", last_name: "Ruiz" },
      consent: { kind: "stopped", eventId: "ev_1" },
    })).toEqual({ attachmentCount: 2, sender: { name: "Luis Ruiz" }, consent: { kind: "stopped", eventId: "ev_1" } });
    expect(readInboundMeta({})).toBeNull();
    expect(readInboundMeta(null)).toBeNull();
    expect(readInboundMeta(undefined)).toBeNull();
    expect(readInboundMeta({
      inbound_email_id: "re_1", attachment_count: 0, consent: { kind: "maybe", phrase: "remove me" },
    })).toEqual({ attachmentCount: 0, sender: null, consent: { kind: "maybe" } });
  });
});

describe("InboundNotice, English and Spanish", () => {
  const html = (meta: InboundMeta, locale: "en" | "es") =>
    renderToStaticMarkup(createElement(InboundNotice, { meta, accountId: "a", conversationId: "c", contactId: "k", locale, canAct: true }));

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

  it("an unclear stop is a chip 'May want to stop' with Stop emails; one attachment reads singular (mutation: use the plural key for 1 → FAILS)", () => {
    const meta: InboundMeta = { attachmentCount: 1, sender: null, consent: { kind: "maybe" } };
    expect(renderedText(html(meta, "en"))).toContain("1 attachment — not saved yet");
    expect(renderedText(html(meta, "en"))).toContain("May want to stop");
    expect(renderedText(html(meta, "en"))).toContain("Stop emails");
    expect(renderedText(html(meta, "es"))).toContain("Quizás quiere dejar de recibirlos");
    expect(renderedText(html(meta, "es"))).toContain("Detener correos");
    expect(html(meta, "en")).not.toContain('data-variant="default"');
  });

  it("nothing to say renders nothing (mutation: always render a wrapper → FAILS)", () => {
    expect(html({ attachmentCount: 0, sender: null, consent: { kind: "none" } }, "en")).toBe("");
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
    renderToStaticMarkup(createElement(InboundNotice, { meta, accountId: "a", conversationId: "c", contactId: "k", locale: "en", canAct }));

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
