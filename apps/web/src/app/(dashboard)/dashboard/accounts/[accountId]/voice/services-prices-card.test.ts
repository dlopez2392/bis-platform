import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { VoiceServiceInput } from "@bis/db";
import {
  ServicesPricesCard, ServiceRowEditor, ServiceRowView, newServiceRow, postableServices, serviceRowPreview,
  renameDropsPrice, removeRow, settleAfterSave, moveFocusTarget, toRowState, serviceAmountMatches,
  type ServiceRowState,
} from "./services-prices-card";
import { makeTr } from "@/lib/record/copy";
import { formFromServices, type ServiceForm } from "@/lib/voice/knowledge/validate";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import type { ActionResult } from "./actions";

const noopAction = vi.fn(async (): Promise<ActionResult> => ({ ok: true }));

const CATERING: ServiceForm = {
  name_en: "Catering", name_es: "Banquete", description_en: "", description_es: "",
  price_kind: "per_unit", amount: "35", amount_max: "", unit_en: "guest", unit_es: "invitado",
};

/** The same service, as a STORED row (`VoiceServiceInput`, `@bis/db`) — `$35 per guest`. */
const CATERING_ROW: VoiceServiceInput = {
  name_en: "Catering", name_es: "Banquete", description_en: null, description_es: null,
  price_kind: "per_unit", amount_cents: 3500, amount_max_cents: null, unit_en: "guest", unit_es: "invitado",
};

function render(over: Partial<Parameters<typeof ServicesPricesCard>[0]> = {}) {
  const props = {
    locale: "en" as const, pseudo: false, persona: "Sofía", insurance: false,
    services: { ok: true as const, rows: [] as VoiceServiceInput[] }, action: noopAction,
    ...over,
  };
  return renderToStaticMarkup(createElement(ServicesPricesCard, props));
}

describe("newServiceRow — a brand-new row", () => {
  it("starts with price_kind blank, whichever account this opens on (spec 5.7, C13)", () => {
    expect(newServiceRow().price_kind).toBe("");
    expect(newServiceRow().name_en).toBe("");
  });
});

describe("postableServices — what 'Save services' actually posts", () => {
  it("leaves a staged-removed row out of the posted list, in order (spec 5.7; mutation: post it anyway -> FAILS)", () => {
    const rows: ServiceRowState[] = [
      { ...CATERING, id: "a", removed: false, editing: false, origin: null },
      { ...newServiceRow(), name_en: "Bar service", id: "b", removed: true, editing: false, origin: null },
      { ...newServiceRow(), name_en: "Rentals", id: "c", removed: false, editing: true, origin: null },
    ];
    const posted = postableServices(rows);
    expect(posted.map((r) => r.name_en)).toEqual(["Catering", "Rentals"]);
  });

  it("strips the card's own id/removed/editing, posting the plain ServiceForm shape", () => {
    const posted = postableServices([{ ...CATERING, id: "a", removed: false, editing: false, origin: null }]);
    expect(posted).toEqual([CATERING]);
    expect(Object.keys(posted[0]!)).not.toContain("id");
    expect(Object.keys(posted[0]!)).not.toContain("removed");
    expect(Object.keys(posted[0]!)).not.toContain("editing");
    expect(Object.keys(posted[0]!)).not.toContain("origin");
  });

  // C13: a stored row this card never opened for editing posts back EXACTLY the kind and amounts it
  // was loaded with, insurance or not — `postableServices` never reads `insurance` and never
  // rewrites a field; only the editor (through onChange) ever does. Round-tripped through the real
  // `formFromServices` (Task 7), never a hand-shaped row.
  it("a stored row untouched since load posts back its kind and amounts unchanged, on insurance too (mutation: drop amount/amount_max from the posted shape -> FAILS)", () => {
    const stored: VoiceServiceInput = {
      name_en: "Roof repair", name_es: null, description_en: null, description_es: null,
      price_kind: "fixed", amount_cents: 15000, amount_max_cents: null, unit_en: null, unit_es: null,
    };
    const loaded = formFromServices([stored])[0]!;
    const posted = postableServices([{ ...loaded, id: "x", removed: false, editing: false, origin: null }]);
    expect(posted).toEqual([loaded]);
    expect(posted[0]!.price_kind).toBe("fixed");
    expect(posted[0]!.amount).toBe("150");
  });
});

