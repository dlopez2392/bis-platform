"use client";

import { useId } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { nativeFieldClass } from "@/components/ui/input";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@bis/db/document-rules";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { UploadPhase } from "@/lib/documents/upload-client";
import { cn } from "@/lib/utils";

/**
 * The inline batch panel (spec 4.2): one category per file, ONE Owners-only choice and ONE optional
 * expiry for the batch, made BEFORE the file exists (an Owners-only file is never visible to the team,
 * even briefly), then the card's one primary, Upload (rule 8). Presentational: the card holds the state.
 */
export type PanelFile = { key: string; file: File; title: string; category: DocumentCategory; phase: UploadPhase | null };

const focusRing = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function phaseText(phase: UploadPhase | null, locale: Locale): string | null {
  if (!phase) return null;
  if (phase.kind === "uploading") return t(m, "documents.progress.uploading", locale, { percent: phase.percent });
  if (phase.kind === "checking") return t(m, "documents.progress.checking", locale);
  if (phase.kind === "failed") return t(m, phase.error as MessageKey, locale, phase.params);
  return null;
}

export function DocumentUploadPanel(p: {
  files: PanelFile[]; ownersOnly: boolean; expiresOn: string; canChooseOwnersOnly: boolean; busy: boolean; locale: Locale;
  onCategory: (key: string, c: DocumentCategory) => void; onRemove: (key: string) => void;
  onOwnersOnly: (v: boolean) => void; onExpires: (v: string) => void;
  onUpload: () => void; onRetry: (key: string) => void; onCancel: () => void;
}) {
  const id = useId();
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, p.locale, params);
  return (
    <div data-documents-panel className="space-y-3 rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <ul className="space-y-2">
        {p.files.map((f) => {
          const status = phaseText(f.phase, p.locale);
          const failed = f.phase?.kind === "failed";
          return (
            <li key={f.key} data-panel-file={f.key} className="grid gap-1.5 border-t border-[var(--row-line)] pt-2 first:border-t-0 first:pt-0">
              <div className="flex min-w-0 items-center gap-2">
                <span lang="" className="min-w-0 flex-1 truncate text-sm text-card-foreground" title={f.file.name}>{f.file.name}</span>
                {!p.busy && !f.phase ? (
                  <Button type="button" variant="ghost" size="icon-sm" className={cn("min-h-11 md:min-h-8", focusRing)}
                    aria-label={tt("documents.removeFile", { name: f.file.name })} onClick={() => p.onRemove(f.key)}>
                    <X aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
              <label className="grid gap-1 text-xs text-muted-foreground">
                {tt("documents.field.category")}
                <select className={cn(nativeFieldClass, "min-h-11 md:min-h-8")} value={f.category} disabled={p.busy}
                  onChange={(e) => p.onCategory(f.key, e.target.value as DocumentCategory)}>
                  {DOCUMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{tt(`documents.category.${c}` as MessageKey)}</option>
                  ))}
                </select>
              </label>
              {status ? (
                <div className="flex items-center gap-2 text-xs" aria-live="polite">
                  <span className={failed ? "text-[var(--crit)]" : "text-muted-foreground"}>{status}</span>
                  {f.phase?.kind === "uploading" ? (
                    <span aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                      <span className="block h-full bg-[var(--accent)] motion-safe:transition-[width] motion-safe:duration-150" style={{ width: `${f.phase.percent}%` }} />
                    </span>
                  ) : null}
                  {failed ? (
                    <Button type="button" variant="ghost" size="sm" data-panel-retry className={cn("min-h-11 md:min-h-8", focusRing)}
                      disabled={p.busy} onClick={() => p.onRetry(f.key)}>{tt("documents.retry")}</Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {p.canChooseOwnersOnly ? (
        <label data-panel-owners-only className="flex items-center gap-2 text-sm">
          <Checkbox id={`${id}-owners`} checked={p.ownersOnly} disabled={p.busy} onCheckedChange={(v) => p.onOwnersOnly(v === true)} />
          {tt("documents.panel.ownersOnly")}
        </label>
      ) : null}
      <label className="grid gap-1 text-xs text-muted-foreground">
        {tt("documents.panel.expires")}
        <input type="date" className={cn(nativeFieldClass, "min-h-11 md:min-h-8")} value={p.expiresOn} disabled={p.busy}
          onChange={(e) => p.onExpires(e.target.value)} />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" className={cn("min-h-11 md:min-h-8", focusRing)} disabled={p.busy} onClick={p.onCancel}>
          {tt("documents.cancel")}
        </Button>
        <Button type="button" className={cn("min-h-11 md:min-h-8", focusRing)} disabled={p.busy || p.files.length === 0} onClick={p.onUpload}>
          {tt("documents.upload")}
        </Button>
      </div>
    </div>
  );
}
