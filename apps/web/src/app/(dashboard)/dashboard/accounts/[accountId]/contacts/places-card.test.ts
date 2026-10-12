import { describe, it, expect, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "@/components/locale-provider";
import type { PlacesLoad } from "@/lib/contacts/places-load";

// "use server" actions cannot load in vitest; the view never calls them while rendering.
vi.mock("./places-actions", () => ({
  addPlaceAction: vi.fn(), updatePlaceFieldAction: vi.fn(), setPlaceOwnerAction: vi.fn(), removePlaceAction: vi.fn(),
  undoRemovePlaceAction: vi.fn(), setPlaceArchivedAction: vi.fn(), addEquipmentAction: vi.fn(), replaceEquipmentAction: vi.fn(),
  updateEquipmentFieldAction: vi.fn(), removeEquipmentAction: vi.fn(), undoRemoveEquipmentAction: vi.fn(),
}));
const { PlacesCardView, PlacesCard } = await import("./places-card");
const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");
const { mapUrl } = await import("@/lib/contacts/place-view");
const { formatDateUTC } = await import("@/lib/format");

type Data = Extract<PlacesLoad, { status: "ready" }>["data"];
const C1 = "22222222-2222-4222-8222-222222222222";
const G1 = "44444444-4444-4444-8444-444444444444";
const stamp = { account_id: "a1", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
const place = (over: Partial<Data["places"][number]>): Data["places"][number] => ({
  id: "p0", contact_id: C1, client_group_id: null, label: null, address: null, landmark: null, directions: null,
  city: null, region: null, postal_code: null, country: null, archived_at: null, ...stamp, ...over,
});
const unit = (over: Partial<Data["equipment"][number]>): Data["equipment"][number] => ({
  id: "u0", place_id: "p1", name: "AC upstairs", make: null, model: null, serial: null, notes: null,
  installed_on: null, warranty_until: null, replaces_id: null, ...stamp, ...over,
});
const HOME = place({
  id: "p1", label: "Casa", address: "1204 Nolana Ave", city: "McAllen", region: "TX", postal_code: "78504",
  landmark: "the blue house past the canal", directions: "Gate on the left, mind the dogs",
});
const RANCH = place({ id: "p2", contact_id: null, client_group_id: G1, landmark: "past the Valero, second gate", created_at: "2026-10-02T00:00:00Z" });
const OLD = place({ id: "p3", label: "Old rental", address: "9 Elm St", archived_at: "2026-10-05T00:00:00Z" });
const AC_OLD = unit({ id: "u1", make: "Carrier", model: "CA-10", installed_on: "2010-01-01" });
const AC_NEW = unit({ id: "u2", make: "Rheem", installed_on: "2021-06-01", warranty_until: "2031-06-01", replaces_id: "u1", created_at: "2026-10-03T00:00:00Z" });
const HEATER = unit({ id: "u3", name: "Water heater", warranty_until: "2020-01-01", created_at: "2026-10-04T00:00:00Z" });
const data = (over: Partial<Data> = {}): Data => ({
  subject: { id: C1, firstName: "Ana", lastName: "Reyes" }, today: "2026-10-12",
  groups: [{ id: G1, kind: "household", name: "Casa Reyes", isPrimary: true }],
  places: [HOME, RANCH, OLD], placeCount: 3, equipment: [AC_OLD, AC_NEW, HEATER], equipmentCount: 3, ...over,
});
const ready = (over: Partial<Data> = {}): PlacesLoad => ({ status: "ready", data: data(over) });

const noop = () => {};
const none = async () => {};
const handlers = {
  removePlace: none, putBack: none, removeUnit: none, changed: noop, placeAdded: noop, unitAdded: noop, unitReplaced: noop, ownerChanged: noop,
};
const render = (locale: "en" | "es", load: PlacesLoad, canMovePlace = true) =>
  // Children positionally (react/no-children-prop); the cast only tells createElement they arrive there.
  renderToStaticMarkup(createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>,
    createElement(PlacesCardView, { accountId: "a1", contactId: C1, canMovePlace, load, onRetry: noop, handlers })));
const one = (html: string, re: RegExp) => html.match(re)?.[0] ?? "";

describe("PlacesCardView: its own loaded, empty and error states (rule 5 per card)", () => {
  it("loading is two skeleton rows shaped like a property, never a spinner (rule 7)", () => {
    const html = render("en", { status: "loading" });
    expect(html.match(/data-places-skeleton/g)).toHaveLength(2);
    expect(html).not.toContain("animate-spin");
    expect(renderedText(html)).not.toContain(m["places.empty"]);
  });

  it("empty sells the feature with its action, in the reader's language, with lang set (mutation: hard-code English -> FAILS)", () => {
    const empty = ready({ places: [], placeCount: 0, equipment: [], equipmentCount: 0 });
    const en = renderedText(render("en", empty));
    expect(en).toContain(m["places.empty"]);
    expect(en).toContain(m["places.add"]);
    const es = render("es", empty);
    expect(renderedText(es)).toContain(m["places.empty.es"]);
    expect(renderedText(es)).toContain(m["places.add.es"]);
    expect(es).toContain('lang="es"');
  });

  it("error offers Try again inside the card", () => {
    const html = render("en", { status: "error" });
    expect(html).toContain("data-places-card");
    expect(renderedText(html)).toContain(m["places.loadFailed"]);
    expect(one(html, /<button[^>]*>[^<]*<\/button>/)).toContain(m["places.retry"]);
  });

  it("headingHidden hides the heading but keeps it labelling the section (S-03 §8; mutation: ignore the prop -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "en" } as ComponentProps<typeof LocaleProvider>,
      createElement(PlacesCardView, { accountId: "a1", contactId: C1, canMovePlace: true, headingHidden: true, load: { status: "loading" }, onRetry: noop, handlers })));
    expect(html).toMatch(/<h3 id="[^"]+" class="sr-only">/);
    expect(render("en", { status: "loading" })).not.toMatch(/<h3[^>]*class="sr-only"/);
  });

  it("PlacesCard hands headingHidden to its view (review round 1, minor 2; mutation: drop the pass-through -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "en" } as ComponentProps<typeof LocaleProvider>,
      createElement(PlacesCard, { accountId: "a1", contactId: C1, canMovePlace: true, headingHidden: true })));
    expect(html).toMatch(/<h3 id="[^"]+" class="sr-only">/);
  });

  it("headingHidden: no empty row under RecordCard's title, and Add stays right; the drawer's row is unchanged (review round 1, minor 3; mutation: keep the justify-between row -> FAILS)", () => {
    const hidden = (load: PlacesLoad) => renderToStaticMarkup(createElement(LocaleProvider, { locale: "en" } as ComponentProps<typeof LocaleProvider>,
      createElement(PlacesCardView, { accountId: "a1", contactId: C1, canMovePlace: true, headingHidden: true, load, onRetry: noop, handlers })));
    expect(hidden({ status: "loading" })).toMatch(/^<section[^>]*><h3 id="[^"]+" class="sr-only">/);
    expect(hidden(ready())).toMatch(/^<section[^>]*><div class="flex flex-wrap items-center justify-end gap-2"><h3 id="[^"]+" class="sr-only">/);
    expect(render("en", { status: "loading" })).toMatch(/^<section[^>]*><div class="flex flex-wrap items-center justify-between gap-2"><h3 /);
  });
});

