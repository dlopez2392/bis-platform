import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { A2pPanel } from "./a2p-panel";

// The checklist's a2p_registration row links here with a same-page anchor
// (checklist-panel.tsx: href="#a2p-registration") because this card sits
// below the whole checklist and was hard to find by scrolling. The link only
// works if this section actually carries that id.

describe("A2pPanel — the anchor the checklist's A2P row links to", () => {
  it("carries id=\"a2p-registration\" on its own card", () => {
    const html = renderToStaticMarkup(createElement(A2pPanel, {
      registration: null, recordedAt: null,
      action: async () => ({ ok: true as const }),
    }));
    expect(html).toContain('id="a2p-registration"');
  });
});
