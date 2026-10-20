import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import type { SupabaseClient, GroupMember } from "@bis/db";

/**
 * The group page's loaders (S-03 part 2, plan Task 7; part 1 C5): each returns a load and NEVER
 * throws, logs the card and the account only, and the Text gate builds the ledger (service) client
 * only after getContact on the REQUEST client proved the call-first member (C14).
 */
const listGroupMembersMock = vi.fn();
const listOpenDealsForMock = vi.fn();
const listGroupPlacesMock = vi.fn();
const getContactMock = vi.fn();
const groupActivityMembersMock = vi.fn();
const groupFactsMock = vi.fn();
const groupNextUpMock = vi.fn();
const listTimelinePageMock = vi.fn();
const listPeopleNamesMock = vi.fn();
const getVoiceProfileMock = vi.fn();
vi.mock("@bis/db", () => ({
  groupActivityMembers: (...a: unknown[]) => groupActivityMembersMock(...a),
  groupFacts: (...a: unknown[]) => groupFactsMock(...a),
  groupNextUp: (...a: unknown[]) => groupNextUpMock(...a),
  listTimelinePage: (...a: unknown[]) => listTimelinePageMock(...a),
  listPeopleNames: (...a: unknown[]) => listPeopleNamesMock(...a),
  getVoiceProfile: (...a: unknown[]) => getVoiceProfileMock(...a),
  TIMELINE_SOURCES: ["notes", "todos", "deals", "forms", "messages", "bookings", "calls", "documents"],
  listGroupMembers: (...a: unknown[]) => listGroupMembersMock(...a),
  listOpenDealsFor: (...a: unknown[]) => listOpenDealsForMock(...a),
  listGroupPlaces: (...a: unknown[]) => listGroupPlacesMock(...a),
  getContact: (...a: unknown[]) => getContactMock(...a),
}));
const LEDGER = vi.hoisted(() => ({ tag: "ledger-db" }));
const ledgerDbMock = vi.hoisted(() => vi.fn(() => LEDGER));
vi.mock("@/lib/consent/ledger-db", () => ({ ledgerDb: () => ledgerDbMock() }));
const smsRecipientStateMock = vi.fn();
vi.mock("@/lib/consent/recipient-state", () => ({ smsRecipientState: (...a: unknown[]) => smsRecipientStateMock(...a) }));

const {
  loadGroupPeople, loadGroupDeals, loadGroupHeaderPlaces, loadPrimaryText,
  loadGroupActivity, loadGroupSummary, loadGroupNextUp, loadGroupTimeline,
} = await import("./group-loaders");

const db = { tag: "request-db" } as unknown as SupabaseClient;
/** The sources a mocked page read (item 8b-2: every page names them). */
const SOURCES = ["notes", "todos", "deals", "forms", "messages", "bookings", "calls", "documents"];
const G = "11111111-1111-4111-8111-111111111111";
const ANA: GroupMember = {
  memberId: "m-ana", contactId: "c-ana", firstName: "Ana", lastName: "García", phone: "+19565550100",
  email: "ana@example.com", role: null, isBilling: false, isPrimaryContact: true, joinedAt: "2026-01-01T00:00:00Z",
};
const OPEN_GATE = { ok: true as const, from: "+19565550199", ownedNumbers: ["+19565550199"] };
const CONTACT = { id: "c-ana", phone: "+19565550100", email: "ana@example.com", phone_country_unconfirmed: false };

let errors: MockInstance<typeof console.error>;
const logged = () => errors.mock.calls.map((c) => String(c[0]));

