import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentChecklist, RequirementsMeter } from "./document-checklist";
import { renderedText } from "@/lib/rendered-text";
import type { RequirementsLoad } from "@/lib/documents/requirements-load";

type Props = Parameters<typeof DocumentChecklist>[0];

const ready = (items: [string, string][]): RequirementsLoad =>
  ({ kind: "ready", data: { items: items.map(([category, state]) => ({ category, state })) } } as RequirementsLoad);
/** The brief's partial list: one met, three gaps in the list's order, one skipped. */
const PARTIAL = ready([["insurance", "met"], ["id", "missing"], ["permit", "expired"], ["warranty", "checking"], ["photo", "skipped"]]);
const COMPLETE = ready([["insurance", "met"], ["photo", "skipped"]]);

const render = (over: Partial<Props> = {}) => renderToStaticMarkup(createElement(DocumentChecklist, {
  locale: "en", load: PARTIAL, canSkip: true, canAsk: true, panelOpen: false,
  onAsk: vi.fn(), onUpload: vi.fn(), onSkip: vi.fn(), onUnskip: vi.fn(), onRetry: vi.fn(), ...over,
} as Props));
const meter = (load: RequirementsLoad, locale: "en" | "es" = "en") => renderToStaticMarkup(createElement(RequirementsMeter, { locale, load }));

/** One item's own markup: its <li> to the next </li>. */
const rowOf = (html: string, category: string) => {
  const at = html.indexOf(`data-checklist-item="${category}"`);
  if (at < 0) return "";
  return html.slice(html.lastIndexOf("<li", at), html.indexOf("</li>", at));
};
const actionsIn = (row: string) => [...row.matchAll(/data-checklist-action="([a-z]+)"/g)].map((x) => x[1]);
const text = (html: string) => renderedText(html).replace(/\s+/g, " ");

