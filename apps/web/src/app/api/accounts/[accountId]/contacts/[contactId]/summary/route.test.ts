import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The list drawer's one read (S-03 part 3 §7). Every loader is the record page's own, run for real
 * over mocked @bis/db readers, so a section's failure is proven end to end through its loader.
 */
const order: string[] = [];
const access = vi.fn();
vi.mock("@/lib/auth", () => ({ apiAccountAccess: (...a: unknown[]) => access(...a) }));
const accountRead = vi.fn(async (): Promise<{ data: unknown; error: unknown }> =>
  ({ data: { timezone: "America/Chicago", language: null }, error: null }));
const db = { from: (table: string) => { order.push(table); const chain = { select: () => chain, eq: () => chain, maybeSingle: () => accountRead() }; return chain; } };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => db }));
vi.mock("@/lib/zone", () => ({
  renderZone: async (z?: string) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC", source: z ? "account" : "fallback" }),
}));
const prefs = vi.fn(async () => ({ language: null as "en" | "es" | null, theme: null }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: () => { order.push("getPersonPrefs"); return prefs(); } }));
const ledger = { tag: "ledger" };
const ledgerDbFn = vi.fn(() => { order.push("ledgerDb"); return ledger; });
vi.mock("@/lib/consent/ledger-db", () => ({ ledgerDb: () => ledgerDbFn() }));
const smsState = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ kind: "ok" }));
vi.mock("@/lib/consent/recipient-state", () => ({ smsRecipientState: (...a: unknown[]) => smsState(...a) }));
const gate = vi.fn(async (): Promise<unknown> => ({ ok: false, reason: "a2p_not_approved" }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => { order.push("resolveSmsSender"); return gate(); } }));

const READY_FACTS = { bookingsMade: { ok: true, value: 0 }, lastTalked: { ok: true, value: null }, openDeals: { ok: true, value: { count: 0, amount: null } } };
const NO_PLACES = { groups: [], places: [], placeCount: 0, equipment: [], equipmentCount: 0 };
/** The sources a mocked page read (item 8b-2: every page names them). */
const SOURCES = ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"];
const EMPTY_PAGE = { items: [], older: null, failed: [], sources: SOURCES };
const dbMocks = {
  getContact: vi.fn(), contactFacts: vi.fn(), contactNextUp: vi.fn(), listContactTimelinePage: vi.fn(), listPeopleNames: vi.fn(),
  getVoiceProfile: vi.fn(), listContactTags: vi.fn(), listContactPlaces: vi.fn(), listContactMessages: vi.fn(), holdOpenTaskIds: vi.fn(),
};
vi.mock("@bis/db", () => ({
  ...Object.fromEntries(Object.entries(dbMocks).map(([k, f]) => [k, (...a: unknown[]) => { order.push(k); return f(...a); }])),
  TIMELINE_SOURCES: ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"],
  listContactOpportunities: async () => [], listCustomFields: async () => [],
}));

const { GET } = await import("./route");
const { parseDrawerSummary } = await import("@/lib/contacts/drawer-summary");
const { m } = await import("@/lib/messages");

const CONTACT = { id: "c1", first_name: "Maria", last_name: "Garcia", email: "maria@example.com", phone: "+19565550100", company_name: null,
  created_at: "2025-12-02T00:00:00Z", source: "voice", custom: {}, attribution: null, assigned_to: null, phone_country_unconfirmed: false,
  // S-09: the seven 0076 columns languageView reads; null here so every case still builds a "not set" view.
  language: null, language_source: null, language_set_at: null,
  last_language_signal: null, last_language_signal_source: null, last_language_signal_at: null, language_hint_kept_at: null };
const AT = "2026-10-09T16:12:00Z";
const BOOKING = { kind: "booking", id: "b1", at: AT, contactId: "c1", booking: { id: "b1", contact_id: "c1", created_at: AT, starts_at: "2026-10-16T15:00:00Z",
  status: "booked", note: null, author_kind: "customer", author_id: null, rescheduled_from_id: null, moved_from_starts_at: null } };
const SUBMISSION = { kind: "submission", id: "s1", at: "2026-10-08T16:12:00Z", contactId: "c1",
  submission: { id: "s1", created_at: "2026-10-08T16:12:00Z", formName: "Contact us", answers: [], author_kind: "customer" } };

const req = (q = "") => new Request(`http://x/api/accounts/a1/contacts/c1/summary${q}`);
const ctx = () => ({ params: Promise.resolve({ accountId: "a1", contactId: "c1" }) });
const body = async (q = "") => (await GET(req(q), ctx())).json();

