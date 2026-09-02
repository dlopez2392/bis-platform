import { m } from "@/lib/messages";
import { SetupTickButton } from "../setup-tick-button";
import { NumberChip, type StepDetailProps } from "./step-shared";

export function ForwardingStep({
  step, kind, assignedNumber, tickAction,
}: StepDetailProps): React.ReactNode {
  const rows: React.ReactNode[] = [];
  let note: React.ReactNode = null;

  // The actual number, or null for BOTH "no number yet" and "couldn't
  // check" — collapsed here because every chip site below already renders
  // nothing for null, which is the right behaviour for "couldn't check" too.
  // Only the forwarding card's `note` below needs to tell the two apart, so
  // it reads `assignedNumber` directly rather than this narrowed value.
  const number = assignedNumber === "unknown" ? null : assignedNumber;
  const e164 = number?.e164 ?? null;

  if (assignedNumber === "unknown") {
    // Distinct from the no-number case below: telling the operator to go
    // "assign a number first" would be wrong here — one may well already
    // be assigned, the numbers read just didn't answer this render.
    note = m["setup.step.forwarding.unknownNumber"];
  } else if (e164) {
    rows.unshift(<NumberChip key="e164" e164={e164} />);
  } else {
    // The help copy says "the number below" — when there is no number
    // below, saying so is the whole content of this card.
    note = m["setup.step.forwarding.noNumber"];
  }
  // Suppressed while the tick's own read is unknown: the button's label and
  // the value it would write are both read off a state we do not have.
  if (kind !== "unknown") {
    rows.push(
      <SetupTickButton
        key="tick"
        action={tickAction}
        tick="forwardingDone"
        done={!step.done}
        label={step.done ? m["setup.step.forwarding.untick"] : m["setup.step.forwarding.tick"]}
      />,
    );
  }

  if (rows.length === 0 && note === null) return null;

  return (
    <div className="mt-3 space-y-2">
      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">{rows}</div>
      ) : null}
      {note !== null ? <p className="text-sm text-muted-foreground">{note}</p> : null}
    </div>
  );
}
