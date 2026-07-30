import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { withTestAccount } from "./fixtures";
import { withRollback, actAs } from "./db";
import {
  newPublicId, createForm, listForms, getForm, getPublishedFormByPublicId, updateForm,
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

  it("listForms reports a submission count", () =>
    withTestAccount(async (db, accountId) => {
      const { id } = await createForm(db, accountId, { name: "A", fields: FIELDS }, "user_test");
      await db.from("form_submissions").insert({ account_id: accountId, form_id: id, answers: [] });

      const [summary] = await listForms(db, accountId);
      expect(summary!.submissionCount).toBe(1);
    }));

  it("updateForm cannot reach a form in another account", () =>
    withTestAccount(async (db, accountId) => {
      const { id } = await createForm(db, accountId, { name: "A", fields: FIELDS }, "user_test");
      await expect(
        updateForm(db, "00000000-0000-0000-0000-000000000000", id, { name: "X" }, "user_test"),
      ).rejects.toThrow(/not found/i);
      expect((await getForm(db, accountId, id))!.name).toBe("A");
    }));

  it("RLS hides another tenant's forms from an authenticated caller", () =>
    withRollback(async (c: Client) => {
      const { rows: [agency] } = await c.query("select id from agencies limit 1");
      const mk = async (org: string) => {
        const { rows } = await c.query(
          "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,$2) returning id",
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
