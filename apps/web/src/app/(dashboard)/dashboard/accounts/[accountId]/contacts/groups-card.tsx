"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import type { ContactGroup, GroupKind, GroupSearchHit } from "@bis/db";
import { InlineField } from "@/components/inline-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { contactDisplayName } from "@/lib/format";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { useLocale } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n/locale";
import {
  searchGroupsAction, createGroupAction, addToGroupAction, setRoleAction, setBillingAction, makePrimaryAction,
  removeMembershipAction, restoreMembershipAction, renameGroupAction, setBillingAddressAction,
  type GroupActionError, type GroupResult, type GroupSearchResult,
} from "./groups-actions";

/**
 * The Groups card (S-02 §8): households and business customers this person
 * belongs to, on the drawer and on the contact page. It loads, empties and
 * fails on its own (record page v2): its own GET, its own skeleton, its own
 * Retry. Each change runs at once (rule 6); remove, main, pays, role, rename
 * and billing address carry an Undo built from what the SERVER handed back,
 * never a value captured here. Add and create carry none (review correction
 * 1: neither returns a reliable signal of what the add replaced). What a
 * Technician sees is trimmed by the database (G8); `canManageGroups` only
 * hides the two editors they may not use (A6), the server refuses them anyway.
 */
export type GroupsLoad = { status: "loading" } | { status: "error" } | { status: "ready"; groups: ContactGroup[] };
type ViewProps = { accountId: string; contactId: string; canManageGroups: boolean; headingHidden?: boolean };

const kindLabel = (k: GroupKind, locale: Locale) => t(m, k === "household" ? "groups.kind.household" : "groups.kind.business", locale);
/** `{name}` filled by a replacer FUNCTION, so a name holding "$&" is inserted literally (t.ts, final review N1). */
const withName = (template: string, name: string) => template.replace("{name}", () => name);

const ERROR_KEYS: readonly GroupActionError[] = ["groups.refused", "groups.failed", "groups.nameTaken", "groups.tooLong"];
/** An action's error key as the catalogue's sentence, in the reader's language; anything else (a newer
 *  server's key) is "didn't save". */
export function errorText(e: unknown, locale: Locale): string {
  return t(m, ERROR_KEYS.includes(e as GroupActionError) ? (e as GroupActionError) : "groups.failed", locale);
}

// ── The route's body, parsed rather than cast (the drawer's summary lesson):
// a server older or newer than this tab's bundle gets the error state, never
// a throw during render.
const isStrOrNull = (v: unknown) => v === null || typeof v === "string";
function isGroup(g: unknown): g is ContactGroup {
  if (!g || typeof g !== "object") return false;
  const r = g as Record<string, unknown>;
  return typeof r.memberId === "string" && typeof r.groupId === "string" && typeof r.name === "string"
    && (r.kind === "household" || r.kind === "business")
    && isStrOrNull(r.billingAddress) && isStrOrNull(r.role)
    && typeof r.isPrimary === "boolean" && typeof r.isBilling === "boolean" && typeof r.moreOthers === "number"
    && Array.isArray(r.others) && r.others.every((o: unknown) => {
      const x = o as Record<string, unknown> | null;
      return !!x && typeof x.contactId === "string" && isStrOrNull(x.firstName) && isStrOrNull(x.lastName);
    });
}
export async function groupsLoadFrom(res: Response): Promise<Exclude<GroupsLoad, { status: "loading" }>> {
  if (!res.ok) return { status: "error" };
  try {
    const body = (await res.json()) as { groups?: unknown } | null;
    const groups = body?.groups;
    if (!Array.isArray(groups) || !groups.every(isGroup)) return { status: "error" };
    return { status: "ready", groups };
  } catch {
    return { status: "error" };
  }
}

// ── The writes. Exported for the test (no DOM renderer in apps/web).
type Undo = () => Promise<GroupResult>;

async function runUndo(undo: Undo, onChanged: () => void, locale: Locale): Promise<void> {
  try {
    const r = await undo();
    if (!r.ok) { toast.error(errorText(r.error, locale)); return; }
    onChanged();
  } catch {
    toast.error(t(m, "groups.failed", locale));
  }
}

/** One write and its toast, in the reader's language (S-10 T3; `locale` defaults to "en" so a caller
 *  that predates it is unchanged). A server action that REJECTS (a stale tab posting an action id
 *  from before a deploy) is a toast, not an unhandled throw. */
