import { m, type MessageKey } from "@/lib/messages";
import { t, plural } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { formatWhen } from "@/lib/booking/time";
import { agendaTime } from "@/lib/booking/agenda-window";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import { UNDO_WINDOW_MS } from "./undo-window";
import type { NoticeAvailability } from "./cancel-flow";
import type {
  AddJobResult, JobDraft, JobFields, JobOpened, JobWarningView, MoveJobResult, UndoAddResult, UndoMoveResult,
} from "./agenda-actions";

/**
 * F-046 part 1 (plan Task 11, spec 5.4): what the Add job sheet (and Move, the same form) DOES, as plain
 * functions (cancel-booking.ts's and feed-card-handlers.ts's shape), so the confirm-in-place warnings, the
 * phone owner's offer, the toast's words and its Undo are tested without React. Client code: it imports only
 * TYPES from the "use server" actions file; the sheet passes the actions in.
 *
 * The server answers data (keys and ISO times); every word is chosen here, in the sheet's language.
 */

/** sonner's `toast` satisfies it. `duration` and `dismiss` keep the Undo on screen exactly UNDO_WINDOW_MS. */
export type JobToast = {
  success: (message: string, opts?: { action: { label: string; onClick: () => void }; duration: number }) => unknown;
  error: (message: string) => unknown;
  dismiss: (id?: string | number) => unknown;
};

type Ctx = {
  accountId: string;
  /** The ACCOUNT's zone: every time in a toast or a warning is read there, never in the browser's. */
  timezone: string;
  locale: Locale;
  /** The keys of the warnings the person has been shown and is saving past (the second press). */
  seen: string[];
  toast: JobToast;
  /** The QA pseudo-locale: the warning lines the form draws are padded too. */
  pseudo?: boolean;
  schedule?: (fn: () => void, ms: number) => unknown;
};
/**
 * What Move opened with, plus whether the customer had been told about this job THEN (the drawer's `told`). T10
 * review I2: the move decides the "moved" email against what the person saw when the form opened, and answers
 * `calendar.job.changed` when that is no longer true, so the form re-reads and redraws the tick instead of
 * saving silently. Built to that contract: assignable to JobOpened whether or not it carries `told` yet.
 */
export type OpenedSnapshot = JobOpened & { told: boolean };

export type AddRun = Ctx & {
  mode: "add"; draft: JobDraft;
  add: (accountId: string, draft: JobDraft, seen: string[]) => Promise<AddJobResult>;
  undoAdd: (accountId: string, bookingId: string) => Promise<UndoAddResult>;
};
export type MoveRun = Ctx & {
  mode: "move"; bookingId: string; draft: JobFields & { opened: OpenedSnapshot };
  move: (accountId: string, bookingId: string, draft: JobFields & { opened: OpenedSnapshot }, seen: string[]) => Promise<MoveJobResult>;
  undoEdit: (accountId: string, bookingId: string, from: JobOpened, to: JobOpened) => Promise<{ ok: true } | { ok: false; errorKey: "calendar.job.changed" }>;
  undoMove: (accountId: string, newId: string, oldId: string, cancelledAt: string) => Promise<UndoMoveResult>;
};

export type PhoneOwner = { id: string; name: string; first: string };
export type SubmitOutcome =
  /** `moved`: Move made a new row, so the drawer showing the old one closes. */
  | { kind: "saved"; moved?: true }
  /** Spec 5.4: shown above the button, which becomes "Add it anyway" / "Move it anyway"; `seen` goes with the next press. */
  | { kind: "warnings"; warnings: JobWarningView[]; lines: string[]; seen: string[]; button: "calendar.job.saveAnyway" | "calendar.job.moveAnyway" }
  /** R8: "Ana García already has this number. Use Ana?" with Use Ana and Add as new. */
  | { kind: "phoneOwner"; owner: PhoneOwner }
  /** `changed`: the job changed under the form (calendar.job.changed); the form re-reads it and redraws. */
  | { kind: "error"; message: string; changed?: true };

/** Spec 5.4: 5 to 720 minutes, in five-minute steps (the action refuses anything else). */
export const LENGTH_OPTIONS: readonly number[] = Array.from({ length: 144 }, (_, i) => (i + 1) * 5);

/** F-092 part 1 (plan Task 9): the sheet's own customer search wants the palette's GET route's `contacts` half
 *  only — it never shows a call or a conversation, so there is no reason to pay for either search. */
export function customerSearchUrl(accountId: string, term: string): string {
  return `/api/accounts/${accountId}/search?q=${encodeURIComponent(term)}&types=contacts`;
}