describe("a property", () => {
  it("a property reads its title, address and city line, landmark, how to get there and an Open map link that opens a new tab safely (mutation: drop rel -> FAILS)", () => {
    const html = render("en", ready());
    const text = renderedText(html);
    for (const s of ["Casa", "1204 Nolana Ave", "McAllen, TX 78504", "the blue house past the canal", "Gate on the left, mind the dogs", m["places.openMap"]]) {
      expect(text).toContain(s);
    }
    const link = one(html, /<a[^>]*data-place-map[^>]*>/);
    expect(link).toContain(`href="${mapUrl(HOME)!.replace(/&/g, "&amp;")}"`);
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
  });

  it("no address, no Open map", () => {
    const html = render("en", ready({ places: [RANCH], placeCount: 1, equipment: [], equipmentCount: 0 }));
    expect(html).not.toContain("data-place-map");
    expect(renderedText(html)).not.toContain(m["places.openMap"]);
    // No label and no address: the landmark is its title.
    expect(renderedText(html)).toContain("past the Valero, second gate");
  });

  it("a group's property says who it is shared with", () => {
    // A Technician's view: no Belongs to select, whose own label would say it too.
    const html = render("en", ready(), false);
    const row = one(html, /<li[^>]*data-place-row="p2"[\s\S]*?<\/li>/);
    expect(renderedText(row)).toContain("Shared with Casa Reyes");
    expect(renderedText(one(html, /<li[^>]*data-place-row="p1"[\s\S]*?data-place-equipment/))).not.toContain("Shared with");
  });

  it("removed properties are listed apart, each with Put back", () => {
    const html = render("en", ready());
    expect(html.match(/data-place-row=/g)).toHaveLength(2);
    const removed = one(html, /<ul[^>]*data-places-removed[^>]*>[\s\S]*?<\/ul>/);
    expect(renderedText(removed)).toContain("Old rental");
    expect(renderedText(removed)).toContain(m["places.putBack"]);
    expect(renderedText(html)).toContain("Removed properties (1)");
  });

  it("a Technician has no Belongs to control; an Owner has it (mutation: ignore canMovePlace -> FAILS)", () => {
    expect(renderedText(render("en", ready(), true))).toContain(m["places.belongsTo"]);
    expect(renderedText(render("en", ready(), false))).not.toContain(m["places.belongsTo"]);
  });
});

