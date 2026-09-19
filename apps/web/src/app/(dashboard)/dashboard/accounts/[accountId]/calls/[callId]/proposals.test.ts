import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CallProposal, ProposalStatus } from "@bis/db";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { CallProposals, type ResolvedStage } from "./proposals";

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

function render(proposals: CallProposal[], stageNames: Record<string, ResolvedStage> = {}): string {
  return renderToStaticMarkup(
    CallProposals({ proposals, accountId: "acct1", callId: "call1", stageNames }),
  );
}

describe("CallProposals", () => {
  it("renders nothing at all when there are no proposals (mutation: return the section unconditionally -> FAILS)", () => {
    expect(render([])).toBe("");
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

  it("prefixes and visually quotes the evidence (mutation: drop the m[\"proposals.evidence\"] prefix -> FAILS)", () => {
    const html = render([taskProposal({ evidence: "Call me back Tuesday please" })]);
    const text = renderedText(html);
    expect(text).toContain(m["proposals.evidence"]);
    expect(text).toContain("Call me back Tuesday please");
    // Visually quoted with a real <q>, not a plain <p> — the quoting has to
    // be structural, not just adjacent text that happens to look quoted.
    expect(html).toMatch(/<q\b[^>]*>Call me back Tuesday please<\/q>/);
  });

  it("clamps a long evidence turn instead of letting it blow out the card (mutation: remove line-clamp-4 -> FAILS)", () => {
    // 483 characters — the measured MAX for a whole caller turn, a real case
    // per the brief, not a hypothetical.
    const longEvidence = "We need someone to come look at the roof because ".repeat(10).slice(0, 483);
    expect(longEvidence).toHaveLength(483);
    const html = render([taskProposal({ evidence: longEvidence })]);
    expect(html).toMatch(/<q\b[^>]*\bclass="[^"]*\bline-clamp-4\b[^"]*"/);
  });

  it("renders a task proposal in plain language, not the raw payload (mutation: interpolate the payload object directly -> FAILS)", () => {
    const html = render([taskProposal({ title: "Call back about the quote" })]);
    expect(renderedText(html)).toContain("Add a task: Call back about the quote");
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

  it("says so in words when a stage move skips more than one position (mutation: delete the skip note -> FAILS)", () => {
    const html = render(
      [stageProposal("s0", "s3")],
      {
        s0: { name: "New", position: 0 },
        // Bypasses positions 1 and 2 — two stages, which is "more than one".
        s3: { name: "Won", position: 3 },
      },
    );
    expect(renderedText(html)).toContain("This skips 2 stages in between.");
  });

  it("says nothing extra for a move that bypasses only ONE stage (mutation: lower the skip threshold to >0 -> FAILS)", () => {
    const html = render(
      [stageProposal("s0", "s2")],
      {
        s0: { name: "New", position: 0 },
        // Bypasses only position 1 — one stage, not "more than one".
        s2: { name: "Won", position: 2 },
      },
    );
    expect(renderedText(html)).not.toContain("skips");
  });

  it("skips a stage proposal whose stage names failed to resolve, rather than showing the raw id or the destination alone (mutation: fall back to the raw uuid -> FAILS)", () => {
    // No stageNames supplied at all — page.tsx's best-effort read came back
    // empty. The ONLY proposal is the unresolvable one, so the whole section
    // must be absent, not a heading over a proposal it cannot describe.
    const html = render([stageProposal("stage-a", "stage-b")], {});
    expect(html).toBe("");
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
