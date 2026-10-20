import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const insertAiActs = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", () => ({ insertAiActs: (...a: unknown[]) => insertAiActs(...a) }));

import type { NewAiAct } from "@bis/db/ai-act-rules";
import type { serviceDb } from "@bis/db";
import { recordAct, recordActs, ACT_RECORD_TIMEOUT_MS } from "./record";

const DB = { tag: "service-db" } as unknown as ReturnType<typeof serviceDb>;

const BOOKED: NewAiAct = {
  kind: "booking_created", actor: "voice", callId: "call-1", chatId: null, contactId: "ct-1",
  target: { bookingId: "bk-1" }, before: null,
  after: { startsAt: "2027-06-01T14:00:00.000Z", endsAt: "2027-06-01T15:00:00.000Z" },
};
const FILLED: NewAiAct = {
  kind: "contact_field_filled", actor: "voice", callId: "call-1", chatId: null, contactId: "ct-1",
  target: { field: "email" }, before: { value: null }, after: { value: "ana.ruiz@example.com" },
};
const NAMED: NewAiAct = {
  kind: "contact_field_filled", actor: "webchat", callId: null, chatId: "chat-9", contactId: "ct-2",
  target: { field: "firstName" }, before: { value: "Caller" }, after: { value: "Anabel" },
};

function logs(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((c: unknown[]) => c.map(String).join(" "));
}

let errSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  insertAiActs.mockReset().mockResolvedValue(undefined);
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  errSpy.mockRestore();
  warnSpy.mockRestore();
  vi.useRealTimers();
});