describe("serviceRowPreview — the live preview (spec 5.7)", () => {
  it("shows both sentences for a complete per_unit row, word for word (price-sentence.ts's own templates)", () => {
    expect(serviceRowPreview(CATERING, false)).toEqual({
      en: "The price for Catering is $35 per guest.",
      es: "El precio de Banquete es $35 por invitado.",
    });
  });

  // MUTATION: call priceSentence directly on the row instead of gating through servicesFromForm first
  // -> this THROWS instead of returning null (the brief: "never call priceSentence on an incomplete
  // row; it throws").
  it("is null for an incomplete row (a per_unit row with no Spanish unit)", () => {
    const incomplete: ServiceForm = { ...CATERING, unit_es: "" };
    expect(serviceRowPreview(incomplete, false)).toBeNull();
  });

  it("is always null on insurance, even for an otherwise-complete row (C13; mutation: drop the insurance gate -> FAILS)", () => {
    expect(serviceRowPreview(CATERING, true)).toBeNull();
  });
});

describe("ServiceRowEditor — the insurance face (spec 5.7, C13)", () => {
  it("shows the kind Select, the amount/unit fields and the preview off insurance", () => {
    const html = renderToStaticMarkup(createElement(ServiceRowEditor, {
      rowId: "r1", row: CATERING, insurance: false, dropsPrice: false, locale: "en", pseudo: false,
      onChange: () => {}, onDone: () => {},
    }));
    const text = renderedText(html);
    expect(text).toContain(m["voice.services.kind"]);
    expect(html).toContain('id="r1-amount"');
    expect(html).toContain('id="r1-unit-en"');
    expect(text).toContain(m["voice.services.previewEn"]);
    expect(text).toContain("$35");
  });

  // Spec §7 / C13: no kind Select, no amount or unit field, no sentence, and no "$" anywhere in this
  // row's markup for a STORED fixed row — even though the row's own state still carries a real kind
  // and amount (CATERING is per_unit with a real $35; this proves the hiding is unconditional, not
  // "only when the row happens to be blank"). Mutation: drop any one `!insurance` guard -> FAILS.
  it("hides the kind Select, every amount/unit field and the preview on insurance, for a stored row with a real kind and amount", () => {
    const html = renderToStaticMarkup(createElement(ServiceRowEditor, {
      rowId: "r1", row: CATERING, insurance: true, dropsPrice: false, locale: "en", pseudo: false,
      onChange: () => {}, onDone: () => {},
    }));
    const text = renderedText(html);
    expect(text).not.toContain(m["voice.services.kind"]);
    expect(html).not.toContain('id="r1-amount"');
    expect(html).not.toContain('id="r1-amount-min"');
    expect(html).not.toContain('id="r1-amount-max"');
    expect(html).not.toContain('id="r1-unit-en"');
    expect(html).not.toContain('id="r1-unit-es"');
    expect(text).not.toContain(m["voice.services.previewEn"]);
    expect(text).not.toContain(m["voice.services.previewEs"]);
    expect(html).not.toContain("$");
    // The name/description fields still show — insurance hides pricing, not the service itself.
    expect(html).toContain('id="r1-name-en"');
  });

  it("still shows the English/Spanish name and description fields on insurance", () => {
    const html = renderToStaticMarkup(createElement(ServiceRowEditor, {
      rowId: "r1", row: CATERING, insurance: true, dropsPrice: false, locale: "en", pseudo: false,
      onChange: () => {}, onDone: () => {},
    }));
    expect(html).toContain('id="r1-name-en"');
    expect(html).toContain('id="r1-name-es"');
    expect(html).toContain('id="r1-desc-en"');
    expect(html).toContain('id="r1-desc-es"');
  });
});

