import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatDateTime } from "@/lib/format";
import { renderedText } from "@/lib/rendered-text";

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

const { default: BlueprintsPage } = await import("./page");

describe("blueprints list (D-090)", () => {
  it("shows when each blueprint was LAST captured, not first (mutation: format created_at → FAILS)", async () => {
    const text = renderedText(renderToStaticMarkup(await BlueprintsPage()));
    expect(text).toContain(formatDateTime(RECAPTURED));
    expect(text).not.toContain(formatDateTime(CREATED));
  });

  it("says 1 account, not 1 accounts", async () => {
    const text = renderedText(renderToStaticMarkup(await BlueprintsPage()));
    expect(text).toMatch(/\b1 account\b(?!s)/);
  });
});
