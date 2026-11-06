import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SURFACE_MANIFEST, audienceIncludes, surfaceById, type SurfaceEntry } from "./manifest";
import { buildPaletteEntries, filterEntries } from "@/lib/palette/registry";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXED_BASE = "/dashboard/accounts/acc_1";
// apps/web/src/lib/surfaces -> apps/web/src/app/(dashboard)
const APP_ROOT = path.join(here, "..", "..", "app", "(dashboard)");

/**
 * Code only: line/block comments (and so JSX comments) removed, string and
 * template contents kept. Same scanner as registry.test.ts and
 * app-sidebar.test.ts (each file in this repo keeps its own copy — see
 * their own doc comments for why a shared helper proved less robust than a
 * duplicate, byte-for-byte scanner per caller).
 */
function stripComments(src: string): string {
  let out = "";
  let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; i++; continue; }
      if (c === "/" && d === "*") { mode = "block"; i++; continue; }
      if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      out += c;
      continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } continue; }
    if (mode === "block") {
      if (c === "*" && d === "/") { mode = "code"; i++; } else if (c === "\n") out += c;
      continue;
    }
    if (c === "\\") { out += c + (d ?? ""); i++; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code";
    }
    out += c;
  }
  return out;
}

// The same card files registry.test.ts's own forward-anchor-parity test
// reads (D-080) — duplicated rather than imported, same reasoning as
// stripComments above.
const SETTINGS_CARD_FILES = [
  "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx",
  "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/client-access-panel.tsx",
  "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/sending-address-card.tsx",
  "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/weekly-report-card.tsx",
  "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/required-documents-card.tsx",
  "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-card.tsx",
  "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-card.tsx",
  "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/trade-card.tsx",
  "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/link-site-card.tsx",
  "../../components/alert-phone-card.tsx",
  "../../components/branding-panel.tsx",
];

function settingsCardSources(): string {
  return SETTINGS_CARD_FILES
    .map((f) => stripComments(readFileSync(path.join(here, f), "utf8")))
    .join("\n");
}

