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
      // The exact MULTISET, not just a count: counting three rows across
      // three permitted types is blind to the regression this test is named
      // for — if reopen emitted a sibling "task.completed" instead of its
      // own "task.reopened", the `.in()` filter below would still return
      // three rows (two "task.completed" + one "task.created") and a bare
      // `toHaveLength(3)` would stay green. Sorting and comparing the exact
      // list of types catches that: the mutant's list has two
      // "task.completed" entries and zero "task.reopened", so it fails this
      // assertion where the old length check did not.
      const { data: ev } = await db.from("events").select("type").eq("account_id", accountId)
        .in("type", ["task.created", "task.completed", "task.reopened"]);
      expect(ev?.map((e) => e.type).sort()).toEqual(
        ["task.completed", "task.created", "task.reopened"],
      );
    }));

  it("reopenTask throws rather than silently no-op-ing when nothing matched", () =>
    withTestAccount(async (db, accountId) => {
      // Mirrors `setBookingStatus`'s own shape (booking.ts): select the id
      // back and throw when the update matched zero rows, rather than
      // resolving success for a write that touched nothing. Undo is the one
      // path where a silent no-op is user-visible — the toast says "undone"
      // while the task stays completed forever.
      await expect(
        reopenTask(db, accountId, "00000000-0000-0000-0000-000000000000", "user_test"),
      ).rejects.toThrow(/reopenTask/);
    }));
});