beforeEach(() => {
  order.length = 0;
  access.mockReset().mockResolvedValue({ userId: "u1", isAgency: true });
  accountRead.mockReset().mockResolvedValue({ data: { timezone: "America/Chicago", language: null }, error: null });
  ledgerDbFn.mockReset().mockImplementation(() => { order.push("ledgerDb"); return ledger; });
  prefs.mockReset().mockResolvedValue({ language: null, theme: null });
  smsState.mockReset().mockResolvedValue({ kind: "ok" });
  gate.mockReset().mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
  dbMocks.getContact.mockReset().mockResolvedValue(CONTACT);
  dbMocks.contactFacts.mockReset().mockResolvedValue(READY_FACTS);
  dbMocks.contactNextUp.mockReset().mockResolvedValue({ bookings: [], datedTasks: [], undatedCount: 0 });
  dbMocks.listContactTimelinePage.mockReset().mockResolvedValue(EMPTY_PAGE);
  dbMocks.listPeopleNames.mockReset().mockResolvedValue({});
  dbMocks.getVoiceProfile.mockReset().mockResolvedValue(null);
  dbMocks.listContactTags.mockReset().mockResolvedValue([{ id: "t1", name: "vip" }]);
  dbMocks.listContactPlaces.mockReset().mockResolvedValue(NO_PLACES);
  dbMocks.listContactMessages.mockReset().mockResolvedValue([]);
  dbMocks.holdOpenTaskIds.mockReset().mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("the drawer's summary route: authorisation first", () => {
  it("without access, a 404 that reads nothing", async () => {
    access.mockResolvedValueOnce(null);
    expect((await GET(req(), ctx())).status).toBe(404);
    expect(order).toEqual([]);
  });

  it("a contact the caller cannot see is a 404 before ANY other read — the ledger client and the accounts timezone/language read included (mutation: move the accounts read before getContact -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValueOnce(null);
    expect((await GET(req(), ctx())).status).toBe(404);
    expect(order).toEqual(["getContact"]);
  });

  it("the ledger client is built only after getContact proved the contact (mutation: build it first -> FAILS)", async () => {
    await body();
    expect(order.indexOf("ledgerDb")).toBeGreaterThan(order.indexOf("getContact"));
    expect(smsState).toHaveBeenCalledWith(ledger, "a1", CONTACT);
  });
});

describe("the drawer's summary route: each section loads and fails on its own (C2)", () => {
  it.each([
    ["facts", () => dbMocks.contactFacts.mockRejectedValueOnce(new Error("down")), (b: Record<string, { status: string }>) => b.facts],
    ["nextUp", () => dbMocks.contactNextUp.mockRejectedValueOnce(new Error("down")), (b: Record<string, { status: string }>) => b.nextUp],
    ["recent", () => dbMocks.listContactTimelinePage.mockRejectedValueOnce(new Error("down")), (b: Record<string, { status: string }>) => b.recent],
    ["tags", () => dbMocks.listContactTags.mockRejectedValueOnce(new Error("down")), (b: { who: { tags: { status: string } } }) => b.who.tags],
  ])("%s failing alone is that section's error and the rest are ready (mutation: one Promise.all without per-section loads -> the route 500s, FAILS)", async (name, fail, pick) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    fail();
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const b = await res.json();
    expect((pick as (x: unknown) => { status: string })(b).status).toBe("error");
    const others = { facts: b.facts.status, nextUp: b.nextUp.status, recent: b.recent.status, tags: b.who.tags.status };
    delete (others as Record<string, string>)[name];
    expect(Object.values(others)).toEqual(["ready", "ready", "ready"]);
    expect(errors).toHaveBeenCalled();
  });

  it("the sections' own error words, in English for an agency reader", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.contactFacts.mockRejectedValueOnce(new Error("down"));
    dbMocks.contactNextUp.mockRejectedValueOnce(new Error("down"));
    dbMocks.listContactTimelinePage.mockRejectedValueOnce(new Error("down"));
    const b = await body();
    expect([b.facts.text, b.nextUp.text, b.recent.text]).toEqual([m["record.summary.failed"], m["record.nextUp.failed"], m["record.activity.failed"]]);
  });

  it("the same section error words, in Spanish for a Spanish-account client reader (mutation: build the error text in English regardless of locale -> FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    access.mockResolvedValue({ userId: "u1", isAgency: false });
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    dbMocks.contactFacts.mockRejectedValueOnce(new Error("down"));
    dbMocks.contactNextUp.mockRejectedValueOnce(new Error("down"));
    dbMocks.listContactTimelinePage.mockRejectedValueOnce(new Error("down"));
    const b = await body();
    expect([b.facts.text, b.nextUp.text, b.recent.text]).toEqual([m["record.summary.failed.es"], m["record.nextUp.failed.es"], m["record.activity.failed.es"]]);
  });

  it("a view builder throwing (not just a failed read) costs only the sections that build on it — the viewOf guard (mutation: call factsView outside the try/catch -> the route 500s, FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // The reads succeed, but the zone every view is built in is unusable: factsView's own
    // talkedWhen -> calendarDaysAgo -> partsInZone, and nextUpView's own dayKeyIn(now, zone), both
    // call Intl.DateTimeFormat with this zone directly and do NOT catch — unlike sinceMonth's own
    // RangeError guard — so both views throw AFTER their (successful) reads. Recent stays ready:
    // its page is empty, so timelineRows never reaches a date format call. who.tags is untouched —
    // a separate loader entirely.
    accountRead.mockResolvedValueOnce({ data: { timezone: "Not/AZone", language: null }, error: null });
    dbMocks.contactFacts.mockResolvedValueOnce({
      bookingsMade: { ok: true, value: 0 },
      lastTalked: { ok: true, value: { at: AT, channel: "call" } },
      openDeals: { ok: true, value: { count: 0, amount: null } },
    });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.facts.status).toBe("error");
    expect(b.facts.text).toBe(m["record.summary.failed"]);
    expect(b.nextUp.status).toBe("error");
    expect([b.recent.status, b.who.tags.status]).toEqual(["ready", "ready"]);
    expect(errors).toHaveBeenCalled();
  });

  it("ledgerDb() itself throwing (not just the ledger read) still answers 200, with Text closed rather than a 500 (mutation: build the ledger client outside smsRead's try/catch -> FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    gate.mockResolvedValue({ ok: true, from: "+19565559999", ownedNumbers: ["+19565559999"] });
    ledgerDbFn.mockImplementationOnce(() => { throw new Error("no service key"); });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const b = await res.json();
    // Text would otherwise show (a usable number, an open gate); "unknown" consent closes it —
    // the degraded line composerStateLine reads for a ledger it could not ask.
    expect(b.header.actions.map((a: { id: string }) => a.id)).toEqual(["call", "email"]);
    expect(b.facts.status).toBe("ready");
    expect(errors).toHaveBeenCalled();
  });
});

