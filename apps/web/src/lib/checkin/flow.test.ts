import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Branding, JobCheckin } from "@bis/db";

const dbm = vi.hoisted(() => ({
  getCheckinForBooking: vi.fn(), recordCheckinAnswer: vi.fn(), ensureCheckinTask: vi.fn(),
  markReviewLinkOpened: vi.fn(), getAutomation: vi.fn(), getBranding: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbm }));

import { answerCheckin, CHECKIN_LINK_MAX_AGE_MS, loadCheckinPage, reviewLinkTarget } from "./flow";
import type { CheckinTokenPayload } from "./token";
import { fakeDb, writesOf as writes, type FakeRow as Row } from "./fake-db";

const ACCT = "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f";
const OTHER_ACCT = "9c2d7e1f-4d2b-4f3c-8b66-1a8b2d3e4f50";
const BOOKING = "4b1d6f0e-3c1a-4e2b-9a55-0f7a1c2d3e4f";
const CONTACT = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2027-06-15T12:00:00Z");
const PAYLOAD: CheckinTokenPayload = { v: 1, a: ACCT, b: BOOKING, l: "en", i: NOW.getTime() - 3_600_000 };
const REVIEW = "https://g.page/r/rio-roofing/review";
const BRANDING: Branding = { brandName: "Rio Roofing", brandLogoPath: null, brandColor: "#0e7490", brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null };
const checkin = (answer: JobCheckin["answer"]): JobCheckin => ({ id: "c1", accountId: ACCT, bookingId: BOOKING, contactId: CONTACT, answer, answeredAt: NOW.toISOString(), reviewLinkOpenedAt: null });

const world = (over: Partial<Record<string, Row[]>> = {}) => fakeDb({
  bookings: [{ id: BOOKING, account_id: ACCT, status: "completed", contact_id: CONTACT }],
  contacts: [{ id: CONTACT, account_id: ACCT, first_name: "Ana", last_name: "García" }],
  accounts: [{ id: ACCT, language: "es" }],
  ...over,
});

