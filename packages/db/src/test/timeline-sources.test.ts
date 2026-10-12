import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { addNote, listNotes, addTask, listContactTasks } from "../activities";
import { ensureDefaultPipeline } from "../crm-config";
import { createOpportunity, listContactOpportunities } from "../opportunities";
import { createForm, createSubmission, linkSubmissionContact, listContactSubmissions } from "../forms";

const ACTOR = "user_test";

describe("the bis-crm timeline sources, paged (S-03 1b, spec §7, C3)", () => {
  it("notes page by (created_at desc, id desc); two notes at one instant split across pages are neither lost nor repeated (mutation: drop the and(...) half of the cursor filter -> the tied note is lost, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const ids: string[] = [];
      for (const body of ["one", "two", "three"]) ids.push((await addNote(db, accountId, ana, body, ACTOR)).id);
      const at = "2026-10-09T16:12:00.123456+00:00";
      await db.from("notes").update({ created_at: at }).in("id", [ids[1], ids[2]]);
      await db.from("notes").update({ created_at: "2026-10-01T00:00:00+00:00" }).eq("id", ids[0]);
      const first = (await listNotes(db, accountId, ana, { limit: 1 })) as { id: string; created_at: string }[];
      const second = (await listNotes(db, accountId, ana, { limit: 1, before: { v: first[0]!.created_at, id: first[0]!.id } })) as { id: string; created_at: string }[];
      const third = (await listNotes(db, accountId, ana, { limit: 5, before: { v: second[0]!.created_at, id: second[0]!.id } })) as { id: string }[];
      const tied = [ids[1]!, ids[2]!].sort().reverse();
      expect([first[0]!.id, second[0]!.id, ...third.map((n) => n.id)]).toEqual([...tied, ids[0]]);
      // No options: today's shape, every note.
      expect(((await listNotes(db, accountId, ana)) ?? []).length).toBe(3);
    }));

  it("To-dos and deals carry who made them in page mode (NULL for the service role, 0071 C8)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      await addTask(db, accountId, { contactId: ana, title: "Order shingles" }, ACTOR);
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      await createOpportunity(db, accountId, { contactId: ana, pipelineId, name: "Deck build", value: 2400 }, ACTOR);
      const tasks = await listContactTasks(db, accountId, ana, { limit: 31 });
      expect(tasks[0]).toMatchObject({ title: "Order shingles", created_by: null });
      const deals = (await listContactOpportunities(db, accountId, ana, { limit: 31 })) as { name: string; created_by: string | null }[];
      expect(deals[0]).toMatchObject({ name: "Deck build", created_by: null });
    }));

  it("a submission says whose it is: the website chat's is the AI's, a typed form the customer's (mutation: drop author_kind from submissionRow -> the chat's reads customer, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const form = await createForm(db, accountId, { name: "Quote request" }, ACTOR);
      const chat = await createSubmission(db, accountId, form.id, { answers: [], authorKind: "ai" });
      const typed = await createSubmission(db, accountId, form.id, { answers: [] });
      await linkSubmissionContact(db, accountId, chat.id, ana);
      await linkSubmissionContact(db, accountId, typed.id, ana);
      const rows = await listContactSubmissions(db, accountId, ana, { limit: 31 });
      const kindOf = (id: string) => rows.find((r) => r.id === id)?.author_kind;
      expect([kindOf(chat.id), kindOf(typed.id)]).toEqual(["ai", "customer"]);
      expect(rows.every((r) => r.formName === "Quote request")).toBe(true);
    }));
});
