import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The full contact page's zone read (#123 m4b) — the one read this page makes
 * of its own, `accounts.timezone`, for the "No marketing emails" switch's
 * "Off since" date. Same shape as calls/[callId]/page.test.ts: the data reads
 * this async server component reaches are mocked, and what is under test is
 * what the page hands down.
 *
 * `renderZone` is NOT mocked to a constant here (calls/[callId] does that,
 * because it tests the note, not the read): it ECHOES the zone it was handed,
 * so the only way the switch sees "America/Chicago" is if the account's row
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
  updateContactFieldAction: async () => ({ ok: true }), setMarketingEmailOptOutAction: async () => ({ ok: true }),
}));
// The timeline pulls in the message composer; only its props are pinned.
const timelineProps = vi.fn();
vi.mock("./activity-timeline", () => ({
  ActivityTimeline: (props: Record<string, unknown>) => { timelineProps(props); return null; },
}));
// Consent chain PR-1: the composer's recipient read, stubbed per test.
const recipientState = vi.fn();
vi.mock("@/lib/consent/recipient-state", () => ({
  smsRecipientState: (...a: unknown[]) => recipientState(...a),
}));
const textsRowProps = vi.fn();
vi.mock("../texts-row", () => ({
  TextsRow: (props: Record<string, unknown>) => { textsRowProps(props); return null; },
}));
// Consent chain PR-2: the Texts row's read, stubbed per test.
const readTextsView = vi.fn();
vi.mock("@/lib/consent/texts-view", () => ({ readTextsView: (...a: unknown[]) => readTextsView(...a) }));

/** The switch's props, as the REAL panel hands them down — so this proves the
 *  zone reaches the switch, not merely the panel. */
const switchProps = vi.fn();
vi.mock("../marketing-optout-switch", () => ({
  MarketingOptOutSwitch: (props: Record<string, unknown>) => { switchProps(props); return null; },
}));

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
  company_name: null, custom: {}, marketing_email_opted_out_at: "2026-09-04T02:30:00.000Z",
};

async function render() {
  const el = await ContactDetailPage({ params: Promise.resolve({ accountId: "acct1", contactId: "ct1" }) });
  return renderToStaticMarkup(el);
}

describe("ContactDetailPage: the zone the opt-out's date is printed in", () => {
  beforeEach(() => {
    getContactMock.mockReset();
    getContactMock.mockResolvedValue(CONTACT);
    switchProps.mockClear();
    renderZone.mockClear();
    accountsEq.mockClear();
    recipientState.mockReset().mockResolvedValue({ kind: "ok" });
  });

  it("the account's own timezone reaches the switch (mutation: renderZone(undefined) -> FAILS)", async () => {
    await render();
    expect(accountsEq).toHaveBeenCalledWith("id", "acct1");
    expect(renderZone).toHaveBeenCalledWith("America/Chicago");
    expect(switchProps).toHaveBeenCalledTimes(1);
    expect(switchProps.mock.calls[0]![0]).toMatchObject({
      contactId: "ct1",
      optedOutAt: CONTACT.marketing_email_opted_out_at,
      zone: { zone: "America/Chicago", guessed: false, label: "America/Chicago" },
    });
  });

  it("a failed account read falls back (a GUESSED zone) and is logged, never thrown", async () => {
    accountRead.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await render();
      expect(renderZone).toHaveBeenCalledWith(undefined);
      expect(switchProps.mock.calls[0]![0]).toMatchObject({
        zone: { zone: "UTC", guessed: true, label: "UTC" },
      });
      expect(errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).toContain("boom");
    } finally {
      errors.mockRestore();
    }
  });

  it("404s for a contact this account does not have, before any zone read", async () => {
    getContactMock.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(renderZone).not.toHaveBeenCalled();
    expect(switchProps).not.toHaveBeenCalled();
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
    timelineProps.mockClear();
    textsRowProps.mockClear();
    readTextsView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
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