async function runGroupWrite<T extends object>(
  write: () => Promise<GroupResult<T>>,
  opts: { success: (r: T) => string; undo?: (r: T) => Undo | null; onChanged: () => void },
  locale: Locale = "en",
): Promise<boolean> {
  let r: GroupResult<T>;
  try { r = await write(); } catch { toast.error(t(m, "groups.failed", locale)); return false; }
  if (!r.ok) { toast.error(errorText(r.error, locale)); return false; }
  opts.onChanged();
  const undo = opts.undo?.(r) ?? null;
  if (undo) {
    toast.success(opts.success(r), { action: { label: t(m, "common.undo", locale), onClick: () => { void runUndo(undo, opts.onChanged, locale); } } });
  } else {
    toast.success(opts.success(r));
  }
  return true;
}

export const addExisting = (accountId: string, contactId: string, hit: GroupSearchHit, onChanged: () => void, locale: Locale = "en") =>
  runGroupWrite(() => addToGroupAction(accountId, contactId, hit.id),
    { success: () => withName(t(m, "groups.added", locale), hit.name), onChanged }, locale);

export const createAndAdd = (accountId: string, contactId: string, kind: GroupKind, name: string, onChanged: () => void, locale: Locale = "en") =>
  runGroupWrite(() => createGroupAction(accountId, contactId, kind, name),
    { success: (r) => withName(t(m, r.existed ? "groups.addedExisting" : "groups.added", locale), r.name), onChanged }, locale);

export const toggleBilling = (accountId: string, group: ContactGroup, onChanged: () => void, locale: Locale = "en") =>
  runGroupWrite(() => setBillingAction(accountId, group.memberId, !group.isBilling), {
    success: () => t(m, "groups.saved", locale),
    undo: (r) => () => setBillingAction(accountId, group.memberId, r.previous),
    onChanged,
  }, locale);

/** Undo goes back to the previous main; with none before, there is nothing to go back to. */
export const makeMain = (accountId: string, group: ContactGroup, onChanged: () => void, locale: Locale = "en") =>
  runGroupWrite(() => makePrimaryAction(accountId, group.memberId), {
    success: () => t(m, "groups.saved", locale),
    undo: (r) => { const prev = r.previous; return prev ? () => makePrimaryAction(accountId, prev) : null; },
    onChanged,
  }, locale);

export const removeFrom = (accountId: string, group: ContactGroup, onChanged: () => void, locale: Locale = "en") =>
  runGroupWrite(() => removeMembershipAction(accountId, group.memberId), {
    success: () => withName(t(m, "groups.removed", locale), group.name),
    undo: (r) => () => restoreMembershipAction(accountId, r.removed),
    onChanged,
  }, locale);

/** The server's failed search (`{ ok: false }`, fix round 1, I2) and a search
 *  that throws (a stale tab after a deploy) are both the search's error
 *  state; neither reaches the card as "no matches" or as a crash. */
