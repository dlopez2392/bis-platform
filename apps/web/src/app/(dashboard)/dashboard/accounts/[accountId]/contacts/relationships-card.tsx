"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DotPill } from "@/components/dot-pill";
import { nativeFieldClass } from "@/components/ui/input";
import { useLocale } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { cn } from "@/lib/utils";
import type { WordForm } from "@bis/db/relationship-keys";
import { chipText, chipFormControl, personName } from "@/lib/contacts/relationship-labels";
import type { RelationshipView } from "@/lib/contacts/relationship-view";
import type { Flag } from "@/lib/contacts/relationship-dialog";
import { relationshipsLoadFrom, type RelationshipsLoad } from "@/lib/contacts/relationships-load";
import { relationshipHandlers, type CardState } from "./relationships-card-handlers";
import { AddRelationshipDialog } from "./add-relationship-dialog";

export type CardViewProps = {
  accountId: string;
  load: RelationshipsLoad;
  onRetry: () => void;
  onToggle: (view: RelationshipView, flag: Flag) => void;
  onForm: (view: RelationshipView, who: "named" | "subject", form: WordForm | null) => void;
  onRemove: (view: RelationshipView) => void;
  addSlot: ReactNode;
  /** S-03 §8: inside a RecordCard, whose title is the one seen; the h3 still labels the section. */
  headingHidden?: boolean;
};

const FLAGS = [["canPickUp", "relationships.flag.canPickUp"], ["isEmergency", "relationships.flag.isEmergency"]] as const;
const focusRing = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * A flag as dot plus word (rule 3), the app's one DotPill: a toggle when it can change (the pill
 * inside a button carrying aria-pressed), a plain word when it cannot. On is a filled dot, off a
 * hollow ring with muted ink, so the two differ in shape, not colour alone.
 */
function FlagPill({ on, label, onClick }: { on: boolean; label: string; onClick?: () => void }) {
  const dot = on ? "bg-[var(--accent)]" : "border border-[var(--line-strong)] bg-transparent";
  const chip = cn(!on && "text-muted-foreground", onClick && "transition-colors duration-150 group-hover:bg-[var(--surface-3)]");
  const pill = <DotPill dense label={label} dot={dot} chip={chip} />;
  if (!onClick) return pill;
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("group rounded-full", focusRing)}>
      {pill}
    </button>
  );
}

function Chip({ accountId, view, locale, onToggle, onForm, onRemove }: {
  accountId: string; view: RelationshipView; locale: Locale;
  onToggle: CardViewProps["onToggle"]; onForm: CardViewProps["onForm"]; onRemove: CardViewProps["onRemove"];
}) {
  const names = { hidden: t(m, "relationships.hiddenPerson", locale), noName: t(m, "relationships.noName", locale) };
  const text = chipText(view, locale, names);
  // C5: a person the reader cannot see has no name, no link and no controls, only the line
  // saying who can change it. The actions refuse such a write anyway (relationship-actions.ts).
  if (!view.person) {
    return (
      <li data-relationship-chip className="rounded-[var(--radius-ctl)] bg-[var(--surface-2)] px-3 py-2 text-sm">
        <p className="[overflow-wrap:anywhere]">{text}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {FLAGS.filter(([f]) => view[f]).map(([f, key]) => <FlagPill key={f} on label={t(m, key, locale)} />)}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t(m, "relationships.askTeam", locale)}</p>
      </li>
    );
  }
  const name = personName(view.person, names.noName);
  const control = chipFormControl(view, locale);
  return (
    <li data-relationship-chip className="rounded-[var(--radius-ctl)] bg-[var(--surface-2)] px-3 py-2 text-sm">
      {/* The name wants 8rem: on a narrow card the picker and remove wrap under it and the name
          keeps the whole first line, wrapping rather than truncating (design check 1a: one letter at 320px). */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link href={`/dashboard/accounts/${accountId}/contacts/${view.person.id}`}
          className={cn("min-w-0 basis-32 grow rounded-[var(--radius-ctl)] [overflow-wrap:anywhere] underline-offset-4 hover:underline", focusRing)}>
          {text}
        </Link>
        {control ? (
          <select aria-label={t(m, "relationships.wordFor", locale, { name })}
            value={control.value ?? ""}
            onChange={(e) => onForm(view, control.who, e.target.value === "" ? null : (e.target.value as WordForm))}
            className={cn(nativeFieldClass, "h-7 w-auto shrink-0 px-1.5 py-0 text-xs")}>
            <option value="">{control.choices.n}</option>
            <option value="f">{control.choices.f}</option>
            <option value="m">{control.choices.m}</option>
          </select>
        ) : null}
        <Button type="button" size="icon-xs" variant="ghost" aria-label={t(m, "relationships.remove", locale, { name })} onClick={() => onRemove(view)}>
          <X className="size-3.5" aria-hidden />
        </Button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {FLAGS.map(([f, key]) => view.lockedFlag === f
          ? <FlagPill key={f} on label={t(m, key, locale)} />
          : <FlagPill key={f} on={view[f]} label={t(m, key, locale)} onClick={() => onToggle(view, f)} />)}
      </div>
    </li>
  );
}