beforeEach(() => {
  for (const f of Object.values(dbm)) f.mockReset();
  dbm.getCheckinForBooking.mockResolvedValue(null);
  dbm.getBranding.mockResolvedValue(BRANDING);
  dbm.getAutomation.mockResolvedValue({ enabled: true, config: { channel: "email", reviewUrl: REVIEW, checkin: true } });
  dbm.recordCheckinAnswer.mockResolvedValue({ status: "recorded", checkin: checkin("great") });
  dbm.ensureCheckinTask.mockResolvedValue({ id: "t1", created: true });
  dbm.markReviewLinkOpened.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadCheckinPage: a GET only reads", () => {
  it("a completed booking nobody has answered asks, with the account's brand and its stored review link", async () => {
    const { db } = world();
    const page = await loadCheckinPage(db, PAYLOAD, NOW);
    expect(page.view).toEqual({ kind: "ask" });
    expect(page.branding).toEqual(BRANDING);
    expect(page.reviewUrl).toBe(REVIEW);
    expect(dbm.getAutomation).toHaveBeenCalledWith(db, ACCT, "review_request");
  });

  it("writes nothing: not a row, not an answer, not a task, not the link stamp (a scanner's fetch changes nothing)", async () => {
    const { db, log } = world();
    for (const answer of [null, checkin("not_great")]) {
      dbm.getCheckinForBooking.mockResolvedValue(answer);
      await loadCheckinPage(db, PAYLOAD, NOW);
    }
    expect(writes(log)).toEqual([]);
    for (const f of [dbm.recordCheckinAnswer, dbm.ensureCheckinTask, dbm.markReviewLinkOpened]) expect(f).not.toHaveBeenCalled();
  });

  it("re-reads the booking by the token's own account AND booking: another account's booking is not valid, and its data is never fetched", async () => {
    const { db } = world({ bookings: [{ id: BOOKING, account_id: OTHER_ACCT, status: "completed", contact_id: CONTACT }] });
    const page = await loadCheckinPage(db, PAYLOAD, NOW);
    expect(page.view).toEqual({ kind: "not_valid" });
    expect(page.reviewUrl).toBeNull();
    expect(dbm.getCheckinForBooking).not.toHaveBeenCalled();
    expect(dbm.getAutomation).not.toHaveBeenCalled();
  });

  it("a booking that is not completed (scheduled, cancelled, no-show, reverted) or no longer there is not valid", async () => {
    for (const status of ["scheduled", "cancelled", "no_show"]) {
      const { db } = world({ bookings: [{ id: BOOKING, account_id: ACCT, status, contact_id: CONTACT }] });
      expect((await loadCheckinPage(db, PAYLOAD, NOW)).view, status).toEqual({ kind: "not_valid" });
    }
    const { db } = world({ bookings: [] });
    expect((await loadCheckinPage(db, PAYLOAD, NOW)).view).toEqual({ kind: "not_valid" });
  });

  it.each(["great", "okay", "not_great"] as const)("an answered booking shows the answer they gave (%s)", async (answer) => {
    dbm.getCheckinForBooking.mockResolvedValue(checkin(answer));
    const { db } = world();
    expect((await loadCheckinPage(db, PAYLOAD, NOW)).view).toEqual({ kind: "answered", answer });
    expect(dbm.getCheckinForBooking).toHaveBeenCalledWith(db, ACCT, BOOKING);
  });

  it("older than 30 days: only the review button (expired), exactly 30 days still asks", async () => {
    const { db } = world();
    const at = (ms: number) => ({ ...PAYLOAD, i: NOW.getTime() - ms });
    expect((await loadCheckinPage(db, at(CHECKIN_LINK_MAX_AGE_MS), NOW)).view).toEqual({ kind: "ask" });
    expect((await loadCheckinPage(db, at(CHECKIN_LINK_MAX_AGE_MS + 1), NOW)).view).toEqual({ kind: "expired" });
    expect(CHECKIN_LINK_MAX_AGE_MS).toBe(30 * 24 * 3600 * 1000);
  });

  it("an old link whose booking was already answered still shows that answer, not the expired state", async () => {
    dbm.getCheckinForBooking.mockResolvedValue(checkin("okay"));
    const { db } = world();
    expect((await loadCheckinPage(db, { ...PAYLOAD, i: NOW.getTime() - 40 * 86_400_000 }, NOW)).view).toEqual({ kind: "answered", answer: "okay" });
  });

  it("no review link on the account (none stored, a config that does not parse, a script URL): reviewUrl is null, never a guess", async () => {
    const { db } = world();
    for (const stored of [null, { enabled: true, config: { channel: "email" } }, { enabled: true, config: { channel: "email", reviewUrl: "javascript:alert(1)" } }]) {
      dbm.getAutomation.mockResolvedValue(stored);
      expect((await loadCheckinPage(db, PAYLOAD, NOW)).reviewUrl).toBeNull();
    }
  });

  it("an unreadable brand is decorative: the page still renders, unbranded", async () => {
    dbm.getBranding.mockRejectedValue(new Error("down"));
    const { db } = world();
    const page = await loadCheckinPage(db, PAYLOAD, NOW);
    expect(page.branding).toBeNull();
    expect(page.view).toEqual({ kind: "ask" });
  });

  it("any other failed read throws (the page's error boundary answers), never a guessed state", async () => {
    dbm.getCheckinForBooking.mockRejectedValue(new Error("down"));
    const { db } = world();
    await expect(loadCheckinPage(db, PAYLOAD, NOW)).rejects.toThrow("down");
  });
});

