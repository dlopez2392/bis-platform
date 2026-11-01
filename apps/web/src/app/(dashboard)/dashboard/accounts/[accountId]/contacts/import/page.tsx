import { listTags } from "@bis/db";
import { requireNotTechnician } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { ImportWizard } from "./import-wizard";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { LocaleProvider } from "@/components/locale-provider";

export const dynamic = "force-dynamic";

/**
 * Both audiences, exactly like the contacts list this hangs off — a client
 * imports their own contacts. `requireNotTechnician` (requireAccountAccess,
 * then a Technician sent to To do, F-085 part 1) is the same guard the
 * sibling actions use; the wizard's own writes are re-checked in the action,
 * so this call gates the SCREEN, not the data.
 *
 * The account's existing tag names are read HERE and handed down: the wizard
 * has to tell the operator how many tags a file would CREATE, and that is only
 * answerable against real tags. Guessing it in the browser would be a number
 * we made up.
 */
export default async function ImportContactsPage(
  { params, searchParams }: {
    params: Promise<{ accountId: string }>;
    // The QA locale override (`?locale=es|pseudo`, BIS_I18N_QA only), as the record page's.
    searchParams?: Promise<{ locale?: string }>;
  },
) {
  const { accountId } = await params;
  const { locale: localeParam } = (await searchParams) ?? {};
  const access = await requireNotTechnician(accountId);
  const db = await dbForRequest();
  // S-10 T3: this screen had no locale at all — resolved the same way the record, pipeline
  // and To do pages do.
  const prefs = await getPersonPrefs();
  const { data: accountRow } = await db.from("accounts").select("language").eq("id", accountId).maybeSingle();
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: (accountRow?.language as Locale | null | undefined) ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, { locale: localeParam });
  const tr = makeTr(locale, requestPseudoMode({ locale: localeParam }));
  const tags = await listTags(db, accountId);

  return (
    <LocaleProvider locale={locale}>
      <div lang={locale}>
        <PageHeader title={tr.text("contacts.import.title")} />
        <div className="mx-auto max-w-2xl">
          <ImportWizard accountId={accountId} existingTags={tags.map((tag) => tag.name)} />
        </div>
      </div>
    </LocaleProvider>
  );
}
