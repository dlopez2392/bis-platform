import Link from "next/link";
import { Archive, ArrowLeft, ArrowRight, Copy, Download, Upload, Users } from "lucide-react";
import {
  countContacts, listContacts, listTags, listDuplicatePairs, countDuplicatePairs,
  type SortKey, type SortDir, type DuplicatePair,
} from "@bis/db";
import { MIN_PHONE_SEARCH_DIGITS } from "@bis/db/contact-search";
import { createContactAction } from "./actions";
import { dismissPairAction, undismissPairAction } from "./merge-actions";
import { ContactsTable } from "./contacts-table";
import { AddContactDialog } from "./add-contact-dialog";
import { DuplicatesList, type DuplicateRow } from "./duplicates-list";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { WhoFilter } from "@/components/assign/who-filter";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { encodeCursor, parseCursor } from "@/lib/cursor";
import { withWho, type Who } from "@/lib/assign/who";
import { archivedFilterOf, parseView, withView, type ContactsView } from "@/lib/contacts/view";
import { toRowCursor, fromRowCursor, compareHref, reasonMessageKey } from "@/lib/contacts/duplicates";
import { loadAssignView } from "@/lib/assign/view";
import { seesWholeAccount } from "@/lib/auth-role";
import { cn } from "@/lib/utils";
import { renderZone } from "@/lib/zone";
import { contactDisplayName, formatDateInZone } from "@/lib/format";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { billingVerdictFor } from "@/lib/billing/standing-read";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import type { Locale } from "@/lib/i18n/locale";
import { makeTr, type Tr } from "@/lib/record/copy";
import { LocaleProvider } from "@/components/locale-provider";
import { loggableError } from "@/lib/loggable-error";

export const dynamic = "force-dynamic";

// One more row than a page shows, so a full page back is the only signal
// needed to decide whether an "Older" link is warranted — listContacts
// returns rows, not a total, and countContacts (below) answers a different
// question (how many match overall, not whether more exist past this batch).
const PAGE_SIZE = 50;

const SORT_KEYS: readonly SortKey[] = ["name", "company", "created"];
const SORT_DIRS: readonly SortDir[] = ["asc", "desc"];

/**
 * `?sort=`/`?dir=` are hand-editable URL parameters exactly like `?before=`
 * (parseCursor's own doc comment) — anything outside the three keys or two
 * directions falls back to the default rather than throwing, and a
 * duplicated query key producing an array at runtime (Next.js's actual
 * `searchParams` type, whatever a page's own annotation says) must not
 * throw either.
 */
function parseSort(raw: string | undefined): SortKey {
  return typeof raw === "string" && (SORT_KEYS as readonly string[]).includes(raw)
    ? (raw as SortKey) : "created";
}
function parseDir(raw: string | undefined): SortDir {
  return typeof raw === "string" && (SORT_DIRS as readonly string[]).includes(raw)
    ? (raw as SortDir) : "desc";
}

/** Whichever column `sort` actually ordered by, straight off a returned row —
 *  what the next page's cursor is built from. Must agree with
 *  packages/db/src/contacts.ts's own SORT_COLUMN mapping (name → sort_name,
 *  company → company_name, created → created_at) — that file selects
 *  `sort_name` on every row for exactly this caller. */
function cursorValue(
  sort: SortKey, row: { sort_name: string | null; company_name: string | null; created_at: string },
): string | null {
  return sort === "name" ? row.sort_name : sort === "company" ? row.company_name : row.created_at;
}

/**
 * The relative href for the "Newer" link: back to the unpaged head of the
 * CURRENT sort/search, dropping the cursor entirely — a full back-stack
 * isn't worth the state for a list an operator scans rather than browses.
 * Only rendered when `hasCursor` (there is somewhere newer to return to).
 *
 * Extracted as a pure, exported function — same reason contacts-table.tsx
 * exports `sortHref` — so "the Newer link carries the current sort/dir" is
 * a claim a test can execute, not just read off the source. CALLERS MUST
 * BUILD THE QUERY STRING WITH `URLSearchParams`, never by concatenation —
 * see this file's own comment where this used to be inlined.
 */
