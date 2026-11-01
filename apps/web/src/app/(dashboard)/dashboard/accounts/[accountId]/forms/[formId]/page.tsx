import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getForm, listSubmissions, listCustomFields, findConciergeDestinationName } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { FormEditor } from "./form-editor";
import { EmbedSnippet } from "./embed-snippet";
import { SubmissionsTable } from "./submissions-table";
import { saveFormAction, republishFormAction } from "../actions";
import { requireNotTechnician } from "@/lib/auth";
import { noteOpened } from "@/lib/access-log/note";
import { dbForRequest } from "@/lib/db";
import { renderZone } from "@/lib/zone";
import type { Locale } from "@/lib/i18n/locale";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";

export const dynamic = "force-dynamic";

export default async function FormEditorPage({
  params, searchParams,
}: {
  params: Promise<{ accountId: string; formId: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const { accountId, formId } = await params;
  const { locale: localeParam } = await searchParams;
  // F-085 part 1 (spec §7.1): a Technician does not work here and is sent
  // to To do; everyone the [accountId] layout admitted passes straight on.
  const access = await requireNotTechnician(accountId);
  const { isAgency } = access;
  const db = await dbForRequest();
  const form = await getForm(db, accountId, formId);
  if (!form) notFound();
  // S-10 T5 part 2: the person's own choice; the account's own `language`
  // read is folded into the SAME account row the zone already reads below
  // — never a second query (requestLocale's own "one more field off the
  // row the caller already loaded" discipline).
  const prefs = await getPersonPrefs();
  const pseudo = requestPseudoMode({ locale: localeParam });

  // Fix round 1 review (minor): this lookup is a courtesy on top of the
  // editor's real job (editing the form), not a reason to fail the whole
  // page — a transient read error here must not cost the operator the
  // editor entirely. `.catch` keeps it OUT of the `Promise.all`'s own
  // failure path: a plain rejected member there would reject every other
  // member too, and `notFound()`/the page's error boundary would show
  // instead of the editor.
  const conciergeAssistantName = findConciergeDestinationName(db, accountId, formId)
    .catch((e: unknown) => {
      console.error(`findConciergeDestinationName failed for form ${formId}: ${String(e)}`);
      return null;
    });

  const [submissions, customFields, h, resolvedConciergeAssistantName, account] = await Promise.all([
    listSubmissions(db, accountId, formId),
    listCustomFields(db, accountId, "contact"),
    headers(),
    conciergeAssistantName,
    // The zone AND language the submissions table's own dates, and this
    // page's reader locale, render from below — not a throw: one cosmetic
    // read must not take the editor down, same reasoning as the contacts
    // list's own read (D-010).
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle(),
    // F-118 part 1 (spec 4.1, ruling 4): this form's answers are a record; the access-log write runs
    // beside the page's other reads, after getForm has proven the form.
    noteOpened(access, accountId, { kind: "form_answers", recordId: form.id }),
  ]);
  if (account.error) {
    console.error(`forms editor: account ${accountId} timezone/language read failed: ${account.error.message}`);
  }
  const accountRow = account.data as { timezone: string; language?: Locale | null } | null;
  const zone = await renderZone(accountRow?.timezone);
  const accountLanguage = { language: accountRow?.language ?? null };
  // S-10 T5 part 2: the OPERATOR reading THIS dashboard screen — never
  // `form.locale_default`, the FORM's own customer-facing language, which
  // stays exactly as it was (the embed snippet's `locale` prop below, and
  // the editor's own seeded-label argument inside form-editor.tsx).
  const locale = requestLocale(
    { account: accountLanguage, isOperator: isAgency, userLanguage: prefs.language },
    { locale: localeParam },
  );

  // Read from the request rather than an env var: the snippet has to point at
  // whatever host the operator is actually on, which differs between localhost,
  // a preview deploy and production.
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${h.get("host") ?? "localhost:3000"}`;

  return (
    <>
      <PageHeader title={form.name} />
      {/* S-10 T9a: `grid-cols-1` + `min-w-0` on the first column — same fix
          as calendar/page.tsx's identical `lg:grid-cols-[minmax(0,1fr)_…]`
          pattern (its own comment there has the full measurement). The
          second column here is `<EmbedSnippet>` itself, whose root is a
          `Card` (ui/card.tsx), which already carries `min-w-0` for being a
          direct grid/flex item elsewhere — so only the first wrapper needed
          it explicitly. */}
      <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <FormEditor
            form={form}
            customFields={customFields}
            action={saveFormAction.bind(null, accountId, locale)}
            conciergeAssistantName={resolvedConciergeAssistantName}
            republishAction={republishFormAction.bind(null, accountId, formId, locale)}
            readerLocale={locale}
            pseudo={pseudo}
          />
          <SubmissionsTable
            accountId={accountId}
            submissions={submissions}
            timezone={zone.zone}
            readerLocale={locale}
            pseudo={pseudo}
          />
        </div>
        <EmbedSnippet
          origin={origin}
          publicId={form.public_id}
          locale={form.locale_default}
          readerLocale={locale}
          pseudo={pseudo}
          published={form.status === "published"}
        />
      </div>
    </>
  );
}
