"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { makeTr, type Tr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { redoAiFieldFillAction, undoAiActAction } from "@/lib/ai-acts/actions";
import { runBookingUndo, runContactUndo, runFieldUndo, type RedoResult, type UndoResult } from "@/lib/ai-acts/undo-handlers";
import { typedNameMatches, type AiActView } from "@/lib/ai-acts/view";

/**
 * The three Undo controls (item 8c, plan Task 6), each a ghost trigger (DESIGN.md rule 8: the row itself
 * carries no primary). `"use client"`: this is the only file under `components/ai-acts/` that is — the view
 * (`act-row.tsx`) is server-safe and never calls into it directly, only renders it as a child.
 *
 * After a success no router refresh runs (final review): each server action calls `revalidatePath` for the
 * record, which hands back the page's fresh render. Focus then moves to the row's new status line (design
 * M-1), since the Undo that had it is gone.
 */

const CTL = "min-h-11 md:min-h-8";

/** What the controls call. The real server actions by default; the styleguide hands INERT ones (design M-9:
 *  a specimen must never reach a server action). */
export type ActUndoRun = {
  undo: (actId: string, input?: { notify?: boolean; typedName?: string }) => Promise<UndoResult>;
  redo: (actId: string) => Promise<RedoResult>;
};

function liveRun(accountId: string): ActUndoRun {
  return {
    undo: (actId, input) => undoAiActAction(accountId, actId, input),
    redo: (actId) => redoAiFieldFillAction(accountId, actId),
  };
}

/** Design M-1: once the page's fresh render shows the row's "Undone by …" line, focus it (it is `tabIndex
 *  -1`), so a keyboard reader is not left on the Undo that just went away. The first look waits a beat:
 *  a closing popover hands focus back to its trigger on a `setTimeout(0)` (Radix's focus scope), which
 *  must not land after this. Gives up after five seconds. */
function focusLineWhenShown(actId: string): void {
  if (typeof document === "undefined") return;
  const started = Date.now();
  const tick = () => {
    const line = document.querySelector<HTMLElement>(`[data-ai-act-id="${CSS.escape(actId)}"] [data-ai-act-line]`);
    if (line) {
      line.focus();
      return;
    }
    if (Date.now() - started < 5000) window.setTimeout(tick, 100);
  };
  window.setTimeout(tick, 50);
}

/** The row's own sentence, shown again inside the booking popover so the choice is never detached from
 *  what it undoes (plan Task 6: "the row's sentence"). */
function RowSentence({ verb, detail }: { verb: string; detail: string | null }) {
  return <p className="text-sm text-card-foreground">{verb}{detail ? ` · ${detail}` : ""}</p>;
}

/** Presentational, so the styleguide and the test can draw it without a Popover portal (the
 *  `DocumentPurgeForm` shape). ONE primary (Undo), a ghost Cancel (rule 8). */