describe("answerCheckin", () => {
  it("records the answer for the TOKEN's account and booking, and makes no To-do for great or okay", async () => {
    const { db } = world();
    for (const a of ["great", "okay"] as const) {
      expect(await answerCheckin(db, PAYLOAD, a, NOW)).toBe("done");
      expect(dbm.recordCheckinAnswer).toHaveBeenLastCalledWith(db, ACCT, BOOKING, a);
    }
    expect(dbm.ensureCheckinTask).not.toHaveBeenCalled();
  });

  it("not great, recorded: exactly one To-do on the recorded check-in, titled in the ACCOUNT's language with the customer's name", async () => {
    const rec = checkin("not_great");
    dbm.recordCheckinAnswer.mockResolvedValue({ status: "recorded", checkin: rec });
    const { db } = world();
    expect(await answerCheckin(db, PAYLOAD, "not_great", NOW)).toBe("done");
    expect(dbm.ensureCheckinTask).toHaveBeenCalledTimes(1);
    expect(dbm.ensureCheckinTask).toHaveBeenCalledWith(db, ACCT, rec,
      { title: "Llame a Ana García: dijo que el trabajo no estuvo bien", dueAt: NOW.toISOString() }, "checkin-page", "system");
  });

  it("the To-do's actor is system (ActorType has no public), never user", async () => {
    dbm.recordCheckinAnswer.mockResolvedValue({ status: "recorded", checkin: checkin("not_great") });
    const { db } = world();
    await answerCheckin(db, PAYLOAD, "not_great", NOW);
    expect(dbm.ensureCheckinTask.mock.calls[0]![5]).toBe("system");
  });

  /** ensureCheckinTask as the unique index behaves: the first call per check-in creates, every later one finds it. */
  const uniqueIndex = () => {
    const made = new Set<string>();
    dbm.ensureCheckinTask.mockImplementation(async (_db, _a, c: JobCheckin) => {
      const created = !made.has(c.id);
      made.add(c.id);
      return { id: `task-${c.id}`, created };
    });
    return made;
  };

  it("a replay or a double submit (someone answered first) asks for the WINNER's To-do by id, and the unique index yields exactly ONE created task", async () => {
    const winner = checkin("not_great");
    dbm.recordCheckinAnswer
      .mockResolvedValueOnce({ status: "recorded", checkin: winner })
      .mockResolvedValue({ status: "already", checkin: winner });
    uniqueIndex();
    const { db } = world();
    for (const a of ["not_great", "not_great", "great"]) await answerCheckin(db, PAYLOAD, a, NOW);
    expect(dbm.ensureCheckinTask).toHaveBeenCalledTimes(3);
    for (const call of dbm.ensureCheckinTask.mock.calls) expect(call[2].id).toBe(winner.id);
    const created = await Promise.all(dbm.ensureCheckinTask.mock.results.map((r) => r.value as Promise<{ created: boolean }>));
    expect(created.filter((c) => c.created)).toHaveLength(1);
  });

  it("an 'already' answer that is not great (great or okay won) makes no To-do", async () => {
    dbm.recordCheckinAnswer.mockResolvedValue({ status: "already", checkin: checkin("great") });
    const { db } = world();
    await answerCheckin(db, PAYLOAD, "not_great", NOW);
    expect(dbm.ensureCheckinTask).not.toHaveBeenCalled();
  });

  it("(a) a first attempt that throws is retried, and the To-do is made", async () => {
    dbm.recordCheckinAnswer.mockResolvedValue({ status: "recorded", checkin: checkin("not_great") });
    dbm.ensureCheckinTask.mockRejectedValueOnce(new Error("blip")).mockResolvedValue({ id: "t1", created: true });
    const { db } = world();
    vi.mocked(console.error).mockClear();
    expect(await answerCheckin(db, PAYLOAD, "not_great", NOW)).toBe("done");
    expect(dbm.ensureCheckinTask).toHaveBeenCalledTimes(2);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("(b) a recorded not-great whose To-do insert fails every attempt is repaired by the replay: same check-in id, task created", async () => {
    const winner = checkin("not_great");
    dbm.recordCheckinAnswer
      .mockResolvedValueOnce({ status: "recorded", checkin: winner })
      .mockResolvedValue({ status: "already", checkin: winner });
    let down = true;
    const made = new Set<string>();
    dbm.ensureCheckinTask.mockImplementation(async (_db, _a, c: JobCheckin) => {
      if (down) throw new Error("insert failed");
      made.add(c.id);
      return { id: "t1", created: true };
    });
    const { db } = world();
    vi.mocked(console.error).mockClear();
    expect(await answerCheckin(db, PAYLOAD, "not_great", NOW)).toBe("done");
    expect(made.size).toBe(0);
    expect(console.error).toHaveBeenCalled();
    const attempts = dbm.ensureCheckinTask.mock.calls.length;
    expect(attempts).toBeGreaterThan(1);
    down = false;
    expect(await answerCheckin(db, PAYLOAD, "not_great", NOW)).toBe("done");
    expect(dbm.ensureCheckinTask.mock.calls.length).toBe(attempts + 1);
    expect(dbm.ensureCheckinTask.mock.calls.at(-1)![2].id).toBe(winner.id);
    expect(made.has(winner.id)).toBe(true);
  });

  it("a booking that is gone or not completed: nothing happens", async () => {
    dbm.recordCheckinAnswer.mockResolvedValue({ status: "gone" });
    const { db } = world();
    expect(await answerCheckin(db, PAYLOAD, "not_great", NOW)).toBe("done");
    expect(dbm.ensureCheckinTask).not.toHaveBeenCalled();
  });

  it("an old link records nothing and alerts nobody", async () => {
    const { db } = world();
    expect(await answerCheckin(db, { ...PAYLOAD, i: NOW.getTime() - CHECKIN_LINK_MAX_AGE_MS - 1 }, "not_great", NOW)).toBe("done");
    expect(dbm.recordCheckinAnswer).not.toHaveBeenCalled();
    expect(dbm.ensureCheckinTask).not.toHaveBeenCalled();
  });

  it("a value that is not one of the three answers records nothing", async () => {
    const { db } = world();
    for (const bad of ["", "terrible", undefined, null, 3, "GREAT"]) {
      expect(await answerCheckin(db, PAYLOAD, bad, NOW)).toBe("done");
    }
    expect(dbm.recordCheckinAnswer).not.toHaveBeenCalled();
  });

  it("a contact merge moving the booking mid-flight (the 23503 throw) is a designed 'tap again', nothing recorded, no To-do, no raw error", async () => {
    dbm.recordCheckinAnswer.mockRejectedValue(new Error("recordCheckinAnswer failed: violates foreign key constraint (23503)"));
    const { db } = world();
    expect(await answerCheckin(db, PAYLOAD, "not_great", NOW)).toBe("retry");
    expect(dbm.ensureCheckinTask).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("an answer that is recorded stays recorded and is thanked even when its To-do could not be opened after the retries (logged naming the doubt, never a raw error)", async () => {
    dbm.recordCheckinAnswer.mockResolvedValue({ status: "recorded", checkin: checkin("not_great") });
    dbm.ensureCheckinTask.mockRejectedValue(new Error("down"));
    const { db } = world();
    expect(await answerCheckin(db, PAYLOAD, "not_great", NOW)).toBe("done");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("its To-do may not exist"));
  });

  it("a customer with no name gets the no-name To-do title", async () => {
    dbm.recordCheckinAnswer.mockResolvedValue({ status: "recorded", checkin: checkin("not_great") });
    const { db } = world({ contacts: [{ id: CONTACT, account_id: ACCT, first_name: " ", last_name: null }], accounts: [{ id: ACCT, language: null }] });
    await answerCheckin(db, PAYLOAD, "not_great", NOW);
    expect(dbm.ensureCheckinTask.mock.calls[0]![3].title).toBe("Call this customer: they said the job was not great");
  });
});

describe("reviewLinkTarget", () => {
  it("stamps the press for the token's booking and answers the account's STORED link", async () => {
    const { db } = world();
    expect(await reviewLinkTarget(db, PAYLOAD)).toBe(REVIEW);
    expect(dbm.markReviewLinkOpened).toHaveBeenCalledWith(db, ACCT, BOOKING);
  });

  it("an old link still reaches the review (a late reviewer is welcome)", async () => {
    const { db } = world();
    expect(await reviewLinkTarget(db, { ...PAYLOAD, i: NOW.getTime() - 90 * 86_400_000 })).toBe(REVIEW);
  });

  it("another account's or an unfinished booking: no link and no stamp", async () => {
    const { db } = world({ bookings: [{ id: BOOKING, account_id: OTHER_ACCT, status: "completed", contact_id: CONTACT }] });
    expect(await reviewLinkTarget(db, PAYLOAD)).toBeNull();
    const { db: db2 } = world({ bookings: [{ id: BOOKING, account_id: ACCT, status: "scheduled", contact_id: CONTACT }] });
    expect(await reviewLinkTarget(db2, PAYLOAD)).toBeNull();
    expect(dbm.markReviewLinkOpened).not.toHaveBeenCalled();
  });

  it("no stored link: nothing to open and nothing stamped; a link that is not http(s) is no link", async () => {
    const { db } = world();
    dbm.getAutomation.mockResolvedValue(null);
    expect(await reviewLinkTarget(db, PAYLOAD)).toBeNull();
    dbm.getAutomation.mockResolvedValue({ enabled: true, config: { channel: "email", reviewUrl: "javascript:alert(1)" } });
    expect(await reviewLinkTarget(db, PAYLOAD)).toBeNull();
    expect(dbm.markReviewLinkOpened).not.toHaveBeenCalled();
  });

  it("a stamp that fails never costs the customer the link", async () => {
    dbm.markReviewLinkOpened.mockRejectedValue(new Error("down"));
    const { db } = world();
    expect(await reviewLinkTarget(db, PAYLOAD)).toBe(REVIEW);
    expect(console.error).toHaveBeenCalled();
  });
});
