import { describe, it, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { createContact } from "../contacts";
import { assignContacts } from "../assignment";
import {
  getOrCreateCalendar, createBooking, moveBooking, rescheduleChain, rescheduleRoots, listFeedBookings,
} from "../booking";
import {
  readLiveCalendarFeed, createCalendarFeed, revokeCalendarFeed, replaceCalendarFeed, restoreCalendarFeed,
  claimCalendarFeedFetch,
} from "../calendar-feeds";

/**
 * F-048 part 2 (0104): the calendar link's wrappers and the feed's booking window, end to end against the
 * real database through the service role (0104 grants nothing else). LIVE: CI's verify only.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const BY = "user_test";
const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
/** A whole hour a week from now: inside [now, now + 180 d), clear of the past half of the window. */
const AT = (hoursAfter: number) => new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 7 * 86_400_000 + hoursAfter * 3_600_000);

async function newUser(db: SupabaseClient, tag: string, language: "en" | "es" | null = null): Promise<string> {
  const clerk = `user_cfeed_${tag}_${RUN}`;
  const { data, error } = await db.from("users").insert({ clerk_user_id: clerk, email: `${clerk}@example.com`, language }).select("id").single();
  if (error) throw error;
  return data.id as string;
}
async function member(db: SupabaseClient, accountId: string, userId: string, role: "owner" | "staff" | "technician") {
  const { error } = await db.from("memberships").insert({ scope: "account", account_id: accountId, user_id: userId, role });
  if (error) throw error;
}
async function openAccess(db: SupabaseClient, accountId: string) {
  const { error } = await db.from("accounts").update({ client_access_enabled: true }).eq("id", accountId);
  if (error) throw error;
}
async function link(db: SupabaseClient, accountId: string, userId: string): Promise<{ id: string; tokenHash: string }> {
  const l = { id: randomUUID(), tokenHash: hash() };
  expect(await createCalendarFeed(db, { accountId, userId, ...l, createdBy: BY })).toBe("ok");
  return l;
}
async function book(db: SupabaseClient, accountId: string, contactId: string, hoursAfter: number): Promise<string> {
  const cal = await getOrCreateCalendar(db, accountId, BY);
  const startsAt = AT(hoursAfter);
  const { id } = await createBooking(db, accountId,
    { calendarId: cal.id, contactId, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) }, BY);
  return id;
}

/**
 * withTestAccount, then this run's users rows LAST: contacts.assigned_to references users with no delete
 * action (0003), so the users go only after the account's teardown has removed its contacts
 * (assignment.test.ts's withAssignAccount). memberships and calendar_feeds cascade.
 */
async function withFeedAccount(fn: (db: SupabaseClient, accountId: string) => Promise<void>): Promise<void> {
  try {
    await withTestAccount(async (db, accountId) => { await openAccess(db, accountId); await fn(db, accountId); });
  } finally {
    const { error } = await serviceDb().from("users").delete().like("clerk_user_id", `user_cfeed_%_${RUN}`);
    if (error) throw new Error(`calendar-feeds.test cleanup failed on users: ${error.message}`);
  }
}
/** Two accounts at once (the second-account cases). */
async function withTwoFeedAccounts(fn: (db: SupabaseClient, a: string, b: string) => Promise<void>): Promise<void> {
  await withFeedAccount(async (db, a) => {
    await withTestAccount(async (_db, b) => { await openAccess(db, b); await fn(db, a, b); });
  });
}