describe("DocumentChecklist: the required documents on the Documents card (S-07 2c, spec 5.4)", () => {
  it("partial: the gaps in the list's order, each a dot AND its words, then the skipped item with Needed again (rule 3; mutation: drop the word, keep the dot -> FAILS)", () => {
    const html = render();
    const t = text(html);
    expect(t).toContain("Missing: ID");
    expect(t).toContain("Expired: Permit or license");
    expect(t).toContain("Checking: Warranty");
    expect(t).toContain("Photo · Not needed");
    expect(html.indexOf('data-checklist-item="id"')).toBeLessThan(html.indexOf('data-checklist-item="permit"'));
    expect(html.indexOf('data-checklist-item="permit"')).toBeLessThan(html.indexOf('data-checklist-item="warranty"'));
    expect(html.indexOf('data-checklist-item="warranty"')).toBeLessThan(html.indexOf('data-checklist-item="photo"'));
    // The met item is in the count, never a row.
    expect(html).not.toContain('data-checklist-item="insurance"');
    // The dots: warn for missing and checking, crit for expired.
    expect(rowOf(html, "id")).toMatch(/aria-hidden="true"[^>]*bg-\[var\(--warn\)\]/);
    expect(rowOf(html, "permit")).toMatch(/aria-hidden="true"[^>]*bg-\[var\(--crit\)\]/);
    expect(rowOf(html, "warranty")).toMatch(/aria-hidden="true"[^>]*bg-\[var\(--warn\)\]/);
    expect(actionsIn(rowOf(html, "photo"))).toEqual(["unskip"]);
    expect(text(rowOf(html, "photo"))).toContain("Needed again");
  });

  it("Missing and Expired offer Ask the customer, Upload and Not needed; a Checking row offers ONLY Not needed (M5; mutation: give Checking the Ask and Upload buttons -> FAILS)", () => {
    const html = render();
    expect(actionsIn(rowOf(html, "id"))).toEqual(["ask", "upload", "skip"]);
    expect(actionsIn(rowOf(html, "permit"))).toEqual(["ask", "upload", "skip"]);
    expect(actionsIn(rowOf(html, "warranty"))).toEqual(["skip"]);
    const id = text(rowOf(html, "id"));
    expect(id).toContain("Ask the customer");
    expect(id).toContain("Upload");
    expect(id).toContain("Not needed");
    expect(rowOf(html, "id")).toContain('data-checklist-category="id"');
  });

  it("draws NO meter: the count lives in the card's top row (D9; mutation: keep the meter line -> FAILS)", () => {
    const html = render();
    expect(text(html)).not.toContain("1 of 4");
    expect(html).not.toContain("data-requirements-meter");
  });

  it("every button is ghost (rule 8; mutation: Upload as primary -> FAILS)", () => {
    const html = render();
    expect(html).toContain('data-variant="ghost"');
    expect(html).not.toContain('data-variant="default"');
  });

  it("canSkip false draws neither Not needed nor Needed again (D1); canAsk false draws no Ask the customer (mutations: ignore canSkip / canAsk -> FAILS)", () => {
    expect(render()).toMatch(/<button[^>]*>Not needed</); // the positive control for the negative below
    const tech = render({ canSkip: false });
    // "Not needed" as a BUTTON: the skipped item's own words ("Photo · Not needed") are still shown to someone who cannot change it.
    expect(tech).not.toMatch(/<button[^>]*>Not needed</);
    expect(text(tech)).not.toContain("Needed again");
    expect(actionsIn(tech)).toEqual(["ask", "upload", "ask", "upload"]);
    expect(text(rowOf(tech, "photo"))).toContain("Photo · Not needed");
    const noAsk = render({ canAsk: false });
    expect(text(noAsk)).not.toContain("Ask the customer");
    expect(actionsIn(noAsk)).not.toContain("ask");
  });

  it("with the upload panel open, no row draws Upload or Ask the customer; Not needed stays (I6; mutation: ignore panelOpen -> FAILS)", () => {
    const html = render({ panelOpen: true });
    expect(actionsIn(html)).not.toContain("upload");
    expect(actionsIn(html)).not.toContain("ask");
    expect(actionsIn(rowOf(html, "id"))).toEqual(["skip"]);
    expect(actionsIn(rowOf(html, "photo"))).toEqual(["unskip"]);
  });

  it("complete: no gap rows, the skipped row still there with Needed again (D11; mutation: hide skipped rows when complete -> FAILS)", () => {
    const html = render({ load: COMPLETE });
    expect(html).not.toMatch(/data-checklist-state="(missing|expired|checking)"/);
    expect(text(rowOf(html, "photo"))).toContain("Photo · Not needed");
    expect(actionsIn(rowOf(html, "photo"))).toEqual(["unskip"]);
  });

  it("off (nothing required) renders nothing at all (mutation: draw an empty section -> FAILS)", () => {
    expect(render({ load: ready([]) })).toBe("");
  });

  it("loading is a skeleton line with no copy and no spinner; an error is an alert with its sentence and a ghost Retry (rule 5, rule 7; mutation: a spinner -> FAILS)", () => {
    const loading = render({ load: { kind: "loading" } });
    expect(loading).toContain("data-document-checklist");
    expect(loading).toContain('data-state="loading"');
    expect(loading).toContain('data-slot="skeleton"');
    expect(text(loading).trim()).toBe("");
    expect(loading).not.toContain("animate-spin");
    const error = render({ load: { kind: "error" } });
    expect(error).toContain('data-state="error"');
    expect(error).toContain('role="alert"');
    expect(text(error)).toContain("Couldn't load the list.");
    expect(error).toMatch(/data-variant="ghost"[^>]*>Retry</);
  });

  it("the ready section is marked on, and its buttons carry the focus ring and the phone's touch height (mutation: drop min-h-11 -> FAILS)", () => {
    const html = render();
    expect(html).toContain('data-state="on"');
    for (const tag of html.match(/<button[^>]*data-checklist-action[^>]*>/g)!) {
      expect(tag).toContain("min-h-11");
      expect(tag).toContain("focus-visible:ring-[3px]");
    }
  });

  it("Spanish (literals; mutation: an English word in the Spanish render -> FAILS)", () => {
    const html = render({ locale: "es" });
    const t = text(html);
    expect(t).toContain("Falta: Identificación");
    expect(t).toContain("Vencido: Permiso o licencia");
    expect(t).toContain("Revisando: Garantía");
    expect(t).toContain("Foto · No hace falta");
    expect(t).toContain("Hace falta otra vez");
    expect(t).toContain("Pedir al cliente");
    expect(t).toContain("Subir");
    expect(t).not.toContain("Upload");
    expect(text(render({ locale: "es", load: { kind: "error" } }))).toContain("No se pudo cargar la lista.");
  });

  it("paints no literal colour (tokens only; mutation: a hex class -> FAILS)", () => {
    expect(render()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("RequirementsMeter: 'Required 1 of 4' for the card's top row (D9, rule 1)", () => {
  it("partial: the label and the count, digits tabular (mutation: drop tabular-nums -> FAILS)", () => {
    const html = meter(PARTIAL);
    expect(html).toContain("data-requirements-meter");
    expect(html).toContain("tabular-nums");
    expect(text(html)).toContain("Required");
    expect(text(html)).toContain("1 of 4");
    // The label is in the Label role: mono, 10px, +0.14em, uppercase.
    expect(html).toMatch(/class="[^"]*font-mono[^"]*text-\[10px\][^"]*uppercase[^"]*tracking-\[0\.14em\][^"]*"[^>]*>Required</);
  });

  it("complete: a --good dot and Complete, no count (mutation: keep '1 of 1' when complete -> FAILS)", () => {
    const html = meter(COMPLETE);
    expect(text(html)).toContain("Complete");
    expect(text(html)).not.toContain(" of ");
    expect(html).toMatch(/aria-hidden="true"[^>]*bg-\[var\(--good\)\]/);
  });

  it("off, loading and error draw nothing (mutation: draw '0 of 0' when off -> FAILS)", () => {
    expect(meter(ready([]))).toBe("");
    expect(meter({ kind: "loading" })).toBe("");
    expect(meter({ kind: "error" })).toBe("");
  });

  it("Spanish: 'Requeridos', '1 de 4', 'Completo' (literals)", () => {
    expect(text(meter(PARTIAL, "es"))).toContain("Requeridos");
    expect(text(meter(PARTIAL, "es"))).toContain("1 de 4");
    expect(text(meter(COMPLETE, "es"))).toContain("Completo");
  });
});