describe("ServicesPricesCard — loaded", () => {
  it("renders the title, the row (with its amount summary) and exactly ONE primary Save (rule 8; mutation: a second data-variant=\"default\" -> FAILS)", () => {
    const html = render({ services: { ok: true, rows: [CATERING_ROW] } });
    expect(html).toContain('data-slot="card"');
    const text = renderedText(html);
    expect(text).toContain(m["voice.services.title"]);
    expect(text).toContain(m["voice.services.body"].replace("{persona}", "Sofía"));
    expect(text).toContain("Catering");
    expect(text).toContain(m["voice.services.summary.perUnit"].replace("{amount}", "$35").replace("{unit}", "guest"));
    expect((html.match(/data-variant="default"/g) ?? []).length).toBe(1);
    expect(text).toContain(m["voice.services.save"]);
  });

  it("disables Add a service at 50 rows, with its hint (mutation: drop the cap -> FAILS)", () => {
    const rows: VoiceServiceInput[] = Array.from({ length: 50 }, (_, i) => ({
      name_en: `Service ${i}`, name_es: null, description_en: null, description_es: null,
      price_kind: "free", amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null,
    }));
    const html = render({ services: { ok: true, rows } });
    const text = renderedText(html);
    expect(text).toContain(m["voice.services.max"]);
    const addButtons = [...html.matchAll(new RegExp(`<button\\b[^>]*>\\s*${m["voice.services.add"]}\\s*</button>`, "g"))];
    expect(addButtons.length).toBe(1);
    expect(/ disabled=""/.test(addButtons[0]![0])).toBe(true);
  });

  it("sets lang on the card's root when the locale is Spanish (mutation: drop the lang prop -> FAILS)", () => {
    const html = render({ locale: "es", services: { ok: true, rows: [] } });
    expect(html).toMatch(/<div[^>]*id="services-prices"[^>]*lang="es"/);
    expect(renderedText(html)).toContain(m["voice.services.title.es"]);
  });
});

describe("ServicesPricesCard — empty", () => {
  it("shows the empty state and never a primary button (mutation: render the form anyway -> FAILS)", () => {
    const html = render({ services: { ok: true, rows: [] } });
    const text = renderedText(html);
    expect(text).toContain(m["voice.services.empty"].replace("{persona}", "Sofía"));
    expect(text).toContain(m["voice.services.add"]);
    expect((html.match(/data-variant="default"/g) ?? []).length).toBe(0);
  });
});

describe("ServicesPricesCard — error", () => {
  it("shows the crit Notice and no form at all when the read failed (mutation: render the form anyway -> FAILS)", () => {
    const html = render({ services: { ok: false } });
    const text = renderedText(html);
    expect(text).toContain(m["voice.services.loadFailed"]);
    expect(html).not.toContain("<form");
    expect((html.match(/data-variant="default"/g) ?? []).length).toBe(0);
  });
});

describe("ServicesPricesCard — insurance", () => {
  it("shows the insurance title and Notice, and never the body sentence (mutation: show the body anyway -> FAILS)", () => {
    const html = render({
      insurance: true,
      services: { ok: true, rows: [CATERING_ROW] },
    });
    const text = renderedText(html);
    expect(text).toContain(m["voice.services.titleInsurance"]);
    expect(text).toContain(m["voice.services.insuranceNotice"].replace("{persona}", "Sofía"));
    expect(text).not.toContain(m["voice.services.body"].replace("{persona}", "Sofía"));
    expect(html).not.toContain("$");
  });

  // Final review I3 / design review I2: the collapsed row showed "Price per unit" on insurance.
  it("the collapsed row names no kind on insurance, for a stored row of every kind (mutation: show the kind label -> FAILS)", () => {
    const kinds = ["fixed", "from", "range", "per_unit", "free", "after_visit"] as const;
    const rows: VoiceServiceInput[] = kinds.map((price_kind, i) => ({
      name_en: `Service ${i}`, name_es: null, description_en: null, description_es: null, price_kind,
      amount_cents: price_kind === "free" || price_kind === "after_visit" ? null : 1000,
      amount_max_cents: price_kind === "range" ? 2000 : null,
      unit_en: price_kind === "per_unit" ? "guest" : null, unit_es: price_kind === "per_unit" ? "invitado" : null,
    }));
    const text = renderedText(render({ insurance: true, services: { ok: true, rows } }));
    expect(text).toContain("Service 5");
    for (const k of kinds) expect(text).not.toContain(m[`voice.services.kind.${k}`]);
    // Off insurance the same rows DO name their kind, so the negative above is not vacuous.
    const off = renderedText(render({ insurance: false, services: { ok: true, rows } }));
    for (const k of kinds) expect(off).toContain(m[`voice.services.kind.${k}`]);
  });

  it("the insurance Notice is a note with the foreground ink, never an alert (design review I8; mutation: Notice's default role -> FAILS)", () => {
    const html = render({ insurance: true, services: { ok: true, rows: [CATERING_ROW] } });
    const notice = /<div[^>]*data-slot="notice"[^>]*>/.exec(html)?.[0] ?? "";
    expect(notice).toContain('role="note"');
    expect(notice).toMatch(/class="[^"]*\btext-foreground\b/);
  });
});

