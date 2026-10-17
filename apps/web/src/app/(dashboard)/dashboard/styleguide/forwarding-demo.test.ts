import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ForwardingDemo } = await import("./forwarding-demo");

describe("styleguide: the record's Forwarding address row (DoD: /styleguide gains the new component)", () => {
  const html = renderToStaticMarkup(createElement(ForwardingDemo));
  const cell = (id: string) => html.match(new RegExp(`<dl[^>]*data-forwarding-demo="${id}"[^>]*>([\\s\\S]*?)</dl>`))?.[1] ?? null;

  it("every kind the server can hand the row: address, turn on, failed, and none, which draws nothing (mutation: drop a kind -> FAILS)", () => {
    expect(html).toContain('data-testid="styleguide-forwarding"');
    expect(cell("address")).toContain('data-forwarding-row="address"');
    expect(cell("turnOn")).toContain('data-forwarding-row="turnOn"');
    expect(cell("failed")).toContain('data-forwarding-row="failed"');
    expect(cell("none")).toBe("");
    expect(renderedText(cell("address")!)).toContain("Forward an email here to save it on this customer.");
  });

  it("the address kind in Spanish, under lang=es (mutation: render the Spanish cell in English -> FAILS)", () => {
    expect(html).toMatch(/<dl[^>]*lang="es"[^>]*data-forwarding-demo="address-es"|<dl[^>]*data-forwarding-demo="address-es"[^>]*lang="es"/);
    const es = renderedText(cell("address-es")!);
    expect(es).toContain("Dirección para reenviar");
    expect(es).toContain("Reenvíe un correo a esta dirección para guardarlo con este cliente.");
  });
});
