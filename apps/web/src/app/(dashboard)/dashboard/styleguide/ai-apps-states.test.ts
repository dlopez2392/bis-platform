import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

const { AiAppsStates } = await import("./ai-apps-states");

describe("styleguide: the AI apps cards (MCP PR C)", () => {
  const html = renderToStaticMarkup(createElement(AiAppsStates));
  it("shows the Team card in each state and the use card with and without an address (mutation: drop a state -> FAILS)", () => {
    expect(html.match(/data-ai-apps-card(?!-)/g)).toHaveLength(4);
    expect(html.match(/data-ai-apps-card-error/g)).toHaveLength(1);
    expect(html.match(/data-ai-apps-log-empty/g)).toHaveLength(1);
    expect(html.match(/data-ai-apps-log-error/g)).toHaveLength(1);
    expect(html.match(/data-ai-apps-use-card(?!-)/g)).toHaveLength(2);
    expect(html).toContain("The address is not available right now.");
    expect(html).toContain("Only the business&#x27;s Owner can change this.");
  });
});
