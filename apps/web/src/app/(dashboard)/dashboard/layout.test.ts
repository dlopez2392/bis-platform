import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * D-072: the workspace tab title fell back to `accounts.name` — the
 * agency's own private internal label ("Rio Roofing — trial") — whenever a
 * client's `brand_name` was blank. `generateMetadata` is the one function
 * this file's own default export needs for that: it runs independently of
 * the layout's React body (Clerk/next/headers/the whole shell), so it is
 * tested directly rather than through a render requiring all of that.
 */
const stateFixture = vi.hoisted(() => ({
  // `language` added (Task 6 fix round 1): DashboardLayout's own
  // requestLocale() call reads it straight off this fixture now.
  value: { status: "ok" as const, id: "acc_1", name: "Rio Roofing — trial", timezone: "America/Chicago", language: null as string | null },
}));
const brandingFixture = vi.hoisted(() => ({
  value: {
    brandName: null as string | null, brandLogoPath: null as string | null, brandColor: null,
    brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
  },
}));
vi.mock("@/lib/branding/tenant-theme-reader", () => ({
  getTenantAccessState: async () => stateFixture.value,
  getTenantBranding: async () => brandingFixture.value,
}));

// Task 6 fix round 1: the render body (unlike generateMetadata above) also
// calls Clerk's auth(), next/headers' cookies() and, on the agency branch,
// @bis/db's serviceDb()/listAccounts() — none of which the pre-existing
// tests in this file needed, since generateMetadata and the two source
// scans below never call the default export at all.
const authFixture = vi.hoisted(() => ({ isAgency: false }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({
    userId: "u1",
    sessionClaims: authFixture.isAgency
      ? { app_role: "agency_admin" }
      : { app_role: "client", org_id: "org_1" },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error(`UNEXPECTED_REDIRECT:${to}`); },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => ({}),
  listAccounts: async () => [],
}));

// M5 (whole-branch review): a passthrough spy, so a test can assert WHAT
// the layout asks requestLocale for — the real resolver still runs.
vi.mock("@/lib/i18n/request-locale", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n/request-locale")>();
  return { ...actual, requestLocale: vi.fn(actual.requestLocale) };
});

const { default: DashboardLayout, generateMetadata } = await import("./layout");
const { requestLocale } = await import("@/lib/i18n/request-locale");
const { AppSidebar } = await import("@/components/app-sidebar");
const { Topbar } = await import("@/components/topbar");
const { LocaleProvider } = await import("@/components/locale-provider");

describe("dashboard/layout generateMetadata — the tab title (D-072)", () => {
  beforeEach(() => {
    stateFixture.value = { status: "ok", id: "acc_1", name: "Rio Roofing — trial", timezone: "America/Chicago", language: null };
    brandingFixture.value = {
      brandName: null, brandLogoPath: null, brandColor: null,
      brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
    };
  });

  it("never falls back to accounts.name (the agency's private label) when unbranded (mutation: restore `?? state.name` → FAILS)", async () => {
    const meta = await generateMetadata();
    expect(meta.title).not.toBe("Rio Roofing — trial");
    // Omitted, not a made-up generic string: the root layout's own
    // "BIS Platform" title is what Next's metadata merging shows when a
    // nested generateMetadata names no title at all.
    expect(meta.title).toBeUndefined();
  });

  it("uses the real brand name once Branding sets one", async () => {
    brandingFixture.value = { ...brandingFixture.value, brandName: "Rio Roofing" };
    const meta = await generateMetadata();
    expect(meta.title).toBe("Rio Roofing");
  });

  it("returns no metadata at all for the agency or a caller with no resolvable tenant (unchanged)", async () => {
    stateFixture.value = { status: "none" } as unknown as typeof stateFixture.value;
    const meta = await generateMetadata();
    expect(meta).toEqual({});
  });
});

// D-072's other half: this layout used to pass AppSidebar the agency's own
// private account name as `clientAccountName`, the prop app-sidebar.test.ts
// pins as gone. No other call site exists (grep), so this is the only place
// the leak could be reintroduced.
describe("dashboard/layout — never passes the agency's private account name to AppSidebar (D-072)", () => {
  it("no longer wires a clientAccountName prop, in CODE (mutation: restore it → FAILS)", () => {
    const src = readFileSync(path.join(here, "layout.tsx"), "utf8");
    expect(src).not.toContain("clientAccountName");
  });

  // Minor, review round: the sidebar's own name prop used to read the raw
  // column (`branding?.brandName ?? undefined`) while the tab title (above)
  // went through brandDisplayName. Same function, same file, both surfaces.
  it("passes AppSidebar the SAME trimmed brandDisplayName the tab title uses, in CODE (mutation: revert to the raw column → FAILS)", () => {
    const src = readFileSync(path.join(here, "layout.tsx"), "utf8");
    expect(src).toContain('clientBrandName={branding ? brandDisplayName(branding) || undefined : undefined}');
  });
});