export async function searchOutcome(p: Promise<GroupSearchResult>): Promise<{ status: "ready"; hits: GroupSearchHit[] } | { status: "error" }> {
  try {
    const r = await p;
    return r.ok ? { status: "ready", hits: r.hits } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

// ── The inline saves. InlineField runs the Undo with the payload a save hands
// back (`undoWith`), so the Undo writes the server's own `previous`. Each
// save and Undo that lands reports a change (fix round 1, I1): a rename can
// change the Business name the page shows.
type InlineResult = { ok: true; undoPayload?: unknown } | { ok: false; error: string };
async function toInline<P>(write: () => Promise<GroupResult<{ previous: P }>>, onChanged: () => void, locale: Locale): Promise<InlineResult> {
  const r = await write();
  if (!r.ok) return { ok: false, error: errorText(r.error, locale) };
  onChanged();
  return { ok: true, undoPayload: r.previous };
}
export async function inlineUndo(
  write: () => Promise<GroupResult<object>>, onChanged: () => void, locale: Locale = "en",
): Promise<{ ok: true } | { ok: false; error: string }> {
  let r: GroupResult<object>;
  try { r = await write(); } catch { return { ok: false, error: t(m, "groups.failed", locale) }; }
  if (!r.ok) return { ok: false, error: errorText(r.error, locale) };
  onChanged();
  return { ok: true };
}
/** The name edits under `source`'s rule (trim, free text) and refuses a blank
 *  HERE: InlineField's `required` rule speaks of a "company" (G4). */
export const nameSave = (accountId: string, groupId: string, onChanged: () => void, locale: Locale = "en") => async (v: string): Promise<InlineResult> =>
  v === "" ? { ok: false, error: t(m, "groups.nameEmpty", locale) } : toInline(() => renameGroupAction(accountId, groupId, v), onChanged, locale);
/** "" clears: the action and the database store null for it. */
export const roleSave = (accountId: string, memberId: string, onChanged: () => void, locale: Locale = "en") => (v: string): Promise<InlineResult> =>
  toInline(() => setRoleAction(accountId, memberId, v === "" ? null : v), onChanged, locale);
const addressSave = (accountId: string, groupId: string, onChanged: () => void, locale: Locale) => (v: string): Promise<InlineResult> =>
  toInline(() => setBillingAddressAction(accountId, groupId, v === "" ? null : v), onChanged, locale);

// ── The card.
/**
 * `onChanged` (fix round 1, I1) is the parent's, fired after every write and
 * Undo that landed: the drawer re-reads its own rows with it. The card also
 * refreshes the server-rendered page itself, because a group write can change
 * contacts.company_name (0069's trigger): the drawer's row comes from the
 * list page and the contact page's Business name from its own render.
 */
export function GroupsCard({ onChanged, ...props }: ViewProps & { onChanged?: () => void }) {
  const { accountId, contactId } = props;
  const router = useRouter();
  const locale = useLocale();
  const [nonce, setNonce] = useState(0);
  // Paired with the contact it was read for (the drawer's shape): "loading"
  // falls out of a mismatch, so only the fetch's own callbacks set state. A
  // refresh after a change keeps the current list on screen until the new
  // read lands, rather than flashing the skeleton under the toast.
  const [read, setRead] = useState<{ contactId: string; load: Exclude<GroupsLoad, { status: "loading" }> } | null>(null);
  useEffect(() => {
    let stale = false;
    fetch(`/api/accounts/${accountId}/contacts/${contactId}/groups`)
      .then(async (res) => {
        if (stale) return;
        const next = await groupsLoadFrom(res);
        if (!stale) setRead({ contactId, load: next });
      })
      .catch(() => { if (!stale) setRead({ contactId, load: { status: "error" } }); });
    return () => { stale = true; };
  }, [accountId, contactId, nonce]);
  const load: GroupsLoad = read?.contactId === contactId ? read.load : { status: "loading" };
  return (
    <GroupsCardView
      {...props}
      load={load}
      locale={locale}
      // Retry re-reads the card only: nothing changed.
      onRetry={() => { setRead(null); setNonce((n) => n + 1); }}
      onChanged={() => { setNonce((n) => n + 1); router.refresh(); onChanged?.(); }}
    />
  );
}

export function GroupsCardView({ accountId, contactId, canManageGroups, headingHidden, load, onRetry, onChanged, locale = "en" }:
  ViewProps & { load: GroupsLoad; onRetry: () => void; onChanged: () => void; locale?: Locale }) {
  const titleId = useId();
  const heading = <h3 id={titleId} className={headingHidden ? "sr-only" : "text-[13.5px] font-semibold text-card-foreground"}>{t(m, "groups.title", locale)}</h3>;
  const add = load.status === "ready" && load.groups.length > 0
    ? <AddToGroup accountId={accountId} contactId={contactId} onChanged={onChanged} locale={locale} /> : null;
  return (
    <section aria-labelledby={titleId} className="space-y-2" data-groups-card lang={locale}>
      {/* S-03 §8: inside a RecordCard its title is the one seen, so the h3 is sr-only (still the section's label),
         there is no empty row under that title, and Add keeps to the right. The drawer sets nothing: unchanged. */}
      {headingHidden && !add ? heading : (
        <div className={headingHidden ? "flex items-center justify-end gap-2" : "flex items-center justify-between gap-2"}>
          {heading}
          {add}
        </div>
      )}
      {load.status === "loading" ? (
        <div className="space-y-3" data-testid="groups-skeleton">
          <div className="space-y-1.5"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-full" /></div>
          <div className="space-y-1.5"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-2/3" /></div>
        </div>
      ) : load.status === "error" ? (
        // Plain words and a ghost Try again, announced: a tinted Notice was a box in the glass card (design check 1a).
        <div role="alert" className="space-y-2 text-sm">
          <p className="text-muted-foreground">{t(m, "groups.loadFailed", locale)}</p>
          <Button type="button" size="sm" variant="ghost" className="min-h-11 md:min-h-8" onClick={onRetry}>{t(m, "groups.retry", locale)}</Button>
        </div>
      ) : load.groups.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t(m, "groups.empty", locale)}</p>
          <AddToGroup accountId={accountId} contactId={contactId} onChanged={onChanged} locale={locale} />
        </div>
      ) : (
        /* A rule between rows, never a box per row (the page's own list idiom). */
        <ul className="flex flex-col text-sm">
          {load.groups.map((g) => (
            <GroupRow key={g.memberId} accountId={accountId} group={g} canManageGroups={canManageGroups} onChanged={onChanged} locale={locale} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Rule 3: a status is a dot AND a word, never colour alone. */
function Mark({ kind, label }: { kind: "primary" | "billing"; label: string }) {
  return (
    <span data-mark={kind} className="inline-flex items-center gap-1.5 text-xs text-foreground">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />{label}
    </span>
  );
}

function GroupRow({ accountId, group, canManageGroups, onChanged, locale }:
  { accountId: string; group: ContactGroup; canManageGroups: boolean; onChanged: () => void; locale: Locale }) {
  // One write at a time per row: a double click must not send the toggle twice.
  const [busy, setBusy] = useState(false);
  const act = (run: () => Promise<unknown>) => async () => {
    if (busy) return;
    setBusy(true);
    try { await run(); } finally { setBusy(false); }
  };
  const fieldRow = "grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2";
  return (
    <li className="space-y-1.5 border-t border-[var(--row-line)] py-2.5 first:border-t-0 first:pt-0" data-group-row={group.groupId}>
      <div className="flex items-center gap-2">
        {canManageGroups ? (
          <div className="-ml-2 min-w-0 flex-1">
            <InlineField label={t(m, "groups.name", locale)} field="source" value={group.name} locale={locale}
              save={nameSave(accountId, group.groupId, onChanged, locale)}
              undoWith={(prev) => inlineUndo(() => renameGroupAction(accountId, group.groupId, prev as string), onChanged, locale)} />
          </div>
        ) : <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>}
        <span className="shrink-0 text-xs text-muted-foreground">{kindLabel(group.kind, locale)}</span>
        {/* S-03 part 2b: the way to the household's or business's own record page. */}
        <Link href={`/dashboard/accounts/${accountId}/groups/${group.groupId}`} aria-label={withName(t(m, "groups.openAria", locale), group.name)}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 shrink-0 md:min-h-8")} data-group-open={group.groupId}>
          {t(m, "groups.open", locale)}
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {group.isPrimary ? (
          <span className="px-3"><Mark kind="primary" label={t(m, "groups.primary", locale)} /></span>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={act(() => makeMain(accountId, group, onChanged, locale))}>
            {t(m, "groups.makePrimary", locale)}
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-pressed={group.isBilling} disabled={busy}
          onClick={act(() => toggleBilling(accountId, group, onChanged, locale))}>
          {group.isBilling ? <Mark kind="billing" label={t(m, "groups.billing", locale)} /> : (
            // Off: a hollow dot beside the word, so on and off differ in SHAPE, not colour.
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full border border-[var(--line-strong)]" />{t(m, "groups.billing", locale)}
            </span>
          )}
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" disabled={busy}
          aria-label={`${t(m, "groups.remove", locale)}: ${group.name}`}
          onClick={act(() => removeFrom(accountId, group, onChanged, locale))}>
          {t(m, "groups.remove", locale)}
        </Button>
      </div>
      <dl className="space-y-1">
        <div className={fieldRow}>
          <dt className="text-xs text-muted-foreground">{t(m, "groups.role", locale)}</dt>
          {/* `source`'s rule is the role's rule: trim, free text (plan deviation 5). */}
          <dd className="min-w-0">
            <InlineField label={t(m, "groups.role", locale)} field="source" value={group.role} locale={locale}
              placeholder={t(m, "groups.rolePlaceholder", locale)}
              save={roleSave(accountId, group.memberId, onChanged, locale)}
              undoWith={(prev) => inlineUndo(() => setRoleAction(accountId, group.memberId, prev as string | null), onChanged, locale)} />
          </dd>
        </div>
        {canManageGroups ? (
          <div className={fieldRow}>
            <dt className="text-xs text-muted-foreground">{t(m, "groups.billingAddress", locale)}</dt>
            <dd className="min-w-0">
              <InlineField label={t(m, "groups.billingAddress", locale)} field="source" value={group.billingAddress} locale={locale}
                save={addressSave(accountId, group.groupId, onChanged, locale)}
                undoWith={(prev) => inlineUndo(() => setBillingAddressAction(accountId, group.groupId, prev as string | null), onChanged, locale)} />
            </dd>
          </div>
        ) : null}
      </dl>
      {group.others.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t(m, "groups.others", locale)}:{" "}
          {group.others.map((o, i) => (
            <span key={o.contactId}>
              {i > 0 ? ", " : null}
              {/* The contact list's drawer, not a nested one (plan deviation 6). */}
              <Link
                className="rounded-[var(--radius-ctl)] text-foreground underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                href={`/dashboard/accounts/${accountId}/contacts?peek=${o.contactId}`}
              >
                {contactDisplayName({ first_name: o.firstName, last_name: o.lastName })}
              </Link>
            </span>
          ))}
          {/* Final review minor 10: the read names at most GROUP_OTHERS_SHOWN; the rest are a count of
              rows the caller's RLS returned, so a Technician never sees one. */}
          {group.moreOthers > 0 ? ` ${t(m, "groups.othersMore", locale, { count: group.moreOthers })}` : null}
        </p>
      ) : null}
    </li>
  );
}

type SearchResult = Awaited<ReturnType<typeof searchOutcome>>;

function AddToGroup({ accountId, contactId, onChanged, locale }: { accountId: string; contactId: string; onChanged: () => void; locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);
  // Paired with the term it answered, so a stale answer never shows under a newer term.
  const [found, setFound] = useState<{ term: string; result: SearchResult } | null>(null);
  const name = term.trim();
  useEffect(() => {
    if (!open || name === "") return;
    let stale = false;
    const timer = setTimeout(() => {
      void searchOutcome(searchGroupsAction(accountId, name)).then((result) => { if (!stale) setFound({ term: name, result }); });
    }, 200);
    return () => { stale = true; clearTimeout(timer); };
  }, [accountId, name, open]);
  const search: SearchResult | "searching" | null = name === "" ? null : found?.term === name ? found.result : "searching";

  const close = () => { setOpen(false); setTerm(""); setFound(null); };
  const pick = async (run: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    const done = await run().finally(() => setBusy(false));
    if (done) close();
  };

  return (
    <Popover open={open} onOpenChange={(o) => { if (o) setOpen(true); else close(); }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="-mr-2">
          <Plus aria-hidden />{t(m, "groups.add", locale)}
        </Button>
      </PopoverTrigger>
      {/* Esc closes it (Radix): the popover is the top layer, so the drawer stays open. */}
      <PopoverContent className="w-80 p-0" align="end" lang={locale}>
        <Command shouldFilter={false}>
          <CommandInput placeholder={t(m, "groups.searchPlaceholder", locale)} value={term} onValueChange={setTerm} />
          <CommandList>
            {search === "searching" ? (
              <div className="space-y-1.5 px-3 py-2" data-testid="groups-search-skeleton">
                <Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" />
              </div>
            ) : search?.status === "error" ? (
              <p role="status" className="px-3 py-2 text-xs text-muted-foreground">{t(m, "groups.searchFailed", locale)}</p>
            ) : null}
            {name ? (
              <CommandGroup>
                {search !== null && search !== "searching" && search.status === "ready" ? search.hits.map((h) => (
                  <CommandItem key={h.id} value={`group-${h.id}`} disabled={busy}
                    onSelect={() => void pick(() => addExisting(accountId, contactId, h, onChanged, locale))}>
                    <span className="min-w-0 flex-1 truncate">{h.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{kindLabel(h.kind, locale)}</span>
                  </CommandItem>
                )) : null}
                {(["household", "business"] as const).map((kind) => (
                  <CommandItem key={kind} value={`create-${kind}`} disabled={busy}
                    onSelect={() => void pick(() => createAndAdd(accountId, contactId, kind, name, onChanged, locale))}>
                    <Plus aria-hidden className="text-muted-foreground" />
                    <span className="min-w-0 flex-1 break-words">
                      {withName(t(m, kind === "household" ? "groups.createHousehold" : "groups.createBusiness", locale), name)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
