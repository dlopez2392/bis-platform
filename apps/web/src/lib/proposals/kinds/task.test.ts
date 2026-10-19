import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseTaskPayload, type Proposal } from "@bis/db/proposal-rules";
import { makeTr } from "@/lib/record/copy";
import type { ApplyCtx, Db, DescribeCtx, EditCtx } from "./types";

const db = vi.hoisted(() => ({
  addTask: vi.fn(), taskAssigneeFor: vi.fn(), readPersonId: vi.fn(), deleteTaskForUndo: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { taskKind } from "./task";

const ZONE = "America/Chicago";
const NOW = new Date("2026-10-19T15:00:00Z");
const en = makeTr("en");
const es = makeTr("es");
const dctx = (tr = en, now = NOW): DescribeCtx => ({ tr, zone: ZONE, stages: {}, now });
const ectx: EditCtx = { zone: ZONE, now: NOW, stages: [], pipelineIdOfDeal: null };
const fakeDb = { tag: "request-client" } as unknown as Db;
const actx: ApplyCtx = { db: fakeDb, accountId: "a1", userId: "user_1", contactId: "c1" };
const stored = { title: "Send the quote", dueAt: "2026-10-21T05:00:00.000Z" };

beforeEach(() => vi.clearAllMocks());

// The read boundary is @bis/db's (toProposal parses every row by kind before a kind sees it; final review
// M-1), so the to-do's parse cases read parseTaskPayload itself.
describe("task: the read boundary (parseTaskPayload)", () => {
  it("accepts a to-do payload and refuses the other kinds' payloads and a wrong title type", () => {
    // Mutation: accept any object -> FAILS on the three refusals.
    expect(parseTaskPayload({ title: "Call back", dueAt: null })).toEqual({ title: "Call back", dueAt: null });
    expect(parseTaskPayload({ field: "phone", value: "+15551234567" })).toBeNull();
    expect(parseTaskPayload({ opportunityId: "o1", fromStageId: "s1", toStageId: "s2" })).toBeNull();
    expect(parseTaskPayload({ title: 5 })).toBeNull();
  });
});

describe("task: describe", () => {
  it("English: the model's title is its own English part, and the due date is a date in the account's zone", () => {
    expect(taskKind.describe(stored, dctx())).toEqual({
      parts: [{ text: "Add a to-do: " }, { text: "Send the quote", lang: "en" }],
      detail: "Due Oct 21, 2026",
      pastDue: false,
    });
  });

  it("Spanish: the words around the title follow the reader, the title stays English (P18)", () => {
    const d = taskKind.describe(stored, dctx(es));
    expect(d.parts).toEqual([{ text: "Agregar un pendiente: " }, { text: "Send the quote", lang: "en" }]);
    expect(d.detail).toBe("Vence el 21 oct 2026");
    expect(d.pastDue).toBe(false);
  });

  it("a due date before the account's local today reads 'Was due' and is past due", () => {
    const past = { title: "Send the quote", dueAt: "2026-10-14T05:00:00.000Z" };
    expect(taskKind.describe(past, dctx())).toMatchObject({ detail: "Was due Oct 14, 2026", pastDue: true });
    expect(taskKind.describe(past, dctx(es))).toMatchObject({ detail: "Vencía el 14 oct 2026", pastDue: true });
  });

  it("compares with the account's local today, not the UTC day (late evening: UTC is already tomorrow)", () => {
    // now = 23:30 on the 19th in Chicago (04:30Z on the 20th); due = the 19th's local midnight.
    // Mutation: compare UTC days -> the 19th is before the 20th -> pastDue true, FAILS.
    const d = taskKind.describe(
      { title: "Send the quote", dueAt: "2026-10-19T05:00:00.000Z" }, dctx(en, new Date("2026-10-20T04:30:00Z")));
    expect(d.pastDue).toBe(false);
    expect(d.detail).toBe("Due Oct 19, 2026");
  });

  it("no due date: no detail, never past due", () => {
    expect(taskKind.describe({ title: "Call", dueAt: null }, dctx())).toMatchObject({ detail: null, pastDue: false });
  });
});

describe("task: validateEdit", () => {
  it("trims the title and stores the date as the first instant of that local day", () => {
    expect(taskKind.validateEdit(stored, { title: "  Call Ana  ", dueAt: "2026-10-25" }, ectx))
      .toEqual({ ok: true, payload: { title: "Call Ana", dueAt: "2026-10-25T05:00:00.000Z" } });
  });

  it("refuses an empty title and one over 200 characters", () => {
    expect(taskKind.validateEdit(stored, { title: "   ", dueAt: "" }, ectx))
      .toEqual({ ok: false, error: { field: "title", key: "suggestions.edit.titleRequired" } });
    expect(taskKind.validateEdit(stored, { title: "x".repeat(201), dueAt: "" }, ectx))
      .toEqual({ ok: false, error: { field: "title", key: "suggestions.edit.titleTooLong" } });
    expect(taskKind.validateEdit(stored, { title: "x".repeat(200), dueAt: "" }, ectx).ok).toBe(true);
  });

  it("refuses a date before the local today or past a year from it; an empty date is no due date", () => {
    const bad = { ok: false, error: { field: "dueAt", key: "suggestions.edit.dueInvalid" } };
    expect(taskKind.validateEdit(stored, { title: "Call", dueAt: "2026-10-18" }, ectx)).toEqual(bad);
    expect(taskKind.validateEdit(stored, { title: "Call", dueAt: "2027-10-20" }, ectx)).toEqual(bad);
    expect(taskKind.validateEdit(stored, { title: "Call", dueAt: "2026-02-30" }, ectx)).toEqual(bad);
    expect(taskKind.validateEdit(stored, { title: "Call", dueAt: "tomorrow" }, ectx)).toEqual(bad);
    expect(taskKind.validateEdit(stored, { title: "Call", dueAt: "2026-10-19" }, ectx).ok).toBe(true);
    expect(taskKind.validateEdit(stored, { title: "Call", dueAt: "2027-10-19" }, ectx).ok).toBe(true);
    expect(taskKind.validateEdit(stored, { title: "Call", dueAt: "" }, ectx))
      .toEqual({ ok: true, payload: { title: "Call", dueAt: null } });
  });

  it("the local today is the account's: 23:30 in Chicago on the 19th accepts the 19th", () => {
    const late: EditCtx = { ...ectx, now: new Date("2026-10-20T04:30:00Z") };
    expect(taskKind.validateEdit(stored, { title: "Call", dueAt: "2026-10-19" }, late))
      .toEqual({ ok: true, payload: { title: "Call", dueAt: "2026-10-19T05:00:00.000Z" } });
  });

  it("reads only title and dueAt: anything else the form posted never reaches the payload (spec probe :352)", () => {
    // Mutation: spread `input` into the result -> the extra keys appear, FAILS.
    const r = taskKind.validateEdit(stored, {
      title: "Call Ana", dueAt: "2026-10-25", field: "email", opportunityId: "o2", fromStageId: "s9",
    }, ectx);
    expect(r).toEqual({ ok: true, payload: { title: "Call Ana", dueAt: "2026-10-25T05:00:00.000Z" } });
  });
});

describe("task: normalise", () => {
  it("an edit that only re-spaces the title and keeps the date normalises equal to the stored payload (accepted, not edited)", () => {
    // The stored title carries the whitespace (a copied row's), because validateEdit already trims the
    // edit's: with the brief's `stored.title + " "`, `normalise = (p) => p` would still compare equal.
    // Mutation: normalise = (p) => p -> " Send the quote" !== "Send the quote", FAILS.
    const spaced = { title: " Send the quote", dueAt: "2026-10-21T05:00:00+00:00" };
    const edit = taskKind.validateEdit(spaced, { title: "Send the quote ", dueAt: "2026-10-21" }, ectx);
    if (!edit.ok) throw new Error("edit refused");
    expect(taskKind.normalise(edit.payload, { zone: ZONE })).toEqual(taskKind.normalise(spaced, { zone: ZONE }));
  });

  // A due date compares as its local DAY in the account's zone (orchestrator ruling: an unchanged date
  // is accepted, not edited). The edits below are what validateEdit stores for the posted date.
  // Mutation: compare instants again -> each "equal" case below FAILS.
  const same = (stored: string, edited: string) =>
    expect(taskKind.normalise({ title: "Call", dueAt: edited }, { zone: ZONE }))
      .toEqual(taskKind.normalise({ title: "Call", dueAt: stored }, { zone: ZONE }));

  it("production's shape: the model's 10:14 instant and the form's same date are the same due date", () => {
    // validateEdit("2026-10-10") in Chicago stores 2026-10-10T05:00:00.000Z.
    same("2026-10-10T10:14:41.761Z", "2026-10-10T05:00:00.000Z");
  });

  // The chain decide runs (spec 4.4 step 5), end to end on a stored row of production's shape: the model's
  // due instant is 10:14Z, not a midnight. The form posts that date untouched; validateEdit stores the
  // day's first instant; normalise must call the two equal, and a different date not.
  // Mutations: normalise compares instants -> the first FAILS; validateEdit stores UTC midnight
  // (`${key}T00:00:00.000Z`, Oct 20 in Chicago) -> the first FAILS.
  it("the chain on production's shape: an untouched 10:14Z date through validateEdit then normalise is the same due date; a new date is not", () => {
    const prod = { title: "Send the quote", dueAt: "2026-10-21T10:14:41.761Z" };
    const untouched = taskKind.validateEdit(prod, { title: "Send the quote", dueAt: "2026-10-21" }, ectx);
    const moved = taskKind.validateEdit(prod, { title: "Send the quote", dueAt: "2026-10-22" }, ectx);
    if (!untouched.ok || !moved.ok) throw new Error("edit refused");
    expect(untouched.payload.dueAt).not.toBe(prod.dueAt);
    expect(taskKind.normalise(untouched.payload, { zone: ZONE })).toEqual(taskKind.normalise(prod, { zone: ZONE }));
    expect(taskKind.normalise(moved.payload, { zone: ZONE })).not.toEqual(taskKind.normalise(prod, { zone: ZONE }));
  });

  it("late evening: 23:30 on Oct 20 in Chicago is Oct 20, not the UTC day's Oct 21", () => {
    same("2026-10-21T04:30:00Z", "2026-10-20T05:00:00.000Z");
    expect(taskKind.normalise({ title: "Call", dueAt: "2026-10-21T05:00:00.000Z" }, { zone: ZONE }))
      .not.toEqual(taskKind.normalise({ title: "Call", dueAt: "2026-10-21T04:30:00Z" }, { zone: ZONE }));
  });

  it("a Havana fall-back day: 00:30 in the second midnight hour is the day whose first instant is 04:00Z", () => {
    // 2026-11-01T05:30Z is 00:30 CST on Nov 1, after the clocks fell back; the day starts at 04:00Z.
    expect(taskKind.normalise({ title: "Call", dueAt: "2026-11-01T05:30:00Z" }, { zone: "America/Havana" }))
      .toEqual({ title: "Call", dueAt: "2026-11-01T04:00:00.000Z" });
  });

  it("refuses a due date that is not a date rather than inventing one", () => {
    expect(() => taskKind.normalise({ title: "Call", dueAt: "next week" }, { zone: ZONE })).toThrow();
  });
});

describe("task: a due date that is not a date", () => {
  it("the read boundary refuses it, so describe and normalise never meet an Invalid Date", () => {
    // Mutation: drop parseTaskPayload's Date.parse check -> "next week" parses, FAILS.
    expect(parseTaskPayload({ title: "Call", dueAt: "next week" })).toBeNull();
    expect(parseTaskPayload({ title: "Call", dueAt: "" })).toBeNull();
    expect(parseTaskPayload({ title: "Call", dueAt: "2026-10-10T10:14:41.761Z" }))
      .toEqual({ title: "Call", dueAt: "2026-10-10T10:14:41.761Z" });
  });
});

describe("task: an edit that keeps a date already past", () => {
  it("is still refused, as a plain Accept of it is (P22)", () => {
    const past = { title: "Call", dueAt: "2026-10-14T05:00:00.000Z" };
    expect(taskKind.validateEdit(past, { title: "Call", dueAt: "2026-10-14" }, ectx))
      .toEqual({ ok: false, error: { field: "dueAt", key: "suggestions.edit.dueInvalid" } });
  });
});

describe("task: toast and target", () => {
  it("has no target and says where it went", () => {
    expect(taskKind.targetKey(stored, "c1")).toBeNull();
    expect(taskKind.toast(stored, en, {})).toBe("Added to your to-do list");
    expect(taskKind.toast(stored, es, {})).toBe("Agregado a sus pendientes");
  });
});

describe("task: apply", () => {
  it("writes through addTask with the assignee taskAssigneeFor chose, and returns what Undo compares", async () => {
    // Mutation: insert into tasks directly -> addTask not called, FAILS (spec probe :351).
    db.readPersonId.mockResolvedValue("person_1");
    db.taskAssigneeFor.mockResolvedValue("person_holder");
    db.addTask.mockResolvedValue({ id: "t1" });
    const applied = await taskKind.apply(actx, stored);
    expect(db.readPersonId).toHaveBeenCalledWith(fakeDb, "a1", "user_1");
    expect(db.taskAssigneeFor).toHaveBeenCalledWith(fakeDb, "a1", "c1", "person_1");
    expect(db.addTask).toHaveBeenCalledWith(fakeDb, "a1",
      { contactId: "c1", title: "Send the quote", dueAt: "2026-10-21T05:00:00.000Z", assignedTo: "person_holder" },
      "user_1");
    expect(applied).toEqual({ ref: { taskId: "t1", title: "Send the quote", dueAt: "2026-10-21T05:00:00.000Z" } });
  });

  it("a to-do with no customer and no due date passes neither", async () => {
    db.readPersonId.mockResolvedValue(null);
    db.taskAssigneeFor.mockResolvedValue(null);
    db.addTask.mockResolvedValue({ id: "t2" });
    await taskKind.apply({ ...actx, contactId: null }, { title: "Call", dueAt: null });
    expect(db.taskAssigneeFor).toHaveBeenCalledWith(fakeDb, "a1", null, null);
    expect(db.addTask).toHaveBeenCalledWith(fakeDb, "a1",
      { contactId: undefined, title: "Call", dueAt: undefined, assignedTo: null }, "user_1");
  });
});

describe("task: inverse", () => {
  const ref = { taskId: "t1", title: "Send the quote", dueAt: "2026-10-21T05:00:00.000Z" };
  const undo = (r: unknown) => {
    if (!("undo" in taskKind.inverse)) throw new Error("irreversible");
    return taskKind.inverse.undo(actx, r);
  };

  it("deletes the to-do only as Accept left it: undone when the helper deleted, changed when it did not", async () => {
    // Mutation: always "undone" -> the second case FAILS.
    db.deleteTaskForUndo.mockResolvedValueOnce(true);
    expect(await undo(ref)).toBe("undone");
    expect(db.deleteTaskForUndo).toHaveBeenCalledWith(fakeDb, "a1", "t1", "user_1",
      { title: "Send the quote", dueAt: "2026-10-21T05:00:00.000Z" });
    db.deleteTaskForUndo.mockResolvedValueOnce(false);
    expect(await undo(ref)).toBe("changed");
  });

  it("a row with no applied_ref (copied from the old table, or an old-code Accept) is never undone", async () => {
    expect(await undo(null)).toBe("changed");
    expect(await undo({ taskId: 5 })).toBe("changed");
    expect(db.deleteTaskForUndo).not.toHaveBeenCalled();
  });
});

describe("task: stillHolds", () => {
  it("a to-do has nothing on the record to go out of date against", async () => {
    const row = { kind: "task", payload: stored, accountId: "a1" } as unknown as Proposal & { kind: "task" };
    expect(await taskKind.stillHolds(fakeDb, row)).toEqual({ ok: true });
  });
});
