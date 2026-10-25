import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { makeTr } from "@/lib/record/copy";
import type { CallDetailRow, Proposal } from "@bis/db";
import { emptyCallState } from "@/lib/voice/call-state";
import { composeSummary } from "@/lib/voice/summarize";

// Same shape as the sibling list page's test: the auth gate and the two data
// reads this async server component actually reaches are mocked, so what is
// under test is which branch renders — not Clerk or Supabase.
/** Mutable, via `vi.hoisted` so the factory can close over it without a TDZ
 *  hazard. Fixed at `true`, the client branch of the zone note went
 *  unexercised on this screen — and hardcoding `isAgency` in page.tsx kept
 *  the whole suite green while offering a client a link to a route
 *  `requireAgencyOnlyAccountAccess` would bounce them from. */
const authFixture = vi.hoisted(() => ({ isAgency: true }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: authFixture.isAgency }),
}));

/**
 * The request client, as a recording two-account fake (item 8b-1, plan fix I-5). Every `from(table)`
 * call logs its `.eq`/`.in`/`.limit` filters and answers rows FILTERED by them, so a read that drops
 * its `.eq("account_id", …)` really does receive the other account's rows (same ids) and draws them:
 * each read's case asserts both the filter and that only acct1's value reaches the render. RLS does not
 * backstop these reads on its own (an agency session reads every tenant's rows).
 */
type FakeRow = Record<string, unknown>;
type FakeQuery = { table: string; eq: [string, unknown][]; in: [string, unknown[]][]; limit: number | null };
const fake = vi.hoisted(() => ({
  tables: {} as Record<string, FakeRow[]>,
  fail: new Set<string>(),
  log: [] as FakeQuery[],
}));
const REQUEST = vi.hoisted(() => ({
  from(table: string) {
    const entry: FakeQuery = { table, eq: [], in: [], limit: null };
    fake.log.push(entry);
    const run = (): { data: FakeRow[] | null; error: { message: string } | null } => {
      if (fake.fail.has(table)) return { data: null, error: { message: `permission denied for table ${table}` } };
      const rows = (fake.tables[table] ?? [])
        .filter((r) => entry.eq.every(([c, v]) => r[c] === v) && entry.in.every(([c, vs]) => vs.includes(r[c])));
      return { data: entry.limit === null ? rows : rows.slice(0, entry.limit), error: null };
    };
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { entry.eq.push([c, v]); return q; },
      in: (c: string, vs: unknown[]) => { entry.in.push([c, vs]); return q; },
      limit: (n: number) => { entry.limit = n; return q; },
      order: () => q,
      gt: () => q,
      maybeSingle: async () => {
        const r = run();
        if (r.error) return r;
        if (r.data!.length > 1) return { data: null, error: { message: "more than one row" } };
        return { data: r.data![0] ?? null, error: null };
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko),
    };
    return q;
  },
}));
const readsOf = (table: string) => fake.log.filter((q) => q.table === table);
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
/** The reader's own language (getPersonPrefs): the Suggestions section follows it, the page does not. */
const prefsFixture = vi.hoisted(() => ({ language: null as "en" | "es" | null }));
vi.mock("@/lib/preferences/person-prefs", () => ({
  getPersonPrefs: async () => ({ language: prefsFixture.language, theme: null }),
}));

const getCallMock = vi.fn();
const listFailedOutboundSmsMock = vi.fn();
const listProposalsForCallMock = vi.fn();
const getContactMock = vi.fn();
/** The call card (0064) and the persona its author mark names: each its own
 *  read, each defaulted in `beforeEach` to "nothing", so every case written
 *  before the card renders exactly what it rendered before. */
const getCallCardMock = vi.fn();
const getVoiceProfileMock = vi.fn();
/** Decider names on decided suggestions (`users`, not account-scoped, capped at the ids asked). */
const listPeopleNamesMock = vi.fn<(...a: unknown[]) => Promise<Record<string, string>>>(async () => ({}));
vi.mock("@bis/db", () => ({
  listPeopleNames: (...args: unknown[]) => listPeopleNamesMock(...args),
  getCallCard: (...args: unknown[]) => getCallCardMock(...args),
  getVoiceProfile: (...args: unknown[]) => getVoiceProfileMock(...args),
  getCall: (...args: unknown[]) => getCallMock(...args),
  listFailedOutboundSms: (...args: unknown[]) => listFailedOutboundSmsMock(...args),
  listProposalsForCall: (...args: unknown[]) => listProposalsForCallMock(...args),
  getContact: (...args: unknown[]) => getContactMock(...args),
}));
// Review R3-M8: the resend reads the same recipient state as the composer.
const recipientStateMock = vi.fn();
vi.mock("@/lib/consent/recipient-state", () => ({ smsRecipientState: (...a: unknown[]) => recipientStateMock(...a) }));
/** F-085 (spec §7.3): the ledger client that read takes, AFTER the contact is
 *  proven — a stable sentinel, told apart from the request client by identity. */
const LEDGER = vi.hoisted(() => ({ tag: "ledger-db" }));
const ledgerDbMock = vi.hoisted(() => vi.fn(() => LEDGER));
vi.mock("@/lib/consent/ledger-db", () => ({ ledgerDb: () => ledgerDbMock() }));

/** The screen's resolved zone (lib/zone.ts) — mutable so a test can put the
 *  page into the "guessed" state without a second `vi.mock`. */
let resolvedZone: {
  zone: string; guessed: boolean; label: string;
  source: "account" | "agency" | "fallback";
} = { zone: "America/Chicago", guessed: false, label: "America/Chicago", source: "account" };
vi.mock("@/lib/zone", () => ({
  renderZone: async () => resolvedZone,
}));


// The resend control binds this. Mocked because a "use server" module cannot
// be imported into a vitest render, and because what is under test here is
// which control renders — not what the action does, which
// conversations/actions.test.ts already pins in full.
vi.mock("../../conversations/actions", () => ({
  sendSmsAction: async () => {},
}));

/** `notFound()` throws in Next; the mock keeps that contract so the page's
 *  control flow — and the fact that nothing renders after it — is testable. */
const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
  // `TextbackResend` calls this at render time to refresh the page after a
  // successful resend. Outside a mounted app router the real hook throws
  // "invariant expected app router to be mounted" — same stand-in, same
  // reason, as calls-table.test.ts's.
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

const { default: CallDetailPage } = await import("./page");

