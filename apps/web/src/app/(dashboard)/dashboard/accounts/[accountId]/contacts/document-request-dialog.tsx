"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { nativeFieldClass } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DOCUMENT_CATEGORIES, DOCUMENT_REQUEST_NOTE_MAX, cleanRequestItems, type DocumentCategory, type DocumentRequestItem,
} from "@bis/db/document-rules";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";

/**
 * "Ask the customer" (spec 4.2): what to ask for (the vault's nine categories, Other with its own words),
 * and how it goes (Text, Email, or Copy link). Only the channels the request client offered can be
 * chosen; the server checks the offer again before it writes. The dialog's one primary is Send request,
 * or Create link when the link is the channel (rule 8). The purge dialog's split: the form is
 * presentational and portal-free, so the styleguide and the test draw it inline.
 */
export type RequestChannel = "text" | "email" | "link";
const CHANNEL_ORDER: readonly RequestChannel[] = ["text", "email", "link"];

/** Text when it can go by text, else Email when it can go by email, else the link. */
export function seedChannel(channels: { text: boolean; email: boolean }): RequestChannel {
  return channels.text ? "text" : channels.email ? "email" : "link";
}

/** Pure: what the form submits, in the vault's order whatever order the boxes were ticked, or the words for what is missing. */
export function requestFromForm(s: { picked: ReadonlySet<DocumentCategory>; note: string }): { items: DocumentRequestItem[] } | { error: MessageKey } {
  const picked = DOCUMENT_CATEGORIES.filter((c) => s.picked.has(c));
  if (picked.length === 0) return { error: "documents.request.pickOne" };
  if (s.picked.has("other") && !s.note.trim()) return { error: "documents.request.noteNeeded" };
  const items = cleanRequestItems(picked.map((c) => ({ key: c, category: c, note: c === "other" ? s.note.trim() : null })));
  // Only Other's note can fail the clean once something is ticked (a control code at an edge of the note).
  return items ? { items } : { error: "documents.request.noteNeeded" };
}

/** "Ask Ana for documents"; with no name to show, the action's own words. */
export function requestTitle(name: string, locale: Locale): string {
  return name.trim() ? t(m, "documents.request.title", locale, { name: name.trim() }) : t(m, "documents.request.open", locale);
}

const focusRing = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const control = cn("min-h-11 md:min-h-8", focusRing);
const legend = "mb-1 text-sm font-medium text-card-foreground";

export type DocumentRequestFormProps = {
  locale: Locale; name: string; channels: { text: boolean; email: boolean };
  initialItems?: readonly DocumentCategory[]; busy: boolean; error: MessageKey | null;
  onSubmit: (items: DocumentRequestItem[], channel: RequestChannel) => void; onCancel: () => void;
  /** How the title is drawn: a plain heading inline, the dialog's own title inside the dialog. */
  renderTitle?: (title: string) => ReactNode;
};

export function DocumentRequestForm(p: DocumentRequestFormProps) {
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, p.locale, params);
  const id = useId();
  const [picked, setPicked] = useState<ReadonlySet<DocumentCategory>>(() => new Set(p.initialItems ?? []));
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState<RequestChannel>(() => seedChannel(p.channels));
  const [localError, setLocalError] = useState<MessageKey | null>(null);
  const offered = (ch: RequestChannel) => ch === "link" || p.channels[ch];
  // A re-read can take a channel away while the dialog is open: the choice falls back, never a disabled radio left checked.
  const chosen = offered(channel) ? channel : seedChannel(p.channels);
  const shown = localError ?? p.error;
  const toggle = (c: DocumentCategory, on: boolean) => {
    setLocalError(null);
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(c); else next.delete(c);
      return next;
    });
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (p.busy) return;
    const r = requestFromForm({ picked, note });
    if ("error" in r) { setLocalError(r.error); return; }
    setLocalError(null);
    p.onSubmit(r.items, chosen);
  };
  const title = requestTitle(p.name, p.locale);
  return (
    <form data-document-request-form noValidate onSubmit={submit} className="space-y-4">
      {p.renderTitle ? p.renderTitle(title) : <h3 className="text-base font-semibold text-card-foreground">{title}</h3>}
      <fieldset disabled={p.busy} className="min-w-0">
        <legend className={legend}>{tt("documents.request.what")}</legend>
        <div className="grid gap-x-4 sm:grid-cols-2">
          {DOCUMENT_CATEGORIES.map((c) => (
            <label key={c} data-request-category={c} className="flex min-h-11 items-center gap-2 text-sm md:min-h-8">
              <Checkbox checked={picked.has(c)} onCheckedChange={(v) => toggle(c, v === true)} />
              {tt(`documents.category.${c}` as MessageKey)}
            </label>
          ))}
        </div>
      </fieldset>
      {picked.has("other") ? (
        <label className="grid gap-1 text-xs text-muted-foreground">
          {tt("documents.request.otherNote")}
          <input type="text" lang="" data-request-note className={cn(nativeFieldClass, "min-h-11 md:min-h-8")} value={note}
            maxLength={DOCUMENT_REQUEST_NOTE_MAX} disabled={p.busy} autoComplete="off"
            onChange={(e) => { setLocalError(null); setNote(e.target.value); }} />
        </label>
      ) : null}
      <fieldset disabled={p.busy} className="min-w-0">
        <legend className={legend}>{tt("documents.request.how")}</legend>
        <div className="grid gap-1">
          {CHANNEL_ORDER.map((ch) => {
            const off = !offered(ch);
            return (
              <label key={ch} data-request-channel={ch}
                className={cn("flex min-h-11 flex-wrap items-center gap-x-2 text-sm md:min-h-8", off && "cursor-not-allowed")}>
                <input type="radio" name={`${id}-channel`} value={ch} checked={chosen === ch} disabled={off}
                  onChange={() => { setLocalError(null); setChannel(ch); }}
                  className="size-4 shrink-0 accent-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]" />
                <span className={off ? "text-[var(--text-3)]" : "text-card-foreground"}>{tt(`documents.request.channel.${ch}` as MessageKey)}</span>
                {off ? (
                  <span className="basis-full pl-6 text-xs text-[var(--text-2)]">
                    {tt(ch === "text" ? "documents.request.textOff" : "documents.request.emailOff")}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      </fieldset>
      {shown ? <p role="alert" data-request-error className="text-sm text-[var(--crit)]">{tt(shown)}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" className={control} onClick={p.onCancel}>{tt("documents.request.cancel")}</Button>
        <Button type="submit" className={control} disabled={p.busy}>
          {tt(chosen === "link" ? "documents.request.createLink" : "documents.request.send")}
        </Button>
      </div>
    </form>
  );
}

/**
 * The dialog (the purge dialog's wrapper): Esc and the close button close it, and Radix returns focus to
 * what opened it, the card's "Ask the customer". The form is drawn only while open, so every opening
 * starts clean.
 */
export function DocumentRequestDialog({ open, onClose, ...form }: Omit<DocumentRequestFormProps, "onCancel" | "renderTitle"> & {
  open: boolean; onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-document-request-dialog aria-describedby={undefined} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {open ? (
          <DocumentRequestForm {...form} onCancel={onClose}
            renderTitle={(title) => <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
