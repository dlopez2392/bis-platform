"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import type { BookingMeetingType } from "@bis/db";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, nativeFieldClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import type { MessageKey } from "@/lib/messages";
import { makeTr } from "@/lib/record/copy";
import { cn } from "@/lib/utils";
import { parsePlaceFields, PLACE_LIMITS } from "@/lib/contacts/place-input";
import { placeTitle } from "@/lib/contacts/place-view";
import type { SearchHit, SearchResults } from "@/app/api/accounts/[accountId]/search/route";
import type { PlacesResponse } from "@/app/api/accounts/[accountId]/contacts/[contactId]/places/route";
import { HighlightedText } from "@/components/highlighted-text";
import { nameRanges, phoneRanges } from "@/lib/contacts/search-highlight";
import type { NoticeAvailability } from "./cancel-flow";
import {
  addJobAction, undoAddJobAction, moveJobAction, undoEditJobAction, undoMoveJobAction, jobNoticeOptionAction,
  type JobDraft, type JobFields, type JobWarningView,
} from "./agenda-actions";
import {
  submitJob, noticeReason, warningLines, withExistingCustomer, sheetDraft, addingAsNew, typedCustomer, phoneOwnerWords, LENGTH_OPTIONS,
  customerSearchUrl,
  type OpenedSnapshot, type PhoneOwner, type SheetCustomer, type SubmitOutcome,
} from "./job-sheet-handlers";

/**
 * F-046 part 1 (plan Task 11, spec 5.4): the Add job sheet, and Move, which is the same form. One primary, the
 * save button (Add job / Save new time, then "Add it anyway" / "Move it anyway" once the server has shown what
 * the time breaks); Cancel is ghost (DESIGN.md rule 8). The phone owner's offer swaps the save button for its own
 * two (Use Ana, the primary; Add as new, ghost). Nothing here decides a rule: the action re-checks everything,
 * and the warnings confirm in place, never in an "Are you sure?" dialog (rule 6).
 *
 * The customer search reads the palette's own GET route (request client, RLS) and its `contacts` half; the
 * address list reads the record's places route. Both only from event handlers or a keyed effect whose
 * setState runs in its async callback (react-hooks/set-state-in-effect), stale answers dropped.
 */

export type JobSheetPrefill = {
  date: string; start: string; minutes: number;
  customer?: { id: string; name: string; first: string };
  what?: string; placeId?: string | null; meetingType: BookingMeetingType; notify?: boolean;
};
export type JobSheetProps = {
  accountId: string; timezone: string; locale: "en" | "es"; mode: "add" | "move";
  /** The QA pseudo-locale (`?locale=pseudo`, lib/record/copy.ts): every word the sheet draws is padded. */
  pseudo?: boolean;
  open: boolean; onOpenChange: (open: boolean) => void;
  prefill: JobSheetPrefill;
  /** Move only: the job and what the form opened with (the in-place edit's compare-and-set, D6), with whether
   *  the customer had been told then (`moveJob`, T10 review I2). */
  job?: { id: string; opened: OpenedSnapshot };
  calendarMeetingType: BookingMeetingType; defaultMinutes: number;
};
/** The state a server answer would leave the form in: the styleguide's specimens only (job-demo.tsx). */
export type JobFormSpecimen =
  | { warnings: JobWarningView[] }
  | { phoneOwner: PhoneOwner; typed: { name: string; phone: string } };
export type JobFormProps = Omit<JobSheetProps, "open" | "onOpenChange"> & {
  /** After a save: `moved` when Move made a new row (the drawer then closes: its job is the old one). */
  onDone: (r: { moved: boolean }) => void;
  onCancel: () => void;
  /** The server answered calendar.job.changed: re-read the job (the drawer refreshes the page), so the form
   *  redraws from it (the email tick above all, T10 review I2). Never a silent save. */
  onChanged?: () => void;
  specimen?: JobFormSpecimen;
};