describe("calendar link wrappers, live (0104)", () => {
  it("create, then read it back; a second create while it is live is 'exists'", async () => {
    await withFeedAccount(async (db, a) => {
      const u = await newUser(db, "own1");
      await member(db, a, u, "owner");
      const l = await link(db, a, u);
      expect(await readLiveCalendarFeed(db, a, u)).toMatchObject({ id: l.id, account_id: a, user_id: u, token_hash: l.tokenHash, revoked_at: null });
      expect(await createCalendarFeed(db, { accountId: a, userId: u, id: randomUUID(), tokenHash: hash(), createdBy: BY })).toBe("exists");
    });
  });

  it("second account: B's claim answers B, and B's window holds only B's booking at the same instant as A's", async () => {
    await withTwoFeedAccounts(async (db, a, b) => {
      const ua = await newUser(db, "a2");
      const ub = await newUser(db, "b2");
      await member(db, a, ua, "owner");
      await member(db, b, ub, "owner");
      await link(db, a, ua);
      const lb = await link(db, b, ub);
      expect(await claimCalendarFeedFetch(db, lb.tokenHash)).toMatchObject({ status: "ok", accountId: b, userId: ub, feedId: lb.id, role: "owner" });
      const ca = (await createContact(db, a, { firstName: "Ana" }, BY)).id;
      const cb = (await createContact(db, b, { firstName: "Beto" }, BY)).id;
      const ba = await book(db, a, ca, 0);
      const bb = await book(db, b, cb, 0);
      const r = await listFeedBookings(db, b, { now: new Date(), technicianUserId: null });
      expect(r.rows.map((x) => [x.id, x.first_name])).toEqual([[bb, "Beto"]]);
      expect(r.rows.map((x) => x.id)).not.toContain(ba);
    });
  });

  it("a turned-off link is not found; Undo with the database's own stamp brings it back", async () => {
    await withFeedAccount(async (db, a) => {
      const u = await newUser(db, "rev3", "es");
      await member(db, a, u, "staff");
      const l = await link(db, a, u);
      const off = await revokeCalendarFeed(db, a, u);
      expect(off?.feedId).toBe(l.id);
      expect(await claimCalendarFeedFetch(db, l.tokenHash)).toEqual({ status: "not_found" });
      expect(await revokeCalendarFeed(db, a, u)).toBeNull();
      expect(await restoreCalendarFeed(db, { accountId: a, userId: u, feedId: l.id, revokedAt: off!.revokedAt, replacementId: null })).toBe("restored");
      expect(await claimCalendarFeedFetch(db, l.tokenHash)).toMatchObject({ status: "ok", feedId: l.id, role: "staff", userLanguage: "es" });
    });
  });

  it("an unknown hash is not found", async () => {
    expect(await claimCalendarFeedFetch(serviceDb(), hash())).toEqual({ status: "not_found" });
  });

  it("a removed member's link is gone: no live row, the claim not found", async () => {
    await withFeedAccount(async (db, a) => {
      const u = await newUser(db, "rm5");
      await member(db, a, u, "staff");
      const l = await link(db, a, u);
      const { error } = await db.from("memberships").delete().eq("account_id", a).eq("user_id", u);
      expect(error).toBeNull();
      expect(await readLiveCalendarFeed(db, a, u)).toBeNull();
      expect(await claimCalendarFeedFetch(db, l.tokenHash)).toEqual({ status: "not_found" });
    });
  });

  it("replace, replace, then Undo the FIRST replace is 'changed' and leaves the newest link live", async () => {
    await withFeedAccount(async (db, a) => {
      const u = await newUser(db, "rr");
      await member(db, a, u, "owner");
      const l0 = await link(db, a, u);
      const n1 = { id: randomUUID(), hash: hash() };
      const r1 = await replaceCalendarFeed(db, { accountId: a, userId: u, newId: n1.id, newHash: n1.hash, createdBy: BY });
      expect(r1).toMatchObject({ status: "ok", previousId: l0.id });
      const n2 = { id: randomUUID(), hash: hash() };
      const r2 = await replaceCalendarFeed(db, { accountId: a, userId: u, newId: n2.id, newHash: n2.hash, createdBy: BY });
      expect(r2).toMatchObject({ status: "ok", previousId: n1.id });
      if (r1.status !== "ok") throw new Error("unreachable");
      expect(await restoreCalendarFeed(db, { accountId: a, userId: u, feedId: l0.id, revokedAt: r1.revokedAt, replacementId: n1.id })).toBe("changed");
      expect((await readLiveCalendarFeed(db, a, u))?.id).toBe(n2.id);
      expect(await claimCalendarFeedFetch(db, l0.tokenHash)).toEqual({ status: "not_found" });
      expect(await claimCalendarFeedFetch(db, n2.hash)).toMatchObject({ status: "ok", feedId: n2.id });
    });
  });

  it("one person in two accounts: each account's link is its own; revoke and replace in A leave B's untouched (review I4)", async () => {
    await withTwoFeedAccounts(async (db, a, b) => {
      const u = await newUser(db, "both9");
      await member(db, a, u, "owner");
      await member(db, b, u, "technician");
      const la = await link(db, a, u);
      const lb = await link(db, b, u);
      expect((await readLiveCalendarFeed(db, a, u))?.id).toBe(la.id);
      const bRow = await readLiveCalendarFeed(db, b, u);
      expect(bRow).toMatchObject({ id: lb.id, account_id: b, token_hash: lb.tokenHash });
      const n = { id: randomUUID(), hash: hash() };
      expect(await replaceCalendarFeed(db, { accountId: a, userId: u, newId: n.id, newHash: n.hash, createdBy: BY }))
        .toMatchObject({ status: "ok", previousId: la.id });
      expect(await readLiveCalendarFeed(db, b, u)).toEqual(bRow);
      expect(await revokeCalendarFeed(db, a, u)).toMatchObject({ feedId: n.id });
      expect(await readLiveCalendarFeed(db, a, u)).toBeNull();
      expect((await readLiveCalendarFeed(db, b, u))?.token_hash).toBe(lb.tokenHash);
      expect(await claimCalendarFeedFetch(db, lb.tokenHash)).toMatchObject({ status: "ok", accountId: b, role: "technician" });
    });
  });
});

