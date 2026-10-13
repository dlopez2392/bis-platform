import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SpanishBodyField, type SpanishBodyFieldProps } from "./spanish-body-field";

const base: SpanishBodyFieldProps = {
  idPrefix: "t", stored: { bodyEs: null, stale: false }, defaultEs: "Nuestro español.", composeEs: (x) => x, sms: true,
};
const html = (p: Partial<SpanishBodyFieldProps>) => renderToStaticMarkup(createElement(SpanishBodyField, { ...base, ...p }));

describe("SpanishBodyField (spec §12.2)", () => {
  it("opens with our Spanish when nothing is stored, marked lang=es (mutation: open empty -> FAILS)", () => {
    const out = html({});
    expect(out).toMatch(/<textarea[^>]*name="body_es"[^>]*lang="es"[^>]*>Nuestro español\.<\/textarea>|<textarea[^>]*lang="es"[^>]*name="body_es"[^>]*>Nuestro español\.<\/textarea>/);
  });
  it("opens with theirs when stored", () => {
    expect(html({ stored: { bodyEs: "Suyo.", stale: false } })).toContain(">Suyo.</textarea>");
  });
  it("stale: a dot AND the words, and the 'still matches' checkbox (rule 3; mutation: drop the words -> FAILS)", () => {
    const out = html({ stored: { bodyEs: "Viejo.", stale: true } });
    expect(out).toContain("The Spanish still says the old message. Update it to match your English.");
    expect(out).toContain('data-stale-dot');
    expect(out).toContain('name="body_es_still_matches"');
  });
  it("emptied: the English line and a GHOST Use our Spanish, never a second primary (rule 8; mutation: variant default -> FAILS)", () => {
    const out = html({ stored: { bodyEs: "", stale: false } });
    expect(out).toContain("Customers whose language is Spanish will get the English message.");
    expect(out).toMatch(/data-variant="ghost"[^>]*>Use our Spanish|>Use our Spanish<\/button>/);
    expect(out).not.toContain('data-variant="default"');
    expect(out).toMatch(/<button[^>]*type="button"/);   // never submits the card's form on its own
  });
  it("an empty default is not 'emptied' until stored '' (plan deviation 4; mutation: blank box alone -> FAILS)", () => {
    expect(html({ defaultEs: "" })).not.toContain("will get the English message");
    expect(html({ defaultEs: "", stored: { bodyEs: "", stale: false } })).toContain("will get the English message");
  });
  it("SMS: the accent line names both part counts; an email card has none (mutation: show it on email -> FAILS)", () => {
    const accented = "Aquí estamos, gracias por su visita. ".repeat(3);
    expect(html({ stored: { bodyEs: accented, stale: false } })).toMatch(/make this text cost \d+ parts instead of \d+\./);
    expect(html({ stored: { bodyEs: accented, stale: false }, sms: false })).not.toContain("make this text cost");
  });
});
