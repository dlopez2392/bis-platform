import { describe, it, expect } from "vitest";
import { formLangDefault } from "./data";
import type { FormRow } from "@bis/db";

const form = (locale_default: "en" | "es"): FormRow => ({
  id: "f1", account_id: "a1", public_id: "p1", name: "N", status: "draft",
  fields: [], theme: {}, success_mode: "message", success_message: null,
  redirect_url: null, notify_emails: [], locale_default,
  created_at: "", updated_at: "",
});

describe("formLangDefault", () => {
  it("reads the form's own locale_default even for a draft", () => {
    expect(formLangDefault(form("es"))).toBe("es");
    expect(formLangDefault(form("en"))).toBe("en");
  });

  it("falls back to en when the form is unknown (null)", () => {
    // MUTATION: default to "es" instead -- this FAILS, since embed.js's
    // own default and every unbranded account's default are English.
    expect(formLangDefault(null)).toBe("en");
  });
});
