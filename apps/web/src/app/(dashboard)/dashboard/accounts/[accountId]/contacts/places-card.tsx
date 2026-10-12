"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineField } from "@/components/inline-field";
import { useLocale } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { formatDateUTC } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EquipmentRow, PlaceRow } from "@bis/db";
import { placesLoadFrom, type PlacesLoad } from "@/lib/contacts/places-load";
import { placeRule, equipmentRule, ownerValue, type PlaceTextField, type EquipmentTextField } from "@/lib/contacts/place-input";
import {
  placeTitle, cityLine, mapUrl, warrantyStatus, equipmentByPlace, placesInOrder, ownerOptions, sharedWith, type UnitView,
} from "@/lib/contacts/place-view";
import { updatePlaceFieldAction, setPlaceOwnerAction, updateEquipmentFieldAction } from "./places-actions";
import { placeHandlers, type PlaceHandlers } from "./places-card-handlers";
import { PlaceDialog } from "./place-dialog";
import { EquipmentDialog } from "./equipment-dialog";

export type { PlaceHandlers } from "./places-card-handlers";
export { placeHandlers } from "./places-card-handlers";

type Data = Extract<PlacesLoad, { status: "ready" }>["data"];
type Ctx = {
  accountId: string; contactId: string; canMovePlace: boolean; locale: Locale; data: Data;
  subject: { id: string; name: string }; handlers: PlaceHandlers;
  tt: (key: string, params?: Record<string, string | number>) => string;
};
type Save = (value: string) => Promise<{ ok: true } | { ok: false; error: string }>;

const focusRing = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const rowClass = "border-t border-[var(--row-line)] first:border-t-0";
const disclosureClass = cn("rounded-[var(--radius-ctl)] text-left text-xs text-muted-foreground underline-offset-4 hover:underline", focusRing);
const failed = { ok: false as const, error: "places.error.failed" };

/** The route sends rows without their author (C8); the view helpers take whole rows. */
const asPlace = (p: Data["places"][number]): PlaceRow => ({ ...p, created_by: null });
const asUnit = (u: Data["equipment"][number]): EquipmentRow => ({ ...u, created_by: null });

