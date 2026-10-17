import { describe, it, expect, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderedText } from "@/lib/rendered-text";
import type { Locale } from "@/lib/i18n/locale";
import type { ForwardingView } from "@/lib/email/inbound/forwarding-view";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// "use server": never imported into vitest unmocked (constraints §16). The row only wires it.
vi.mock("./forwarding-actions", () => ({ getForwardingAddressAction: vi.fn() }));

const { LocaleProvider } = await import("@/components/locale-provider");
const { ForwardingAddressRow } = await import("./forwarding-address-row");

const ADDRESS = "r-0123456789abcdef01234567@reply.bis-rgv.com";
const render = (view: ForwardingView, locale: Locale) =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>,
    createElement(ForwardingAddressRow, { view, accountId: "a1", contactId: "c1" })));

describe("ForwardingAddressRow (S-06 part 2, spec §1): one row in Details, every state the server decided", () => {
  it("address, English: the label, the address, a ghost Copy and the hint (mutation: render the hint only for es → FAILS)", () => {
    const html = render({ kind: "address", address: ADDRESS }, "en");
    expect(html).toContain('data-forwarding-row="address"');
    const text = renderedText(html);
    expect(text).toContain("Forwarding address");
    expect(text).toContain(ADDRESS);
    expect(text).toContain("Copy");
    expect(text).toContain("Forward an email here to save it on this customer.");
    expect(html).toContain('aria-label="Copy the forwarding address"');
    // Rule 8: Copy is ghost; the record header's Call stays the one primary.
    expect(html).toMatch(/data-slot="button" data-variant="ghost"/);
    expect(html).not.toContain('data-variant="default"');
    expect(html).toContain("min-h-11 md:min-h-8");
  });

  it("address, Spanish (mutation: hard-code the English locale → FAILS)", () => {
    const html = render({ kind: "address", address: ADDRESS }, "es");
    const text = renderedText(html);
    expect(text).toContain("Dirección para reenviar");
    expect(text).toContain(ADDRESS);
    expect(text).toContain("Copiar");
    expect(text).toContain("Reenvíe un correo a esta dirección para guardarlo con este cliente.");
    expect(html).toContain('aria-label="Copiar la dirección para reenviar"');
  });

  it("turnOn: the agency is told how to get one, with no address and no Copy, in both languages", () => {
    const en = render({ kind: "turnOn" }, "en");
    expect(en).toContain('data-forwarding-row="turnOn"');
    expect(renderedText(en)).toContain("Turn on Replies in Settings to get a forwarding address");
    expect(en).not.toContain('data-slot="button"');
    const es = renderedText(render({ kind: "turnOn" }, "es"));
    expect(es).toContain("Active Respuestas en Ajustes para obtener una dirección para reenviar");
    // "Configuración" is Setup in this app; Settings is "Ajustes" (review).
    expect(es).not.toContain("Configuración");
  });

  it("get: no address yet, so one ghost button makes it, in both languages, and nothing is shown as an address (owner ruling 2026-10-17; mutation: render the address kind's hint here -> FAILS)", () => {
    const en = render({ kind: "get" }, "en");
    expect(en).toContain('data-forwarding-row="get"');
    expect(renderedText(en)).toContain("Forwarding address");
    expect(renderedText(en)).toContain("Get forwarding address");
    expect(en).toMatch(/data-slot="button" data-variant="ghost"/);
    expect(en).not.toContain('data-variant="default"');
    expect(en).toContain("min-h-11 md:min-h-8");
    expect(en).not.toContain("@");
    expect(renderedText(en)).not.toContain("Forward an email here to save it on this customer.");
    expect(renderedText(render({ kind: "get" }, "es"))).toContain("Obtener dirección para reenviar");
  });

  it("get's wiring: the button runs the crash-safe handler with the record's own action for THIS account and customer, then shows the address (constraints §13; mutation: call the action directly -> FAILS)", () => {
    const src = readFileSync(path.resolve(__dirname, "./forwarding-address-row.tsx"), "utf8");
    expect(src).toMatch(/import\s*\{[^}]*\bgetForwardingAddress\b[^}]*\}\s*from\s*"\.\/forwarding-copy"/);
    expect(src).toMatch(/getForwardingAddress\(\s*\(\)\s*=>\s*getForwardingAddressAction\(accountId, contactId\)/);
    // The action is reached ONLY through the handler: exactly one call site, inside it.
    expect(src.match(/getForwardingAddressAction\(/g)).toHaveLength(1);
    expect(src).toMatch(/setAddress\(/);
  });

  it("failed: an alert that says what to do, in both languages (rule 5's error state)", () => {
    const en = render({ kind: "failed" }, "en");
    expect(en).toContain('data-forwarding-row="failed"');
    expect(en).toMatch(/<p role="alert"[^>]*>We couldn&#x27;t load the forwarding address/);
    expect(renderedText(en)).toContain("We couldn't load the forwarding address. Reload the page to try again.");
    expect(en).not.toContain('data-slot="button"');
    const es = render({ kind: "failed" }, "es");
    expect(es).toContain('role="alert"');
    expect(renderedText(es)).toContain("No pudimos cargar la dirección para reenviar. Vuelva a cargar la página para intentarlo de nuevo.");
  });

  it("none: nothing at all, not even the label (mutation: render a label for none → FAILS)", () => {
    expect(render({ kind: "none" }, "en")).toBe("");
    expect(render({ kind: "none" }, "es")).toBe("");
  });

  it("tokens only: no hex and no literal radius in the row's source (DESIGN.md DoD)", () => {
    const src = readFileSync(path.resolve(__dirname, "./forwarding-address-row.tsx"), "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/rounded-(?!\[var\(--radius-(ctl|card)\)\]|full)/);
    expect(src).toMatch(/^"use client";/);
  });
});
