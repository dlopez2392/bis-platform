import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { spaceUsedText, SPACE_SHOW_ABOVE } from "./space";

const GIB = 1_073_741_824;
const QUOTA = 5 * GIB;
const es = (used: string, quota: string) => m["documents.spaceUsed.es"].replace("{used}", used).replace("{quota}", quota);

describe("the space-used line (spec 4.2 item 4)", () => {
  it("is shown only ABOVE 80%: exactly 4 of 5 GB is quiet, one byte more speaks (mutation: >= in place of > -> FAILS)", () => {
    expect(SPACE_SHOW_ABOVE).toBe(0.8);
    expect(spaceUsedText({ used: 4 * GIB, quota: QUOTA }, "en")).toBeNull();
    expect(spaceUsedText({ used: 4 * GIB + 1, quota: QUOTA }, "en")).toBe("4.0 of 5 GB used");
  });
  it("tenths round DOWN, so a nearly full account never reads full (mutation: Math.round -> FAILS on 4.99)", () => {
    expect(spaceUsedText({ used: Math.floor(4.1 * GIB) + 1, quota: QUOTA }, "en")).toBe("4.1 of 5 GB used");
    expect(spaceUsedText({ used: Math.floor(4.99 * GIB), quota: QUOTA }, "en")).toBe("4.9 of 5 GB used");
    expect(spaceUsedText({ used: QUOTA, quota: QUOTA }, "en")).toBe("5.0 of 5 GB used");
  });
  it("Spanish is the Spanish catalogue's sentence (mutation: render the English key for es -> FAILS)", () => {
    expect(spaceUsedText({ used: Math.floor(4.1 * GIB) + 1, quota: QUOTA }, "es")).toBe(es("4.1", "5"));
  });
  it("no number, no line: a failed read (null) and a nonsense quota draw nothing (mutation: drop the `!(space.quota > 0)` guard -> FAILS on the zero quota)", () => {
    expect(spaceUsedText(null, "en")).toBeNull();
    expect(spaceUsedText({ used: 10, quota: 0 }, "en")).toBeNull();
  });
});
