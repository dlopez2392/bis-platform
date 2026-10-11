import { describe, it, expect } from "vitest";
import { relationshipErrorFor } from "./relationship-errors";

describe("relationshipErrorFor (relationships spec §6: by SQLSTATE, never by wording)", () => {
  it("names each refusal the database can give", () => {
    expect(relationshipErrorFor({ code: "23505" })).toBe("relationships.error.duplicate");
    expect(relationshipErrorFor({ code: "42501" })).toBe("relationships.error.refused");
    expect(relationshipErrorFor({ code: "23503" })).toBe("relationships.error.gone");
    // Spec §6: a CHECK violation is "Pick someone else." Every other CHECK in 0070 (forms, the
    // custom label, and the locked flags: newRelationshipFor, parseRelationshipRow, and the edit and
    // Undo actions' own refusal) is re-checked before the write, so the one a write can still hit is
    // contact_id <> related_contact_id.
    expect(relationshipErrorFor({ code: "23514" })).toBe("relationships.error.self");
    expect(relationshipErrorFor({ code: "22023" })).toBe("relationships.error.invalid");
    expect(relationshipErrorFor({ code: "22P02" })).toBe("relationships.error.invalid");
  });
  it("anything else, a message that merely mentions a code included, is a plain failure", () => {
    expect(relationshipErrorFor(new Error("duplicate key 23505"))).toBe("relationships.error.failed");
    expect(relationshipErrorFor({ code: "PGRST301" })).toBe("relationships.error.failed");
    expect(relationshipErrorFor(null)).toBe("relationships.error.failed");
    expect(relationshipErrorFor("42501")).toBe("relationships.error.failed");
  });
});
