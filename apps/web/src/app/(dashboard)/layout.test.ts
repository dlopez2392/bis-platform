// S-10 T7 (spec §6 T7, §7 Q5). G8 itself (the pure locale helper) is tested
// directly in lib/i18n/accept-language.test.ts; this file exercises the
// root layout's OWN wiring of real inputs into that helper — auth(),
// resolveClientAccessState(), getPersonPrefs() and the Accept-Language
// header — the same mocking shape dashboard/layout.test.ts already uses for
// its own render-body cases.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({
  userId: null as string | null,
  clientState: { status: "none" as const },
  userLanguage: null as string | null,
  acceptLanguage: null as string | null,
}));

vi.mock("next/font/google", () => {
  const stub = () => ({ variable: "--font-stub" });
  return { Bricolage_Grotesque: stub, Geist: stub, Geist_Mono: stub, Inter: stub, Source_Serif_4: stub };
});
vi.mock("@clerk/nextjs", () => ({ ClerkProvider: ({ children }: { children: unknown }) => children }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: h.userId }) }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(h.acceptLanguage ? { "accept-language": h.acceptLanguage } : {}),
}));
vi.mock("@/components/theme-provider", () => ({ ThemeProvider: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/activate-sole-organization", () => ({ ActivateSoleOrganization: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/lib/branding/tenant-theme-reader", () => ({
  getRequestTheme: async () => ({ inputs: null, serverMode: "light", providerDefault: "light", userTheme: null }),
}));
vi.mock("@/lib/branding/theme", () => ({ deriveTheme: () => null }));
vi.mock("@/lib/branding/theme-style", () => ({ themeStyle: () => ({}) }));
vi.mock("@/lib/auth", () => ({ resolveClientAccessState: async () => h.clientState }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: h.userLanguage, theme: null }) }));

const { default: RootLayout } = await import("./layout");

async function htmlLang(): Promise<string | null> {
  const html = renderToStaticMarkup(await RootLayout({ children: "x" }) as Parameters<typeof renderToStaticMarkup>[0]);
  return html.match(/<html[^>]*\blang="([^"]*)"/)?.[1] ?? null;
}

beforeEach(() => {
  h.userId = null;
  h.clientState = { status: "none" };
  h.userLanguage = null;
  h.acceptLanguage = null;
});

describe("the root layout's <html lang> (S-10 T7, G8)", () => {
  it("signed out, no Accept-Language: English", async () => {
    expect(await htmlLang()).toBe("en");
  });

  it("signed out, a Spanish-ranked Accept-Language: es (mutation: drop the signed-out branch → FAILS)", async () => {
    h.acceptLanguage = "es-MX,en;q=0.5";
    expect(await htmlLang()).toBe("es");
  });

  it("signed in, the person's own stored language wins outright, no header consulted", async () => {
    h.userId = "user_1";
    h.userLanguage = "es";
    h.acceptLanguage = "en-US";
    expect(await htmlLang()).toBe("es");
  });

  it("signed in, no stored preference: English, even with a Spanish header (session wins, Q5)", async () => {
    h.userId = "user_1";
    h.userLanguage = null;
    h.acceptLanguage = "es-MX";
    expect(await htmlLang()).toBe("en");
  });

  it("a signed-in CLIENT with no stored preference inherits their account's language (mutation: pass account: null unconditionally → FAILS)", async () => {
    h.userId = "user_1";
    h.userLanguage = null;
    h.clientState = { status: "ok", id: "acc_1", name: "Rio", timezone: "America/Chicago", language: "es" } as never;
    expect(await htmlLang()).toBe("es");
  });
});