describe("the drawer's summary route: Recent (D5, C6)", () => {
  it("reads the head of the timeline, five rows (mutation: drop the limit -> 30, FAILS)", async () => {
    await body();
    expect(dbMocks.listContactTimelinePage).toHaveBeenCalledWith(db, "a1", "c1", undefined, expect.objectContaining({ limit: 5 }));
  });

  it("the submission once, never the inbox's form copy beside it: no direct message read (mutation: re-add today's listContactMessages read -> FAILS)", async () => {
    dbMocks.listContactMessages.mockResolvedValue([{ id: "x1", channel: "form", direction: "inbound", body: "Leak", created_at: AT }]);
    dbMocks.listContactTimelinePage.mockResolvedValueOnce({ items: [BOOKING, SUBMISSION], older: null, failed: [], sources: SOURCES });
    const b = await body();
    expect(b.recent.rows.map((r: { kind: string }) => r.kind)).toEqual(["booking", "submission"]);
    expect(dbMocks.listContactMessages).not.toHaveBeenCalled();
  });

  it("every row is marked, the booking page's booking the customer's; See all opens the record's timeline", async () => {
    dbMocks.listContactTimelinePage.mockResolvedValueOnce({ items: [BOOKING], older: null, failed: [], sources: SOURCES });
    const b = await body();
    expect(b.recent.rows[0].mark).toEqual({ kind: "customer", label: m["provenance.customer"] });
    expect(b.recent.seeAllHref).toBe("/dashboard/accounts/a1/contacts/c1#record-timeline");
    expect(b.recent.emptyText).toBeNull();
  });

  it("empty only when nothing failed; a failed source says so and keeps the rows that loaded (rule 5: a failure is not 'nothing')", async () => {
    expect((await body()).recent.emptyText).toBe(m["timeline.empty"]);
    dbMocks.listContactTimelinePage.mockResolvedValueOnce({ items: [BOOKING], older: null, failed: ["calls"], sources: SOURCES });
    const b = await body();
    expect(b.recent.emptyText).toBeNull();
    expect(b.recent.failedText).toBe(m["timeline.someFailed"].replace("{what}", m["timeline.what.calls"]));
    expect(b.recent.rows).toHaveLength(1);
  });

  it("zero rows AND a failed source is still not empty: a failure is not 'nothing' even with nothing to show (mutation: emptyText on rows.length === 0 alone -> FAILS)", async () => {
    dbMocks.listContactTimelinePage.mockResolvedValueOnce({ items: [], older: null, failed: ["calls"], sources: SOURCES });
    const b = await body();
    expect(b.recent.rows).toHaveLength(0);
    expect(b.recent.emptyText).toBeNull();
    expect(b.recent.failedText).toBe(m["timeline.someFailed"].replace("{what}", m["timeline.what.calls"]));
  });
});

