import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CallProposal, ProposalStatus } from "@bis/db";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { CallProposals, acceptedToastFor, type ResolvedStage } from "./proposals";

/** `acceptProposal`/`dismissProposal` (imported by proposals.tsx from
 *  "./actions", a "use server" file) are never invoked by any test below —
 *  `.bind(null, accountId, callId)` only creates a closure, and a static
 *  render never clicks a button — so this file needs no mock of them, unlike
 *  actions.test.ts which proves their own behaviour against a real account. */

const BASE = {
  id: "prop1", accountId: "acct1", callId: "call1", contactId: "ct1" as string | null,
  evidence: "Can you call me back Tuesday about the quote?",
  status: "pending" as ProposalStatus,
  decidedAt: null as string | null, decidedBy: null as string | null,
  createdAt: "2026-08-25T19:16:00.000000+00:00",
};

function taskProposal(overrides: Partial<typeof BASE> & { title?: string; dueAt?: string | null } = {}): CallProposal {
  const { title = "Call back Tuesday", dueAt = null, ...base } = overrides;
  return { ...BASE, ...base, kind: "task", payload: { title, dueAt } };
}

function contactFieldProposal(
  field: "firstName" | "lastName" | "email" | "phone",
  value: string,
  overrides: Partial<typeof BASE> = {},
): CallProposal {
  return { ...BASE, ...overrides, kind: "contact_field", payload: { field, value } };
}

function stageProposal(
  fromStageId: string,
  toStageId: string,
  overrides: Partial<typeof BASE> = {},
): CallProposal {
  return {
    ...BASE, ...overrides, kind: "opportunity_stage",
    payload: { opportunityId: "opp1", fromStageId, toStageId },
  };
}

function render(
  proposals: CallProposal[],
  stageNames: Record<string, ResolvedStage> = {},
  timezone = "America/Chicago",
): string {
  return renderToStaticMarkup(
    CallProposals({ proposals, accountId: "acct1", callId: "call1", stageNames, timezone }),
  );
}

