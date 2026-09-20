import { describe, it, expect } from "vitest";
import type { FormField } from "@bis/db";
import { leadInputSchema, describeLeadFields, leadFields } from "./lead-tool";

const FIELDS: FormField[] = [
  { key: "first_name", kind: "core.first_name", label: "First name", required: true },
  { key: "email", kind: "core.email", label: "Email address", required: true },
  { key: "best_time", kind: "custom.best_time", label: "Best time to call", required: false },
  { key: "sms_consent", kind: "consent", label: "Yes, text me.", required: false },
];

describe("the capture_lead schema is the form", () => {
  it("drops consent, requires the required, and lets the optional be omitted", () => {
    expect(leadFields(FIELDS).map((f) => f.key)).toEqual(["first_name", "email", "best_time"]);
    const schema = leadInputSchema(FIELDS);
    expect(schema.safeParse({ first_name: "Ana", email: "a@b.co" }).success).toBe(true);
    expect(schema.safeParse({ first_name: "", email: "a@b.co" }).success).toBe(false);
    expect(schema.safeParse({ email: "a@b.co" }).success).toBe(false);
    // Consent can never arrive through the tool.
    expect(Object.keys(schema.shape)).not.toContain("sms_consent");
  });
  it("describes the fields for the prompt in the owner's own labels", () => {
    expect(describeLeadFields(FIELDS)).toBe("First name (required); Email address (required); Best time to call (optional)");
  });
});