const CALL: CallDetailRow = {
  id: "call1",
  started_at: "2026-08-25T19:15:00.123456+00:00",
  ended_at: "2026-08-25T19:18:42.000000+00:00",
  duration_secs: 222,
  outcome: "booked",
  language: "en",
  caller_e164: "+19565061545",
  contact_id: "ct1",
  contact: { first_name: "Ana", last_name: "Reyes" },
  turn_count: 2,
  transcript: [
    { role: "assistant", text: "Thanks for calling. How can I help?", at: "2026-08-25T19:15:04Z" },
    { role: "caller", text: "I need a roof inspection.", at: "2026-08-25T19:15:11Z" },
  ],
  summary: "RECORDED — Booked: Ana Reyes at 2026-08-27T15:00:00Z · Intake: captured.",
  conversation_id: "cv1",
  booking_id: "bk1",
  trade_module: null,
  trade_module_version: null,
  knowledge_version: null,
  business_status: null,
};

const FAILED_TEXTBACK = {
  callId: "call1",
  conversationId: "cv1",
  messageId: "msg1",
  body: "Sorry we missed you just now — reply here and we'll get right back to you.",
  failedAt: "2026-08-25T19:19:00.000000+00:00",
  supersededAt: null as string | null,
};

/** The window this page hands the read for `CALL` — `[started_at, ended_at +
 *  5 min)`, asserted rather than recomputed, so a change that quietly widened
 *  it back out to the contact's whole conversation fails here. */
const WINDOW = {
  callId: "call1",
  conversationId: "cv1",
  fromIso: "2026-08-25T19:15:00.123Z",
  toIso: "2026-08-25T19:23:42.000Z",
};

/** The status DOT, not the chip. See the identical helper in
 *  ../calls-table.test.ts: `toContain("bg-destructive")` matched the chip's own
 *  `bg-destructive/5`, so deleting the dot `<span>` left every calls test
 *  green. The lookahead demands the SOLID token. */