/**
 * Task 6 fix round 1. Reviewer's finding: AppSidebar and Topbar render in
 * THIS layout, as siblings of `<main>{children}</main>` — the original cut
 * of Task 6 mounted LocaleProvider one level down, in
 * [accountId]/layout.tsx, which wraps only `{children}`. That provider
 * never reaches the chrome, so `useLocale()` inside AppSidebar/Topbar
 * always read the context's default ("en") no matter the account's own
 * language — all 31 tests from that round stayed green because none of
 * them rendered the chrome together with the provider. This block is a
 * composition probe that does exactly that: it walks the ACTUAL element
 * tree this layout returns and asserts LocaleProvider (carrying the
 * resolved locale) is an ancestor of both AppSidebar and Topbar.
 */
function find(node: unknown, type: unknown): object[] {
  if (!node || typeof node !== "object" || !("type" in node)) {
    return Array.isArray(node) ? node.flatMap((n) => find(n, type)) : [];
  }
  const el = node as { type: unknown; props?: { children?: unknown } };
  return [
    ...(el.type === type ? [el] : []),
    ...find(el.props?.children, type),
  ];
}

describe("dashboard/layout mounts LocaleProvider as an ancestor of BOTH AppSidebar and Topbar (Task 6 fix round 1)", () => {
  beforeEach(() => {
    authFixture.isAgency = false;
    stateFixture.value = { status: "ok", id: "acc_1", name: "Rio Roofing — trial", timezone: "America/Chicago", language: null };
  });

  it("LocaleProvider wraps AppSidebar and Topbar, not only <main> (mutation: mount LocaleProvider only around <main> → FAILS — the composition probe below finds no shared ancestor)", async () => {
    const tree = await DashboardLayout({ children: "page" });
    const providers = find(tree, LocaleProvider) as { props: { children: unknown } }[];
    expect(providers.length).toBeGreaterThan(0);
    // Every LocaleProvider instance found must itself contain BOTH chrome
    // components as descendants — proving neither sits above it (a
    // provider mounted only around `<main>` would find AppSidebar/Topbar
    // ZERO times inside any LocaleProvider subtree, since both are its own
    // siblings, not descendants of <main>).
    for (const p of providers) {
      expect(find(p, AppSidebar).length).toBeGreaterThan(0);
      expect(find(p, Topbar).length).toBeGreaterThan(0);
    }
  });

  it("a client-role account with language=\"es\" resolves LocaleProvider's own locale prop to \"es\" (mutation: drop requestLocale/pass a literal \"en\" → FAILS)", async () => {
    stateFixture.value = { status: "ok", id: "acc_1", name: "Rio Roofing — trial", timezone: "America/Chicago", language: "es" };
    const tree = await DashboardLayout({ children: "page" });
    const providers = find(tree, LocaleProvider) as { props: { locale: string } }[];
    expect(providers.map((p) => p.props.locale)).toEqual(["es"]);
  });

  // M5 (whole-branch review): the old version of this test could not fail.
  // For the agency this layout never reads a tenant at all (clientState
  // stays null), so the locale came out "en" whatever isOperator said — its
  // named mutation ("drop isOperator") changed nothing it measured. The
  // wiring is what can regress, so the wiring is what is asserted: the
  // agency is resolved AS an operator, and a client is not.
  it("an operator (agency) session is resolved with isOperator: true and stays English (mutation: pass isOperator: false → FAILS on the requestLocale call)", async () => {
    authFixture.isAgency = true;
    stateFixture.value = { status: "ok", id: "acc_1", name: "Rio Roofing — trial", timezone: "America/Chicago", language: "es" };
    vi.mocked(requestLocale).mockClear();
    const tree = await DashboardLayout({ children: "page" });
    expect(vi.mocked(requestLocale)).toHaveBeenCalledWith(expect.objectContaining({ isOperator: true }));
    const providers = find(tree, LocaleProvider) as { props: { locale: string } }[];
    expect(providers.map((p) => p.props.locale)).toEqual(["en"]);
  });

  it("a client session is resolved with isOperator: false and its own account's language (mutation: pass isOperator: true → FAILS on the requestLocale call)", async () => {
    stateFixture.value = { status: "ok", id: "acc_1", name: "Rio Roofing — trial", timezone: "America/Chicago", language: "es" };
    vi.mocked(requestLocale).mockClear();
    await DashboardLayout({ children: "page" });
    expect(vi.mocked(requestLocale)).toHaveBeenCalledWith({ account: { language: "es" }, isOperator: false });
  });

  // Decision D (orchestrator, 2026-10-10): `lang` sits only on the parts that
  // are actually Spanish — the sidebar's <nav>, the topbar presence and the
  // dashboard KPI row — never on the shell around them, most of which (the
  // account switcher, the search, the Clerk menus) is still English.
  it("puts no lang attribute on the shell, even for a Spanish account (decision D; mutation: restore lang={locale} on the shell's outer div → FAILS)", async () => {
    stateFixture.value = { status: "ok", id: "acc_1", name: "Rio Roofing — trial", timezone: "America/Chicago", language: "es" };
    const tree = await DashboardLayout({ children: "page" });
    const withLang = (node: unknown): object[] => {
      if (!node || typeof node !== "object") return [];
      if (Array.isArray(node)) return node.flatMap(withLang);
      if (!("type" in node)) return [];
      const props = (node as { props?: { lang?: string; children?: unknown } }).props;
      return [...(props?.lang !== undefined ? [node] : []), ...withLang(props?.children)];
    };
    expect(withLang(tree)).toEqual([]);
  });
});
