import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("../accounts/[accountId]/conversations/inbound-actions", () => ({ undoReplyStopAction: vi.fn(), stopEmailsFromReplyAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
const { WebchatDemo } = await import("./webchat-demo");

describe("styleguide: the web chat bubble and the chat row (DoD: /styleguide gains the new variant)", () => {
  const html = renderToStaticMarkup(createElement(WebchatDemo));
  it("the thread in English and in Spanish, with the unconfirmed line once each (mutation: drop the Spanish cell → FAILS)", () => {
    expect(html).toContain('data-testid="styleguide-webchat"');
    expect(html.match(/data-webchat-unconfirmed/g)).toHaveLength(2);
    expect(renderedText(html)).toContain("Web chat · Sofía · AI");
    expect(renderedText(html)).toContain("Chat web · Sofía · IA");
  });
  it("the record's chat row: the customer's mark, the words, the count and Open chat (mutation: drop the row → FAILS)", () => {
    expect(html).toContain('data-timeline-item="chat"');
    expect(renderedText(html)).toContain("chatted with Sofía on your website");
    expect(renderedText(html)).toContain("12 messages");
    expect(renderedText(html)).toContain("Open chat");
  });
});
