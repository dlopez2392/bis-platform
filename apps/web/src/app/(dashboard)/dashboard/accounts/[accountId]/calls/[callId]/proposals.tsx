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
import { formatDateInZone } from "@/lib/format";
import { m, type MessageKey } from "@/lib/messages";
import { acceptProposal, dismissProposal } from "./actions";
import { ProposalActions } from "./proposal-actions";
import { CARD, CARD_HEAD } from "./card";

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
 *
 * Exported so the styleguide's "Proposal status" section reads the three
 * treatments straight off this map — the same precedent
 * `../screened/screened-table.tsx`'s `CLASS_DOT` sets — rather than a second
 * copy that could drift from the real block.
 */
export const STATUS_TREATMENT: Record<ProposalStatus, { dot: string; chip: string; labelKey: MessageKey }> = {
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
export function acceptedToastFor(kind: ProposalKind): string {
  if (kind === "task") return m["proposals.accepted.toast"];
  if (kind === "contact_field") return m["proposals.accepted.contactField.toast"];
  return m["proposals.accepted.stage.toast"];
}

type Entry = {
  id: string; status: ProposalStatus; label: string; evidence: string; kind: ProposalKind;
  /** A `task` proposal's own `dueAt`, already formatted in the account's
   *  zone — `null` for every other kind (they carry no due date) and for a
   *  `task` proposal whose `dueAt` is itself `null` (`generate.ts`'s own
   *  forward-window check already rejected anything a human should not see
   *  as a real date, so nothing here re-validates it — see this file's own
   *  doc on that rejection). */
  dueAtText: string | null;
};

/**
 * Fix-wave Important 1: a machine-chosen due date must be VISIBLE on the
 * review card BEFORE a human accepts it — the half of the fix a reader can
 * check with their own eyes, alongside `generate.ts`'s own forward-window
 * rejection of a due date that could never be real. Degrades to no date text
 * (never a crash, never a raw UTC guess) on an unparseable instant, the same
 * `RangeError`-only catch every other date-in-zone render in this app uses
 * (`work-list.tsx`'s own `rowDateText`) — `dueAt` already passed
 * `generate.ts`'s own `Date.parse` guard before it was ever stored, so this
 * is defense in depth, not a path expected to trigger.
 */
function dueAtText(dueAt: string | null, timezone: string): string | null {
  if (!dueAt) return null;
  try {
    return formatDateInZone(dueAt, timezone);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return null;
  }
}

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
  // "No stage is skipped silently" (DESIGN's own topic sentence for this
  // feature): the count of stages the move bypasses is `|delta| - 1` — a
  // move to the very next or previous stage bypasses zero and says nothing
  // extra, but ANY bypass of one or more stages speaks up, forward or
  // backward (`Math.abs`, not the raw signed delta — a backward move must
  // warn exactly as loudly as the equivalent forward one). New(0) ->
  // Appointment(2) bypasses exactly one stage ("Contacted") and is the
  // single most likely proposal this feature will ever produce, so a
  // threshold that stayed silent for it would defeat the rule it exists to
  // serve.
  const bypassed = Math.abs(to.position - from.position) - 1;
  if (bypassed === 1) {
    label += " " + m["proposals.stage.skip.one"];
  } else if (bypassed > 1) {
    label += " " + m["proposals.stage.skip.many"].replace("{n}", String(bypassed));
  }
  return label;
}

function buildEntry(p: CallProposal, stages: Record<string, ResolvedStage>, timezone: string): Entry | null {
  const label = buildLabel(p, stages);
  if (label === null) return null;
  return {
    id: p.id, status: p.status, label, evidence: p.evidence, kind: p.kind,
    dueAtText: p.kind === "task" ? dueAtText(p.payload.dueAt, timezone) : null,
  };
}

export function CallProposals({
  proposals, accountId, callId, stageNames, timezone,
}: {
  proposals: CallProposal[];
  accountId: string;
  callId: string;
  /** stage id -> resolved name/position, built by page.tsx's best-effort
   *  pipeline_stages read. Only ever non-empty when at least one proposal is
   *  `opportunity_stage`. */
  stageNames: Record<string, ResolvedStage>;
  /** The account's own resolved zone (page.tsx's `renderZone`), the same
   *  value the transcript timestamps just below this section are formatted
   *  in — a machine-chosen due date must read in the SAME zone as everything
   *  else on this page, never the raw UTC instant `tasks.due_at` stores. */
  timezone: string;
}) {
  const entries = proposals
    .map((p) => buildEntry(p, stageNames, timezone))
    .filter((e): e is Entry => e !== null);

  // `listProposalsForCall` orders by created_at DESC — insert order, since
  // every proposal for a call is generated in one batch — so without this a
  // row that still needs a decision could sit under ones that need
  // nothing. This block exists to obtain a decision, so pending goes first;
  // `Array.prototype.sort` is stable, so relative order is otherwise
  // preserved.
  entries.sort((a, b) => Number(a.status !== "pending") - Number(b.status !== "pending"));

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
              {/* No `w-fit` here — `badgeVariants`'s own base classes already
                  carry it (components/ui/badge.tsx); repeating it was a
                  no-op. */}
              <Badge variant="chip" className={cn("gap-1.5 py-1 pr-2.5 pl-2", treatment.chip)}>
                <span className={cn("size-[7px] rounded-full", treatment.dot)} aria-hidden />
                {m[treatment.labelKey]}
              </Badge>
              <p className="text-sm leading-6 text-foreground">{entry.label}</p>
              {/* Fix-wave Important 1: rendered only when generate.ts's own
                  forward-window check left a real dueAt on this proposal —
                  the human accepting it must be able to SEE what they are
                  accepting, in the account's own zone, before they click. */}
              {entry.dueAtText ? (
                <p className="text-xs text-muted-foreground">
                  {m["proposals.task.due"].replace("{date}", () => entry.dueAtText!)}
                </p>
              ) : null}
              {/* NEVER CLAMPED. Measured against calls that can actually
                  produce a proposal (booked/lead/message — the only outcomes
                  `eligibility.ts` allows through): 231 eligible turns, mean
                  33 characters, p95 85, max 95 — one line at any card width
                  today. The much larger figure once cited here ("mean 57,
                  p95 473, max 483") was measured across ALL caller turns,
                  but every turn over 200 characters in this database is the
                  same robocall script on a spam/abandoned call, a shape this
                  component never receives. If real turns ever lengthen past
                  one line, add an expand affordance rather than a silent
                  clip — evidence is a whole caller turn precisely so a
                  reader can see a negation or a late qualifier ("…but not on
                  Tuesday") that a substring match further up the pipeline
                  cannot see, and a CSS clamp with no `title` would recreate
                  that same blind spot at the display layer. (A clamp would
                  also be broken on its own terms here: `line-clamp-*` forces
                  `display:-webkit-box`, which turns the inline `<q>` into a
                  block, breaks the `{" "}` separator between the prefix and
                  the quote, and clips the closing curly quote the UA draws
                  for `<q>` — the truncated case rendered an opening quote
                  with no closing one.) */}
              <p className="text-sm leading-6 text-muted-foreground">
                {m["proposals.evidence"]}{" "}
                <q className="text-foreground">{entry.evidence}</q>
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
