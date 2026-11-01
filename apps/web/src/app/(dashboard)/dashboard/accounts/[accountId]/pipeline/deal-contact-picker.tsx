"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HighlightedText } from "@/components/highlighted-text";
import { nameRanges, phoneRanges } from "@/lib/contacts/search-highlight";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import type { SearchHit, SearchResults } from "@/app/api/accounts/[accountId]/search/route";

/**
 * The new-deal customer picker. It replaced a plain dropdown of the newest 200 contacts (pipeline/page.tsx), so
 * on any account past 200 people the customer a deal was for could not be chosen. It searches as you type, the
 * Add job sheet's way (calendar/job-sheet.tsx): the palette's search route, contacts only, so archived and
 * merged-away people never appear (the route's own rule), the matched letters set apart. The choice travels in
 * the form as `contactId`; the server action still refuses a deal without one.
 */
const MIN_QUERY = 2;
const SEARCH_DEBOUNCE_MS = 250;

export function dealContactSearchUrl(accountId: string, term: string): string {
  return `/api/accounts/${accountId}/search?q=${encodeURIComponent(term)}&types=contacts`;
}

/** The keyboard between the box (-1) and the results: Down goes down and stops at the last, Up goes back and
 *  from the first result returns to the box. null = nothing moves. */
export function nextHitIndex(current: number, key: string, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown") return Math.min(current + 1, count - 1);
  if (key === "ArrowUp") return Math.max(current - 1, -1);
  return null;
}

/** A press with no customer chosen says why, instead of reaching the action only to fail there. */
export function dealSubmitBlock(formData: FormData): MessageKey | null {
  return String(formData.get("contactId") ?? "").trim() === "" ? "pipeline.contactRequired" : null;
}

export function DealContactHit({ hit, query, onChoose, index, onKey }: {
  hit: SearchHit; query: string; onChoose: () => void; index: number;
  onKey: (index: number, e: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <li className="border-t border-[var(--row-line)] first:border-t-0">
      <button type="button" data-deal-hit={hit.id}
        className="flex min-h-11 w-full min-w-0 flex-col items-start rounded-[var(--radius-ctl)] px-2 py-1.5 text-left outline-none hover:bg-[var(--surface-3)] focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={onChoose} onKeyDown={(e) => onKey(index, e)}>
        <span className="break-words text-sm text-card-foreground">
          <HighlightedText text={hit.label} ranges={hit.unnamed ? [] : nameRanges(hit.label, query)} />
        </span>
        {hit.sublabel ? (
          <span className="break-all text-xs text-muted-foreground">
            <HighlightedText text={hit.sublabel} ranges={phoneRanges(hit.sublabel, query)} />
          </span>
        ) : null}
      </button>
    </li>
  );
}

type Hits = { query: string; status: "ready" | "error"; contacts: SearchHit[] };

/** `locale` comes from the dialog, which reads the dashboard's LocaleProvider (S-10). A prop, not a hook here:
 *  the picker's focus test answers its hooks by position and calls it as a plain function. */
export function DealContactPicker({ accountId, labelId, locale }: { accountId: string; labelId: string; locale: Locale }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hits | null>(null);
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  // Review M3: a choice unmounts the focused result (or the focused "Choose someone else"), so focus would fall
  // to <body>. It goes to what replaces it instead, by autoFocus as that mounts; null until the first choice, so
  // the dialog's own first focus stands.
  const [focusAfter, setFocusAfter] = useState<"change" | "box" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const box = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function onQuery(q: string) {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    const mine = ++seq.current;
    const term = q.trim();
    if (term.length < MIN_QUERY) { setHits(null); return; }
    timer.current = setTimeout(() => {
      fetch(dealContactSearchUrl(accountId, term))
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          const body = (await res.json()) as Partial<SearchResults>;
          if (mine === seq.current) setHits({ query: term, status: "ready", contacts: body.contacts ?? [] });
        })
        .catch(() => { if (mine === seq.current) setHits({ query: term, status: "error", contacts: [] }); });
    }, SEARCH_DEBOUNCE_MS);
  }

  function focusAt(index: number) {
    if (index < 0) { box.current?.focus(); return; }
    list.current?.querySelectorAll<HTMLButtonElement>("button[data-deal-hit]")[index]?.focus();
  }
  function onKey(current: number, e: KeyboardEvent<HTMLElement>) {
    const next = nextHitIndex(current, e.key, hits?.contacts.length ?? 0);
    if (next === null) return;
    e.preventDefault();
    focusAt(next);
  }

  function choose(next: { id: string; name: string } | null) {
    setChosen(next);
    setFocusAfter(next ? "change" : "box");
    setQuery("");
    setHits(null);
    seq.current++;
  }

  return (
    <div className="min-w-0 space-y-2">
      <input type="hidden" name="contactId" value={chosen?.id ?? ""} />
      {chosen ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span data-deal-contact className="min-w-0 break-words text-sm text-card-foreground">{chosen.name}</span>
          <Button type="button" variant="ghost" size="sm" className="min-w-0" autoFocus={focusAfter === "change"}
            onClick={() => choose(null)}>
            <span className="min-w-0 truncate">{t(m, "pipeline.contactChange", locale)}</span>
          </Button>
        </div>
      ) : (
        <>
          <Input ref={box} aria-labelledby={labelId} type="search" value={query} placeholder={t(m, "pipeline.contactSearch", locale)}
            autoComplete="off" autoFocus={focusAfter === "box"} onChange={(e) => onQuery(e.target.value)} onKeyDown={(e) => onKey(-1, e)} />
          <div aria-live="polite" data-deal-search-results>
            {hits?.status === "error" ? <p className="text-sm text-muted-foreground">{t(m, "palette.error", locale)}</p>
              : hits && hits.contacts.length === 0 ? <p className="break-words text-sm text-muted-foreground">{t(m, "palette.empty", locale, { query: hits.query })}</p>
              : hits ? (
                <ul ref={list} className="flex max-h-60 flex-col overflow-y-auto">
                  {hits.contacts.map((h, i) => (
                    <DealContactHit key={h.id} hit={h} query={hits.query} index={i} onKey={onKey}
                      onChoose={() => choose({ id: h.id.toLowerCase(), name: h.label })} />
                  ))}
                </ul>
              ) : null}
          </div>
        </>
      )}
    </div>
  );
}
