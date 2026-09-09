import { Fragment } from "react";
import { Rocket } from "lucide-react";
import type { SetupStepKey } from "@/lib/setup/setup-status";
import { GO_LIVE_PREREQ_KEYS, kindOf, type SetupStepView, type AssignedNumber } from "@/lib/setup/setup-view";
import { nextStepKey } from "@/lib/setup/setup-rail";
import { cn } from "@/lib/utils";
import { Meter } from "@/components/meter";
import { m } from "@/lib/messages";
import {
  STEP_COPY, STEP_PATH, type StepDetailProps,
  type SetupTick, type SetupTickAction, type SetupGoLiveAction, type SetupMoveNumberAction,
  type SetNumberStatusAction, type MovableNumber, type SetupRenameAction,
} from "./steps/step-shared";
import { AccountStep } from "./steps/account";
import { BrandingStep } from "./steps/branding";
import { HoursStep } from "./steps/hours";
import { VoiceProfileStep } from "./steps/voice-profile";
import { NumberStep } from "./steps/number";
import { EmailStep } from "./steps/email";
import { ForwardingStep } from "./steps/forwarding";
import { TestCallStep } from "./steps/test-call";
import { GoLiveStep } from "./steps/go-live";
import { SetupShell } from "./setup-shell";

/**
 * The wizard, as a two-pane shell rather than nine cards.
 *
 * This file's own job shrank twice now. Design Phase 5 Task 3 split each
 * step's detail (rows/note/panel) out into its own module under ./steps/,
 * leaving this file as the shell: the progress meter, the rail of nine
 * cards, and the `STEP_DETAIL` lookup. Task 4 (this change) replaces the
 * "rail of nine cards" with the real two-pane wizard DESIGN.md calls for —
 * a stepper rail (./setup-rail.tsx) plus ONE step's detail pane
 * (./setup-shell.tsx) — because a long single-column scroll of nine cards
 * is not that; see the mockup notes in docs/design/bis-design-direction.html
 * for the full argument.
 *
 * What stays server-side, unchanged from before: everything here is still
 * computed once, from props already in hand, with no client round trip.
 * Only WHICH of the nine pre-rendered nodes gets placed into the DOM is a
 * client decision now (./setup-shell.tsx) — the nodes themselves, and every
 * write action bound to them, are exactly what this file already built.
 */

// Re-exported so the four write-islands (setup-tick-button.tsx,
// setup-go-live-button.tsx, setup-move-number-button.tsx,
// setup-enable-test-calls-button.tsx) and page.tsx keep importing these
// types from "./setup-panel" unchanged — their actual definitions now live
// in ./steps/step-shared.ts, declared once alongside StepDetailProps.
export type {
  SetupTick, SetupTickAction, SetupGoLiveAction, SetupMoveNumberAction,
  SetNumberStatusAction, MovableNumber, SetupRenameAction,
};

/** Which module renders a given step's rows/note/panel — one entry per
 *  `SetupStepKey`, in the same order the wizard walks them. */
const STEP_DETAIL: Record<SetupStepKey, (p: StepDetailProps) => React.ReactNode> = {
  account: AccountStep,
  branding: BrandingStep,
  hours: HoursStep,
  voice_profile: VoiceProfileStep,
  number: NumberStep,
  email: EmailStep,
  forwarding: ForwardingStep,
  test_call: TestCallStep,
  go_live: GoLiveStep,
};

