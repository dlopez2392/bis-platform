// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/page.tsx
//
// The account's "To do" screen. Task 3 built it read-only; Task 4 wired the
// Not now / Done / booking-outcome buttons (`work-list.tsx` → `actions.ts` →
// `WorkRowActions`). This page itself still only reads and buckets
// `listAccountWork`'s three sources and renders them — the writes live in
// the files below it, not here.
import { listAccountWork, listPendingProposals, countHeldInboundEmails, getVoiceProfile, type Proposal } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { WhoFilter } from "@/components/assign/who-filter";
import { requireAccountAccess } from "@/lib/auth";
import { renderZone } from "@/lib/zone";
import { ZoneNote } from "@/components/zone-note";
import { dbForRequest } from "@/lib/db";
import { loadAssignView } from "@/lib/assign/view";
import { bucketWork } from "@/lib/work/buckets";
import { contactDisplayName } from "@/lib/format";
import { holdingLabel } from "@/lib/contacts/holding-label";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import type { Locale } from "@/lib/i18n/locale";
import { loggableError } from "@/lib/loggable-error";
import { LocaleProvider } from "@/components/locale-provider";
import { makeTr } from "@/lib/record/copy";
import { buildSuggestionView } from "@/lib/proposals/view";
import { groupSuggestions, type SuggestionGroup } from "@/lib/proposals/group";
import { readSuggestionStages, type StageContext } from "@/lib/proposals/view-reads";
import { WorkList } from "./work-list";

export const dynamic = "force-dynamic";

