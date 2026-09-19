// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/proposals.tsx
//
// Call Proposals Task 7 — the block where a human reads a machine-suggested
// next step next to the caller's own words that caused it, and accepts or
// dismisses it. THE PRIMARY REVIEW SURFACE: page.tsx places this section
// immediately before the transcript, so the evidence quoted here is checked
// against real text a few inches down, not taken on faith.
//
// A pure presentational server component: every read (`listProposalsForCall`,
// the pipeline_stages name lookup) happens in page.tsx, best-effort, exactly
// like the text-back panel above it — this file never touches the database.
import type { CallProposal, ContactFieldPayload, ProposalKind, ProposalStatus } from "@bis/db";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { m, type MessageKey } from "@/lib/messages";
import { acceptProposal, dismissProposal } from "./actions";
import { ProposalActions } from "./proposal-actions";

// Mirrors page.tsx's own CARD/CARD_HEAD (`page.tsx:36`, `:41-42`) rather than
// importing them: page.tsx already imports THIS module for `CallProposals`,
// and importing the two constants back would make the pair a circular
// module dependency with no precedent anywhere else in this route tree. Same
// shape, same reason `neutral-ramps.ts`'s `SIDEBAR_FOREGROUND` mirrors
// globals.css's sidebar island instead of importing it — change one, change
// the other.
const CARD = "overflow-hidden rounded-xl border border-border bg-card glass";
const CARD_HEAD =
  "border-b border-[var(--row-line)] px-5 py-3 font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase";

/** What page.tsx resolves `fromStageId`/`toStageId` to before this component
 *  ever sees them — the payload only carries uuid FKs into `pipeline_stages`,
 *  which this component has no database access of its own to read. */
export type ResolvedStage = { name: string; position: number };

const FIELD_LABEL_KEY: Record<ContactFieldPayload["field"], MessageKey> = {
  firstName: "contacts.firstName", lastName: "contacts.lastName",
  email: "contacts.email", phone: "contacts.phone",
};

/**
 * DESIGN.md rule 3 (status is never colour alone) applied the same shape
 * `work-list.tsx`'s `BUCKET_TREATMENT` uses — its own map plus
 * `Badge variant="chip"` — not `OutcomePill`, which is keyed to `CallOutcome`,
 * a different domain. `pending` borrows the "still open, wants a decision"
 * treatment `format.ts`'s `OUTCOMES.lead` already uses; `accepted` borrows
 * `OUTCOMES.booked`'s success treatment; `dismissed` borrows
 * `OUTCOMES.abandoned`'s receded, inactive one — a decided proposal has
 * nothing further to do, same as an abandoned call.
 */
const STATUS_TREATMENT: Record<ProposalStatus, { dot: string; chip: string; labelKey: MessageKey }> = {
  pending: {
    dot: "bg-primary",
    chip: "border-primary/30 bg-primary/5 text-foreground",
    labelKey: "proposals.status.pending",
  },
  accepted: {
    dot: "bg-success",
    chip: "border-success/30 bg-success/10 text-foreground",
    labelKey: "proposals.status.accepted",
  },
  dismissed: {
    dot: "bg-muted-foreground/60",
    chip: "border-border bg-transparent text-muted-foreground",
    labelKey: "proposals.status.dismissed",
  },
};

/**
 * The success toast's own text is KIND-specific: "Added to your to-do list"
 * is true of a `task` proposal and false of the other two — accepting a
 * `contact_field` proposal fills in a contact, and an `opportunity_stage`
 * one moves a card on the board, neither of which lands on a to-do list.
 * Reporting the wrong one is exactly the false confirmation copy DESIGN.md's
 * "landscaper at 7am" read rules out.
 */
function acceptedToastFor(kind: ProposalKind): string {
  if (kind === "task") return m["proposals.accepted.toast"];
  if (kind === "contact_field") return m["proposals.accepted.contactField.toast"];
  return m["proposals.accepted.stage.toast"];
}

type Entry = { id: string; status: ProposalStatus; label: string; evidence: string; kind: ProposalKind };

/**
 * The proposal's own plain-language sentence, or `null` for an
 * `opportunity_stage` proposal whose `fromStageId`/`toStageId` failed to
 * resolve to a name (page.tsx's best-effort stage read came back short for
 * just this pair, not necessarily the whole call). Never falls back to the
 * raw uuid or to the destination alone — DESIGN.md's explicit rule for this
 * kind — so a proposal this render cannot describe honestly is skipped
 * instead of shown broken.
 *
 * `.replace(..., () => x)` for every interpolated value that did not
 * originate as a static label: a task title and a contact-field value both
 * come from the model's read of a caller's own words, and `String.replace`
 * treats a string pattern specially (`$&`, `$1`…) — the same reason
 * `work-list.tsx`'s `primaryLabel` uses a replacer function for a contact's
 * name instead of the two-argument form.
 */
