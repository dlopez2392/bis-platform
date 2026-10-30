import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getContact, contactMergePreview, listPeopleNames } from "@bis/db";
import type { Locale } from "@/lib/i18n/locale";
import { requireNotTechnician } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { noteOpened } from "@/lib/access-log/note";
import { contactDisplayName } from "@/lib/format";
import { isUuid } from "@/lib/assign/action-guards";
import { mergeConflicts, alsoKeeps, otherReach } from "@/lib/contacts/merge-fields";
import { mergeCountsList } from "@/lib/contacts/merge-copy";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { makeTr } from "@/lib/record/copy";
import { loggableError } from "@/lib/loggable-error";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { mergeContactsAction, undoMergeAction } from "../merge-actions";
import { MergeScreen } from "./merge-screen";

export const dynamic = "force-dynamic";

type ContactRow = {
  id: string; first_name: string | null; last_name: string | null; created_at: string;
  holds_shared_number: boolean; merged_into: string | null;
};

/** 0106's own tiebreak (owner ruling D4): the older record by `created_at`, then `id`. */
function isOlder(x: ContactRow, y: ContactRow): boolean {
  return x.created_at < y.created_at || (x.created_at === y.created_at && x.id < y.id);
}

function queryString(a: string, b: string, keep?: string): string {
  const params = new URLSearchParams({ a, b });
  if (keep) params.set("keep", keep);
  return params.toString();
}

/**
 * F-006 part 1 (plan Task 10, Step 4; spec §6.4; folded Task 13, F-118 §9): the compare screen,
 * `contacts/merge?a=<uuid>&b=<uuid>[&keep=<uuid>]`. A RECORD that shows TWO customers at once, so it
 * notes BOTH opens (spec §9), after both contacts are proven — not missing, not holding, not a
 * tombstone — and before any markup returns, mirroring `contacts/[contactId]/page.tsx`'s own call.
 */
export default async function MergeComparePage({
  params, searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams?: Promise<{ a?: string; b?: string; keep?: string; locale?: string }>;
}) {
  const { accountId } = await params;
  const { a, b, keep: keepParam, locale: localeParam } = (await searchParams) ?? {};
  const access = await requireNotTechnician(accountId);
  if (!isUuid(a) || !isUuid(b)) notFound();
  const db = await dbForRequest();
  const [rowA, rowB] = await Promise.all([
    getContact(db, accountId, a) as Promise<ContactRow | null>,
    getContact(db, accountId, b) as Promise<ContactRow | null>,
  ]);
  if (!rowA || !rowB) notFound();
  if (rowA.holds_shared_number || rowB.holds_shared_number) notFound();
  const contactsHref = `/dashboard/accounts/${accountId}/contacts`;
  if (rowA.merged_into || rowB.merged_into) redirect(`${contactsHref}?view=duplicates`);

  const defaultKeep = isOlder(rowA, rowB) ? rowA : rowB;
  const kept = keepParam === rowA.id ? rowA : keepParam === rowB.id ? rowB : defaultKeep;
  const other = kept.id === rowA.id ? rowB : rowA;

  // F-118 part 1 (folded Task 13, spec §9): two views, one per customer shown — after both are proven
  // above and before any markup returns. Not destructured: a client is never logged (noteOpened returns
  // at once), and the agency's write throws on failure, which rejects this Promise.all like any other read.
  await Promise.all([
    noteOpened(access, accountId, { kind: "contact", recordId: kept.id }),
    noteOpened(access, accountId, { kind: "contact", recordId: other.id }),
  ]);

  // Fix round, finding #5: the account's own language, read the way sibling pages do
  // (contacts/page.tsx, documents/page.tsx) — never the `{ language: null }` literal this page used
  // to hand `requestLocale`, which could never read a Spanish account's own default.
  const [preview, prefs, account] = await Promise.all([
    contactMergePreview(db, accountId, kept.id, other.id).catch((e: unknown) => {
      console.error(`contacts merge: preview read failed for account ${accountId}: ${loggableError(e)}`);
      return null;
    }),
    getPersonPrefs(),
    db.from("accounts").select("language").eq("id", accountId).maybeSingle(),
  ]);
  if (account.error) {
    console.error(`contacts merge: account ${accountId} language read failed: ${account.error.message}`);
  }
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: (account.data as { language: Locale | null } | null)?.language ?? null };
  const locale = requestLocale(
    { account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language },
    { locale: localeParam },
  );
  const tr = makeTr(locale, requestPseudoMode({ locale: localeParam }));

  if (!preview || preview.status !== "ok") {
    const retryHref = `/dashboard/accounts/${accountId}/contacts/merge?${queryString(a, b, keepParam)}`;
    return (
      <div className="p-6" lang={locale}>
        <p className="text-sm text-[var(--text-2)]">{tr.text("contacts.merge.loadFailed")}</p>
        <Link href={retryHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4")}>
          {tr.text("record.card.retry")}
        </Link>
      </div>
    );
  }

  const conflicts = mergeConflicts(preview.fields.keep, preview.fields.other);
  const also = alsoKeeps(preview.fields.keep, preview.fields.other);
  const reach = otherReach(preview.fields.keep, preview.fields.other, {});
  const movesText = mergeCountsList(preview.counts, tr, locale);
  const swapHref = `/dashboard/accounts/${accountId}/contacts/merge?${queryString(rowA.id, rowB.id, other.id)}`;

  // Fix round, finding #4: the compare screen must never show a raw Clerk user id as a radio label.
  // Read ONLY the ids the preview's own fields actually carry (never read for nothing, and never a
  // whole-team read), and let a failed read cost only the names — never the page (the drawer's own
  // duplicates read follows the same pattern just above, in `page.tsx`'s sibling, `[contactId]/page.tsx`).
  const assigneeIds = [...new Set(
    [preview.fields.keep.assigned_to, preview.fields.other.assigned_to]
      .filter((v): v is string => typeof v === "string" && v.length > 0),
  )];
  const assigneeNames = assigneeIds.length === 0 ? {} : await listPeopleNames(db, assigneeIds).catch((e: unknown) => {
    console.error(`contacts merge: assignee names read failed for account ${accountId}: ${loggableError(e)}`);
    return {};
  });

  return (
    <MergeScreen
      accountId={accountId}
      keep={{ id: kept.id, name: contactDisplayName(kept) }}
      other={{ id: other.id, name: contactDisplayName(other) }}
      conflicts={conflicts}
      alsoKeeps={also}
      otherReach={reach}
      movesText={movesText}
      seen={preview.seen}
      swapHref={swapHref}
      locale={locale}
      mergeAction={mergeContactsAction.bind(null, accountId)}
      undoAction={undoMergeAction.bind(null, accountId)}
      assigneeNames={assigneeNames}
    />
  );
}
