import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import type { CallDetailRow, CallProposal } from "@bis/db";
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

/** The proposals block's OWN read, `db.from("pipeline_stages")...` — a raw
 *  chain, same as the account-timezone lookup below, because there is no
 *  exported `@bis/db` accessor for "resolve these stage ids to names" and
 *  page.tsx follows the account-lookup's own existing precedent rather than
 *  reach into another agent's package for one. Bare, like
 *  `listFailedOutboundSmsMock` below it — every `render()` call sets its
 *  resolved value explicitly, so a test that says nothing about stages gets
 *  no rows back rather than a stale value left over from a previous test. */
const pipelineStagesMock = vi.fn();
/** Captures the `.eq(...)` call the raw chain's own args would otherwise
 *  swallow. RLS does not backstop this read on its own: the live policy is
 *  `app.is_agency() OR account_id = app.current_account_id()`, so for an
 *  agency session every tenant's stages are readable and there is no
 *  composite FK tying a proposal's account to its call — this `.eq` is the
 *  only thing standing there, and a mock whose `.eq()` ignores its
 *  arguments can never prove it is still called correctly. */
const pipelineStagesEqMock = vi.fn();
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: (table: string) => {
      if (table === "pipeline_stages") {
        return {
          select: () => ({
            eq: (...eqArgs: unknown[]) => {
              pipelineStagesEqMock(...eqArgs);
              return { in: (...args: unknown[]) => pipelineStagesMock(...args) };
            },
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { timezone: "America/Chicago" }, error: null }),
          }),
        }),
      };
    },
  }),
}));

const getCallMock = vi.fn();
const listFailedOutboundSmsMock = vi.fn();
const listProposalsForCallMock = vi.fn();
vi.mock("@bis/db", () => ({
  getCall: (...args: unknown[]) => getCallMock(...args),
  listFailedOutboundSms: (...args: unknown[]) => listFailedOutboundSmsMock(...args),
  listProposalsForCall: (...args: unknown[]) => listProposalsForCallMock(...args),
}));

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

/** `stageRows` defaults to none — only tests exercising an
 *  `opportunity_stage` proposal need to supply pipeline_stages fixture rows. */
