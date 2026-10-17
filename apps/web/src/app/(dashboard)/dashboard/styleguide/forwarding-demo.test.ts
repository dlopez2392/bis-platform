import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../accounts/[accountId]/contacts/[contactId]/forwarding-actions", () => ({ getForwardingAddressAction: vi.fn() }));

const { ForwardingDemo } = await import("./forwarding-demo");

describe("styleguide: the record's Forwarding address row (DoD: /styleguide gains the new component)", () => {
  const html = renderToStaticMarkup(createElement(ForwardingDemo));
  const cell = (id: string) => html.match(new RegExp(`<dl[^>]*data-forwarding-demo="${id}"[^>]*>([\\s\\S]*?)</dl>`))?.[1] ?? null;

  it("every kind the server can hand the row: address, get, turn on, failed, and none, which draws nothing (mutation: drop a kind -> FAILS)", () => {
    expect(html).toContain('data-testid="styleguide-forwarding"');
    expect(cell("address")).toContain('data-forwarding-row="address"');
    expect(cell("get")).toContain('data-forwarding-row="get"');
    expect(cell("turnOn")).toContain('data-forwarding-row="turnOn"');
    expect(cell("failed")).toContain('data-forwarding-row="failed"');
    expect(cell("none")).toBe("");
    expect(renderedText(cell("address")!)).toContain("Forward an email here to save it on this customer.");
    expect(renderedText(cell("get")!)).toContain("Get forwarding address");
  });

  it("the address and get kinds in Spanish, under lang=es (mutation: render the Spanish cells in English -> FAILS)", () => {
    expect(html).toMatch(/<dl[^>]*lang="es"[^>]*data-forwarding-demo="address-es"/);
    expect(html).toMatch(/<dl[^>]*lang="es"[^>]*data-forwarding-demo="get-es"/);
    const es = renderedText(cell("address-es")!);
    expect(es).toContain("Dirección para reenviar");
    expect(es).toContain("Reenvíe un correo a esta dirección para guardarlo con este cliente.");
    expect(renderedText(cell("get-es")!)).toContain("Obtener dirección para reenviar");
  });
});
