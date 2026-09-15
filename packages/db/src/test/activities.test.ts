import "dotenv/config";
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { addNote, listNotes, addTask, listContactTasks, completeTask, reopenTask } from "../activities";

describe("notes + tasks", () => {
  it("note round-trip with event", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "N" }, "user_test");
      await addNote(db, accountId, contactId, "called, wants a quote", "user_test");
      const notes = await listNotes(db, accountId, contactId);
      expect(notes).toHaveLength(1);
      expect(notes[0]!.body).toContain("quote");
      const { data: ev } = await db.from("events").select("type")
        .eq("account_id", accountId).eq("type", "note.created");
      expect(ev).toHaveLength(1);
    }));

  it("task create + complete with events", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "T" }, "user_test");
      const { id: taskId } = await addTask(db, accountId, { contactId, title: "send quote" }, "user_test");
      await completeTask(db, accountId, taskId, "user_test");
      const tasks = await listContactTasks(db, accountId, contactId);
      expect(tasks[0]!.completed_at).not.toBeNull();
      const { data: ev } = await db.from("events").select("type").eq("account_id", accountId)
        .in("type", ["task.created", "task.completed"]);
      expect(ev).toHaveLength(2);
    }));

  // "Done" needs a real undo (DESIGN.md rule 6: reversible actions get an
  // undo toast) — this is the reverse operation the undo button calls.
  it("task reopen clears completed_at and emits its own event", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "R" }, "user_test");
      const { id: taskId } = await addTask(db, accountId, { contactId, title: "call back" }, "user_test");
      await completeTask(db, accountId, taskId, "user_test");
      await reopenTask(db, accountId, taskId, "user_test");
      const tasks = await listContactTasks(db, accountId, contactId);
      expect(tasks[0]!.completed_at).toBeNull();
      const { data: ev } = await db.from("events").select("type").eq("account_id", accountId)
        .in("type", ["task.created", "task.completed", "task.reopened"]);
      expect(ev).toHaveLength(3);
    }));
});
