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
      const chain = {
        select: () => chain,
        eq: (...args: unknown[]) => { accountsEq(...args); return chain; },
        maybeSingle: () => accountRead(),
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
vi.mock("@bis/db", () => ({
  getContact: (...args: unknown[]) => getContactMock(...args),
  listContactTags: async () => [],
  listNotes: async () => [],
  listContactTasks: (...args: unknown[]) => listContactTasksMock(...args),
  holdOpenTaskIds: (...args: unknown[]) => holdOpenTaskIdsMock(...args),
  listCustomFields: async () => [],
  listContactOpportunities: async () => [],
  listContactSubmissions: async () => [],
  listContactMessages: async () => [],
  readConsentHistory: async () => [],
  readPersonId: (...args: unknown[]) => readPersonIdMock(...args),
  listAccountTeam: (...args: unknown[]) => listAccountTeamMock(...args),
}));

/** Echoes, in `resolveZone`'s own shape: a zone in is the account's own, no
 *  zone in is the UTC fallback, a GUESS. */
const renderZone = vi.fn(async (z: string | undefined) => (z
  ? { zone: z, guessed: false, label: z, source: "account" as const }
  : { zone: "UTC", guessed: true, label: "UTC", source: "fallback" as const }));
vi.mock("@/lib/zone", () => ({ renderZone: (z: string | undefined) => renderZone(z) }));

vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: async () => ({ ok: false }) }));

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
  ActivityTimeline: (props: Record<string, unknown>) => { timelineProps(props); return null; },
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
  company_name: null, custom: {},
};

async function render() {
  const el = await ContactDetailPage({ params: Promise.resolve({ accountId: "acct1", contactId: "ct1" }) });
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

  it("404s for a contact this account does not have, before any read", async () => {
    getContactMock.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(renderZone).not.toHaveBeenCalled();
    expect(readEmailView).not.toHaveBeenCalled();
    expect(emailRowProps).not.toHaveBeenCalled();
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
    listContactTasksMock.mockResolvedValue([
      { id: "t_hold", title: "Ana may have asked …", completed_at: null, consent_event_id: "h1" },
      { id: "t_plain", title: "Call back", completed_at: null, consent_event_id: null },
    ]);
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
    expect(relationshipsCardProps).toContainEqual({ accountId: "acct1", contactId: "ct1" });
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
    expect(placesCardProps).toEqual([{ accountId: "acct1", contactId: "ct1", canMovePlace: true }]);
    // Between the Groups card and Deals, in an aside of its own.
    const groups = html.indexOf("data-groups-card");
    const places = html.indexOf("data-places-aside");
    expect(groups).toBeGreaterThan(-1);
    expect(places).toBeGreaterThan(groups);
    expect(places).toBeLessThan(html.indexOf(m["contact.opportunities"]));
  });

  it("a Technician's page hands the card canMovePlace false (mutation: pass true -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce({ userId: "u1", isAgency: false, role: "technician", canManage: false });
    readPersonIdMock.mockResolvedValueOnce("p-t");
    await render();
    expect(placesCardProps).toEqual([{ accountId: "acct1", contactId: "ct1", canMovePlace: false }]);
  });
});
