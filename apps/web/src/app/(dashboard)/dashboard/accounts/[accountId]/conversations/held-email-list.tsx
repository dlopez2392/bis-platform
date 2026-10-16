"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListPanel, LIST_ROW } from "@/components/ui/list-panel";
import { EmptyState } from "@/components/empty-state";
import { formatDateTimeInZone } from "@/lib/format";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";
import { runGuarded } from "@/lib/ui/guarded-run";
import { runHeldAction, runUndoHeldEmail } from "./held-email-handlers";
import { fileHeldEmailAction, dismissHeldEmailAction, undoHeldEmailAction } from "./inbound-actions";
import { searchHeldContacts, type HeldSearchState, type SearchHitLite } from "./held-email-search";
import { HeldSearchResults } from "./held-search-results";

/** S-06 part 1, Task 12: the inbox's "Needs a look" filter — held emails
 *  Task 3 could not match to a customer with confidence (not on the
 *  reached conversation's own contact's record, or whose SPF/DKIM could
 *  not be confirmed). Each offers one primary — File on the suggested
 *  contact (the token's own customer) — and two ghosts: Choose a different
 *  record, or Not a customer at all (rule 8, rule 3). */
export type HeldItemView = {
  id: string;
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  excerpt: string;
  receivedAt: string;
  reason: "not_on_record" | "unverified";
  suggestion: { contactId: string; name: string };
};

const REASON_KEY: Record<HeldItemView["reason"], MessageKey> = {
  not_on_record: "conversations.held.reason.notOnRecord",
  unverified: "conversations.held.reason.unverified",
};

const SEARCH_MIN = 2;
const SEARCH_DEBOUNCE_MS = 250;

