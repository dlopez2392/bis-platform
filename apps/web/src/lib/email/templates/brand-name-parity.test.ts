import { describe, it, expect } from "vitest";
import { brandDisplayName as dbBrandDisplayName, type Branding } from "@bis/db";
import { brandDisplayName, emailBrand, emailBrandNamed } from "./shell";

const base: Omit<Branding, "brandName"> = {
  brandLogoPath: null, brandColor: null, brandNeutral: null,
  brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
};

describe("brandDisplayName — the web copy and the @bis/db copy are ONE rule", () => {
  it("answer identically across the input space that matters", () => {
    // Mutation: reintroduce a fallback (`branding.brandName?.trim() || accountName`)
    // in EITHER copy — this test is the only thing that says the two drifted.
    const cases: [string | null][] = [["Rio Roofing"], [null], [""], ["  "]];
    for (const [brandName] of cases) {
      const b = { ...base, brandName };
      expect(brandDisplayName(b), JSON.stringify([brandName]))
        .toBe(dbBrandDisplayName(b));
    }
  });
});

describe("emailBrandNamed", () => {
  it("is emailBrand with the name already chosen — identical output for the same inputs", () => {
    const b = { ...base, brandName: "Rio Roofing", brandColor: "#1e3a8a" };
    expect(emailBrandNamed(b, "Rio Roofing")).toEqual(emailBrand(b));
    expect(emailBrandNamed(b, "Rio Roofing").name).toBe("Rio Roofing");
  });
});

describe("the four S-09 PR 2 templates show the brand name in Spanish too, never accounts.name", () => {
  it("reminder, follow-up, review request and no-show nudge all carry the brand name in es", async () => {
    const { bookingReminderEmail } = await import("./booking");
    const { bookingFollowupEmail } = await import("./followup");
    const { reviewRequestEmail } = await import("./review-request");
    const { noShowNudgeEmail } = await import("./no-show-nudge");
    const brand = {
      name: "Rio Roofing", logoUrl: null,
      accent: { accent: "#1e3a8a", accentForeground: "#ffffff" } as Parameters<typeof bookingReminderEmail>[0]["brand"]["accent"],
    };

    const reminder = bookingReminderEmail({ brand, whenBookerZone: "sáb", cancelUrl: "https://x/c", locale: "es" });
    expect(reminder.text).not.toContain("accounts.name");

    const followup = bookingFollowupEmail({ brand, body: "", locale: "es" });
    expect(followup.subject).toContain("Rio Roofing");

    const review = reviewRequestEmail({ brand, body: "b", reviewUrl: "https://r", locale: "es" });
    expect(review.subject).toContain("Rio Roofing");

    const noShow = noShowNudgeEmail({ brand, body: "b", bookingUrl: "https://b", locale: "es" });
    expect(noShow.subject).toContain("Rio Roofing");
  });
});
