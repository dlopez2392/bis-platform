import { describe, it, expect } from "vitest";
import { PlaceDbError } from "@bis/db";
import { m } from "@/lib/messages";
import { placeErrorFor } from "./place-errors";

describe("placeErrorFor (spec §6: by SQLSTATE, never by wording)", () => {
  it("a refusal (42501) is places.refused", () => {
    expect(placeErrorFor(new PlaceDbError("x", "42501"))).toBe("places.refused");
  });
  it("a second replacement of one unit (23505) is equipment.alreadyReplaced", () => {
    expect(placeErrorFor(new PlaceDbError("x", "23505"))).toBe("equipment.alreadyReplaced");
  });
  it("a vanished target (23503) is places.error.undoFailed", () => {
    expect(placeErrorFor(new PlaceDbError("x", "23503"))).toBe("places.error.undoFailed");
  });
  it("a CHECK the app should have caught first (23514) is places.error.invalid", () => {
    expect(placeErrorFor(new PlaceDbError("x", "23514"))).toBe("places.error.invalid");
  });
  it("a plain object carrying a code maps the same way (PostgREST's own error shape)", () => {
    expect(placeErrorFor({ code: "42501" })).toBe("places.refused");
  });
  it("an unknown code is places.error.failed", () => {
    expect(placeErrorFor(new PlaceDbError("x", "PGRST301"))).toBe("places.error.failed");
    expect(placeErrorFor(new PlaceDbError("x", undefined))).toBe("places.error.failed");
    expect(placeErrorFor(new Error("duplicate key 23505"))).toBe("places.error.failed");
    expect(placeErrorFor("42501")).toBe("places.error.failed");
    expect(placeErrorFor(null)).toBe("places.error.failed");
  });
  it("every key it can answer is in the catalogue with a Spanish twin", () => {
    const keys = ["42501", "23505", "23503", "23514", "x"].map((code) => placeErrorFor({ code }));
    for (const key of keys) {
      expect(m[key]).toBeTruthy();
      expect(m[`${key}.es` as keyof typeof m]).toBeTruthy();
    }
  });
});
