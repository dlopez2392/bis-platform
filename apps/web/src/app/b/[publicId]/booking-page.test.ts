import { describe, it, expect } from "vitest";
import { partOfDay, groupSlots } from "./booking-page";

/**
 * The grouping is read in the BOOKER's zone, which is the same zone the time
 * beside it is printed in. Getting that wrong would put a 9am slot under
 * "Evening" for anyone east of the account — the sort of thing that looks like
 * a bug in the calendar rather than in a label.
 */
const CHICAGO = "America/Chicago";

describe("partOfDay", () => {
  it("splits the day where a person would", () => {
    expect(partOfDay("2026-09-08T14:00:00Z", CHICAGO)).toBe("morning"); // 09:00 local
    expect(partOfDay("2026-09-08T17:00:00Z", CHICAGO)).toBe("afternoon"); // 12:00 local
    // 17:00 is the boundary and belongs to the evening: a 5pm slot is the
    // after-work one, which is how someone booking around a job reads it.
    expect(partOfDay("2026-09-08T21:59:00Z", CHICAGO)).toBe("afternoon"); // 16:59 local
    expect(partOfDay("2026-09-08T22:00:00Z", CHICAGO)).toBe("evening"); // 17:00 local
  });

  it("reads the booker's zone, not the server's", () => {
    const iso = "2026-09-08T14:00:00Z";
    expect(partOfDay(iso, "America/Chicago")).toBe("morning"); // 09:00
    expect(partOfDay(iso, "Asia/Tokyo")).toBe("evening"); // 23:00
  });

  it("puts midnight and noon on the right side of their boundaries", () => {
    expect(partOfDay("2026-09-08T05:00:00Z", CHICAGO)).toBe("morning"); // 00:00 local
    expect(partOfDay("2026-09-08T16:59:00Z", CHICAGO)).toBe("morning"); // 11:59 local
  });
});

describe("groupSlots", () => {
  it("keeps reading order and drops empty groups", () => {
    const groups = groupSlots(
      ["2026-09-08T14:00:00Z", "2026-09-08T17:30:00Z", "2026-09-08T15:00:00Z"],
      CHICAGO,
    );
    expect(groups.map((g) => g.part)).toEqual(["morning", "afternoon"]);
    // A heading with nothing under it is worse than no heading.
    expect(groups.every((g) => g.slots.length > 0)).toBe(true);
  });

  it("preserves the order slots arrived in within a group", () => {
    const [morning] = groupSlots(["2026-09-08T14:00:00Z", "2026-09-08T15:00:00Z"], CHICAGO);
    expect(morning?.slots).toEqual(["2026-09-08T14:00:00Z", "2026-09-08T15:00:00Z"]);
  });

  it("returns nothing at all for a day with no slots", () => {
    expect(groupSlots([], CHICAGO)).toEqual([]);
  });
});

/**
 * Every class the booking page renders has a rule somewhere.
 *
 * The step dots and the "Powered by BIS" footer shipped as markup with no CSS
 * at all, so every booking page — the one framed on bis-rgv.com included —
 * showed a browser-default numbered list of all three step names and a blue
 * underlined link, for weeks, with every test green. Read from source rather
 * than rendered: a class with no rule is invisible to any assertion about the
 * DOM, which is exactly how it survived.
 */
describe("booking page styles", () => {
  it("styles every bis-booking-* class the markup uses", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const here = path.join(process.cwd(), "src/app/b/[publicId]");
    const tsx = fs.readFileSync(path.join(here, "booking-page.tsx"), "utf8");
    const sheets = [
      tsx.slice(tsx.indexOf("const BOOKING_CSS")),
      fs.readFileSync(path.join(process.cwd(), "src/styles/public-brand.css"), "utf8"),
    ].join("\n");
    const markup = tsx.slice(0, tsx.indexOf("const BOOKING_CSS"));

    const used = new Set<string>();
    for (const m of markup.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
      for (const token of (m[1] ?? m[2] ?? "").split(/\s+/)) {
        const name = token.replace(/\$\{.*$/, "");
        if (name.startsWith("bis-booking")) used.add(name);
      }
    }
    expect(used.size).toBeGreaterThan(10); // the scan found the markup at all
    // Named on purpose, not skipped by pattern: a wrapper whose children carry
    // all the styling (`.bis-booking-row`, `.bis-booking-submit`). Adding a
    // class here is a decision someone has to write down.
    const deliberatelyBare = new Set(["bis-booking-form"]);
    const unstyled = [...used]
      .filter((c) => !deliberatelyBare.has(c))
      .filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(sheets));
    expect(unstyled, "classes rendered with no rule in BOOKING_CSS or public-brand.css").toEqual([]);
  });
});
