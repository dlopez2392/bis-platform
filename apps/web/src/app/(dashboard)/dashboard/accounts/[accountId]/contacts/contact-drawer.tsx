"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarCheck, CheckSquare, DollarSign, ExternalLink, FileText, MessageSquare, Paperclip, Phone, Plus, Square, StickyNote, X,
} from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { InlineField } from "@/components/inline-field";
import { LocaleProvider, useLocale } from "@/components/locale-provider";
import { RecordHeader } from "@/components/record/record-header";
import { RecordSection } from "@/components/record/record-section";
import { RecordCardRetry, RecordCardSkeleton } from "@/components/record/record-card";
import { TimelineItem, TimelineItemSkeleton } from "@/components/record/timeline-item";
import { ContactAssigneeField } from "@/components/assign/assignee-field";
import { contactDisplayName } from "@/lib/format";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import type { AssignMember } from "@/lib/assign/view";
import { emailLoadFrom, type EmailLoad } from "@/lib/consent/email-row";
import { textsLoadFrom, type TextsLoad } from "@/lib/consent/texts-row";
import type { EditableField } from "@/lib/contacts/field-input";
import type { PhoneInlineUndo } from "@/lib/contacts/inline-phone-undo";
import { drawerFieldsRow, drawerLoadFrom, drawerSummaryUrl, type DrawerLoad, type ParsedDrawerSummary } from "@/lib/contacts/drawer-summary";
import type { RecentRowView } from "@/lib/record/recent-rows";
import { updateContactFieldAction, undoInlinePhoneEditAction } from "./actions";
import { addTagAction, removeTagAction } from "./[contactId]/actions";
import { SummaryBody } from "./[contactId]/summary-card";
import { NextUpBody } from "./[contactId]/next-up-card";
import { EmailRow } from "./email-row";
import { TextsRow } from "./texts-row";
import { SourceField } from "./source-field";
import { BusinessInlineField } from "./business-field";
import { LanguageField } from "./language-field";
import type { ContactRow } from "./contacts-table";

// The body is PARSED (lib/contacts/drawer-summary.ts): checked, not cast, so a server older or newer
// than this tab's bundle gets an error state, not a throw during render, which the dashboard's one
// error boundary would answer by replacing the page. Paired with the id it was fetched for, the
// shape shell-data.tsx uses: "loading" for a newly-peeked contact falls out of the mismatch check in
// `load` below instead of a synchronous setState in the effect (react-hooks/set-state-in-effect).
type Fetched = { contactId: string; result: DrawerLoad } | null;

// Exported so contact-fields-panel.tsx (the full contact page) shares this vocabulary instead of
// duplicating it — one list of standard fields, two InlineField call sites (drawer + full page).
// `field` excludes "source" (its own SourceField, fed by the route) and the Business name (its own
// BusinessInlineField: it writes the contact's business GROUP, S-02 §6 row 3).
export const FIELDS: { field: Exclude<EditableField, "source" | "company_name">; labelKey: MessageKey; type: "text" | "email" | "tel" }[] = [
  { field: "first_name", labelKey: "contacts.firstName", type: "text" },
  { field: "last_name", labelKey: "contacts.lastName", type: "text" },
  { field: "email", labelKey: "contacts.email", type: "email" },
  { field: "phone", labelKey: "contacts.phone", type: "tel" },
];

const ROW_ICON: Record<RecentRowView["kind"], typeof StickyNote> = {
  note: StickyNote, task: Square, deal: DollarSign, submission: FileText, message: MessageSquare, booking: CalendarCheck, call: Phone,
  document: Paperclip, documentVersion: Paperclip,
};
const GHOST_LINK = cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 md:min-h-8");
const LABEL_ROW = "grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2";
// The --line rule between sections sits on the drawer's wrappers, which are siblings: each
// RecordSection is its wrapper's only child, so the section's own first:border-t-0 always matched
// and no rule ever drew (Task 6 review I1). Its own rule is neutralised here so none is doubled.
const SECTION_WRAP = "border-t border-[var(--line)] pt-3 first:border-t-0 first:pt-0 [&>section]:border-t-0 [&>section]:pt-0";
type SectionState = "loading" | "ready" | "error";