const TEXTBACK_STATUS_DOT =
  /<span\b[^>]*\bclass="(?=[^"]*\brounded-full\b)(?=[^"]*\bbg-destructive(?![\w/-]))[^"]*"/;

// Every test in this file starts from one account row per account and no other rows: a test that says
// nothing about deals or stages gets none back, never a value left over from a previous test.
beforeEach(() => {
  fake.log.length = 0;
  fake.fail.clear();
  fake.tables = {
    accounts: [
      { id: "acct2", timezone: "Asia/Tokyo", language: "es" },
      { id: "acct1", timezone: "America/Chicago", language: null },
    ],
  };
  prefsFixture.language = null;
  listPeopleNamesMock.mockReset().mockResolvedValue({});
});

function render(
  row: CallDetailRow | null,
  failed: (typeof FAILED_TEXTBACK)[] = [],
  proposals: Proposal[] = [],
) {
  getCallMock.mockResolvedValue(row);
  listFailedOutboundSmsMock.mockResolvedValue(failed);
  listProposalsForCallMock.mockResolvedValue(proposals);
  return CallDetailPage({
    params: Promise.resolve({ accountId: "acct1", callId: "call1" }),
  }).then(renderToStaticMarkup);
}

describe("CallDetailPage", () => {
  // Braces, not a concise body. `mockClear()` RETURNS the mock, and vitest
  // treats a function returned from `beforeEach` as that test's teardown — so
  // the concise form quietly registered the mock itself to be CALLED again
  // after every test in this file. Harmless while it returned a promise;
  // the moment a test made it throw, the teardown threw and failed a test whose
  // body had already passed.
  beforeEach(() => {
    listFailedOutboundSmsMock.mockClear();
    listProposalsForCallMock.mockClear();
    // Review R3-M8: every existing case in this file exercises a contact who
    // CAN be texted, so the resend renders exactly as it did before that
    // review — only the new describe block below overrides these.
    getContactMock.mockReset().mockResolvedValue({ id: "ct1", phone: "+19565061545", phone_country_unconfirmed: false });
    recipientStateMock.mockReset().mockResolvedValue({ kind: "ok" });
    getCallCardMock.mockReset().mockResolvedValue({ reason: null, callbackNumber: null, callerWords: null });
    getVoiceProfileMock.mockReset().mockResolvedValue(null);
  });

  it("renders the header, the summary and both sides of the conversation", async () => {
    const html = await render(CALL);

    expect(html).toContain("Ana Reyes");
    expect(html).toContain("Booked");
    expect(html).toContain("3:42");
    // Stamped in the ACCOUNT's zone (19:15 UTC is 2:15 PM in Chicago), not the
    // machine's — the fixture zone is deliberately not the dev zone.
    expect(html).toContain("2:15");
    expect(html).toContain("Summary");
    expect(html).toContain("RECORDED");
    expect(html).toContain("Thanks for calling. How can I help?");
    expect(html).toContain("I need a roof inspection.");
    expect(html).toContain("Assistant");
    expect(html).toContain("Caller");
    expect(html).not.toContain("No transcript was recorded");
  });

  it("links to the contact, the conversations list and the calendar when the ids are there", async () => {
    const html = await render(CALL);

    expect(html).toContain("/dashboard/accounts/acct1/contacts/ct1");
    // The conversations LIST — there is no per-thread route, and a
    // `/conversations/cv1` link would 404.
    expect(html).toContain("/dashboard/accounts/acct1/conversations");
    expect(html).not.toContain("/conversations/cv1");
    expect(html).toContain("/dashboard/accounts/acct1/calendar");
    expect(html).not.toContain("/calendar/bk1");
  });

  /**
   * S-47e Task 12 (plan P20): a call that opened a shared number's holding thread names no contact
   * (0098's hold fires before any contact is ever matched), so its rail link opens that thread
   * directly (`?c=`) and reads "Open the texts" — never the generic "View conversation", which would
   * only point at the inbox's list.
   */
  it("a call with a conversation and NO contact links straight at the thread, worded 'Open the texts' (mutation: keep the generic list link/label -> FAILS)", async () => {
    const html = await render({ ...CALL, contact_id: null, contact: null });

    expect(html).toContain("/dashboard/accounts/acct1/conversations?c=cv1");
    expect(renderedText(html)).toContain("Open the texts");
    expect(renderedText(html)).not.toContain("View conversation");
  });

  it("a call WITH a contact keeps the generic conversations-list link, worded 'View conversation' (control)", async () => {
    const html = await render(CALL);

    expect(html).toContain("/dashboard/accounts/acct1/conversations");
    expect(html).not.toContain("/dashboard/accounts/acct1/conversations?c=cv1");
    expect(renderedText(html)).toContain("View conversation");
    expect(renderedText(html)).not.toContain("Open the texts");
  });

  it("renders no dead links for a call that matched nothing", async () => {
    // The abandoned-call shape: nobody identified, nothing opened, nothing
    // booked. Every link on this page is conditional on its own id, so the
    // whole rail is absent rather than present and inert.
    const html = await render({
      ...CALL,
      contact_id: null,
      contact: null,
      conversation_id: null,
      booking_id: null,
      outcome: "abandoned",
      duration_secs: null,
    });

    expect(html).not.toContain("View contact");
    expect(html).not.toContain("View conversation");
    expect(html).not.toContain("View booking");
    expect(html).not.toContain("/contacts/");
    expect(html).not.toContain("/conversations");
    expect(html).not.toContain("/calendar");
    // Still a usable page: the caller's number stands in for the name, and the
    // way back to the log is in the header.
    expect(html).toContain("+19565061545");
    expect(html).toContain("/dashboard/accounts/acct1/calls");
  });

  it("says so when there is no transcript, rather than rendering an empty conversation", async () => {
    const html = await render({ ...CALL, transcript: [] });
    expect(html).toContain("Transcript");
    expect(html).toContain("No transcript was recorded for this call.");
  });

  it("renders the mismatch warning as its own banded block, not as prose", async () => {
    // The honesty layer, composed by the real `composeSummary` against a state
    // that recorded NOTHING — so a hand-written fixture cannot let the shape
    // drift out from under the splitter.
    const prose = "An appointment was booked for Tuesday at nine.";
    const html = await render({
      ...CALL,
      summary: composeSummary(prose, emptyCallState()),
    });

    expect(html).toContain("⚠ MISMATCH — the notes below mention an appointment");
    // The warning treatment: an amber wash and rule that nothing else on the
    // page carries. Asserted on the painted class, because "it is rendered" is
    // exactly what a mismatch block that silently blended into the prose would
    // also satisfy.
    expect(html).toContain("bg-warning/10");
    expect(html).toContain("border-l-warning");
    // The prose is carried through untouched underneath it.
    expect(html).toContain(prose);
  });

  it("a lone block with no fact-line marker (no RECORDED line at all — 34 of 271 production calls) renders as PROSE, never facts by position (review fix; mutation: classify the lone block as facts by position -> FAILS)", async () => {
    // Hand-written on purpose: this is the one shape composeSummary never
    // actually produces (it always leads with the fact line) but a real
    // stored row can still carry, and the splitter must not assume the
    // composer's shape to classify it correctly.
    const prose = "Wants a replacement quote — 18-year-old system, says it's making noise.";
    const html = await render({ ...CALL, summary: prose });

    // React escapes the apostrophe to &#x27; in static markup. The exact
    // "prose" treatment (plain reading text), not "facts" (font-mono,
    // boxed on --surface-2) — asserted on the summary paragraph's OWN
    // class, not just page-wide absence, since the page's own section
    // labels are mono too.
    expect(html).toMatch(
      /<p class="text-sm leading-7 break-words whitespace-pre-wrap text-foreground">Wants a replacement quote — 18-year-old system, says it&#x27;s making noise\.<\/p>/,
    );
  });

  it("renders no Summary section at all when the summary is empty", async () => {
    // Not an empty heading: "Summary" over nothing reads as a summary that
    // said nothing, which is a claim this page has no basis for.
    const html = await render({ ...CALL, summary: "" });
    expect(html).not.toContain("Summary");
    expect(html).toContain("Transcript");
  });

  it("404s rather than leaking the difference between another tenant's call and no call", async () => {
    await expect(render(null)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  /**
   * The failed text-back. There is no retry in that path anywhere, so the
   * detail page is where the operator both LEARNS it failed and can do
   * something about it — unlike the list row, which is a whole-row click
   * target and gets the badge alone.
   */
  it("says the text-back didn't send, and offers to send the same message now", async () => {
    const html = await render(
      { ...CALL, outcome: "abandoned", booking_id: null },
      [FAILED_TEXTBACK],
    );

    expect(html).toContain("Text-back didn&#x27;t send");
    // The line the operator can read nowhere else: nothing was delivered, and
    // there is no queue and no cron that will have another go.
    expect(html).toContain("nothing will try again on its own");
    expect(html).toContain("Send it now");
    // Dot + word, never colour alone (DESIGN.md rule 3) — on the DOT's own
    // painted class. `toContain("bg-destructive")` used to stand here and
    // passed on the chip's `bg-destructive/5` with the dot deleted.
    expect(html).toMatch(TEXTBACK_STATUS_DOT);
    // FINDING 4. The block sits ON the card surface with the destructive wash
    // layered over it, like the MISMATCH block — not tinting `--surface-0` a
    // step below every other card on the page. `cn()` DROPS `bg-card` when a
    // second background lands on the same element, which is how that happened;
    // these two assertions are on the outer card and the inner wash separately,
    // because a single element carrying both is exactly what cannot exist.
    expect(html).toMatch(
      /<div\b[^>]*\bclass="(?=[^"]*\bbg-card\b)(?=[^"]*\bborder-destructive\/30\b)[^"]*"/,
    );
    expect(html).toMatch(/<div\b[^>]*\bclass="(?=[^"]*\bbg-destructive\/5\b)[^"]*"/);
    // The BODY THAT FAILED rides along as the resend's payload — the operator
    // is not made to retype the message the platform dropped.
    expect(html).toContain("Sorry we missed you just now");
    expect(html).toContain('name="contactId"');
    // Asked about THIS CALL's own window — not the contact's whole thread.
    expect(listFailedOutboundSmsMock).toHaveBeenCalledTimes(1);
    expect(listFailedOutboundSmsMock.mock.calls[0]![2]).toEqual([WINDOW]);
  });

  /**
   * FINDING 1, the false negative. A later outbound text to this contact used
   * to make the badge vanish — including an unrelated manual reply — and
   * nothing else in the product recorded that the text-back had failed. It is a
   * fact about THIS CALL and it stays. Only the resend control stands down,
   * because something has since reached this person and pressing it again would
   * text a real phone the same words twice.
   */
  it("keeps the badge after a later outbound text to the same contact succeeded, and withdraws only the resend", async () => {
    const html = await render(
      { ...CALL, outcome: "abandoned", booking_id: null },
      [{ ...FAILED_TEXTBACK, supersededAt: "2026-08-25T21:02:00.000000+00:00" }],
    );

    expect(html).toContain("Text-back didn&#x27;t send");
    expect(html).toMatch(TEXTBACK_STATUS_DOT);
    expect(html).not.toContain("Send it now");
    expect(html).not.toContain("<form");
    // FIX WAVE 2, FINDING 2. The withdrawal used to be MUTE: the button just
    // stopped being there, next to a line still saying nothing will try again
    // on its own. The operator's next move from that screen is to text the
    // person by hand — the duplicate the withdrawal exists to prevent. The
    // slot says why it is empty.
    expect(html).toContain("A later text did go out to them");
  });

  it("says nothing about a later text when there was none — the resend is the only thing in that slot", async () => {
    // The discriminator for the assertion above: this copy is conditional on
    // `supersededAt`, not decoration that renders under the badge always.
    const html = await render(
      { ...CALL, outcome: "abandoned", booking_id: null },
      [FAILED_TEXTBACK],
    );

    expect(html).toContain("Send it now");
    expect(html).not.toContain("A later text did go out to them");
  });

  it("renders nothing about the text-back when the last one went out fine", async () => {
    const html = await render({ ...CALL, outcome: "abandoned" }, []);

    expect(listFailedOutboundSmsMock).toHaveBeenCalledTimes(1);
    expect(html).not.toContain("Text-back");
    expect(html).not.toContain("Send it now");
  });

  it("never asks about a text-back for a call that opened no conversation", async () => {
    // The pre-text-back shape. A read here would be a query per page view
    // answering a question that cannot have an answer.
    await render({ ...CALL, conversation_id: null, outcome: "abandoned" });

    expect(listFailedOutboundSmsMock).not.toHaveBeenCalled();
  });

  it("never asks about a text-back for a call with no end — nothing bounds the window", async () => {
    // `ended_at` null: `finishCallRow` never landed, or the call is still live.
    // There is no window to build, and an unbounded one would be the
    // conversation-wide claim this page stopped making.
    await render({ ...CALL, ended_at: null, outcome: "abandoned" }, [FAILED_TEXTBACK]);

    expect(listFailedOutboundSmsMock).not.toHaveBeenCalled();
  });

  it("does not claim a text-back on a BOOKED call that shares a repeat caller's conversation", async () => {
    // Conversations are one-per-contact: a caller who abandoned on Monday and
    // booked on Tuesday has ONE conversation, and Monday's failed text-back
    // hangs off it. The text-back fires on `abandoned` and nothing else, so
    // this row must neither ask nor claim.
    const html = await render(CALL, [FAILED_TEXTBACK]);

    expect(listFailedOutboundSmsMock).not.toHaveBeenCalled();
    expect(html).not.toContain("Text-back");
    expect(html).not.toContain("Send it now");
  });

  /**
   * FINDING 3. One advisory panel must not be able to take a call record down.
   * The transcript is the reason this page exists.
   */
  it("still renders the call when the failed-text-back read blows up", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    getCallMock.mockResolvedValue({ ...CALL, outcome: "abandoned" });
    listFailedOutboundSmsMock.mockRejectedValue(new Error("permission denied for table messages"));
    listProposalsForCallMock.mockResolvedValue([]);

    const html = await CallDetailPage({
      params: Promise.resolve({ accountId: "acct1", callId: "call1" }),
    }).then(renderToStaticMarkup);

    expect(html).toContain("Transcript");
    expect(html).toContain("I need a roof inspection.");
    expect(html).not.toContain("Text-back");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("failed-text-back read failed"));
    spy.mockRestore();
  });
});

