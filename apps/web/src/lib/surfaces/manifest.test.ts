import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SURFACE_MANIFEST, audienceIncludes, surfaceById, type SurfaceEntry } from "./manifest";
import { buildPaletteEntries, filterEntries, ENTRY_KEYWORDS, type PaletteEntry } from "@/lib/palette/registry";

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

  // F-087 fix round, Minor 4: ENTRY_KEYWORDS (registry.ts) is keyed by
  // manifest id (Q3) — a stale key (the manifest entry it named was
  // renamed or removed) would silently stop contributing its words to
  // ⌘K's search, with nothing failing to say so.
  it("every ENTRY_KEYWORDS key is a real manifest id (mutation: rename \"nav:/dashboard\" in the manifest → FAILS, naming the stale key)", () => {
    const ids = new Set(SURFACE_MANIFEST.map((e) => e.id));
    const keys = Object.keys(ENTRY_KEYWORDS);
    expect(keys.length).toBeGreaterThan(0); // vacuous guard
    for (const key of keys) {
      expect(ids, `ENTRY_KEYWORDS["${key}"] names no manifest entry`).toContain(key);
    }
  });
});

// Probe 1 (spec §4.1): reverse settings-anchor parity. Every real id="…" on
// a Settings card must be a registered manifest anchor — the exact D-080
// shape, made structurally impossible instead of review-dependent.
//
// F-087 fix round, Minor 5: the regex is `<Card\b[^>]*\bid="…"`, not
// `<Card\s+id="…"` — the earlier version only matched when `id` was the
// FIRST attribute after `<Card`, so `<Card className="x" id="y">` (a real
// JSX attribute order this codebase does not currently use, but nothing
// enforces that it never will) was invisible to this probe. Verified: the
// mutation `<Card className="x" id="new-thing" />` was invisible to the
// OLD regex (zero matches) and is caught by the new one.
//
// `team-card.tsx`'s own `<Card id="team">` (components/team/team-card.tsx)
// is deliberately NOT in SETTINGS_CARD_FILES below, and should not be
// added: `id="team"` is the Card's ordinary scroll-margin convention
// (`className="scroll-mt-24"`, same as every card here), never a fragment
// a route points at — `grep -rn '#team"' apps/web/src` returns nothing, in
// either the manifest's own route() outputs or any href in the app. Adding
// it would make this probe fail permanently on a real, intentional
// non-anchor (registry.ts's own historical comment on `settings:team`:
// that card renders only while client access is on, so a `#team` fragment
// "would scroll to nothing whenever access is off" — exactly why
// `settings:team`'s route is the whole `/team` page, never a fragment).
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
    const idMatches = [...sources.matchAll(/<Card\b[^>]*\bid="([a-z0-9-]+)"/g)].map((m) => m[1]!);
    expect(idMatches.length).toBeGreaterThan(0); // vacuous guard
    for (const id of idMatches) {
      expect(registeredAnchors, id).toContain(id);
    }
  });

  it("catches a mutated attribute order, which the old <Card\\s+id=\"…\" regex could not see (mutation: revert the regex to <Card\\s+id=\"…\" → this test's own red case below would be invisible)", () => {
    const mutatedSource = '<Card className="x" id="new-thing" />';
    const oldRegex = /<Card\s+id="([a-z0-9-]+)"/g;
    const newRegex = /<Card\b[^>]*\bid="([a-z0-9-]+)"/g;
    expect([...mutatedSource.matchAll(oldRegex)]).toHaveLength(0);
    expect([...mutatedSource.matchAll(newRegex)].map((m) => m[1])).toEqual(["new-thing"]);
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
// all — never "owner", never plain client), its page.tsx must carry a REAL
// CALL to requireAgency or requireAgencyOnlyAccountAccess — a call-shaped
// regex, not a bare `toContain`, which an import line alone (no call) would
// also satisfy (F-087 fix round, Minor 6: verified — commenting out
// `await requireAgencyOnlyAccountAccess(accountId);` in checklist/page.tsx
// while leaving its import line in place left the OLD bare-substring
// version of this test green; reverted immediately, the regex below fixes
// the class of mutation rather than just this one instance).
//
// NAMED_AUDIENCE_EXEMPTIONS (Minor 6): a fixed, reviewed set, not a DERIVED
// "every entry sharing this route must also be pure-agency" rule — the
// derived version happened to exclude exactly the one real case (below)
// but, being derived, would also silently exempt any FUTURE entry that
// merely happens to share a route with a broader one, which is not always
// the right call and should not escape review by construction.
const NAMED_AUDIENCE_EXEMPTIONS = new Set<string>([
  // settings:team's route (`${base}/team`) is also nav:team's — a client
  // Owner's own entry — and team/page.tsx's FIRST call is
  // `requireAccountOwner`, which admits the agency AND a client Owner (its
  // own doc comment: "it admits the agency and a client Owner and sends a
  // Staff to their dashboard"). The route is real and guarded; it is simply
  // not agency-EXCLUSIVE, which is the one thing this probe can check.
  "settings:team",
]);
describe("Probe 5 — audience-matches-guard, spot-checked (spec §4.1)", () => {
  function routePathNoFragment(e: SurfaceEntry): string {
    return e.route(FIXED_BASE).split("#")[0]!;
  }
  function isPureAgency(e: SurfaceEntry): boolean {
    return e.audience.agency === true && e.audience.client === false && e.audience.technician === false;
  }
  // A real invocation — `requireAgency(` or `requireAgencyOnlyAccountAccess(`
  // — never merely an import line naming the identifier.
  const GUARD_CALL = /\brequireAgency(OnlyAccountAccess)?\s*\(/;

  it("every PURELY agency-scoped page, except the named exemption, is guarded by a REAL CALL to requireAgency or requireAgencyOnlyAccountAccess (mutation: mark nav:required-documents agency:true/client:false → FAILS, naming documents/page.tsx)", () => {
    const toCheck = SURFACE_MANIFEST.filter(
      (e) => e.scope === "account" && isPureAgency(e) && !NAMED_AUDIENCE_EXEMPTIONS.has(e.id),
    );
    expect(toCheck.length).toBeGreaterThan(0); // vacuous guard

    for (const e of toCheck) {
      const folder = path.join(APP_ROOT, "dashboard/accounts/[accountId]", routePathNoFragment(e).slice(FIXED_BASE.length));
      const pageFile = path.join(folder, "page.tsx");
      expect(existsSync(pageFile), `${e.id}: no page.tsx at ${pageFile}`).toBe(true);
      const source = stripComments(readFileSync(pageFile, "utf8"));
      expect(GUARD_CALL.test(source), `${e.id}'s route ${e.route(FIXED_BASE)} has no CALL to requireAgency or requireAgencyOnlyAccountAccess (an import line alone does not count)`)
        .toBe(true);
    }
  });

  it("settings:team is excluded from the spot-check by name: its route (/team) is shared with nav:team, a client-Owner-visible entry, so it is not agency-exclusive at the request level (team/page.tsx's own requireAccountOwner, not requireAgency)", () => {
    const entry = surfaceById("settings:team");
    expect(isPureAgency(entry)).toBe(true);
    expect(NAMED_AUDIENCE_EXEMPTIONS.has(entry.id)).toBe(true);
    // The reason for the exemption is still real, named here rather than
    // re-derived: its route really is shared with a broader-audience entry.
    const siblings = SURFACE_MANIFEST.filter(
      (e) => e.scope === "account" && e.route(FIXED_BASE).split("#")[0] === entry.route(FIXED_BASE).split("#")[0],
    );
    expect(siblings.some((s) => !isPureAgency(s))).toBe(true);
  });

  it("nav:required-documents, marked agency-only, is NOT exempt and fails against documents/page.tsx's own requireAccountAccess (mutation: mark nav:required-documents agency:true/client:false → FAILS)", () => {
    const original = surfaceById("nav:required-documents");
    const mutated: SurfaceEntry = { ...original, audience: { agency: true, client: false, technician: false } };
    expect(isPureAgency(mutated)).toBe(true);
    expect(NAMED_AUDIENCE_EXEMPTIONS.has(mutated.id)).toBe(false);
    const folder = path.join(APP_ROOT, "dashboard/accounts/[accountId]", routePathNoFragment(mutated).slice(FIXED_BASE.length));
    const source = stripComments(readFileSync(path.join(folder, "page.tsx"), "utf8"));
    expect(GUARD_CALL.test(source)).toBe(false);
  });
});

// Probe 6 (spec §4.1, Q5): route-existence, bounded to this manifest's own
// finite entry list — not a full route-tree walk. F-087 fix round, Minor
// 7: checks for a real `page.tsx`, not merely the folder — a folder that
// exists but holds no page.tsx (only a layout, say) is not a routable
// Next.js App Router page, so "the folder exists" was a weaker claim than
// this probe's own name promises. Verified: every entry's folder in the
// real tree already has one, so this is a correctness strengthening, not
// a behavior change today.
describe("Probe 6 — route-existence, bounded to the manifest's own entries (spec §4.1, Q5)", () => {
  function routeFolder(e: SurfaceEntry): string {
    const withoutFragment = e.route(FIXED_BASE).split("#")[0]!;
    if (withoutFragment.startsWith(`${FIXED_BASE}/`)) {
      const suffix = withoutFragment.slice(FIXED_BASE.length);
      return path.join(APP_ROOT, "dashboard/accounts/[accountId]", suffix);
    }
    return path.join(APP_ROOT, withoutFragment);
  }

  it("every manifest entry's route resolves to a real page.tsx under the dashboard route tree (mutation: point one entry at a renamed/deleted folder → FAILS, naming the path)", () => {
    expect(SURFACE_MANIFEST.length).toBeGreaterThan(0); // vacuous guard
    for (const e of SURFACE_MANIFEST) {
      const pageFile = path.join(routeFolder(e), "page.tsx");
      const ok = existsSync(pageFile) && statSync(pageFile).isFile();
      expect(ok, `${e.id}: no page.tsx at ${pageFile}`).toBe(true);
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

  it("is never offered inside an account, or to a client at the top level (F-087 fix round, Minor 8: the title named both cases, the assertions only covered the first)", () => {
    const inAccount = buildPaletteEntries(FIXED_BASE, true, false);
    expect(inAccount.some((e) => e.kind === "href" && (e as { href: string }).href === "/dashboard")).toBe(false);

    const clientAtTopLevel = buildPaletteEntries(null, false, false);
    expect(clientAtTopLevel.some((e) => e.kind === "href" && (e as { href: string }).href === "/dashboard")).toBe(false);
  });

  // F-087 fix round, Minor 8: the Spanish side of "found in English or
  // Spanish" (owner ruling Q2) — a palette BUILT in Spanish must find the
  // entry both by its own Spanish label word ("panel") and by the English
  // word F-095's words() appends to every entry's keywords.
  it("a palette built in Spanish finds the entry by 'panel' and by 'dashboard' (mutation: drop that one manifest row → FAILS)", () => {
    const es = buildPaletteEntries(null, true, false, false, "es");
    const isTheEntry = (e: PaletteEntry) => e.kind === "href" && (e as { href: string }).href === "/dashboard";
    expect(filterEntries(es, "panel").some(isTheEntry)).toBe(true);
    expect(filterEntries(es, "dashboard").some(isTheEntry)).toBe(true);
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
