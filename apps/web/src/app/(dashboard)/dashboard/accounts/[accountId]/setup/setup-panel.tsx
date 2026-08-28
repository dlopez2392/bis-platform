import { Fragment } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Minus, Rocket } from "lucide-react";
import type { SetupStepKey, SetupStepState } from "@/lib/setup/setup-status";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { SetupTickButton } from "./setup-tick-button";

/**
 * The wizard, as one path rather than nine cards.
 *
 * Everything here is server-rendered except the two tick buttons (see
 * ./setup-tick-button.tsx). The visual argument the layout makes:
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
 */

export type SetupTick = "emailSkipped" | "forwardingDone";
export type SetupTickAction = (tick: SetupTick, done: boolean) => Promise<{ ok: boolean }>;

/**
 * A derived step plus whether the read behind it actually answered.
 *
 * `unknown` is not a fourth value of `done` — it sits beside it deliberately,
 * so that no arm of the render can accidentally treat a failed read as a
 * negative answer and no future edit can collapse the two.
 */
export type SetupStepView = SetupStepState & { unknown: boolean };

/**
 * Mirrors the keys `goLivePrereqsMet` checks (lib/setup/setup-status.ts).
 * Duplicated here — and imported from here by the page — because that
 * function returns a boolean and this panel has to NAME the unmet steps for
 * `setup.goLive.blocked`. One list, two readers; keep it in sync with that
 * function's body.
 */
export const GO_LIVE_PREREQ_KEYS: readonly SetupStepKey[] = [
  "hours", "voice_profile", "number", "test_call",
];

const STEP_COPY: Record<SetupStepKey, { title: string; help: string }> = {
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
const STEP_PATH: Partial<Record<SetupStepKey, string>> = {
  branding: "/branding?from=setup",
  hours: "/calendar?from=setup",
  voice_profile: "/voice?from=setup",
  number: "/voice?from=setup",
  email: "/settings?from=setup",
};

type StateKind = "done" | "open" | "next" | "skipped" | "unknown";

const TONE: Record<StateKind, { marker: string; card: string; chip: string; dot: string }> = {
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

const STATE_LABEL: Record<StateKind, string> = {
  done: m["setup.state.done"],
  open: m["setup.state.open"],
  next: m["setup.state.open"],
  skipped: m["setup.state.skipped"],
  unknown: m["setup.state.unknown"],
};

/**
 * `unknown` is checked FIRST and `done` only after it. A step whose read
 * threw can still be carrying `done: false` from the neutral input the page
 * fed the derive function — reading that as "To do" would quietly turn a
 * failure into an answer.
 */
function kindOf(step: SetupStepView, isNext: boolean): StateKind {
  if (step.unknown) return "unknown";
  if (step.done) return "done";
  if (step.skipped) return "skipped";
  return isNext ? "next" : "open";
}

export function SetupPanel({
  accountId, steps, prereqsMet, assignedNumber, tickAction,
}: {
  accountId: string;
  steps: SetupStepView[];
  /** From `goLivePrereqsMet`, narrowed by the page so an unverifiable
   *  prerequisite also counts as unmet. */
  prereqsMet: boolean;
  /** First non-released number on the account, or null. What the client's
   *  carrier forwards to and what a test call dials. */
  assignedNumber: string | null;
  tickAction: SetupTickAction;
}) {
  const base = `/dashboard/accounts/${accountId}`;

  // A skipped step leaves the denominator rather than sitting in it forever:
  // the email identity is genuinely optional, and a meter that could never
  // reach the end for an account that is fully live would be lying in the
  // other direction. Unknown steps stay counted and stay un-done — we do not
  // know, so the meter must not claim progress.
  const total = steps.filter((s) => !s.skipped).length;
  const doneCount = steps.filter((s) => s.done).length;

  // The one card that gets the ring. Deliberately skips `unknown` steps: the
  // action for those is "reload", not "go do this", so pointing the operator
  // at one as their next task would send them into a settings page to fix
  // something that may already be fine.
  const nextKey = steps.find((s) => !s.done && !s.skipped && !s.unknown)?.key ?? null;

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

                <StepActions
                  step={step}
                  kind={kind}
                  base={base}
                  href={path ? `${base}${path}` : null}
                  assignedNumber={assignedNumber}
                  tickAction={tickAction}
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

/** The number the carrier forwards to and the number a test call dials.
 *  Monospaced and selectable — it gets read down a phone line and typed into
 *  someone else's carrier portal. */
function NumberChip({ e164 }: { e164: string }) {
  return (
    <code className="rounded-md border border-border bg-muted/60 px-2 py-1 font-mono text-xs text-foreground tabular-nums">
      {e164}
    </code>
  );
}

function StepActions({
  step, kind, base, href, assignedNumber, tickAction, prereqsMet, blockedReason,
}: {
  step: SetupStepView;
  kind: StateKind;
  base: string;
  href: string | null;
  assignedNumber: string | null;
  tickAction: SetupTickAction;
  prereqsMet: boolean;
  blockedReason: string | null;
}) {
  /** Controls — buttons, links, the number chip — laid out on one wrapping
   *  row. Prose belongs in `note` below it, not among them. */
  const rows: React.ReactNode[] = [];
  let note: React.ReactNode = null;

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

  if (step.key === "number" && assignedNumber) {
    rows.unshift(<NumberChip key="e164" e164={assignedNumber} />);
  }

  if (step.key === "forwarding") {
    if (assignedNumber) {
      rows.unshift(<NumberChip key="e164" e164={assignedNumber} />);
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
  }

  if (step.key === "email" && kind !== "unknown") {
    // Nothing to skip once a sending identity actually exists — and a stale
    // skip tick cannot mark a completed step skipped anyway (pinned in
    // setup-status.test.ts), so there is no "Un-skip" to offer either.
    if (step.skipped) {
      rows.push(
        <SetupTickButton
          key="tick" action={tickAction} tick="emailSkipped" done={false}
          label={m["setup.step.email.unskip"]}
        />,
      );
    } else if (!step.done) {
      rows.push(
        <SetupTickButton
          key="tick" action={tickAction} tick="emailSkipped" done={true}
          label={m["setup.step.email.skip"]}
        />,
      );
    }
  }

  if (step.key === "test_call") {
    if (assignedNumber) rows.unshift(<NumberChip key="e164" e164={assignedNumber} />);
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
  }

  if (step.key === "go_live" && !step.done) {
    rows.push(
      // Rendered disabled on purpose: the action that flips the receptionist
      // on is Task 14's, and a button that looks live but does nothing is
      // worse than one that plainly cannot be pressed yet. The reason below
      // is the part that carries information today.
      <Button key="golive" type="button" disabled title={blockedReason ?? undefined}>
        <Rocket aria-hidden />
        {m["setup.goLive.button"]}
      </Button>,
    );
  }

  // Scoped to the go-live card: `blockedReason` is computed once for the
  // whole panel, so testing it alone here would give every other card an
  // empty action row.
  const showReason =
    step.key === "go_live" && !step.done && !prereqsMet && blockedReason !== null;

  if (rows.length === 0 && note === null && !showReason) return null;

  return (
    <div className="mt-3 space-y-2">
      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">{rows}</div>
      ) : null}
      {note !== null ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      {/* Visible, not a tooltip: a disabled button takes no pointer events in
          several browsers and is out of the tab order, so `title` alone would
          hide the one sentence that says what is still missing. */}
      {showReason ? <p className="text-sm text-muted-foreground">{blockedReason}</p> : null}
    </div>
  );
}
