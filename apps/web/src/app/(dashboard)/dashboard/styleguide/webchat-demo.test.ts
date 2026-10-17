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

describe("styleguide: the web chat demo fits a phone (CI e2e phone-width.spec.ts at 375px and 320px)", () => {
  const html = renderToStaticMarkup(createElement(WebchatDemo));
  it("one column below md, every grid shrinkable, and no fixed pixel width anywhere (mutation: put back w-[520px] on the row → FAILS; drop grid-cols-1 → FAILS)", () => {
    const root = html.match(/<div class="([^"]*)" data-testid="styleguide-webchat"/)?.[1] ?? "";
    expect(root.split(" ")).toEqual(expect.arrayContaining(["grid", "grid-cols-1", "min-w-0", "w-full"]));
    const grids = [...html.matchAll(/class="([^"]*\bgrid\b[^"]*)"/g)].map((x) => x[1]!).filter((c) => c.split(" ").includes("grid"));
    expect(grids.length).toBeGreaterThanOrEqual(2);
    for (const c of grids) expect(c.split(" "), c).toContain("grid-cols-1");
    expect(html).not.toMatch(/\bw-\[\d+px\]/);
  });
});
