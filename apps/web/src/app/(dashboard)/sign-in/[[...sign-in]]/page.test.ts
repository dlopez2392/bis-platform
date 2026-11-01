// S-10 T7 (spec §6 T7, §7 Q5/Q6): /sign-in's own words follow the browser's
// Accept-Language (nobody is authenticated here); Clerk's own widget stays
// English, marked lang="en".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const h = vi.hoisted(() => ({ acceptLanguage: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(h.acceptLanguage ? { "accept-language": h.acceptLanguage } : {}),
}));
vi.mock("@clerk/nextjs", () => ({
  SignIn: () => createElement("div", { "data-slot": "clerk-sign-in" }, "Clerk form"),
}));
vi.mock("@/components/auth-shell", () => ({
  AuthShell: ({ children, locale }: { children: React.ReactNode; locale?: string }) =>
    createElement("main", { lang: locale }, children),
}));

const { default: Page } = await import("./page");

beforeEach(() => {
  h.acceptLanguage = null;
});

describe("/sign-in resolves its locale from Accept-Language", () => {
  it("no header (Playwright's own default, and every existing probe's case): renders English", async () => {
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("Sign in");
    // <main lang>, not just any lang="en": Clerk's own wrapper always carries
    // lang="en" (Q6), so a bare toContain could never fail.
    expect(html).toMatch(/<main lang="en"/);
  });

  it("a Spanish-ranked header: the heading is Spanish (mutation: read m[...] directly → FAILS)", async () => {
    h.acceptLanguage = "es-MX,en;q=0.5";
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("Iniciar sesión");
    expect(html).toMatch(/<main lang="es"/);
  });

  it("Clerk's own widget is wrapped in lang=\"en\" even on a Spanish page (mutation: drop the wrapper → FAILS)", async () => {
    h.acceptLanguage = "es-MX";
    const html = renderToStaticMarkup(await Page());
    const clerkIdx = html.indexOf('data-slot="clerk-sign-in"');
    expect(clerkIdx).toBeGreaterThan(-1);
    // The nearest lang= before the Clerk slot must be "en", not the page's "es".
    const before = html.slice(0, clerkIdx);
    const lastLang = before.match(/lang="(en|es)"/g)?.pop();
    expect(lastLang).toBe('lang="en"');
  });
});
