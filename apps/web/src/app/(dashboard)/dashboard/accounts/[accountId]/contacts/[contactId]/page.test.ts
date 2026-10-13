import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The full contact page's zone read (#123 m4b) — the one read this page makes
 * of its own, `accounts.timezone`, for the Email row's since-date (consent
 * PR-3; the 0049 switch it served is gone). Same shape as
 * calls/[callId]/page.test.ts: the data reads this async server component
 * reaches are mocked, and what is under test is what the page hands down.
 *
 * `renderZone` is NOT mocked to a constant here (calls/[callId] does that,
 * because it tests the note, not the read): it ECHOES the zone it was handed,
 * so the only way the row sees "America/Chicago" is if the account's row
 * reached `renderZone`.
 */

/** What the `accounts` read resolves to; a test swaps it for a failed read. */
const accountRead = vi.fn(async (): Promise<{ data: unknown; error: unknown }> =>
  ({ data: { timezone: "America/Chicago" }, error: null }));
const accountsEq = vi.fn();
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: (table: string) => {
      if (table !== "accounts") throw new Error(`unexpected read of ${table}`);
      let cols: string[] = [];
      const chain = {
        select: (c: string) => { cols = c.split(",").map((s) => s.trim()); return chain; },
        eq: (...args: unknown[]) => { accountsEq(...args); return chain; },
        // As PostgREST does: only the columns the page SELECTED come back, so a column dropped
        // from the select is a column the page never sees.
        maybeSingle: async () => {
          const r = await accountRead();
          const data = r.data && typeof r.data === "object"
            ? Object.fromEntries(Object.entries(r.data).filter(([k]) => cols.includes(k))) : r.data;
          return { ...r, data };
        },
      };
      return chain;
    },
  }),
}));

// F-085 part 1: the page reads the caller's role for the "Assigned to"
// field (and the team for its options). Defaults to the agency.
type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const requireAccountAccessMock = vi.fn<(accountId: string) => Promise<Access>>(async () => (
  { userId: "u1", isAgency: true, role: null, canManage: true }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: (accountId: string) => requireAccountAccessMock(accountId),
}));
const readPersonIdMock = vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => "p-me");
const listAccountTeamMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => [
  { userId: "p-me", clerkUserId: "c1", email: "me@x.test", name: "Ana Me", role: "staff", language: null },
  { userId: "p-t", clerkUserId: "c2", email: "tech@x.test", name: null, role: "technician", language: null },
]);

const listContactTasksMock = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
const holdOpenTaskIdsMock = vi.fn(async (..._args: unknown[]) => [] as string[]);
const getContactMock = vi.fn();
const READY_FACTS = { bookingsMade: { ok: true, value: 0 }, lastTalked: { ok: true, value: null }, openDeals: { ok: true, value: { count: 0, amount: null } } };
const NO_PLACES = { groups: [], places: [], placeCount: 0, equipment: [], equipmentCount: 0 };
const contactFactsMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => READY_FACTS);
const contactNextUpMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ bookings: [], datedTasks: [], undatedCount: 0 }));
const listContactPlacesMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => NO_PLACES);
const listContactOpportunitiesMock = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const listNotesMock = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const prefsMock = vi.fn(async () => ({ language: null as "en" | "es" | null, theme: null }));
const timelineThrows = vi.hoisted(() => ({ on: false }));
const listContactTagsMock = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const listCustomFieldsMock = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const EMPTY_PAGE = { items: [], older: null, failed: [] };
const listContactTimelinePageMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => EMPTY_PAGE);
const listPeopleNamesMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({}));
const getVoiceProfileMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock("@bis/db", () => ({
  listContactTimelinePage: (...a: unknown[]) => listContactTimelinePageMock(...a),
  listPeopleNames: (...a: unknown[]) => listPeopleNamesMock(...a),
  getVoiceProfile: (...a: unknown[]) => getVoiceProfileMock(...a),
  TIMELINE_SOURCES: ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"],
  getContact: (...args: unknown[]) => getContactMock(...args),
  listContactTags: (...args: unknown[]) => listContactTagsMock(...args),
  listNotes: (...args: unknown[]) => listNotesMock(...args),
  listContactTasks: (...args: unknown[]) => listContactTasksMock(...args),
  holdOpenTaskIds: (...args: unknown[]) => holdOpenTaskIdsMock(...args),
  listCustomFields: (...args: unknown[]) => listCustomFieldsMock(...args),
  listContactOpportunities: (...args: unknown[]) => listContactOpportunitiesMock(...args),
  listContactSubmissions: async () => [],
  listContactMessages: async () => [],
  readConsentHistory: async () => [],
  readPersonId: (...args: unknown[]) => readPersonIdMock(...args),
  listAccountTeam: (...args: unknown[]) => listAccountTeamMock(...args),
  contactFacts: (...args: unknown[]) => contactFactsMock(...args),
  contactNextUp: (...args: unknown[]) => contactNextUpMock(...args),
  listContactPlaces: (...args: unknown[]) => listContactPlacesMock(...args),
}));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: () => prefsMock() }));
// A desk: the three "have" cards render open, so their props and markers can be read.
vi.mock("@/components/record/use-phone", () => ({ usePhone: () => false, PHONE_QUERY: "(max-width: 767px)" }));

/** Echoes, in `resolveZone`'s own shape: a zone in is the account's own, no
 *  zone in is the UTC fallback, a GUESS. */
const renderZone = vi.fn(async (z: string | undefined) => (z
  ? { zone: z, guessed: false, label: z, source: "account" as const }
  : { zone: "UTC", guessed: true, label: "UTC", source: "fallback" as const }));
vi.mock("@/lib/zone", () => ({ renderZone: (z: string | undefined) => renderZone(z) }));

const resolveSmsSenderMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ ok: false, reason: "a2p_not_approved" }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => resolveSmsSenderMock(...a) }));