/**
 * The zone note reaches the Call detail page.
 *
 * It has to, and with the SAME answer the list gave: a client clicks a row
 * showing one date and must not land on a page showing another.
 */
describe("CallDetailPage — the zone note", () => {
  beforeEach(() => {
    resolvedZone = { zone: "America/Chicago", guessed: false, label: "America/Chicago", source: "account" };
    authFixture.isAgency = true;
  });

  it("names the zone (mutation: delete the ZoneNote element from page.tsx -> FAILS)", async () => {
    const html = await render(CALL);
    expect(renderedText(html)).toContain(m["zone.note"].replace("{zone}", "America/Chicago"));
  });

  it("offers the fix when the zone was guessed (mutation: render the note only when NOT guessed -> FAILS)", async () => {
    resolvedZone = { zone: "America/Chicago", guessed: true, label: "America/Chicago", source: "agency" };
    const html = await render(CALL);
    expect(renderedText(html)).toContain(m["zone.guessed.fix"]);
  });

  it("never hands a CLIENT the Settings link (mutation: hardcode isAgency={true} in page.tsx -> FAILS)", async () => {
    resolvedZone = { zone: "America/Chicago", guessed: true, label: "America/Chicago", source: "agency" };
    authFixture.isAgency = false;
    const html = await render(CALL);
    expect(renderedText(html)).toContain(m["zone.guessed.client"]);
    expect(renderedText(html)).not.toContain(m["zone.guessed.fix"]);
    expect(html).not.toContain("/settings");
  });
});

/**
 * Call Proposals Task 7 — the section is page.tsx's OWN responsibility to
 * fetch, place and degrade; the per-proposal rendering itself (status chip,
 * plain language, evidence clamp, stage names) is `proposals.test.ts`'s job.
 */
