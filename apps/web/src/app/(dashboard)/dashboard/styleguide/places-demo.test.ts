import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// "use server" actions cannot load in vitest; the demo never calls them (its handlers are no-ops).
vi.mock("../accounts/[accountId]/contacts/places-actions", () => ({
  addPlaceAction: vi.fn(), updatePlaceFieldAction: vi.fn(), setPlaceOwnerAction: vi.fn(), removePlaceAction: vi.fn(),
  undoRemovePlaceAction: vi.fn(), setPlaceArchivedAction: vi.fn(), addEquipmentAction: vi.fn(), replaceEquipmentAction: vi.fn(),
  updateEquipmentFieldAction: vi.fn(), removeEquipmentAction: vi.fn(), undoRemoveEquipmentAction: vi.fn(),
}));
const { PlacesDemo } = await import("./places-demo");
const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");

describe("styleguide: the Properties card in every state (DoD: /styleguide gains the new component)", () => {
  const html = renderToStaticMarkup(createElement(PlacesDemo));
  const text = renderedText(html);
  it("shows loaded in English and Spanish, a Technician's view, empty, loading and error (mutation: drop a state -> FAILS)", () => {
    expect(html.match(/data-places-card/g)).toHaveLength(6);
    expect(text).toContain(m["places.title"]);
    expect(text).toContain(m["places.title.es"]);
    expect(text).toContain(m["places.empty"]);
    expect(html.match(/data-places-skeleton/g)).toHaveLength(2);
    expect(text).toContain(m["places.loadFailed"]);
  });
  it("includes a shared property, a warranty both ways, a replaced unit and a removed property", () => {
    expect(text).toContain("Shared with Casa Garza");
    expect(html.match(/data-mark="warranty"/g)!.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("data-equipment-history");
    expect(html).toContain("data-places-removed");
  });
});