export function SetupPanel({
  accountId, steps, prereqsMet, assignedNumber, movableNumbers, hasVoiceProfile, accountName,
  tickAction, goLiveAction, moveNumberAction, enableTestCallsAction, renameAction,
}: {
  accountId: string;
  steps: SetupStepView[];
  /** From `goLivePrereqsMet`, narrowed by the page so an unverifiable
   *  prerequisite also counts as unmet. Gates the go-live button's `disabled`
   *  and nothing else — the action re-derives all of this from live rows at
   *  click time, which is where the rule is actually enforced. */
  prereqsMet: boolean;
  /** First non-released number on the account, WITH its status; `null` if
   *  there genuinely is none yet; `"unknown"` if the numbers read itself
   *  failed — a third state so the forwarding card can't mistake a failed
   *  read for "go assign a number", which is what a plain `null` would look
   *  like from here. What the client's carrier forwards to and what a test
   *  call dials. */
  assignedNumber: AssignedNumber | null | "unknown";
  /** Other accounts' numbers, offered on the number step when this account
   *  has none. Empty when it already has one, when the cross-account read
   *  failed, or when there is genuinely nothing to move. */
  movableNumbers: MovableNumber[];
  /** Whether a `voice_profiles` row exists for this account at all —
   *  existence, not completeness: `voiceProfileDone` (setup-status.ts) also
   *  requires a greeting and facts, but `callAnswerable` (accept-gate.ts)
   *  declines on `profile === null` alone, so that is the exact question the
   *  test-call card needs answered (`testCallNoteKind`, setup-view.ts). `false`
   *  when the profile read itself failed (page.tsx) — the same direction
   *  every other unverifiable-prerequisite case on this page already takes,
   *  since a card that can't confirm a profile exists must not offer a
   *  button that promises the number will answer. */
  hasVoiceProfile: boolean;
  /** The agency's internal label for this client (`accounts.name`) — read
   *  by the account step's rename control alone; the page header (page.tsx)
   *  reads it separately for its own display. */
  accountName: string | null;
  tickAction: SetupTickAction;
  goLiveAction: SetupGoLiveAction;
  moveNumberAction: SetupMoveNumberAction;
  enableTestCallsAction: SetNumberStatusAction;
  renameAction: SetupRenameAction;
}) {
  const base = `/dashboard/accounts/${accountId}`;

  // A skipped step leaves the denominator rather than sitting in it forever:
  // the email identity is genuinely optional, and a meter that could never
  // reach the end for an account that is fully live would be lying in the
  // other direction.
  //
  // Counted on `s.done` alone, and that stays unknown-safe for a reason that
  // has nothing to do with how many reads sit behind a step: in
  // deriveSetupStatus (setup-status.ts), `done` is a CONJUNCTION over every
  // read named in that step's READS_BEHIND entry (setup-view.ts) for every
  // key except `email`. A read that threw feeds deriveSetupStatus a neutral
  // input, so a conjunctive `done` comes back `false` and the meter cannot
  // claim progress it did not verify — true for a step with a single read
  // behind it (hours←calendar) exactly as it is for one with more than one
  // (go_live←profile AND numbers). `account` sits outside this entirely: it
  // is hardcoded `done: true` with no read behind it at all, so there is
  // nothing there that can fail either way.
  //
  // `email` is the one key where the conjunction breaks: its READS_BEHIND
  // entry lists both `account` and `ticks`, but `done` is decided by the
  // account read (`fromEmail`) alone — the ticks read decides `skipped`, not
  // `done`. So a settled account row with `from_email` set is a genuinely
  // verified `done` even while the tick read failed and its own card renders
  // "couldn't check" — `done: true` and `unknown: true` at once, which no
  // other step can do. Counting it here is right, not a leak.
  const total = steps.filter((s) => !s.skipped).length;
  const doneCount = steps.filter((s) => s.done).length;

  // The one step the pane badges "Next up" and the rail rings "Current" —
  // and, through `defaultStepKey`, the one the wizard OPENS on when no
  // `?step=` is given. That last part is why this predicate now lives in
  // lib/setup/setup-rail.ts instead of inline here: the two used to be
  // separate expressions that disagreed about skipped and unknown steps, so
  // the wizard could open on "Email identity — Skipped" while the rail rang
  // Business hours as Current.
  const nextKey = nextStepKey(steps);

  // `!s.done` alone is sufficient TODAY, and `|| s.unknown` is the insurance.
  // The reason it is sufficient is narrow: each of the five
  // GO_LIVE_PREREQ_KEYS has exactly ONE read behind it (branding←account,
  // hours←calendar, voice_profile←profile, number←numbers, test_call←calls),
  // so a failed read feeds deriveSetupStatus a neutral input and the step
  // comes back `done: false`. That is a property of those five keys — NOT a general rule
  // about `unknown`: `email` reads two sources and can carry `done: true`
  // alongside `unknown: true`. Give go-live a two-read prerequisite one day
  // and `!s.done` would silently stop naming it in the blocked list while
  // `prereqsMet` (which checks `unknown` itself, setup-view.ts) still refused
  // — an operator staring at a dead button with no reason under it.
  const blocked = steps.filter(
    (s) => GO_LIVE_PREREQ_KEYS.includes(s.key) && (!s.done || s.unknown),
  );
  const blockedReason = prereqsMet
    ? null
    : m["setup.goLive.blocked"].replace(
        "{steps}",
        blocked.map((s) => STEP_COPY[s.key].title).join(", "),
      );

  // One pre-rendered node per step, from props already in hand — same
  // props every module always received (StepDetailProps), computed for all
  // nine regardless of which one ends up selected. setup-shell.tsx places
  // only the selected key's node into the tree; the other eight are real
  // React elements that are simply never mounted.
  const details = {} as Record<SetupStepKey, React.ReactNode>;
  for (const step of steps) {
    const kind = kindOf(step, step.key === nextKey);
    const Detail = STEP_DETAIL[step.key];
    const path = STEP_PATH[step.key];
    details[step.key] = (
      <Detail
        key={step.key}
        step={step}
        kind={kind}
        base={base}
        href={path ? `${base}${path}` : null}
        assignedNumber={assignedNumber}
        movableNumbers={movableNumbers}
        hasVoiceProfile={hasVoiceProfile}
        tickAction={tickAction}
        goLiveAction={goLiveAction}
        moveNumberAction={moveNumberAction}
        enableTestCallsAction={enableTestCallsAction}
        prereqsMet={prereqsMet}
        blockedReason={blockedReason}
        accountName={accountName}
        renameAction={renameAction}
      />
    );
  }

  return (
    <div className="space-y-6">
      <SetupProgress done={doneCount} total={total} />
      <SetupShell views={steps} nextKey={nextKey} blockedReason={blockedReason} details={details} />
    </div>
  );
}

