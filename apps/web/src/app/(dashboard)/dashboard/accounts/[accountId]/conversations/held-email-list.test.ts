import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("./inbound-actions", () => ({
  fileHeldEmailAction: vi.fn(),
  dismissHeldEmailAction: vi.fn(),
  undoHeldEmailAction: vi.fn(),
}));

const { HeldEmailList: List } = await import("./held-email-list");
type HeldItemView = import("./held-email-list").HeldItemView;

const ITEM: HeldItemView = { id: "ie_1", fromName: "Luis", fromEmail: "luis@example.com", subject: "Re: Your appointment", excerpt: "Is Thursday ok?", receivedAt: "2026-10-16T15:00:00.000Z", reason: "not_on_record", suggestion: { contactId: "ana", name: "Ana Ruiz" } };
const html = (items: HeldItemView[], locale: "en" | "es") => renderToStaticMarkup(createElement(List, { accountId: "a", items, locale, timezone: "America/Chicago" }));

describe("HeldEmailList (spec 'Needs a look')", () => {
  it("each item: sender, subject, time, the reason as a dot and words, the suggestion, ONE primary (mutation: Not a customer as default → two primaries, FAILS)", () => {
    const en = html([ITEM, { ...ITEM, id: "ie_2", reason: "unverified", subject: null }], "en");
    expect(en.match(/data-held-item=/g)).toHaveLength(2);
    expect(en.match(/data-variant="default"/g)).toHaveLength(2);        // one per item
    expect(renderedText(en)).toContain("Luis");
    expect(renderedText(en)).toContain("luis@example.com");
    expect(renderedText(en)).toContain("Re: Your appointment");
    expect(renderedText(en)).toContain("(no subject)");
    expect(en).toMatch(/data-held-reason="not_on_record"[^>]*>\s*<span[^>]*data-dot/);
    expect(renderedText(en)).toContain("Not on this customer's record");
    expect(renderedText(en)).toContain("Couldn't confirm who sent it");
    expect(renderedText(en)).toContain("A reply to an email sent to Ana Ruiz");
    expect(renderedText(en)).toContain("Choose a record");
    expect(renderedText(en)).toContain("Not a customer");
  });

  it("the primary button's own TEXT is exactly 'File on <name>' (coordinator minor; mutation: pass only the count, not the string -> FAILS)", () => {
    const en = html([ITEM], "en");
    const primary = en.match(/<button[^>]*data-variant="default"[^>]*>([\s\S]*?)<\/button>/)!;
    expect(renderedText(primary[1]!).trim()).toBe("File on Ana Ruiz");
  });

  it("a sender with no display name shows the address ONCE, never twice (coordinator minor; mutation: render fromEmail in both slots -> FAILS)", () => {
    const en = html([{ ...ITEM, fromName: null }], "en");
    expect(en.match(/luis@example\.com/g)).toHaveLength(1);
  });

  it("every item carries lang for its own render locale (coordinator round 1, item 4; mutation: drop lang -> FAILS)", () => {
    expect(html([ITEM], "es")).toMatch(/data-held-item="ie_1" lang="es"/);
  });

  it("Spanish (mutation: an English string in the es render → FAILS)", () => {
    const es = renderedText(html([ITEM], "es"));
    for (const s of ["No está en el registro de este cliente", "Respuesta a un correo enviado a Ana Ruiz", "Archivar con Ana Ruiz", "Elegir un registro", "No es un cliente"]) expect(es).toContain(s);
  });

  it("empty: the one sentence that sells it (rule 5; mutation: render nothing → FAILS)", () => {
    expect(renderedText(html([], "en"))).toContain("Emails we couldn't match to a customer wait here for you to file.");
    expect(renderedText(html([], "es"))).toContain("Aquí esperan los correos que no pudimos vincular con un cliente, para que usted los archive.");
  });

  it("the empty state carries lang for its own render locale (coordinator round 1, item 4; mutation: drop lang -> FAILS)", () => {
    expect(html([], "es")).toMatch(/lang="es"/);
  });
});
