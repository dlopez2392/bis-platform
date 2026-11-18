import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobCheckin, SupabaseClient } from "@bis/db";

/**
 * The reviewer's hole, with the REAL ensureCheckinTask (only the reads that need a live database are replaced): the
 * To-do's insert succeeds and its task.created event fails. The To-do exists, so the page and the sweep must both
 * email the owner, and the sweep must not count a failed To-do (which would also redden the heartbeat).
 */
const dbm = vi.hoisted(() => ({ recordCheckinAnswer: vi.fn(), listCheckinsMissingTask: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbm }));
const alertMock = vi.hoisted(() => ({ alertOwnerOfNotGreat: vi.fn() }));
vi.mock("./alert", () => alertMock);

import { answerCheckin } from "./flow";
import { sweepCheckinTasks, reviewRequestsPass } from "@/lib/automations/passes/checkin-sweep";
import type { PassContext } from "@/lib/automations/context";

const ACCT = "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f";
const NOW = new Date("2027-06-15T12:00:00Z");
const checkin: JobCheckin = { id: "chk-1", accountId: ACCT, bookingId: "bk-1", contactId: "ct-1", answer: "not_great", answeredAt: NOW.toISOString(), reviewLinkOpenedAt: null };

/** tasks insert ok; events insert fails; contacts and accounts answer the title's reads. */
function world() {
  const inserts: string[] = [];
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.insert = () => { inserts.push(table); return table === "events" ? Promise.resolve({ error: { message: "events down" } }) : q; };
    q.single = async () => ({ data: { id: "t1" }, error: null });
    q.maybeSingle = async () => ({
      data: table === "contacts" ? { first_name: "Ana", last_name: "García" } : { language: "en" }, error: null,
    });
    return q;
  };
  return { db: { from } as unknown as SupabaseClient, inserts };
}

beforeEach(() => {
  dbm.recordCheckinAnswer.mockReset().mockResolvedValue({ status: "recorded", checkin });
  dbm.listCheckinsMissingTask.mockReset().mockResolvedValue([checkin]);
  alertMock.alertOwnerOfNotGreat.mockReset().mockResolvedValue({ sent: 1, failed: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
});

describe("a To-do whose event could not be recorded is still a created To-do", () => {
  it("the answer page: one alert, the customer is thanked, the event failure is logged once", async () => {
    const { db, inserts } = world();
    const payload = { v: 1 as const, a: ACCT, b: "bk-1", l: "en" as const, i: NOW.getTime() - 1000 };
    expect(await answerCheckin(db, payload, "not_great", NOW)).toBe("done");
    expect(inserts).toEqual(["tasks", "events"]);
    expect(alertMock.alertOwnerOfNotGreat).toHaveBeenCalledTimes(1);
    const logged = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).filter((l) => l.includes("events down"));
    expect(logged).toHaveLength(1);
  });

  it("the sweep: one alert, counted opened and NOT failed, so the heartbeat stays green", async () => {
    const { db } = world();
    const ctx = { db, now: NOW, origin: "https://app.example.com", email: { send: vi.fn() } } as unknown as PassContext;
    const counters = await sweepCheckinTasks(ctx);
    expect(counters).toEqual({ checkinTasksOpened: 1, checkinAlertsSent: 1 });
    expect(alertMock.alertOwnerOfNotGreat).toHaveBeenCalledTimes(1);
    expect(reviewRequestsPass.beatFailure!(counters)).toBeNull();
  });
});
