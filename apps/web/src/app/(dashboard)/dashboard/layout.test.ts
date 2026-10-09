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
});
