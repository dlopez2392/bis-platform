import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatDateTimeInZone } from "@/lib/format";
import { renderedText } from "@/lib/rendered-text";
import { m } from "@/lib/messages";

// D-090: the list showed the FIRST capture's date beside a version number
// that counts recaptures, so a blueprint recaptured yesterday read as months
// old. listBlueprints' own count of accounts is pinned in packages/db's
// blueprints.test.ts; this pins which date the page shows.

const CREATED = "2026-09-02T15:00:00Z";
const RECAPTURED = "2026-10-05T18:30:00Z";

vi.mock("@/lib/auth", () => ({ requireAgency: async () => ({ userId: "user_agency" }) }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => ({}),
  listBlueprints: async () => [
    { id: "bp_1", name: "Roofers", version: 3, created_at: CREATED, updated_at: RECAPTURED, appliedCount: 1 },
  ],
}));

// Blueprints are agency-wide IP with no single account — the honest zone is
// the agency's own, not an account's that does not exist on this screen (see
// lib/zone.ts's renderZone). Mocked the same shape as calls/page.test.ts's
// own `@/lib/zone` mock, rather than exercising the real readAgencyZone
// (which would need a real `agencies` row through serviceDb()).
let resolvedZone: { zone: string; guessed: boolean; label: string; source: "account" | "agency" | "fallback" } =
  { zone: "America/Chicago", guessed: true, label: "America/Chicago", source: "agency" };
vi.mock("@/lib/zone", () => ({
  renderZone: async () => resolvedZone,
}));

const { default: BlueprintsPage } = await import("./page");

describe("blueprints list (D-090)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows when each blueprint was LAST captured, not first (mutation: format created_at → FAILS)", async () => {
    const text = renderedText(renderToStaticMarkup(await BlueprintsPage()));
    expect(text).toContain(formatDateTimeInZone(RECAPTURED, resolvedZone.zone));
    expect(text).not.toContain(formatDateTimeInZone(CREATED, resolvedZone.zone));
  });

  it("says 1 account, not 1 accounts", async () => {
    const text = renderedText(renderToStaticMarkup(await BlueprintsPage()));
    expect(text).toMatch(/\b1 account\b(?!s)/);
  });

  // The runtime's own zone (server or browser) must never be the one that
  // decides the date — the same bug D-010 fixed elsewhere. Pinned against
  // the AGENCY's own zone (the honest choice on a screen with no account),
  // not an account's, because a blueprint has no single account to read one
  // from.
  it("a blueprint's capture date follows the AGENCY's zone (Berlin), not the runtime's (Chicago)", async () => {
    vi.stubEnv("TZ", "America/Chicago");
    resolvedZone = { zone: "Europe/Berlin", guessed: true, label: "Europe/Berlin", source: "agency" };
    // 18:30 UTC is 8:30 PM in Berlin (CEST) but 1:30 PM in Chicago.
    const text = renderedText(renderToStaticMarkup(await BlueprintsPage()));
    expect(text).toContain("8:30 PM");
    expect(text).not.toContain("1:30 PM");
  });

  it("names the zone the dates on this screen are shown in", async () => {
    resolvedZone = { zone: "America/Chicago", guessed: true, label: "America/Chicago", source: "agency" };
    const text = renderedText(renderToStaticMarkup(await BlueprintsPage()));
    expect(text).toContain("America/Chicago");
  });

  // Review of #225: `renderZone(undefined)` always answers `source: "agency"`
  // on this screen once the agency's own zone is usable — that is the
  // EXPECTED source here, not a degraded one, since there is no account on
  // this screen to have "its own" zone broken in the first place.
  // `ZoneNote`'s `isAgency` prop alone could not distinguish "no account at
  // all" from "this account's own zone was broken", so it printed "This
  // company has no timezone of its own" on a screen with no company at all
  // (mutation: drop `accountless` from the page's own `<ZoneNote>` → FAILS).
  it("never claims a company has no timezone of its own — there is no company on this screen", async () => {
    resolvedZone = { zone: "America/Chicago", guessed: true, label: "America/Chicago", source: "agency" };
    const text = renderedText(renderToStaticMarkup(await BlueprintsPage()));
    expect(text).not.toContain(m["zone.guessed.agency"]);
  });
});