function HeldEmailRow({
  accountId, item, locale, timezone, onHide, onShow, onUndone, registerRef,
}: {
  accountId: string;
  item: HeldItemView;
  locale: Locale;
  timezone: string;
  /** Optimistic removal — called immediately on click, before the server
   *  answers (DESIGN.md rule 6: reversible actions run at once). */
  onHide: () => void;
  /** Puts the row back — only on a thrown action or a `failed` answer. */
  onShow: () => void;
  onUndone: () => void;
  /** The list's own focus bookkeeping (coordinator minor): where keyboard
   *  focus lands once this row is gone. */
  registerRef: (el: HTMLElement | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const [choosing, setChoosing] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<HeldSearchState>({ status: "idle" });
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Too short to search: the render below already withholds `search` for
    // any query shorter than this, so there is nothing to clear here —
    // setting state synchronously inside an effect body is exactly the
    // cascading-render shape `react-hooks/set-state-in-effect` flags.
    if (!choosing || query.trim().length < SEARCH_MIN) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchHeldContacts(accountId, query, locale, controller.signal)
        .then((outcome) => setSearch(outcome))
        .catch((error: unknown) => {
          // An abort is this component cancelling itself (a newer keystroke
          // superseded it), not a search failure — reporting it would flash
          // the error line on every keystroke.
          if (error instanceof DOMException && error.name === "AbortError") return;
          setSearch({ status: "error" });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [choosing, query, accountId, locale]);

  // Coordinator minor: Choose a record opens with the search box already
  // focused, so a keyboard user does not have to Tab to it separately.
  useEffect(() => {
    if (choosing) searchInputRef.current?.focus();
  }, [choosing]);

  function runFile(contactId: string | null, name: string) {
    onHide();
    runGuarded(busy, startTransition, () => runHeldAction(
      () => fileHeldEmailAction(accountId, item.id, contactId),
      toast, locale,
      t(m, "conversations.held.filed", locale, { name }),
      onShow,
      (undo) => runUndoHeldEmail(() => undoHeldEmailAction(accountId, undo), toast, locale, () => { onUndone(); router.refresh(); }),
    ));
  }

  function runDismiss() {
    onHide();
    runGuarded(busy, startTransition, () => runHeldAction(
      () => dismissHeldEmailAction(accountId, item.id),
      toast, locale,
      t(m, "conversations.held.dismissed", locale),
      onShow,
      (undo) => runUndoHeldEmail(() => undoHeldEmailAction(accountId, undo), toast, locale, () => { onUndone(); router.refresh(); }),
    ));
  }

  const dot = <span data-dot aria-hidden className="size-2 rounded-full bg-[var(--warn)]" />;
  // The sender's own address, beside their name (lessons: never the name
  // alone) — but when there IS no name, the name slot already shows the
  // address, so a second, identical span would just repeat it.
  const showAddressSeparately = item.fromName !== null;

  return (
    <article
      data-held-item={item.id}
      lang={locale}
      tabIndex={-1}
      ref={registerRef}
      className={cn("flex flex-col gap-2 px-3 py-3 outline-none", LIST_ROW)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-baseline gap-1.5">
          <span className="font-medium text-foreground">{item.fromName ?? item.fromEmail}</span>
          {showAddressSeparately ? <span className="truncate text-xs text-muted-foreground">{item.fromEmail}</span> : null}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatDateTimeInZone(item.receivedAt, timezone, locale)}
        </span>
      </div>
      <p className="truncate text-sm">{item.subject ?? t(m, "conversations.held.noSubject", locale)}</p>
      <p data-held-reason={item.reason} className="flex items-center gap-2 text-xs">
        {dot}
        {t(m, REASON_KEY[item.reason], locale)}
      </p>
      <p className="line-clamp-2 text-xs text-muted-foreground">{item.excerpt}</p>
      <p className="text-xs text-muted-foreground">
        {t(m, "conversations.held.suggestion", locale, { name: item.suggestion.name })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button" size="sm" className="min-h-11 md:min-h-8" disabled={pending}
          onClick={() => runFile(null, item.suggestion.name)}
        >
          {t(m, "conversations.held.fileOn", locale, { name: item.suggestion.name })}
        </Button>
        <Button
          type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8" disabled={pending}
          aria-expanded={choosing}
          onClick={() => setChoosing((v) => !v)}
        >
          {t(m, "conversations.held.choose", locale)}
        </Button>
        <Button
          type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8" disabled={pending}
          onClick={runDismiss}
        >
          {t(m, "conversations.held.notCustomer", locale)}
        </Button>
      </div>
      {choosing ? (
        <div className="flex flex-col gap-2 pt-1">
          <label className="sr-only" htmlFor={`held-search-${item.id}`}>
            {t(m, "conversations.held.searchLabel", locale)}
          </label>
          <Input
            ref={searchInputRef}
            id={`held-search-${item.id}`}
            className="min-h-11 md:min-h-8"
            placeholder={t(m, "conversations.held.searchLabel", locale)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim().length >= SEARCH_MIN ? (
            <HeldSearchResults
              state={search.status !== "idle" ? search : { status: "idle" }}
              pending={pending}
              locale={locale}
              onPick={(hit: SearchHitLite) => runFile(hit.id, hit.label)}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function HeldEmailList({
  accountId, items, locale, timezone,
}: {
  accountId: string;
  items: HeldItemView[];
  locale: Locale;
  timezone: string;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = items.filter((i) => !hidden.has(i.id));
  const rowRefs = useRef(new Map<string, HTMLElement | null>());
  const containerRef = useRef<HTMLDivElement>(null);
  // Coordinator minor: after an action removes a row, focus moves to the
  // NEXT remaining item (or the previous one, if the removed row was last),
  // falling back to the list's own container when nothing is left — never
  // left stranded on a now-unmounted button.
  const pendingFocusRef = useRef<string | null>(null);

  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    if (target === "__container__") { containerRef.current?.focus(); return; }
    rowRefs.current.get(target)?.focus();
  }, [hidden]);

  function hide(id: string) {
    const idx = visible.findIndex((i) => i.id === id);
    const next = visible[idx + 1] ?? visible[idx - 1];
    pendingFocusRef.current = next ? next.id : "__container__";
    setHidden((s) => { const n = new Set(s); n.add(id); return n; });
  }
  function show(id: string) {
    setHidden((s) => { const n = new Set(s); n.delete(id); return n; });
  }

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={t(m, "conversations.held.title", locale)}
        body={t(m, "conversations.held.empty", locale)}
        lang={locale}
      />
    );
  }

  return (
    <ListPanel as="div" className="flex flex-col" ref={containerRef} tabIndex={-1}>
      {visible.map((item) => (
        <HeldEmailRow
          key={item.id}
          accountId={accountId}
          item={item}
          locale={locale}
          timezone={timezone}
          onHide={() => hide(item.id)}
          onShow={() => show(item.id)}
          onUndone={() => show(item.id)}
          registerRef={(el) => rowRefs.current.set(item.id, el)}
        />
      ))}
    </ListPanel>
  );
}
