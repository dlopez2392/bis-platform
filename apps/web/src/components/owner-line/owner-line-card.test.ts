import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The owner-line cards' markup (design review Important 3, minors; final review M-4). The card is a client
 * component: useRouter is stubbed (no App Router is mounted in a unit test) and the markup is the server render.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { OwnerLineCard } = await import("./owner-line-card");
const { OwnerLineCode } = await import("./owner-line-code");
const { OwnerLineSwitchCard } = await import("./owner-line-switch-card");

const ok = async () => ({ ok: true as const, value: null });
const card = (locale: "en" | "es") => renderToStaticMarkup(createElement(OwnerLineCard, {
  accountId: "a1", businessName: "Rio Roofing", number: "956-555-0100", locale, pseudo: false, verifyMinutes: 10,
  view: { step: "cell", cell: null, status: { key: null, params: {} } },
  startVerification: async () => ({ ok: true as const, value: { code: "123456", expiresAt: "2026-11-09T20:00:00Z" } }),
  setPin: ok, removePin: ok, removeCell: ok,
}));

describe("OwnerLineCard and OwnerLineSwitchCard carry their own lang (design minors; mutation: drop lang -> FAILS)", () => {
  it("the setup card says which language it is in", () => {
    expect(card("es")).toMatch(/^<div[^>]*\blang="es"[^>]*data-owner-line-card="a1"|^<div[^>]*data-owner-line-card="a1"[^>]*\blang="es"/);
    expect(card("en")).toMatch(/^<div[^>]*\blang="en"/);
  });
  it("the switch card says which language it is in", () => {
    const html = renderToStaticMarkup(createElement(OwnerLineSwitchCard, {
      state: { enabledAt: null, changedAt: null, changedByKind: null }, viewer: "owner", locale: "es", zone: "America/Chicago",
      pseudo: false, setSwitch: async () => ({ ok: false as const, error: "x" }),
    }));
    expect(html).toMatch(/^<div[^>]*\blang="es"/);
  });
});

describe("OwnerLineCode: the call-in code has an accessible name (final review M-4)", () => {
  const html = (minutes: number, locale: "en" | "es" = "en") =>
    renderToStaticMarkup(createElement(OwnerLineCode, { accountId: "a1", code: "123456", number: "956-555-0100", minutes, locale, pseudo: false }));

  it("names the code with VISIBLE label text, in a group labelled by it, never an aria-label on a <p> (mutation: put aria-label back on the <p> -> FAILS)", () => {
    const out = html(10);
    expect(out).not.toMatch(/<p[^>]*aria-label=/);
    const group = /<div[^>]*role="group"[^>]*aria-labelledby="([^"]+)"/.exec(out);
    expect(group, out).not.toBeNull();
    expect(out).toContain(`id="${group![1]}"`);
    expect(out).toMatch(new RegExp(`id="${group![1]}"[^>]*>Your code<`));
    expect(out).toContain(">123456<");
  });

  it("says how long the code works from the expiry it was given, never a hard-coded 10 (mutation: hard-code the copy -> FAILS)", () => {
    expect(html(15)).toContain("It works for 15 minutes.");
    expect(html(15, "es")).toContain("Sirve por 15 minutos.");
  });
});

describe("OwnerLineCard: 'Stop calling in' survives the page closing (design review Important 3)", () => {
  const src = readFileSync(new URL("./owner-line-card.tsx", import.meta.url), "utf8");
  it("the deferred removal is the pagehide-flushed controller on window, with the toast's duration from it (mutation: inline the old undone flag -> FAILS)", () => {
    expect(src).toMatch(/deferredRemoval\(\s*\(\)\s*=>[\s\S]*?,\s*window\s*\)/);
    expect(src).toMatch(/duration:\s*STOP_CALLING_IN_UNDO_MS/);
    expect(src).toMatch(/onAutoClose:\s*removal\.settle/);
    expect(src).toMatch(/onDismiss:\s*removal\.settle/);
    expect(src).not.toMatch(/let undone/);
  });
});