const firstOr = (first: string, locale: Locale) => first.trim() || t(m, "calendar.job.customerFallback", locale);
/** The QA pseudo-locale (lib/record/copy.ts's makeTr): every word the sheet draws can be padded. */
const padded = (s: string, pseudo: boolean) => (pseudo ? pseudoLocale(s) : s);

/** One line per warning, in the sheet's language; an overlap names the earliest start in the account's zone. */
export function warningLines(warnings: readonly JobWarningView[], timezone: string, locale: Locale, pseudo = false): string[] {
  return warnings.map((w) => padded(line(w), pseudo));
  function line(w: JobWarningView): string {
    switch (w.kind) {
      case "outside_hours": return t(m, "calendar.job.warn.outsideHours", locale);
      case "notice": return t(m, "calendar.job.warn.notice", locale);
      case "closed": return t(m, "calendar.job.warn.closed", locale);
      case "no_video": return t(m, "calendar.job.warn.noVideo", locale);
      case "overlaps": {
        const count = w.count ?? 1;
        const time = w.at ? agendaTime(new Date(w.at), timezone, locale, false) : "";
        return plural(m, "calendar.job.warn.overlaps", count, locale, { count, time });
      }
    }
  }
}

/**
 * R8 "Use Ana": the job goes to the number's owner, wanting the confirmation the person asked for (`notify`, the
 * tick's own state), owner ruling R4: on by default. The typed customer's draft carried it OFF only because a
 * person typed in has no email (T11/T12 review); Ana may have one, and the action's own check decides.
 */
export function withExistingCustomer(draft: JobDraft, owner: { id: string }, notify: boolean): JobDraft {
  return { ...draft, notify, customer: { kind: "existing", id: owner.id } };
}

/** The customer the sheet holds: one chosen from the search, or one typed in. */
export type SheetCustomer =
  | { kind: "existing"; id: string; name: string; first: string }
  | { kind: "new"; name: string; phone: string; addAsNew: boolean };

/** What the sheet sends: its fields, the customer it holds, and a typed New address when one is chosen. */
export function sheetDraft(customer: SheetCustomer | null, fields: JobFields, newPlace?: unknown): JobDraft | null {
  if (!customer) return null;
  return {
    ...fields, ...(newPlace !== undefined ? { newPlace } : {}),
    customer: customer.kind === "existing" ? { kind: "existing", id: customer.id }
      : { kind: "new", name: customer.name, phone: customer.phone, addAsNew: customer.addAsNew },
  };
}
/**
 * R8 "Add as new", kept in the customer the sheet holds (T11/T12 review): built into one draft only, the next
 * save (past the warnings that answer it, say) asked about the phone's owner again, for ever.
 */
export function addingAsNew<C extends SheetCustomer>(c: C): C { return c.kind === "new" ? { ...c, addAsNew: true } : c; }
/** A typed name or phone changed: Add as new answered the offer about THAT person on THAT number, so the server
 *  asks again. */
export function typedCustomer(c: Extract<SheetCustomer, { kind: "new" }>, patch: { name?: string; phone?: string }): SheetCustomer {
  return { ...c, ...patch, addAsNew: false };
}
/** The phone owner's offer: the question and the primary's words. An owner with no name on file reads "This
 *  customer" ("Use this customer?"), never "already has this number. Use ?" (T11/T12 review minor). */
export function phoneOwnerWords(owner: PhoneOwner, locale: Locale, pseudo = false): { question: string; button: string } {
  const generic = t(m, "places.thisCustomer", locale);
  const name = owner.name.trim() || generic;
  const first = owner.first.trim() || generic.charAt(0).toLocaleLowerCase(locale) + generic.slice(1);
  return {
    question: padded(t(m, "calendar.job.phoneOwner", locale, { name, first }), pseudo),
    button: padded(t(m, "calendar.job.useExisting", locale, { first }), pseudo),
  };
}

/** Why "Send {first} a confirmation" is off, or null when it can go (or is not known yet: the server re-checks). */
export function noticeReason(n: NoticeAvailability | null, first: string, locale: Locale, pseudo = false): string | null {
  if (n === "no_email") return padded(t(m, "calendar.job.noEmail", locale, { first: firstOr(first, locale) }), pseudo);
  if (n === "address_blocked") return padded(t(m, "calendar.job.emailBlocked", locale, { first: firstOr(first, locale) }), pseudo);
  if (n === "suppressed_account") return padded(t(m, "calendar.job.accountNoEmail", locale), pseudo);
  return null;
}

