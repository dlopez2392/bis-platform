import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { withTestAccount } from "./fixtures";
import { withRollback, actAs } from "./db";
import { upsertVoiceProfile } from "../voice";
import {
  newPublicId, createForm, listForms, getForm, getPublishedFormByPublicId,
  getFormByPublicId, isFormLive, updateForm,
  countFormsMissingNotify, listSubmissionCreationsBetween,
  findConciergeDestinationName,
} from "../forms";

const FIELDS = [
  { key: "name", kind: "core.first_name" as const, label: "Full name", required: true },
  { key: "email", kind: "core.email" as const, label: "Email", required: true },
  { key: "msg", kind: "message" as const, label: "Your message", required: false },
];

describe("forms", () => {
  it("newPublicId is url-safe and long enough to not be guessable", () => {
    const id = newPublicId();
    // The alphabet deliberately drops the characters a person misreads when
    // copying an id off a screen or a phone call: l/1, o/0. Spell the class
    // out rather than [a-z2-9], which still admits l and o and so would pass
    // even if the exclusion were dropped.
    expect(id).toMatch(/^[a-km-np-z2-9]{12}$/);
    expect(newPublicId()).not.toBe(id);
    // One id is 12 draws from 32 characters, so a single sample has a ~68%
    // chance of containing no ambiguous character by luck alone. Sample enough
    // to make that vanishingly unlikely.
    const many = Array.from({ length: 200 }, () => newPublicId()).join("");
    expect(many).not.toMatch(/[lo01]/);
  });

  it("createForm starts as a draft and emits form.created", () =>
    withTestAccount(async (db, accountId) => {
      const { id, publicId } = await createForm(
        db, accountId, { name: "Quote Request", fields: FIELDS }, "user_test");

      const form = await getForm(db, accountId, id);
      expect(form!.status).toBe("draft");
      expect(form!.public_id).toBe(publicId);
      expect(form!.fields).toHaveLength(3);
      expect(form!.locale_default).toBe("en");

      const { data: ev } = await db.from("events").select("type, actor_type")
        .eq("account_id", accountId).eq("type", "form.created");
      expect(ev).toHaveLength(1);
      expect(ev![0]!.actor_type).toBe("user");
    }));

  it("getPublishedFormByPublicId ignores drafts and archived forms", () =>
    withTestAccount(async (db, accountId) => {
      const { id, publicId } = await createForm(
        db, accountId, { name: "Quote Request", fields: FIELDS }, "user_test");

      expect(await getPublishedFormByPublicId(db, publicId)).toBeNull();

      await updateForm(db, accountId, id, { status: "published" }, "user_test");
      const live = await getPublishedFormByPublicId(db, publicId);
      expect(live!.account_id).toBe(accountId);
      expect(live!.name).toBe("Quote Request");

      await updateForm(db, accountId, id, { status: "archived" }, "user_test");
      expect(await getPublishedFormByPublicId(db, publicId)).toBeNull();
    }));

  // F-102: the public `/f/<publicId>` layout needs a document's own
  // account_id and locale_default to paint a branded, correctly-`lang`
  // not-found page EVEN for a draft or archived form — `lang` and
  // branding decisions happen above the page's own status check (see
  // `app/f/[publicId]/layout.tsx`), so they need the row regardless of
  // status. `getPublishedFormByPublicId` cannot be reused for this: it
  // is the one accessor allowed to 404-before-the-caller-sees-it, and
  // widening ITS filter would un-404 every draft form on the live page.
  it("getFormByPublicId returns a draft or archived form (unlike getPublishedFormByPublicId), but still null for an unknown id", () =>
    withTestAccount(async (db, accountId) => {
      const { id, publicId } = await createForm(
        db, accountId, { name: "Quote Request", fields: FIELDS }, "user_test");

      // MUTATION: add `.eq("status", "published")` to getFormByPublicId's
      // query (copy getPublishedFormByPublicId's filter) -- this FAILS.
      const draft = await getFormByPublicId(db, publicId);
      expect(draft!.status).toBe("draft");
      expect(draft!.account_id).toBe(accountId);
      expect(draft!.locale_default).toBe("en");

      await updateForm(db, accountId, id, { status: "archived" }, "user_test");
      expect((await getFormByPublicId(db, publicId))!.status).toBe("archived");

      expect(await getFormByPublicId(db, "no-such-public-id")).toBeNull();
    }));

  // Direct, DB-free unit test for the predicate `page.tsx` and
  // `layout.tsx` both apply against the SAME row returned by
  // `getFormByPublicId` (F-102 review round, fix 2) — a reviewer found that
  // mutating this one function is invisible to every test that only
  // exercises it indirectly through a page/layout render.
  it("isFormLive is true only for status 'published'", () => {
    // MUTATION: `return true;` unconditionally -- this FAILS on both lines.
    expect(isFormLive({ status: "published" })).toBe(true);
    expect(isFormLive({ status: "draft" })).toBe(false);
    expect(isFormLive({ status: "archived" })).toBe(false);
  });

  it("listForms reports a submission count", () =>
    withTestAccount(async (db, accountId) => {
      const { id } = await createForm(db, accountId, { name: "A", fields: FIELDS }, "user_test");
      await db.from("form_submissions").insert({ account_id: accountId, form_id: id, answers: [] });

      const [summary] = await listForms(db, accountId);
      expect(summary!.submissionCount).toBe(1);
    }));

  it("listForms excludes blocked (spam_reason set) rows from the submission count", () =>
    withTestAccount(async (db, accountId) => {
      const { id } = await createForm(db, accountId, { name: "A", fields: FIELDS }, "user_test");
      await db.from("form_submissions").insert([
        { account_id: accountId, form_id: id, answers: [] },
        { account_id: accountId, form_id: id, answers: [] },
        { account_id: accountId, form_id: id, answers: [], spam_reason: "honeypot" },
        { account_id: accountId, form_id: id, answers: [], spam_reason: "too_fast" },
        { account_id: accountId, form_id: id, answers: [], spam_reason: "rate_limited" },
      ]);

      const [summary] = await listForms(db, accountId);
      // 5 rows total in the table, only 2 are genuine.
      expect(summary!.submissionCount).toBe(2);
    }));

  it("listForms still lists a form with zero genuine submissions among blocked-only rows", () =>
    withTestAccount(async (db, accountId) => {
      const { id } = await createForm(db, accountId, { name: "All blocked", fields: FIELDS }, "user_test");
      await db.from("form_submissions").insert({
        account_id: accountId, form_id: id, answers: [], spam_reason: "honeypot",
      });

      // The form itself must not disappear from the list just because none of
      // its submissions were genuine — only the count should read 0.
      const summaries = await listForms(db, accountId);
      const mine = summaries.find((s) => s.id === id);
      expect(mine).toBeDefined();
      expect(mine!.submissionCount).toBe(0);
    }));

  it("updateForm cannot reach a form in another account", () =>
    withTestAccount(async (db, accountId) => {
      const { id } = await createForm(db, accountId, { name: "A", fields: FIELDS }, "user_test");
      await expect(
        updateForm(db, "00000000-0000-0000-0000-000000000000", id, { name: "X" }, "user_test"),
      ).rejects.toThrow(/not found/i);
      expect((await getForm(db, accountId, id))!.name).toBe("A");
    }));

  it("countFormsMissingNotify counts only PUBLISHED forms whose notify_emails is still empty", () =>
    withTestAccount(async (db, accountId) => {
      const { id: bareId } = await createForm(db, accountId, { name: "No notify" }, "user_test");
      const { id: notifiedId } = await createForm(db, accountId, { name: "Notified" }, "user_test");
      // Both forms are live, so the count below reflects notify_emails alone,
      // never status — that half of the behaviour has its own test below.
      await updateForm(db, accountId, bareId, { status: "published" }, "user_test");
      await updateForm(db, accountId, notifiedId, { status: "published" }, "user_test");

      // Both forms start with the schema default '{}' — count reflects that.
      expect(await countFormsMissingNotify(db, accountId)).toBe(2);

      await updateForm(db, accountId, notifiedId, { notify_emails: ["owner@example.com"] }, "user_test");
      expect(await countFormsMissingNotify(db, accountId)).toBe(1);

      // Clearing it back to empty must be visible too — proves the query
      // reads live state, not just the schema default.
      await updateForm(db, accountId, notifiedId, { notify_emails: [] }, "user_test");
      expect(await countFormsMissingNotify(db, accountId)).toBe(2);
      // Both forms present, neither miscounted as the other's account.
      expect(await getForm(db, accountId, bareId)).not.toBeNull();
    }));

  // D-026: a form that cannot yet (draft) or can no longer (archived) receive
  // a real submission was still blocking the checklist's "set a notify
  // address" item — an operator could never clear the warning for a form
  // they have deliberately not published, or has already retired.
  it("countFormsMissingNotify excludes drafts and archived forms, even with an empty notify list", () =>
    withTestAccount(async (db, accountId) => {
      const { id: draftId } = await createForm(db, accountId, { name: "Still drafting" }, "user_test");
      const { id: archivedId } = await createForm(db, accountId, { name: "Retired" }, "user_test");
      await updateForm(db, accountId, archivedId, { status: "archived" }, "user_test");

      // Neither form is live, so neither should count against the checklist.
      expect(await countFormsMissingNotify(db, accountId)).toBe(0);

      const { id: publishedId } = await createForm(db, accountId, { name: "Live" }, "user_test");
      await updateForm(db, accountId, publishedId, { status: "published" }, "user_test");
      expect(await countFormsMissingNotify(db, accountId)).toBe(1);

      expect(await getForm(db, accountId, draftId)).not.toBeNull();
    }));

  // Owner context (forms tracker batch 4): the Forms page needs to warn an
  // operator before they unpublish a form that a website assistant
  // (voice_profiles.concierge_form_id) files its leads into — this is the
  // read that names the assistant. `upsertVoiceProfile` is voice.ts's own
  // export, read-only here; this file does not own voice.ts, only the
  // query that joins into it from the forms side.
  it("findConciergeDestinationName names the assistant wired to this form, or null when none is (mutation: always return null → FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: formId } = await createForm(db, accountId, { name: "Quote" }, "user_test");
      expect(await findConciergeDestinationName(db, accountId, formId)).toBeNull();

      await upsertVoiceProfile(db, accountId, {
        persona_name: "Ana", concierge_form_id: formId,
      }, "user_test");
      expect(await findConciergeDestinationName(db, accountId, formId)).toBe("Ana");
    }));

  it("findConciergeDestinationName ignores another account's own form/profile pairing (mutation: drop the account_id filter → FAILS)", () =>
    withTestAccount(async (db, accountIdA) =>
      withTestAccount(async (db2, accountIdB) => {
        const { id: formIdA } = await createForm(db, accountIdA, { name: "A's form" }, "user_test");
        await upsertVoiceProfile(db2, accountIdB, {
          persona_name: "Bea",
        }, "user_test");
        // accountIdB's profile never points at formIdA, so this must read null
        // under EITHER account — proving the lookup is account-scoped, not a
        // bare match on concierge_form_id across every tenant's profiles.
        expect(await findConciergeDestinationName(db, accountIdB, formIdA)).toBeNull();
        expect(await findConciergeDestinationName(db, accountIdA, formIdA)).toBeNull();
      })));

  it("RLS hides another tenant's forms from an authenticated caller", () =>
    withRollback(async (c: Client) => {
      const { rows: [agency] } = await c.query("select id from agencies limit 1");
      // client_access_enabled defaults to false (migration 0008); this test
      // reads through the org_id claim, which since 0008 requires the
      // switch to be on for current_account_id() to resolve anything.
      const mk = async (org: string) => {
        const { rows } = await c.query(
          "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$2,true) returning id",
          [agency.id, org]);
        return rows[0].id as string;
      };
      const a = await mk("org_forms_a");
      const b = await mk("org_forms_b");
      for (const [acct, pid] of [[a, "aaaaaaaaaaaa"], [b, "bbbbbbbbbbbb"]] as const) {
        await c.query(
          "insert into forms (account_id, public_id, name) values ($1,$2,'F')", [acct, pid]);
      }

      await actAs(c, { org_id: "org_forms_a" });
      const { rows } = await c.query("select public_id from forms");
      expect(rows.map((r) => r.public_id)).toEqual(["aaaaaaaaaaaa"]);
    }));
});

