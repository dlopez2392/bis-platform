import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

// /no-access?reason=off is reached by a client whose account's access is
// switched off AND by one whose access was never turned on (an adopted
// half-created company starts off, review of D-087). Its copy has to be true
// for both, and stay distinct from reason=none (the invitation case, D-001).

const h = vi.hoisted(() => ({ acceptLanguage: null as string | null }));

vi.mock("@clerk/nextjs", () => ({
  SignOutButton: ({ children }: { children: ReactNode }) => createElement("span", null, children),
}));
vi.mock("@/components/auth-shell", () => ({
  AuthShell: ({ children }: { children: ReactNode }) => createElement("main", null, children),
}));
// S-10 T7 (spec §7 Q5): signed-out family, browser language only.
vi.mock("next/headers", () => ({
  headers: async () => new Headers(h.acceptLanguage ? { "accept-language": h.acceptLanguage } : {}),
}));

const { default: NoAccess } = await import("./page");
const text = async (reason?: string) =>
  renderedText(renderToStaticMarkup(await NoAccess({ searchParams: Promise.resolve({ reason }) })));

beforeEach(() => {
  h.acceptLanguage = null;
});

describe("/no-access", () => {
  it("reason=off says access isn't turned on, true whether it was switched off or never on (mutation: restore 'has been turned off' → FAILS)", async () => {
    const off = await text("off");
    expect(off).toContain(m["clientAccess.off.title"]);
    expect(off).toContain(m["clientAccess.off.body"]);
    expect(off).not.toMatch(/has been turned off/i);
    expect(off).toMatch(/isn.t turned on/i);
  });

  it("reason=none keeps its own copy, apart from off (D-001's distinction)", async () => {
    const none = await text("none");
    expect(none).toContain(m["clientAccess.none.title"]);
    expect(none).not.toContain(m["clientAccess.off.title"]);
  });

  it("a Spanish-ranked Accept-Language renders in Spanish (mutation: read m[...] directly → FAILS)", async () => {
    h.acceptLanguage = "es-MX,en;q=0.5";
    const off = await text("off");
    expect(off).toContain(m["clientAccess.off.title.es"]);
    expect(off).toContain(m["landing.signOut.es"]);
  });
});