describe("equipment", () => {
  it("warranty is a dot plus a word against the account's today, never colour alone (rule 3; mutation: render the dot without the word -> FAILS)", () => {
    const html = render("en", ready());
    const words = [...html.matchAll(/data-mark="warranty"[^>]*><span aria-hidden="true"[^>]*><\/span>([^<]+)<\/span>/g)].map((x) => x[1]);
    expect(words).toContain(m["equipment.underWarranty"].replace("{date}", formatDateUTC("2031-06-01", "en")));
    expect(words).toContain(m["equipment.warrantyEnded"].replace("{date}", formatDateUTC("2020-01-01", "en")));
    // The same date reads "ended" once the account's today is past it.
    const later = render("en", ready({ today: "2031-06-02" }));
    expect(later).not.toContain(m["equipment.underWarranty"].replace("{date}", formatDateUTC("2031-06-01", "en")));
  });

  it("a replaced unit sits under Earlier units with its replaced date, and has no Remove (C6)", () => {
    const html = render("en", ready());
    expect(renderedText(html)).toContain("Equipment (2)");
    const toggle = one(html, /<button[^>]*aria-expanded="false"[^>]*>[^<]*Earlier units \(1\)/);
    expect(toggle).not.toBe("");
    const history = one(html, /<ul[^>]*data-equipment-history[^>]*>[\s\S]*?<\/ul>/);
    expect(renderedText(history)).toContain("Carrier");
    expect(renderedText(history)).toContain(m["equipment.replacedOn"].replace("{date}", formatDateUTC("2021-06-01", "en")));
    // Read only, so the old unit's own install date is a line, not a field (spec §8: "Installed {date}").
    expect(renderedText(history)).toContain(m["equipment.installedOn"].replace("{date}", formatDateUTC("2010-01-01", "en")));
    expect(history).not.toContain("<button");
    // Each current unit has its own Remove; the replaced one has none.
    expect(html.match(/aria-label="Remove AC upstairs"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Remove Water heater"');
  });

  it("a property with no units says so, with Add equipment", () => {
    const text = renderedText(render("en", ready({ places: [RANCH], placeCount: 1, equipment: [], equipmentCount: 0 })));
    expect(text).toContain(m["equipment.empty"]);
    expect(text).toContain(m["equipment.add"]);
  });
});

describe("Spanish", () => {
  it("the card renders the same in Spanish: Propiedades, Cómo llegar, Equipo", () => {
    const html = render("es", ready());
    const text = renderedText(html);
    expect(html).toContain('lang="es"');
    for (const s of ["Propiedades", "Cómo llegar", "Equipo (2)", "Compartida con Casa Reyes", "Abrir mapa", "Propiedades quitadas (1)", "Equipos anteriores (1)"]) {
      expect(text).toContain(s);
    }
    expect(text).not.toContain(m["places.title"]);
    expect(text).not.toContain(m["places.directions"]);
  });
});
