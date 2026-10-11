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

// Mis preferencias: the person's own language, from the one per-request read.
const prefsFixture = vi.hoisted(() => ({ language: null as "en" | "es" | null }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: prefsFixture.language, theme: null }) }));

// Staff and roles, merged with main (#234): the render body now also settles
// the caller's Owner/Staff role for a client. Stubbed so the render tests
// never reach the database or Clerk's backend.
const roleFixture = vi.hoisted(() => ({ value: "staff" as "owner" | "staff" | "technician" | null }));
vi.mock("@/lib/team/ensure-role", () => ({
  ensureAccountRole: async () => roleFixture.value,
  readStoredRole: async () => roleFixture.value,
}));

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

// Staff and roles (Task 8): isOwner is settled via the same cached
// ensureAccountRole call requireAccountAccess makes later in the request,
// and threaded to BOTH AppSidebar (the footer's Team link) and CommandPalette
// (its own Team entries) — never hardcoded, never derived from isAgency
// alone. Source-only: a render test would need Clerk/next/headers/the whole
// shell mocked for no payoff beyond what these pins already cover.
describe("dashboard/layout — computes isOwner via ensureAccountRole and threads it to AppSidebar and CommandPalette (staff and roles)", () => {
  // F-085 part 1: the layout keeps the ROLE (Owner, Staff or Technician)
  // rather than collapsing it to isOwner, and derives both flags from it.
  it("settles the role from ensureAccountRole keyed on the client's own account/org, only when resolved \"ok\", and derives isOwner and isTechnician from it (mutation: hardcode isOwner to isAgency, or drop the status === \"ok\" guard → FAILS)", () => {
    const src = readFileSync(path.join(here, "layout.tsx"), "utf8");
    expect(src).toContain('clientState?.status === "ok" && claims.org_id');
    expect(src).toContain(
      '? ensureAccountRole(clientState.id, claims.org_id, userId, readStoredRole(clientState.id, userId))\n',
    );
    expect(src).toContain('const isOwner = role === "owner";');
    expect(src).toContain('const isTechnician = !isAgency && role !== "owner" && role !== "staff";');
  });

  // Fix round 1, I1: `ensureAccountRole` is React cache()'d on its FULL
  // argument list, including the 4th `stored` argument — not just the
  // first three. `requireAccountAccess` (lib/auth.ts) always calls it with
  // an explicit 4th argument; this layout used to call it with only 3,
  // leaving `stored` to default inside `ensureAccountRole` itself. Two
  // different argument counts make two different cache() entries even
  // though accountId/orgId/userId all match, so `ensureAccountRoleWith`
  // ran TWICE per page load — doubling the Clerk `reconcileMembership`
  // call on the fallback path (no stored role yet). Proved against the
  // installed react@19.2.4: outside a real request's cache dispatcher,
  // cache() does not dedupe calls at all (confirmed empirically, not
  // merely read), so there is no way to exercise the REAL per-request
  // dedupe in a plain vitest run — this is a source-shape pin instead,
  // checking that both call sites now use the identical 4-argument shape
  // (the SAME readStoredRole promise instance, since readStoredRole is
  // itself cache()'d on (accountId, clerkUserId) and these two calls use
  // the same two values).
  it("calls ensureAccountRole with the SAME 4-argument shape requireAccountAccess uses — an explicit readStoredRole(...) 4th argument, never a bare 3-arg call (mutation: drop the 4th argument → FAILS)", () => {
    const src = readFileSync(path.join(here, "layout.tsx"), "utf8");
    expect(src).toMatch(
      /ensureAccountRole\(clientState\.id, claims\.org_id, userId, readStoredRole\(clientState\.id, userId\)\)/,
    );
    // Belt-and-braces: if lib/auth.ts's own call ever regressed to 3 args,
    // this layout's fix would silently stop mattering — pinned here too so
    // either side drifting alone is caught.
    const authSrc = readFileSync(path.join(here, "../../../lib/auth.ts"), "utf8");
    expect(authSrc).toMatch(/ensureAccountRole\(account\.id, claims\.org_id, userId, storedRole\)/);
  });

  it("passes the SAME isOwner value to both AppSidebar and CommandPalette, in CODE (mutation: pass a literal `false` to either → FAILS)", () => {
    const src = readFileSync(path.join(here, "layout.tsx"), "utf8");
    // The AppSidebar call site: isAgency immediately followed by isOwner,
    // both reading the computed variables (not a literal).
    // Indentation-free since the merge with main (#234) re-nested the
    // chrome one level deeper inside LocaleProvider.
    expect(src).toMatch(/isAgency=\{isAgency\}\n\s+isOwner=\{isOwner\}\n\s+isTechnician=\{isTechnician\}/);
    expect(src).toContain('<CommandPalette isAgency={isAgency} isOwner={isOwner} isTechnician={isTechnician} />');
  });

  // Merge with main (#234): main's render harness (the Clerk/next mocks above)
  // lets this be proved on the RENDERED tree, not only the source text.
  it("renders AppSidebar with isOwner true for an Owner and false for Staff (mutation: pass isOwner={false} → the Owner case FAILS)", async () => {
    authFixture.isAgency = false;
    stateFixture.value = { status: "ok", id: "acc_1", name: "Rio Roofing — trial", timezone: "America/Chicago", language: null };
    roleFixture.value = "owner";
    const ownerTree = await DashboardLayout({ children: "page" });
    expect((find(ownerTree, AppSidebar) as { props: { isOwner: boolean } }[]).map((s) => s.props.isOwner)).toEqual([true]);
    roleFixture.value = "staff";
    const staffTree = await DashboardLayout({ children: "page" });
    expect((find(staffTree, AppSidebar) as { props: { isOwner: boolean } }[]).map((s) => s.props.isOwner)).toEqual([false]);
  });

  // F-085 part 1 (spec §9): a Technician's sidebar and ⌘K index are their own.
  it("hands AppSidebar and CommandPalette isTechnician true for a Technician and false for Owner and Staff (mutation: pass isTechnician={false} to either → the Technician case FAILS)", async () => {
    authFixture.isAgency = false;
    stateFixture.value = { status: "ok", id: "acc_1", name: "Rio Roofing — trial", timezone: "America/Chicago", language: null };
    const flags = async (role: "owner" | "staff" | "technician" | null) => {
      roleFixture.value = role;
      const tree = await DashboardLayout({ children: "page" });
      const sidebar = (find(tree, AppSidebar) as { props: { isOwner: boolean; isTechnician: boolean } }[])[0]!;
      const topbar = (find(tree, Topbar) as { props: { palette: { props: { isOwner: boolean; isTechnician: boolean } } } }[])[0]!;
      return {
        sidebar: [sidebar.props.isOwner, sidebar.props.isTechnician],
        palette: [topbar.props.palette.props.isOwner, topbar.props.palette.props.isTechnician],
      };
    };
    expect(await flags("technician")).toEqual({ sidebar: [false, true], palette: [false, true] });
    expect(await flags("owner")).toEqual({ sidebar: [true, false], palette: [true, false] });
    expect(await flags("staff")).toEqual({ sidebar: [false, false], palette: [false, false] });
    // Fix round 1 (fail closed, like requireNotTechnician): a client whose
    // role could not be settled gets the narrow view too, never Staff's.
    expect(await flags(null)).toEqual({ sidebar: [false, true], palette: [false, true] });
    // The agency (role null, never a client membership) keeps the full view.
    authFixture.isAgency = true;
    expect(await flags(null)).toEqual({ sidebar: [false, false], palette: [false, false] });
    authFixture.isAgency = false;
    roleFixture.value = "staff";
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
    prefsFixture.language = null;
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
    expect(vi.mocked(requestLocale)).toHaveBeenCalledWith({ account: { language: "es" }, isOperator: false, userLanguage: null });
  });

  // Owner rule (mis preferencias): a person's own language wins for everyone;
  // operators stay English only until they choose.
  it("a person's own language wins: an operator who chose Spanish gets Spanish chrome (mutation: drop userLanguage from the layout's requestLocale call -> FAILS)", async () => {
    authFixture.isAgency = true;
    prefsFixture.language = "es";
    const tree = await DashboardLayout({ children: "page" });
    const providers = find(tree, LocaleProvider) as { props: { locale: string } }[];
    expect(providers.map((p) => p.props.locale)).toEqual(["es"]);
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