// "use server" modules cannot be imported into a vitest render; the page and
// the panel only BIND these, nothing is submitted here.
vi.mock("../../conversations/actions", () => ({ sendEmailAction: async () => {}, sendSmsAction: async () => {} }));
vi.mock("./actions", () => ({
  updateContactAction: async () => {}, addTagAction: async () => {}, removeTagAction: async () => {},
  addNoteAction: async () => {}, addTaskAction: async () => {}, completeTaskAction: async () => {},
}));
vi.mock("../actions", () => ({
  updateContactFieldAction: async () => ({ ok: true }),
}));
// The timeline pulls in the message composer; only its props are pinned.
// Relationships spec §7: the Related people card, under the fields panel. Recorded, not run: it
// fetches its own route on the client and has its own tests (relationships-card.test.ts).
const relationshipsCardProps: unknown[] = [];
vi.mock("../relationships-card", () => ({ RelationshipsCard: (p: unknown) => { relationshipsCardProps.push(p); return null; } }));
// S-02 B2 §8: the Properties card, between Groups and Deals. Recorded, not run: it fetches its own
// route on the client and has its own tests (places-card.test.ts).
const placesCardProps: unknown[] = [];
vi.mock("../places-card", () => ({ PlacesCard: (p: unknown) => { placesCardProps.push(p); return null; } }));
const timelineProps = vi.fn();
vi.mock("./activity-timeline", () => ({
  ActivityTimeline: (props: Record<string, unknown>) => {
    timelineProps(props);
    if (timelineThrows.on) throw new Error("timeline render boom");
    return null;
  },
}));
// Consent chain PR-1: the composer's recipient read, stubbed per test.
const recipientState = vi.fn();
const emailRecipientStateMock = vi.fn();
vi.mock("@/lib/consent/recipient-state", () => ({
  smsRecipientState: (...a: unknown[]) => recipientState(...a),
  emailRecipientState: (...a: unknown[]) => emailRecipientStateMock(...a),
}));
const textsRowProps = vi.fn();
vi.mock("../texts-row", () => ({
  TextsRow: (props: Record<string, unknown>) => { textsRowProps(props); return null; },
}));
// Consent chain PR-2: the Texts row's read, stubbed per test.
const readTextsView = vi.fn();
vi.mock("@/lib/consent/texts-view", () => ({ readTextsView: (...a: unknown[]) => readTextsView(...a) }));

/** The Email row's props, as the REAL panel hands them down — so this proves
 *  the read reaches the row, not merely the panel (consent PR-3). */
const emailRowProps = vi.fn();
vi.mock("../email-row", () => ({
  EmailRow: (props: Record<string, unknown>) => { emailRowProps(props); return null; },
}));
// The Email row's read, stubbed per test.
const readEmailView = vi.fn();
vi.mock("@/lib/consent/email-view", () => ({ readEmailView: (...a: unknown[]) => readEmailView(...a) }));

/**
 * F-085 (spec §7.3): the consent DISPLAY reads take the ledger client, not the
 * request client, and only once getContact proved the contact. A stable
 * sentinel, so an assertion can tell it from the request client by identity.
 */
const LEDGER = vi.hoisted(() => ({ tag: "ledger-db" }));
const ledgerDbMock = vi.hoisted(() => vi.fn(() => LEDGER));
vi.mock("@/lib/consent/ledger-db", () => ({ ledgerDb: () => ledgerDbMock() }));

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: () => { throw NOT_FOUND; },
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/accounts/acct1/contacts/ct1",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: ContactDetailPage } = await import("./page");
const { m } = await import("@/lib/messages");
const { formatDateInZone } = await import("@/lib/format");
const { renderedText } = await import("@/lib/rendered-text");

const CONTACT = {
  id: "ct1", first_name: "Ana", last_name: "Reyes", email: "ana@example.com", phone: null,
  company_name: null, custom: {}, created_at: "2026-01-01T05:30:00Z",
  // S-09: the seven 0076 columns languageView reads; null here so every case still builds a "not set" view.
  language: null, language_source: null, language_set_at: null,
  last_language_signal: null, last_language_signal_source: null, last_language_signal_at: null, language_hint_kept_at: null,
};

async function render(search: Record<string, string> = {}) {
  const el = await ContactDetailPage({ params: Promise.resolve({ accountId: "acct1", contactId: "ct1" }), searchParams: Promise.resolve(search) });
  return renderToStaticMarkup(el);
}

describe("ContactDetailPage: the Email row's read, in the account's zone (consent PR-3)", () => {
  beforeEach(() => {
    getContactMock.mockReset();
    getContactMock.mockResolvedValue(CONTACT);
    emailRowProps.mockClear();
    renderZone.mockClear();
    accountsEq.mockClear();
    recipientState.mockReset().mockResolvedValue({ kind: "ok" });
    emailRecipientStateMock.mockReset().mockResolvedValue({ kind: "ok" });
    readTextsView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    readEmailView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
  });

  it("the page reads the Email row for this contact and hands it ready, in the ACCOUNT's zone (mutation: renderZone(undefined) → zone UTC, FAILS; mutation: pass no email → FAILS)", async () => {
    await render();
    expect(accountsEq).toHaveBeenCalledWith("id", "acct1");
    expect(readEmailView).toHaveBeenCalledWith(expect.anything(), "acct1", CONTACT);
    expect(emailRowProps).toHaveBeenCalledTimes(1);
    expect(emailRowProps.mock.calls[0]![0]).toMatchObject({
      contactId: "ct1",
      load: { status: "ready", view: { kind: "allowed", newestId: null }, zone: "America/Chicago" },
    });
  });

  it("a failed account read falls back to the GUESSED zone, logged, never thrown", async () => {
    accountRead.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await render();
      expect(renderZone).toHaveBeenCalledWith(undefined);
      expect(emailRowProps.mock.calls[0]![0]).toMatchObject({ load: { status: "ready", zone: "UTC" } });
      expect(errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).toContain("boom");
    } finally {
      errors.mockRestore();
    }
  });

  it("an unreadable ledger is the row's error state, never a crashed page (spec §6; mutation: let readEmailView's throw escape → the render rejects, FAILS)", async () => {
    readEmailView.mockRejectedValue(new Error("down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await render();
      expect(emailRowProps.mock.calls[0]![0]).toMatchObject({ load: { status: "error" } });
    } finally {
      errors.mockRestore();
    }
  });

  it("404s for a contact this account does not have, before any read (mutation: start the record page's reads before getContact -> FAILS)", async () => {
    getContactMock.mockResolvedValue(null);
    const reads = {
      contactFacts: contactFactsMock, contactNextUp: contactNextUpMock, listContactPlaces: listContactPlacesMock,
      listContactTimelinePage: listContactTimelinePageMock, listPeopleNames: listPeopleNamesMock, getVoiceProfile: getVoiceProfileMock,
      listContactOpportunities: listContactOpportunitiesMock, resolveSmsSender: resolveSmsSenderMock,
      getPersonPrefs: prefsMock, listContactTags: listContactTagsMock, listCustomFields: listCustomFieldsMock,
    };
    for (const r of Object.values(reads)) r.mockClear();
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(renderZone).not.toHaveBeenCalled();
    expect(readEmailView).not.toHaveBeenCalled();
    expect(emailRowProps).not.toHaveBeenCalled();
    // S-03 part 1: none of the record page's own reads run for a contact the caller cannot see.
    expect(Object.entries(reads).filter(([, r]) => r.mock.calls.length > 0).map(([k]) => k)).toEqual([]);
  });
});

/**
 * Consent chain PR-1 (spec §6): the composer is closed, with one line, when
 * the recipient's texts are stopped, held or the number is unconfirmed.
 */