export function BookingUndoForm({
  tr, verb, detail, notify, ticked, busy, onTicked, onCancel, onConfirm,
}: {
  tr: Tr; verb: string; detail: string | null; notify: { name: string } | { none: string } | null;
  ticked: boolean; busy: boolean; onTicked: (v: boolean) => void; onCancel: () => void; onConfirm: () => void;
}) {
  const checkboxId = useId();
  return (
    <div data-ai-act-booking-form="" className="space-y-3">
      <RowSentence verb={verb} detail={detail} />
      {notify && "name" in notify ? (
        // Design I-1: the kit's Checkbox (tokens, a 4px box), on a label that is a full-size target on a phone.
        <label htmlFor={checkboxId} className="flex min-h-11 items-start gap-2 py-1 text-sm md:min-h-8">
          <Checkbox id={checkboxId} checked={ticked} disabled={busy} className="mt-0.5"
            onCheckedChange={(v) => onTicked(v === true)} />
          <span className="min-w-0 break-words">{tr.text("aiActs.notify.label", { name: notify.name })}</span>
        </label>
      ) : notify ? (
        <p data-ai-act-no-email="" className="text-xs text-muted-foreground">{notify.none}</p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" className={CTL} disabled={busy} onClick={onCancel}>
          {tr.text("common.cancel")}
        </Button>
        <Button type="button" variant="default" className={CTL} disabled={busy} onClick={onConfirm}>
          {tr.text("common.undo")}
        </Button>
      </div>
    </div>
  );
}

/** Presentational (the `DocumentPurgeForm` shape again, design M-2): a visible label naming the customer in
 *  its own `lang=""` span, the box marked `aria-invalid` with a hint on a near miss, and the ONE primary
 *  disabled until the typed name matches exactly as `typedNameMatches` compares it. */
export function ContactUndoForm({
  tr, persona, contactName, typed, busy, fromChat, bodyId, onTyped, onCancel, onConfirm,
}: {
  tr: Tr; persona: string; contactName: string; typed: string; busy: boolean;
  /** The web chat added them (review M-a): the body speaks of its form entry, not a call. */
  fromChat: boolean;
  bodyId?: string;
  onTyped: (v: string) => void; onCancel: () => void; onConfirm: () => void;
}) {
  const hintId = useId();
  const matches = typedNameMatches(typed, { first_name: contactName, last_name: null });
  const nearMiss = typed !== "" && !matches;
  // The name is a name in no language: split the label at its placeholder rather than interpolating it.
  const [before, after = ""] = tr.text("aiActs.contactDialog.label").split("{name}");
  return (
    <div data-ai-act-contact-form="" className="space-y-3">
      <p id={bodyId} className="text-sm text-muted-foreground">
        {tr.text(fromChat ? "aiActs.contactDialog.bodyChat" : "aiActs.contactDialog.body", { persona })}
      </p>
      <label className="block space-y-1 text-sm">
        <span className="block break-words">{before}<span lang="" className="font-medium text-card-foreground">{contactName}</span>{after}</span>
        <Input lang="" autoComplete="off" spellCheck={false} value={typed} disabled={busy} aria-invalid={nearMiss}
          aria-describedby={nearMiss ? hintId : undefined} onChange={(e) => onTyped(e.target.value)} />
      </label>
      {nearMiss ? <p id={hintId} data-ai-act-mismatch="" className="text-xs text-muted-foreground">{tr.text("aiActs.contactDialog.mismatch")}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" className={CTL} disabled={busy} onClick={onCancel}>
          {tr.text("common.cancel")}
        </Button>
        <Button type="button" variant="destructive" className={CTL} disabled={!matches || busy} onClick={onConfirm}>
          {tr.text("aiActs.contactDialog.confirm")}
        </Button>
      </div>
    </div>
  );
}

type ControlProps = { act: AiActView; tr: Tr; run: ActUndoRun; describedBy: string | undefined };

function FieldUndoButton({ act, tr, run, describedBy }: ControlProps) {
  const [pending, startTransition] = useTransition();
  if (act.undo.state !== "available") return null;
  const { fieldLabel, fieldWasEmpty } = act.undo;
  return (
    <Button type="button" variant="ghost" size="sm" className={CTL} disabled={pending} data-ai-act-undo="field"
      aria-describedby={describedBy}
      onClick={() => startTransition(() => {
        void runFieldUndo({
          toast, tr, reload: () => { window.location.reload(); },
          schedule: (fn, ms) => { setTimeout(fn, ms); },
          field: fieldLabel ?? "", wasEmpty: fieldWasEmpty, persona: act.persona,
          undo: () => run.undo(act.id),
          redo: () => run.redo(act.id),
        }).then((ok) => { if (ok) focusLineWhenShown(act.id); });
      })}>
      {tr.text("common.undo")}
    </Button>
  );
}

function BookingUndoPopover({ act, tr, run, describedBy }: ControlProps) {
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState(true);
  const [pending, startTransition] = useTransition();
  if (act.undo.state !== "available") return null;
  const { notify, contactName } = act.undo;
  const confirm = () => startTransition(() => {
    void runBookingUndo({
      toast, tr, reload: () => { window.location.reload(); },
      name: contactName, notify: ticked,
      undo: (n) => run.undo(act.id, { notify: n }),
    }).then((ok) => {
      if (!ok) return;
      setOpen(false);
      focusLineWhenShown(act.id);
    });
  });
  return (
    // Design M-3: every opening starts ticked, whatever an earlier opening left.
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setTicked(true); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className={CTL} disabled={pending} data-ai-act-undo="booking"
          aria-describedby={describedBy}>
          {tr.text("common.undo")}
        </Button>
      </PopoverTrigger>
      {/* Design I-2: a portal leaves the row's lang behind, so the panel carries its own. */}
      <PopoverContent lang={tr.locale} data-ai-act-booking-popover="">
        <BookingUndoForm tr={tr} verb={act.verb} detail={act.detail} notify={notify} ticked={ticked} busy={pending}
          onTicked={setTicked} onCancel={() => setOpen(false)} onConfirm={confirm} />
      </PopoverContent>
    </Popover>
  );
}

function ContactUndoDialog({ accountId, act, tr, run, describedBy }: ControlProps & { accountId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const bodyId = useId();
  if (act.undo.state !== "available") return null;
  const { contactName } = act.undo;
  const confirm = () => startTransition(() => {
    void runContactUndo({
      toast, tr, reload: () => { window.location.reload(); },
      typedName: typed, fromChat: act.actor === "webchat", navigate: (href) => router.push(href),
      listHref: `/dashboard/accounts/${accountId}/contacts`,
      undo: (t) => run.undo(act.id, { typedName: t }),
    }).then((ok) => { if (ok) setOpen(false); });
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTyped(""); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className={CTL} disabled={pending} data-ai-act-undo="contact"
          aria-describedby={describedBy}>
          {tr.text("common.undo")}
        </Button>
      </DialogTrigger>
      {/* Design I-2: the portal's own lang, as place-dialog.tsx's. */}
      <DialogContent lang={tr.locale} data-ai-act-contact-dialog="" aria-describedby={bodyId}>
        <DialogHeader>
          {/* Design I-7: a long name wraps inside the title rather than pushing the dialog sideways. */}
          <DialogTitle className="leading-snug [overflow-wrap:anywhere]">{tr.text("aiActs.contactDialog.title", { name: contactName })}</DialogTitle>
        </DialogHeader>
        <ContactUndoForm tr={tr} persona={act.persona} contactName={contactName} typed={typed} busy={pending} bodyId={bodyId}
          fromChat={act.actor === "webchat"} onTyped={setTyped} onCancel={() => setOpen(false)} onConfirm={confirm} />
      </DialogContent>
    </Dialog>
  );
}

export function ActUndo({ accountId, act, locale, describedBy, run }: {
  accountId: string; act: AiActView; locale: Locale;
  /** The id of the row's sentence (design M-5), so the Undo says what it undoes. */
  describedBy?: string;
  /** Absent on the record page (the real actions); the styleguide hands inert ones. */
  run?: ActUndoRun;
}) {
  const tr = makeTr(locale);
  if (act.undo.state !== "available") return null;
  const props: ControlProps = { act, tr, run: run ?? liveRun(accountId), describedBy };
  if (act.undo.control === "field") return <FieldUndoButton {...props} />;
  if (act.undo.control === "booking") return <BookingUndoPopover {...props} />;
  return <ContactUndoDialog accountId={accountId} {...props} />;
}
