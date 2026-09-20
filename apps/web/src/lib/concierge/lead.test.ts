import { describe, it, expect, vi, beforeEach } from "vitest";

// `vi.mock` is HOISTED above every `const` in this file — the pattern already
// established in `api/concierge/[publicId]/turn/route.test.ts`.
const dbFns = vi.hoisted(() => ({
  getForm: vi.fn(),
  createSubmission: vi.fn(),
  setConciergeSubmission: vi.fn(),
}));
const enrichMock = vi.hoisted(() => vi.fn());

vi.mock("@bis/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bis/db")>();
  return {
    ...actual,
    getForm: (...a: unknown[]) => dbFns.getForm(...a),
    createSubmission: (...a: unknown[]) => dbFns.createSubmission(...a),
    setConciergeSubmission: (...a: unknown[]) => dbFns.setConciergeSubmission(...a),
  };
});
vi.mock("@/lib/forms/enrich", () => ({ enrich: enrichMock }));

import { fileLead, type Db } from "./lead";

/**
 * `fileLead`'s own `ctx.db` is used for exactly ONE thing inside this
 * function — the orphan-cleanup delete when a concurrent turn already
 * claimed the submission slot. Everything else about persistence
 * (`getForm`/`createSubmission`/`setConciergeSubmission`) goes through the
 * mocked `@bis/db` exports above, so this fake only needs to answer
 * `.from("form_submissions").delete().eq().eq()` and record what it saw —
 * the same shape `route.test.ts`'s `dbSpy.deletes` captures, scoped to this
 * file instead of shared across the whole route suite.
 */
function fakeDb() {
  const deletes: { table: string; eq: [string, unknown][] }[] = [];
  const db = {
    from: (table: string) => {
      const record = { table, eq: [] as [string, unknown][] };
      deletes.push(record);
      const chain = {
        eq: (col: string, val: unknown) => { record.eq.push([col, val]); return chain; },
        then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
      };
      return { delete: () => chain };
    },
  } as unknown as Db;
  return { db, deletes };
}

// DISTINCT literals throughout — the whole reason this extraction exists.
// "form-then" is the form `fileLead` was GIVEN (the conversation's own,
// captured at conversation start); "acct-A" never collides with any other id
// used below; the origin is a real, non-null value, never the sandboxed
// iframe's literal "null" or an empty string a bug could silently produce.
const CTX = {
  accountId: "acct-A",
  formId: "form-then",
  conversationId: "conv-1",
  attribution: { utm_source: "google" },
  locale: "en" as const,
  ipHash: "hash-1",
  origin: "https://app.example",
  lead: { fullName: "Ana García", email: "ana@x.co", phone: "", need: "a table" },
};

const LEAD_FORM = {
  id: "form-then", account_id: "acct-A", public_id: "f", name: "Leads",
  status: "published" as const,
  fields: [
    { key: "n", kind: "core.first_name" as const, label: "First name", required: true },
    { key: "l", kind: "core.last_name" as const, label: "Last name", required: false },
    { key: "e", kind: "core.email" as const, label: "Email", required: false },
    { key: "m", kind: "message" as const, label: "What do you need?", required: false },
  ],
  theme: {}, success_mode: "message" as const, success_message: null,
  redirect_url: null, notify_emails: ["op@x.co"], locale_default: "en" as const,
  created_at: "", updated_at: "",
};

// A SECOND, distinct form fixture — the general fixture above deliberately
// carries no consent field ("that is the point" of route.test.ts's own
// comment on it), so the shape of a form that HAS one needs its own literal.
const CONSENT_FORM = {
  ...LEAD_FORM,
  fields: [
    ...LEAD_FORM.fields,
    { key: "c", kind: "consent" as const, label: "I agree to be texted about my request", required: false },
  ],
};

beforeEach(() => {
  for (const fn of Object.values(dbFns)) fn.mockReset();
  enrichMock.mockReset();
  dbFns.getForm.mockResolvedValue(LEAD_FORM);
  dbFns.createSubmission.mockResolvedValue({ id: "sub-1" });
  dbFns.setConciergeSubmission.mockResolvedValue(true);
  enrichMock.mockResolvedValue(undefined);
});