describe("CallProposals", () => {
  it("renders nothing at all when there are no proposals (mutation: return the section unconditionally -> FAILS)", () => {
    expect(render([])).toBe("");
  });

  /**
   * PINS THE ANCHOR ID. Nothing else in this file — or anywhere else —
   * checks it: the agency work queue's own proposal row deep-links to
   * `#call-proposals` (`agency-work-list.tsx`, pinned by string in
   * `agency-work-list.test.ts:316`, "the row's own link is how a reader
   * checks it against the whole call"), but that test only pins the HREF
   * it emits, never the id it targets. A rename of the id on THIS end
   * breaks that link with no test failure anywhere and no runtime error —
   * `<a href="#call-proposals">` against a page with no matching id is
   * valid HTML, so the browser just silently lands at the top of the page
   * instead of at the evidence a reader followed the link to check.
   */
  it("keeps the section's heading id \"call-proposals\" — the work queue's evidence link targets this exact id (mutation: rename the id -> FAILS)", () => {
    const html = render([taskProposal()]);
    expect(html).toMatch(/<h2\b[^>]*\bid="call-proposals"[^>]*>/);
  });

  it("renders the status chip as dot + word, never colour alone (mutation: delete the dot span -> FAILS)", () => {
    const html = render([taskProposal()]);
    // The DOT's own SOLID class, not the chip's alpha background: the
    // `Badge` itself is ALSO a `<span>`, ALSO carries `rounded-full` (its own
    // base class) and its chip class is `bg-primary/5` — a plain
    // `bg-primary` substring match, or even a `\b`-bounded one, is satisfied
    // by that outer badge span too ("/5" still starts a word boundary right
    // after "primary"). The negative lookahead demands the BARE token, same
    // shape as ../calls-table.test.ts's `TEXTBACK_STATUS_DOT`.
    expect(html).toMatch(/<span\b[^>]*\bclass="(?=[^"]*\brounded-full\b)(?=[^"]*\bbg-primary(?![\w/-]))[^"]*"/);
    expect(renderedText(html)).toContain(m["proposals.status.pending"]);
  });

  it("renders the accepted status chip as dot + word too, never colour alone (mutation: render the dot only when status is pending -> FAILS)", () => {
    const html = render(
      [taskProposal({ status: "accepted", decidedAt: "2026-08-25T20:00:00Z", decidedBy: "user_1" })],
    );
    // Same trap as the pending case: the chip's own alpha fill is
    // `bg-success/10`, which a bare `bg-success` substring match (even
    // `\b`-bounded) would also satisfy.
    expect(html).toMatch(/<span\b[^>]*\bclass="(?=[^"]*\brounded-full\b)(?=[^"]*\bbg-success(?![\w/-]))[^"]*"/);
    expect(renderedText(html)).toContain(m["proposals.status.accepted"]);
  });

  it("renders the dismissed status chip as dot + word too, never colour alone (mutation: render the dot only when status is pending -> FAILS)", () => {
    const html = render(
      [taskProposal({ status: "dismissed", decidedAt: "2026-08-25T20:00:00Z", decidedBy: "user_1" })],
    );
    expect(html).toMatch(/<span\b[^>]*\bclass="(?=[^"]*\brounded-full\b)(?=[^"]*\bbg-muted-foreground\/60\b)[^"]*"/);
    expect(renderedText(html)).toContain(m["proposals.status.dismissed"]);
  });

  it("prefixes and visually quotes the evidence (mutation: drop the m[\"proposals.evidence\"] prefix -> FAILS)", () => {
    const html = render([taskProposal({ evidence: "Call me back Tuesday please" })]);
    const text = renderedText(html);
    expect(text).toContain(m["proposals.evidence"]);
    expect(text).toContain("Call me back Tuesday please");
    // Visually quoted with a real <q>, not a plain <p> — the quoting has to
    // be structural, not just adjacent text that happens to look quoted.
    expect(html).toMatch(/<q\b[^>]*>Call me back Tuesday please<\/q>/);
  });

  it("shows a caller's whole turn as evidence, never clipped (mutation: reintroduce line-clamp-4 -> FAILS)", () => {
    // 95 characters — the real measured MAX across turns that can actually
    // produce a proposal (booked/lead/message calls: 231 eligible turns,
    // mean 33, p95 85, max 95, none over 150). The much larger "mean 57, p95
    // 473, max 483" figure this test used to cite was measured across ALL
    // caller turns, but every turn over 200 characters in this database is
    // the same robocall script on a spam/abandoned call, and
    // `eligibility.ts` refuses both outcomes before a proposal can exist —
    // that shape can never reach this component. A clamp with no expand
    // affordance would silently hide exactly the tail where a late
    // qualifier ("…but not on Tuesday") lives, so evidence is never clipped
    // here at any length.
    const longEvidence = "We need someone to come look at the roof because ".repeat(2).slice(0, 95);
    expect(longEvidence).toHaveLength(95);
    const html = render([taskProposal({ evidence: longEvidence })]);
    expect(html).not.toMatch(/line-clamp/);
    expect(renderedText(html)).toContain(longEvidence);
    // Structural: the FULL string sits inside one <q>, not truncated by a
    // CSS clamp that (per the finding) would also have broken the
    // `{" "}`-separated prefix by forcing `display:-webkit-box` on an
    // inline <q>.
    expect(html).toMatch(new RegExp(`<q\\b[^>]*>${longEvidence}</q>`));
  });

  it("renders a task proposal in plain language, not the raw payload (mutation: interpolate the payload object directly -> FAILS)", () => {
    const html = render([taskProposal({ title: "Call back about the quote" })]);
    expect(renderedText(html)).toContain("Add a task: Call back about the quote");
  });

  // Fix-wave Important 1: a machine-chosen due date must be VISIBLE before a
  // human accepts it — a review card that hid it was exactly how a due date
  // eight and a half months in the past reached `tasks.due_at` unseen.
  it("shows a task proposal's due date, formatted in the account's own zone (mutation: drop the due-date line -> FAILS)", () => {
    // 01:00 UTC is still the previous day in Chicago — the same boundary
    // format.test.ts and work-list.test.ts both use, so a fixture zone that
    // happened to agree with UTC could not tell "formatted in the given
    // zone" apart from "formatted in whatever zone the process is in".
    const html = render(
      [taskProposal({ title: "Call back Tuesday", dueAt: "2026-09-23T01:00:00.000Z" })],
      {},
      "America/Chicago",
    );
    expect(renderedText(html)).toContain(m["proposals.task.due"].replace("{date}", () => "Sep 22, 2026"));
  });

  it("renders a due date in a DIFFERENT zone as a different calendar day, proving it uses the given zone and not a fixed one (mutation: hardcode the zone instead of using the timezone prop -> FAILS)", () => {
    const html = render(
      [taskProposal({ title: "Call back Tuesday", dueAt: "2026-09-23T01:00:00.000Z" })],
      {},
      "UTC",
    );
    expect(renderedText(html)).toContain(m["proposals.task.due"].replace("{date}", () => "Sep 23, 2026"));
  });

  it("shows no due date at all for a task proposal whose dueAt is null (mutation: render a due-date line unconditionally -> FAILS)", () => {
    const html = render([taskProposal({ title: "Call back Tuesday", dueAt: null })]);
    expect(renderedText(html)).not.toContain(m["proposals.task.due"].replace("{date}", () => "").trim());
    expect(renderedText(html)).not.toContain("Due");
  });

  it("shows no due date for a contact_field or opportunity_stage proposal, even though neither carries one (mutation: render 'Due' for every entry -> FAILS)", () => {
    const html = render([
      contactFieldProposal("firstName", "Roberto"),
      stageProposal("stage-contacted", "stage-won", { id: "prop2" }),
    ], {
      "stage-contacted": { name: "Contacted", position: 1 },
      "stage-won": { name: "Won", position: 2 },
    });
    expect(renderedText(html)).not.toContain("Due");
  });

  it("renders a contact_field proposal naming the field in plain language (mutation: interpolate the raw field key instead of its label -> FAILS)", () => {
    const html = render([contactFieldProposal("firstName", "Roberto")]);
    const text = renderedText(html);
    expect(text).toContain("Add their first name: Roberto");
    // The raw camelCase key must never leak into copy a reader sees.
    expect(text).not.toContain("firstName");
  });

  it("shows an opportunity_stage move as fromStage to toStage BY NAME, never the destination alone (mutation: render only toStage -> FAILS)", () => {
    const html = render(
      [stageProposal("stage-contacted", "stage-won")],
      {
        "stage-contacted": { name: "Contacted", position: 1 },
        "stage-won": { name: "Won", position: 2 },
      },
    );
    const text = renderedText(html);
    expect(text).toContain("Move from Contacted to Won");
  });

  it("warns when a move skips exactly one stage in between — no stage is skipped silently (mutation: raise the skip threshold to bypassed >= 2 -> FAILS)", () => {
    const html = render(
      [stageProposal("s0", "s2")],
      {
        s0: { name: "New", position: 0 },
        // Bypasses only position 1 — one stage — which must still speak up:
        // this is New(0) -> Appointment(2), the caller who books on the
        // first call, the single most likely stage proposal this feature
        // will ever produce.
        s2: { name: "Won", position: 2 },
      },
    );
    // Anchored to the resolved message, not a bare literal — a reword of
    // the copy must not silently void this assertion.
    expect(renderedText(html)).toContain(m["proposals.stage.skip.one"]);
  });

  it("says so with a count when a move skips more than one stage (mutation: delete the skip note -> FAILS)", () => {
    const html = render(
      [stageProposal("s0", "s3")],
      {
        s0: { name: "New", position: 0 },
        // Bypasses positions 1 and 2 — two stages.
        s3: { name: "Won", position: 3 },
      },
    );
    expect(renderedText(html)).toContain(
      m["proposals.stage.skip.many"].replace("{n}", "2"),
    );
  });

  it("says nothing extra for a move to the immediately next stage (mutation: warn even when bypassed is 0 -> FAILS)", () => {
    const html = render(
      [stageProposal("s0", "s1")],
      {
        s0: { name: "New", position: 0 },
        // Adjacent — bypasses nothing.
        s1: { name: "Contacted", position: 1 },
      },
    );
    const text = renderedText(html);
    // Anchored to the resolved messages, not the literal "skips" — a reword
    // must not silently void this the way the previous bare-literal
    // assertion did.
    expect(text).not.toContain(m["proposals.stage.skip.one"]);
    expect(text).not.toContain(m["proposals.stage.skip.many"].replace("{n}", "0"));
  });

  it("warns the same way for a move BACKWARD across a bypassed stage (mutation: drop Math.abs from the bypass calculation -> FAILS)", () => {
    const html = render(
      [stageProposal("s3", "s1")],
      {
        // Quote Sent(3) back to Contacted(1) — bypasses position 2, same as
        // the forward one-stage-bypass case above. Without Math.abs, the
        // raw delta (1 - 3 = -2) computes a negative "bypassed" count that
        // never clears the threshold, and the warning silently disappears
        // for every backward move.
        s3: { name: "Quote Sent", position: 3 },
        s1: { name: "Contacted", position: 1 },
      },
    );
    expect(renderedText(html)).toContain(m["proposals.stage.skip.one"]);
  });

  it("skips a stage proposal whose stage names failed to resolve, rather than showing the raw id or the destination alone (mutation: fall back to the raw uuid -> FAILS)", () => {
    // No stageNames supplied at all — page.tsx's best-effort read came back
    // empty. The ONLY proposal is the unresolvable one, so the whole section
    // must be absent, not a heading over a proposal it cannot describe.
    const html = render([stageProposal("stage-a", "stage-b")], {});
    expect(html).toBe("");
  });

  it("sorts a pending proposal ahead of one already decided, regardless of insert order (mutation: render proposals in the given order without sorting -> FAILS)", () => {
    // `listProposalsForCall` orders by created_at DESC — insert order for a
    // batch generated all at once — so a row that still needs a decision
    // can otherwise sit under ones that need nothing. The dismissed one is
    // FIRST in the array on purpose.
    const html = render([
      taskProposal({
        id: "p-dismissed", title: "Dismissed one", status: "dismissed",
        decidedAt: "2026-08-25T20:00:00Z", decidedBy: "user_1",
      }),
      taskProposal({ id: "p-pending", title: "Pending one" }),
    ]);
    const text = renderedText(html);
    const pendingAt = text.indexOf("Pending one");
    const dismissedAt = text.indexOf("Dismissed one");
    expect(pendingAt).toBeGreaterThanOrEqual(0);
    expect(dismissedAt).toBeGreaterThanOrEqual(0);
    expect(pendingAt).toBeLessThan(dismissedAt);
  });

  it("renders Accept and Dismiss for a pending proposal (mutation: never render ProposalActions -> FAILS)", () => {
    const html = render([taskProposal()]);
    const text = renderedText(html);
    expect(text).toContain(m["proposals.accept"]);
    expect(text).toContain(m["proposals.dismiss"]);
  });

  it("shows only the status chip, with no actions, for an already-decided proposal (mutation: render actions regardless of status -> FAILS)", () => {
    const html = render([taskProposal({ status: "accepted", decidedAt: "2026-08-25T20:00:00Z", decidedBy: "user_1" })]);
    expect(renderedText(html)).toContain(m["proposals.status.accepted"]);
    // Structural, not text-content: "Accepted" (the status word) itself
    // CONTAINS "Accept" (the button's own label) as a substring, so a
    // `.toContain(m["proposals.accept"])` assertion here would be satisfied
    // by the status chip alone and could never catch a real regression.
    // No `<button>` at all is what "no actions" actually means.
    expect(html).not.toContain("<button");
  });
});

describe("acceptedToastFor", () => {
  // One test per kind: collapsing the function to always
  // `return m["proposals.accepted.toast"]` leaves 35/35 green if the suite
  // only ever exercises it through a hardcoded prop (as
  // proposal-actions.test.ts does) — these call the real mapping function
  // directly, so each kind's own branch is what is under test.
  it("maps a task proposal to the to-do-list toast", () => {
    expect(acceptedToastFor("task")).toBe(m["proposals.accepted.toast"]);
  });

  it("maps a contact_field proposal to its OWN toast, not the task one (mutation: collapse acceptedToastFor to always return proposals.accepted.toast -> FAILS)", () => {
    expect(acceptedToastFor("contact_field")).toBe(m["proposals.accepted.contactField.toast"]);
    expect(acceptedToastFor("contact_field")).not.toBe(m["proposals.accepted.toast"]);
  });

  it("maps an opportunity_stage proposal to its OWN toast, not the task one (mutation: collapse acceptedToastFor to always return proposals.accepted.toast -> FAILS)", () => {
    expect(acceptedToastFor("opportunity_stage")).toBe(m["proposals.accepted.stage.toast"]);
    expect(acceptedToastFor("opportunity_stage")).not.toBe(m["proposals.accepted.toast"]);
  });
});
