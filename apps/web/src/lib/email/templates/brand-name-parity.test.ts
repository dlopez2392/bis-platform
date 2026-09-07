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
