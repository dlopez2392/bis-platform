import { describe, it, expect, vi, beforeAll } from "vitest";
import { config as loadEnv } from "dotenv";

// `apps/web`'s test script runs with this directory as cwd, and its
// credentials live in `.env.local`, not the `.env` that `dotenv/config`
// loads by default — this file needs the path spelled out.
loadEnv({ path: ".env.local" });

vi.mock("next/headers", () => ({ headers: vi.fn() }));

import { headers } from "next/headers";
import { submitFormAction } from "./actions";
import { signRenderToken, MIN_FILL_MS, RENDER_TOKEN_FIELD } from "@/lib/forms/guards";
import { IDLE } from "./submit-result";
import { serviceDb, createAccount, createForm, updateForm, type FormField } from "@bis/db";

/**
 * Deliberately NOT mocking `@bis/db` here (contrast with `actions.test.ts`,
 * which mocks it entirely). The behavior under test — `fillBlanks` and
 * `setAttribution` in `actions.ts` — reads a contact back with `getContact`
 * and writes it with `updateContact`, and `setAttribution` reaches into
 * `contacts.attribution` directly via the raw `db` client. Neither is
 * reachable through mocks the way the expired-token path is: this needs a
 * real contact row that a second submission genuinely dedupes onto, which
 * only the real dev database can produce.
 *
 * `actions.test.ts`'s only end-to-end path (the happy-path test) submits a
 * single, brand-new lead every time, so `createContact`'s `existing: true`
 * branch — and everything downstream of it — has never actually run.
 */

const FIELDS: FormField[] = [
  { key: "first_name", kind: "core.first_name", label: "First name", required: false },
  { key: "last_name", kind: "core.last_name", label: "Last name", required: false },
  { key: "email", kind: "core.email", label: "Email", required: true },
  { key: "phone", kind: "core.phone", label: "Phone", required: false },
  { key: "company_name", kind: "core.company_name", label: "Company", required: false },
];

function fd(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [k, v] of Object.entries(entries)) formData.set(k, v);
  return formData;
}

/** Throwaway account, cleaned up in `finally` — mirrors packages/db's
 * `withTestAccount`, reimplemented locally because `@bis/db`'s package.json
 * only exports "." (its own test fixtures are not a public subpath). Must
 * never go near the seeded "Test Client One" account. */
async function withTestAccount(fn: (accountId: string) => Promise<void>) {
  const db = serviceDb();
  const orgId = `org_test_${Math.random().toString(36).slice(2, 10)}`;
  const { id: accountId } = await createAccount(
    db, { clerkOrgId: orgId, name: "Fixture Co (returning lead)", actorId: "user_test" });
  try {
    await fn(accountId);
  } finally {
    for (const table of ["events", "form_submissions", "forms", "contacts"]) {
      await db.from(table).delete().eq("account_id", accountId);
    }
    await db.from("accounts").delete().eq("id", accountId);
  }
}

beforeAll(() => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY missing — this suite needs apps/web/.env.local");
  }
});

describe("submitFormAction — returning lead (fillBlanks + setAttribution)", () => {
  it(
    "fills a blank field, never overwrites a populated one, and updates only last-touch attribution",
    async () => {
      vi.mocked(headers).mockResolvedValue(
        new Headers({ "user-agent": "test-agent", "x-forwarded-for": "203.0.113.77" }) as never);

      await withTestAccount(async (accountId) => {
        const db = serviceDb();
        const stamp = Date.now();
        const leadEmail = `returning-lead-${stamp}@example.com`;

        const { id: formId, publicId } = await createForm(
          db, accountId, { name: `Returning Lead Test ${stamp}`, fields: FIELDS }, "user_test");
        await updateForm(db, accountId, formId, { status: "published" }, "user_test");

        // --- First submission: a brand-new lead. Name and email given;
        // phone and company deliberately left blank. -----------------------
        const token1 = signRenderToken(Date.now() - MIN_FILL_MS - 1000, publicId);
        const result1 = await submitFormAction(publicId, IDLE, fd({
          first_name: "Maria",
          last_name: "Garcia",
          email: leadEmail,
          locale: "en",
          attribution: "utm_source=bing",
          [RENDER_TOKEN_FIELD]: token1,
        }));
        expect(result1.status).toBe("success");

        const { data: created, error: createdErr } = await db.from("contacts")
          .select("id, first_name, last_name, phone, company_name")
          .eq("account_id", accountId).eq("email", leadEmail).single();
        expect(createdErr).toBeNull();
        expect(created).toBeTruthy();
        // Sanity on the fixture itself: these must start blank, or "filled
        // from blank" below proves nothing.
        expect(created!.phone).toBeNull();
        expect(created!.company_name).toBeNull();

        // --- Second submission: the same email (must dedupe onto the same
        // contact), a different name (must NOT overwrite), a phone + company
        // (blank -> must fill), and different attribution (last-touch must
        // update, first-touch must survive). ---------------------------------
        const token2 = signRenderToken(Date.now() - MIN_FILL_MS - 1000, publicId);
        const result2 = await submitFormAction(publicId, IDLE, fd({
          first_name: "Someone Else",
          last_name: "Wrong Name",
          email: leadEmail,
          phone: "956-555-0101",
          company_name: "Acme Co",
          locale: "en",
          attribution: "utm_source=google",
          [RENDER_TOKEN_FIELD]: token2,
        }));
        expect(result2.status).toBe("success");

        const { data: rows, error: rowsErr } = await db.from("contacts")
          .select("id, first_name, last_name, phone, company_name, attribution")
          .eq("account_id", accountId).eq("email", leadEmail);
        expect(rowsErr).toBeNull();
        // Deduped onto the same contact — not a second row for the same lead.
        expect(rows).toHaveLength(1);
        const contact = rows![0]!;
        expect(contact.id).toBe(created!.id);

        // Blank fields got filled from the second submission.
        expect(contact.phone).toBe("956-555-0101");
        expect(contact.company_name).toBe("Acme Co");
        // Fields that were already populated survived the second submission's
        // different values untouched.
        expect(contact.first_name).toBe("Maria");
        expect(contact.last_name).toBe("Garcia");
        // First-touch attribution preserved; last-touch updated.
        expect((contact.attribution as Record<string, unknown>).first).toEqual({ utm_source: "bing" });
        expect((contact.attribution as Record<string, unknown>).last).toEqual({ utm_source: "google" });
      });
    },
    30_000,
  );
});