const tr = makeTr("en");
const stored = (o: Partial<ServiceRowState> = {}): ServiceRowState => ({
  ...toRowState([CATERING_ROW])[0]!, id: "r1", ...o,
});

describe("renameDropsPrice — C21: on insurance, renaming a row loaded with a price drops that price", () => {
  it("true only on insurance, for a row loaded with a price, whose English name now differs, trimmed (mutation: drop the name check -> FAILS)", () => {
    expect(renameDropsPrice(stored({ name_en: "Event catering" }), true)).toBe(true);
    expect(renameDropsPrice(stored(), true)).toBe(false);
    expect(renameDropsPrice(stored({ name_en: "  Catering " }), true)).toBe(false);
    expect(renameDropsPrice(stored({ name_en: "Event catering" }), false)).toBe(false);
  });

  it("false for a row loaded with no price and for a new row (mutation: ignore the loaded price -> FAILS)", () => {
    const afterVisit = toRowState([{ ...CATERING_ROW, price_kind: "after_visit", amount_cents: null, unit_en: null, unit_es: null }])[0]!;
    expect(renameDropsPrice({ ...afterVisit, name_en: "Renamed" }, true)).toBe(false);
    expect(renameDropsPrice({ ...newServiceRow(), name_en: "Renamed", id: "n", removed: false, editing: true, origin: null }, true)).toBe(false);
  });

  it("the editor shows the one-line hint under the English name, tied to it (mutation: never render the hint -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(ServiceRowEditor, {
      rowId: "r1", row: { ...CATERING, name_en: "Event catering" }, insurance: true, dropsPrice: true, locale: "en", pseudo: false,
      onChange: () => {}, onDone: () => {},
    }));
    expect(renderedText(html)).toContain("Renaming this service removes the price stored for it.");
    expect(html).toMatch(/<input[^>]*id="r1-name-en"[^>]*aria-describedby="r1-name-en-hint"/);
    const quiet = renderToStaticMarkup(createElement(ServiceRowEditor, {
      rowId: "r1", row: CATERING, insurance: true, dropsPrice: false, locale: "en", pseudo: false,
      onChange: () => {}, onDone: () => {},
    }));
    expect(renderedText(quiet)).not.toContain("Renaming this service removes the price stored for it.");
  });
});

describe("removeRow — a never-saved row goes at once; a saved one is staged until Save", () => {
  it("drops a row added in this visit, and stages a loaded one (mutation: stage every row -> FAILS)", () => {
    const fresh: ServiceRowState = { ...newServiceRow(), name_en: "Tents", id: "n", removed: false, editing: true, origin: null };
    const rows = [stored(), fresh];
    expect(removeRow(rows, "n").map((r) => r.id)).toEqual(["r1"]);
    const staged = removeRow(rows, "r1");
    expect(staged.find((r) => r.id === "r1")).toMatchObject({ removed: true, editing: false });
    expect(staged.length).toBe(2);
  });
});

