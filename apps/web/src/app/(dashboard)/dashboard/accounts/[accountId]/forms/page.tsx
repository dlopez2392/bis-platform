import Link from "next/link";
import { FileText } from "lucide-react";
import { listForms } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { ListPanel, LIST_ROW } from "@/components/ui/list-panel";
import { cn } from "@/lib/utils";
import { formatDateTimeInZone } from "@/lib/format";
import { requireNotTechnician } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { renderZone } from "@/lib/zone";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { FORM_STATUS_KEY, labelIn } from "@/lib/labels";
import { NewFormDialog } from "./new-form-dialog";
import { createFormAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function FormsPage({
  params, searchParams,
}: { params: Promise<{ accountId: string }>; searchParams: Promise<{ locale?: string }> }) {
  const { accountId } = await params;
  const { locale: localeParam } = await searchParams;
  // F-085 part 1 (spec §7.1): a Technician does not work here and is sent
  // to To do; everyone the [accountId] layout admitted passes straight on.
  const { isAgency } = await requireNotTechnician(accountId);
  const db = await dbForRequest();
  const prefs = await getPersonPrefs();
  const pseudo = requestPseudoMode({ locale: localeParam });
  const [forms, account] = await Promise.all([
    listForms(db, accountId),
    // The zone each row's own `created_at` renders in below — not a throw:
    // one cosmetic date column must not take the whole list down, same
    // reasoning as the contacts list's own read (D-010).
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle(),
  ]);
  if (account.error) {
    console.error(`forms: account ${accountId} timezone read failed: ${account.error.message}`);
  }
  const accountRow = account.data as { timezone: string; language?: Locale | null } | null;
  const zone = await renderZone(accountRow?.timezone);
  const accountLanguage = { language: accountRow?.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: isAgency, userLanguage: prefs.language }, { locale: localeParam });

  return (
    <>
      <PageHeader
        title={t(m, "forms.title", locale)}
        actions={<NewFormDialog action={createFormAction.bind(null, accountId)} locale={locale} pseudo={pseudo} />}
      />
      <div className="p-6">
        {forms.length === 0 ? (
          <EmptyState icon={FileText} title={t(m, "forms.empty.title", locale)} body={t(m, "forms.empty.body", locale)} />
        ) : (
          <ListPanel as="ul">
            {forms.map((form) => (
              <li key={form.id} className={LIST_ROW}>
                <Link
                  href={`/dashboard/accounts/${accountId}/forms/${form.id}`}
                  className={cn(
                    "flex items-center justify-between gap-3 px-4 py-3 transition-colors",
                    // The ladder's raised step, the same one table rows use —
                    // `bg-secondary/60` was a 60% alpha of --surface-3.
                    "hover:bg-[var(--surface-3)]",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-card-foreground">
                      {form.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTimeInZone(form.created_at, zone.zone)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {form.submissionCount} {t(m, "forms.submissions", locale).toLowerCase()}
                    </span>
                    {/* `default` is the solid primary fill — a second
                        primary-weight element in every row of the list, and
                        DESIGN.md allows one per view. The mockup's chip plus
                        a dot carries the same reading, and rule 3 wants the
                        dot regardless: status is never colour alone. */}
                    <Badge variant="chip" className="gap-1.5 py-1 pr-2.5 pl-2">
                      <span
                        className={cn(
                          "size-[7px] rounded-full",
                          form.status === "published"
                            ? "bg-[var(--good)]"
                            : "bg-muted-foreground/60",
                        )}
                        aria-hidden
                      />
                      {labelIn(FORM_STATUS_KEY, form.status, locale)}
                    </Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ListPanel>
        )}
      </div>
    </>
  );
}