export function buildNewerHref(
  hasCursor: boolean, q: string | undefined, sort: SortKey, dir: SortDir, who: Who = "all",
  // Contact archive (plan Task 10): paging the Archived view stays in it.
  view: ContactsView = "active",
): string | null {
  return hasCursor ? `?${new URLSearchParams(withView(withWho({ ...(q ? { q } : {}), sort, dir }, who), view))}` : null;
}

/**
 * The relative href for the "Older" link: same search/sort, cursor advanced
 * past `lastRow` (the last row of THIS page, already sliced to PAGE_SIZE).
 * `hasOlder` and `lastRow` are asked for separately, matching the exact
 * condition this replaces (`hasOlder && last`) rather than inferring one
 * from the other — `hasOlder` is only ever false when the query returned no
 * extra row, and `lastRow` is only ever absent for an empty page.
 */
export function buildOlderHref(
  hasOlder: boolean,
  lastRow: { sort_name: string | null; company_name: string | null; created_at: string; id: string } | undefined,
  q: string | undefined, sort: SortKey, dir: SortDir, who: Who = "all", view: ContactsView = "active",
): string | null {
  if (!hasOlder || !lastRow) return null;
  return `?${new URLSearchParams(withView(withWho({ ...(q ? { q } : {}), sort, dir,
      before: encodeCursor({ v: cursorValue(sort, lastRow), id: lastRow.id }) }, who), view))}`;
}

/**
 * The href for the "Export" link: the export route under this page's own
 * `base`, carrying the CURRENT search and sort so "export what I'm looking
 * at" (the product decision behind export/route.ts, proven there by
 * route.get.test.ts) actually holds at the link too — previously a bare
 * `${base}/export` with no query string, so Export always downloaded the
 * unfiltered, default-order list regardless of what the page was showing.
 * Same reason as buildNewerHref/buildOlderHref above: an exported pure
 * function so this claim is executable by a test, not just readable in JSX.
 *
 * Deliberately takes no cursor parameter: the export route pages the WHOLE
 * matching set itself (route.ts's own CHUNK_SIZE loop), so there is nothing
 * here a caller could even pass a `before` through as — carrying one would
 * silently truncate the downloaded file to a single page, a data-loss bug
 * rather than a cosmetic one.
 *
 * Takes no `who` either (F-085 part 1): export is Owner-only and exports the
 * search, not the Mine / Unassigned filter.
 *
 * Takes the view (contact archive, spec §4.1): Export exports the view it was opened from, so the
 * Archived view's Export downloads the archived contacts, and the list's leaves them out, like the screen.
 */
export function buildExportHref(
  base: string, q: string | undefined, sort: SortKey, dir: SortDir, view: ContactsView = "active",
): string {
  return `${base}/export?${new URLSearchParams(withView({ ...(q ? { q } : {}), sort, dir }, view))}`;
}

/**
 * Which empty state a zero-row page one means (F-085 part 1, spec §9). A
 * search that found nothing is the narrower fact and wins; then the filter
 * in effect; then a Technician, whose list is only ever theirs, gets their
 * own sentence rather than the Owner's "add your first contact". In the
 * reader's own language (F-085 follow-up, Task B): the page's `tr`, never a
 * bare `m[...]` lookup.
 *
 * F-092 part 1 (plan Task 6): a search that found nothing names WHO it
 * searched — the Archived view's own customers, or (for someone whose list
 * is only their own) just theirs, or everyone's — and suggests part of the
 * name or the last MIN_PHONE_SEARCH_DIGITS digits of a phone, since that
 * floor (`@bis/db/contact-search`'s owner ruling, Q2) is the real reason a
 * short phone fragment alone would not have matched.
 */
function emptyCopy(
  q: string | undefined, who: Who, wholeAccount: boolean, view: ContactsView, tr: Tr,
): { title: string; body?: string } {
  if (q) {
    const params = { query: q.slice(0, 80), digits: MIN_PHONE_SEARCH_DIGITS };
    const title = view === "archived"
      ? tr.text("contacts.search.noMatchArchived.title", params)
      : !wholeAccount
        ? tr.text("contacts.search.noMatchMine.title", params)
        : tr.text("contacts.search.noMatch.title", params);
    return { title, body: tr.text("contacts.search.noMatch.body", params) };
  }
  // Rule 5: the Archived view's empty state says what appears there and how it gets there.
  if (view === "archived") return { title: tr.text("contacts.archived.emptyTitle"), body: tr.text("contacts.archived.emptyBody") };
  if (who === "mine") return { title: tr.text("assign.empty.mine") };
  if (who === "unassigned") return { title: tr.text("assign.empty.unassigned") };
  if (!wholeAccount) return { title: tr.text("assign.empty.technician") };
  return { title: tr.text("contacts.empty.title"), body: tr.text("contacts.empty.body") };
}

