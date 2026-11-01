import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { LocaleProvider } from "@/components/locale-provider";

/**
 * S-10 T3: the wizard's own screen (spec row 12's "English only") read m[...] directly on every
 * phase. `useState`'s FIRST call (the wizard's own `phase`) is overridden per test so the "map"/
 * preview phase — otherwise reached only by simulating a real file input, which react-dom/server
 * cannot do — renders directly; every other `useState` call keeps its real initial value.
 */
let phaseOverride: unknown;
let headersOverride: string[] | undefined;
// `call` is reset per render (not per test) via `callCounter`, shared with the mock factory
// through vi.hoisted — a plain module-scope `let` here would run AFTER the hoisted vi.mock call.
// ImportWizard's own useState calls, in source order: phase (1), headers (2), rows (3),
// mapping (4), createTags (5), fileError (6).
const callCounter = vi.hoisted(() => ({ n: 0 }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => {
      callCounter.n += 1;
      const real = () => (typeof init === "function" ? (init as () => unknown)() : init);
      const value = callCounter.n === 1 && phaseOverride !== undefined ? phaseOverride
        : callCounter.n === 2 && headersOverride !== undefined ? headersOverride
        : real();
      return [value, vi.fn()];
    },
  };
});
vi.mock("@/lib/forms/use-form-submit", () => ({ useFormSubmit: () => ({ pending: false, onSubmit: () => {} }) }));

const { ImportWizard } = await import("./import-wizard");

function render(locale: "en" | "es", existingTags: string[] = []) {
  callCounter.n = 0;
  return renderToStaticMarkup(
    createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, createElement(ImportWizard, { accountId: "a1", existingTags })),
  );
}

beforeEach(() => { phaseOverride = undefined; headersOverride = undefined; });

describe("ImportWizard in the reader's language (S-10 T3)", () => {
  it("the choose screen reads Spanish (mutation: read m[...] directly -> FAILS)", () => {
    const html = render("es");
    expect(html).toContain(m["contacts.import.intro.es"]);
    expect(html).toContain(m["contacts.import.drop.es"]);
    expect(html).not.toContain(m["contacts.import.intro"]);
  });
  it("the choose screen reads English by default", () => {
    const html = render("en");
    expect(html).toContain(m["contacts.import.intro"]);
    expect(html).toContain(m["contacts.import.drop"]);
  });
  it("the map/preview screen reads Spanish, including the plural forms (mutation: read m[...] directly -> FAILS)", () => {
    phaseOverride = { name: "map" };
    headersOverride = ["Email"];
    const html = render("es", []);
    expect(html).toContain(m["contacts.import.mapTitle.es"]);
    expect(html).toContain(m["contacts.import.ignore.es"]);
    expect(html).toContain(m["contacts.import.confirm.es"]);
    // No rows parsed in this test (no file chosen): 0 mapped rows reads the plural form's own "0" case.
    expect(html).toContain(m["contacts.import.preview.es"].replace("{count}", "0"));
    expect(html).not.toContain(m["contacts.import.mapTitle"]);
  });

  // S-10 leftovers (#317 follow-up, item 1): the mapping dropdown's own options read
  // IMPORT_FIELDS' raw ids ("first_name", "email", ...) instead of a readable label, in
  // either language.
  it("the mapping dropdown's options read readable labels, not the raw IMPORT_FIELDS ids (mutation: render {field} directly -> FAILS)", () => {
    phaseOverride = { name: "map" };
    headersOverride = ["Email"];
    const en = render("en", []);
    expect(en).toContain(`>${m["contacts.firstName"]}<`);
    expect(en).toContain(`>${m["contact.tags"]}<`);
    expect(en).not.toContain(">first_name<");
    expect(en).not.toContain(">company_name<");
    const es = render("es", []);
    expect(es).toContain(`>${m["contacts.firstName.es"]}<`);
    expect(es).toContain(`>${m["contact.tags.es"]}<`);
    expect(es).not.toContain(">first_name<");
  });
  it("the done screen reads Spanish, including the business notes and the per-count verb agreement (S-10 leftovers item 5; mutation: hard-code en in importBusinessNotes -> FAILS)", () => {
    // created=2 (plural "se agregaron"), updated=1 (singular "se actualizó") — the mixed case
    // a single two-placeholder template could never say correctly in Spanish.
    phaseOverride = { name: "done", totals: { created: 2, updated: 1, flagged: 0, businessTooLong: 1, businessLinkFailed: false } };
    const html = render("es");
    expect(html).toContain("Se agregaron 2, se actualizó 1");
    expect(html).toContain(m["contacts.import.businessTooLongOne.es"]);
    expect(html).toContain(m["contacts.import.back.es"]);
  });

  it("the done screen's flagged count agrees at 1 in Spanish (S-10 leftovers item 5; mutation: always use the plural Spanish form -> FAILS)", () => {
    phaseOverride = { name: "done", totals: { created: 1, updated: 0, flagged: 1, businessTooLong: 0, businessLinkFailed: false } };
    const html = render("es");
    expect(html).toContain(m["contacts.import.flaggedOne.es"]);
    expect(html).not.toContain(m["contacts.import.flagged.es"].replace("{flagged}", "1"));
  });
  it("the stopped screen reads Spanish (mutation: read m[...] directly -> FAILS)", () => {
    phaseOverride = { name: "stopped", done: 3, error: "boom" };
    const html = render("es");
    expect(html).toContain(m["contacts.import.partial.es"].replace("{done}", "3"));
    expect(html).toContain(m["contacts.import.back.es"]);
  });
});