/** Pure: everything the card shows, for every state. Tests render this. */
export function RelationshipsCardView({ accountId, load, onRetry, onToggle, onForm, onRemove, addSlot, headingHidden }: CardViewProps) {
  const locale = useLocale();
  const titleId = useId(); // the styleguide shows several cards on one page
  const heading = <h3 id={titleId} className={headingHidden ? "sr-only" : "text-sm font-medium"}>{t(m, "relationships.title", locale)}</h3>;
  const add = load.status === "ready" ? addSlot : null;
  return (
    <section data-relationships-card lang={locale} aria-labelledby={titleId} className="space-y-2">
      {/* S-03 §8: inside a RecordCard its title is the one seen, so the h3 is sr-only (still the section's label),
         there is no empty row under that title, and Add keeps to the right. The drawer sets nothing: unchanged. */}
      {headingHidden && !add ? heading : (
        <div className={headingHidden ? "flex items-center justify-end gap-2" : "flex items-center justify-between gap-2"}>
          {heading}
          {add}
        </div>
      )}
      {load.status === "loading" ? (
        <div className="space-y-2">
          <Skeleton data-relationships-skeleton className="h-14 w-full rounded-[var(--radius-ctl)]" />
          <Skeleton data-relationships-skeleton className="h-14 w-full rounded-[var(--radius-ctl)]" />
        </div>
      ) : load.status === "error" ? (
        // Announced, plain words and a ghost Try again: RecordCardError's look (design check 1a).
        <div role="alert" className="space-y-2 text-sm">
          <p className="text-muted-foreground">{t(m, "relationships.loadFailed", locale)}</p>
          <Button type="button" size="sm" variant="ghost" className="min-h-11 md:min-h-8" onClick={onRetry}>{t(m, "relationships.retry", locale)}</Button>
        </div>
      ) : load.views.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(m, "relationships.empty", locale)}</p>
      ) : (
        <ul className="space-y-2">
          {load.views.map((v) => (
            <Chip key={v.id} accountId={accountId} view={v} locale={locale} onToggle={onToggle} onForm={onForm} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The card on the drawer and the detail page (spec §7, R2): reads its own route, saves at once, Undo on every change (rule 6). */
export function RelationshipsCard({ accountId, contactId, headingHidden }: { accountId: string; contactId: string; headingHidden?: boolean }) {
  const locale = useLocale();
  // Paired with the id it was read for (the drawer's own pattern): a newly peeked contact reads
  // "loading" by mismatch, and only the fetch's own callbacks write state.
  const [state, setState] = useState<CardState>({ contactId: "", rel: { status: "loading" } });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let stale = false;
    fetch(`/api/accounts/${accountId}/contacts/${contactId}/relationships`)
      .then(async (res) => { const rel = await relationshipsLoadFrom(res); if (!stale) setState({ contactId, rel }); })
      .catch(() => { if (!stale) setState({ contactId, rel: { status: "error" } }); });
    return () => { stale = true; };
  }, [accountId, contactId, nonce]);
  const load: RelationshipsLoad = state.contactId === contactId ? state.rel : { status: "loading" };

  // One Set for the card's whole life: the in-flight lock must outlast a re-render (item 9).
  const [inFlight] = useState(() => new Set<string>());
  const { replace, change, remove } = relationshipHandlers({ accountId, contactId, locale, setState, inFlight });

  return (
    <RelationshipsCardView
      accountId={accountId}
      headingHidden={headingHidden}
      load={load}
      // Back to the skeleton at once, then refire the read (the drawer's own Retry does the same).
      onRetry={() => { setState({ contactId: "", rel: { status: "loading" } }); setNonce((n) => n + 1); }}
      onToggle={(v, flag) => void change(v, { [flag]: !v[flag] })}
      onForm={(v, who, form) => void change(v, who === "named" ? { namedForm: form } : { subjectForm: form })}
      onRemove={(v) => void remove(v)}
      addSlot={load.status === "ready"
        ? <AddRelationshipDialog accountId={accountId} contactId={contactId} subject={load.subject} views={load.views} onAdded={replace} />
        : null}
    />
  );
}