/** A success toast whose Undo lives exactly the Undo window, dismissed then even if hovered (cancel-booking.ts). */
function toastWithUndo(run: Ctx, message: string, onUndo: () => Promise<void>): void {
  const schedule = run.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const id = run.toast.success(message, {
    action: { label: t(m, "calendar.job.undo", run.locale), onClick: () => { void onUndo(); } },
    duration: UNDO_WINDOW_MS,
  });
  schedule(() => { run.toast.dismiss(id as string | number); }, UNDO_WINDOW_MS);
}

/** The Undo's own outcome, as a second toast once the server has done (or refused) it. */
async function settleUndo<R extends { ok: boolean }>(
  run: Ctx, undo: () => Promise<R>, ok: (r: R) => string, err: (r: R) => string,
): Promise<void> {
  let r: R;
  try {
    r = await undo();
  } catch {
    run.toast.error(t(m, "common.actionCrashed", run.locale));
    return;
  }
  if (r.ok) run.toast.success(ok(r));
  else run.toast.error(err(r));
}

const errorOf = (key: MessageKey, locale: Locale, params?: Record<string, string>) => t(m, key, locale, params);

function needsOutcome(
  r: { needs: { phoneOwner: PhoneOwner } | { warnings: JobWarningView[] } }, run: AddRun | MoveRun,
): SubmitOutcome {
  if ("phoneOwner" in r.needs) return { kind: "phoneOwner", owner: r.needs.phoneOwner };
  const warnings = r.needs.warnings;
  return {
    kind: "warnings", warnings, lines: warningLines(warnings, run.timezone, run.locale, run.pseudo), seen: warnings.map((w) => w.key),
    button: run.mode === "move" ? "calendar.job.moveAnyway" : "calendar.job.saveAnyway",
  };
}

/**
 * The sheet's one primary button. Writes nothing itself: the action decides, and answers either what the person
 * has not seen yet (warnings, the phone's owner), a refusal, or the saved job, whose toast carries Undo.
 */
export async function submitJob(run: AddRun | MoveRun): Promise<SubmitOutcome> {
  const { locale, timezone } = run;
  const when = (iso: string) => formatWhen(new Date(iso), timezone, locale);
  try {
    if (run.mode === "add") {
      const r = await run.add(run.accountId, run.draft, run.seen);
      if (!r.ok) return "errorKey" in r ? { kind: "error", message: errorOf(r.errorKey, locale) } : needsOutcome(r, run);
      const first = firstOr(r.first, locale);
      const base = r.notice === "scheduled"
        ? t(m, "calendar.job.added", locale, { first, when: when(r.startsAt) })
        : t(m, "calendar.job.addedQuiet", locale, { first, when: when(r.startsAt) });
      const extra = r.notice === "no_email" ? t(m, "calendar.job.noEmail", locale, { first })
        : r.notice === "address_blocked" ? t(m, "calendar.job.emailBlocked", locale, { first })
        : null;
      toastWithUndo(run, extra ? `${base} ${extra}` : base, () => settleUndo(run,
        () => run.undoAdd(run.accountId, r.bookingId),
        () => t(m, "calendar.job.undone", locale, { first }),
        (u) => (u.ok ? "" : errorOf(u.errorKey, locale, { first }))));
      return { kind: "saved" };
    }

    const r = await run.move(run.accountId, run.bookingId, run.draft, run.seen);
    if (!r.ok && "errorKey" in r && r.errorKey === "calendar.job.changed") {
      return { kind: "error", message: errorOf(r.errorKey, locale), changed: true };
    }
    if (!r.ok) return "errorKey" in r ? { kind: "error", message: errorOf(r.errorKey, locale) } : needsOutcome(r, run);
    if (r.mode === "edited") {
      toastWithUndo(run, t(m, "calendar.job.edited", locale), () => settleUndo(run,
        () => run.undoEdit(run.accountId, run.bookingId, r.from, r.to),
        () => t(m, "calendar.job.editUndone", locale),
        (u) => (u.ok ? "" : errorOf(u.errorKey, locale))));
      return { kind: "saved" };
    }
    const first = firstOr(r.first, locale);
    const message = r.notice === "scheduled"
      ? t(m, "calendar.job.moved", locale, { when: when(r.startsAt), first })
      : t(m, "calendar.job.movedQuiet", locale, { when: when(r.startsAt) });
    toastWithUndo(run, message, () => settleUndo(run,
      () => run.undoMove(run.accountId, r.newId, r.oldId, r.cancelledAt),
      (u) => (u.ok ? t(m, "calendar.job.moveUndone", locale, { when: when(u.startsAt) }) : ""),
      (u) => (u.ok ? "" : errorOf(u.errorKey, locale, { first }))));
    return { kind: "saved", moved: true };
  } catch {
    return { kind: "error", message: t(m, "common.actionCrashed", locale) };
  }
}
