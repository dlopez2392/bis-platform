"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Lock } from "lucide-react";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { expiryView, expiryText } from "@/lib/documents/expiry";
import { rowScan } from "@/lib/documents/scan-state";
import type { DocumentsRowView } from "@/lib/documents/account-list";
import { DocumentViewer } from "../contacts/document-viewer";
import { ExpiryLine, ScanStatus, addedWhen, sourceLine } from "../contacts/documents-card";
import { documentHandlers } from "../contacts/documents-card-handlers";

/**
 * The Documents page's rows (spec 3.1). The WHOLE row opens the existing viewer (rule 4: the open
 * button's ::after is stretched over the row, its ring is the row's, inset so the list's rounded clip
 * never cuts it); the filed-on name is its own link and focus target, raised above that overlay.
 * --surface-3 hover. No checkboxes: no bulk actions here. Expiry and scan state are a dot AND a word
 * (rule 3), the card's own ExpiryLine/ScanStatus.
 */
export function DocumentsList({ accountId, locale, today, now, rows }: {
  accountId: string; locale: Locale; today: string; now: string; rows: DocumentsRowView[];
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  // Review M3: the button is NAMED by its title and DESCRIBED by its facts line (expiry, scan, Owners only).
  const factsPrefix = useId();
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  const handlers = documentHandlers({ accountId, locale, reload: () => router.refresh(), reloadRequests: () => {} });
  const open = rows.find((r) => r.doc.id === openId)?.doc ?? null;
  const openExpiry = open ? expiryView(open.expiresOn, today) : null;
  return (
    <>
      <ul data-documents-page className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)] bg-card">
        {rows.map(({ doc, filedOn }) => (
          <li key={doc.id} data-documents-page-row={doc.id}
            className="relative flex items-start gap-3 border-t border-[var(--row-line)] px-4 py-3 first:border-t-0 hover:bg-[var(--surface-3)] motion-safe:transition-colors motion-safe:duration-150">
            <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <button type="button" data-document-open onClick={() => setOpenId(doc.id)} aria-label={tt("documents.open", { title: doc.title })}
              aria-describedby={`${factsPrefix}-${doc.id}`}
              className={cn("min-w-0 flex-1 text-left outline-none", "after:absolute after:inset-0 after:content-['']",
                "focus-visible:after:ring-[3px] focus-visible:after:ring-inset focus-visible:after:ring-ring/50")}>
              <span lang="" className="block truncate text-sm font-medium text-card-foreground">{doc.title}</span>
              <span id={`${factsPrefix}-${doc.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                <span>{tt(`documents.category.${doc.category}` as MessageKey)}</span>
                <ScanStatus scan={rowScan(doc, now)} locale={locale} />
                <ExpiryLine expiresOn={doc.expiresOn} today={today} locale={locale} />
                <span>{sourceLine(doc, today, locale)}</span>
                {doc.ownersOnly ? (
                  <span data-owners-only className="inline-flex items-center gap-1"><Lock aria-hidden="true" className="size-3" />{tt("documents.ownersOnly")}</span>
                ) : null}
              </span>
            </button>
            {/* A name is not translated (lang=""); max-w keeps the row's facts readable at 360 px with a long name. */}
            <Link href={filedOn.href} aria-label={tt("documents.page.openRecord", { name: filedOn.name })}
              className="relative z-10 inline-flex min-h-11 max-w-[45%] shrink-0 items-center rounded-[var(--radius-ctl)] px-1 text-sm text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8">
              <span lang="" className="min-w-0 truncate">{filedOn.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      <DocumentViewer accountId={accountId} doc={open} locale={locale} onClose={() => setOpenId(null)}
        onDownload={(d) => void handlers.download(d)}
        onDownloadVersion={(d, versionId) => void handlers.download(d, versionId)}
        versionWhen={(day) => addedWhen(day, today, locale)}
        header={{ source: open ? sourceLine(open, today, locale) : "", expiry: openExpiry ? expiryText(openExpiry, locale) : null }} />
    </>
  );
}
