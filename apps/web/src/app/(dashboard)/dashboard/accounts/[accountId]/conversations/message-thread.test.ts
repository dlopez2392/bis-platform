import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { COMPLAINT_ERROR_MARKER } from "@/lib/email/failure-reason";
import { MessageThread } from "./message-thread";

/** The minimal shape `MessageThread` reads off a row — matches `MESSAGE_COLS`
 *  in packages/db/src/messaging.ts (id, conversation_id, channel, direction,
 *  status, provider_message_id, subject, body, error, created_at). */
function message(status: string, error: string | null) {
  return {
    id: "m1", conversation_id: "c1", channel: "email", direction: "outbound",
    status, provider_message_id: null, subject: null, body: "hi", error,
    created_at: "2026-10-05T10:00:00Z",
  };
}

function html(status: string, error: string | null, timezone = "UTC"): string {
  return renderToStaticMarkup(createElement(MessageThread, {
    messages: [message(status, error)] as never,
    contactName: "Ada",
    composer: null,
    timezone,
    contactLanguage: null,
  }));
}

/**
 * D-017. The thread stored WHY an outbound message bounced or failed
 * (`messages.error`) and never showed it — the dot-and-word status alone
 * told the operator something went wrong, never what to tell the customer.
 */
describe("MessageThread's failure reason (D-017)", () => {
  it("shows the plain-language complaint reason for a bounce carrying the complaint marker (mutation: drop the failure-reason paragraph → FAILS)", () => {
    const text = renderedText(html("bounced", COMPLAINT_ERROR_MARKER));
    expect(text).toContain(m["conversations.failureReason.complained"]);
  });

  it("shows the generic bounce reason for a bounce with no marker", () => {
    const text = renderedText(html("bounced", null));
    expect(text).toContain(m["conversations.failureReason.bounced"]);
  });

  it("shows the generic failed reason and NEVER the raw provider string stored in error", () => {
    const raw = "550 5.1.1 mailbox unavailable (Google)";
    const text = renderedText(html("failed", raw));
    expect(text).toContain(m["conversations.failureReason.failed"]);
    expect(text).not.toContain(raw);
  });

  it("shows no failure reason for a message that sent cleanly", () => {
    const text = renderedText(html("sent", null));
    expect(text).not.toContain(m["conversations.failureReason.failed"]);
    expect(text).not.toContain(m["conversations.failureReason.bounced"]);
    expect(text).not.toContain(m["conversations.failureReason.complained"]);
  });
});

/**
 * A bubble's own timestamp rendered through `formatDateTime` — the RUNTIME's
 * zone (server or browser), never the account's — the same bug D-010 fixed
 * for the contacts list and the activity timeline.
 */
describe("MessageThread's bubble timestamp renders in the ACCOUNT's zone, not the runtime's", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("a bubble's clock time follows the account's zone (Berlin), not the runtime's (Chicago)", () => {
    vi.stubEnv("TZ", "America/Chicago");
    const msg = { ...message("sent", null), created_at: "2026-10-08T05:00:00.000Z" };
    const text = renderedText(renderToStaticMarkup(createElement(MessageThread, {
      messages: [msg] as never, contactName: "Ada", composer: null, timezone: "Europe/Berlin",
      contactLanguage: null,
    })));
    // 05:00 UTC is 7:00 AM in Berlin but 12:00 AM (midnight) in Chicago.
    expect(text).toContain("7:00 AM");
    expect(text).not.toContain("12:00 AM");
  });
});

describe("inbound bubbles carry the contact's language (S-09 §9, C10)", () => {
  const at = "2026-10-09T16:12:00Z";
  const bubble = (id: string, direction: "inbound" | "outbound", channel: string, body: string) =>
    ({ id, direction, channel, body, subject: null, status: "delivered", error: null, created_at: at }) as never;
  const render = (contactLanguage: "en" | "es" | null) => renderToStaticMarkup(createElement(MessageThread, {
    messages: [bubble("m1", "inbound", "sms", "Necesito cambiar mi cita"), bubble("m2", "outbound", "sms", "Claro"), bubble("m3", "inbound", "voice", "Caller wants a quote.")],
    contactName: "Ana", composer: null, timezone: "UTC", contactLanguage,
  }));
  it("an inbound text takes it; what the business wrote and the call summary do not (mutation: tag every bubble -> FAILS)", () => {
    const html = render("es");
    expect(html).toMatch(/<p lang="es"[^>]*>Necesito cambiar mi cita<\/p>/);
    expect(html).not.toMatch(/<p lang="es"[^>]*>Claro<\/p>/);
    expect(html).not.toMatch(/<p lang="es"[^>]*>Caller wants a quote\.<\/p>/);
  });
  it("no language: the customer's words are typed-unknown, lang=\"\" (mutation: use the page's language -> FAILS)", () => {
    expect(render(null)).toMatch(/<p lang=""[^>]*>Necesito cambiar mi cita<\/p>/);
  });
});
