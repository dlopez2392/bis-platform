import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// "use server" actions cannot load in vitest; the demo never calls them (its handlers are no-ops).
vi.mock("../accounts/[accountId]/contacts/relationship-actions", () => ({
  setRelationshipAction: vi.fn(), undoSetRelationshipAction: vi.fn(), removeRelationshipAction: vi.fn(),
  undoRemoveRelationshipAction: vi.fn(), addRelationshipAction: vi.fn(), searchRelatableContactsAction: vi.fn(),
}));
const { RelationshipsDemo } = await import("./relationships-demo");
const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");

describe("styleguide: the Related people card in every state (DoD: /styleguide gains the new component)", () => {
  const html = renderToStaticMarkup(createElement(RelationshipsDemo));
  const text = renderedText(html);
  it("shows loaded in English and Spanish, empty, loading and error (mutation: drop a state -> FAILS)", () => {
    expect(html.match(/data-relationships-card/g)).toHaveLength(5);
    expect(text).toContain("Mother: Ana Ramírez");
    expect(text).toContain("Madre: Ana Ramírez");
    expect(text).toContain(m["relationships.empty"]);
    expect(html.match(/data-relationships-skeleton/g)).toHaveLength(2);
    expect(text).toContain(m["relationships.loadFailed"]);
  });
  it("includes a person not on the reader's list and a flag the label already is", () => {
    expect(text).toContain(`Father: ${m["relationships.hiddenPerson"]}`);
    expect(text).toContain("Emergency contact: Leo Garza");
  });
});