describe("the drawer's summary route: the header (D2, C7, C8)", () => {
  it("Text and Email open the record page's composer, Call is the only primary (mutation: omit composeHref -> a bare #compose-sms, FAILS)", async () => {
    gate.mockResolvedValue({ ok: true, from: "+19565559999", ownedNumbers: ["+19565559999"] });
    const b = await body();
    expect(b.header.actions.map((a: { id: string }) => a.id)).toEqual(["call", "text", "email"]);
    expect(b.header.actions.find((a: { id: string }) => a.id === "text").href).toBe("/dashboard/accounts/a1/contacts/c1#compose-sms");
    expect(b.header.actions.find((a: { id: string }) => a.id === "email").href).toBe("/dashboard/accounts/a1/contacts/c1#compose-email");
    expect(b.header.actions.filter((a: { primary: boolean }) => a.primary).map((a: { id: string }) => a.id)).toEqual(["call"]);
    expect(b.header.actions[0]).toMatchObject({ label: m["record.action.call"], ariaLabel: "Call Maria Garcia" });
  });

  it("a closed gate or a stopped number hides Text; no email hides Email; none renders disabled (mutation: ignore the consent line -> FAILS)", async () => {
    gate.mockResolvedValue({ ok: true, from: "+19565559999", ownedNumbers: ["+19565559999"] });
    smsState.mockResolvedValue({ kind: "stopped", since: "2026-10-01T00:00:00Z" });
    dbMocks.getContact.mockResolvedValue({ ...CONTACT, email: null });
    expect((await body()).header.actions.map((a: { id: string }) => a.id)).toEqual(["call"]);
  });

  it("the main group's words link to its page", async () => {
    dbMocks.listContactPlaces.mockResolvedValue({ ...NO_PLACES, groups: [{ id: "g1", kind: "household", name: "García", isPrimary: true }] });
    const b = await body();
    expect(b.header.subtitle).toBe(m["record.group.household"].replace("{group}", "García"));
    expect(b.header.subtitleHref).toBe("/dashboard/accounts/a1/groups/g1");
  });
});

describe("the drawer's summary route: one locale, resolved on the server (C1, §7.3)", () => {
  it("a client with no language of their own on a Spanish account reads Spanish (mutation: pass isOperator: true for a client -> English, FAILS)", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: false });
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    const b = await body();
    expect(b.locale).toBe("es");
    expect(b.header.actions[0].label).toBe(m["record.action.call.es"]);
    expect(b.nextUp.emptyText).toBe(m["record.nextUp.empty.es"]);
    expect(b.who.sourceHint).toBe(m["contact.source.machine.voice.es"]);
  });

  it("the agency reads its own language on that account (requestLocale's role split)", async () => {
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    expect((await body()).locale).toBe("en");
  });

  it("the QA override the drawer forwards reaches the strings (C9; mutation: drop { locale } from requestPseudoMode -> FAILS)", async () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    const b = await body("?locale=pseudo");
    expect(b.header.actions[0].label).not.toBe(m["record.action.call"]);
    expect(b.locale).toBe("en");
  });
});

