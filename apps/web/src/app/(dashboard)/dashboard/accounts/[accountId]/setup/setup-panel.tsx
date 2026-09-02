import { Fragment } from "react";
import { AlertTriangle, Check, Minus, Rocket } from "lucide-react";
import type { SetupStepKey } from "@/lib/setup/setup-status";
import {
  GO_LIVE_PREREQ_KEYS, kindOf, type SetupStepView, type StateKind, type AssignedNumber,
} from "@/lib/setup/setup-view";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import {
  STEP_COPY, STEP_PATH, TONE, type StepDetailProps,
  type SetupTick, type SetupTickAction, type SetupGoLiveAction, type SetupMoveNumberAction,
  type SetNumberStatusAction, type MovableNumber,
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

/**
 * The wizard, as one path rather than nine cards.
 *
 * Everything here is server-rendered except the five buttons that write: the
 * two ticks (./setup-tick-button.tsx), go-live (./setup-go-live-button.tsx),
 * move-number (./setup-move-number-button.tsx), and enable-test-calls
 * (./setup-enable-test-calls-button.tsx). Each is its own island calling a
 * Result-typed action, so a refusal arrives as a value to render rather than
 * a rejected promise. The visual argument the layout makes:
 *
 * ① A spine. A hairline rail threads the nine markers top to bottom, so the
 *   page reads as a sequence with a beginning and an end — "nothing" to
 *   "live" — instead of a grid of unrelated settings the operator has to
 *   order in their head.
 * ② One focal point. Exactly one card is ringed as "Next up": the first step
 *   that is genuinely actionable. An operator who reads nothing else on this
 *   page still knows what to do.
 * ③ Colour lives in graphical marks, never in small text. `--success`
 *   measures ~3.4:1 on the light card and `--warning` ~3.6:1 — fine for a
 *   dot, a ring or an icon (3:1), below AA for a label. So every state chip
 *   keeps `text-foreground`/`text-muted-foreground` and carries its hue in
 *   the dot and the border, exactly as the Calls table's outcome chips do.
 * ④ "Couldn't check" is never green and never quiet. A read that threw is
 *   rendered in warning tone with a dashed marker, because the one thing this
 *   page must never do is show a tick for something it failed to verify.
 *
 * Design Phase 5 Task 3 split each step's detail (rows/note/panel) out of a
 * single `StepActions` branch into its own module under ./steps/ — this file
 * is now the shell: the progress meter, the rail of nine cards, and the
 * `STEP_DETAIL` lookup that renders each step's module. No behavior changed;
 * see ./steps/step-shared.ts for the maps/types every module shares.
 */

// Re-exported so the four write-islands (setup-tick-button.tsx,
// setup-go-live-button.tsx, setup-move-number-button.tsx,
// setup-enable-test-calls-button.tsx) and page.tsx keep importing these
// types from "./setup-panel" unchanged — their actual definitions now live
// in ./steps/step-shared.ts, declared once alongside StepDetailProps.
export type {
  SetupTick, SetupTickAction, SetupGoLiveAction, SetupMoveNumberAction,
  SetNumberStatusAction, MovableNumber,
};

const STATE_LABEL: Record<StateKind, string> = {
  done: m["setup.state.done"],
  open: m["setup.state.open"],
  next: m["setup.state.open"],
  skipped: m["setup.state.skipped"],
  unknown: m["setup.state.unknown"],
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
  accountId, steps, prereqsMet, assignedNumber, movableNumbers, hasVoiceProfile,
  tickAction, goLiveAction, moveNumberAction, enableTestCallsAction,
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
  tickAction: SetupTickAction;
  goLiveAction: SetupGoLiveAction;
  moveNumberAction: SetupMoveNumberAction;
  enableTestCallsAction: SetNumberStatusAction;
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

  // The one card that gets the ring. Deliberately skips `unknown` steps: the
  // action for those is "reload", not "go do this", so pointing the operator
  // at one as their next task would send them into a settings page to fix
  // something that may already be fine.
  const nextKey = steps.find((s) => !s.done && !s.skipped && !s.unknown)?.key ?? null;

  // `!s.done` alone is sufficient TODAY, and `|| s.unknown` is the insurance.
  // The reason it is sufficient is narrow: each of the four
  // GO_LIVE_PREREQ_KEYS has exactly ONE read behind it (hours←calendar,
  // voice_profile←profile, number←numbers, test_call←calls), so a failed read
  // feeds deriveSetupStatus a neutral input and the step comes back
  // `done: false`. That is a property of those four keys — NOT a general rule
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

  return (
    <div className="space-y-6">
      <SetupProgress done={doneCount} total={total} />

      <ol>
        {steps.map((step, index) => {
          const kind = kindOf(step, step.key === nextKey);
          const tone = TONE[kind];
          const copy = STEP_COPY[step.key];
          const path = STEP_PATH[step.key];
          const isLast = index === steps.length - 1;
          const Detail = STEP_DETAIL[step.key];

          return (
            <li key={step.key} className={cn("relative flex gap-4", isLast ? "pb-0" : "pb-3")}>
              {/* The spine. Purely decorative: the ordered list already
                  carries the sequence for assistive tech. */}
              {isLast ? null : (
                <span
                  aria-hidden
                  className="absolute top-9 bottom-0 left-4 w-px -translate-x-1/2 bg-border"
                />
              )}

              <span
                aria-hidden
                className={cn(
                  "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border",
                  tone.marker,
                )}
              >
                {kind === "done" ? (
                  <Check className="size-4" />
                ) : kind === "skipped" ? (
                  <Minus className="size-4" />
                ) : kind === "unknown" ? (
                  <AlertTriangle className="size-4" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </span>

              <div className={cn("min-w-0 flex-1 rounded-lg border p-4", tone.card)}>
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  {/* `basis-64`, not `auto`. With a wrapping row, the browser
                      places items at their max-content width first — so the
                      two longest help sentences on the page (email identity,
                      call forwarding) were pushing their state chip onto a
                      second line while every other card kept its chip top
                      right. A fixed basis makes the chips line up in a
                      column down the page at any desktop width, and still
                      lets the row stack under roughly 380px. */}
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium tracking-widest text-muted-foreground tabular-nums">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <h2 className="text-sm font-semibold text-card-foreground">{copy.title}</h2>
                      {kind === "next" ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
                          {m["setup.nextUp"]}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{copy.help}</p>
                  </div>

                  {/* Deliberately shrinkable: "Couldn't check — reload to
                      retry" is four times the width of "Done", and a chip
                      pinned to its intrinsic size would push out of a narrow
                      card rather than wrapping inside it. */}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
                      tone.chip,
                    )}
                  >
                    <span className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} aria-hidden />
                    {STATE_LABEL[kind]}
                  </span>
                </div>

                <Detail
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
                />
              </div>
            </li>
          );
        })}
      </ol>
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
      <div
        role="progressbar"
        aria-label={m["setup.progressLabel"]}
        aria-valuemin={0}
        aria-valuemax={denominator}
        aria-valuenow={Math.min(done, denominator)}
        aria-valuetext={plain}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted sm:w-56"
      >
        <div
          className={cn("h-full rounded-full", complete ? "bg-success" : "bg-primary")}
          style={{ width: `${percent}%` }}
        />
      </div>
    </section>
  );
}