describe("listFeedBookings and rescheduleRoots, live", () => {
  it("a Technician's window holds only customers assigned to them, and follows a reassignment", async () => {
    await withFeedAccount(async (db, a) => {
      const t = await newUser(db, "tech6");
      const s = await newUser(db, "staff6");
      await member(db, a, t, "technician");
      await member(db, a, s, "staff");
      const c1 = (await createContact(db, a, { firstName: "Uno", assignedTo: t }, BY)).id;
      const c2 = (await createContact(db, a, { firstName: "Dos", assignedTo: s }, BY)).id;
      const c3 = (await createContact(db, a, { firstName: "Tres" }, BY)).id;
      const b1 = await book(db, a, c1, 0);
      const b2 = await book(db, a, c2, 2);
      const b3 = await book(db, a, c3, 4);
      const ids = async (tech: string | null) => (await listFeedBookings(db, a, { now: new Date(), technicianUserId: tech })).rows.map((r) => r.id);
      expect(await ids(t)).toEqual([b1]);
      expect(await ids(null)).toEqual([b1, b2, b3]);
      await assignContacts(db, a, [c2], t, BY);
      expect(await ids(t)).toEqual([b1, b2]);
    });
  });

  it("a booking moved twice is ONE row, its root the first booking at depth 2, and rescheduleRoots agrees with rescheduleChain", async () => {
    await withFeedAccount(async (db, a) => {
      const c = (await createContact(db, a, { firstName: "Mover" }, BY)).id;
      const b0 = await book(db, a, c, 0);
      const m1 = await moveBooking(db, a, b0, { startsAt: AT(3), endsAt: AT(4) }, BY);
      const m2 = await moveBooking(db, a, m1.id, { startsAt: AT(6), endsAt: AT(7) }, BY);
      const r = await listFeedBookings(db, a, { now: new Date(), technicianUserId: null });
      expect(r.rows.map((x) => ({ id: x.id, rootId: x.rootId, depth: x.depth, status: x.status })))
        .toEqual([{ id: m2.id, rootId: b0, depth: 2, status: "booked" }]);
      const { data, error } = await db.from("bookings").select("id, rescheduled_from_id").eq("account_id", a).in("id", [b0, m1.id, m2.id]);
      expect(error).toBeNull();
      const chain = data as { id: string; rescheduled_from_id: string | null }[];
      expect(chain).toHaveLength(3);
      const roots = await rescheduleRoots(db, a, chain);
      for (const row of chain) expect(roots.get(row.id)).toEqual(await rescheduleChain(db, a, row.id));
    });
  });
});
