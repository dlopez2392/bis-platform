import { Fragment } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Minus, Rocket } from "lucide-react";
import type { PhoneNumberStatus } from "@bis/db";
import type { SetupStepKey } from "@/lib/setup/setup-status";
import {
  GO_LIVE_PREREQ_KEYS, kindOf, canEnableTestCalls, type SetupStepView, type StateKind,
  type AssignedNumber,
} from "@/lib/setup/setup-view";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { SetupTickButton } from "./setup-tick-button";
import { SetupGoLiveButton } from "./setup-go-live-button";
import { SetupMoveNumberButton } from "./setup-move-number-button";
import { SetupEnableTestCallsButton } from "./setup-enable-test-calls-button";

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
 */

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
const NUMBER_STATUS_LABEL: Record<PhoneNumberStatus, string> = {
  provisioned: m["voice.numbers.status.provisioned"],
  testing: m["voice.numbers.status.testing"],
  live: m["voice.numbers.status.live"],
  released: m["voice.numbers.status.released"],
};

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

export function SetupPanel({
  accountId, steps, prereqsMet, assignedNumber, movableNumbers,
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
                  movableNumbers={movableNumbers}
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

/** The assigned number's status, beside its chip on the number and test-call
 *  cards (the two the wizard's exit gate found operators needed it on). Same
 *  labels the Voice page and the movable-numbers list already use — never a
 *  new vocabulary for the same four values. */
function NumberStatusChip({ status }: { status: PhoneNumberStatus }) {
  return (
    <span className="text-xs text-muted-foreground">{NUMBER_STATUS_LABEL[status]}</span>
  );
}

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
    <div className="rounded-md border border-border bg-muted/30 p-3">
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

function StepActions({
  step, kind, base, href, assignedNumber, movableNumbers,
  tickAction, goLiveAction, moveNumberAction, enableTestCallsAction, prereqsMet, blockedReason,
}: {
  step: SetupStepView;
  kind: StateKind;
  base: string;
  href: string | null;
  assignedNumber: AssignedNumber | null | "unknown";
  movableNumbers: MovableNumber[];
  tickAction: SetupTickAction;
  goLiveAction: SetupGoLiveAction;
  moveNumberAction: SetupMoveNumberAction;
  enableTestCallsAction: SetNumberStatusAction;
  prereqsMet: boolean;
  blockedReason: string | null;
}) {
  /** Controls — buttons, links, the number chip — laid out on one wrapping
   *  row. Prose belongs in `note` below it, not among them. */
  const rows: React.ReactNode[] = [];
  let note: React.ReactNode = null;
  /** A block that needs its own box rather than a slot on the controls row —
   *  currently only the movable-number list. */
  let panel: React.ReactNode = null;

  // The actual number, or null for BOTH "no number yet" and "couldn't
  // check" — collapsed here because every chip site below already renders
  // nothing for null, which is the right behaviour for "couldn't check" too.
  // Only the forwarding card's `note` below needs to tell the two apart, so
  // it reads `assignedNumber` directly rather than this narrowed value.
  const number = assignedNumber === "unknown" ? null : assignedNumber;
  const e164 = number?.e164 ?? null;

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

  if (step.key === "number") {
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
  }

  if (step.key === "forwarding") {
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
    if (number) {
      // No `unshift` needed here (unlike the number step below): the
      // test-call card has no "Open" link, so `rows` is still empty.
      rows.push(
        <NumberChip key="e164" e164={number.e164} />,
        <NumberStatusChip key="status" status={number.status} />,
      );
      // What pressing (or having pressed) the button actually does — see
      // canEnableTestCalls (setup-view.ts) and Task 8's callAnswerable for
      // why `testing` needs no further caveat here.
      if (canEnableTestCalls(number.status)) {
        note = m["setup.testCall.provisionedNote"];
        rows.push(
          <SetupEnableTestCallsButton
            key="enable"
            action={enableTestCallsAction}
            phoneNumberId={number.id}
          />,
        );
      } else if (number.status === "testing") {
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
  }

  if (step.key === "go_live" && !step.done) {
    rows.push(
      // `disabled` is courtesy only. goLiveAction re-derives every
      // prerequisite from live rows at click time and refuses on its own
      // evidence, which is why it is safe to drive this attribute from a
      // render that went stale the moment it painted.
      <SetupGoLiveButton key="golive" action={goLiveAction} disabled={!prereqsMet} />,
    );
  }

  // Scoped to the go-live card: `blockedReason` is computed once for the
  // whole panel, so testing it alone here would give every other card an
  // empty action row.
  const showReason =
    step.key === "go_live" && !step.done && !prereqsMet && blockedReason !== null;

  if (rows.length === 0 && note === null && panel === null && !showReason) return null;

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
      {panel}
    </div>
  );
}