/**
 * F-006 part 1 (plan Task 10, Step 5): the Possible duplicates view, `?view=duplicates`. Its own small
 * read (open pairs + their real total, through `app.open_duplicate_pairs`) and its own small render —
 * kept apart from the active/Archived view's larger Promise.all above rather than threaded through it,
 * so neither view's reads can accidentally run for the other.
 */
async function renderDuplicatesView(
  accountId: string,
  db: Awaited<ReturnType<typeof dbForRequest>>,
  access: { isAgency: boolean },
  before: string | undefined,
  localeParam: string | undefined,
) {
  const [account, prefs] = await Promise.all([
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle(),
    getPersonPrefs(),
  ]);
  if (account.error) {
    console.error(`contacts duplicates: account ${accountId} timezone and language read failed: ${account.error.message}`);
  }
  const accountRow = account.data as { timezone: string; language?: Locale | null } | null;
  const zone = await renderZone(accountRow?.timezone);
  const accountLanguage = { language: accountRow?.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, { locale: localeParam });
  const tr = makeTr(locale, requestPseudoMode({ locale: localeParam }));
  const base = `/dashboard/accounts/${accountId}/contacts`;
  const cursor = parseCursor(before);
  const after = fromRowCursor(cursor);

  let pairs: DuplicatePair[] = [];
  let total = 0;
  let failed = false;
  try {
    [pairs, total] = await Promise.all([
      listDuplicatePairs(db, accountId, { limit: PAGE_SIZE + 1, after }),
      countDuplicatePairs(db, accountId),
    ]);
  } catch (e) {
    console.error(`contacts duplicates: read failed for account ${accountId}: ${loggableError(e)}`);
    failed = true;
  }

  const hasOlder = pairs.length > PAGE_SIZE;
  const page = hasOlder ? pairs.slice(0, PAGE_SIZE) : pairs;
  const last = page[page.length - 1];
  // 2026-10-17 amendment: not sorted by recency alone, so "Next" / "Back to the start", never
  // "Older" / "Newer" — the start link drops the cursor entirely.
  const olderHref = hasOlder && last
    ? `?${new URLSearchParams(withView({ before: encodeCursor(toRowCursor(last)) }, "duplicates"))}` : null;
  const startHref = cursor ? `?${new URLSearchParams(withView({}, "duplicates"))}` : null;
  const countLabel = tr.count("contacts.duplicates.count", total);
  const showEmpty = !failed && page.length === 0 && !cursor;

  const rows: DuplicateRow[] = page.map((pair) => ({
    id: pair.id,
    href: compareHref(accountId, pair),
    aName: contactDisplayName({ first_name: pair.a.firstName, last_name: pair.a.lastName }),
    bName: contactDisplayName({ first_name: pair.b.firstName, last_name: pair.b.lastName }),
    reasonText: tr.text(reasonMessageKey(pair.reason)),
    foundOnText: tr.text("contacts.duplicates.foundOn", { date: formatDateInZone(pair.createdAt, zone.zone, locale) }),
  }));

  const backLink = (
    <Link href={base} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
      <ArrowLeft className="size-4" aria-hidden />
      {tr.text("contacts.archived.back")}
    </Link>
  );

  return (
    <LocaleProvider locale={locale}>
      <div lang={locale}>
        <PageHeader title={tr.text("contacts.duplicates.title")} count={countLabel} actions={backLink} />
        <div className="p-6">
          {failed ? (
            <EmptyState
              icon={Copy} title={tr.text("contacts.duplicates.listFailed")} lang={locale}
              action={
                <Link href={`${base}?view=duplicates`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  {tr.text("record.card.retry")}
                </Link>
              }
            />
          ) : showEmpty ? (
            <EmptyState icon={Copy} title={tr.text("contacts.duplicates.emptyTitle")} body={tr.text("contacts.duplicates.emptyBody")} lang={locale} />
          ) : (
            <>
              <DuplicatesList
                rows={rows} locale={locale}
                dismissAction={dismissPairAction.bind(null, accountId)}
                undismissAction={undismissPairAction.bind(null, accountId)}
              />
              {startHref || olderHref ? (
                <div className="mt-4 flex items-center justify-between">
                  <div>
                    {startHref ? (
                      <Link href={startHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                        {tr.text("contacts.duplicates.first")}
                      </Link>
                    ) : null}
                  </div>
                  <div>
                    {olderHref ? (
                      <Link href={olderHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                        {tr.text("contacts.duplicates.next")}
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </LocaleProvider>
  );
}

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  // `locale` is the QA override only (requestLocale's own contract): off on
  // every Vercel deployment, on only in Playwright's webServer env and CI's
  // e2e job.
  searchParams: Promise<{ q?: string; before?: string; sort?: string; dir?: string; who?: string; view?: string; locale?: string }>;
}) {
  const { accountId } = await params;
  const { q, before, sort: rawSort, dir: rawDir, who: rawWho, view: rawView, locale: localeParam } = await searchParams;
  // Staff and roles: delete and export are Owner-only. The account-level
  // layout already calls requireAccountAccess to gate entry into this
  // whole account subtree, but discards the role it reads — this page
  // needs `canManage` itself to decide the Export link's visibility and
  // ContactsTable's own `canDelete` prop (which gates the bulk Delete
  // control, through BulkActionBar).
  const access = await requireAccountAccess(accountId);
  const { canManage } = access;
  const db = await dbForRequest();
  // F-006 part 1 (plan Task 10): computed before the view is settled, because a Technician asking for
  // the duplicates view (they cannot read the queue at all, 0068) gets the active list instead.
  const wholeAccount = seesWholeAccount(access);
  const requestedView = parseView(rawView);
  const view: ContactsView = requestedView === "duplicates" && !wholeAccount ? "active" : requestedView;
  if (view === "duplicates") {
    return renderDuplicatesView(accountId, db, access, before, localeParam);
  }
  // Contact archive (plan Task 10): `?view=archived` is the Archived view, read and counted on the server
  // like every other filter here, so its total and its pager describe the archived rows.
  const archived = archivedFilterOf(view);
  // F-085 part 1 (spec §8-§9): Mine / Unassigned, applied on the SERVER to
  // the list AND its count, so the pager and the header's real total both
  // describe the filtered rows. Never for a Technician (their list is
  // already theirs). `assign.members`/`canAssign` feed the assignment
  // controls in ContactsTable.
  // `viewer`: a read-only viewer's own person too, so the drawer's
  // "Assigned to" says "You" only for customers that are theirs (fix round 1, I1).
  // The Archived view has no All / Mine / Unassigned row, so a `who` carried in from the list does not narrow it.
  const assign = await loadAssignView(db, accountId, access, view === "archived" ? undefined : rawWho, { members: true, viewer: true });

  // Validated once, reused twice: as the query's own cursor below, and as the
  // signal that decides which empty state a zero-row result means (see the
  // render below). `?before=` is a hand-editable URL parameter, so anything
  // unparseable must read as "no cursor" (cold start) rather than a thrown
  // error or a silent trip back to page one on every request.
  const cursor = parseCursor(before);
  const sort = parseSort(rawSort);
  const dir = parseDir(rawDir);

  const [rows, total, tags, account, prefs, verdict] = await Promise.all([
    listContacts(db, accountId, {
      search: q, limit: PAGE_SIZE + 1, before: cursor, sort: { key: sort, dir }, assignee: assign.assignee, archived,
    }),
    countContacts(db, accountId, { search: q, assignee: assign.assignee, archived }),
    listTags(db, accountId),
    // D-010: the "Created" column's own zone — not a throw, the contact
    // detail page's own reasoning: one cosmetic date column must not 500
    // the whole list. `undefined` makes `renderZone` fall back. `language`
    // (F-085 follow-up, Task B) is the account's own default locale —
    // requestLocale's client-role branch, same read every other account-
    // scoped page already does.
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle(),
    getPersonPrefs(),
    // Final review M3: the layout's cached verdict (no read of its own), so both delete dialogs know a
    // paused account refuses the delete and keep Delete off.
    billingVerdictFor(accountId),
  ]);
  if (account.error) {
    console.error(`contacts list: account ${accountId} timezone and language read failed: ${account.error.message}`);
  }
  const accountRow = account.data as { timezone: string; language?: Locale | null } | null;
  const zone = await renderZone(accountRow?.timezone);
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: accountRow?.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, { locale: localeParam });
  const tr = makeTr(locale, requestPseudoMode({ locale: localeParam }));
  const base = `/dashboard/accounts/${accountId}/contacts`;
  const boundCreateContact = createContactAction.bind(null, accountId);

  const hasOlder = rows.length > PAGE_SIZE;
  const page = hasOlder ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  // `sort`/`dir` are carried along on BOTH links (inside buildNewerHref /
  // buildOlderHref): a client scanning newest calls first, say, must not
  // have "Older" silently drop back to the default order.
  const olderHref = buildOlderHref(hasOlder, last, q, sort, dir, assign.who, view);
  const newerHref = buildNewerHref(!!cursor, q, sort, dir, assign.who, view);

  // A whole-phrase pick by count, never a plural template reused for one —
  // see contacts.count's own comment in messages.ts for the bug this avoids.
  // `tr.count` runs the same plural() rule through the reader's own language.
  const countLabel = view === "archived" ? tr.count("contacts.archived.count", total) : tr.count("contacts.count", total);
  // F-085 part 1: a Technician (and a client whose role is unsettled) sees
  // only their own customers, so a CSV import, like Export, is not theirs.
  // `wholeAccount` was computed above, before the view was settled.
  const empty = emptyCopy(q, assign.who, wholeAccount, view, tr);
  // Never a link named exactly "Contacts" (the e2e's unscoped sidebar locator): the way back reads
  // "Back to contacts".
  const backLink = (
    <Link href={base} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
      <ArrowLeft className="size-4" aria-hidden />
      {tr.text("contacts.archived.back")}
    </Link>
  );
  // The cold-start empty page (below). When the Archived view is empty its empty state carries the way
  // back, so the header does not repeat it: exactly one "Back to contacts" on the screen at a time.
  const showEmpty = page.length === 0 && !cursor;
  const emptyBack = view === "archived" && showEmpty && !q;
  // F-092 part 1 (plan Task 6, spec 6): a search that found nothing, from the active list, for
  // someone who sees the whole account, offers a way into the archived customers it never looked
  // at — no count, since which of them match is only known once that view runs its own search.
  const archivedSearchHref = q && view === "active" && wholeAccount
    ? `?${new URLSearchParams(withView({ q }, "archived"))}` : null;

  return (
    // F-085 follow-up (Task B): every read-only word on this list comes from
    // the page's own `tr`, in ONE locale (the contacts list's own analogue of
    // the record page's C1) — `lang` on the wrapper, same pattern the contact
    // and group record pages already use.
    <LocaleProvider locale={locale}>
      <div lang={locale}>
      <PageHeader
        title={view === "archived" ? tr.text("contacts.archived.title") : tr.text("contacts.title")}
        count={countLabel}
        actions={
          <>
            {view === "archived" && !emptyBack ? backLink : null}
            {/* The list's way to its Archived view, for those who archive (Owners, Staff, the agency). */}
            {view === "active" && wholeAccount ? (
              <Link
                href={`?${new URLSearchParams(withView({}, "archived"))}`}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                <Archive className="size-4" aria-hidden />
                {tr.text("contacts.archived.link")}
              </Link>
            ) : null}
            {/* F-006 part 1 (plan Task 10): beside Archived, the list's way to open pairs. */}
            {view === "active" && wholeAccount ? (
              <Link
                href={`?${new URLSearchParams(withView({}, "duplicates"))}`}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                <Copy className="size-4" aria-hidden />
                {tr.text("contacts.duplicates.link")}
              </Link>
            ) : null}
            {canManage ? (
              // F-118 part 1 (plan Task 7): a Link prefetches and its RSC fetch would run the export
              // route's own handler — a plain anchor with `download` never does either.
              <a
                href={buildExportHref(base, q, sort, dir, view)}
                download
                data-export-link
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                <Download className="size-4" aria-hidden />
                {tr.text("contacts.export")}
              </a>
            ) : null}
            {/* Import and Add contact add to the list, so the Archived view offers neither. */}
            {view === "active" && wholeAccount ? (
              <Link
                href={`${base}/import`}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                <Upload className="size-4" aria-hidden />
                {tr.text("contacts.import")}
              </Link>
            ) : null}
            {view === "active" ? <AddContactDialog accountId={accountId} action={boundCreateContact} /> : null}
          </>
        }
        // F-085 part 1 (spec §9): All · Mine · Unassigned, for those who
        // see the whole account. Carries the search and sort, never the
        // cursor: a filter change returns to page one (Paged lists).
        filters={assign.canAssign && view === "active" ? (
          <WhoFilter
            base={base}
            current={assign.who}
            showMine={assign.showMine}
            params={{ ...(q ? { q } : {}), sort, dir }}
            locale={locale}
          />
        ) : undefined}
        search={
          // D-009: a plain GET form only carries the fields IT names — with
          // no hidden sort/dir, pressing Enter in the search box dropped
          // whatever column/direction the operator had the list sorted by
          // and silently reset it to the default (created, desc). sort/dir
          // ride along as hidden fields so "search" and "sort" stay the two
          // independent axes this list's own contract (DESIGN.md's paged-
          // lists pattern) says they are.
          <form action={base}>
            <input type="hidden" name="sort" value={sort} />
            <input type="hidden" name="dir" value={dir} />
            {/* F-085: a search inside Mine stays inside Mine, for D-009's reason. */}
            {assign.who !== "all" ? <input type="hidden" name="who" value={assign.who} /> : null}
            {/* A search inside the Archived view stays inside it, for D-009's reason. */}
            {view === "archived" ? <input type="hidden" name="view" value="archived" /> : null}
            <Input
              name="q"
              defaultValue={q ?? ""}
              placeholder={tr.text("contacts.search")}
              // F-107 (rider part): full width below `sm` — a fixed 288px
              // box here was wider than this page's own available column
              // at phone width (contacts is outside this rider's named
              // ownership; flagged in its report as a one-line fix made
              // directly because the rider's own Goal names 320px and
              // page-header.tsx's matching `min-w-0` fix alone could not
              // shrink a child with an EXPLICIT, non-responsive width).
              className="w-full sm:w-72"
            />
          </form>
        }
      />
      <div className="p-6">
        {showEmpty ? (
          // The COLD-START reading of zero rows: no `?before=` cursor, so this
          // is page one and there is nothing behind it either. A cursored
          // zero (below) means the opposite: real history, just none older
          // than the cursor — the table still renders (headers, no rows) with
          // a "Newer" link back to the head, rather than this empty state.
          <EmptyState
            icon={Users} title={empty.title} body={empty.body} lang={locale}
            // Correction 7: a long typed search wraps instead of overflowing the card, inherited by
            // the title and body text it wraps.
            className="[overflow-wrap:anywhere]"
            action={emptyBack ? backLink : archivedSearchHref ? (
              <Link href={archivedSearchHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                {tr.text("contacts.search.lookInArchived")}
              </Link>
            ) : undefined}
          />
        ) : (
          <>
            <ContactsTable
              rows={page}
              accountId={accountId}
              existingTags={tags}
              sort={sort}
              dir={dir}
              q={q}
              timezone={zone.zone}
              canDelete={canManage}
              view={view}
              canArchive={wholeAccount}
              // The agency is never refused a delete on a paused account (final review minor), so only a client sees it off.
              paused={verdict.paused && !access.isAgency}
              who={assign.who}
              canAssign={assign.canAssign}
              members={assign.members}
              viewerId={assign.personId}
            />
            {newerHref || olderHref ? (
              <div className="mt-4 flex items-center justify-between">
                <div>
                  {newerHref ? (
                    <Link
                      href={newerHref}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      <ArrowLeft className="size-3.5" aria-hidden />
                      {tr.text("contacts.newer")}
                    </Link>
                  ) : null}
                </div>
                <div>
                  {olderHref ? (
                    <Link
                      href={olderHref}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      {tr.text("contacts.older")}
                      <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
      </div>
    </LocaleProvider>
  );
}