function buildLabel(p: CallProposal, stages: Record<string, ResolvedStage>): string | null {
  if (p.kind === "task") {
    return m["proposals.task.label"].replace("{title}", () => p.payload.title);
  }
  if (p.kind === "contact_field") {
    const fieldLabel = m[FIELD_LABEL_KEY[p.payload.field]].toLowerCase();
    return m["proposals.contactField.label"]
      .replace("{field}", () => fieldLabel)
      .replace("{value}", () => p.payload.value);
  }
  // opportunity_stage — from -> to BY NAME, never the destination alone.
  const from = stages[p.payload.fromStageId];
  const to = stages[p.payload.toStageId];
  if (!from || !to) return null;
  let label = m["proposals.stage.label"]
    .replace("{from}", () => from.name)
    .replace("{to}", () => to.name);
  // "Skips MORE than one position" (the brief's own wording): the count of
  // stages the move bypasses is `|delta| - 1` — a move to the very next or
  // previous stage bypasses zero, a move that jumps one stage over bypasses
  // exactly one, and only a bypass of two or more says so out loud. A single
  // bypassed stage is common enough on its own (a customer who books
  // directly skips "Contacted") not to warrant a note every time.
  const bypassed = Math.abs(to.position - from.position) - 1;
  if (bypassed > 1) {
    label += " " + m["proposals.stage.skip"].replace("{n}", String(bypassed));
  }
  return label;
}

function buildEntry(p: CallProposal, stages: Record<string, ResolvedStage>): Entry | null {
  const label = buildLabel(p, stages);
  if (label === null) return null;
  return { id: p.id, status: p.status, label, evidence: p.evidence, kind: p.kind };
}

export function CallProposals({
  proposals, accountId, callId, stageNames,
}: {
  proposals: CallProposal[];
  accountId: string;
  callId: string;
  /** stage id -> resolved name/position, built by page.tsx's best-effort
   *  pipeline_stages read. Only ever non-empty when at least one proposal is
   *  `opportunity_stage`. */
  stageNames: Record<string, ResolvedStage>;
}) {
  const entries = proposals
    .map((p) => buildEntry(p, stageNames))
    .filter((e): e is Entry => e !== null);

  // "A heading over nothing reads as a summary that said nothing" — page.tsx's
  // own words for the Summary section above this one, applied here: a call
  // with zero proposals (or whose only proposals are stage moves this render
  // could not describe honestly) gets no section at all, not an empty one.
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="call-proposals" className={CARD}>
      <h2 id="call-proposals" className={CARD_HEAD}>{m["proposals.heading"]}</h2>
      <p className="px-5 pt-3 text-sm text-muted-foreground">{m["proposals.subhead"]}</p>
      <div className="divide-y divide-[var(--row-line)]">
        {entries.map((entry) => {
          const treatment = STATUS_TREATMENT[entry.status];
          return (
            <div key={entry.id} className="flex flex-col gap-2.5 p-5">
              <Badge variant="chip" className={cn("w-fit gap-1.5 py-1 pr-2.5 pl-2", treatment.chip)}>
                <span className={cn("size-[7px] rounded-full", treatment.dot)} aria-hidden />
                {m[treatment.labelKey]}
              </Badge>
              <p className="text-sm leading-6 text-foreground">{entry.label}</p>
              {/* Measured live at a mean of 57 characters, p95 473, max 483 —
                  a whole caller turn, not a snippet, so a paragraph in this
                  card is the ordinary case to design for, not a hypothetical
                  one. `line-clamp-4` keeps a long one from taking over the
                  card; the full turn is always readable in the transcript
                  directly below (page.tsx places this section right before
                  it). */}
              <p className="text-sm leading-6 text-muted-foreground">
                {m["proposals.evidence"]}{" "}
                <q className="line-clamp-4 text-foreground italic">{entry.evidence}</q>
              </p>
              {/* Already-decided proposals (accepted/dismissed) show their
                  status chip and nothing else — acting on one again would
                  only reach `acceptProposal`/`dismissProposal`'s own
                  compare-and-swap refusal ("Someone already answered this
                  one."), a guaranteed-failure affordance worth not offering. */}
              {entry.status === "pending" ? (
                <ProposalActions
                  proposalId={entry.id}
                  acceptProposal={acceptProposal.bind(null, accountId, callId)}
                  dismissProposal={dismissProposal.bind(null, accountId, callId)}
                  acceptedToast={acceptedToastFor(entry.kind)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