/**
 * The weekly report's "leads captured" AND the dashboard's CRM-only hero
 * (F-076) both reach `form_submissions` through this one function now —
 * `countRealSubmissionsBetween`, a head-count-only twin with the same
 * predicate, was removed once nothing else called it. A honeypot hit is not
 * a lead and must never inflate a number a client is shown, so the spam
 * predicate is the same one `listForms` already uses for its counts.
 */
describe("listSubmissionCreationsBetween", () => {
  it("real submissions in [from, to), never spam, never the upper bound", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: formId } = await createForm(
        db, accountId, { name: "Weekly", fields: [] }, "user_test");

      const seed = async (createdAt: string, spamReason: string | null) => {
        const { error } = await db.from("form_submissions").insert({
          account_id: accountId, form_id: formId, answers: [], attribution: {},
          spam_reason: spamReason, created_at: createdAt,
        });
        if (error) throw new Error(`seed submission failed: ${error.message}`);
      };

      await seed("2026-03-02T10:00:00Z", null);        // counts
      await seed("2026-03-04T10:00:00Z", null);        // counts
      await seed("2026-03-05T10:00:00Z", "honeypot");  // spam, must not count
      await seed("2026-03-09T00:00:00Z", null);        // on the exclusive bound

      const result = await listSubmissionCreationsBetween(
        db, accountId, "2026-03-02T00:00:00Z", "2026-03-09T00:00:00Z");
      // Epoch-ms comparison, not a string match (same reason
      // booking.test.ts's `listBookingCreationsBetween` suite does this):
      // PostgREST returns a `+00:00`-suffixed timestamp, a different
      // lexical form of the same instant than the ISO string this test
      // seeded with.
      const times = result.map((s) => new Date(s).getTime()).sort();
      expect(times).toEqual([
        new Date("2026-03-02T10:00:00Z").getTime(), new Date("2026-03-04T10:00:00Z").getTime(),
      ].sort());
    });
  });
});
