"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DotPill } from "@/components/dot-pill";
import { m } from "@/lib/messages";
import { runGuarded } from "@/lib/ui/guarded-run";
import { EMAIL_TREATMENT, emailLine, noResumeLine, runEmailAction, type EmailLoad } from "@/lib/consent/email-row";
import type { EmailView } from "@/lib/consent/email-view";
import type { EmailActionResult, EmailUndo } from "@/lib/consent/email-staff-actions";
import { stopEmailsAction, undoStopEmailsAction, resumeEmailsAction } from "./email-actions";

/**
 * The contact's Messages block, Email row (consent chain spec §6, PR-3):
 * Allowed or Stopped, each a dot + word (rule 3); every button ghost except
 * the Resume form's own "Resume emails" (rule 8: that inline form is its own
 * view); Stop runs at once with an Undo toast (rule 6), Resume asks for a
 * note first. It replaces 0049's "No marketing emails" switch. Keyboard: the
 * status line is a focus target that stays mounted, and every action returns
 * focus to it (the Texts row's rule, PR-2 R3-M9).
 */
type Ready = Extract<EmailLoad, { status: "ready" }>;

function Block({ children, state, showTitle }: { children: React.ReactNode; state?: string; showTitle: boolean }) {
  return (
    <div className="space-y-1.5" data-testid="email-row" data-state={state}>
      {showTitle ? (
        <p className="text-muted-foreground font-mono text-[10px] font-medium tracking-[0.14em] uppercase">{m["contact.messages.title"]}</p>
      ) : null}
      {children}
    </div>
  );
}

export function EmailRow({ accountId, contactId, load, showTitle, onChanged = () => {}, onRetry }: {
  accountId: string;
  contactId: string;
  load: EmailLoad;
  /** True when the Texts row above shows no Messages label (no textable number). */
  showTitle: boolean;
  onChanged?: () => void;
  onRetry?: () => void;
}) {
  if (load.status === "loading") {
    return (
      <Block showTitle={showTitle}>
        <div className="space-y-2" data-testid="email-row-skeleton">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-32" />
        </div>
      </Block>
    );
  }
  if (load.status === "error") {
    return (
      <Block showTitle={showTitle}>
        <p className="text-muted-foreground text-sm">{m["contact.email.loadFailed"]}</p>
        {onRetry ? <Button size="sm" variant="ghost" onClick={onRetry}>{m["common.retry"]}</Button> : null}
      </Block>
    );
  }
  if (load.view.kind === "no_email") return null;
  return <ReadyRow key={contactId} accountId={accountId} contactId={contactId} load={load} showTitle={showTitle} onChanged={onChanged} />;
}

function ReadyRow({ accountId, contactId, load, showTitle, onChanged }: {
  accountId: string; contactId: string; load: Ready; showTitle: boolean; onChanged: () => void;
}) {
  const [adopted, setAdopted] = useState(load);
  const [view, setView] = useState<EmailView>(load.view);
  const [resuming, setResuming] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const status = useRef<HTMLDivElement>(null);

  // A re-read is the truth, adopted during render (React's pattern for a prop that changed).
  if (adopted !== load) {
    setAdopted(load);
    setView(load.view);
  }

  const run = (work: () => Promise<void>): boolean => runGuarded(busy, startTransition, work);
  const show = (next: EmailView) => {
    setView(next);
    setResuming(false);
    setNote("");
    queueMicrotask(() => status.current?.focus());
  };
  const undo = (u: EmailUndo): Promise<EmailActionResult> => undoStopEmailsAction(accountId, contactId, u.eventId);
  const act = (call: () => Promise<EmailActionResult>, success: string, withUndo = true) => {
    if (pending || busy.current) return;
    run(async () => {
      await runEmailAction(call, show, toast, { success, undo: withUndo ? undo : undefined, run, onChanged });
    });
  };

  if (view.kind === "no_email") return null;
  const line = emailLine(view, load.zone);
  const pill = view.kind === "allowed" ? EMAIL_TREATMENT.allowed : EMAIL_TREATMENT.stopped;

  return (
    <Block state={view.kind} showTitle={showTitle}>
      <div ref={status} tabIndex={-1} data-testid="email-row-status"
        className="flex items-center gap-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span>{m["contact.messages.email"]}</span>
        <DotPill {...pill} dense data-status={view.kind} />
      </div>
      {line ? <p className="text-muted-foreground text-xs">{line}</p> : null}

      {view.kind === "allowed" ? (
        <Button size="sm" variant="ghost" disabled={pending}
          onClick={() => act(() => stopEmailsAction(accountId, contactId, view.newestId), m["contact.email.stoppedToast"])}>
          {m["contact.email.stopEmails"]}
        </Button>
      ) : null}

      {view.kind === "stopped" && !view.canResume ? (
        <p className="text-muted-foreground text-xs">{noResumeLine(view.how)}</p>
      ) : null}
      {view.kind === "stopped" && view.canResume && !resuming ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setNote(""); setResuming(true); }}>
          {m["contact.email.resume"]}
        </Button>
      ) : null}
      {view.kind === "stopped" && view.canResume && resuming ? (
        <form className="space-y-2" data-testid="email-resume-form" onSubmit={(e) => {
          e.preventDefault();
          act(() => resumeEmailsAction(accountId, contactId, view.eventId, note), m["contact.email.resumedToast"], false);
        }}>
          <Label htmlFor={`email-resume-${contactId}`}>{m["contact.email.resumeNoteLabel"]}</Label>
          <Input id={`email-resume-${contactId}`} name="note" value={note} required aria-required="true" autoFocus
            onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || !note.trim()}>{m["contact.email.resumeSubmit"]}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => {
              setResuming(false);
              queueMicrotask(() => status.current?.focus());
            }}>{m["contact.email.resumeCancel"]}</Button>
          </div>
        </form>
      ) : null}
    </Block>
  );
}
