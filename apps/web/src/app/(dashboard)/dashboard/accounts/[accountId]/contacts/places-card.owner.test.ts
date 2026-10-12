import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlacesLoad } from "@/lib/contacts/places-load";

/**
 * The owner select's wiring (spec §7, fix round 1): InlineField is recorded, not run, so the
 * props the card hands the "Belongs to" field can be called directly. Its own toast is replaced
 * by the card's "{place} now belongs to {owner}." through onSaved (components/inline-field.tsx).
 */
const fields: Record<string, unknown>[] = [];
vi.mock("@/components/inline-field", () => ({ InlineField: (p: Record<string, unknown>) => { fields.push(p); return null; } }));
const setPlaceOwnerAction = vi.fn();
vi.mock("./places-actions", () => ({
  addPlaceAction: vi.fn(), updatePlaceFieldAction: vi.fn(), setPlaceOwnerAction, removePlaceAction: vi.fn(),
  undoRemovePlaceAction: vi.fn(), setPlaceArchivedAction: vi.fn(), addEquipmentAction: vi.fn(), replaceEquipmentAction: vi.fn(),
  updateEquipmentFieldAction: vi.fn(), removeEquipmentAction: vi.fn(), undoRemoveEquipmentAction: vi.fn(),
}));
const { PlacesCardView } = await import("./places-card");
const { m } = await import("@/lib/messages");

const C1 = "22222222-2222-4222-8222-222222222222";
const G1 = "44444444-4444-4444-8444-444444444444";
const stamp = { account_id: "a1", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
const load: PlacesLoad = { status: "ready", data: {
  subject: { id: C1, firstName: "Ana", lastName: "Reyes" }, today: "2026-10-12",
  groups: [{ id: G1, kind: "household", name: "Casa Reyes", isPrimary: true }],
  places: [{ id: "p1", contact_id: C1, client_group_id: null, label: "Casa", address: "1204 Nolana Ave", landmark: null, directions: null,
    city: null, region: null, postal_code: null, country: null, archived_at: null, ...stamp }],
  placeCount: 1, equipment: [], equipmentCount: 0,
} };
const handlers = {
  removePlace: async () => {}, putBack: async () => {}, removeUnit: async () => {},
  placeAdded: vi.fn(), unitAdded: vi.fn(), unitReplaced: vi.fn(), changed: vi.fn(), ownerChanged: vi.fn(),
};
function ownerField() {
  fields.length = 0;
  renderToStaticMarkup(createElement(PlacesCardView, { accountId: "a1", contactId: C1, canMovePlace: true, load, onRetry: () => {}, handlers }));
  const f = fields.find((p) => p.label === m["places.belongsTo"]);
  expect(f).toBeDefined();
  return f as { save: (v: string) => Promise<unknown>; onSaved: (prior: string, stored: string) => void };
}
beforeEach(() => { vi.clearAllMocks(); });

describe("the Belongs to field announces the owner change itself (spec §7)", () => {
  it("onSaved hands the handlers the place, its new owner's name and the prior owner (mutation: drop onSaved -> FAILS)", () => {
    const f = ownerField();
    f.onSaved(`contact:${C1}`, `group:${G1}`);
    expect(handlers.ownerChanged).toHaveBeenCalledWith("p1", "Casa", "Casa Reyes", `contact:${C1}`);
    f.onSaved(`group:${G1}`, `contact:${C1}`);
    expect(handlers.ownerChanged).toHaveBeenLastCalledWith("p1", "Casa", "Ana Reyes", `group:${G1}`);
  });
  it("the save writes the owner and leaves the re-read to the announcement, so the card reads once (mutation: reload in the save too -> FAILS)", async () => {
    setPlaceOwnerAction.mockResolvedValueOnce({ ok: true });
    await expect(ownerField().save(`group:${G1}`)).resolves.toEqual({ ok: true });
    expect(setPlaceOwnerAction).toHaveBeenCalledWith("a1", C1, "p1", `group:${G1}`);
    expect(handlers.changed).not.toHaveBeenCalled();
  });
});
