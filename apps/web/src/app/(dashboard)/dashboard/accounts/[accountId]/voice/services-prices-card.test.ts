import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { VoiceServiceInput } from "@bis/db";
import {
  ServicesPricesCard, ServiceRowEditor, newServiceRow, postableServices, serviceRowPreview,
  type ServiceRowState,
} from "./services-prices-card";
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
      { ...CATERING, id: "a", removed: false, editing: false },
      { ...newServiceRow(), name_en: "Bar service", id: "b", removed: true, editing: false },
      { ...newServiceRow(), name_en: "Rentals", id: "c", removed: false, editing: true },
    ];
    const posted = postableServices(rows);
    expect(posted.map((r) => r.name_en)).toEqual(["Catering", "Rentals"]);
  });

  it("strips the card's own id/removed/editing, posting the plain ServiceForm shape", () => {
    const posted = postableServices([{ ...CATERING, id: "a", removed: false, editing: false }]);
    expect(posted).toEqual([CATERING]);
    expect(Object.keys(posted[0]!)).not.toContain("id");
    expect(Object.keys(posted[0]!)).not.toContain("removed");
    expect(Object.keys(posted[0]!)).not.toContain("editing");
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
    const posted = postableServices([{ ...loaded, id: "x", removed: false, editing: false }]);
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
      rowId: "r1", row: CATERING, insurance: false, locale: "en", pseudo: false,
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
      rowId: "r1", row: CATERING, insurance: true, locale: "en", pseudo: false,
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
      rowId: "r1", row: CATERING, insurance: true, locale: "en", pseudo: false,
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
});