describe("recordActs", () => {
  it("writes every act of one site in ONE insertAiActs call, on the account it was given", async () => {
    await recordActs(DB, "acct-A", [BOOKED, FILLED]);
    expect(insertAiActs).toHaveBeenCalledTimes(1);
    expect(insertAiActs).toHaveBeenCalledWith(DB, "acct-A", [BOOKED, FILLED]);
    expect(logs(errSpy)).toEqual([]);
  });

  it("recordAct is recordActs of one", async () => {
    await recordAct(DB, "acct-A", BOOKED);
    expect(insertAiActs).toHaveBeenCalledWith(DB, "acct-A", [BOOKED]);
  });

  it("a throwing insertAiActs resolves, and the log names ids and the error's code, never its message", async () => {
    insertAiActs.mockRejectedValue(Object.assign(new Error("insertAiActs failed: Key (email)=(ana.ruiz@example.com)"), { code: "23503" }));
    await expect(recordActs(DB, "acct-A", [BOOKED])).resolves.toBeUndefined();
    expect(logs(errSpy)).toEqual([
      "ai act not recorded: kind=booking_created account=acct-A source=call:call-1 contact=ct-1: 23503",
    ]);
  });

  it("an insert that throws synchronously resolves too, logged by the error's name", async () => {
    insertAiActs.mockImplementation(() => { throw new TypeError("db.from is not a function"); });
    await expect(recordActs(DB, "acct-A", [BOOKED])).resolves.toBeUndefined();
    expect(logs(errSpy)).toEqual([
      "ai act not recorded: kind=booking_created account=acct-A source=call:call-1 contact=ct-1: TypeError",
    ]);
  });

  it("the log carries no name, email, phone, value or time from the act (mutation: log the act's after -> FAILS)", async () => {
    insertAiActs.mockRejectedValue(new Error("down"));
    await recordActs(DB, "acct-A", [BOOKED, FILLED, NAMED]);
    const all = [...logs(errSpy), ...logs(warnSpy)];
    expect(all).toHaveLength(3);
    for (const l of all) {
      expect(l).not.toContain("ana.ruiz@example.com");
      expect(l).not.toContain("Anabel");
      expect(l).not.toContain("Caller");
      expect(l).not.toContain("2027-06-01");
      expect(l).not.toContain("down");
    }
    expect(all[2]).toBe("ai act not recorded: kind=contact_field_filled account=acct-A source=chat:chat-9 contact=ct-2: Error");
  });

  it("a voice act with no call row is skipped and logged as having no source; a chat act with no chat likewise", async () => {
    await recordActs(DB, "acct-A", [
      { ...BOOKED, callId: null },
      { ...NAMED, chatId: null },
    ]);
    expect(insertAiActs).not.toHaveBeenCalled();
    expect(logs(warnSpy)).toEqual([
      "ai act not recorded: no source kind=booking_created account=acct-A contact=ct-1",
      "ai act not recorded: no source kind=contact_field_filled account=acct-A contact=ct-2",
    ]);
  });

  it("only the sourced acts of a mixed list are written", async () => {
    await recordActs(DB, "acct-A", [{ ...BOOKED, callId: null }, FILLED]);
    expect(insertAiActs).toHaveBeenCalledWith(DB, "acct-A", [FILLED]);
  });

  it("an empty list writes nothing and logs nothing", async () => {
    await recordActs(DB, "acct-A", []);
    expect(insertAiActs).not.toHaveBeenCalled();
    expect([...logs(errSpy), ...logs(warnSpy)]).toEqual([]);
  });

  it("a hanging insertAiActs gives up at ACT_RECORD_TIMEOUT_MS and logs the timeout (mutation: await the insert without the race -> FAILS, never resolves)", async () => {
    vi.useFakeTimers();
    insertAiActs.mockReturnValue(new Promise(() => {}));
    let done = false;
    const p = recordActs(DB, "acct-A", [BOOKED]).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(ACT_RECORD_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    await p;
    expect(ACT_RECORD_TIMEOUT_MS).toBe(1000);
    expect(logs(errSpy)).toEqual([
      "ai act not recorded: timed out after 1000 ms kind=booking_created account=acct-A source=call:call-1",
    ]);
  });

  it("an insert that fails AFTER the timeout is still swallowed: no unhandled rejection, one more id-only line", async () => {
    vi.useFakeTimers();
    let reject!: (e: unknown) => void;
    insertAiActs.mockReturnValue(new Promise((_r, j) => { reject = j; }));
    const p = recordActs(DB, "acct-A", [BOOKED]);
    await vi.advanceTimersByTimeAsync(ACT_RECORD_TIMEOUT_MS);
    await p;
    reject(Object.assign(new Error("late"), { code: "57014" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(logs(errSpy)).toEqual([
      "ai act not recorded: timed out after 1000 ms kind=booking_created account=acct-A source=call:call-1",
      "ai act not recorded: kind=booking_created account=acct-A source=call:call-1 contact=ct-1: 57014",
    ]);
  });

  it("a fast insert clears its timer: nothing is left pending", async () => {
    vi.useFakeTimers();
    await recordActs(DB, "acct-A", [BOOKED]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("fieldFillActs", () => {
  it("one act per column WRITTEN, before = the prior read (null when absent), after = the stored form", async () => {
    const { fieldFillActs, voiceSource } = await import("./record");
    expect(fieldFillActs(voiceSource("call-1"), "ct-1", {
      prior: { firstName: "Caller" },
      written: { firstName: "Ana", phone: "+19562921696" },
    })).toEqual([
      { actor: "voice", callId: "call-1", chatId: null, kind: "contact_field_filled", contactId: "ct-1",
        target: { field: "firstName" }, before: { value: "Caller" }, after: { value: "Ana" } },
      { actor: "voice", callId: "call-1", chatId: null, kind: "contact_field_filled", contactId: "ct-1",
        target: { field: "phone" }, before: { value: null }, after: { value: "+19562921696" } },
    ]);
  });

  it("a fill that wrote nothing makes no act, whatever it read", async () => {
    const { fieldFillActs, voiceSource } = await import("./record");
    expect(fieldFillActs(voiceSource(null), "ct-1", { prior: { email: null }, written: {} })).toEqual([]);
  });
});