describe("ContactDetailPage: the recipient's texts state", () => {
  beforeEach(() => {
    getContactMock.mockReset().mockResolvedValue(CONTACT);
    recipientState.mockReset().mockResolvedValue({ kind: "ok" });
    emailRecipientStateMock.mockReset().mockResolvedValue({ kind: "ok" });
    timelineProps.mockClear();
    textsRowProps.mockClear();
    readTextsView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    readEmailView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    listContactTasksMock.mockReset().mockResolvedValue([]);
    holdOpenTaskIdsMock.mockReset().mockResolvedValue([]);
  });

  it("a stopped number: the composer's line carries the stop date in the ACCOUNT's zone (mutation: format the date in UTC → 'Oct 4', FAILS)", async () => {
    // 02:30Z on the 4th is still the 3rd in Chicago: a UTC date would say 4.
    recipientState.mockResolvedValue({ kind: "stopped", since: "2026-10-04T02:30:00.000Z" });
    await render();
    expect(recipientState).toHaveBeenCalledWith(expect.anything(), "acct1", CONTACT);
    expect(timelineProps.mock.calls[0]![0]).toMatchObject({
      smsBlockedLine: m["compose.smsStopped"].replace("{date}", formatDateInZone("2026-10-04T02:30:00.000Z", "America/Chicago")),
    });
    expect(String(timelineProps.mock.calls[0]![0].smsBlockedLine)).toContain("Oct 3");
  });

  // Review: the timeline's own task due dates used to render in UTC
  // (formatDateUTC), which only reads back the right day for a zone WEST
  // of UTC. It now takes the account's resolved zone as a prop — the SAME
  // one already threaded to the composer lines above — and renders every
  // task's due date in it instead (activity-timeline.tsx's
  // `taskDueDateText`).
  it("passes the account's resolved zone to the timeline, the same one the composer lines use (mutation: drop the timezone prop → FAILS)", async () => {
    await render();
    expect(timelineProps.mock.calls[0]![0]).toMatchObject({ timezone: "America/Chicago" });
  });

  it("an ok recipient: no line, the form shows (mutation: always pass the held line → FAILS)", async () => {
    await render();
    expect(timelineProps.mock.calls[0]![0]).toMatchObject({ smsBlockedLine: null });
  });

  it("an unreadable state closes the composer with the error line, never an open form", async () => {
    recipientState.mockResolvedValue({ kind: "unknown" });
    await render();
    expect(timelineProps.mock.calls[0]![0]).toMatchObject({ smsBlockedLine: m["compose.smsStateUnknown"] });
  });

  it("the page hands the Texts row what the server read, the account's zone and the stored phone (spec §6; mutation: pass no load → FAILS)", async () => {
    readTextsView.mockResolvedValue({ kind: "check_number" });
    await render();
    expect(readTextsView).toHaveBeenCalledWith(expect.anything(), "acct1", expect.objectContaining({ id: "ct1" }));
    expect(textsRowProps.mock.calls[0]![0]).toMatchObject({
      contactId: "ct1", load: { status: "ready", view: { kind: "check_number" }, zone: "America/Chicago", phone: CONTACT.phone ?? null },
    });
  });

  it("an unreadable ledger gives the row its error state, never a thrown page (fails closed; mutation: let it throw → FAILS)", async () => {
    readTextsView.mockRejectedValue(new Error("readConsentHistory failed: timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await render();
    expect(textsRowProps.mock.calls[0]![0]).toMatchObject({ load: { status: "error" } });
  });

  it("the timeline is told exactly what holdOpenTaskIds answered for the page's own tasks, and an unreadable ledger hints every open linked one — never a Done that would be refused (review R3-N1, I4; mutation: pass [] on failure → FAILS; mutation: pass the fallback always → the first case FAILS)", async () => {
    const taskEntry = (id: string, consent_event_id: string | null) => ({ kind: "task", id, at: "2026-10-01T00:00:00Z", task: {
      id, title: "x", due_at: null, completed_at: null, created_at: "2026-10-01T00:00:00Z", consent_event_id, call_id: null, assigned_to: null, created_by: null } });
    listContactTimelinePageMock.mockResolvedValue({ items: [taskEntry("t_hold", "h1"), taskEntry("t_plain", null)], older: null, failed: [] });
    // The hold was decided since: the read answers none, and the page passes none (not its own fallback).
    holdOpenTaskIdsMock.mockResolvedValue([]);
    await render();
    expect(holdOpenTaskIdsMock).toHaveBeenCalledWith(expect.anything(), "acct1", [
      expect.objectContaining({ id: "t_hold", consent_event_id: "h1" }), expect.objectContaining({ id: "t_plain", consent_event_id: null }),
    ], LEDGER);
    expect(timelineProps.mock.calls.at(-1)![0]).toMatchObject({ holdOpenTaskIds: [] });
    holdOpenTaskIdsMock.mockRejectedValue(new Error("readConsentEvent failed: timeout"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await render();
      expect(timelineProps.mock.calls.at(-1)![0]).toMatchObject({ holdOpenTaskIds: ["t_hold"] });
      // Fix round 1 #2 (carry-forward 1): the fail-closed path is LOGGED, not silent.
      expect(errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).toContain("hold To-dos unreadable");
    } finally {
      errors.mockRestore();
      listContactTimelinePageMock.mockResolvedValue(EMPTY_PAGE);
    }
  });
});

describe("ContactDetailPage: the email composer's notice (Task 12, spec §6, choice 22)", () => {
  beforeEach(() => {
    getContactMock.mockReset();
    getContactMock.mockResolvedValue(CONTACT);
    recipientState.mockReset().mockResolvedValue({ kind: "ok" });
    emailRecipientStateMock.mockReset().mockResolvedValue({ kind: "ok" });
  });

  it("the timeline gets the spec's line for a customer's own email stop, never null (mutation: pass null → FAILS)", async () => {
    emailRecipientStateMock.mockResolvedValue({ kind: "stopped", since: "2026-10-01T15:00:00Z", byCustomer: true });
    await render();
    expect(timelineProps.mock.calls.at(-1)![0]).toMatchObject({
      emailNoticeLine: m["compose.emailUnsubscribed"].replace("{date}", formatDateInZone("2026-10-01T15:00:00Z", "America/Chicago")),
    });
  });
});

/**
 * Review round 1, I4: `ContactFieldsPanel` is NOT mocked here (unlike
 * `ActivityTimeline`/`TextsRow`/`EmailRow`), so this is a REAL render of the
 * Source line — stronger evidence than a source pin, since the full page
 * takes `contact` as a synchronous prop with no fetch effect to dodge
 * (unlike the drawer's own summary route; see contact-drawer.wiring.test.ts
 * for that half).
 */
describe("ContactDetailPage: the full page's Source line really renders from the real contact (review round 1, I4)", () => {
  beforeEach(() => {
    recipientState.mockReset().mockResolvedValue({ kind: "ok" });
    emailRecipientStateMock.mockReset().mockResolvedValue({ kind: "ok" });
    readTextsView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    readEmailView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
  });

  it("shows the raw stored source, editable, with the computed hint beside it (mutation: wire a literal null for either prop → FAILS)", async () => {
    getContactMock.mockReset().mockResolvedValue({
      ...CONTACT, source: "form: Contact us",
      attribution: { first: { ref: "https://chat.openai.com/" } },
    });
    const html = await render();
    expect(html).toContain("form: Contact us");
    expect(html).toContain("Found through ChatGPT");
  });

  it("a referred-by answer outranks the attribution channel here too, end to end", async () => {
    getContactMock.mockReset().mockResolvedValue({
      ...CONTACT, source: "form: Contact us", custom: { referred_by: "Jane Smith" },
      attribution: { first: { ref: "https://chat.openai.com/" } },
    });
    const html = await render();
    expect(html).toContain("Referred by Jane Smith");
    expect(html).not.toContain("Found through");
  });

  it("nothing captured says so in plain words (mutation: guess a channel like 'Direct' instead → FAILS)", async () => {
    getContactMock.mockReset().mockResolvedValue({ ...CONTACT, source: null, custom: {}, attribution: null });
    const html = await render();
    expect(html).toContain("Source unknown");
  });
});

/**
 * F-085 (spec §7.3). Consent is keyed by ADDRESS and a STOP can arrive tied to
 * no contact, so under 0068 a Technician's own token would see only part of
 * the ledger and the page would say "can text" for a number the send gate
 * refuses. The four display reads and the hold check therefore read through
 * the ledger client — and only AFTER getContact, on the request client,
 * proved the contact is the caller's to see: that read is the authorisation.
 */
describe("ContactDetailPage: consent display reads use the ledger client, after the contact is proven (F-085)", () => {
  beforeEach(() => {
    getContactMock.mockReset().mockResolvedValue(CONTACT);
    ledgerDbMock.mockClear();
    recipientState.mockReset().mockResolvedValue({ kind: "ok" });
    emailRecipientStateMock.mockReset().mockResolvedValue({ kind: "ok" });
    readTextsView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    readEmailView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    listContactTasksMock.mockReset().mockResolvedValue([]);
    holdOpenTaskIdsMock.mockReset().mockResolvedValue([]);
  });

  it("each of the four reads and holdOpenTaskIds' ledger argument receive the ledger client, never the request client (mutation: pass db to readTextsView -> FAILS)", async () => {
    await render();
    const requestClient = getContactMock.mock.calls[0]![0];
    expect(requestClient).not.toBe(LEDGER);
    expect(recipientState.mock.calls[0]![0]).toBe(LEDGER);
    expect(emailRecipientStateMock.mock.calls[0]![0]).toBe(LEDGER);
    expect(readTextsView.mock.calls[0]![0]).toBe(LEDGER);
    expect(readEmailView.mock.calls[0]![0]).toBe(LEDGER);
    // The tasks themselves are the request client's (RLS decides which ones
    // the caller sees); only the ledger read inside the hold check moves.
    expect(holdOpenTaskIdsMock.mock.calls[0]![0]).toBe(requestClient);
    expect(holdOpenTaskIdsMock.mock.calls[0]![3]).toBe(LEDGER);
  });

  it("the ledger client is built only AFTER getContact returned a row (mutation: build it before the contact read -> FAILS)", async () => {
    await render();
    expect(ledgerDbMock).toHaveBeenCalled();
    expect(ledgerDbMock.mock.invocationCallOrder[0]!).toBeGreaterThan(getContactMock.mock.invocationCallOrder[0]!);
  });

  it("a contact the caller cannot see: no ledger client, no consent read, and the page 404s (mutation: build the ledger client before the null check -> FAILS)", async () => {
    getContactMock.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(ledgerDbMock).not.toHaveBeenCalled();
    expect(recipientState).not.toHaveBeenCalled();
    expect(emailRecipientStateMock).not.toHaveBeenCalled();
    expect(readTextsView).not.toHaveBeenCalled();
    expect(readEmailView).not.toHaveBeenCalled();
    expect(holdOpenTaskIdsMock).not.toHaveBeenCalled();
  });
});

/**
 * F-085 part 1 (spec §9): "Assigned to" on the record page, in the details
 * card beside Source; the task rows' picker is handed the same team. The
 * save and its Undo are run for real in components/assign/assign.test.ts.
 */
describe("ContactDetailPage: Assigned to (F-085)", () => {
  const STAFF = { userId: "u1", isAgency: false, role: "staff" as const, canManage: false };
  const TECH = { userId: "u1", isAgency: false, role: "technician" as const, canManage: false };
  beforeEach(() => {
    getContactMock.mockReset();
    recipientState.mockReset().mockResolvedValue({ kind: "ok" });
    emailRecipientStateMock.mockReset().mockResolvedValue({ kind: "ok" });
    readTextsView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    readEmailView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    timelineProps.mockClear();
    listAccountTeamMock.mockClear();
  });
  /** The details card's "Assigned to" row: its label, then the field. */
  const row = (html: string) => html.match(/<div[^>]*data-assignee-row[^>]*>[\s\S]*?<\/dd><\/div>/)?.[0] ?? "";

  it("Staff get a picker reading as the holder's name, among the team (mutation: readOnly for everyone -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    getContactMock.mockResolvedValue({ ...CONTACT, assigned_to: "p-me" });
    const r = row(await render());
    expect(renderedText(r)).toContain(m["assign.field.label"]);
    expect(renderedText(r)).toContain("Ana Me");
    expect(r).toContain('role="combobox"');
    expect(listAccountTeamMock).toHaveBeenCalledWith(expect.anything(), "acct1");
  });

  it("an unassigned customer reads Unassigned", async () => {
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    getContactMock.mockResolvedValue({ ...CONTACT, assigned_to: null });
    expect(renderedText(row(await render()))).toContain(m["assign.unassigned"]);
  });

  it("a Technician reads their own customer as You, as text, with no picker and no team read (mutation: hand a Technician the picker -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce(TECH);
    readPersonIdMock.mockResolvedValueOnce("p-t");
    getContactMock.mockResolvedValue({ ...CONTACT, assigned_to: "p-t" });
    const r = row(await render());
    expect(renderedText(r)).toContain(m["assign.you"]);
    expect(r).not.toContain('role="combobox"');
    expect(listAccountTeamMock).not.toHaveBeenCalled();
  });

  it("a read-only viewer looking at someone else's customer (a failed role read leaves an Owner here) reads 'Someone on the team', never You (fix round 1, I1; mutation: You for any unlisted holder -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce({ userId: "u1", isAgency: false, role: null, canManage: false });
    readPersonIdMock.mockResolvedValueOnce("p-owner");
    getContactMock.mockResolvedValue({ ...CONTACT, assigned_to: "p-t" });
    const text = renderedText(row(await render()));
    expect(text).toContain(m["assign.someone"]);
    expect(text).not.toContain(m["assign.you"]);
  });

  it("a team read that fails degrades the field to read-only and keeps the page, logged (fix round 1, M4: one card's fault never blanks the page; mutation: let it throw -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    listAccountTeamMock.mockRejectedValueOnce(new Error("team read down"));
    getContactMock.mockResolvedValue({ ...CONTACT, assigned_to: "p-me" });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render();
      const r = row(html);
      expect(renderedText(r)).toContain(m["assign.field.label"]);
      expect(r).not.toContain('role="combobox"');
      expect(timelineProps.mock.calls[0]![0]).toMatchObject({ canAssign: false, members: [] });
      expect(errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).toContain("team read down");
    } finally {
      errors.mockRestore();
    }
  });

  it("the timeline's task rows get canAssign and the team (mutation: hand them nothing -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce(STAFF);
    getContactMock.mockResolvedValue({ ...CONTACT, assigned_to: null });
    await render();
    expect(timelineProps.mock.calls[0]![0]).toMatchObject({
      canAssign: true,
      members: [{ userId: "p-me", label: "Ana Me", role: "staff" }, { userId: "p-t", label: "tech@x.test", role: "technician" }],
    });
  });

  it("…and a Technician's get canAssign false", async () => {
    requireAccountAccessMock.mockResolvedValueOnce(TECH);
    getContactMock.mockResolvedValue({ ...CONTACT, assigned_to: "p-t" });
    await render();
    expect(timelineProps.mock.calls[0]![0]).toMatchObject({ canAssign: false, members: [] });
  });
});