describe("CallDetailPage — the Suggestions section (item 8b-1)", () => {
  const T = makeTr("en");
  const base = {
    accountId: "acct1", callId: "call1", contactId: "ct1", source: "call" as const,
    evidenceRef: {}, evidenceLang: "en" as const, expiredReason: null, appliedPayload: null, appliedRef: null,
    undoneAt: null, undoneBy: null, decidedAt: null, decidedBy: null,
    createdAt: "2026-08-25T19:16:00.000000+00:00", expiresAt: "2099-01-01T00:00:00Z",
  };
  const TASK: Proposal = {
    ...base, id: "prop1", kind: "task", payload: { title: "Call back about the quote", dueAt: null },
    evidence: "Can you call me back about the quote tomorrow?", status: "pending",
  };
  const DECIDED: Proposal = {
    ...base, id: "prop0", kind: "task", payload: { title: "Send the brochure", dueAt: null },
    evidence: "Send me the brochure.", status: "accepted",
    decidedAt: "2026-08-25T20:00:00Z", decidedBy: "user_ana",
  };
  const STAGE: Proposal = {
    ...base, id: "prop2", kind: "opportunity_stage",
    payload: { opportunityId: "opp1", fromStageId: "st-a", toStageId: "st-b" },
    evidence: "Let's move this one along.", status: "pending",
  };
  /** Both accounts hold a deal and stages with the SAME ids; acct2's deal is listed first, so a read that
   *  lost its account filter (and keeps its limit) draws acct2's, and acct2's stages come last, so a map
   *  built last-wins draws theirs too. */
  const stageTables = () => ({
    opportunities: [
      { id: "opp1", account_id: "acct2", pipeline_id: "pipe-2" },
      { id: "opp1", account_id: "acct1", pipeline_id: "pipe-1" },
    ],
    pipeline_stages: [
      { id: "st-a", account_id: "acct1", pipeline_id: "pipe-1", name: "New", position: 0 },
      { id: "st-b", account_id: "acct1", pipeline_id: "pipe-1", name: "Quote sent", position: 1 },
      { id: "st-c", account_id: "acct1", pipeline_id: "pipe-1", name: "Won", position: 2 },
      { id: "st-a", account_id: "acct2", pipeline_id: "pipe-1", name: "Other Co stage", position: 0 },
      { id: "st-b", account_id: "acct2", pipeline_id: "pipe-1", name: "Other Co stage", position: 1 },
      { id: "st-x", account_id: "acct2", pipeline_id: "pipe-2", name: "Other Co stage", position: 0 },
    ],
  });
  const cards = (html: string) => [...html.matchAll(/data-suggestion="([^"]+)"/g)].map((x) => x[1]);

  it("renders a card per row, pending first, under the section's heading and the call page's #call-proposals anchor", async () => {
    const html = await render(CALL, [], [DECIDED, TASK]);
    expect(cards(html)).toEqual(["prop1", "prop0"]);
    expect(html).toContain('id="call-proposals"');
    expect(renderedText(html)).toContain(T.text("suggestions.heading"));
    expect(renderedText(html)).toContain("Can you call me back about the quote tomorrow?");
    expect(html).toContain(">Accept<");
  });

  // Item 8b-2 (spec 5.5): on the call page itself the link is the cited turn's own anchor, which the
  // transcript below carries; a copied row (no turn) has no link here at all.
  it("a cited card links to its turn on this page, and that anchor exists in the transcript; a copied row has no link (mutation: drop onCallPage -> FAILS)", async () => {
    const cited: Proposal = { ...TASK, id: "prop-cited", evidenceRef: { turn: 1, at: "2026-08-25T19:15:11Z" } };
    const html = await render(CALL, [], [cited, { ...DECIDED }]);
    const links = [...html.matchAll(/<a[^>]*data-transcript-link[^>]*href="([^"]*)"|<a[^>]*href="([^"]*)"[^>]*data-transcript-link/g)]
      .map((x) => x[1] ?? x[2]);
    expect(links).toEqual(["#turn-1"]);
    expect(html).toMatch(/<li[^>]*id="turn-1"/);
  });

  it("sits between the summary and the transcript", async () => {
    const text = renderedText(await render(CALL, [], [TASK]));
    const summaryAt = text.indexOf(m["calls.detail.summary"]);
    const sectionAt = text.indexOf(T.text("suggestions.heading"));
    expect(summaryAt).toBeGreaterThanOrEqual(0);
    expect(sectionAt).toBeGreaterThan(summaryAt);
    expect(text.indexOf(m["calls.detail.transcript"])).toBeGreaterThan(sectionAt);
  });

  it("renders no section at all when the call has none", async () => {
    const html = await render(CALL, [], []);
    expect(renderedText(html)).not.toContain(T.text("suggestions.heading"));
    expect(html).not.toContain("data-suggestion");
  });

  it("a failed read renders the section's error state and the rest of the page (rule 5; mutation: swallow to [] -> FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    getCallMock.mockResolvedValue(CALL);
    listFailedOutboundSmsMock.mockResolvedValue([]);
    listProposalsForCallMock.mockRejectedValue(new Error("permission denied for table proposals"));
    const html = await CallDetailPage({ params: Promise.resolve({ accountId: "acct1", callId: "call1" }) })
      .then(renderToStaticMarkup);
    expect(renderedText(html)).toContain("Couldn't load suggestions.");
    expect(html).toContain("I need a roof inspection.");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("suggestions read failed"));
    spy.mockRestore();
  });

  it("the failed read's log line goes through loggableError: an address in the error never reaches the log (mutation: String(e) -> FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    getCallMock.mockResolvedValue(CALL);
    listFailedOutboundSmsMock.mockResolvedValue([]);
    listProposalsForCallMock.mockRejectedValue(new Error("row for ana.caller@example.com refused"));
    await CallDetailPage({ params: Promise.resolve({ accountId: "acct1", callId: "call1" }) }).then(renderToStaticMarkup);
    const line = spy.mock.calls.map((a) => String(a[0])).find((l) => l.includes("suggestions read failed")) ?? "";
    expect(line).toContain("Error: row for [email] refused");
    expect(line).not.toContain("ana.caller@example.com");
    spy.mockRestore();
  });

  it("a failed stage read is the section's error state too, never a card it cannot name", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.tables = { ...fake.tables, ...stageTables() };
    fake.fail.add("pipeline_stages");
    const html = await render(CALL, [], [TASK, STAGE]);
    expect(renderedText(html)).toContain("Couldn't load suggestions.");
    expect(html).not.toContain("data-suggestion=");
    expect(html).toContain("I need a roof inspection.");
    spy.mockRestore();
  });

  it("a Spanish reader gets the section in Spanish while the page title stays English (spec 4.5)", async () => {
    prefsFixture.language = "es";
    const html = await render(CALL, [], [TASK]);
    const text = renderedText(html);
    expect(text).toContain("Sugerencias");
    expect(html).toContain('lang="es"');
    expect(text).toContain(m["calls.detail.title"]);
    expect(text).toContain(m["calls.detail.transcript"]);
  });

  it("the deals read: this account's deals only, for exactly the rows' deal ids (mutation: drop its account filter -> FAILS)", async () => {
    fake.tables = { ...fake.tables, ...stageTables() };
    const html = await render(CALL, [], [STAGE]);
    const [deals] = readsOf("opportunities");
    expect(deals?.eq).toContainEqual(["account_id", "acct1"]);
    expect(deals?.in).toEqual([["id", ["opp1"]]]);
    expect(deals?.limit).toBe(1);
    expect(renderedText(html)).toContain(T.text("suggestions.stage", { from: "New", to: "Quote sent" }));
    expect(html).not.toContain("Other Co stage");
  });

  it("the stages read: this account's stages only, the whole pipeline of each deal (mutation: drop its account filter -> FAILS)", async () => {
    fake.tables = { ...fake.tables, ...stageTables() };
    const html = await render(CALL, [], [STAGE]);
    const [stages] = readsOf("pipeline_stages");
    expect(stages?.eq).toContainEqual(["account_id", "acct1"]);
    expect(stages?.in).toEqual([["pipeline_id", ["pipe-1"]]]);
    expect(stages?.limit).toBe(500);
    expect(renderedText(html)).toContain(T.text("suggestions.stage", { from: "New", to: "Quote sent" }));
    expect(html).not.toContain("Other Co stage");
  });

  it("no stage suggestion reads no deals and no stages", async () => {
    await render(CALL, [], [TASK]);
    expect(readsOf("opportunities")).toEqual([]);
    expect(readsOf("pipeline_stages")).toEqual([]);
  });

  it("names the decider from one listPeopleNames read for exactly the decided rows' ids", async () => {
    listPeopleNamesMock.mockResolvedValue({ user_ana: "Ana Ruiz" });
    const html = await render(CALL, [], [DECIDED, TASK]);
    expect(listPeopleNamesMock).toHaveBeenCalledTimes(1);
    expect(listPeopleNamesMock).toHaveBeenCalledWith(REQUEST, ["user_ana"]);
    expect(renderedText(html)).toContain("Accepted by Ana Ruiz");
  });

  it("the source label names this call's own day and caller", async () => {
    const html = await render(CALL, [], [TASK]);
    expect(renderedText(html)).toContain("From the call on Tue, Aug 25 · Ana Reyes");
  });

  it("marks the cards with the account's persona", async () => {
    getVoiceProfileMock.mockResolvedValue({ persona_name: "Lupe" });
    const html = await render(CALL, [], [TASK]);
    expect(renderedText(html)).toContain("Lupe · AI");
  });
});

