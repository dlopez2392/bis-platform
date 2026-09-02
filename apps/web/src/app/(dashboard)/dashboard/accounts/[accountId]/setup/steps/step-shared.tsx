import type { PhoneNumberStatus } from "@bis/db";
import type { SetupStepKey } from "@/lib/setup/setup-status";
import type { SetupStepView, StateKind, AssignedNumber } from "@/lib/setup/setup-view";
import { m } from "@/lib/messages";

// Types, maps and tiny presentational helpers shared by more than one step
// module (moved out of setup-panel.tsx, Design Phase 5 Task 3 — see that
// file's own doc comment for the wizard's overall design argument). Nothing
// here is new: every export below is verbatim from the single-file version,
// split out so each step's detail can live in its own module.

export type SetupTick = "emailSkipped" | "forwardingDone";
export type SetupTickAction = (tick: SetupTick, done: boolean) => Promise<{ ok: boolean }>;

type ActionResult = { ok: true } | { ok: false; error: string };
/** accountId already bound server-side — it must never travel as an argument
 *  from the browser. */
export type SetupGoLiveAction = () => Promise<ActionResult>;
/** Likewise: the caller picks WHICH number, never which account receives it. */
export type SetupMoveNumberAction = (phoneNumberId: string) => Promise<ActionResult>;
/** `setNumberStatusAction` (voice/actions.ts) with `accountId` already bound
 *  server-side, same reasoning as the two above — only WHICH number and WHAT
 *  status travel from the browser. Used today for exactly one status value:
 *  the enable-test-calls button always calls it with `"testing"`. */
export type SetNumberStatusAction = (phoneNumberId: string, status: string) => Promise<ActionResult>;

/** A number sitting on some other account that this one could take over.
 *  `accountName` is null when the join to `accounts` came back empty. */
export type MovableNumber = {
  id: string;
  e164: string;
  status: PhoneNumberStatus;
  accountName: string | null;
};

/** Status shown beside every movable number, using the Voice page's own
 *  labels. Not decoration: "Live" here means some other client's callers are
 *  reaching that line right now, and one click would take it away from them.
 *  The operator has to be able to see that before they press. */
export const NUMBER_STATUS_LABEL: Record<PhoneNumberStatus, string> = {
  provisioned: m["voice.numbers.status.provisioned"],
  testing: m["voice.numbers.status.testing"],
  live: m["voice.numbers.status.live"],
  released: m["voice.numbers.status.released"],
};

export const STEP_COPY: Record<SetupStepKey, { title: string; help: string }> = {
  account: { title: m["setup.step.account.title"], help: m["setup.step.account.help"] },
  branding: { title: m["setup.step.branding.title"], help: m["setup.step.branding.help"] },
  hours: { title: m["setup.step.hours.title"], help: m["setup.step.hours.help"] },
  voice_profile: {
    title: m["setup.step.voice_profile.title"], help: m["setup.step.voice_profile.help"],
  },
  number: { title: m["setup.step.number.title"], help: m["setup.step.number.help"] },
  email: { title: m["setup.step.email.title"], help: m["setup.step.email.help"] },
  forwarding: { title: m["setup.step.forwarding.title"], help: m["setup.step.forwarding.help"] },
  test_call: { title: m["setup.step.test_call.title"], help: m["setup.step.test_call.help"] },
  go_live: { title: m["setup.step.go_live.title"], help: m["setup.step.go_live.help"] },
};

/** Where the work for a step actually happens. `?from=setup` is what makes
 *  the target page render its BackToSetup breadcrumb — a one-way trip into a
 *  settings screen is how a guided flow loses people. */
export const STEP_PATH: Partial<Record<SetupStepKey, string>> = {
  branding: "/branding?from=setup",
  hours: "/calendar?from=setup",
  voice_profile: "/voice?from=setup",
  number: "/voice?from=setup",
  email: "/settings?from=setup",
};

export const TONE: Record<StateKind, { marker: string; card: string; chip: string; dot: string }> = {
  done: {
    marker: "border-success/40 bg-success/10 text-success",
    card: "border-border bg-card",
    chip: "border-success/30 bg-success/10 text-foreground",
    dot: "bg-success",
  },
  open: {
    marker: "border-border bg-card text-muted-foreground",
    card: "border-border bg-card",
    chip: "border-border bg-transparent text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
  // The single ringed card. Same content as `open` — only the emphasis
  // differs, because it is the same kind of work, just the piece to do now.
  next: {
    marker: "border-primary bg-primary/10 text-primary",
    card: "border-primary/40 bg-card shadow-sm ring-1 ring-primary/15",
    chip: "border-border bg-transparent text-muted-foreground",
    dot: "bg-primary",
  },
  skipped: {
    marker: "border-dashed border-border bg-muted text-muted-foreground",
    card: "border-dashed border-border bg-card",
    chip: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/40",
  },
  unknown: {
    marker: "border-dashed border-warning/50 bg-warning/10 text-warning",
    card: "border-warning/40 bg-warning/5",
    chip: "border-warning/40 bg-warning/10 text-foreground",
    dot: "bg-warning",
  },
};

/** The number the carrier forwards to and the number a test call dials.
 *  Monospaced and selectable — it gets read down a phone line and typed into
 *  someone else's carrier portal. */
export function NumberChip({ e164 }: { e164: string }) {
  return (
    <code className="rounded-md border border-border bg-muted/60 px-2 py-1 font-mono text-xs text-foreground tabular-nums">
      {e164}
    </code>
  );
}

/** The assigned number's status, beside its chip on the number and test-call
 *  cards (the two the wizard's exit gate found operators needed it on). Same
 *  labels the Voice page and the movable-numbers list already use — never a
 *  new vocabulary for the same four values. */
export function NumberStatusChip({ status }: { status: PhoneNumberStatus }) {
  return (
    <span className="text-xs text-muted-foreground">{NUMBER_STATUS_LABEL[status]}</span>
  );
}

/** The full prop bag every step's detail module receives — the same bag
 *  `StepActions` took as one function before this split (setup-panel.tsx
 *  passes it to whichever module `STEP_DETAIL[step.key]` resolves to). Each
 *  module destructures only the fields its own step actually uses. */
export type StepDetailProps = {
  step: SetupStepView;
  kind: StateKind;
  base: string;
  href: string | null;
  assignedNumber: AssignedNumber | null | "unknown";
  movableNumbers: MovableNumber[];
  hasVoiceProfile: boolean;
  tickAction: SetupTickAction;
  goLiveAction: SetupGoLiveAction;
  moveNumberAction: SetupMoveNumberAction;
  enableTestCallsAction: SetNumberStatusAction;
  prereqsMet: boolean;
  blockedReason: string | null;
};
