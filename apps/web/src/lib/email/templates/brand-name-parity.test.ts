import { describe, it, expect } from "vitest";
import { brandDisplayName as dbBrandDisplayName, type Branding } from "@bis/db";
import { brandDisplayName, emailBrand, emailBrandNamed } from "./shell";

const base: Omit<Branding, "brandName"> = {
  brandLogoPath: null, brandColor: null, brandNeutral: null,
  brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
};

describe("brandDisplayName — the web copy and the @bis/db copy are ONE rule", () => {
  it("answer identically across the input space that matters", () => {
    const cases: [string | null, string][] = [
      ["Rio Roofing", "Rio Roofing — trial"],
      [null, "Rio Roofing — trial"],
      ["", "Fallback"],
      ["  ", "Fallback"],
      [null, ""],
    ];
    for (const [brandName, accountName] of cases) {
      const b = { ...base, brandName };
      expect(brandDisplayName(b, accountName), JSON.stringify([brandName, accountName]))
        .toBe(dbBrandDisplayName(b, accountName));
    }
  });
});

describe("emailBrandNamed", () => {
  it("is emailBrand with the name already chosen — identical output for the same inputs", () => {
    const b = { ...base, brandName: "Rio Roofing", brandColor: "#1e3a8a" };
    expect(emailBrandNamed(b, "Rio Roofing")).toEqual(emailBrand(b, "Rio Roofing — trial"));
    expect(emailBrandNamed(b, "Rio Roofing").name).toBe("Rio Roofing");
  });
});
