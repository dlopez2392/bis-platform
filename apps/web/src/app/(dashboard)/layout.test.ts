// S-10 T7 (spec §6 T7, orchestrator split 2026-11-01). The root layout wraps
// EVERY route, including /sign-in and /no-access, and paths outside the
// proxy matcher where a bare auth() throws. So its <html lang> makes NO
// session, account or preference read: it stays "en" for every request. The
// signed-out pages set their own `lang` on AuthShell's <main> from
// Accept-Language (auth-shell.test.ts); the signed-in <html lang> is T9's.
//
// Every session/DB reader below is mocked to THROW: if the layout ever calls
// one again, rendering it throws and these cases fail by name. The ONE
// exception is getRequestTheme, stubbed to return: it is the theme path the
// layout already had (it reads the session itself, unchanged by T7), so this
// file proves "no NEW read for lang", not "no session read at all".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({
  acceptLanguage: null as string | null,
  reads: [] as string[],
}));

function forbidden(name: string): never {
  h.reads.push(name);
  throw new Error(`root layout must not call ${name}`);
}

vi.mock("next/font/google", () => {
  const stub = () => ({ variable: "--font-stub" });
  return { Bricolage_Grotesque: stub, Geist: stub, Geist_Mono: stub, Inter: stub, Source_Serif_4: stub };
});
vi.mock("@clerk/nextjs", () => ({ ClerkProvider: ({ children }: { children: unknown }) => children }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => forbidden("auth"),
  currentUser: async () => forbidden("currentUser"),
}));
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
vi.mock("@/lib/auth", () => ({
  resolveClientAccessState: async () => forbidden("resolveClientAccessState"),
  requireAccountAccess: async () => forbidden("requireAccountAccess"),
}));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => forbidden("getPersonPrefs") }));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => forbidden("dbForRequest"),
  serviceDb: () => forbidden("serviceDb"),
}));

const { default: RootLayout } = await import("./layout");

async function htmlLang(): Promise<string | null> {
  const html = renderToStaticMarkup((await RootLayout({ children: "x" })) as Parameters<typeof renderToStaticMarkup>[0]);
  return html.match(/<html[^>]*\blang="([^"]*)"/)?.[1] ?? null;
}

beforeEach(() => {
  h.acceptLanguage = null;
  h.reads = [];
});

describe("the root layout's <html lang> makes no session or DB read (S-10 T7 split)", () => {
  it("renders lang=\"en\" while every session, account and preference reader throws", async () => {
    expect(await htmlLang()).toBe("en");
    expect(h.reads).toEqual([]);
  });

  it("stays lang=\"en\" under a Spanish-ranked Accept-Language (AuthShell's <main> carries the signed-out lang, not <html>)", async () => {
    h.acceptLanguage = "es-MX,en;q=0.5";
    expect(await htmlLang()).toBe("en");
    expect(h.reads).toEqual([]);
  });
});