describe("ContactDetailPage: the Related people card (relationships spec §7)", () => {
  beforeEach(() => {
    relationshipsCardProps.length = 0;
    getContactMock.mockReset();
    getContactMock.mockResolvedValue(CONTACT);
    recipientState.mockReset().mockResolvedValue({ kind: "ok" });
    emailRecipientStateMock.mockReset().mockResolvedValue({ kind: "ok" });
    readTextsView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    readEmailView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
  });

  it("renders the card with the page's own accountId and contactId (mutation: drop the card line from the page -> FAILS)", async () => {
    await render();
    expect(relationshipsCardProps).toContainEqual({ accountId: "acct1", contactId: "ct1", headingHidden: true });
  });
});

describe("ContactDetailPage: the Properties card (S-02 part B2)", () => {
  beforeEach(() => {
    placesCardProps.length = 0;
    getContactMock.mockReset();
    getContactMock.mockResolvedValue(CONTACT);
    recipientState.mockReset().mockResolvedValue({ kind: "ok" });
    emailRecipientStateMock.mockReset().mockResolvedValue({ kind: "ok" });
    readTextsView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    readEmailView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
  });

  it("renders the Properties card with the page's accountId, contactId and canMovePlace (mutation: drop the card line -> FAILS)", async () => {
    const html = await render();
    // The default access is the agency's, which may move a property.
    expect(placesCardProps).toEqual([{ accountId: "acct1", contactId: "ct1", canMovePlace: true, headingHidden: true }]);
    // Between the Groups card and Deals (S-03 part 1: the registry's order, each a record card).
    expect(order(html).slice(3, 6)).toEqual(["groups", "properties", "deals"]);
  });

  it("a Technician's page hands the card canMovePlace false (mutation: pass true -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce({ userId: "u1", isAgency: false, role: "technician", canManage: false });
    readPersonIdMock.mockResolvedValueOnce("p-t");
    await render();
    expect(placesCardProps).toEqual([{ accountId: "acct1", contactId: "ct1", canMovePlace: false, headingHidden: true }]);
  });
});