describe("the drawer's summary route: who they are (D6, Q1)", () => {
  it("source, its caption, the holder and the contact's own fields, off the same getContact read (mutation: drop any -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue({ ...CONTACT, assigned_to: "11111111-1111-4111-8111-111111111111", source: "form: Contact us",
      attribution: { first: { ref: "https://chat.openai.com/" } } });
    const b = await body();
    expect(b.who).toEqual({
      source: "form: Contact us", sourceHint: "Found through ChatGPT", assignedTo: "11111111-1111-4111-8111-111111111111",
      fields: { first_name: "Maria", last_name: "Garcia", email: "maria@example.com", phone: "+19565550100", company_name: null },
      tags: { status: "ready", tags: [{ id: "t1", name: "vip" }] },
      language: { value: null, valueLabel: null, phrase: "Not set. Messages go out in English.", hint: null },
    });
  });

  it("who.language is the record page's own view, in the account's zone (S-09 §8.1; mutation: omit language from who -> FAILS)", async () => {
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: null }, error: null });
    dbMocks.getContact.mockResolvedValueOnce({ ...CONTACT, language: "es", language_source: "booking", language_set_at: "2026-10-03T15:00:00+00:00" });
    const b = await body();
    expect(b.who.language).toEqual({ value: "es", valueLabel: "Español", phrase: "from their booking (Oct 3)", hint: null });
  });

  it("an unset contact on a Spanish account names the account's language (S-09 PR 2; mutation: ignore accountRow.language -> FAILS)", async () => {
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    const b = await body();
    expect(b.who.language.phrase).toBe("Not set. Messages go out in Spanish, the account's language.");
  });

  it("an unreadable account leaves the Not set line unqualified, never a guessed language (mutation: pass null instead of undefined when the account read fails -> FAILS)", async () => {
    accountRead.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const b = await body();
    expect(b.who.language.phrase).toBe("Not set.");
    expect(errors).toHaveBeenCalled();
  });

  it("review M1/M-2: a bad stored language_set_at leaves who.language OUT (the drawer then shows no line), never a false \"Not set.\" and never a 500 (mutation: call languageView outside viewOf -> 500; or fall back to a not-set view -> the key is present; each FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.getContact.mockResolvedValueOnce({ ...CONTACT, language: "es", language_source: "booking", language_set_at: "not-a-date" });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.who).not.toHaveProperty("language");
    expect(b.who.fields).toBeDefined();
    expect(b.facts.status).toBe("ready");
    expect(errors).toHaveBeenCalled();
  });

  it("an unassigned customer sends null, never leaves the field out (mutation: send undefined -> FAILS)", async () => {
    expect(await body()).toHaveProperty(["who", "assignedTo"], null);
  });

  it("the old shape is gone: no recent labels, no phone_country_unconfirmed, no zone (D11)", async () => {
    const b = await body();
    expect(Object.keys(b).sort()).toEqual(["facts", "header", "locale", "nextUp", "recent", "who"]);
  });
});

describe("what the route sends, the drawer's parser accepts whole", () => {
  it("parses to exactly the body sent, with a row of every kind (mutation: send a field the parser drops -> FAILS)", async () => {
    gate.mockResolvedValue({ ok: true, from: "+19565559999", ownedNumbers: ["+19565559999"] });
    const items = [
      BOOKING, SUBMISSION,
      { kind: "note", id: "n1", at: AT, contactId: "c1", note: { id: "n1", body: "Prefers mornings", author_id: "u1", created_at: AT } },
      { kind: "task", id: "t1", at: AT, contactId: "c1", task: { id: "t1", title: "Call back", due_at: null, completed_at: null, created_at: AT,
        consent_event_id: null, call_id: null, assigned_to: null, created_by: "u2" } },
      { kind: "deal", id: "d1", at: AT, contactId: "c1", deal: { id: "d1", name: "Deck build", status: "open", monetary_value: 1200, created_at: AT, created_by: null } },
      { kind: "message", id: "m1", at: AT, contactId: "c1", message: { id: "m1", channel: "sms", direction: "outbound", status: "delivered", subject: null,
        body: "On our way", error: null, created_at: AT, author_kind: "person", author_id: "u1" } },
      { kind: "call", id: "k1", at: AT, contactId: "c1", call: { id: "k1", contact_id: "c1", started_at: AT, outcome: "booked", duration_secs: 180,
        reason: null, summary: "Roof leak, booked.", language: "en" } },
    ];
    dbMocks.listContactTimelinePage.mockResolvedValueOnce({ items, older: null, failed: [], sources: SOURCES });
    const b = await body();
    expect(b.recent.rows.map((r: { kind: string }) => r.kind).sort()).toEqual(["booking", "call", "deal", "message", "note", "submission", "task"]);
    const parsed = parseDrawerSummary(b)!;
    expect(parsed).toEqual({ ...b, who: { status: "ready", ...b.who } });
  });
});