type Customer = SheetCustomer;
type PlaceItem = { id: string; title: string };
type Places = { contactId: string; status: "ready" | "error"; items: PlaceItem[] };
type Avail = { contactId: string; notice: NoticeAvailability | null };
type NewPlace = Record<"label" | "address" | "city" | "landmark", string>;

const EMPTY_PLACE: NewPlace = { label: "", address: "", city: "", landmark: "" };
const NEW_PLACE = "new";
const MIN_QUERY = 2;
const SEARCH_DEBOUNCE_MS = 250;
const TOUCH = "min-h-11 md:min-h-9";
const firstWord = (name: string) => name.trim().split(/\s+/)[0] ?? "";

export function JobSheet(props: JobSheetProps) {
  const { open, onOpenChange, locale, mode } = props;
  const tr = makeTr(locale, props.pseudo);
  const title = tr.text(mode === "move" ? "calendar.job.titleMove" : "calendar.job.titleAdd");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" closeLabel={tr.text("common.close")}>
        <div lang={locale} className="flex min-w-0 flex-col">
          <SheetHeader>
            <SheetTitle className="pr-8">{title}</SheetTitle>
            <SheetDescription className="sr-only">{title}</SheetDescription>
          </SheetHeader>
          {/* Mounted only while open: each opening starts from its prefill. */}
          {open ? (
            <div className="px-4 pb-6">
              <JobForm {...props} onDone={() => onOpenChange(false)} onCancel={() => onOpenChange(false)} />
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One customer the Add job search found (F-092 final review M-1: its own component so the matched letters and
 *  digits it sets apart are drawn from props in a test, since the hits themselves only ever arrive by fetch).
 *  `query` is the term these hits answered, never one typed since. */
export function JobSearchHit({ hit, query, onChoose }: { hit: SearchHit; query: string; onChoose: () => void }) {
  return (
    <li className="border-t border-[var(--row-line)] first:border-t-0">
      <button type="button" data-job-hit={hit.id}
        className="flex min-h-11 w-full min-w-0 flex-col items-start rounded-[var(--radius-ctl)] px-2 py-1.5 text-left outline-none hover:bg-[var(--surface-3)] focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={onChoose}>
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

/** The form itself: the sheet's body, and the drawer's body while it moves a job (spec 5.5). */
export function JobForm(p: JobFormProps) {
  const { accountId, timezone, locale, mode, prefill, job, specimen, pseudo = false } = p;
  const tx = makeTr(locale, pseudo).text;
  const id = useId();
  const [pending, startTransition] = useTransition();

  const [customer, setCustomer] = useState<Customer | null>(() => {
    if (specimen && "phoneOwner" in specimen) return { kind: "new", ...specimen.typed, addAsNew: false };
    return prefill.customer ? { kind: "existing", ...prefill.customer } : null;
  });
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ query: string; status: "ready" | "error"; contacts: SearchHit[] } | null>(null);
  const [date, setDate] = useState(prefill.date);
  const [start, setStart] = useState(prefill.start);
  const [minutes, setMinutes] = useState(prefill.minutes);
  const [what, setWhat] = useState(prefill.what ?? "");
  const [placeChoice, setPlaceChoice] = useState(prefill.placeId ?? "");
  const [newPlace, setNewPlace] = useState<NewPlace>(EMPTY_PLACE);
  const [meetingType, setMeetingType] = useState<BookingMeetingType>(prefill.meetingType);
  const [notify, setNotify] = useState(prefill.notify ?? mode === "add");
  // A re-read job (after calendar.job.changed) may say the customer's told state moved: the tick follows it,
  // the rest of what the person typed stays (React's "adjust state when a prop changes", during render).
  const [notifyFrom, setNotifyFrom] = useState(prefill.notify);
  if (notifyFrom !== prefill.notify) {
    setNotifyFrom(prefill.notify);
    setNotify(prefill.notify ?? mode === "add");
  }
  const [places, setPlaces] = useState<Places | null>(null);
  const [avail, setAvail] = useState<Avail | null>(null);
  const [outcome, setOutcome] = useState<Exclude<SubmitOutcome, { kind: "saved" }> | null>(() => {
    if (!specimen) return null;
    if ("phoneOwner" in specimen) return { kind: "phoneOwner", owner: specimen.phoneOwner };
    return { kind: "warnings", warnings: specimen.warnings, lines: warningLines(specimen.warnings, timezone, locale, pseudo),
      seen: specimen.warnings.map((w) => w.key), button: mode === "move" ? "calendar.job.moveAnyway" : "calendar.job.saveAnyway" };
  });
  const [seen, setSeen] = useState<string[]>(outcome?.kind === "warnings" ? outcome.seen : []);
  const [placeError, setPlaceError] = useState<string | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  // The chosen customer's addresses and whether a confirmation can reach them. Keyed by the id; answers for a
  // customer no longer chosen are dropped.
  const customerId = customer?.kind === "existing" ? customer.id : null;
  useEffect(() => {
    if (!customerId) return;
    let stale = false;
    fetch(`/api/accounts/${accountId}/contacts/${customerId}/places`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as PlacesResponse;
        const items = body.places.filter((pl) => pl.archived_at === null).map((pl) => ({ id: pl.id.toLowerCase(), title: placeTitle(pl, locale) }));
        if (!stale) setPlaces({ contactId: customerId, status: "ready", items });
      })
      .catch(() => { if (!stale) setPlaces({ contactId: customerId, status: "error", items: [] }); });
    jobNoticeOptionAction(accountId, customerId)
      .then((r) => { if (!stale) setAvail({ contactId: customerId, notice: r.ok ? r.notice : null }); })
      .catch(() => { if (!stale) setAvail({ contactId: customerId, notice: null }); });
    return () => { stale = true; };
  }, [accountId, customerId, locale]);

  // Any change to what would be saved forgets what the server said about the old values.
  const touch = () => { setOutcome(null); setSeen([]); setPlaceError(null); };

  function onQuery(q: string) {
    setQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const seq = ++searchSeq.current;
    const term = q.trim();
    if (term.length < MIN_QUERY) { setHits(null); return; }
    searchTimer.current = setTimeout(() => {
      fetch(customerSearchUrl(accountId, term))
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          const body = (await res.json()) as Partial<SearchResults>;
          if (seq === searchSeq.current) setHits({ query: term, status: "ready", contacts: body.contacts ?? [] });
        })
        .catch(() => { if (seq === searchSeq.current) setHits({ query: term, status: "error", contacts: [] }); });
    }, SEARCH_DEBOUNCE_MS);
  }

  function choose(next: Customer | null) {
    touch();
    setCustomer(next);
    setPlaceChoice("");
    setQuery("");
    setHits(null);
  }

  const first = customer ? (customer.kind === "existing" ? customer.first : firstWord(customer.name)) : "";
  const placeItems: PlaceItem[] = customerId && places?.contactId === customerId ? places.items : [];
  const placesLoading = Boolean(customerId) && places?.contactId !== customerId;
  const placesFailed = Boolean(customerId) && places?.contactId === customerId && places.status === "error";
  // The job's own saved place, archived since: kept as a choice so a Move does not drop it silently.
  const keptPlace = prefill.placeId && !placesLoading && !placeItems.some((pl) => pl.id === prefill.placeId)
    ? [{ id: prefill.placeId, title: tx("calendar.job.address") }] : [];
  const notice: NoticeAvailability | null = customer?.kind === "new" ? "no_email"
    : customerId && avail?.contactId === customerId ? avail.notice : null;
  const reason = noticeReason(notice, first, locale, pseudo);
  const notifyOff = notice !== null && notice !== "available";
  const canSave = mode === "move" || (customer !== null && (customer.kind === "existing" || customer.name.trim() !== ""));

  function fields(): JobFields {
    return {
      date, start, minutes, what, meetingType, notify: notify && !notifyOff,
      placeId: placeChoice && placeChoice !== NEW_PLACE ? placeChoice : null,
    };
  }

  // Built from the customer the sheet HOLDS, so Add as new rides every later save (T11/T12 review).
  function draft(from: Customer | null = customer): JobDraft | null {
    return sheetDraft(from, fields(), placeChoice === NEW_PLACE ? newPlace : undefined);
  }

  function run(override?: JobDraft) {
    if (placeChoice === NEW_PLACE) {
      const parsed = parsePlaceFields(newPlace, locale);
      if (!parsed.ok) { setPlaceError(tx(parsed.error.key as MessageKey, parsed.error.params)); return; }
    }
    startTransition(async () => {
      let out: SubmitOutcome;
      if (mode === "move") {
        // A Move with no job names nothing: never fall through to an add.
        if (!job) return;
        out = await submitJob({
          mode: "move", accountId, timezone, locale, pseudo, seen, toast, bookingId: job.id, draft: { ...fields(), opened: job.opened },
          move: moveJobAction, undoEdit: undoEditJobAction, undoMove: undoMoveJobAction,
        });
      } else {
        const d = override ?? draft();
        if (!d) return;
        out = await submitJob({ mode: "add", accountId, timezone, locale, pseudo, seen, toast, draft: d, add: addJobAction, undoAdd: undoAddJobAction });
      }
      if (out.kind === "saved") { p.onDone({ moved: out.moved === true }); return; }
      if (out.kind === "error" && out.changed) p.onChanged?.();
      setOutcome(out);
      setSeen(out.kind === "warnings" ? out.seen : []);
    });
  }

  function pickOwner(owner: PhoneOwner) {
    const d = draft();
    if (!d) return;
    setCustomer({ kind: "existing", id: owner.id, name: owner.name, first: owner.first });
    setOutcome(null);
    // The tick's own state, not the typed person's "no email" (R4: on by default; the server checks Ana's email).
    run(withExistingCustomer(d, owner, notify));
  }
  function addAsNew() {
    if (!customer) return;
    const next = addingAsNew(customer);
    const d = draft(next);
    if (!d) return;
    setCustomer(next);
    setOutcome(null);
    run(d);
  }

  const label = (forId: string, key: MessageKey) => <Label htmlFor={`${id}-${forId}`}>{tx(key)}</Label>;
  const saveKey: MessageKey = outcome?.kind === "warnings" ? outcome.button : mode === "move" ? "calendar.job.saveMove" : "calendar.job.save";

  return (
    <form lang={locale} data-job-form={mode} className="min-w-0 space-y-4"
      onSubmit={(e) => { e.preventDefault(); if (canSave && !pending) run(); }}>
      {/* 1. Customer (spec 5.4). On Move the customer is the job's own. */}
      <div className="space-y-1.5">
        <p id={`${id}-customer`} className="text-sm font-medium">{tx("calendar.job.customer")}</p>
        {customer?.kind === "existing" ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2" aria-labelledby={`${id}-customer`}>
            <span data-job-customer className="min-w-0 break-words text-sm text-card-foreground">{customer.name}</span>
            {mode === "add" ? (
              <Button type="button" variant="ghost" size="sm" className={cn(TOUCH, "w-full min-w-0 justify-start")}
                onClick={() => choose(null)} title={tx("calendar.job.search")} data-job-change-customer>
                <span className="min-w-0 truncate">{tx("calendar.job.search")}</span>
              </Button>
            ) : null}
          </div>
        ) : customer?.kind === "new" ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              {label("name", "calendar.job.name")}
              <Input id={`${id}-name`} value={customer.name} maxLength={200} autoComplete="off"
                onChange={(e) => { touch(); setCustomer(typedCustomer(customer, { name: e.target.value })); }} />
            </div>
            <div className="min-w-0 space-y-1">
              {label("phone", "calendar.job.phone")}
              <Input id={`${id}-phone`} type="tel" value={customer.phone} maxLength={40} autoComplete="off"
                onChange={(e) => { touch(); setCustomer(typedCustomer(customer, { phone: e.target.value })); }} />
            </div>
            <div className="sm:col-span-2">
              <Button type="button" variant="ghost" size="sm" className={cn(TOUCH, "w-full min-w-0 justify-start")}
                onClick={() => choose(null)} title={tx("calendar.job.search")} data-job-change-customer>
                <span className="min-w-0 truncate">{tx("calendar.job.search")}</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Input aria-labelledby={`${id}-customer`} type="search" value={query} placeholder={tx("calendar.job.search")}
              autoComplete="off" onChange={(e) => onQuery(e.target.value)} />
            <div aria-live="polite" data-job-search-results>
              {hits?.status === "error" ? <p className="text-sm text-muted-foreground">{tx("palette.error")}</p>
                : hits && hits.contacts.length === 0 ? <p className="text-sm text-muted-foreground">{tx("palette.empty", { query: hits.query })}</p>
                : hits ? (
                  <ul className="flex flex-col">
                    {hits.contacts.map((h) => (
                      <JobSearchHit key={h.id} hit={h} query={hits.query}
                        onChoose={() => choose({ kind: "existing", id: h.id.toLowerCase(), name: h.label, first: firstWord(h.label) })} />
                    ))}
                  </ul>
                ) : null}
            </div>
            <Button type="button" variant="ghost" size="sm" className={TOUCH}
              onClick={() => choose({ kind: "new", name: query.trim(), phone: "", addAsNew: false })}>
              {tx("calendar.job.newCustomer")}
            </Button>
          </div>
        )}
      </div>

      {/* 2. Date and start, five-minute steps. 3. How long. */}
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="min-w-0 space-y-1">
          {label("date", "calendar.job.date")}
          <Input id={`${id}-date`} type="date" required value={date} onChange={(e) => { touch(); setDate(e.target.value); }} />
        </div>
        <div className="min-w-0 space-y-1">
          {label("start", "calendar.job.start")}
          <Input id={`${id}-start`} type="time" required step={300} value={start} onChange={(e) => { touch(); setStart(e.target.value); }} />
        </div>
        <div className="min-w-0 space-y-1">
          {label("length", "calendar.job.length")}
          <select id={`${id}-length`} value={minutes} onChange={(e) => { touch(); setMinutes(Number(e.target.value)); }}
            className={cn(nativeFieldClass, "h-9 py-1 tabular-nums")}>
            {LENGTH_OPTIONS.map((n) => <option key={n} value={n}>{tx("calendar.job.minutes", { minutes: n })}</option>)}
          </select>
        </div>
      </div>

      {/* 4. What's the job? One line, 200 characters (D1). */}
      <div className="space-y-1">
        {label("what", "calendar.job.what")}
        <Input id={`${id}-what`} value={what} maxLength={200} placeholder={tx("calendar.job.whatHint")}
          onChange={(e) => { touch(); setWhat(e.target.value); }} />
      </div>

      {/* 5. Address: No address, the customer's (and their households') active places, New address. */}
      <div className="space-y-1">
        {label("place", "calendar.job.address")}
        <select id={`${id}-place`} value={placeChoice} aria-busy={placesLoading || undefined}
          onChange={(e) => { touch(); setPlaceChoice(e.target.value); }} className={cn(nativeFieldClass, "h-9 py-1")}>
          <option value="">{tx("calendar.job.noAddress")}</option>
          {[...keptPlace, ...placeItems].map((pl) => <option key={pl.id} value={pl.id}>{pl.title}</option>)}
          {/* Move offers saved addresses only (T11/T12 review): the move keeps no typed address. */}
          {mode === "add" ? <option value={NEW_PLACE}>{tx("calendar.job.newAddress")}</option> : null}
        </select>
        {placesLoading ? <Skeleton data-job-places-skeleton className="h-4 w-1/2" /> : null}
        {placesFailed ? <p className="text-xs text-muted-foreground">{tx("record.card.failed", { title: tx("calendar.job.address") })}</p> : null}
        {mode === "add" && placeChoice === NEW_PLACE ? (
          <div data-job-new-place className="grid gap-2 border-l-2 border-[var(--line)] pl-3 sm:grid-cols-2">
            {(["label", "address", "city", "landmark"] as const).map((k) => (
              <div key={k} className="min-w-0 space-y-1">
                <Label htmlFor={`${id}-place-${k}`}>{tx(`places.${k}`)}</Label>
                <Input id={`${id}-place-${k}`} value={newPlace[k]} maxLength={PLACE_LIMITS[k]} autoComplete="off"
                  onChange={(e) => { touch(); setNewPlace((pl) => ({ ...pl, [k]: e.target.value })); }} />
              </div>
            ))}
            <div aria-live="polite" className="sm:col-span-2">
              {placeError ? <p className="text-sm text-destructive">{placeError}</p> : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* 6. How you'll meet, defaulting to the calendar's type. */}
      <div className="space-y-1">
        {label("meet", "calendar.job.meet")}
        <select id={`${id}-meet`} value={meetingType} onChange={(e) => { touch(); setMeetingType(e.target.value as BookingMeetingType); }}
          className={cn(nativeFieldClass, "h-9 py-1")}>
          <option value="in_person">{tx("calendar.job.inPerson")}</option>
          <option value="phone">{tx("calendar.job.byPhone")}</option>
          <option value="video">{tx("calendar.job.byVideo")}</option>
        </select>
      </div>

      {/* 7. The confirmation (or, on Move, the new time), off with its reason when no email can go. */}
      <div className="space-y-1">
        <div className="flex items-start gap-2">
          <Checkbox id={`${id}-notify`} className="mt-0.5" checked={notify && !notifyOff} disabled={notifyOff}
            aria-describedby={reason ? `${id}-notify-why` : undefined}
            onCheckedChange={(v) => { touch(); setNotify(v === true); }} />
          <Label htmlFor={`${id}-notify`} className="min-w-0 break-words leading-snug">
            {tx(mode === "move" ? "calendar.job.sendMoved" : "calendar.job.sendConfirmation", { first: first || tx("calendar.job.customerFallback") })}
          </Label>
        </div>
        {reason ? <p id={`${id}-notify-why`} className="pl-6 text-xs text-muted-foreground">{reason}</p> : null}
      </div>

      {/* What the server found that the person has not seen: confirmed in place, above the button (R3). */}
      {outcome?.kind === "warnings" ? (
        <Notice tone="warn" data-job-warnings className="space-y-1.5 p-3 text-foreground">
          <p className="text-sm font-medium">{tx("calendar.job.checkFirst")}</p>
          <ul className="space-y-1">
            {outcome.lines.map((line, i) => (
              <li key={outcome.warnings[i]?.key ?? i} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 size-[7px] shrink-0 rounded-full bg-[var(--warn)]" aria-hidden />
                <span className="min-w-0 break-words">{line}</span>
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {outcome?.kind === "error" ? <p role="alert" data-job-error className="text-sm text-destructive">{outcome.message}</p> : null}

      {outcome?.kind === "phoneOwner" ? (
        <div data-job-phone-owner className="space-y-2">
          <p className="break-words text-sm">{phoneOwnerWords(outcome.owner, locale, pseudo).question}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" className={TOUCH} onClick={p.onCancel}>{tx("common.cancel")}</Button>
            <Button type="button" variant="ghost" className={TOUCH} disabled={pending} onClick={addAsNew}>{tx("calendar.job.addAsNew")}</Button>
            <Button type="button" className={TOUCH} disabled={pending} onClick={() => pickOwner(outcome.owner)}>
              {phoneOwnerWords(outcome.owner, locale, pseudo).button}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" className={TOUCH} onClick={p.onCancel}>{tx("common.cancel")}</Button>
          <Button type="submit" className={cn(TOUCH, "h-auto whitespace-normal")} disabled={!canSave || pending}>{tx(saveKey)}</Button>
        </div>
      )}
    </form>
  );
}
