// S-10 T9b review M-2. Voice is an English island (owner decision Q4), but the services editor's
// kind list reads in the operator's own language (tr.text). Radix portals a Select's list into
// <body>, OUTSIDE the editor row's own lang={locale}, where the island's claim makes <html lang> "en",
// so the list must carry the reader's language itself. Select is stubbed so its content renders
// statically (a closed Radix Select renders no list at all) and its props can be read.
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ServiceForm } from "@/lib/voice/knowledge/validate";

vi.mock("@/components/ui/select", () => {
  const pass = ({ children }: { children?: unknown }) => createElement("div", null, children as never);
  return {
    Select: pass, SelectTrigger: pass, SelectValue: () => null,
    SelectItem: ({ children }: { children?: unknown }) => createElement("span", { "data-item": "" }, children as never),
    SelectContent: ({ children, lang }: { children?: unknown; lang?: string }) =>
      createElement("div", { "data-select-content": "", lang }, children as never),
  };
});

const { ServiceRowEditor } = await import("./services-prices-card");

const CATERING: ServiceForm = {
  name_en: "Catering", name_es: "Banquete", description_en: "", description_es: "",
  price_kind: "per_unit", amount: "35", amount_max: "", unit_en: "guest", unit_es: "invitado",
};

describe("ServiceRowEditor — the portalled kind list carries the reader's language (review M-2)", () => {
  it.each(["es", "en"] as const)("marks the list with the reader's language (%s) (mutation: drop lang={locale} from <SelectContent> -> FAILS)", (locale) => {
    const html = renderToStaticMarkup(createElement(ServiceRowEditor, {
      rowId: "r1", row: CATERING, insurance: false, dropsPrice: false, locale, pseudo: false,
      onChange: () => {}, onDone: () => {},
    }));
    expect(html).toMatch(new RegExp(`<div data-select-content="" lang="${locale}">`));
  });
});
