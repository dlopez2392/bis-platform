"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import type { PhoneCountry } from "@bis/db/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DotPill } from "@/components/dot-pill";
import { m } from "@/lib/messages";
import { runGuarded } from "@/lib/ui/guarded-run";
import { PHONE_CHECK_TREATMENT, pickPhoneCountry } from "@/lib/contacts/phone-country";
import { TEXTS_TREATMENT, textsLine, runTextsAction, type TextsLoad } from "@/lib/consent/texts-row";
import type { TextsView } from "@/lib/consent/texts-view";
import type { TextsActionResult, TextsUndo } from "@/lib/consent/staff-actions";
import { setPhoneCountryAction, undoPhoneCountryAction } from "./actions";
import {
  stopTextsAction, undoStopTextsAction, resumeTextsAction, confirmStopAction, notAStopAction, undoHoldDecisionAction,
} from "./texts-actions";

/**
 * The contact's Messages block, Texts row (consent chain spec §6): Allowed,
 * Stopped, On hold and Check number, each a dot + word (rule 3), every
 * button ghost except the Resume form's own "Resume texts" (rule 8: that
 * inline form is its own view). Each action runs at once with an Undo toast
 * (rule 6); Resume asks for a note first and has no undo (plan G13).
 *
 * Rendered in the drawer (which reads it on its own, so the block has its own
 * two-row skeleton and error line) and on the contact page (read on the
 * server). Keyboard (review R3-M9, R3-I4): the status line is a focus target
 * that stays MOUNTED in every ready state (after a pick too, when the number's
 * state is unknown until the host re-reads), and every action returns focus
 * to it, so the row never drops the keyboard on the page body when the
 * button that held it goes away. The Resume form's note field takes focus
 * when the form opens, and Cancel hands it back to the status.
 */
type Ready = Extract<TextsLoad, { status: "ready" }>;

function Block({ children, state }: { children: React.ReactNode; state?: string }) {
  return (
    <div className="space-y-1.5" data-testid="texts-row" data-state={state}>
      <p className="text-muted-foreground font-mono text-[10px] font-medium tracking-[0.14em] uppercase">{m["contact.messages.title"]}</p>
      {children}
    </div>
  );
}

export function TextsRow({ accountId, contactId, load, onChanged = () => {}, onRetry }: {
  accountId: string;
  contactId: string;
  load: TextsLoad;
  /** A row action or a pick changed the ledger or the number: the host re-reads. */
  onChanged?: () => void;
  /** The error state's Retry. */
  onRetry?: () => void;
}) {
  if (load.status === "loading") {
    return (
      <Block>
        <div className="space-y-2" data-testid="texts-row-skeleton">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-32" />
        </div>
      </Block>
    );
  }
  if (load.status === "error") {
    return (
      <Block>
        <p className="text-muted-foreground text-sm">{m["contact.texts.loadFailed"]}</p>
        {onRetry ? <Button size="sm" variant="ghost" onClick={onRetry}>{m["common.retry"]}</Button> : null}
      </Block>
    );
  }
  if (load.view.kind === "no_number") return null;
  return <ReadyRow key={contactId} accountId={accountId} contactId={contactId} load={load} onChanged={onChanged} />;
}