describe("fileLead", () => {
  it("files against the form id it was GIVEN, never any other value in scope", async () => {
    const { db } = fakeDb();
    await fileLead({ db, ...CTX });
    // fileLead has no profile row of its own to read a form id from — which
    // form to file against is the CALLER's decision (route.ts passes the
    // conversation's own form_id, never profile.concierge_form_id) — so the
    // property this proves is that ctx.formId flows through UNCHANGED.
    // MUTATION: hard-code a different literal ("form-now") in place of
    // ctx.formId inside fileLead's own getForm call — this FAILS.
    expect(dbFns.getForm).toHaveBeenCalledWith(db, "acct-A", "form-then");
  });

  it("passes the caller's origin to enrich as the sixth argument, verbatim", async () => {
    const { db } = fakeDb();
    await fileLead({ db, ...CTX });
    expect(enrichMock).toHaveBeenCalledTimes(1);
    const call = enrichMock.mock.calls[0]!;
    // enrich(db, form, submissionId, answers, attribution, origin, locale, consentWithheld)
    // MUTATION: pass null in place of ctx.origin — this FAILS.
    expect(call[5]).toBe("https://app.example");
  });

  it("passes consentWithheld TRUE regardless of the form's fields", async () => {
    const { db } = fakeDb();
    await fileLead({ db, ...CTX });
    const call = enrichMock.mock.calls[0]!;
    // MUTATION: derive it from `form.fields.some(f => f.kind === "consent")`
    // (LEAD_FORM has none, so this would flip to false) — this FAILS, and a
    // widget lead on a form WITHOUT a consent field would trigger an
    // automatic text nobody agreed to.
    expect(call[7]).toBe(true);
  });

  it("returns false and deletes the orphan when the slot was already claimed", async () => {
    dbFns.setConciergeSubmission.mockResolvedValue(false);
    const { db, deletes } = fakeDb();
    const result = await fileLead({ db, ...CTX });
    expect(result).toBe(false);
    expect(enrichMock).not.toHaveBeenCalled();
    // The row was written BEFORE the claim (setConciergeSubmission needs its
    // id), so the loser has to clean up after itself.
    // MUTATION: skip the delete branch entirely — this FAILS, `deletes` stays
    // `[]`, and a lead-shaped row with no contact, no thread and no alert is
    // left behind forever, inflating the form's submission count.
    expect(deletes).toEqual([
      { table: "form_submissions", eq: [["id", "sub-1"], ["account_id", "acct-A"]] },
    ]);
  });

  it("returns false without touching enrich when the form is not published", async () => {
    dbFns.getForm.mockResolvedValue({ ...LEAD_FORM, status: "draft" as const });
    const { db } = fakeDb();
    const result = await fileLead({ db, ...CTX });
    expect(result).toBe(false);
    expect(dbFns.createSubmission).not.toHaveBeenCalled();
    // MUTATION: drop the `form.status !== "published"` half of the guard —
    // this FAILS, and a draft form's lead reaches enrich.
    expect(enrichMock).not.toHaveBeenCalled();
  });

  it("writes consent NULL, not [], when the form carries no consent field at all", async () => {
    // Item 10's other half — previously unasserted: every other test in this
    // file runs against LEAD_FORM (no consent field) but none checked what
    // `consent` actually carries, so `lead.ts` collapsing to `[]` unconditionally
    // would have passed every test here.
    const { db } = fakeDb();
    await fileLead({ db, ...CTX });
    const [, , , input] = dbFns.createSubmission.mock.calls[0]! as [
      unknown, unknown, unknown, { consent: unknown },
    ];
    // MUTATION: replace `null` with `[]` in lead.ts's `consent` fallback —
    // this FAILS, and an operator reading the row can no longer tell "this
    // form has no consent field" from "the visitor never ticked it".
    expect(input.consent).toBeNull();
  });

  it("writes consent in #99's shape — every consent field given:false — not []", async () => {
    dbFns.getForm.mockResolvedValue(CONSENT_FORM);
    const { db } = fakeDb();
    await fileLead({ db, ...CTX });
    const [, , , input] = dbFns.createSubmission.mock.calls[0]! as [
      unknown, unknown, unknown, { consent: unknown },
    ];
    // MUTATION: revert to the route's old literal `consent: []` — this
    // FAILS, and an operator reading the row can no longer tell "this form
    // has no consent field" from "the visitor never ticked it".
    expect(input.consent).toEqual([
      { key: "c", given: false, text: "I agree to be texted about my request", at: expect.any(String) },
    ]);
  });
});