const order = (html: string) => [...html.matchAll(/data-record-card="([\w-]+)"/g)].map((x) => x[1]);
const cardHtml = (html: string, id: string) => html.match(new RegExp(`<section[^>]*data-record-card="${id}"[\\s\\S]*?</section>`))?.[0] ?? "";

describe("the record page (S-03 part 1, 1a): every card loads and fails on its own", () => {
  beforeEach(() => {
    getContactMock.mockReset().mockResolvedValue(CONTACT);
    recipientState.mockReset().mockResolvedValue({ kind: "ok" });
    emailRecipientStateMock.mockReset().mockResolvedValue({ kind: "ok" });
    readTextsView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    readEmailView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    contactFactsMock.mockReset().mockResolvedValue(READY_FACTS);
    contactNextUpMock.mockReset().mockResolvedValue({ bookings: [], datedTasks: [], undatedCount: 0 });
    listContactPlacesMock.mockReset().mockResolvedValue(NO_PLACES);
    listContactOpportunitiesMock.mockReset().mockResolvedValue([]);
    listNotesMock.mockReset().mockResolvedValue([]);
    listContactTimelinePageMock.mockReset().mockResolvedValue(EMPTY_PAGE); listPeopleNamesMock.mockReset().mockResolvedValue({});
    prefsMock.mockReset().mockResolvedValue({ language: null, theme: null });
    resolveSmsSenderMock.mockReset().mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    listContactTagsMock.mockReset().mockResolvedValue([]);
    listCustomFieldsMock.mockReset().mockResolvedValue([]);
    timelineProps.mockClear();
    timelineThrows.on = false;
  });
  /** A card's generic failure line ("Couldn't load {title}."), as the HTML escapes it. */
  const failedCopy = (title: string) => m["record.card.failed"].replace("{title}", title).replaceAll("'", "&#x27;");
  const actionIds = (html: string) => [...html.matchAll(/data-record-action="(\w+)"/g)].map((x) => x[1]);
  const quietly = async <T,>(fn: () => Promise<T>): Promise<{ result: T; logged: string }> => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await fn();
      return { result, logged: errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n") };
    } finally { errors.mockRestore(); }
  };

  it("renders the nine cards in the phone order, which is the DOM order on every width (C6; mutation: render the who column first -> FAILS)", async () => {
    expect(order(await render())).toEqual(["summary", "next-up", "timeline", "groups", "properties", "deals", "details", "tags", "related-people"]);
  });

  it("the timeline's reads failing is the timeline's error, and every other card still renders (mutation: let loadTimeline rethrow, as today's Promise.all did -> the render rejects, FAILS)", async () => {
    listContactTimelinePageMock.mockRejectedValue(new Error("timeline read down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render();
      expect(cardHtml(html, "timeline")).toContain(m["record.activity.failed"].replaceAll("'", "&#x27;"));
      expect(timelineProps).not.toHaveBeenCalled();
      expect(cardHtml(html, "summary")).toContain("On your list since Dec 2025");
      expect(cardHtml(html, "next-up")).toContain(m["record.nextUp.empty"]);
    } finally { errors.mockRestore(); }
  });

  it("the summary failing is the summary's error, the rest stand (mutation: let loadSummary rethrow -> FAILS)", async () => {
    contactFactsMock.mockRejectedValue(new Error("facts down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render();
      expect(cardHtml(html, "summary")).toContain(m["record.summary.failed"].replaceAll("'", "&#x27;"));
      expect(timelineProps).toHaveBeenCalled();
    } finally { errors.mockRestore(); }
  });

  it("Next up failing is Next up's error, the rest stand (mutation: let loadNextUp rethrow -> FAILS)", async () => {
    contactNextUpMock.mockRejectedValue(new Error("next up down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render();
      expect(cardHtml(html, "next-up")).toContain(m["record.nextUp.failed"].replaceAll("'", "&#x27;"));
      expect(cardHtml(html, "summary")).toContain("On your list since Dec 2025");
    } finally { errors.mockRestore(); }
  });

  it("Deals failing is Deals' error and the timeline still renders (its own read of the same table succeeds; mutation: let loadDeals rethrow -> FAILS)", async () => {
    // The timeline no longer reads through it (1b), so one rejection is the Deals card's alone.
    listContactOpportunitiesMock.mockRejectedValue(new Error("deals down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render();
      expect(cardHtml(html, "deals")).toContain("data-record-error");
      expect(cardHtml(html, "deals")).toContain(failedCopy(m["record.card.deals"]));
      expect(timelineProps).toHaveBeenCalled();
    } finally { errors.mockRestore(); }
  });

  it("Tags failing is the Tags card's error, the rest stand (mutation: let loadTags rethrow -> FAILS)", async () => {
    listContactTagsMock.mockRejectedValue(new Error("tags down"));
    const { result: html } = await quietly(render);
    expect(cardHtml(html, "tags")).toContain(failedCopy(m["contact.tags"]));
    expect(cardHtml(html, "summary")).toContain("On your list since Dec 2025");
    expect(timelineProps).toHaveBeenCalled();
  });

  it("Details failing (its custom-field definitions) is the Details card's error, the rest stand (mutation: let loadFieldDefs rethrow -> FAILS)", async () => {
    listCustomFieldsMock.mockRejectedValue(new Error("custom fields down"));
    const { result: html } = await quietly(render);
    expect(cardHtml(html, "details")).toContain(failedCopy(m["contact.details"]));
    expect(cardHtml(html, "summary")).toContain("On your list since Dec 2025");
    expect(timelineProps).toHaveBeenCalled();
  });

  it("an invalid stored zone draws the summary and Next up in the zone renderZone resolved, never the raw one (review ruling; mutation: hand factsView or nextUpView the raw timezone -> FAILS)", async () => {
    accountRead.mockResolvedValueOnce({ data: { timezone: "Mars/Olympus", language: null }, error: null });
    renderZone.mockImplementationOnce(async () => ({ zone: "UTC", guessed: true, label: "UTC", source: "fallback" as const }));
    contactFactsMock.mockResolvedValue({ ...READY_FACTS, lastTalked: { ok: true, value: { at: "2026-10-10T15:00:00Z", channel: "text" } } });
    const { result: html } = await quietly(render);
    expect(renderZone).toHaveBeenLastCalledWith("Mars/Olympus");
    // 05:30Z on Jan 1 is January in UTC (the resolved zone), where Chicago would say December.
    expect(cardHtml(html, "summary")).toContain("On your list since Jan 2026");
    expect(cardHtml(html, "summary")).toContain("Last talked");
    expect(cardHtml(html, "next-up")).toContain(m["record.nextUp.empty"]);
  });

  it("a summary view that throws costs only the summary (C5: a malformed instant; mutation: build factsView outside its try -> the render rejects, FAILS)", async () => {
    contactFactsMock.mockResolvedValue({ ...READY_FACTS, lastTalked: { ok: true, value: { at: "not-a-date", channel: "call" } } });
    const { result: html, logged } = await quietly(render);
    expect(cardHtml(html, "summary")).toContain(m["record.summary.failed"].replaceAll("'", "&#x27;"));
    expect(cardHtml(html, "next-up")).toContain(m["record.nextUp.empty"]);
    expect(timelineProps).toHaveBeenCalled();
    expect(logged).toContain("summary view failed for account acct1");
    // The customer's id ("ct1") never names the line; `\b` because the account id "acct1" contains it.
    expect(logged).not.toMatch(/\bct1\b/);
  });

  it("a Next up view that throws costs only Next up (C5: a malformed due date; mutation: build nextUpView outside its try -> the render rejects, FAILS)", async () => {
    contactNextUpMock.mockResolvedValue({ bookings: [], datedTasks: [{ id: "t1", title: "Call back", due_at: "not-a-date" }], undatedCount: 0 });
    const { result: html, logged } = await quietly(render);
    expect(cardHtml(html, "next-up")).toContain(m["record.nextUp.failed"].replaceAll("'", "&#x27;"));
    expect(cardHtml(html, "summary")).toContain("On your list since Dec 2025");
    expect(timelineProps).toHaveBeenCalled();
    expect(logged).toContain("next up view failed for account acct1");
  });

  it("Text and Email are hidden while the timeline (and so its composer) failed; Call stays (D3: nothing behind them; mutation: drop the timeline-readiness condition -> FAILS)", async () => {
    getContactMock.mockResolvedValue({ ...CONTACT, phone: "+19565550100" });
    resolveSmsSenderMock.mockResolvedValue({ ok: true, from: "+19565550199", ownedNumbers: ["+19565550199"] });
    // The control: with the timeline ready, all three are offered.
    expect(actionIds(await render())).toEqual(["call", "text", "email"]);
    listContactTimelinePageMock.mockRejectedValue(new Error("timeline read down"));
    const { result: html } = await quietly(render);
    expect(actionIds(html)).toEqual(["call"]);
    expect(html).not.toContain("#compose-sms");
    expect(html).not.toContain("#compose-email");
  });

  it("Next up's Add a To-do is offered only while the timeline (which holds the To-do field) rendered (D3; mutation: always pass the label -> FAILS)", async () => {
    const addTodo = `>${m["record.nextUp.addTodo"]}<`;
    // The control: the timeline is ready, so the empty Next up offers the action.
    expect(cardHtml(await render(), "next-up")).toContain(addTodo);
    listContactTimelinePageMock.mockRejectedValue(new Error("timeline read down"));
    const { result: html } = await quietly(render);
    expect(cardHtml(html, "next-up")).toContain(m["record.nextUp.empty"]);
    expect(cardHtml(html, "next-up")).not.toContain(addTodo);
  });

  it("on a Spanish page Details and Tags read Spanish with no lang=\"en\" wrapper, and only the Groups card keeps one (S-03 part 3 §10.2, D10; mutation: leave the Details wrapper -> FAILS; drop the Groups wrapper -> FAILS)", async () => {
    prefsMock.mockResolvedValue({ language: "es", theme: null });
    const html = await render();
    expect(html).toMatch(/data-record-layout[^>]*lang="es"|lang="es"[^>]*data-record-layout/);
    const wrapped = (id: string) => /<div lang="en">/.test(cardHtml(html, id));
    expect(["details", "tags", "summary", "next-up", "deals", "timeline"].filter(wrapped)).toEqual([]);
    expect(wrapped("groups")).toBe(true);
    expect(cardHtml(html, "details")).toContain(`>${m["contacts.firstName.es"]}<`);
    expect(cardHtml(html, "details")).toContain(`>${m["contact.source.label.es"]}<`);
    expect(cardHtml(html, "details")).toContain(`>${m["assign.field.label.es"]}<`);
    expect(cardHtml(html, "tags")).toContain(`placeholder="${m["contact.addTag.es"]}"`);
  });

  it("a client-role person with no language of their own reads the account's Spanish (mutation: drop language from the accounts select -> English, FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce({ userId: "u1", isAgency: false, role: "owner", canManage: true });
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    getContactMock.mockResolvedValue({ ...CONTACT, phone: "+19565550100" });
    const html = await render();
    expect(html).toMatch(/data-record-layout[^>]*lang="es"|lang="es"[^>]*data-record-layout/);
    expect(html).toContain(`>${m["record.action.call.es"]}<`);
  });

  it("an agency operator on that Spanish account reads English (requestLocale's role split; mutation: pass isOperator false -> Spanish, FAILS)", async () => {
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    getContactMock.mockResolvedValue({ ...CONTACT, phone: "+19565550100" });
    const html = await render();
    expect(html).toMatch(/data-record-layout[^>]*lang="en"|lang="en"[^>]*data-record-layout/);
    expect(html).toContain(`>${m["record.action.call"]}<`);
    expect(html).not.toContain(m["record.card.nextUp.es"]);
  });

  it("a render throw inside one card is that card's skeleton on the server, and the page still renders (C5; mutation: drop RecordCardBoundary's Suspense -> the render rejects, FAILS)", async () => {
    timelineThrows.on = true;
    const html = await render();
    expect(cardHtml(html, "timeline")).toContain("data-record-skeleton");
    expect(cardHtml(html, "summary")).toContain("On your list since Dec 2025");
  });

  it("the header: Call is the one primary, Email links to its composer, Text is hidden while the gate is closed, Directions takes the first addressed property, and the group is plain text (§9.1, C7)", async () => {
    getContactMock.mockResolvedValue({ ...CONTACT, phone: "+19565550100" });
    listContactPlacesMock.mockResolvedValue({
      ...NO_PLACES, groups: [{ id: "g1", kind: "household", name: "García", isPrimary: true }],
      places: [{ id: "p1", account_id: "acct1", contact_id: "ct1", client_group_id: null, label: null, address: "1204 Nolana Ave",
        landmark: null, directions: null, city: "McAllen", region: "TX", postal_code: "78504", country: "US", archived_at: null,
        created_by: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
    });
    const html = await render();
    expect([...html.matchAll(/data-record-action="(\w+)"/g)].map((x) => x[1])).toEqual(["call", "email", "directions"]);
    expect(html).toContain('href="tel:+19565550100"');
    expect(html).toContain('href="#compose-email"');
    expect(html.match(/data-variant="default"[^>]*data-record-action|data-record-action="call"[^>]*data-variant="default"/g)).toHaveLength(1);
    expect(html).toContain(encodeURIComponent("1204 Nolana Ave"));
    expect(html).toMatch(/data-record-subtitle[^>]*>García · Household</);
  });

  it("the group line uses S-02's kind words: a business reads 'Business customer', and Spanish 'Familia' / 'Cliente comercial' (R3; mutation: leave 'Negocio' -> FAILS)", async () => {
    listContactPlacesMock.mockResolvedValue({ ...NO_PLACES, groups: [{ id: "g2", kind: "business", name: "Acme", isPrimary: true }] });
    expect(await render()).toMatch(/data-record-subtitle[^>]*>Acme · Business customer</);
    prefsMock.mockResolvedValue({ language: "es", theme: null });
    expect(await render()).toMatch(/data-record-subtitle[^>]*>Acme · Cliente comercial</);
    listContactPlacesMock.mockResolvedValue({ ...NO_PLACES, groups: [{ id: "g1", kind: "household", name: "García", isPrimary: true }] });
    expect(await render()).toMatch(/data-record-subtitle[^>]*>García · Familia</);
  });

  it("the group line links to the MAIN group's own page, the words unchanged (S-03 part 2b, §8.9, R2; mutation: the first group instead of the main one -> FAILS)", async () => {
    // The main group is SECOND in the read, so linking the first group would be caught.
    listContactPlacesMock.mockResolvedValue({ ...NO_PLACES, groups: [
      { id: "g-other", kind: "business", name: "Acme", isPrimary: false },
      { id: "g-main", kind: "household", name: "García", isPrimary: true },
    ] });
    const html = await render();
    expect(html).toMatch(/<a (?=[^>]*href="\/dashboard\/accounts\/acct1\/groups\/g-main")(?=[^>]*data-record-subtitle)[^>]*>García · Household<\/a>/);
    expect(html).not.toContain("/groups/g-other");
  });

  it("a failed places read drops the group line and Directions, never the header (spec §7; mutation: let loadHeaderPlaces rethrow -> FAILS)", async () => {
    listContactPlacesMock.mockRejectedValue(new Error("places down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render();
      expect(html).toContain("data-record-header");
      expect(html).not.toContain("data-record-subtitle");
      expect(html).not.toContain('data-record-action="directions"');
    } finally { errors.mockRestore(); }
  });

  it("a person whose language is Spanish gets the converted parts in Spanish, with lang set (§9.6; mutation: drop userLanguage from requestLocale -> English, FAILS)", async () => {
    prefsMock.mockResolvedValue({ language: "es", theme: null });
    getContactMock.mockResolvedValue({ ...CONTACT, phone: "+19565550100" });
    const html = await render();
    expect(html).toMatch(/data-record-layout[^>]*lang="es"|lang="es"[^>]*data-record-layout/);
    expect(html).toContain(`>${m["record.action.call.es"]}<`);
    expect(html).toContain(m["record.card.nextUp.es"]);
  });
});

describe("the record page's timeline (S-03 1b, spec §7, §9.4, §11)", () => {
  const ID = "0f8a7b2c-1d2e-4f3a-8b4c-5d6e7f8a9b0c";
  const noteBy = (author_id: string | null, id = "n1") => ({ kind: "note", id, at: "2026-10-09T16:12:00Z",
    note: { id, body: "x", author_id, created_at: "2026-10-09T16:12:00Z" } });
  beforeEach(() => {
    getContactMock.mockReset().mockResolvedValue(CONTACT);
    recipientState.mockReset().mockResolvedValue({ kind: "ok" });
    emailRecipientStateMock.mockReset().mockResolvedValue({ kind: "ok" });
    readTextsView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    readEmailView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    listContactTimelinePageMock.mockReset().mockResolvedValue(EMPTY_PAGE);
    listPeopleNamesMock.mockReset().mockResolvedValue({});
    prefsMock.mockReset().mockResolvedValue({ language: null, theme: null });
    timelineProps.mockClear();
    timelineThrows.on = false;
  });
  type Props = { rows: { verb: string; mark: { label: string }; day: string; time: string }[]; failedText: string | null; emptyText: string | null;
    pager: { olderHref: string | null; newerHref: string | null } };
  const props = () => timelineProps.mock.calls.at(-1)![0] as Props;

  it("a ?before= that parses reaches the page read; one that does not is a cold start (spec §11; mutation: pass the raw param -> FAILS)", async () => {
    const good = Buffer.from(JSON.stringify(["2026-10-09T16:12:00.123456+00:00", ID]), "utf8").toString("base64url");
    await render({ before: good });
    expect(listContactTimelinePageMock.mock.calls.at(-1)![3]).toEqual({ v: "2026-10-09T16:12:00.123456+00:00", id: ID });
    await render({ before: "garbage" });
    expect(listContactTimelinePageMock.mock.calls.at(-1)![3]).toBeUndefined();
  });

  it("names: the request client reads the page's person ids; the viewer reads You and an unreadable id Someone on the team (D10, D11; mutation: You for every person -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce({ userId: "user_me", isAgency: false, role: "staff", canManage: false });
    listContactTimelinePageMock.mockResolvedValue({ items: [noteBy("user_me", "n1"), noteBy("user_dan", "n2"), noteBy("user_gone", "n3")], older: null, failed: [] });
    listPeopleNamesMock.mockResolvedValue({ user_dan: "Dan López" });
    await render();
    expect(listPeopleNamesMock.mock.calls.at(-1)![1]).toEqual(["user_me", "user_dan", "user_gone"]);
    expect(props().rows.map((r) => r.mark.label)).toEqual(["You", "Dan López", "Someone on the team"]);
  });

  it("some sources failed: the timeline gets its rows and says what could not load (mutation: drop failedText -> FAILS)", async () => {
    listContactTimelinePageMock.mockResolvedValue({ items: [noteBy(null)], older: null, failed: ["calls", "bookings"] });
    await render();
    expect(props().failedText).toBe("Couldn't load calls and bookings.");
    expect(props().rows).toHaveLength(1);
    expect(props().emptyText).toBeNull();
  });

  it("a page where a source failed offers no Older (its cursor would skip that source's rows), keeps Newer, and never claims empty (Task 9's rule; mutation: hand timelinePagerHrefs failed: [] -> FAILS)", async () => {
    const cursor = Buffer.from(JSON.stringify(["2026-10-09T16:12:00Z", ID]), "utf8").toString("base64url");
    listContactTimelinePageMock.mockResolvedValue({ items: [], older: { v: "2026-10-08T16:12:00Z", id: ID }, failed: ["calls"] });
    await render({ before: cursor });
    expect(listContactTimelinePageMock.mock.calls.at(-1)![3]).toEqual({ v: "2026-10-09T16:12:00Z", id: ID });
    expect(props().pager).toEqual({ olderHref: null, newerHref: "/dashboard/accounts/acct1/contacts/ct1#record-timeline" });
    expect(props().failedText).toBe("Couldn't load calls.");
    await render();
    expect(props().emptyText).toBeNull();
  });

  it("all seven sources failed: the card's error, and Text and Email hide with the composer (D3)", async () => {
    listContactTimelinePageMock.mockResolvedValue({ items: [], older: null, failed: ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"] });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render();
      expect(cardHtml(html, "timeline")).toContain(m["record.activity.failed"].replaceAll("'", "&#x27;"));
      expect(timelineProps).not.toHaveBeenCalled();
      expect(html).not.toContain("#compose-email");
    } finally { errors.mockRestore(); }
  });

  it("the pager: Older from the head carries the merge's cursor; a paged view offers Newer; the first empty page sells the timeline (mutation: offer Newer on the head -> FAILS)", async () => {
    listContactTimelinePageMock.mockResolvedValue({ items: [noteBy(null)], older: { v: "2026-10-09T16:12:00Z", id: ID }, failed: [] });
    await render();
    expect(props().pager.olderHref).toMatch(/^\/dashboard\/accounts\/acct1\/contacts\/ct1\?before=[\w-]+#record-timeline$/);
    expect(props().pager.newerHref).toBeNull();
    const cursor = Buffer.from(JSON.stringify(["2026-10-09T16:12:00Z", ID]), "utf8").toString("base64url");
    listContactTimelinePageMock.mockResolvedValue(EMPTY_PAGE);
    await render({ before: cursor });
    expect(props().pager.newerHref).toBe("/dashboard/accounts/acct1/contacts/ct1#record-timeline");
    expect(props().emptyText).toBeNull();
    await render();
    expect(props().emptyText).toBe(m["timeline.empty"]);
  });

  it("a Spanish page's rows read Spanish (§9.6; mutation: build the rows with an English Tr -> FAILS)", async () => {
    prefsMock.mockResolvedValue({ language: "es", theme: null });
    listContactTimelinePageMock.mockResolvedValue({ items: [noteBy(null)], older: null, failed: [] });
    await render();
    expect(props().rows[0]!.verb).toBe("agregó una nota");
    expect(props().rows[0]!.mark.label).toBe("Alguien del equipo");
  });

  it("a row's day and time are drawn in the ACCOUNT's own zone, not UTC: an instant that is Oct 12 in UTC is still Oct 11 night in Chicago (DESIGN.md D-010; mutation: pass zone: \"UTC\" to timelineRows in page.tsx -> FAILS)", async () => {
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: null }, error: null });
    const AT = "2026-10-12T03:30:00Z"; // Oct 12 in UTC; Oct 11, 10:30 PM in America/Chicago (CDT, UTC-5).
    listContactTimelinePageMock.mockResolvedValue({
      items: [{ kind: "note", id: "n1", at: AT, note: { id: "n1", body: "x", author_id: null, created_at: AT } }],
      older: null, failed: [],
    });
    await render();
    expect(props().rows[0]!.day).toBe("Oct 11, 2026");
    expect(props().rows[0]!.time).toBe("Oct 11, 2026, 10:30 PM");
  });

  it("a row that cannot be drawn costs the timeline card, never the page, and its composer actions hide (C5, D3; mutation: build the rows outside viewOf -> the render rejects, FAILS)", async () => {
    getContactMock.mockResolvedValue({ ...CONTACT, phone: "+19565550100" });
    listContactTimelinePageMock.mockResolvedValue({ items: [{ ...noteBy(null), at: "not-a-date" }], older: null, failed: [] });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render();
      expect(cardHtml(html, "timeline")).toContain(m["record.activity.failed"].replaceAll("'", "&#x27;"));
      expect(timelineProps).not.toHaveBeenCalled();
      expect(html).not.toContain("#compose-email");
      expect(cardHtml(html, "summary")).toContain("On your list since Dec 2025");
      expect(errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).toContain("timeline view failed for account acct1");
    } finally { errors.mockRestore(); }
  });

  it("a Spanish page's composer lines read Spanish, an English page's English (Task 3's locale; mutation: drop locale from composerStateLine or composerEmailNotice -> FAILS)", async () => {
    recipientState.mockResolvedValue({ kind: "unknown" });
    emailRecipientStateMock.mockResolvedValue({ kind: "unknown" });
    prefsMock.mockResolvedValue({ language: "es", theme: null });
    await render();
    expect(timelineProps.mock.calls.at(-1)![0]).toMatchObject({
      smsBlockedLine: m["compose.smsStateUnknown.es"], emailNoticeLine: m["compose.emailStateUnknown.es"],
    });
    prefsMock.mockResolvedValue({ language: null, theme: null });
    await render();
    expect(timelineProps.mock.calls.at(-1)![0]).toMatchObject({
      smsBlockedLine: m["compose.smsStateUnknown"], emailNoticeLine: m["compose.emailStateUnknown"],
    });
  });
});