describe("settleAfterSave — the card after a successful Save (design review I3)", () => {
  it("prunes the staged rows and closes every editor (mutation: keep removed rows -> FAILS)", () => {
    const rows = [stored({ id: "a", removed: true }), stored({ id: "b", editing: true }), stored({ id: "c" })];
    const after = settleAfterSave(rows, false);
    expect(after.map((r) => r.id)).toEqual(["b", "c"]);
    expect(after.every((r) => !r.editing && !r.removed)).toBe(true);
  });

  it("every kept row is now a saved row: Remove stages it, and its loaded name is the name just saved", () => {
    const fresh: ServiceRowState = { ...newServiceRow(), name_en: "Tents", price_kind: "free", id: "n", removed: false, editing: true, origin: null };
    const [saved] = settleAfterSave([fresh], false);
    expect(saved!.origin).toEqual({ name_en: "Tents", priced: true });
    expect(removeRow([saved!], "n")[0]).toMatchObject({ removed: true });
  });

  it("on insurance a renamed priced row now holds what the server stored: after a visit, nothing priced (C21; mutation: keep its price -> FAILS)", () => {
    const [after] = settleAfterSave([stored({ name_en: "Event catering", editing: true })], true);
    expect(after).toMatchObject({
      name_en: "Event catering", price_kind: "after_visit", amount: "", amount_max: "", unit_en: "", unit_es: "",
      origin: { name_en: "Event catering", priced: false },
    });
    const [kept] = settleAfterSave([stored()], true);
    expect(kept).toMatchObject({ price_kind: "per_unit", amount: "35", origin: { name_en: "Catering", priced: true } });
  });
});

describe("moveFocusTarget — which arrow keeps the focus after a move (design review I5)", () => {
  it("the same arrow, unless the row reached the end it was moving to (mutation: always the same arrow -> FAILS)", () => {
    expect(moveFocusTarget(-1, 1, 3)).toBe("up");
    expect(moveFocusTarget(-1, 0, 3)).toBe("down");
    expect(moveFocusTarget(1, 1, 3)).toBe("down");
    expect(moveFocusTarget(1, 2, 3)).toBe("up");
  });
});

