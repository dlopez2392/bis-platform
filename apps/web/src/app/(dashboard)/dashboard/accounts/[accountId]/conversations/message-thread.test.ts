import { describe, it, expect } from "vitest";
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

function html(status: string, error: string | null): string {
  return renderToStaticMarkup(createElement(MessageThread, {
    messages: [message(status, error)] as never,
    contactName: "Ada",
    composer: null,
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
