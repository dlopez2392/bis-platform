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
  value: { status: "ok" as const, id: "acc_1", name: "Rio Roofing — trial", timezone: "America/Chicago" },
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

const { generateMetadata } = await import("./layout");

describe("dashboard/layout generateMetadata — the tab title (D-072)", () => {
  beforeEach(() => {
    stateFixture.value = { status: "ok", id: "acc_1", name: "Rio Roofing — trial", timezone: "America/Chicago" };
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
  it("settles isOwner from ensureAccountRole keyed on the client's own account/org, only when resolved \"ok\" (mutation: hardcode isOwner to isAgency, or drop the status === \"ok\" guard → FAILS)", () => {
    const src = readFileSync(path.join(here, "layout.tsx"), "utf8");
    expect(src).toContain('clientState?.status === "ok" && claims.org_id');
    expect(src).toContain(
      'ensureAccountRole(clientState.id, claims.org_id, userId, readStoredRole(clientState.id, userId)).then((role) => role === "owner")',
    );
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
    expect(src).toContain("isAgency={isAgency}\n          isOwner={isOwner}");
    expect(src).toContain('<CommandPalette isAgency={isAgency} isOwner={isOwner} />');
  });
});
