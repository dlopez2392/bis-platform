import { describe, it, expect, vi, beforeEach } from "vitest";

// saveFormAction calls revalidatePath on every success path, and outside a
// real request it throws ("static generation store missing") rather than
// no-op'ing — same mock branding/actions.test.ts and settings/actions.test.ts
// carry for the same reason.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const dbMocks = vi.hoisted(() => ({
  createForm: vi.fn(),
  getForm: vi.fn(),
  updateForm: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks,
}));

// A real vi.fn() (not a bare async arrow) so a test can assert the auth
// check actually ran — same reasoning branding/actions.test.ts's own comment
// gives for this shape.
const authMocks = vi.hoisted(() => ({
  requireAccountAccess: vi.fn(async () => ({ userId: "user_1" })),
}));
vi.mock("@/lib/auth", () => authMocks);

// saveFormAction's own dbForRequest() result only ever flows straight into
// the (mocked) getForm/updateForm calls, so a tagged placeholder is enough —
// same reasoning branding/actions.test.ts's own comment gives for this shape.
const dbForRequestInstance = { tag: "dbForRequest" };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => dbForRequestInstance }));

import { m } from "@/lib/messages";
import { saveFormAction, republishFormAction } from "./actions";

const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [key, value] of Object.entries(fields)) f.set(key, value);
  return f;
};

const BASE_FORM = {
  id: "form_1", account_id: "acct_1", public_id: "pub_1", name: "Quote request",
  status: "draft" as const, fields: [], theme: {}, success_mode: "message" as const,
  success_message: null, redirect_url: null, notify_emails: [] as string[],
  locale_default: "en" as const, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  authMocks.requireAccountAccess.mockReset().mockResolvedValue({ userId: "user_1" });
  dbMocks.getForm.mockReset().mockResolvedValue({ ...BASE_FORM });
  dbMocks.updateForm.mockReset().mockResolvedValue(undefined);
});

// D-024: a mistyped notify address or redirect URL used to fail the save by
// THROWING — which form-editor.tsx's catch block reduced to the one generic
// "Could not save the form." toast, and which a production Next.js deploy
// reduces to an opaque digest before the client ever sees it at all. The
// house pattern for a user-fixable validation failure is a RETURNED
// { ok: false, error } the caller can show verbatim (see
// settings/actions.ts's setReportEmailsAction beside this).
describe("saveFormAction — field-level errors instead of a swallowed throw (D-024)", () => {
  it("returns the specific invalid-notify-email message instead of throwing it away (mutation: keep `throw new Error(...)` → rejects instead of resolving, FAILS)", async () => {
    const result = await saveFormAction("acct_1", fd({
      formId: "form_1", fields: "[]", status: "draft",
      notifyEmails: "not-an-email",
    }));
    expect(result).toEqual({
      ok: false, error: m["forms.invalidNotifyEmail"].replace("{value}", "not-an-email"),
    });
    expect(dbMocks.updateForm).not.toHaveBeenCalled();
  });

  it("returns the specific invalid-redirect-url message instead of throwing it away (mutation: keep `throw new Error(...)` → rejects instead of resolving, FAILS)", async () => {
    const result = await saveFormAction("acct_1", fd({
      formId: "form_1", fields: "[]", status: "draft",
      successMode: "redirect", redirectUrl: "javascript:alert(1)",
    }));
    expect(result).toEqual({ ok: false, error: m["forms.invalidRedirectUrl"] });
    expect(dbMocks.updateForm).not.toHaveBeenCalled();
  });

  it("returns the invalid-fields message for a tampered fields payload, instead of throwing (mutation: keep the throw → FAILS)", async () => {
    const result = await saveFormAction("acct_1", fd({
      formId: "form_1", fields: "[{}]", status: "draft",
    }));
    expect(result).toEqual({ ok: false, error: m["forms.invalidFields"] });
    expect(dbMocks.updateForm).not.toHaveBeenCalled();
  });

  it("returns the needs-a-field message when publishing with no fields, instead of throwing a raw string (mutation: keep the throw → FAILS)", async () => {
    const result = await saveFormAction("acct_1", fd({
      formId: "form_1", fields: "[]", status: "published",
    }));
    expect(result).toEqual({ ok: false, error: m["forms.noFields"] });
    expect(dbMocks.updateForm).not.toHaveBeenCalled();
  });

  it("still reports ok and writes the form on a valid submit", async () => {
    const result = await saveFormAction("acct_1", fd({
      formId: "form_1", fields: "[]", status: "draft",
      notifyEmails: "owner@example.com",
    }));
    expect(result).toEqual({ ok: true });
    expect(dbMocks.updateForm).toHaveBeenCalledWith(
      dbForRequestInstance, "acct_1", "form_1",
      expect.objectContaining({ notify_emails: ["owner@example.com"] }),
      "user_1",
    );
  });
});

// Owner context (forms tracker batch 4): the Undo half of the Forms page's
// unpublish warning. Deliberately narrower than saveFormAction — it writes
// ONLY status, so clicking Undo on the toast can never clobber whatever
// else the operator changed in the same save that triggered the warning.
describe("republishFormAction", () => {
  it("writes only status back to published (mutation: pass through the rest of the row too → FAILS)", async () => {
    const result = await republishFormAction("acct_1", "form_1");
    expect(result).toEqual({ ok: true });
    expect(dbMocks.updateForm).toHaveBeenCalledWith(
      dbForRequestInstance, "acct_1", "form_1", { status: "published" }, "user_1",
    );
  });

  it("checks account access before writing (mutation: drop the guard call → FAILS)", async () => {
    await republishFormAction("acct_1", "form_1");
    expect(authMocks.requireAccountAccess).toHaveBeenCalledWith("acct_1");
  });

  it("reports a plain failure instead of throwing when the update fails (mutation: let it reject → FAILS)", async () => {
    dbMocks.updateForm.mockRejectedValueOnce(new Error("updateForm failed: form not found in account"));
    const result = await republishFormAction("acct_1", "form_1");
    expect(result).toEqual({ ok: false, error: m["forms.republishFailed"] });
  });
});