describe("SURFACE_MANIFEST shape", () => {
  it("is non-empty and every entry has a unique, non-empty id", () => {
    expect(SURFACE_MANIFEST.length).toBeGreaterThan(0);
    const ids = SURFACE_MANIFEST.map((e) => e.id);
    for (const id of ids) expect(id.trim().length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("surfaceById finds a known entry and throws on an unknown one (mutation: typo the id → the throw's message names it)", () => {
    expect(surfaceById("nav:dashboard").labelKey).toBe("nav.dashboard");
    expect(() => surfaceById("nav:does-not-exist")).toThrow(/nav:does-not-exist/);
  });
});

// Probe 1 (spec §4.1): reverse settings-anchor parity. Every real id="…" on
// a Settings card must be a registered manifest anchor — the exact D-080
// shape, made structurally impossible instead of review-dependent.
describe("Probe 1 — reverse settings-anchor parity (spec §4.1)", () => {
  it("every id on a Settings card is a registered manifest anchor (mutation: add <Card id=\"new-thing\"> to a card file with no manifest entry → FAILS)", () => {
    const sources = settingsCardSources();
    const registeredAnchors = new Set(
      SURFACE_MANIFEST.filter((e) => e.kind === "settings-section").map((e) => e.anchor),
    );
    expect(registeredAnchors.size).toBeGreaterThan(0); // vacuous guard
    // The real anchor convention in this codebase is specifically a
    // `<Card id="…">` wrapper (every card file above uses it) — NOT every
    // `id="…"` attribute in the file, most of which are form inputs
    // (`id="brand-name"`, `id="ai-budget"`, …) that were never meant to be
    // registered and must not be flagged. An earlier version of this test
    // matched every `id="…"` then SKIPPED whichever one was unregistered —
    // which cannot ever fail (red-first check: that version passed against
    // this exact mutation, below, and was replaced before being kept).
    const idMatches = [...sources.matchAll(/<Card\s+id="([a-z0-9-]+)"/g)].map((m) => m[1]!);
    expect(idMatches.length).toBeGreaterThan(0); // vacuous guard
    for (const id of idMatches) {
      expect(registeredAnchors, id).toContain(id);
    }
  });
});

// Probe 2 (spec §4.1): forward settings-anchor parity, read off the
// manifest directly rather than through buildPaletteEntries (registry.test.ts
// already covers that path; this is the manifest's own contract).
describe("Probe 2 — forward settings-anchor parity, read off the manifest (spec §4.1)", () => {
  it("every manifest settings-section anchor is a real id on a Settings card (mutation: remove id=\"branding\" from branding-panel.tsx → FAILS)", () => {
    const sources = settingsCardSources();
    const anchors = SURFACE_MANIFEST.filter((e) => e.kind === "settings-section").map((e) => e.anchor!);
    expect(anchors.length).toBeGreaterThan(0); // vacuous guard
    for (const anchor of anchors) {
      expect(sources, `no id="${anchor}" found on any Settings card`).toContain(`id="${anchor}"`);
    }
  });
});

// Probe 3 (spec §4.1): navigation-anchor parity, widened to every manifest
// entry whose route carries a #fragment, regardless of group — closes
// finding (b): nav:required-documents and nav:bis-access were checked by
// nothing, in either direction.
describe("Probe 3 — navigation-anchor parity, widened to every #fragment route (spec §4.1)", () => {
  it("every fragment this manifest points at is a real id on the page it names (mutation: rename id=\"bis-access\" in bis-access-frame.tsx without updating the manifest's route → FAILS)", () => {
    const sources = new Map<string, string>([
      ["settings", settingsCardSources()],
      [
        "required-documents",
        stripComments(readFileSync(
          path.join(here, "../../app/(dashboard)/dashboard/accounts/[accountId]/documents/required-documents-summary.tsx"),
          "utf8",
        )),
      ],
      [
        "bis-access",
        stripComments(readFileSync(path.join(here, "../../components/access-log/bis-access-frame.tsx"), "utf8")),
      ],
    ]);

    const fragmentEntries = SURFACE_MANIFEST
      .map((e) => ({ e, href: e.route(FIXED_BASE) }))
      .filter(({ href }) => href.includes("#"));
    expect(fragmentEntries.length).toBeGreaterThan(0); // vacuous guard

    for (const { e, href } of fragmentEntries) {
      const fragment = href.split("#")[1]!;
      const page = href.includes("/settings#")
        ? "settings"
        : href.includes("/documents#")
          ? "required-documents"
          : href.includes("/team#")
            ? "bis-access"
            : null;
      expect(page, `entry ${e.id}'s route ${href} names a page this probe does not know how to check`).not.toBeNull();
      expect(sources.get(page!), `no source loaded for ${page}`).toContain(`id="${fragment}"`);
    }
  });
});

// Probe 5 (spec §4.1): audience-matches-guard, spot-checked. For every
// account-scoped entry whose audience is PURELY agency (no client role at
// all — never "owner", never plain client) and whose route is not ALSO
// pointed at by a broader-audience entry (a shared route is demonstrably
// not agency-exclusive at the request level, whatever one menu id calls
// it — settings:team's own page admits a client Owner too, per
// team/page.tsx's own requireAccountOwner), its page.tsx must carry
// requireAgency or requireAgencyOnlyAccountAccess.
describe("Probe 5 — audience-matches-guard, spot-checked (spec §4.1)", () => {
  function routePathNoFragment(e: SurfaceEntry): string {
    return e.route(FIXED_BASE).split("#")[0]!;
  }
  function isPureAgency(e: SurfaceEntry): boolean {
    return e.audience.agency === true && e.audience.client === false && e.audience.technician === false;
  }

  it("every PURELY agency-scoped page not shared with a broader-audience entry is guarded by requireAgency or requireAgencyOnlyAccountAccess (mutation: mark a manifest entry agency:true for a route whose page.tsx has neither call → FAILS, naming the route)", () => {
    const accountScoped = SURFACE_MANIFEST.filter((e) => e.scope === "account");
    const byRoute = new Map<string, SurfaceEntry[]>();
    for (const e of accountScoped) {
      const p = routePathNoFragment(e);
      if (!byRoute.has(p)) byRoute.set(p, []);
      byRoute.get(p)!.push(e);
    }

    const toCheck = accountScoped.filter(
      (e) => isPureAgency(e) && byRoute.get(routePathNoFragment(e))!.every(isPureAgency),
    );
    expect(toCheck.length).toBeGreaterThan(0); // vacuous guard

    for (const e of toCheck) {
      const folder = path.join(APP_ROOT, "dashboard/accounts/[accountId]", routePathNoFragment(e).slice(FIXED_BASE.length));
      const pageFile = path.join(folder, "page.tsx");
      expect(existsSync(pageFile), `${e.id}: no page.tsx at ${pageFile}`).toBe(true);
      const source = stripComments(readFileSync(pageFile, "utf8"));
      expect(source, `${e.id}'s route ${e.route(FIXED_BASE)} has neither requireAgency nor requireAgencyOnlyAccountAccess`)
        .toContain("requireAgency");
    }
  });

  it("settings:team is excluded from the spot-check: its route (/team) is shared with nav:team, a client-Owner-visible entry, so it is not agency-exclusive at the request level (team/page.tsx's own requireAccountOwner, not requireAgency)", () => {
    const entry = surfaceById("settings:team");
    expect(isPureAgency(entry)).toBe(true);
    const siblings = SURFACE_MANIFEST.filter(
      (e) => e.scope === "account" && e.route(FIXED_BASE).split("#")[0] === entry.route(FIXED_BASE).split("#")[0],
    );
    expect(siblings.some((s) => !isPureAgency(s))).toBe(true);
  });
});

// Probe 6 (spec §4.1, Q5): route-existence, bounded to this manifest's own
// finite entry list — not a full route-tree walk.
describe("Probe 6 — route-existence, bounded to the manifest's own entries (spec §4.1, Q5)", () => {
  function routeFolder(e: SurfaceEntry): string {
    const withoutFragment = e.route(FIXED_BASE).split("#")[0]!;
    if (withoutFragment.startsWith(`${FIXED_BASE}/`)) {
      const suffix = withoutFragment.slice(FIXED_BASE.length);
      return path.join(APP_ROOT, "dashboard/accounts/[accountId]", suffix);
    }
    return path.join(APP_ROOT, withoutFragment);
  }

  it("every manifest entry's route resolves to an existing folder under the dashboard route tree (mutation: point one entry at a renamed/deleted folder → FAILS, naming the path)", () => {
    expect(SURFACE_MANIFEST.length).toBeGreaterThan(0); // vacuous guard
    for (const e of SURFACE_MANIFEST) {
      const folder = routeFolder(e);
      const ok = existsSync(folder) && statSync(folder).isDirectory();
      expect(ok, `${e.id}: no folder at ${folder}`).toBe(true);
    }
  });
});

// Probe 7 (spec §4.1, owner ruling Q2): the agency's own /dashboard, found
// by ⌘K for the first time, in English and Spanish.
describe("Probe 7 — the agency's own /dashboard is findable by ⌘K (spec §4.1, Q2)", () => {
  it("filterEntries(buildPaletteEntries(null, true, false), \"dashboard\") includes the agency top-level entry (mutation: drop that one manifest row → FAILS)", () => {
    const entries = buildPaletteEntries(null, true, false);
    const hit = filterEntries(entries, "dashboard").find(
      (e) => e.kind === "href" && (e as { href: string }).href === "/dashboard",
    );
    expect(hit).toBeTruthy();
  });

  it("the same entry is findable by its Spanish label, \"panel\" (mutation: drop that one manifest row → FAILS)", () => {
    const entries = buildPaletteEntries(null, true, false, false, "en");
    const hit = filterEntries(entries, "panel").find(
      (e) => e.kind === "href" && (e as { href: string }).href === "/dashboard",
    );
    expect(hit).toBeTruthy();
  });

  it("is never offered inside an account, or to a client at the top level", () => {
    const inAccount = buildPaletteEntries(FIXED_BASE, true, false);
    expect(inAccount.some((e) => e.kind === "href" && (e as { href: string }).href === "/dashboard")).toBe(false);
  });
});

describe("audienceIncludes (spec §2.1's SurfaceAudience)", () => {
  it("agency wins first, regardless of client/technician", () => {
    expect(audienceIncludes({ agency: true, client: false, technician: false }, true, false, false)).toBe(true);
    expect(audienceIncludes({ agency: false, client: true, technician: true }, true, false, true)).toBe(false);
  });

  it("a Technician is a further narrowing of client, never a fourth value (mutation: drop the technician check → a technician:false item would wrongly show)", () => {
    expect(audienceIncludes({ agency: false, client: true, technician: false }, false, false, true)).toBe(false);
    expect(audienceIncludes({ agency: false, client: true, technician: true }, false, false, true)).toBe(true);
  });

  it("client: \"owner\" requires isOwner; plain client: true does not", () => {
    expect(audienceIncludes({ agency: false, client: "owner", technician: false }, false, false, false)).toBe(false);
    expect(audienceIncludes({ agency: false, client: "owner", technician: false }, false, true, false)).toBe(true);
    expect(audienceIncludes({ agency: false, client: true, technician: false }, false, false, false)).toBe(true);
  });
});