describe("group record loaders", () => {
  beforeEach(() => {
    for (const f of [listGroupMembersMock, listOpenDealsForMock, listGroupPlacesMock, getContactMock, smsRecipientStateMock,
      groupActivityMembersMock, groupFactsMock, groupNextUpMock, listTimelinePageMock, listPeopleNamesMock, getVoiceProfileMock]) f.mockReset();
    ledgerDbMock.mockClear();
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errors.mockRestore());

  it("People: a page is ready with its cursor passed through, and a failed read is the card's error, logged by card and account only (mutation: rethrow -> FAILS; mutation: log the group id -> FAILS)", async () => {
    const page = { primary: ANA, members: [], next: null };
    listGroupMembersMock.mockResolvedValueOnce(page);
    const after = { v: "2026-01-01T00:00:00.000Z", id: "22222222-2222-4222-8222-222222222222" };
    expect(await loadGroupPeople(db, "acct1", G, after)).toEqual({ status: "ready", page });
    expect(listGroupMembersMock).toHaveBeenCalledWith(db, "acct1", G, { after });

    listGroupMembersMock.mockRejectedValueOnce(new Error("members down"));
    expect(await loadGroupPeople(db, "acct1", G)).toEqual({ status: "error" });
    expect(logged()).toEqual([expect.stringMatching(/^record page: people read failed for account acct1: /)]);
    expect(logged().join("\n")).not.toContain(G);
  });

  it("Deals: reads exactly the set it is handed and returns it for the names (C13; mutation: read the deals of no one -> FAILS)", async () => {
    const set = [{ contactId: "c1", firstName: "Ana", lastName: null }, { contactId: "c2", firstName: "Luis", lastName: null }];
    const deals = [{ id: "d1", name: "Deck", status: "open", monetary_value: 10, created_at: "2026-01-01T00:00:00Z", contact_id: "c2" }];
    listOpenDealsForMock.mockResolvedValueOnce({ deals, count: 41 });
    expect(await loadGroupDeals(db, "acct1", async () => set)).toEqual({ status: "ready", deals, count: 41, people: set });
    expect(listOpenDealsForMock).toHaveBeenCalledWith(db, "acct1", ["c1", "c2"]);
  });

  it("Deals: a failed people read or a failed deals read is the card's error, never a throw (mutation: let the people read escape the try -> FAILS)", async () => {
    expect(await loadGroupDeals(db, "acct1", async () => { throw new Error("people down"); })).toEqual({ status: "error" });
    expect(listOpenDealsForMock).not.toHaveBeenCalled();
    listOpenDealsForMock.mockRejectedValueOnce(new Error("deals down"));
    expect(await loadGroupDeals(db, "acct1", async () => [{ contactId: "c1", firstName: null, lastName: null }])).toEqual({ status: "error" });
    expect(logged()).toEqual([
      expect.stringMatching(/^record page: deals read failed for account acct1: /),
      expect.stringMatching(/^record page: deals read failed for account acct1: /),
    ]);
  });

  it("the header's places are soft: null on a failed read, logged (mutation: rethrow -> FAILS)", async () => {
    const places = { groups: [], places: [], placeCount: 0, equipment: [], equipmentCount: 0 };
    listGroupPlacesMock.mockResolvedValueOnce(places);
    expect(await loadGroupHeaderPlaces(db, "acct1", G)).toBe(places);
    expect(listGroupPlacesMock).toHaveBeenCalledWith(db, "acct1", G);
    listGroupPlacesMock.mockRejectedValueOnce(new Error("places down"));
    expect(await loadGroupHeaderPlaces(db, "acct1", G)).toBeNull();
    expect(logged()).toEqual([expect.stringMatching(/^record page: header places read failed for account acct1: /)]);
  });

  it("Text: no call-first member, or no gate, is false with no contact read, no ledger client and nothing logged, because neither is a failure (mutation: drop the primary guard -> FAILS)", async () => {
    expect(await loadPrimaryText({ db, accountId: "acct1", primary: null, smsGate: OPEN_GATE, zone: "UTC", locale: "en" })).toBe(false);
    expect(await loadPrimaryText({ db, accountId: "acct1", primary: ANA, smsGate: null, zone: "UTC", locale: "en" })).toBe(false);
    expect(getContactMock).not.toHaveBeenCalled();
    expect(ledgerDbMock).not.toHaveBeenCalled();
    expect(logged()).toEqual([]);
  });

  it("Text: a closed gate (no approved number yet, most accounts today) is false with no contact read and no ledger client (mutation: drop the gate.ok skip -> FAILS)", async () => {
    getContactMock.mockResolvedValue(CONTACT);
    smsRecipientStateMock.mockResolvedValue({ kind: "ok" });
    for (const reason of ["a2p_not_approved", "no_live_number"] as const) {
      expect(await loadPrimaryText({ db, accountId: "acct1", primary: ANA, smsGate: { ok: false, reason }, zone: "UTC", locale: "en" })).toBe(false);
    }
    expect(getContactMock).not.toHaveBeenCalled();
    expect(ledgerDbMock).not.toHaveBeenCalled();
    expect(logged()).toEqual([]);
  });

  it("Text: a call-first member getContact cannot see is false, and the ledger client is never built (mutation: build the ledger before the contact check -> FAILS)", async () => {
    getContactMock.mockResolvedValueOnce(null);
    expect(await loadPrimaryText({ db, accountId: "acct1", primary: ANA, smsGate: OPEN_GATE, zone: "UTC", locale: "en" })).toBe(false);
    expect(getContactMock).toHaveBeenCalledWith(db, "acct1", "c-ana");
    expect(ledgerDbMock).not.toHaveBeenCalled();
  });

  it("Text: the ledger client is built only AFTER getContact on the request client resolved the member (C14; mutation: build it first -> FAILS)", async () => {
    getContactMock.mockResolvedValueOnce(CONTACT);
    smsRecipientStateMock.mockResolvedValueOnce({ kind: "ok" });
    expect(await loadPrimaryText({ db, accountId: "acct1", primary: ANA, smsGate: OPEN_GATE, zone: "UTC", locale: "en" })).toBe(true);
    expect(getContactMock.mock.invocationCallOrder[0]).toBeLessThan(ledgerDbMock.mock.invocationCallOrder[0]!);
    expect(smsRecipientStateMock).toHaveBeenCalledWith(LEDGER, "acct1", CONTACT);
  });

  it("Text answers canTextFrom's verdict: a stop, a closed gate or no usable number is false (mutation: return true once the contact is found -> FAILS)", async () => {
    getContactMock.mockResolvedValue(CONTACT);
    smsRecipientStateMock.mockResolvedValueOnce({ kind: "stopped", since: "2026-01-01T00:00:00Z" });
    expect(await loadPrimaryText({ db, accountId: "acct1", primary: ANA, smsGate: OPEN_GATE, zone: "UTC", locale: "es" })).toBe(false);
    smsRecipientStateMock.mockResolvedValueOnce({ kind: "ok" });
    expect(await loadPrimaryText({ db, accountId: "acct1", primary: ANA, smsGate: { ok: false, reason: "a2p_not_approved" }, zone: "UTC", locale: "en" })).toBe(false);
    getContactMock.mockResolvedValueOnce({ ...CONTACT, phone: "12" });
    smsRecipientStateMock.mockResolvedValueOnce({ kind: "ok" });
    expect(await loadPrimaryText({ db, accountId: "acct1", primary: ANA, smsGate: OPEN_GATE, zone: "UTC", locale: "en" })).toBe(false);
  });

  it("Text fails closed: a throw anywhere is false, logged as the primary text read by account, apart from the gate read (mutation: rethrow -> FAILS; mutation: the label loaders.ts uses -> FAILS)", async () => {
    getContactMock.mockRejectedValueOnce(new Error("contact down"));
    expect(await loadPrimaryText({ db, accountId: "acct1", primary: ANA, smsGate: OPEN_GATE, zone: "UTC", locale: "en" })).toBe(false);
    getContactMock.mockResolvedValueOnce(CONTACT);
    smsRecipientStateMock.mockRejectedValueOnce(new Error("ledger down"));
    expect(await loadPrimaryText({ db, accountId: "acct1", primary: ANA, smsGate: OPEN_GATE, zone: "UTC", locale: "en" })).toBe(false);
    expect(logged()).toEqual([
      expect.stringMatching(/^record page: primary text read failed for account acct1: /),
      expect.stringMatching(/^record page: primary text read failed for account acct1: /),
    ]);
    expect(logged().join("\n")).not.toContain("c-ana");
  });
});

describe("group record loaders, the middle column (S-03 part 2b)", () => {
  const IDS = ["c-ana", "c-luis"];
  const NOW = new Date("2026-10-12T15:00:00Z");
  beforeEach(() => {
    for (const f of [groupActivityMembersMock, groupFactsMock, groupNextUpMock, listTimelinePageMock, listPeopleNamesMock, getVoiceProfileMock]) f.mockReset();
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errors.mockRestore());

  it("the activity set: ready with the set, or the three cards' error on a failed scan, logged by card and account only (mutation: rethrow -> FAILS; mutation: log the group id -> FAILS)", async () => {
    const activity = { people: [{ contactId: "c-ana", firstName: "Ana", lastName: "García" }], total: { ok: true, value: 1 } };
    groupActivityMembersMock.mockResolvedValueOnce(activity);
    expect(await loadGroupActivity(db, "acct1", G)).toEqual({ status: "ready", activity });
    expect(groupActivityMembersMock).toHaveBeenCalledWith(db, "acct1", G, undefined, { onError: expect.any(Function) });
    groupActivityMembersMock.mockRejectedValueOnce(new Error("scan down"));
    expect(await loadGroupActivity(db, "acct1", G)).toEqual({ status: "error" });
    expect(logged()).toEqual([expect.stringMatching(/^record page: activity set read failed for account acct1: /)]);
    expect(logged().join("\n")).not.toContain(G);
  });

  it("a failed head count leaves the set ready and is logged once, by card and account only (review of Task 16; mutation: drop the onError pass -> nothing logged, FAILS)", async () => {
    const activity = { people: [{ contactId: "c-ana", firstName: "Ana", lastName: "García" }], total: { ok: false }, more: false };
    groupActivityMembersMock.mockImplementationOnce(async (_db, _a, _g, _cap, opts: { onError: (n: string, e: unknown) => void }) => {
      opts.onError("people", new Error("countGroupMembers failed: no count returned"));
      return activity;
    });
    expect(await loadGroupActivity(db, "acct1", G)).toEqual({ status: "ready", activity });
    expect(logged()).toEqual([expect.stringMatching(/^record page: activity set \(people\) read failed for account acct1: /)]);
    expect(logged().join("\n")).not.toContain(G);
    expect(logged().join("\n")).not.toContain("c-ana");
  });

  it("the summary reads exactly the set, logs a failed fact by name, and a throw is the card's error (mutation: rethrow -> FAILS; mutation: drop the onError log -> FAILS)", async () => {
    const facts = { bookingsMade: { ok: true, value: 2 }, lastTalked: { ok: false } };
    groupFactsMock.mockImplementationOnce(async (_db, _a, _ids, opts: { onError: (n: string, e: unknown) => void }) => {
      opts.onError("talked", new Error("messages down"));
      return facts;
    });
    expect(await loadGroupSummary(db, "acct1", IDS)).toEqual({ status: "ready", facts });
    expect(groupFactsMock).toHaveBeenCalledWith(db, "acct1", IDS, expect.objectContaining({ onError: expect.any(Function) }));
    expect(logged()).toEqual([expect.stringMatching(/^record page: summary \(talked\) read failed for account acct1: /)]);
    groupFactsMock.mockRejectedValueOnce(new Error("boom"));
    expect(await loadGroupSummary(db, "acct1", IDS)).toEqual({ status: "error" });
    expect(logged().at(-1)).toMatch(/^record page: summary read failed for account acct1: /);
  });

  it("Next up reads exactly the set at now, and a throw is the card's error (mutation: rethrow -> FAILS)", async () => {
    const data = { bookings: [], datedTasks: [], undatedCount: 1 };
    groupNextUpMock.mockResolvedValueOnce(data);
    expect(await loadGroupNextUp(db, "acct1", IDS, NOW)).toEqual({ status: "ready", data });
    expect(groupNextUpMock).toHaveBeenCalledWith(db, "acct1", IDS, NOW.toISOString());
    groupNextUpMock.mockRejectedValueOnce(new Error("tasks down"));
    expect(await loadGroupNextUp(db, "acct1", IDS, NOW)).toEqual({ status: "error" });
    expect(logged()).toEqual([expect.stringMatching(/^record page: next up read failed for account acct1: /)]);
  });

  it("the timeline: one merged page across the set with names and the persona, no hold read; every source failed or a throw is the card's error (mutation: rethrow -> FAILS; mutation: treat one failed source as the card's error -> FAILS)", async () => {
    const before = { v: "2026-10-01T00:00:00.000Z", id: "22222222-2222-4222-8222-222222222222" };
    const page = { items: [{ kind: "note", id: "n1", at: "2026-10-09T16:12:00Z", contactId: "c-ana", note: { id: "n1", body: "x", author_id: "user_dan", created_at: "2026-10-09T16:12:00Z" } }], older: null, failed: ["calls"], sources: SOURCES };
    listTimelinePageMock.mockResolvedValueOnce(page);
    listPeopleNamesMock.mockResolvedValueOnce({ user_dan: "Dan López" });
    getVoiceProfileMock.mockResolvedValueOnce({ persona_name: "Sofía" });
    expect(await loadGroupTimeline(db, "acct1", IDS, before)).toEqual({ status: "ready", page, names: { user_dan: "Dan López" }, personaName: "Sofía" });
    expect(listTimelinePageMock).toHaveBeenCalledWith(db, "acct1", IDS, before, expect.objectContaining({ onError: expect.any(Function) }));
    expect(listPeopleNamesMock).toHaveBeenCalledWith(db, ["user_dan"]);

    const eight = ["notes", "todos", "deals", "forms", "messages", "bookings", "calls", "documents"];
    listTimelinePageMock.mockResolvedValueOnce({ items: [], older: null, failed: eight, sources: eight });
    expect(await loadGroupTimeline(db, "acct1", IDS)).toEqual({ status: "error" });
    listTimelinePageMock.mockRejectedValueOnce(new Error("boom"));
    expect(await loadGroupTimeline(db, "acct1", IDS)).toEqual({ status: "error" });
    expect(logged()).toEqual([expect.stringMatching(/^record page: activity read failed for account acct1: /)]);
  });

  // item 8b-2: a household none of whose members this reader can see reads nothing (record.ts's early
  // return), so `failed` and `sources` are both empty; 0 >= 0 must not turn that into the error state.
  it("an empty set's page (nothing read, nothing failed) is an empty timeline, never the card's error (mutation: drop the `> 0` -> FAILS)", async () => {
    listTimelinePageMock.mockResolvedValueOnce({ items: [], older: null, failed: [], sources: [] });
    listPeopleNamesMock.mockResolvedValueOnce({});
    getVoiceProfileMock.mockResolvedValueOnce(null);
    expect(await loadGroupTimeline(db, "acct1", [])).toEqual({
      status: "ready", page: { items: [], older: null, failed: [], sources: [] }, names: {}, personaName: null,
    });
  });

  it("the timeline reads the group's own documents too: the group id reaches listTimelinePage (S-07, plan deviation 3; mutation: drop the groupId pass-through -> FAILS)", async () => {
    listTimelinePageMock.mockResolvedValueOnce({ items: [], older: null, failed: [], sources: SOURCES });
    listPeopleNamesMock.mockResolvedValueOnce({});
    getVoiceProfileMock.mockResolvedValueOnce(null);
    await loadGroupTimeline(db, "acct1", IDS, undefined, G);
    expect(listTimelinePageMock).toHaveBeenCalledWith(db, "acct1", IDS, undefined, expect.objectContaining({ groupId: G }));
  });

  // Item 8b-2 (final review M-3): accepted suggestions are the contact page's source only. The group page
  // reads no stage names and its rows would read "Review the stage change", so it never asks for them.
  it("the group timeline never asks listTimelinePage for suggestions (mutation: pass suggestions: true -> FAILS)", async () => {
    for (const before of [undefined, { at: "2026-10-01T00:00:00Z", id: "x" }]) {
      listTimelinePageMock.mockResolvedValueOnce({ items: [], older: null, failed: [], sources: SOURCES });
      listPeopleNamesMock.mockResolvedValueOnce({});
      getVoiceProfileMock.mockResolvedValueOnce(null);
      await loadGroupTimeline(db, "acct1", IDS, before as never, G);
      const opts = listTimelinePageMock.mock.lastCall![4] as { suggestions?: boolean };
      expect(opts.suggestions).not.toBe(true);
    }
  });
});