function render(
  row: CallDetailRow | null,
  failed: (typeof FAILED_TEXTBACK)[] = [],
  proposals: CallProposal[] = [],
  stageRows: { id: string; name: string; position: number }[] = [],
) {
  getCallMock.mockResolvedValue(row);
  listFailedOutboundSmsMock.mockResolvedValue(failed);
  listProposalsForCallMock.mockResolvedValue(proposals);
  pipelineStagesMock.mockResolvedValue({ data: stageRows, error: null });
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
    pipelineStagesMock.mockClear();
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
describe("CallDetailPage — proposals", () => {
  const TASK_PROPOSAL: CallProposal = {
    id: "prop1", accountId: "acct1", callId: "call1", contactId: "ct1",
    kind: "task", payload: { title: "Call back about the quote", dueAt: null },
    evidence: "Can you call me back about the quote tomorrow?",
    status: "pending", decidedAt: null, decidedBy: null,
    createdAt: "2026-08-25T19:16:00.000000+00:00",
  };

  const STAGE_PROPOSAL: CallProposal = {
    id: "prop2", accountId: "acct1", callId: "call1", contactId: "ct1",
    kind: "opportunity_stage",
    payload: { opportunityId: "opp1", fromStageId: "stage-a", toStageId: "stage-b" },
    evidence: "Let's move this one to won.",
    status: "pending", decidedAt: null, decidedBy: null,
    createdAt: "2026-08-25T19:16:00.000000+00:00",
  };

  beforeEach(() => {
    pipelineStagesEqMock.mockClear();
  });

  /**
   * RLS does NOT backstop this on its own — the live policy is
   * `app.is_agency() OR account_id = app.current_account_id()`, so for an
   * agency session every tenant's pipeline_stages rows are readable, and
   * there is no composite FK tying a proposal's account to its call. The
   * `.eq("account_id", accountId)` in page.tsx is the only thing standing
   * there.
   */
  it("scopes the raw pipeline_stages read to the page's own account (mutation: drop .eq(\"account_id\", accountId) from the stage lookup -> FAILS)", async () => {
    await render(
      CALL, [], [STAGE_PROPOSAL],
      [
        { id: "stage-a", name: "Contacted", position: 1 },
        { id: "stage-b", name: "Won", position: 2 },
      ],
    );
    expect(pipelineStagesEqMock).toHaveBeenCalledWith("account_id", "acct1");
  });

  it("renders no proposals section at all when the call has none", async () => {
    const html = await render(CALL, [], []);
    expect(renderedText(html)).not.toContain(m["proposals.heading"]);
  });

  it("places the proposals section between the summary and the transcript when there are pending ones", async () => {
    const html = await render(CALL, [], [TASK_PROPOSAL]);
    const text = renderedText(html);
    const summaryAt = text.indexOf(m["calls.detail.summary"]);
    const proposalsAt = text.indexOf(m["proposals.heading"]);
    const transcriptAt = text.indexOf(m["calls.detail.transcript"]);
    expect(summaryAt).toBeGreaterThanOrEqual(0);
    expect(proposalsAt).toBeGreaterThan(summaryAt);
    expect(transcriptAt).toBeGreaterThan(proposalsAt);
    // The evidence itself, quoted, reads against the transcript a few
    // inches below it — the whole reason this section sits where it does.
    expect(text).toContain("Can you call me back about the quote tomorrow?");
  });

  /**
   * The read is best-effort (page.tsx:90-100's own text-back panel is the
   * precedent this mirrors): a blown-up proposals read must degrade this
   * ONE block to absent, never take the call record down.
   * Mutation: delete the try/catch around the proposals read in page.tsx ->
   * FAILS (the whole page throws instead of rendering the Transcript).
   */
  it("still renders the call when the proposals read blows up", async () => {
    // Bypasses the `render()` helper on purpose — it unconditionally sets
    // `listProposalsForCallMock` to a RESOLVED value on every call, which
    // would stomp the rejection this test needs. Same reason the sibling
    // text-back-blows-up test above bypasses it too.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    getCallMock.mockResolvedValue(CALL);
    listFailedOutboundSmsMock.mockResolvedValue([]);
    listProposalsForCallMock.mockRejectedValue(new Error("permission denied for table call_proposals"));

    const html = await CallDetailPage({
      params: Promise.resolve({ accountId: "acct1", callId: "call1" }),
    }).then(renderToStaticMarkup);

    expect(html).toContain("Transcript");
    expect(html).toContain("I need a roof inspection.");
    expect(renderedText(html)).not.toContain(m["proposals.heading"]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("proposals read failed"));
    spy.mockRestore();
  });

  /**
   * The two reads (`listProposalsForCall`, then — only when an
   * opportunity_stage proposal needs one — the raw `pipeline_stages` name
   * lookup) are ONE best-effort unit, per page.tsx's own comment: a failure
   * in EITHER degrades the WHOLE block to absent. `if (error) throw` on the
   * stage read is what makes that true; replacing it with `void error`
   * would let the stage read's error pass in silence while the unrelated
   * TASK proposal in the same batch kept rendering.
   */
  it("degrades the WHOLE proposals block to absent when the pipeline_stages read itself errors (mutation: replace `if (error) throw` with `void error` on the stage read -> FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    getCallMock.mockResolvedValue(CALL);
    listFailedOutboundSmsMock.mockResolvedValue([]);
    listProposalsForCallMock.mockResolvedValue([TASK_PROPOSAL, STAGE_PROPOSAL]);
    pipelineStagesMock.mockResolvedValue({
      data: null, error: { message: "permission denied for table pipeline_stages" },
    });

    const html = await CallDetailPage({
      params: Promise.resolve({ accountId: "acct1", callId: "call1" }),
    }).then(renderToStaticMarkup);

    expect(html).toContain("Transcript");
    // The WHOLE section is gone — including the unrelated TASK proposal —
    // not just the one stage entry the failed lookup could not resolve.
    expect(renderedText(html)).not.toContain(m["proposals.heading"]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("proposals read failed"));
    spy.mockRestore();
  });
});
