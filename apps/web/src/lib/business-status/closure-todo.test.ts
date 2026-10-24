import { describe, it, expect, vi, beforeEach } from "vitest";
import { m } from "@/lib/messages";

const getAccountLanguage = vi.fn();
const ensureClosureTask = vi.fn();
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bis/db")>()),
  getAccountLanguage: (...a: unknown[]) => getAccountLanguage(...a),
  ensureClosureTask: (...a: unknown[]) => ensureClosureTask(...a),
}));

const { closureTodoDates, fileClosureTodo } = await import("./closure-todo");

beforeEach(() => {
  vi.clearAllMocks();
  getAccountLanguage.mockResolvedValue(null);
  ensureClosureTask.mockResolvedValue({ id: "task1", created: true });
});

describe("closureTodoDates (SD16, Task 2's {dates} bullet)", () => {
  it("one day (mutation: always use the range form -> FAILS)", () => {
    expect(closureTodoDates("2026-12-24", "2026-12-24", "en")).toBe("December 24");
    expect(closureTodoDates("2026-12-24", "2026-12-24", "es")).toBe("24 de diciembre");
  });
  it("a range in one month (mutation: drop the month-equality check -> FAILS)", () => {
    expect(closureTodoDates("2026-12-24", "2026-12-26", "en")).toBe("December 24 – 26");
    expect(closureTodoDates("2026-12-24", "2026-12-26", "es")).toBe("24 al 26 de diciembre");
  });
  it("across months (mutation: reuse the same-month template -> FAILS)", () => {
    expect(closureTodoDates("2026-12-28", "2027-01-01", "en")).toBe("December 28 – January 1");
    expect(closureTodoDates("2026-12-28", "2027-01-01", "es")).toBe("28 de diciembre al 1 de enero");
  });
});

describe("fileClosureTodo", () => {
  it("English and Spanish titles as literals, by account language (mutation: swap the two titles -> FAILS)", async () => {
    getAccountLanguage.mockResolvedValue("en");
    await fileClosureTodo(undefined as never, { accountId: "acct-1", kind: "status", on: "2026-12-24", createdBy: "user:u1" });
    expect(ensureClosureTask.mock.calls[0]![2]).toMatchObject({ title: m["business.todo.status"] });

    getAccountLanguage.mockResolvedValue("es");
    await fileClosureTodo(undefined as never, { accountId: "acct-1", kind: "status", on: "2026-12-24", createdBy: "user:u1" });
    expect(ensureClosureTask.mock.calls[1]![2]).toMatchObject({ title: m["business.todo.status.es"] });
  });

  it("the closed-day title carries {dates} built from on and to (mutation: ignore `to` -> FAILS)", async () => {
    getAccountLanguage.mockResolvedValue("en");
    await fileClosureTodo(undefined as never, { accountId: "acct-1", kind: "closed_day", on: "2026-12-24", to: "2026-12-26", createdBy: "user:u1" });
    expect(ensureClosureTask.mock.calls[0]![2]).toMatchObject({
      title: m["business.todo.closedDay"].replace("{dates}", "December 24 – 26"),
    });
  });

  it("getAccountLanguage null reads as English (mutation: default to es -> FAILS)", async () => {
    getAccountLanguage.mockResolvedValue(null);
    await fileClosureTodo(undefined as never, { accountId: "acct-1", kind: "status", on: "2026-12-24", createdBy: "user:u1" });
    expect(getAccountLanguage).toHaveBeenCalledWith(undefined, "acct-1");
    expect(ensureClosureTask.mock.calls[0]![2]).toMatchObject({ title: m["business.todo.status"] });
  });

  it("ensureClosureTask is called with the route's own accountId, kind, on and createdBy (mutation: a hard-coded id -> FAILS)", async () => {
    await fileClosureTodo(undefined as never, { accountId: "acct-7", kind: "status", on: "2026-12-24", createdBy: "user:u9" });
    expect(ensureClosureTask).toHaveBeenCalledWith(undefined, "acct-7", expect.objectContaining({ kind: "status", on: "2026-12-24", createdBy: "user:u9" }));
  });

  it("created: false passes through unchanged (mutation: hard-code created: true -> FAILS)", async () => {
    ensureClosureTask.mockResolvedValue({ id: "task1", created: false });
    const result = await fileClosureTodo(undefined as never, { accountId: "acct-1", kind: "status", on: "2026-12-24", createdBy: "user:u1" });
    expect(result).toEqual({ id: "task1", created: false });
  });
});
