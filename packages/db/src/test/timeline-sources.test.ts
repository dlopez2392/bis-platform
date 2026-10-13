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
      const tie = await db.from("notes").update({ created_at: at }).in("id", [ids[1], ids[2]]);
      if (tie.error) throw new Error(`tie update failed: ${tie.error.message}`);
      const older = await db.from("notes").update({ created_at: "2026-10-01T00:00:00+00:00" }).eq("id", ids[0]);
      if (older.error) throw new Error(`older update failed: ${older.error.message}`);
      const first = (await listNotes(db, accountId, ana, { limit: 1 })) as { id: string; created_at: string }[];
      const second = (await listNotes(db, accountId, ana, { limit: 1, before: { v: first[0]!.created_at, id: first[0]!.id } })) as { id: string; created_at: string }[];
      const third = (await listNotes(db, accountId, ana, { limit: 5, before: { v: second[0]!.created_at, id: second[0]!.id } })) as { id: string }[];
      // The page boundary really is a tie: without it the and(...) half is never exercised.
      expect(second[0]!.created_at).toBe(first[0]!.created_at);
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

describe("S-03 part 2b: a household's set, each row naming its own contact_id (spec C6, C8, C13)", () => {
  it("notes: a set reads both people's rows (created_at desc, id desc), each with its own contact_id (probe: drop contact_id from listNotes' select -> undefined, FAILS); a single id still reads exactly that person's rows (probe: route the string through .in([a, b]) -> b's row appears, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const { id: ben } = await createContact(db, accountId, { firstName: "Ben" }, ACTOR);
      const anaNote = await addNote(db, accountId, ana, "ana note", ACTOR);
      const benNote = await addNote(db, accountId, ben, "ben note", ACTOR);
      const older = await db.from("notes").update({ created_at: "2026-10-01T00:00:00+00:00" }).eq("id", anaNote.id);
      if (older.error) throw new Error(`older update failed: ${older.error.message}`);
      const newer = await db.from("notes").update({ created_at: "2026-10-09T00:00:00+00:00" }).eq("id", benNote.id);
      if (newer.error) throw new Error(`newer update failed: ${newer.error.message}`);
      const both = (await listNotes(db, accountId, [ana, ben], { limit: 31 })) as { id: string; contact_id: string }[];
      expect(both.map((n) => ({ id: n.id, contact_id: n.contact_id }))).toEqual([
        { id: benNote.id, contact_id: ben },
        { id: anaNote.id, contact_id: ana },
      ]);
      const anaOnly = (await listNotes(db, accountId, ana, { limit: 31 })) as { id: string }[];
      expect(anaOnly.map((n) => n.id)).toEqual([anaNote.id]);
    }));

  it("To-dos: a set reads both people's rows, each with its own contact_id (probe: drop contact_id from the select -> undefined, FAILS); a single id still reads exactly that person's rows (probe: route the string through .in([a, b]) -> b's row appears, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const { id: ben } = await createContact(db, accountId, { firstName: "Ben" }, ACTOR);
      const anaTask = await addTask(db, accountId, { contactId: ana, title: "Ana task" }, ACTOR);
      const benTask = await addTask(db, accountId, { contactId: ben, title: "Ben task" }, ACTOR);
      const older = await db.from("tasks").update({ created_at: "2026-10-01T00:00:00+00:00" }).eq("id", anaTask.id);
      if (older.error) throw new Error(`older update failed: ${older.error.message}`);
      const newer = await db.from("tasks").update({ created_at: "2026-10-09T00:00:00+00:00" }).eq("id", benTask.id);
      if (newer.error) throw new Error(`newer update failed: ${newer.error.message}`);
      const both = await listContactTasks(db, accountId, [ana, ben], { limit: 31 });
      expect(both.map((t) => ({ id: t.id, contact_id: t.contact_id }))).toEqual([
        { id: benTask.id, contact_id: ben },
        { id: anaTask.id, contact_id: ana },
      ]);
      const anaOnly = await listContactTasks(db, accountId, ana, { limit: 31 });
      expect(anaOnly.map((t) => t.id)).toEqual([anaTask.id]);
    }));

  it("deals: a set reads both people's open rows, each with its own contact_id (probe: drop contact_id from the select -> undefined, FAILS); a single id still reads exactly that person's rows (probe: route the string through .in([a, b]) -> b's row appears, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const { id: ben } = await createContact(db, accountId, { firstName: "Ben" }, ACTOR);
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      const anaDeal = await createOpportunity(db, accountId, { contactId: ana, pipelineId, name: "Ana deal", value: 100 }, ACTOR);
      const benDeal = await createOpportunity(db, accountId, { contactId: ben, pipelineId, name: "Ben deal", value: 200 }, ACTOR);
      const older = await db.from("opportunities").update({ created_at: "2026-10-01T00:00:00+00:00" }).eq("id", anaDeal.id);
      if (older.error) throw new Error(`older update failed: ${older.error.message}`);
      const newer = await db.from("opportunities").update({ created_at: "2026-10-09T00:00:00+00:00" }).eq("id", benDeal.id);
      if (newer.error) throw new Error(`newer update failed: ${newer.error.message}`);
      const both = (await listContactOpportunities(db, accountId, [ana, ben], { limit: 31 })) as { id: string; contact_id: string }[];
      expect(both.map((d) => ({ id: d.id, contact_id: d.contact_id }))).toEqual([
        { id: benDeal.id, contact_id: ben },
        { id: anaDeal.id, contact_id: ana },
      ]);
      const anaOnly = (await listContactOpportunities(db, accountId, ana, { limit: 31 })) as { id: string }[];
      expect(anaOnly.map((d) => d.id)).toEqual([anaDeal.id]);
    }));

  it("submissions: a set reads both people's rows, each with its own contact_id; a single id still reads exactly that person's rows (probe: route the string through .in([a, b]) -> b's row appears, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const { id: ben } = await createContact(db, accountId, { firstName: "Ben" }, ACTOR);
      const form = await createForm(db, accountId, { name: "Quote request" }, ACTOR);
      const anaSub = await createSubmission(db, accountId, form.id, { answers: [] });
      const benSub = await createSubmission(db, accountId, form.id, { answers: [] });
      await linkSubmissionContact(db, accountId, anaSub.id, ana);
      await linkSubmissionContact(db, accountId, benSub.id, ben);
      const older = await db.from("form_submissions").update({ created_at: "2026-10-01T00:00:00+00:00" }).eq("id", anaSub.id);
      if (older.error) throw new Error(`older update failed: ${older.error.message}`);
      const newer = await db.from("form_submissions").update({ created_at: "2026-10-09T00:00:00+00:00" }).eq("id", benSub.id);
      if (newer.error) throw new Error(`newer update failed: ${newer.error.message}`);
      const both = await listContactSubmissions(db, accountId, [ana, ben], { limit: 31 });
      expect(both.map((s) => ({ id: s.id, contact_id: s.contact_id }))).toEqual([
        { id: benSub.id, contact_id: ben },
        { id: anaSub.id, contact_id: ana },
      ]);
      const anaOnly = await listContactSubmissions(db, accountId, ana, { limit: 31 });
      expect(anaOnly.map((s) => s.id)).toEqual([anaSub.id]);
    }));

  it("every one of the four sources refuses a set with no page: the drawer always passes a single id (probe: drop the guard -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const { id: ben } = await createContact(db, accountId, { firstName: "Ben" }, ACTOR);
      await expect(listNotes(db, accountId, [ana, ben])).rejects.toThrow("a set needs a page");
      await expect(listContactTasks(db, accountId, [ana, ben])).rejects.toThrow("a set needs a page");
      await expect(listContactOpportunities(db, accountId, [ana, ben])).rejects.toThrow("a set needs a page");
      await expect(listContactSubmissions(db, accountId, [ana, ben])).rejects.toThrow("a set needs a page");
    }));
});
