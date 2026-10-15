"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { DocumentView } from "@/lib/documents/documents-load";
import { purgeNameKey } from "@/lib/documents/rules";

/**
 * Delete forever (spec 4.4; DESIGN.md "Documents": only a typed name confirms a PERMANENT purge, and the
 * trash move never shares this confirmation). The name must be typed as the screen shows it, compared in
 * `purgeNameKey`'s form (plan deviation 8, Task 7 review I2: NFC, whitespace runs as one space, no case
 * folding); the server compares in the same form again. The dialog's one primary is the destructive
 * button (rule 8).
 */
export function canPurge(typed: string, title: string): boolean {
  return purgeNameKey(typed) === purgeNameKey(title);
}

const control = "min-h-11 md:min-h-8";

/** Presentational, so the styleguide can draw it inline and the test can read it without a portal. */
export function DocumentPurgeForm({ title, versionCount, typed, busy, locale, bodyId, onTyped, onCancel, onConfirm }: {
  title: string; versionCount: number; typed: string; busy: boolean; locale: Locale; bodyId?: string;
  onTyped: (v: string) => void; onCancel: () => void; onConfirm: () => void;
}) {
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  const matches = canPurge(typed, title);
  const nearMiss = typed !== "" && !matches;
  const hintId = useId();
  // Review M11: "all of its versions" only when there is more than one. The title is a name in no
  // language (review M6), so it is its own `lang=""` span inside the sentence: split the raw message at
  // its placeholder rather than interpolating the title into the sentence's text.
  const [before, after = ""] = tt(versionCount > 1 ? "documents.purge.body" : "documents.purge.bodyOne").split("{title}");
  return (
    <div data-document-purge-form className="space-y-3">
      <p id={bodyId} className="text-sm text-muted-foreground">{before}<span lang="">{title}</span>{after}</p>
      <label className="block space-y-1 text-sm">
        <span>{tt("documents.purge.label")}</span>
        <Input lang="" value={typed} autoComplete="off" spellCheck={false} aria-invalid={nearMiss}
          aria-describedby={nearMiss ? hintId : undefined} onChange={(e) => onTyped(e.target.value)} />
      </label>
      {nearMiss ? <p id={hintId} data-purge-mismatch className="text-xs text-muted-foreground">{tt("documents.purge.mismatch")}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" className={control} onClick={onCancel}>{tt("documents.cancel")}</Button>
        <Button type="button" variant="destructive" className={control} disabled={!matches || busy} onClick={onConfirm}>
          {tt("documents.deleteForever")}
        </Button>
      </div>
    </div>
  );
}

/**
 * One open dialog per file: keyed by the file, so the typed name never carries over to another (no effect
 * resets it). Exported for its test only (review M3): it must hand the form the file's real version count.
 */
export function DocumentPurgeBody({ doc, locale, bodyId, onClose, onConfirm }: {
  doc: DocumentView; locale: Locale; bodyId: string; onClose: () => void; onConfirm: (doc: DocumentView, typed: string) => Promise<boolean>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  // `onConfirm` answers true once the server has answered at all (review I2: a refusal also reloads the card and
  // closes, the toast says why); false only when nothing was sent (a click while a write is in flight).
  const confirm = () => {
    setBusy(true);
    void onConfirm(doc, typed).then((done) => { if (done) onClose(); else setBusy(false); }, () => setBusy(false));
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(m, "documents.deleteForever", locale)}</DialogTitle>
      </DialogHeader>
      <DocumentPurgeForm title={doc.title} versionCount={doc.versions.length} typed={typed} busy={busy} locale={locale} bodyId={bodyId}
        onTyped={setTyped} onCancel={onClose} onConfirm={confirm} />
    </>
  );
}

export function DocumentPurgeDialog({ doc, locale, onClose, onConfirm }: {
  doc: DocumentView | null; locale: Locale; onClose: () => void; onConfirm: (doc: DocumentView, typed: string) => Promise<boolean>;
}) {
  // The body paragraph IS the dialog's description: DialogContent hands every prop to Radix's Content
  // (`components/ui/dialog.tsx:51-63`), so aria-describedby names it and no DialogDescription repeats it.
  const bodyId = useId();
  return (
    <Dialog open={doc !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-document-purge-dialog aria-describedby={bodyId}>
        {doc ? <DocumentPurgeBody key={doc.id} doc={doc} locale={locale} bodyId={bodyId} onClose={onClose} onConfirm={onConfirm} /> : null}
      </DialogContent>
    </Dialog>
  );
}
