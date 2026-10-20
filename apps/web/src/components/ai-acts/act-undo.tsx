"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { makeTr, type Tr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { redoAiFieldFillAction, undoAiActAction } from "@/lib/ai-acts/actions";
import { runBookingUndo, runContactUndo, runFieldUndo } from "@/lib/ai-acts/undo-handlers";
import { typedNameMatches, type AiActView } from "@/lib/ai-acts/view";

/**
 * The three Undo controls (item 8c, plan Task 6), each a ghost trigger (DESIGN.md rule 8: the row itself
 * carries no primary). `"use client"`: this is the only file under `components/ai-acts/` that is — the view
 * (`act-row.tsx`) is server-safe and never calls into it directly, only renders it as a child.
 */

const CTL = "min-h-11 md:min-h-8";

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
        <label htmlFor={checkboxId} className="flex items-center gap-2 text-sm">
          <input id={checkboxId} type="checkbox" checked={ticked} disabled={busy}
            onChange={(e) => onTicked(e.target.checked)} />
          {tr.text("aiActs.notify.label", { name: notify.name })}
        </label>
      ) : notify ? (
        <p data-ai-act-no-email="" className="text-xs text-muted-foreground">{notify.none}</p>
      ) : null}
      <div className="flex justify-end gap-2">
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

/** Presentational (the `DocumentPurgeForm` shape again): the typed name must match the display name
 *  exactly as `typedNameMatches` compares it; the ONE primary is disabled until it does. */
export function ContactUndoForm({
  tr, persona, contactName, typed, busy, bodyId, onTyped, onCancel, onConfirm,
}: {
  tr: Tr; persona: string; contactName: string; typed: string; busy: boolean; bodyId?: string;
  onTyped: (v: string) => void; onCancel: () => void; onConfirm: () => void;
}) {
  const matches = typedNameMatches(typed, { first_name: contactName, last_name: null });
  return (
    <div data-ai-act-contact-form="" className="space-y-3">
      <p id={bodyId} className="text-sm text-muted-foreground">
        {tr.text("aiActs.contactDialog.body", { persona, name: contactName })}
      </p>
      <Input lang="" autoComplete="off" spellCheck={false} value={typed} disabled={busy}
        onChange={(e) => onTyped(e.target.value)} />
      <div className="flex justify-end gap-2">
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

function FieldUndoButton({ accountId, act, tr }: { accountId: string; act: AiActView; tr: Tr }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (act.undo.state !== "available") return null;
  const field = act.undo.fieldLabel ?? "";
  return (
    <Button type="button" variant="ghost" size="sm" className={CTL} disabled={pending} data-ai-act-undo="field"
      onClick={() => startTransition(() => {
        void runFieldUndo({
          toast, tr, refresh: () => router.refresh(), reload: () => { window.location.reload(); },
          schedule: (fn, ms) => { setTimeout(fn, ms); },
          field, persona: act.persona,
          undo: () => undoAiActAction(accountId, act.id),
          redo: () => redoAiFieldFillAction(accountId, act.id),
        });
      })}>
      {tr.text("common.undo")}
    </Button>
  );
}

function BookingUndoPopover({ accountId, act, tr }: { accountId: string; act: AiActView; tr: Tr }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState(true);
  const [pending, startTransition] = useTransition();
  if (act.undo.state !== "available") return null;
  const { notify, contactName } = act.undo;
  const confirm = () => startTransition(() => {
    void runBookingUndo({
      toast, tr, refresh: () => router.refresh(), reload: () => { window.location.reload(); },
      name: contactName, notify: ticked,
      undo: (n) => undoAiActAction(accountId, act.id, { notify: n }),
    }).then((ok) => { if (ok) setOpen(false); });
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className={CTL} disabled={pending} data-ai-act-undo="booking">
          {tr.text("common.undo")}
        </Button>
      </PopoverTrigger>
      <PopoverContent data-ai-act-booking-popover="">
        <BookingUndoForm tr={tr} verb={act.verb} detail={act.detail} notify={notify} ticked={ticked} busy={pending}
          onTicked={setTicked} onCancel={() => setOpen(false)} onConfirm={confirm} />
      </PopoverContent>
    </Popover>
  );
}

function ContactUndoDialog({ accountId, act, tr }: { accountId: string; act: AiActView; tr: Tr }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const bodyId = useId();
  if (act.undo.state !== "available") return null;
  const { contactName } = act.undo;
  const confirm = () => startTransition(() => {
    void runContactUndo({
      toast, tr, refresh: () => router.refresh(), reload: () => { window.location.reload(); },
      typedName: typed, navigate: (href) => router.push(href),
      listHref: `/dashboard/accounts/${accountId}/contacts`,
      undo: (t) => undoAiActAction(accountId, act.id, { typedName: t }),
    }).then((ok) => { if (ok) setOpen(false); });
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTyped(""); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className={CTL} disabled={pending} data-ai-act-undo="contact">
          {tr.text("common.undo")}
        </Button>
      </DialogTrigger>
      <DialogContent data-ai-act-contact-dialog="" aria-describedby={bodyId}>
        <DialogHeader>
          <DialogTitle>{tr.text("aiActs.contactDialog.title", { name: contactName })}</DialogTitle>
        </DialogHeader>
        <ContactUndoForm tr={tr} persona={act.persona} contactName={contactName} typed={typed} busy={pending} bodyId={bodyId}
          onTyped={setTyped} onCancel={() => setOpen(false)} onConfirm={confirm} />
      </DialogContent>
    </Dialog>
  );
}

export function ActUndo({ accountId, act, locale }: { accountId: string; act: AiActView; locale: Locale }) {
  const tr = makeTr(locale);
  if (act.undo.state !== "available") return null;
  if (act.undo.control === "field") return <FieldUndoButton accountId={accountId} act={act} tr={tr} />;
  if (act.undo.control === "booking") return <BookingUndoPopover accountId={accountId} act={act} tr={tr} />;
  return <ContactUndoDialog accountId={accountId} act={act} tr={tr} />;
}