/**
 * The contact list's drawer (S-03 part 3): the record's quick look on the record kit. Top to bottom:
 * the record's header (Call the one primary; Text and Email open the record page's composer), the
 * checked facts, Next up, the five newest timeline rows, who they are, and the way to the full
 * record. Each section loads and fails on its own (C2); a section's Try again re-reads the route
 * without blanking the others (C3). Every read-only word comes from the route in ONE locale (C1).
 */
export function ContactDrawer({
  accountId, row, onClose, canAssign = false, members = [], viewerId = null,
}: {
  accountId: string;
  row: ContactRow | null;
  onClose: () => void;
  /** F-085 part 1: may this caller hand the customer to someone (Owner, Staff, the agency); read-only otherwise (a Technician, M4). */
  canAssign?: boolean;
  /** The people the "Assigned to" picker offers (lib/assign/view.ts). */
  members?: AssignMember[];
  /** The viewer's own person here: "You" on a read-only line only for their own customer. */
  viewerId?: string | null;
}) {
  const [fetched, setFetched] = useState<Fetched>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const pageLocale = useLocale();
  const contactId = row?.id ?? null;

  useEffect(() => {
    if (!contactId) return;
    let stale = false;
    // C9: the list URL's QA ?locale= rides along only when present; otherwise today's exact path.
    fetch(drawerSummaryUrl(accountId, contactId, typeof window === "undefined" ? "" : window.location.search))
      .then(async (res) => {
        if (stale) return;
        const result = await drawerLoadFrom(res);
        // Checked again AFTER the body is read: the cleanup can land while `res.json()` is pending,
        // and without this a switched-away contact's result (or an older retry's) would overwrite.
        if (!stale) setFetched({ contactId, result });
      })
      .catch(() => { if (!stale) setFetched({ contactId, result: { status: "error" } }); });
    return () => { stale = true; };
  }, [accountId, contactId, retryNonce]);

  const load: DrawerLoad | { status: "loading" } =
    contactId && fetched?.contactId === contactId ? fetched.result : { status: "loading" };

  // The Texts row's own read (consent chain PR-2): re-read whenever the summary is (a phone save, a
  // pick, a row action, an Undo all bump retryNonce), with the same stale-closure guard. Never
  // initialised to `null`: the wiring test finds `fetched` above by that starting value.
  const [texts, setTexts] = useState<{ contactId: string; load: TextsLoad }>({ contactId: "", load: { status: "loading" } });
  useEffect(() => {
    if (!contactId) return;
    let stale = false;
    fetch(`/api/accounts/${accountId}/contacts/${contactId}/texts`)
      .then(async (res) => {
        if (stale) return;
        const next = await textsLoadFrom(res);
        if (!stale) setTexts({ contactId, load: next });
      })
      .catch(() => { if (!stale) setTexts({ contactId, load: { status: "error" } }); });
    return () => { stale = true; };
  }, [accountId, contactId, retryNonce]);
  const textsLoad: TextsLoad = contactId && texts.contactId === contactId ? texts.load : { status: "loading" };

  // The Email row's own read (consent PR-3), the Texts row's pattern; its starting value's SHAPE
  // differs (an `email` key), so the wiring test can tell the two apart.
  const [emailRead, setEmailRead] = useState<{ contactId: string; email: EmailLoad }>({ contactId: "", email: { status: "loading" } });
  useEffect(() => {
    if (!contactId) return;
    let stale = false;
    fetch(`/api/accounts/${accountId}/contacts/${contactId}/email`)
      .then(async (res) => {
        if (stale) return;
        const next = await emailLoadFrom(res);
        if (!stale) setEmailRead({ contactId, email: next });
      })
      .catch(() => { if (!stale) setEmailRead({ contactId, email: { status: "error" } }); });
    return () => { stale = true; };
  }, [accountId, contactId, retryNonce]);
  const emailLoad: EmailLoad = contactId && emailRead.contactId === contactId ? emailRead.email : { status: "loading" };

  const body: ParsedDrawerSummary | null = load.status === "ready" ? load.body : null;
  const locale: Locale = body?.locale ?? pageLocale;
  const tx = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  const fullHref = contactId ? `/dashboard/accounts/${accountId}/contacts/${contactId}` : "#";
  // C3: a section's Try again keeps the body on screen and re-reads the route.
  const retrySection = () => setRetryNonce((n) => n + 1);
  const stateOf = (s: { status: string } | undefined): SectionState =>
    load.status === "loading" ? "loading" : s && s.status === "ready" ? "ready" : "error";
  const who = body && body.who.status === "ready" ? body.who : null;
  const fieldsRow = row ? drawerFieldsRow(row, load) : null;
  // The who section's one error. A `?peek=` stub whose fields never arrived (the whole drawer's
  // error, or a `who` the parser refused) shows it in place of the fields, and it is not said twice.
  const whoError = (
    <div role="alert" data-drawer-who-error className="flex flex-wrap items-center gap-2 text-sm">
      <p className="text-muted-foreground">
        {body?.who.status === "error" ? body.who.text : tx("record.card.failed", { title: tx("contact.details") })}
      </p>
      <RecordCardRetry label={tx("record.card.retry")} onRetry={retrySection} />
    </div>
  );

  return (
    <Sheet open={row !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md"
        closeLabel={tx("drawer.close")}
        // Radix's own Escape listener sits on `document` with `{capture: true}` and runs BEFORE any
        // bubble-phase `onKeyDown` on a field inside this sheet — including InlineField's own Escape
        // handler, which only means to cancel the field being edited. preventDefault here stops
        // Radix's dismiss for THIS keypress only; the focused field's own onKeyDown still runs right
        // after, so the edit cancels normally. Esc with no input focused still closes the drawer.
        onEscapeKeyDown={(e) => {
          const el = document.activeElement;
          if (el instanceof HTMLInputElement && e.currentTarget instanceof Node && e.currentTarget.contains(el)) {
            e.preventDefault();
          }
        }}
      >
        {row === null ? null : (
          <LocaleProvider locale={locale}>
            <div lang={locale} className="flex min-h-0 flex-1 flex-col">
              <SheetHeader>
                <RecordHeader
                  name={body?.header.name ?? contactDisplayName(row)}
                  subtitle={body?.header.subtitle ?? null}
                  subtitleHref={body?.header.subtitleHref ?? undefined}
                  actions={body?.header.actions ?? []}
                  headingLevel={2}
                  // The dialog is named by the customer's name (Radix needs a Dialog.Title).
                  wrapHeading={(h) => <SheetTitle asChild>{h}</SheetTitle>}
                  trailing={
                    <Link href={fullHref} aria-label={tx("drawer.openFull")}
                      // mr-8 clears the Sheet's absolutely placed close button (sheet.tsx:84).
                      className="mr-8 inline-flex min-h-11 items-center rounded-[var(--radius-ctl)] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8">
                      <ExternalLink className="size-4" aria-hidden />
                    </Link>
                  }
                />
                {load.status === "loading" ? <Skeleton data-testid="drawer-skeleton" className="h-11 w-2/3 rounded-[var(--radius-ctl)]" /> : null}
                <SheetDescription className="sr-only">{tx("drawer.description")}</SheetDescription>
              </SheetHeader>

              <div data-testid="drawer-scroll" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6">
                {load.status === "error" ? (
                  <Notice tone="crit" className="p-3">
                    <p className="text-muted-foreground">{tx("drawer.loadFailed")}</p>
                    <div className="mt-2">
                      <Button size="sm" variant="ghost" onClick={() => {
                        // The whole drawer's error only: drop the paired fetch so `load` falls back to
                        // "loading", then refire the guarded effect (same `stale` guard as a normal load).
                        setFetched(null);
                        setRetryNonce((n) => n + 1);
                      }}>
                        {tx("record.card.retry")}
                      </Button>
                    </div>
                  </Notice>
                ) : null}

                {/* The read-only sections exist only once the route answered or while it loads; the
                    whole drawer's error above stands in for all three (C2), the fields below stay. */}
                {load.status === "error" ? null : (<>
                <div data-drawer-section="facts" data-state={stateOf(body?.facts)} className={SECTION_WRAP}>
                  <RecordSection id="facts" label={null} state={stateOf(body?.facts)}
                    errorText={body?.facts.status === "error" ? body.facts.text : tx("record.summary.failed")}
                    retryLabel={tx("record.card.retry")} onRetry={retrySection}
                    skeleton={<div data-testid="drawer-skeleton"><RecordCardSkeleton rows={1} /></div>}>
                    {body?.facts.status === "ready"
                      ? <SummaryBody view={body.facts.view} retryLabel={tx("record.card.retry")} onRetry={retrySection} />
                      : null}
                  </RecordSection>
                </div>

                <div data-drawer-section="next-up" data-state={stateOf(body?.nextUp)} className={SECTION_WRAP}>
                  <RecordSection id="next-up" label={tx("record.card.nextUp")} state={stateOf(body?.nextUp)}
                    errorText={body?.nextUp.status === "error" ? body.nextUp.text : tx("record.nextUp.failed")}
                    retryLabel={tx("record.card.retry")} onRetry={retrySection}
                    skeleton={<div data-testid="drawer-skeleton"><RecordCardSkeleton rows={3} /></div>}>
                    {/* D4: no "Add a To-do": the composer that holds it is on the record, one link away (Q2). */}
                    {body?.nextUp.status === "ready"
                      ? <NextUpBody view={body.nextUp.view} emptyText={body.nextUp.emptyText} addTodoLabel={null} />
                      : null}
                  </RecordSection>
                </div>

                <div data-drawer-section="recent" data-state={stateOf(body?.recent)} className={SECTION_WRAP}>
                  <RecordSection id="recent" label={tx("drawer.recent")} state={stateOf(body?.recent)}
                    errorText={body?.recent.status === "error" ? body.recent.text : tx("record.activity.failed")}
                    retryLabel={tx("record.card.retry")} onRetry={retrySection}
                    skeleton={<div data-testid="drawer-skeleton"><TimelineItemSkeleton rows={5} /></div>}>
                    {body?.recent.status === "ready" ? (
                      <div className="space-y-2">
                        {body.recent.failedText ? (
                          // Some sources failed: the rows that loaded stay, and this says what could not.
                          <div role="alert" data-timeline-failed className="flex flex-wrap items-center gap-2 text-sm">
                            <p className="text-muted-foreground">{body.recent.failedText}</p>
                            <RecordCardRetry label={tx("record.card.retry")} onRetry={retrySection} />
                          </div>
                        ) : null}
                        {body.recent.emptyText ? <p className="text-sm text-muted-foreground">{body.recent.emptyText}</p> : null}
                        {body.recent.rows.length > 0 ? (
                          <ol className="flex flex-col">
                            {body.recent.rows.map((r) => (
                              <li key={r.key} data-testid="drawer-recent-item" className="border-t border-[var(--row-line)] first:border-t-0">
                                <TimelineItem kind={r.kind} icon={r.kind === "task" && r.excerpt?.done ? CheckSquare : ROW_ICON[r.kind]}
                                  mark={r.mark} verb={r.verb} status={r.status} detail={r.detail} time={r.time} dateTime={r.dateTime}>
                                  {r.excerpt ? (
                                    <p lang={r.excerpt.lang} className={cn("line-clamp-2 break-words text-sm",
                                      r.excerpt.done ? "text-muted-foreground line-through" : "text-card-foreground")}>{r.excerpt.text}</p>
                                  ) : null}
                                </TimelineItem>
                              </li>
                            ))}
                          </ol>
                        ) : null}
                        <Link href={body.recent.seeAllHref} data-drawer-see-all className={GHOST_LINK}>{tx("drawer.seeAll")}</Link>
                      </div>
                    ) : null}
                  </RecordSection>
                </div>
                </>)}

                <div data-drawer-section="who" data-state={body ? (who ? "ready" : "error") : load.status === "error" ? "error" : "loading"} className={SECTION_WRAP}>
                  {/* The fields never wait on the route (D6), except a ?peek= stub's, which come from it (Q1). */}
                  <RecordSection id="who" label={tx("contact.details")} state="ready"
                    errorText={tx("record.card.failed", { title: tx("contact.details") })}
                    retryLabel={tx("record.card.retry")} onRetry={retrySection}>
                    <div className="space-y-4">
                      {fieldsRow ? (
                        <dl className="space-y-1">
                          {FIELDS.map(({ field, labelKey, type }) => (
                            // Keyed by contact id + field (+ where the values came from): a bare `field`
                            // key would reconcile instead of remount, showing contact A's values under B.
                            <div key={`${row.id}:${field}:${fieldsRow === row ? "row" : "route"}`} className={LABEL_ROW}>
                              <dt className="text-muted-foreground text-xs">{tx(labelKey)}</dt>
                              <dd>
                                <InlineField
                                  label={tx(labelKey)}
                                  field={field}
                                  inputType={type}
                                  locale={locale}
                                  value={(fieldsRow[field] as string | null) ?? null}
                                  save={async (v) => {
                                    const saved = await updateContactFieldAction(accountId, row.id, field, v);
                                    // A phone edit can make the number ambiguous, or settle it: re-read the summary so the Check number row follows (review R3-I2).
                                    if (field === "phone") setRetryNonce((n) => n + 1);
                                    // A name or email edit changes the header (name, dialog accessible name, Call's aria label, Email action), which the route also owns: re-read on those saves too (final review, item 2).
                                    if (saved.ok && (field === "first_name" || field === "last_name" || field === "email")) setRetryNonce((n) => n + 1);
                                    return saved;
                                  }}
                                  {...(field === "phone" ? {
                                    undoPhone: async (undo: PhoneInlineUndo) => {
                                      const r = await undoInlinePhoneEditAction(accountId, row.id, undo);
                                      // Same reason as the save above: the undo can move the flag too, so the row must re-read.
                                      if (r.ok) setRetryNonce((n) => n + 1);
                                      return r;
                                    },
                                  } : {})}
                                />
                              </dd>
                            </div>
                          ))}
                          {who?.language ? (
                            <LanguageField key={`${row.id}:language`} accountId={accountId} contactId={row.id} view={who.language}
                              onChanged={() => setRetryNonce((n) => n + 1)} />
                          ) : load.status === "loading" ? (
                            <div data-drawer-language-skeleton data-testid="drawer-skeleton"><RecordCardSkeleton rows={1} /></div>
                          ) : null}
                          <div key={`${row.id}:company_name`} className={LABEL_ROW}>
                            <dt className="text-muted-foreground text-xs">{tx("contact.company")}</dt>
                            <dd><BusinessInlineField accountId={accountId} contactId={row.id} value={fieldsRow.company_name ?? null} /></dd>
                          </div>
                        </dl>
                      ) : load.status === "loading" ? (
                        // M6: skeleton lines only while the route is still answering, never forever.
                        <div data-drawer-fields-skeleton data-testid="drawer-skeleton"><RecordCardSkeleton rows={5} /></div>
                      ) : whoError}

                      <TextsRow accountId={accountId} contactId={row.id} load={textsLoad}
                        onChanged={() => setRetryNonce((n) => n + 1)} onRetry={() => setRetryNonce((n) => n + 1)} />
                      <EmailRow accountId={accountId} contactId={row.id} load={emailLoad}
                        showTitle={textsLoad.status === "ready" && textsLoad.view.kind === "no_number"}
                        onChanged={() => setRetryNonce((n) => n + 1)} onRetry={() => setRetryNonce((n) => n + 1)} />

                      {who ? (
                        <>
                          <dl>
                            {/* Keyed by contact id, like FIELDS' rows (review round 1, m6). */}
                            <SourceField
                              key={row.id}
                              accountId={accountId}
                              contactId={row.id}
                              source={who.source}
                              sourceHint={who.sourceHint}
                              onSaved={() => setRetryNonce((n) => n + 1)}
                            />
                            {/* F-085 part 1: left out when the server did not say, never shown as Unassigned on a guess.
                                Keyed by contact AND holder, so a re-read with a different holder remounts the field. */}
                            {who.assignedTo !== undefined ? (
                              <div className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2" data-assignee-row>
                                <dt className="text-muted-foreground text-xs">{t(m, "assign.field.label", locale)}</dt>
                                <dd className="min-w-0">
                                  <ContactAssigneeField
                                    key={`${row.id}:${who.assignedTo ?? ""}`}
                                    accountId={accountId}
                                    contactId={row.id}
                                    value={who.assignedTo}
                                    options={members}
                                    readOnly={!canAssign}
                                    viewerId={viewerId}
                                  />
                                </dd>
                              </div>
                            ) : null}
                          </dl>
                          {who.tags.status === "ready" ? (
                            <TagsRow accountId={accountId} contactId={row.id} tags={who.tags.tags} locale={locale}
                              onChanged={() => setRetryNonce((n) => n + 1)} />
                          ) : (
                            <div role="alert" data-drawer-tags-error className="flex flex-wrap items-center gap-2 text-sm">
                              <p className="text-muted-foreground">{tx("record.card.failed", { title: tx("contact.tags") })}</p>
                              <RecordCardRetry label={tx("record.card.retry")} onRetry={retrySection} />
                            </div>
                          )}
                        </>
                      ) : load.status === "loading" ? (
                        <div data-testid="drawer-skeleton"><RecordCardSkeleton rows={3} /></div>
                      ) : body && fieldsRow ? whoError : null}
                    </div>
                  </RecordSection>
                </div>

                {/* D7: Groups, properties and related people are on the full record, one link away. */}
                <div data-drawer-bottom className="space-y-2 border-t border-[var(--line)] pt-3">
                  <p className="text-sm text-muted-foreground">{tx("drawer.moreOnRecord")}</p>
                  <Link href={fullHref} data-drawer-open-full className={GHOST_LINK}>{tx("drawer.openFull")}</Link>
                </div>
              </div>
            </div>
          </LocaleProvider>
        )}
      </SheetContent>
    </Sheet>
  );
}

// Reuses the EXISTING FormData tag actions with the same hidden-input idiom as
// contact-fields-panel.tsx. `onChanged` fires only after a successful submission and bumps the
// drawer's `retryNonce`, so a tag add/remove re-reads the route the badges come from.
async function submitTagAction(run: () => Promise<void>, onChanged: () => void, locale: Locale): Promise<boolean> {
  try {
    await run();
    onChanged();
    return true;
  } catch {
    // A stale tab posting a content-hashed server-action id from before a redeploy REJECTS rather
    // than resolving, and that must reach the operator as a toast, not vanish silently.
    toast.error(t(m, "inline.crashed", locale));
    // Reported rather than swallowed, so the caller keeps the typed tag on screen.
    return false;
  }
}

function TagsRow({ accountId, contactId, tags, locale, onChanged }: {
  accountId: string; contactId: string; tags: { id: string; name: string }[]; locale: Locale; onChanged: () => void;
}) {
  const boundAdd = addTagAction.bind(null, accountId);
  const boundRemove = removeTagAction.bind(null, accountId);
  const hidden = <input type="hidden" name="contactId" value={contactId} />;
  const addTag = useFormSubmit(async (formData, form) => {
    const ok = await submitTagAction(() => boundAdd(formData), onChanged, locale);
    // Cleared for the next tag ONLY on success; on failure the typed tag stays.
    if (ok && form.isConnected) form.reset();
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <form
          key={tag.id}
          // Keeps the `action` prop: this form carries no typed input, so React's post-action reset
          // has nothing to discard. `void` because an action prop must return void.
          action={(formData) => void submitTagAction(() => boundRemove(formData), onChanged, locale)}
          className="inline-flex"
        >
          {hidden}
          <input type="hidden" name="tagId" value={tag.id} />
          <button type="submit" className="group rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" title={tag.name}
            aria-label={t(m, "contact.removeTag", locale, { name: tag.name })}>
            <Badge variant="secondary" className="gap-1 pr-1.5">
              <span lang="">{tag.name}</span>
              <X className="text-muted-foreground group-hover:text-foreground size-3" aria-hidden />
            </Badge>
          </button>
        </form>
      ))}
      {/* onSubmit, NOT the `action` prop: a failed add must keep the tag the operator typed (lib/forms/use-form-submit.ts). */}
      <form onSubmit={addTag.onSubmit} className="inline-flex items-center gap-1">
        {hidden}
        <Input name="tag" placeholder={t(m, "contact.addTag", locale)} className="min-h-11 md:min-h-8 w-28 text-xs" />
        <Button type="submit" size="icon-xs" variant="ghost" aria-label={t(m, "contact.addTag", locale)}>
          <Plus className="size-3" aria-hidden />
        </Button>
      </form>
    </div>
  );
}