/**
 * How far along, as one line. Same instrument as the Calls page's usage meter
 * — icon chip, sentence with the numbers set apart, hairline rail — so the
 * two screens a client's setup runs through read as one product.
 */
function SetupProgress({ done, total }: { done: number; total: number }) {
  const denominator = Math.max(1, total);
  const ratio = Math.min(1, Math.max(0, done / denominator));
  // Clamped integer. The only thing that reaches the style attribute, and it
  // is computed here rather than interpolated from anything read off a row.
  const percent = done > 0 ? Math.max(2, Math.round(ratio * 100)) : 0;
  const complete = done >= denominator;

  const parts = m["setup.progress"].split(/(\{done\}|\{total\})/);
  const plain = m["setup.progress"]
    .replace("{done}", String(done))
    .replace("{total}", String(total));

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-6">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md",
          complete ? "bg-success/10 text-success" : "bg-primary/10 text-primary",
        )}
      >
        <Rocket className="size-4" aria-hidden />
      </span>

      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        {parts.map((part, i) => (
          <Fragment key={i}>
            {part === "{done}" ? (
              <span className="text-base font-semibold text-foreground tabular-nums">{done}</span>
            ) : part === "{total}" ? (
              <span className="tabular-nums">{total}</span>
            ) : (
              part
            )}
          </Fragment>
        ))}
      </p>

      {/* aria-valuetext, not aria-label, carries the sentence — the paragraph
          beside it already says it once, and a name repeating it would have
          AT announce the same words twice. Mirrors the Calls usage meter. */}
      <Meter
        percent={percent}
        label={m["setup.progressLabel"]}
        max={denominator}
        now={Math.min(done, denominator)}
        valueText={plain}
        // Done is a STATUS reading, so it is a flat --good; everything before
        // that is the meter's own accent gradient.
        fill={complete ? "bg-[var(--good)]" : undefined}
        className="sm:w-56"
      />
    </section>
  );
}