function ReadyRow({ accountId, contactId, load, onChanged }: {
  accountId: string; contactId: string; load: Ready; onChanged: () => void;
}) {
  const [adopted, setAdopted] = useState(load);
  const [view, setView] = useState<TextsView>(load.view);
  const [checking, setChecking] = useState(true);
  const [resuming, setResuming] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const status = useRef<HTMLDivElement>(null);

  // A re-read (the drawer's refetch, the page's refresh) is the truth. Adopted
  // during render — React's pattern for a prop that changed — never by
  // remounting, so focus stays where the action left it.
  if (adopted !== load) {
    setAdopted(load);
    setView(load.view);
    setChecking(true);
  }

  const phone = load.phone ?? "";
  const run = (work: () => Promise<void>): boolean => runGuarded(busy, startTransition, work);
  const show = (next: TextsView) => {
    setView(next);
    setResuming(false);
    queueMicrotask(() => status.current?.focus());
  };
  const undo = (u: TextsUndo): Promise<TextsActionResult> => u.kind === "stop"
    ? undoStopTextsAction(accountId, contactId, u.eventId)
    : undoHoldDecisionAction(accountId, contactId, u.eventId, u.reopenTaskIds);
  const act = (call: () => Promise<TextsActionResult>, success: string, withUndo = true) => {
    if (pending || busy.current) return;
    run(async () => {
      await runTextsAction(call, show, toast, { success, undo: withUndo ? undo : undefined, run, onChanged });
    });
  };

  function pick(country: PhoneCountry) {
    if (pending || busy.current) return;
    run(() => pickPhoneCountry(
      country,
      (c) => setPhoneCountryAction(accountId, contactId, c, phone),
      (picked, previous) => undoPhoneCountryAction(accountId, contactId, picked, previous),
      setChecking,
      toast,
      run,
      onChanged,
    ));
  }

  // A pick answered: the Check number state is gone, and what the number is
  // now is the host's re-read (onChanged). Until then the status line stays,
  // with no word, and takes the focus the pressed button had (review R3-I4).
  const picked = view.kind === "check_number" && !checking;
  useEffect(() => {
    if (picked) status.current?.focus();
  }, [picked]);

  const line = textsLine(view, load.zone);
  const pill = view.kind === "allowed" ? TEXTS_TREATMENT.allowed
    : view.kind === "stopped" ? TEXTS_TREATMENT.stopped
    : view.kind === "held" ? TEXTS_TREATMENT.held
    : PHONE_CHECK_TREATMENT;
  const checkNumber = view.kind === "check_number" && !picked;

  return (
    <Block state={view.kind}>
      {/* ONE wrapper in every ready state — right after the Messages label —
          with the status line as ITS first child, so React keeps the same
          status node (its focus, its tabindex) when the state changes under
          it, INTO Check number as well as out of it (review R3-N2: an Undo of
          a pick, a phone edit to an ambiguous number). PR-1's test id sits on
          the wrapper only in the Check number state, where it wraps the whole
          state, word included (review R3-I2). */}
      <div className="space-y-1.5" data-testid={checkNumber ? "phone-country-row" : undefined}>
        <div ref={status} tabIndex={-1} data-testid="texts-row-status"
          className="flex items-center gap-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span>{m["contact.messages.texts"]}</span>
          {picked ? null : <DotPill {...pill} dense data-status={view.kind} />}
        </div>
        {checkNumber ? (
          <>
            <p className="text-muted-foreground text-xs">{m["contact.phoneCountry.line"]}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => pick("MX")}>{m["contact.phoneCountry.mx"]}</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => pick("US")}>{m["contact.phoneCountry.us"]}</Button>
            </div>
          </>
        ) : null}
      </div>
      {line ? <p className="text-muted-foreground text-xs">{line}</p> : null}

      {view.kind === "allowed" ? (
        <Button size="sm" variant="ghost" disabled={pending}
          onClick={() => act(() => stopTextsAction(accountId, contactId, view.newestId), m["contact.texts.stoppedToast"])}>
          {m["contact.texts.stopTexts"]}
        </Button>
      ) : null}

      {view.kind === "stopped" && !view.canResume ? (
        <p className="text-muted-foreground text-xs">{m["contact.texts.customerOnly"]}</p>
      ) : null}
      {view.kind === "stopped" && view.canResume && !resuming ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setResuming(true)}>
          {m["contact.texts.resume"]}
        </Button>
      ) : null}
      {view.kind === "stopped" && view.canResume && resuming ? (
        <form className="space-y-2" data-testid="texts-resume-form" onSubmit={(e) => {
          e.preventDefault();
          act(() => resumeTextsAction(accountId, contactId, view.eventId, note), m["contact.texts.resumedToast"], false);
        }}>
          <Label htmlFor={`texts-resume-${contactId}`}>{m["contact.texts.resumeNoteLabel"]}</Label>
          <Input id={`texts-resume-${contactId}`} name="note" value={note} aria-required="true" autoFocus
            onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>{m["contact.texts.resumeSubmit"]}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => {
              setResuming(false);
              queueMicrotask(() => status.current?.focus());
            }}>{m["contact.texts.resumeCancel"]}</Button>
          </div>
        </form>
      ) : null}

      {view.kind === "held" ? (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={pending}
            onClick={() => act(() => confirmStopAction(accountId, contactId, view.eventId), m["contact.texts.confirmedToast"])}>
            {m["contact.texts.confirmStop"]}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending}
            onClick={() => act(() => notAStopAction(accountId, contactId, view.eventId), m["contact.texts.releasedToast"])}>
            {m["contact.texts.notAStop"]}
          </Button>
        </div>
      ) : null}

    </Block>
  );
}