describe("\"Send it now\" is closed on render when the number cannot be texted (review R3-M8)", () => {
  it("a stopped number shows the composer's own stopped line in place of the button (mutation: render the button regardless → FAILS)", async () => {
    getContactMock.mockResolvedValue({ id: "ct1", phone: "+19565061545", phone_country_unconfirmed: false });
    recipientStateMock.mockResolvedValue({ kind: "stopped", since: "2026-08-25T21:00:00Z" });
    const html = await render({ ...CALL, outcome: "abandoned", booking_id: null }, [FAILED_TEXTBACK]);
    expect(html).not.toContain("Send it now");
    expect(renderedText(html)).toContain(m["compose.smsStopped"].replace("{date}", "Aug 25, 2026"));
  });

  it("an ok number keeps the button (the discriminator; mutation: always close it → FAILS)", async () => {
    getContactMock.mockResolvedValue({ id: "ct1", phone: "+19565061545", phone_country_unconfirmed: false });
    recipientStateMock.mockResolvedValue({ kind: "ok" });
    const html = await render({ ...CALL, outcome: "abandoned", booking_id: null }, [FAILED_TEXTBACK]);
    expect(html).toContain("Send it now");
  });

  it("a contact read that fails closes it with the unreadable line, never an open button (fails closed; mutation: show the button on error → FAILS)", async () => {
    getContactMock.mockRejectedValue(new Error("getContact failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await render({ ...CALL, outcome: "abandoned", booking_id: null }, [FAILED_TEXTBACK]);
    expect(html).not.toContain("Send it now");
    expect(renderedText(html)).toContain(m["compose.smsStateUnknown"]);
  });

  /** Review fix round 1, item 2: a read that SUCCEEDS but finds no contact
   *  (the call's `contact_id` pointed at a row that no longer exists) must
   *  close the same way an error does — the comment on this block already
   *  claims "fails closed"; `resendClosedLine = null` on a missing contact
   *  broke that promise by falling through to the open button below. */
  it("a contact read that succeeds with no contact closes it with the unreadable line too (fails closed; mutation: leave resendClosedLine null on a missing contact → FAILS)", async () => {
    getContactMock.mockResolvedValue(null);
    const html = await render({ ...CALL, outcome: "abandoned", booking_id: null }, [FAILED_TEXTBACK]);
    expect(html).not.toContain("Send it now");
    expect(renderedText(html)).toContain(m["compose.smsStateUnknown"]);
  });

  /** F-085 (spec §7.3): consent is keyed by address and a STOP can be tied to
   *  no contact, so a Technician's own token would see only part of the
   *  ledger. The recipient read takes the ledger client, after getContact on
   *  the request client proved the contact. */
  it("the recipient state reads the ledger through the ledger client, after the contact is proven (F-085; mutation: pass db to smsRecipientState → FAILS)", async () => {
    ledgerDbMock.mockClear();
    getContactMock.mockResolvedValue({ id: "ct1", phone: "+19565061545", phone_country_unconfirmed: false });
    recipientStateMock.mockResolvedValue({ kind: "ok" });
    await render({ ...CALL, outcome: "abandoned", booking_id: null }, [FAILED_TEXTBACK]);
    expect(recipientStateMock.mock.calls[0]![0]).toBe(LEDGER);
    expect(getContactMock.mock.calls[0]![0]).not.toBe(LEDGER);
    expect(ledgerDbMock.mock.invocationCallOrder[0]!).toBeGreaterThan(getContactMock.mock.invocationCallOrder[0]!);
  });

  it("a contact the caller cannot see reads no ledger at all (F-085; mutation: build the ledger client before the contact check → FAILS)", async () => {
    ledgerDbMock.mockClear();
    recipientStateMock.mockClear();
    getContactMock.mockResolvedValue(null);
    await render({ ...CALL, outcome: "abandoned", booking_id: null }, [FAILED_TEXTBACK]);
    expect(ledgerDbMock).not.toHaveBeenCalled();
    expect(recipientStateMock).not.toHaveBeenCalled();
  });
});

describe("CallDetailPage — the call card", () => {
  const CARD = {
    reason: "Wants the owner to call about the leak",
    callbackNumber: "9565061545",
    callerWords: "I need a roof inspection.",
  };
  beforeEach(() => {
    listFailedOutboundSmsMock.mockClear();
    getCallCardMock.mockReset().mockResolvedValue(CARD);
    getVoiceProfileMock.mockReset().mockResolvedValue({ persona_name: "Marisol" });
  });
  const text = (html: string) => renderedText(html).replace(/\s+/g, " ");

  it("reads this call's card for this account and shows it above the summary, marked with the account's persona (mutation: drop the panel → FAILS; read another account → FAILS)", async () => {
    const html = await render(CALL);
    expect(getCallCardMock).toHaveBeenCalledWith(expect.anything(), "acct1", "call1");
    expect(getVoiceProfileMock).toHaveBeenCalledWith(expect.anything(), "acct1");
    expect(text(html)).toContain(`${m["calls.card.reason"]} Wants the owner to call about the leak`);
    expect(text(html)).toContain("Marisol · AI");
    expect(html.indexOf('id="call-card"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="call-card"')).toBeLessThan(html.indexOf('id="call-summary"'));
  });

  it("a call with no card (three nulls: before cards, spam) renders no card section (mutation: render whenever the read returns → FAILS)", async () => {
    getCallCardMock.mockResolvedValue({ reason: null, callbackNumber: null, callerWords: null });
    const html = await render(CALL);
    expect(html).not.toContain('id="call-card"');
    expect(text(html)).not.toContain(m["calls.card.reasonUnknown"]);
  });

  it("a card read that blows up costs the card, never the call (mutation: drop the catch → the page throws, FAILS)", async () => {
    getCallCardMock.mockRejectedValue(new Error("column calls.reason does not exist"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await render(CALL);
    expect(html).not.toContain('id="call-card"');
    expect(html).toContain("I need a roof inspection.");
    expect(err.mock.calls.some((c) => String(c[0]).includes("call card read failed"))).toBe(true);
    err.mockRestore();
  });

  it("no persona to read (no profile, or the read fails) → the mark falls back to Sofía, and the card still shows (mutation: drop the fallback → \" · AI\", FAILS)", async () => {
    getVoiceProfileMock.mockRejectedValue(new Error("voice_profiles read failed"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(text(await render(CALL))).toContain("Sofía · AI");
    getVoiceProfileMock.mockResolvedValue({ persona_name: "  " });
    expect(text(await render(CALL))).toContain("Sofía · AI");
    err.mockRestore();
  });
});

/**
 * S-47d (spec; plan Task 14): the status the call started under, shown to EVERYONE who can see the
 * call (S19) — unlike the trade-rules and Knowledge items beside it in this same <dl>, this one is NOT
 * agency-only, because a client is entitled to know their own business was closed, late or storm-shut
 * when Sofía answered. Same bound-shape helpers as the trade-rules describe below.
 */
describe("CallDetailPage — the business status line (S-47d)", () => {
  beforeEach(() => {
    authFixture.isAgency = true;
  });

  /** The <dd>'s own text, decoded the way `renderedText` decodes any other copy assertion in this file. */
  const businessStatusText = (html: string): string | null => {
    const match = /<dd[^>]*data-business-status=""[^>]*>([^<]*)<\/dd>/.exec(html);
    return match ? renderedText(match[1]!) : null;
  };
  /** The <dt> immediately before the business-status <dd>, same bound shape as tradeRulesLabel below. */
  const businessStatusLabel = (html: string): string | null => {
    const match = /<dt[^>]*>([^<]*)<\/dt><dd[^>]*data-business-status=""/.exec(html);
    return match ? renderedText(match[1]!) : null;
  };

  it("shows a CLIENT the status the call started under (S19; mutation: gate it on isAgency -> FAILS)", async () => {
    authFixture.isAgency = false;
    const html = await render({ ...CALL, business_status: "storm" });
    expect(businessStatusLabel(html)).toBe("Status at the start");
    expect(businessStatusText(html)).toBe("Closed for a storm");
  });

  // Fix round C7 (design review I8): an sr-only label with an uppercase badge read as a present-tense fact
  // ("CLOSED FOR A STORM") on a page about a past call. The label is visible, the trade-rules shape.
  it("the label is VISIBLE, the trade-rules item's own shape, and the value is no 4px badge (mutation: restore the sr-only dt or the badge -> FAILS)", async () => {
    const html = await render({ ...CALL, business_status: "storm" });
    const item = /<div[^>]*>(<dt[^>]*>[^<]*<\/dt><dd[^>]*data-business-status=""[^>]*>[^<]*<\/dd>)<\/div>/.exec(html);
    expect(item).not.toBeNull();
    expect(item![0]).toMatch(/^<div class="flex flex-wrap items-baseline gap-x-1\.5 gap-y-0\.5"/);
    expect(item![1]).toMatch(/^<dt class="whitespace-nowrap">/);
    expect(item![1]).not.toMatch(/sr-only|uppercase|\brounded\b/);
    expect(item![1]).toMatch(/<dd class="font-medium text-foreground" data-business-status="">/);
  });

  it("renders no business-status item for an unstamped call", async () => {
    const html = await render(CALL);
    expect(html).not.toContain("data-business-status");
    expect(renderedText(html)).not.toContain("Status at the start");
  });

  it("reads in Spanish under the QA override (mutation: hardcode the English key -> FAILS)", async () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      getCallMock.mockResolvedValue({ ...CALL, business_status: "storm" });
      listFailedOutboundSmsMock.mockResolvedValue([]);
      listProposalsForCallMock.mockResolvedValue([]);
      const html = await CallDetailPage({
        params: Promise.resolve({ accountId: "acct1", callId: "call1" }),
        searchParams: Promise.resolve({ locale: "es" }),
      }).then(renderToStaticMarkup);
      expect(businessStatusLabel(html)).toBe("Estado al empezar");
      expect(businessStatusText(html)).toBe("Cerrado por tormenta");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/**
 * S-47b section 5.7: which trade rules this call ran under. AGENCY ONLY (spec section 3; SD3) — this page
 * is shared with clients, and the module is not theirs to see. Absent when the call carries none.
 */
describe("CallDetailPage — the trade rules line (S-47b)", () => {
  beforeEach(() => {
    authFixture.isAgency = true;
  });

  /** The <dd>'s own text, decoded the way `renderedText` decodes any other copy assertion in this file. */
  const tradeRulesText = (html: string): string | null => {
    const match = /<dd[^>]*data-trade-rules=""[^>]*>([^<]*)<\/dd>/.exec(html);
    return match ? renderedText(match[1]!) : null;
  };
  /** The <dt> immediately before the trade-rules <dd>, same bound shape. */
  const tradeRulesLabel = (html: string): string | null => {
    const match = /<dt[^>]*>([^<]*)<\/dt><dd[^>]*data-trade-rules=""/.exec(html);
    return match ? renderedText(match[1]!) : null;
  };

  it("names the module and version for the agency (mutation: a constant version → FAILS below)", async () => {
    const html = await render({ ...CALL, trade_module: "insurance_pc", trade_module_version: 1 });
    expect(tradeRulesText(html)).toBe("Insurance · v1");
    expect(tradeRulesLabel(html)).toBe("Trade rules");
  });

  it("wraps the value under the label on a narrow screen, and never breaks the label itself (design D-M1; mutation: drop flex-wrap or whitespace-nowrap → FAILS)", async () => {
    const html = await render({ ...CALL, trade_module: "insurance_pc", trade_module_version: 1 });
    expect(html).toMatch(
      /<div class="flex flex-wrap items-baseline gap-x-1\.5 gap-y-0\.5" lang="en"><dt class="whitespace-nowrap">Trade rules<\/dt><dd[^>]*data-trade-rules=""/);
  });

  it("reads in Spanish under the QA override (mutation: hardcode the English key → FAILS)", async () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      getCallMock.mockResolvedValue({ ...CALL, trade_module: "insurance_pc", trade_module_version: 1 });
      listFailedOutboundSmsMock.mockResolvedValue([]);
      listProposalsForCallMock.mockResolvedValue([]);
      const html = await CallDetailPage({
        params: Promise.resolve({ accountId: "acct1", callId: "call1" }),
        searchParams: Promise.resolve({ locale: "es" }),
      }).then(renderToStaticMarkup);
      expect(tradeRulesText(html)).toBe("Seguros · v1");
      expect(tradeRulesLabel(html)).toBe("Reglas del giro");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("renders no trade-rules line for a call with no stamp", async () => {
    const html = await render(CALL);
    expect(html).not.toContain("data-trade-rules");
  });

  it("never shows a client the trade rules, even with a stamp on the call (mutation: drop isAgency && → FAILS)", async () => {
    authFixture.isAgency = false;
    const html = await render({ ...CALL, trade_module: "insurance_pc", trade_module_version: 1 });
    expect(html).not.toContain("data-trade-rules");
    expect(renderedText(html)).not.toContain("Trade rules");
  });

  it("reads the version off the call, not a constant (mutation: hardcode v1 → FAILS)", async () => {
    const html = await render({ ...CALL, trade_module: "events", trade_module_version: 3 });
    expect(tradeRulesText(html)).toBe("Events · v3");
  });
});

/**
 * S-47c section 5.8: the "What Sofía knew" link, agency only and only when the call is stamped — the
 * exact rule and markup the trade-rules item (above) carries, beside it in the same <dl>.
 */
describe("CallDetailPage — the Knowledge link (S-47c)", () => {
  beforeEach(() => {
    authFixture.isAgency = true;
    getVoiceProfileMock.mockReset().mockResolvedValue(null);
  });

  it("names the persona and version for the agency when the call is stamped (mutation: a constant version → FAILS below)", async () => {
    const html = await render({ ...CALL, knowledge_version: 3 });
    expect(html).toContain('<dd class="font-medium text-foreground" data-knowledge="">');
    expect(renderedText(html)).toContain("What Sofía knew (#3)");
    expect(html).toContain('href="/dashboard/accounts/acct1/voice/knowledge/3?call=call1"');
  });

  it("the link reads as a link at rest: an underline in the strong line colour, not only on hover (design review; mutation: hover:underline only → FAILS)", async () => {
    const html = await render({ ...CALL, knowledge_version: 3 });
    const link = /<a[^>]*href="\/dashboard\/accounts\/acct1\/voice\/knowledge\/3\?call=call1"[^>]*>/.exec(html)?.[0] ?? "";
    expect(link).toMatch(/class="[^"]*(?<![\w:-])underline(?![\w-])/);
    expect(link).toContain("decoration-[var(--line-strong)]");
    expect(link).toContain("underline-offset-2");
  });

  it("uses the account's own persona name, not a constant (mutation: hardcode Sofía → FAILS)", async () => {
    getVoiceProfileMock.mockResolvedValue({ persona_name: "Max" });
    const html = await render({ ...CALL, knowledge_version: 3 });
    expect(renderedText(html)).toContain("What Max knew (#3)");
  });

  it("reads the version off the call, not a constant (mutation: hardcode #3 → FAILS)", async () => {
    const html = await render({ ...CALL, knowledge_version: 7 });
    expect(renderedText(html)).toContain("What Sofía knew (#7)");
    expect(html).toContain('href="/dashboard/accounts/acct1/voice/knowledge/7?call=call1"');
  });

  // S-47c follow-up (spec 5.4, C13): the knowledge page reads THIS call's own trade module only when
  // it knows which call it came from — so the link must carry it, every time it renders at all.
  it("carries ?call=<callId>, the route's own call id (mutation: drop the query → FAILS)", async () => {
    const html = await render({ ...CALL, knowledge_version: 3 });
    expect(html).toContain('href="/dashboard/accounts/acct1/voice/knowledge/3?call=call1"');
  });

  it("renders no Knowledge line for a call with no stamp (mutation: render it unconditionally → FAILS)", async () => {
    const html = await render(CALL);
    expect(html).not.toContain("data-knowledge");
    expect(renderedText(html)).not.toContain("Knowledge");
  });

  it("never shows a client the Knowledge link, even on a stamped call (mutation: drop isAgency && → FAILS)", async () => {
    authFixture.isAgency = false;
    const html = await render({ ...CALL, knowledge_version: 3 });
    expect(html).not.toContain("data-knowledge");
    expect(renderedText(html)).not.toContain("Knowledge");
  });
});
