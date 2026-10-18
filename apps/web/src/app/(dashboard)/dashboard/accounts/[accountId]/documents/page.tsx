import Link from "next/link";
import { FolderOpen, ArrowLeft, ArrowRight } from "lucide-react";
import { countAccountDocuments, listAccountDocuments, listPeopleNames, DOCUMENT_CATEGORIES, type DocumentCategory, type AccountDocumentsShow } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import type { Locale } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/messages";
import { makeTr } from "@/lib/record/copy";
import { documentsClock, documentView } from "@/lib/documents/document-view";
import { loggableError } from "@/lib/loggable-error";
import {
  DOCUMENTS_PAGE_SIZE, documentsQuery, documentsHref, documentsPagerHrefs, filedOnView, type DocumentsRowView,
} from "@/lib/documents/account-list";
import { DocumentsList } from "./documents-list";
import { CategoryFilter } from "./category-filter";

export const dynamic = "force-dynamic";

/**
 * The account-wide Documents page (S-07 3a, spec 3.1; DESIGN.md's sidebar and module contract amended
 * 2026-10-17). Every role: requireAccountAccess only, and every read on the REQUEST client, so 0077's RLS
 * decides each row (a Technician sees assigned customers' files; Owners-only files only Owners and the
 * agency). Server-side filter, sort and cursor paging; the header states the REAL total for the filter (a
 * failed count throws to error.tsx, never "0"). No hero (rule 11), no checkboxes (rule 4), no primary (rule 8).
 */
const SHOWS: AccountDocumentsShow[] = ["expiring", "expired", "all"];
const EMPTY: Record<AccountDocumentsShow, { title: MessageKey; body?: MessageKey }> = {
  expiring: { title: "documents.page.empty.expiring", body: "documents.page.empty.expiringBody" },
  expired: { title: "documents.page.empty.expired" },
  all: { title: "documents.page.empty.all", body: "documents.page.empty.allBody" },
};

export default async function DocumentsPage({ params, searchParams }: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ show?: string; category?: string; before?: string; locale?: string }>;
}) {
  const { accountId } = await params;
  const sp = await searchParams;
  const access = await requireAccountAccess(accountId);
  const db = await dbForRequest(); // RLS-scoped: NEVER the service client here
  // A ?before= that does not fit this list (or names an impossible day) is page one, never the error state.
  const q = documentsQuery(sp);
  const [prefs, account, clock] = await Promise.all([
    getPersonPrefs(),
    db.from("accounts").select("language").eq("id", accountId).maybeSingle(),
    documentsClock(db, accountId),
  ]);
  if (account.error) console.error(`documents page: account ${accountId} language read failed: ${account.error.message}`);
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: (account.data as { language: Locale | null } | null)?.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, { locale: sp.locale });
  const tr = makeTr(locale, requestPseudoMode({ locale: sp.locale }));
  // "Today" is the ACCOUNT's day (documentsClock), never the server's UTC date.
  const filter = { show: q.show, category: q.category, today: clock.today };
  const [rows, total] = await Promise.all([
    listAccountDocuments(db, accountId, filter, { before: q.cursor, limit: DOCUMENTS_PAGE_SIZE + 1 }),
    countAccountDocuments(db, accountId, filter),
  ]);
  const hasMore = rows.length > DOCUMENTS_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, DOCUMENTS_PAGE_SIZE) : rows;
  // Names are a convenience: a failed read reads "Someone on the team", never a failed page.
  const names = await listPeopleNames(db, [...new Set(page.map((d) => d.created_by))]).catch((e: unknown) => {
    console.error(`documents page names (account ${accountId}): ${loggableError(e)}`);
    return {} as Record<string, string>;
  });
  const base = `/dashboard/accounts/${accountId}/documents`;
  const noName = tr.text("documents.page.noName");
  const views: DocumentsRowView[] = page.map((d) => ({
    doc: documentView(d, access.userId, names, clock.zone),
    filedOn: filedOnView(accountId, d, noName),
  }));
  const pager = documentsPagerHrefs(base, q, hasMore, page[page.length - 1]);
  const categories = [
    { value: "", label: tr.text("documents.page.category.any"), href: documentsHref(base, { show: q.show, category: null }) },
    ...DOCUMENT_CATEGORIES.map((c: DocumentCategory) => ({
      value: c, label: tr.text(`documents.category.${c}` as MessageKey), href: documentsHref(base, { show: q.show, category: c }),
    })),
  ];
  const empty = EMPTY[q.show];

  return (
    <div lang={locale}>
      <PageHeader
        title={tr.text("documents.page.title")}
        count={tr.count("documents.count", total)}
        filters={
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <nav aria-label={tr.text("documents.page.show.label")} className="flex min-w-0 flex-wrap items-center gap-1">
              {SHOWS.map((s) => (
                <Link key={s} href={documentsHref(base, { show: s, category: q.category })} aria-current={q.show === s ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-full px-3 text-sm whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-8",
                    q.show === s ? "bg-[var(--accent-dim)] font-medium text-foreground" : "text-muted-foreground hover:bg-[var(--surface-3)] hover:text-foreground",
                  )}>
                  {tr.text(`documents.page.show.${s}` as MessageKey)}
                </Link>
              ))}
            </nav>
            <CategoryFilter label={tr.text("documents.page.category.label")} current={q.category ?? ""} options={categories} />
          </div>
        }
      />
      {/* Task 10 mounts the Owner's Required documents card as this column's first child, above the list. */}
      <div className="space-y-4 p-6">
        {page.length === 0 && !q.cursor ? (
          // The cold start: page one with nothing on it. A cursored zero is real history with nothing past the
          // cursor: no empty state, just the start link below (contacts/page.tsx's rule).
          <EmptyState icon={FolderOpen} title={tr.text(empty.title)} body={empty.body ? tr.text(empty.body) : undefined} />
        ) : (
          <DocumentsList accountId={accountId} locale={locale} today={clock.today} now={new Date().toISOString()} rows={views} />
        )}
        {pager.next || pager.first ? (
          <div data-documents-pager className="flex items-center justify-between gap-3">
            <div>
              {pager.first ? (
                <Link href={pager.first} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 md:min-h-8")}>
                  <ArrowLeft className="size-3.5" aria-hidden />{tr.text("documents.page.first")}
                </Link>
              ) : null}
            </div>
            <div>
              {pager.next ? (
                <Link href={pager.next} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 md:min-h-8")}>
                  {tr.text("documents.page.next")}<ArrowRight className="size-3.5" aria-hidden />
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
