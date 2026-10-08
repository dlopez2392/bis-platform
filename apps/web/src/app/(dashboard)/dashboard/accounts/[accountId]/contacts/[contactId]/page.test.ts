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
    ]);
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