/** One label and its value, in the card's two-column list. Long labels wrap, never clip. */
function Line({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="break-words pt-1 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * A save through an action that answers a messages.ts key; the card re-reads after it, unless the
 * field announces its own save (the owner change, whose handler re-reads), so the card reads once.
 */
function saver(
  ctx: Ctx, run: (value: string) => Promise<{ ok: true } | { ok: false; error: string; params?: Record<string, string | number> }>,
  reread = true,
): Save {
  return async (value) => {
    const r = await run(value).catch(() => failed);
    if (!r.ok) return { ok: false, error: ctx.tt(r.error, "params" in r ? r.params : undefined) };
    if (reread) ctx.handlers.changed();
    return { ok: true };
  };
}

/** Who an owner value names, in the words the owner-change toast uses: the person's name or the group's. */
function ownerName(ctx: Ctx, value: string): string {
  const group = value.startsWith("group:") ? ctx.data.groups.find((g) => `group:${g.id}` === value) : undefined;
  return group ? group.name : ctx.subject.name;
}

function PlaceField({ ctx, place, field, labelKey, hintKey, multiline }: {
  ctx: Ctx; place: PlaceRow; field: PlaceTextField; labelKey: string; hintKey?: string; multiline?: boolean;
}) {
  const value = place[field];
  return (
    <Line label={ctx.tt(labelKey)}>
      <InlineField key={`${field}:${value ?? ""}`} rule={placeRule(field)} label={ctx.tt(labelKey)} value={value}
        inputType={multiline ? "multiline" : "text"} locale={ctx.locale} placeholder={hintKey ? ctx.tt(hintKey) : undefined}
        save={saver(ctx, (v) => updatePlaceFieldAction(ctx.accountId, ctx.contactId, place.id, field, v))} />
    </Line>
  );
}

function UnitField({ ctx, unit, field, labelKey, kind }: {
  ctx: Ctx; unit: EquipmentRow; field: EquipmentTextField | "installed_on" | "warranty_until"; labelKey: string; kind?: "date" | "multiline";
}) {
  const value = unit[field];
  return (
    <Line label={ctx.tt(labelKey)}>
      <InlineField key={`${field}:${value ?? ""}`} rule={equipmentRule(field, ctx.data.today, unit)} label={ctx.tt(labelKey)} value={value}
        inputType={kind ?? "text"} display={kind === "date" ? "date" : undefined} locale={ctx.locale}
        save={saver(ctx, (v) => updateEquipmentFieldAction(ctx.accountId, ctx.contactId, unit.id, field, v))} />
    </Line>
  );
}

/** Rule 3: warranty is a dot plus a word, against the account's own today. Filled for under, a hollow ring for ended. */
function Warranty({ ctx, unit }: { ctx: Ctx; unit: EquipmentRow }) {
  const status = warrantyStatus(unit.warranty_until, ctx.data.today);
  if (!status) return null;
  const date = formatDateUTC(status.until, ctx.locale);
  const under = status.kind === "under";
  return (
    <p className="text-xs">
      <span data-mark="warranty" className={cn("inline-flex items-center gap-1.5", !under && "text-muted-foreground")}>
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", under ? "bg-[var(--good)]" : "border border-[var(--line-strong)]")} />
        {ctx.tt(under ? "equipment.underWarranty" : "equipment.warrantyEnded", { date })}
      </span>
    </p>
  );
}

function makeModel(u: Pick<EquipmentRow, "make" | "model">): string {
  return [u.make, u.model].filter(Boolean).join(" ");
}

function UnitRow({ ctx, view }: { ctx: Ctx; view: UnitView }) {
  const { unit, history } = view;
  const [open, setOpen] = useState(false);
  const historyId = useId();
  return (
    <li className={cn(rowClass, "space-y-1 py-2")} data-unit-row={unit.id}>
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1 font-medium">
          <InlineField key={`name:${unit.name}`} rule={equipmentRule("name", ctx.data.today, unit)} label={ctx.tt("equipment.name")}
            value={unit.name} locale={ctx.locale}
            save={saver(ctx, (v) => updateEquipmentFieldAction(ctx.accountId, ctx.contactId, unit.id, "name", v))} />
        </div>
        <EquipmentDialog accountId={ctx.accountId} contactId={ctx.contactId} today={ctx.data.today}
          mode={{ kind: "replace", unit: { id: unit.id, name: unit.name } }} onDone={(id) => ctx.handlers.unitReplaced(id)} />
        {/* C6: only a unit nothing replaced can go, and every current unit is one. */}
        <Button type="button" size="icon-xs" variant="ghost" aria-label={ctx.tt("equipment.removeAria", { name: unit.name })}
          onClick={() => void ctx.handlers.removeUnit(unit.id, unit.name)}>
          <X className="size-3.5" aria-hidden />
        </Button>
      </div>
      <Warranty ctx={ctx} unit={unit} />
      <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-2 gap-y-0.5">
        <UnitField ctx={ctx} unit={unit} field="make" labelKey="equipment.make" />
        <UnitField ctx={ctx} unit={unit} field="model" labelKey="equipment.model" />
        <UnitField ctx={ctx} unit={unit} field="serial" labelKey="equipment.serial" />
        <UnitField ctx={ctx} unit={unit} field="installed_on" labelKey="equipment.installDate" kind="date" />
        <UnitField ctx={ctx} unit={unit} field="warranty_until" labelKey="equipment.warrantyUntil" kind="date" />
        <UnitField ctx={ctx} unit={unit} field="notes" labelKey="equipment.notes" kind="multiline" />
      </dl>
      {history.length > 0 ? (
        <div className="space-y-1">
          <button type="button" aria-expanded={open} aria-controls={historyId} onClick={() => setOpen((v) => !v)} className={disclosureClass}>
            {ctx.tt("equipment.history", { count: history.length })}
          </button>
          {/* Read only: a replaced unit has no Remove (C6, the database refuses it). */}
          <ul id={historyId} hidden={!open} data-equipment-history className="space-y-1 text-xs text-muted-foreground">
            {history.map((h) => (
              <li key={h.unit.id} className="break-words">
                {[
                  h.unit.name, makeModel(h.unit),
                  h.unit.installed_on ? ctx.tt("equipment.installedOn", { date: formatDateUTC(h.unit.installed_on, ctx.locale) }) : "",
                  ctx.tt("equipment.replacedOn", { date: formatDateUTC(h.replacedOn, ctx.locale) }),
                ]
                  .filter(Boolean).join(" · ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

function PlaceItem({ ctx, place, units }: { ctx: Ctx; place: PlaceRow; units: UnitView[] }) {
  const [more, setMore] = useState(false);
  const moreId = useId();
  const title = placeTitle(place, ctx.locale);
  const group = sharedWith(place, ctx.data.groups);
  const map = mapUrl(place);
  const city = cityLine(place);
  const countries = [
    { value: "", label: ctx.tt("places.country.none") },
    { value: "US", label: ctx.tt("places.country.US") },
    { value: "MX", label: ctx.tt("places.country.MX") },
  ];
  return (
    <li className={cn(rowClass, "space-y-1.5 py-2.5 first:pt-0")} data-place-row={place.id}>
      <div className="flex items-start gap-2">
        <h4 className="min-w-0 flex-1 truncate pt-0.5 text-sm font-medium" title={title}>{title}</h4>
        <Button type="button" size="icon-xs" variant="ghost" aria-label={ctx.tt("places.removeAria", { name: title })}
          onClick={() => void ctx.handlers.removePlace(place.id, title)}>
          <X className="size-3.5" aria-hidden />
        </Button>
      </div>
      {group ? <p className="text-xs text-muted-foreground">{ctx.tt("places.sharedWith", { group: group.name })}</p> : null}
      <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-2 gap-y-0.5">
        <PlaceField ctx={ctx} place={place} field="label" labelKey="places.label" hintKey="places.labelHint" />
        <PlaceField ctx={ctx} place={place} field="address" labelKey="places.address" />
        <Line label={
          <button type="button" aria-expanded={more} aria-controls={moreId} onClick={() => setMore((v) => !v)} className={disclosureClass}>
            {ctx.tt("places.moreAddress")}
          </button>
        }>
          {city ? <p className="px-2 py-1 text-sm">{city}</p> : null}
        </Line>
      </dl>
      <dl id={moreId} hidden={!more} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-2 gap-y-0.5">
        <PlaceField ctx={ctx} place={place} field="city" labelKey="places.city" />
        <PlaceField ctx={ctx} place={place} field="region" labelKey="places.region" />
        <PlaceField ctx={ctx} place={place} field="postal_code" labelKey="places.postalCode" />
        <Line label={ctx.tt("places.country")}>
          <InlineField key={`country:${place.country ?? ""}`} options={countries} label={ctx.tt("places.country")} value={place.country ?? ""}
            locale={ctx.locale} save={saver(ctx, (v) => updatePlaceFieldAction(ctx.accountId, ctx.contactId, place.id, "country", v))} />
        </Line>
      </dl>
      <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-2 gap-y-0.5">
        <PlaceField ctx={ctx} place={place} field="landmark" labelKey="places.landmark" hintKey="places.landmarkHint" />
        <PlaceField ctx={ctx} place={place} field="directions" labelKey="places.directions" hintKey="places.directionsHint" multiline />
        {/* Owner and Staff only (spec §4, §5.3): a Technician never sees the control. */}
        {ctx.canMovePlace ? (
          <Line label={ctx.tt("places.belongsTo")}>
            <InlineField key={`owner:${ownerValue(place)}`} options={ownerOptions(ctx.subject, ctx.data.groups, ctx.locale)}
              label={ctx.tt("places.belongsTo")} value={ownerValue(place)} locale={ctx.locale}
              save={saver(ctx, (v) => setPlaceOwnerAction(ctx.accountId, ctx.contactId, place.id, v), false)}
              // Spec §7: "{place} now belongs to {owner}." with its own Undo, not the field's generic "saved".
              onSaved={(prior, stored) => ctx.handlers.ownerChanged(place.id, title, ownerName(ctx, stored), prior)} />
          </Line>
        ) : null}
      </dl>
      {map ? (
        <a data-place-map href={map} target="_blank" rel="noopener noreferrer"
          className={cn("inline-block rounded-[var(--radius-ctl)] px-2 text-sm text-[var(--accent)] underline-offset-4 hover:underline", focusRing)}>
          {ctx.tt("places.openMap")}
        </a>
      ) : null}
      <div data-place-equipment className="space-y-1 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {ctx.tt("equipment.title", { count: units.length })}
          </p>
          <EquipmentDialog accountId={ctx.accountId} contactId={ctx.contactId} today={ctx.data.today}
            mode={{ kind: "add", placeId: place.id }} onDone={(id, name) => ctx.handlers.unitAdded(id, name)} />
        </div>
        {units.length === 0 ? (
          <p className="text-sm text-muted-foreground">{ctx.tt("equipment.empty")}</p>
        ) : (
          <ul className="text-sm">{units.map((v) => <UnitRow key={v.unit.id} ctx={ctx} view={v} />)}</ul>
        )}
      </div>
    </li>
  );
}

function RemovedList({ ctx, places }: { ctx: Ctx; places: PlaceRow[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="space-y-1 border-t border-[var(--row-line)] pt-2">
      <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)} className={disclosureClass}>
        {ctx.tt("places.removedList", { count: places.length })}
      </button>
      <ul id={listId} hidden={!open} data-places-removed className="text-sm">
        {places.map((p) => {
          const title = placeTitle(p, ctx.locale);
          return (
            <li key={p.id} className={cn(rowClass, "flex items-center gap-2 py-1.5")}>
              <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
              <Button type="button" size="xs" variant="ghost" onClick={() => void ctx.handlers.putBack(p.id, title)}>
                {ctx.tt("places.putBack")}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Pure: everything the card shows, for every state. Tests and the styleguide render this. */
export function PlacesCardView({ accountId, contactId, canMovePlace, headingHidden, load, onRetry, handlers }: {
  accountId: string; contactId: string; canMovePlace: boolean; load: PlacesLoad; onRetry: () => void; handlers: PlaceHandlers;
  /** S-03 §8: inside a RecordCard, whose title is the one seen; the h3 still labels the section. */
  headingHidden?: boolean;
}) {
  const locale = useLocale();
  const titleId = useId(); // the styleguide shows several cards on one page
  const tt = (key: string, params?: Record<string, string | number>) => t(m, key as MessageKey, locale, params);
  const ready = load.status === "ready" ? load.data : null;
  const subject = ready
    ? { id: ready.subject.id, name: [ready.subject.firstName, ready.subject.lastName].filter(Boolean).join(" ") || tt("places.thisCustomer") }
    : null;
  const heading = <h3 id={titleId} className={headingHidden ? "sr-only" : "text-[13.5px] font-semibold text-card-foreground"}>{tt("places.title")}</h3>;
  const add = ready && subject ? (
    <PlaceDialog accountId={accountId} contactId={contactId} subject={subject} groups={ready.groups}
      canMovePlace={canMovePlace} onAdded={(id, title) => handlers.placeAdded(id, title)} />
  ) : null;
  return (
    <section data-places-card lang={locale} aria-labelledby={titleId} className="space-y-2">
      {/* S-03 §8: inside a RecordCard its title is the one seen, so the h3 is sr-only (still the section's label),
         there is no empty row under that title, and Add keeps to the right. The drawer sets nothing: unchanged. */}
      {headingHidden && !add ? heading : (
        <div className={headingHidden ? "flex flex-wrap items-center justify-end gap-2" : "flex flex-wrap items-center justify-between gap-2"}>
          {heading}
          {add}
        </div>
      )}
      {load.status === "loading" ? (
        <div>
          {[0, 1].map((i) => (
            <div key={i} data-places-skeleton className={cn(rowClass, "space-y-1.5 py-2.5 first:pt-0")}>
              <Skeleton className="h-4 w-1/3 rounded-[var(--radius-ctl)]" />
              <Skeleton className="h-3 w-2/3 rounded-[var(--radius-ctl)]" />
              <Skeleton className="h-3 w-1/2 rounded-[var(--radius-ctl)]" />
              <Skeleton className="h-8 w-full rounded-[var(--radius-ctl)]" />
            </div>
          ))}
        </div>
      ) : load.status === "error" || !ready || !subject ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">{tt("places.loadFailed")}</p>
          <Button type="button" size="sm" variant="ghost" onClick={onRetry}>{tt("places.retry")}</Button>
        </div>
      ) : (
        <ReadyBody ctx={{ accountId, contactId, canMovePlace, locale, data: ready, subject, handlers, tt }} />
      )}
    </section>
  );
}

function ReadyBody({ ctx }: { ctx: Ctx }) {
  const { active, removed } = placesInOrder(ctx.data.places.map(asPlace), ctx.subject.id, ctx.data.groups);
  const units = equipmentByPlace(ctx.data.equipment.map(asUnit));
  return (
    <>
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">{ctx.tt("places.empty")}</p>
      ) : (
        <ul>{active.map((p) => <PlaceItem key={p.id} ctx={ctx} place={p} units={units.get(p.id) ?? []} />)}</ul>
      )}
      {removed.length > 0 ? <RemovedList ctx={ctx} places={removed} /> : null}
    </>
  );
}

/** The card on the drawer and the contact page (spec §8): reads its own route, saves at once, Undo on every change (rule 6). */
export function PlacesCard({ accountId, contactId, canMovePlace, headingHidden }: { accountId: string; contactId: string; canMovePlace: boolean; headingHidden?: boolean }) {
  const locale = useLocale();
  // Paired with the id it was read for (the drawer's own pattern): a newly peeked contact reads
  // "loading" by mismatch, and only the fetch's own callbacks write state.
  const [state, setState] = useState<{ contactId: string; load: PlacesLoad }>({ contactId: "", load: { status: "loading" } });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let stale = false;
    // A re-read after a change that fails keeps what the card already shows; only a first read
    // (or a Retry, which goes back to the skeleton first) shows the error state.
    const settle = (load: PlacesLoad) => {
      if (stale) return;
      setState((s) => (load.status === "error" && s.contactId === contactId && s.load.status === "ready" ? s : { contactId, load }));
    };
    fetch(`/api/accounts/${accountId}/contacts/${contactId}/places`)
      .then(placesLoadFrom)
      .then(settle, () => settle({ status: "error" }));
    return () => { stale = true; };
  }, [accountId, contactId, nonce]);
  const load: PlacesLoad = state.contactId === contactId ? state.load : { status: "loading" };

  // One Set for the card's whole life: the in-flight lock must outlast a re-render.
  const [inFlight] = useState(() => new Set<string>());
  const handlers = placeHandlers({ accountId, contactId, locale, reload: () => setNonce((n) => n + 1), inFlight });

  return (
    <PlacesCardView
      accountId={accountId}
      contactId={contactId}
      canMovePlace={canMovePlace}
      headingHidden={headingHidden}
      load={load}
      onRetry={() => { setState({ contactId: "", load: { status: "loading" } }); setNonce((n) => n + 1); }}
      handlers={handlers}
    />
  );
}
