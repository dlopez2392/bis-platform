import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { SetupMoveNumberButton } from "../setup-move-number-button";
import {
  NumberChip, NumberStatusChip, NUMBER_STATUS_LABEL, type MovableNumber,
  type SetupMoveNumberAction, type StepDetailProps,
} from "./step-shared";

/** The offer on the number step when this account has none of its own: every
 *  number that lives on another account, with whose it is and what it is
 *  currently doing, so an operator cannot take a live line out from under
 *  another client without seeing that is what they are doing. Buying a fresh
 *  number stays the primary path — it is the card's own help text and its
 *  "Open" link to the Voice page; this is the alternative underneath. */
function MovableNumbers({
  numbers, moveAction,
}: {
  numbers: MovableNumber[];
  moveAction: SetupMoveNumberAction;
}) {
  return (
    // Ladder step 2, the nested-panel step — this sits inside the wizard's
    // detail pane, so it takes no card material and no alpha of --muted.
    <div className="rounded-[8px] border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <p className="text-xs font-medium text-muted-foreground">{m["setup.number.moveTitle"]}</p>
      <ul className="mt-1 divide-y divide-border">
        {numbers.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <NumberChip e164={n.e164} />
              <p className="mt-1 text-xs text-muted-foreground">
                {m["setup.number.currentlyOn"].replace(
                  "{account}",
                  n.accountName ?? m["setup.number.unknownAccount"],
                )}
                {" · "}
                {NUMBER_STATUS_LABEL[n.status]}
              </p>
            </div>
            <SetupMoveNumberButton
              action={moveAction}
              phoneNumberId={n.id}
              e164={n.e164}
              status={n.status}
              accountName={n.accountName}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NumberStep({
  kind, href, assignedNumber, movableNumbers, moveNumberAction,
}: StepDetailProps): React.ReactNode {
  const rows: React.ReactNode[] = [];
  let panel: React.ReactNode = null;

  // The actual number, or null for BOTH "no number yet" and "couldn't
  // check" — collapsed here because every chip site below already renders
  // nothing for null, which is the right behaviour for "couldn't check" too.
  // Only the forwarding card's `note` (forwarding.tsx) needs to tell the two
  // apart, so it reads `assignedNumber` directly rather than this narrowed
  // value.
  const number = assignedNumber === "unknown" ? null : assignedNumber;

  // A finished step keeps its door — the agency still edits branding and
  // hours long after setup — but it stops shouting: ghost rather than
  // outline, so the eye lands on the step that still needs doing.
  if (href) {
    rows.push(
      <Link
        key="open"
        href={href}
        className={cn(
          buttonVariants({ variant: kind === "done" ? "ghost" : "outline", size: "sm" }),
        )}
      >
        {m["setup.openStep"]}
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>,
    );
  }

  if (number) {
    rows.unshift(<NumberChip key="e164" e164={number.e164} />);
    rows.push(<NumberStatusChip key="status" status={number.status} />);
  } else if (assignedNumber === null && movableNumbers.length > 0) {
    // Only when the read actually answered "none". Offering to move a
    // number into an account that may already have one — which is what
    // `assignedNumber === "unknown"` means — is how a live line gets
    // stolen from the tenant next door to fix a problem that isn't there.
    panel = <MovableNumbers numbers={movableNumbers} moveAction={moveNumberAction} />;
  }

  if (rows.length === 0 && panel === null) return null;

  return (
    <div className="mt-3 space-y-2">
      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">{rows}</div>
      ) : null}
      {panel}
    </div>
  );
}