describe("ServiceRowView — the collapsed row", () => {
  const view = (row: ServiceRowState, insurance = false) => renderToStaticMarkup(createElement(ServiceRowView, {
    row, index: 0, count: 2, insurance, tr, onMove: () => {}, onEdit: () => {}, onRemove: () => {}, onKeep: () => {},
  }));

  it("its buttons name the service, and carry the ids focus returns to (design review I5 and D)", () => {
    const html = view(stored());
    for (const label of ["Move Catering up", "Move Catering down", "Edit Catering", "Remove Catering"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    for (const id of ["r1-up", "r1-down", "r1-edit", "r1-remove"]) expect(html).toContain(`id="${id}"`);
  });

  it("a staged row fades only its name, kind and amount; the status word and Keep stay full strength (design review I7; mutation: fade the whole li -> FAILS)", () => {
    const html = view(stored({ removed: true }));
    // The bare class only: the Keep button's own `disabled:opacity-50` variant is not a fade.
    const fades = /(?<![\w:-])opacity-50/g;
    expect(html).not.toMatch(/<li[^>]*(?<![\w:-])opacity-50/);
    expect((html.match(fades) ?? []).length).toBe(3);
    expect(html).toContain('aria-label="Keep Catering"');
    expect(html).toContain('id="r1-keep"');
    expect(html).toMatch(/<span class="text-xs text-muted-foreground">Removed when you save<\/span>/);
  });

  it("an unnamed row reads a muted 'New service', never the field's label (mutation: show 'Name in English' -> FAILS)", () => {
    const html = view({ ...newServiceRow(), id: "n", removed: false, editing: false, origin: null });
    expect(renderedText(html)).toContain("New service");
    expect(renderedText(html)).not.toContain(m["voice.services.nameEn"]);
    expect(html).toContain('aria-label="Edit New service"');
  });
});

describe("ServiceRowEditor — the fix round's fields", () => {
  const html = renderToStaticMarkup(createElement(ServiceRowEditor, {
    rowId: "r1", row: { ...CATERING, price_kind: "" }, insurance: false, dropsPrice: false, locale: "en", pseudo: false,
    onChange: () => {}, onDone: () => {},
  }));

  it("the panel takes the control radius (mutation: drop rounded -> FAILS)", () => {
    expect(html).toMatch(/<li[^>]*class="[^"]*rounded-\[var\(--radius-ctl\)\]/);
  });

  it("caps each field at the length the save accepts: names 80, descriptions 300 (textareas), units 30 (mutation: drop a maxLength -> FAILS)", () => {
    expect(html).toMatch(/<input[^>]*id="r1-name-en"[^>]*maxLength="80"/);
    expect(html).toMatch(/<input[^>]*id="r1-name-es"[^>]*maxLength="80"/);
    expect(html).toMatch(/<textarea[^>]*id="r1-desc-en"[^>]*maxLength="300"/);
    expect(html).toMatch(/<textarea[^>]*id="r1-desc-es"[^>]*maxLength="300"/);
    const perUnit = renderToStaticMarkup(createElement(ServiceRowEditor, {
      rowId: "r1", row: CATERING, insurance: false, dropsPrice: false, locale: "en", pseudo: false,
      onChange: () => {}, onDone: () => {},
    }));
    expect(perUnit).toMatch(/<input[^>]*id="r1-unit-en"[^>]*maxLength="30"/);
    expect(perUnit).toMatch(/<input[^>]*id="r1-unit-es"[^>]*maxLength="30"/);
  });

  it("the kind Select's placeholder is neutral, not a second copy of its label (mutation: placeholder = the label -> FAILS)", () => {
    expect(renderedText(html)).toContain("Choose one");
    expect(renderedText(html).split(m["voice.services.kind"]).length - 1).toBe(1);
  });
});

/**
 * S-47c follow-up: an amount typed into a row's name or description is read to the caller as written
 * (the HARD LIMITS line forbids any amount outside the price sentence, off insurance; on insurance
 * names and descriptions go into the prompt as written, spec 5.4). `serviceAmountMatches` reuses
 * facts-warnings.ts's own matcher and its false-positive guards.
 */
describe("serviceAmountMatches — amounts typed into a name or description", () => {
  it("finds an amount in every one of the four fields, each tagged with the row's own name (mutation: skip descriptions -> FAILS)", () => {
    const rows = [
      { name_en: "Haircut $40", name_es: "", description_en: "", description_es: "" },
      { name_en: "Trim", name_es: "Recorte $35", description_en: "", description_es: "" },
      { name_en: "Wash", name_es: "", description_en: "Includes a $10 conditioner", description_es: "" },
      { name_en: "Color", name_es: "", description_en: "", description_es: "Incluye un tinte de $50" },
    ];
    expect(serviceAmountMatches(rows)).toEqual([
      { name: "Haircut $40", text: "$40" },
      { name: "Trim", text: "$35" },
      { name: "Wash", text: "$10 conditioner" },
      { name: "Color", text: "$50" },
    ]);
  });

  it("falls back to the Spanish name when the row has no English name", () => {
    expect(serviceAmountMatches([{ name_en: "", name_es: "Banquete $40", description_en: "", description_es: "" }]))
      .toEqual([{ name: "Banquete $40", text: "$40" }]);
  });

  it("is empty when nothing matches", () => {
    expect(serviceAmountMatches([{ name_en: "Haircut", name_es: "", description_en: "A trim", description_es: "" }])).toEqual([]);
  });

  // Design review: none of these three carry a "$", "dollars" or "usd", so AMOUNT (facts-warnings.ts)
  // never even reaches them — this is not a guard being exercised, only confirming that an ordinary
  // phone number, ZIP or "24/7" was never going to be mistaken for a price in the first place.
  it("a phone number, a ZIP and \"24/7\" carry no $, dollars or usd, so none of them ever match", () => {
    const rows = [{
      name_en: "Service", name_es: "",
      description_en: "Call (956) 292-1696, open 24/7, McAllen TX 78501", description_es: "",
    }];
    expect(serviceAmountMatches(rows)).toEqual([]);
  });
});

describe("ServicesPricesCard — amounts typed into a name or description (S-47c follow-up)", () => {
  const rowWithAmount: VoiceServiceInput = {
    name_en: "Haircut $40", name_es: null, description_en: null, description_es: null,
    price_kind: "fixed", amount_cents: 2500, amount_max_cents: null, unit_en: null, unit_es: null,
  };

  // rowWithAmount's amount is in its NAME only (no description) — the sibling test right below pins
  // that a description is scanned too; this one pins the wording and that Save is never blocked.
  it("off insurance: names the amount and the row it came from, and never blocks Save — its row has the amount in the name only", () => {
    const html = render({ services: { ok: true, rows: [rowWithAmount] } });
    const text = renderedText(html);
    expect(text).toContain(m["voice.services.amountsNotice"].replace("{persona}", "Sofía").replace("{amounts}", 'Haircut $40: "$40"'));
    expect(html).toContain("<form");
    expect(text).toContain(m["voice.services.save"]);
  });

  it("the row's description, not only its name, is scanned (mutation: scan name_en/name_es only -> FAILS)", () => {
    const row: VoiceServiceInput = {
      name_en: "Wash", name_es: null, description_en: "Includes a $10 conditioner", description_es: null,
      price_kind: "free", amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null,
    };
    const text = renderedText(render({ services: { ok: true, rows: [row] } }));
    expect(text).toContain(m["voice.services.amountsNotice"].replace("{persona}", "Sofía").replace("{amounts}", 'Wash: "$10 conditioner"'));
  });

  it("on insurance: the insurance variant (mutation: always show the off-insurance wording -> FAILS)", () => {
    const html = render({ insurance: true, services: { ok: true, rows: [rowWithAmount] } });
    const text = renderedText(html);
    expect(text).toContain(m["voice.services.amountsNoticeInsurance"].replace("{persona}", "Sofía").replace("{amounts}", 'Haircut $40: "$40"'));
    expect(text).not.toContain(m["voice.services.amountsNotice"].replace("{persona}", "Sofía").replace("{amounts}", 'Haircut $40: "$40"'));
  });

  it("no notice at all without an amount (mutation: render it unconditionally -> FAILS)", () => {
    const html = render({ services: { ok: true, rows: [CATERING_ROW] } });
    const text = renderedText(html);
    expect(text).not.toContain(m["voice.services.amountsNotice"].replace("{persona}", "Sofía").split(":")[0]);
  });

  // Design review: a phone number, a ZIP and "24/7" carry no $, dollars or usd, so AMOUNT never
  // matches them — this pins the card shows no notice for an ordinary description, not a guard.
  it("a description with a phone number, a ZIP and \"24/7\" (none of them $/dollars/usd) shows no amounts notice", () => {
    const row: VoiceServiceInput = {
      name_en: "Service", name_es: null,
      description_en: "Call (956) 292-1696, open 24/7, McAllen TX 78501", description_es: null,
      price_kind: "free", amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null,
    };
    const text = renderedText(render({ services: { ok: true, rows: [row] } }));
    expect(text).not.toContain(m["voice.services.amountsNotice"].replace("{persona}", "Sofía").split(":")[0]);
  });

  it("is a note with the foreground ink, never an alert (design review precedent; mutation: Notice's default role -> FAILS)", () => {
    const html = render({ services: { ok: true, rows: [rowWithAmount] } });
    const notice = /<div[^>]*data-slot="notice"[^>]*>/.exec(html)?.[0] ?? "";
    expect(notice).toContain('role="note"');
    expect(notice).toMatch(/class="[^"]*\btext-foreground\b/);
  });

  it("sets lang on the card when Spanish, and reads the Spanish copy (mutation: hardcode the English key -> FAILS)", () => {
    const html = render({ locale: "es", services: { ok: true, rows: [rowWithAmount] } });
    const text = renderedText(html);
    expect(text).toContain(m["voice.services.amountsNotice.es"].replace("{persona}", "Sofía").replace("{amounts}", 'Haircut $40: "$40"'));
  });
});
