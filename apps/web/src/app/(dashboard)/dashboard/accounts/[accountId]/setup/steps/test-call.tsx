import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { testCallNoteKind } from "@/lib/setup/setup-view";
import { SetupEnableTestCallsButton } from "../setup-enable-test-calls-button";
import { NumberChip, NumberStatusChip, type StepDetailProps } from "./step-shared";

export function TestCallStep({
  base, assignedNumber, hasVoiceProfile, enableTestCallsAction,
}: StepDetailProps): React.ReactNode {
  const rows: React.ReactNode[] = [];
  let note: React.ReactNode = null;

  // The actual number, or null for BOTH "no number yet" and "couldn't
  // check" — collapsed here because every chip site below already renders
  // nothing for null, which is the right behaviour for "couldn't check" too.
  // Only the forwarding card's `note` (forwarding.tsx) needs to tell the two
  // apart, so it reads `assignedNumber` directly rather than this narrowed
  // value.
  const number = assignedNumber === "unknown" ? null : assignedNumber;

  if (number) {
    // No `unshift` needed here (unlike the number step below): the
    // test-call card has no "Open" link, so `rows` is still empty.
    rows.push(
      <NumberChip key="e164" e164={number.e164} />,
      <NumberStatusChip key="status" status={number.status} />,
    );
    // Which note (if any) and which flavour of button — see
    // testCallNoteKind (setup-view.ts) for why `hasVoiceProfile` decides
    // this alongside status, not status alone: the exit-gate finding this
    // fixes is exactly a card that used to answer this question from
    // status only, and could be flipped-but-not-answering as a result.
    const noteKind = testCallNoteKind(number.status, hasVoiceProfile);
    if (noteKind === "enable") {
      note = m["setup.testCall.provisionedNote"];
      rows.push(
        <SetupEnableTestCallsButton
          key="enable"
          action={enableTestCallsAction}
          phoneNumberId={number.id}
        />,
      );
    } else if (noteKind === "needsProfile") {
      note = m["setup.testCall.needsProfileNote"];
      // Only for `provisioned`: a `testing` number reaching this branch is
      // already flipped — pressing the button again would just resubmit
      // the same status, so there is nothing useful for it to do here.
      if (number.status === "provisioned") {
        rows.push(
          <SetupEnableTestCallsButton
            key="enable"
            action={enableTestCallsAction}
            phoneNumberId={number.id}
            disabled
          />,
        );
      }
    } else if (noteKind === "testing") {
      note = m["setup.testCall.testingNote"];
    }
  }
  rows.push(
    <Link
      key="calls"
      href={`${base}/calls`}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
    >
      {m["setup.viewCalls"]}
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>,
  );

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
