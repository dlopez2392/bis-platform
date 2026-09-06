import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CallDetailRow } from "@bis/db";
import { emptyCallState } from "@/lib/voice/call-state";
import { composeSummary } from "@/lib/voice/summarize";

// Same shape as the sibling list page's test: the auth gate and the two data
// reads this async server component actually reaches are mocked, so what is
// under test is which branch renders — not Clerk or Supabase.
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: true }),
}));

vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { timezone: "America/Chicago" }, error: null }),
        }),
      }),
    }),
  }),
}));

const getCallMock = vi.fn();
const listFailedOutboundSmsMock = vi.fn();
vi.mock("@bis/db", () => ({
  getCall: (...args: unknown[]) => getCallMock(...args),
  listFailedOutboundSms: (...args: unknown[]) => listFailedOutboundSmsMock(...args),
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
  conversationId: "cv1",
  messageId: "msg1",
  body: "Sorry we missed you just now — reply here and we'll get right back to you.",
  failedAt: "2026-08-25T19:19:00.000000+00:00",
};

function render(row: CallDetailRow | null, failed: (typeof FAILED_TEXTBACK)[] = []) {
  getCallMock.mockResolvedValue(row);
  listFailedOutboundSmsMock.mockResolvedValue(failed);
  return CallDetailPage({
    params: Promise.resolve({ accountId: "acct1", callId: "call1" }),
  }).then(renderToStaticMarkup);
}

describe("CallDetailPage", () => {
  beforeEach(() => listFailedOutboundSmsMock.mockClear());

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
    // Dot + word, never colour alone (DESIGN.md rule 3).
    expect(html).toContain("bg-destructive");
    // The BODY THAT FAILED rides along as the resend's payload — the operator
    // is not made to retype the message the platform dropped.
    expect(html).toContain("Sorry we missed you just now");
    expect(html).toContain('name="contactId"');
    // Asked about THIS call's conversation and nothing else.
    expect(listFailedOutboundSmsMock).toHaveBeenCalledTimes(1);
    expect(listFailedOutboundSmsMock.mock.calls[0]![2]).toEqual(["cv1"]);
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
});