/** The tray's stated cap (spec 4.5, plan deviation 19): `listPendingProposals` asks for one more. */
const TRAY_CAP = 200;

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams?: Promise<{ who?: string; locale?: string }>;
}) {
  const { accountId } = await params;
  const { who: rawWho, locale: localeParam } = (await searchParams) ?? {};
  // Both audiences see this page (nav-groups.ts adds it unconditionally,
  // directly under Dashboard). The role decides only Mine / Unassigned and
  // whether tasks can be handed on (F-085 part 1).
  const access = await requireAccountAccess(accountId);
  const { isAgency } = access;
  const db = await dbForRequest();
  // Mine / Unassigned (spec §8-§9), applied by listAccountWork on the
  // server. Never for a Technician (their queue is already theirs).
  const assign = await loadAssignView(db, accountId, access, rawWho, { members: true });

  // `timezone` and `language` — this page never shows the account/brand
  // name itself (every sibling list in this folder — Contacts, Calls,
  // Forms, Conversations — is titled plainly too; the sidebar already
  // carries account identity), but `language` feeds the "Needs a look"
  // held-emails row's own locale below (Task 12).
  const account = await db
    .from("accounts")
    .select("timezone, language")
    .eq("id", accountId)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(`tasks: account lookup failed: ${error.message}`);
      if (!data) throw new Error("tasks: account not found");
      return data as { timezone: string; language?: Locale | null };
    });
  const prefs = await getPersonPrefs();
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: account.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, { locale: localeParam });
  // The Suggestions section's words (the held-emails row reads `locale` itself).
  const tr = makeTr(locale, requestPseudoMode({ locale: localeParam }));

  // Task 12 (S-06 part 1): the inbox's own "Needs a look" count, read here
  // once alongside this screen's own work — best-effort (rule 5): a failed
  // read omits the row rather than taking the whole to-do queue down.
  let heldCount: number | null = null;
  try {
    heldCount = await countHeldInboundEmails(db, accountId);
  } catch (e) {
    console.error(`tasks: account ${accountId} held count read failed: ${loggableError(e)}`);
  }

  const rows = await listAccountWork(db, accountId, { assignee: assign.assignee });

  // The resolved zone (lib/zone.ts), shared with the other four date
  // screens and with the account dashboard's copy of this same bucketing.
  //
  // This used to take the RAW `account.timezone` to avoid a SILENT UTC
  // fallback — right about the clamp it was refusing, wrong about the
  // remedy. Refusing to guess meant an unusable zone degraded to "every row
  // waits" and every row lost its date: the screen stopped answering the one
  // question it exists to answer. danlo, 2026-09-17: "I do not want to omit
  // the dates so let's find a workaround." `resolveZone` is the workaround —
  // it still never guesses silently, it just says so out loud instead of
  // going quiet.
  const zone = await renderZone(account.timezone);
  const buckets = bucketWork(rows, new Date(), zone.zone);

  // The SAME resolved zone the buckets above were computed in — which is the
  // whole point of resolving it once. A row formatted in one zone beside a
  // bucket chip computed in another can contradict itself inside a single
  // row, and that is precisely what the old split (raw zone for buckets,
  // nothing usable for dates) produced.
  const timezone = zone.zone;

  // The tray (item 8b-1, spec 4.5): this account's pending suggestions, not past `expires_at`, newest
  // first, as cards a person decides right here. "Both audiences see both surfaces": a client who never
  // opens a call still learns a suggestion exists. `listPendingProposals` asks for 201 so the screen can
  // show 200 and SAY there are more (plan deviation 19). Every read a card needs runs on the request
  // client, scoped to this account and bounded (plan fix I-5): the calls behind the rows (their day and
  // caller), the deals and stage lists behind a stage suggestion (readSuggestionStages) and, below, the
  // callers' names in the page's one contacts batch. A failure in any of them is the section's error
  // state with Retry (rule 5), never silently no section; the buckets render regardless. The persona's
  // read is the one exception: it costs only the name ("Sofía"), as on the call page.
  let suggestionRows: Proposal[] = [];
  let capped = false;
  let suggestionsError = false;
  let stageCtx: StageContext = { stages: {}, pipelineStages: [] };
  const callsById = new Map<string, { startedAt: string | null; contactId: string | null }>();
  let personaName = "Sofía";
  try {
    const all = await listPendingProposals(db, accountId);
    capped = all.length > TRAY_CAP;
    suggestionRows = all.slice(0, TRAY_CAP);
    const callIds = [...new Set(suggestionRows.flatMap((p) => (p.callId ? [p.callId] : [])))];
    const [calls, stagesRead, profile] = await Promise.all([
      callIds.length === 0 ? Promise.resolve([]) : db.from("calls").select("id, started_at, contact_id")
        .eq("account_id", accountId).in("id", callIds).limit(callIds.length)
        .then(({ data, error }) => {
          if (error) throw new Error(`calls read failed: ${error.message}`);
          return (data ?? []) as { id: string; started_at: string | null; contact_id: string | null }[];
        }),
      readSuggestionStages(db, accountId, suggestionRows),
      suggestionRows.length === 0 ? Promise.resolve(null) : getVoiceProfile(db, accountId).catch((e: unknown) => {
        console.error(`tasks ${accountId}: persona read failed, marking suggestions as Sofía: ${loggableError(e)}`);
        return null;
      }),
    ]);
    for (const c of calls) callsById.set(c.id, { startedAt: c.started_at, contactId: c.contact_id });
    stageCtx = stagesRead;
    personaName = profile?.persona_name?.trim() || "Sofía";
  } catch (e) {
    console.error(`tasks ${accountId}: suggestions read failed, rendering the section's error state: ${loggableError(e)}`);
    suggestionRows = [];
    capped = false;
    suggestionsError = true;
  }
  // The caller behind a row is the call's own contact, else the row's.
  const callerIdOf = (p: Proposal) => (p.callId ? callsById.get(p.callId)?.contactId : null) ?? p.contactId;

  // ONE batch read for every contact these rows (AND every suggestion's caller, AND every suggestion's own
  // customer, whom its tray group is named after: item 8b-2) reference — never one read per row. Scoped
  // by account_id so a contactId can never resolve a different account's person.
  const contactIds = [...new Set(
    [...buckets.overdue, ...buckets.today, ...buckets.waiting]
      .map((r) => r.contactId)
      .concat(suggestionRows.map(callerIdOf))
      .concat(suggestionRows.map((p) => p.contactId))
      .filter((id): id is string => id !== null),
  )];
  const contactNames: Record<string, string> = {};
  if (contactIds.length > 0) {
    const { data: contacts, error } = await db
      .from("contacts")
      .select("id, first_name, last_name, phone, holds_shared_number, archived_at")
      .eq("account_id", accountId)
      .in("id", contactIds);
    if (error) throw new Error(`tasks: contacts lookup failed: ${error.message}`);
    for (const c of contacts ?? []) {
      // S-47e (P19): a To-do on a shared number's holding record names the number, never "Caller".
      const name = c.holds_shared_number ? holdingLabel(c.phone, locale) : contactDisplayName(c);
      // contacts-archive Task 12: archiving never hides the work — it only marks whose it is.
      contactNames[c.id] = c.archived_at ? `${name} · ${tr.text("contacts.archived.mark")}` : name;
    }
  }

  // Built inside its own try, as the call page builds its views inside its read's: a card that cannot be
  // built (a payload the read boundary should have refused) is the section's error state, never the
  // whole To do page (final review M-1). It runs after the contacts batch above, which the buckets share.
  const now = new Date();
  let groups: SuggestionGroup[] = [];
  try {
    const views = suggestionRows.map((p) => {
      const callerId = callerIdOf(p);
      return buildSuggestionView(p, {
        tr, zone: timezone, now, ...stageCtx,
        callerName: callerId ? (contactNames[callerId] ?? null) : null,
        callStartedAt: p.callId ? (callsById.get(p.callId)?.startedAt ?? null) : null,
        // The tray shows pending rows only, so it names no decider.
        personaName, names: {}, viewerId: access.userId,
      });
    });
    // Grouped by customer, then by call (item 8b-2, spec 5.1), in the same guard as the cards.
    groups = groupSuggestions(suggestionRows, new Map(views.map((v) => [v.id, v])), {
      tr, zone: timezone, contactNames, callsById,
    });
  } catch (e) {
    console.error(`tasks ${accountId}: suggestions could not be shown, rendering the section's error state: ${loggableError(e)}`);
    groups = [];
    capped = false;
    suggestionsError = true;
  }

  return (
    // F-085 follow-up (Task B): every read-only word on this list comes from
    // `tr`, in ONE locale; `lang` on the wrapper, and the LocaleProvider
    // reaches the client leaves below (WorkRowActions, ConsentHoldActions,
    // the assignee pickers) through context, the same way the drawer and
    // bulk-action bar already do.
    <LocaleProvider locale={locale}>
      <div lang={locale}>
      <PageHeader
        title={tr.text("work.title")}
        // F-085 part 1 (spec §9): All · Mine · Unassigned, for those who see
        // the whole account. Nothing else rides along: this list has no
        // search, sort or pager.
        filters={assign.canAssign ? (
          <WhoFilter
            base={`/dashboard/accounts/${accountId}/tasks`}
            current={assign.who}
            showMine={assign.showMine}
            params={{}}
            locale={locale}
          />
        ) : undefined}
      />
      <div className="p-6">
        <ZoneNote
          zone={zone}
          isAgency={isAgency}
          locale={locale}
          className="mb-4"
        />
        <WorkList
          buckets={buckets}
          accountId={accountId}
          contactNames={contactNames}
          timezone={timezone}
          suggestions={{ groups, capped, error: suggestionsError }}
          tr={tr}
          personaName={personaName}
          canAssign={assign.canAssign}
          members={assign.members}
          who={assign.who}
          heldEmails={heldCount && heldCount > 0 ? {
            count: heldCount,
            href: `/dashboard/accounts/${accountId}/conversations?view=held`,
            locale,
          } : undefined}
        />
      </div>
      </div>
    </LocaleProvider>
  );
}
