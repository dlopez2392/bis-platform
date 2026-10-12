"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, nativeFieldClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/components/locale-provider";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
import type { ContactPlaceGroup } from "@bis/db";
import { parsePlaceFields, PLACE_LIMITS } from "@/lib/contacts/place-input";
import { ownerOptions, placeTitle } from "@/lib/contacts/place-view";
import { addPlaceAction } from "./places-actions";

const hintClass = "text-xs text-muted-foreground";
const focusRing = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const EMPTY = { label: "", address: "", city: "", region: "", postal_code: "", country: "", landmark: "", directions: "" };
type Draft = typeof EMPTY;

/**
 * Add a property (spec §8): name, address, "City, state and ZIP" (collapsed), landmark, how to get
 * there (with its hint), and "Belongs to" for Owner and Staff (the person by default, their groups
 * listed). One primary "Add" (rule 8); Radix closes on Esc and returns focus to the trigger. The
 * input is checked by place-input.ts before the action, which checks it again; either refusal is
 * read out in a POLITE live region inside the dialog, never role="alert".
 */
export function PlaceDialog({ accountId, contactId, subject, groups, canMovePlace, onAdded }: {
  accountId: string; contactId: string; subject: { id: string; name: string };
  groups: readonly ContactPlaceGroup[]; canMovePlace: boolean;
  onAdded: (id: string, title: string) => void;
}) {
  const locale = useLocale();
  const tt = (key: string, params?: Record<string, string | number>) => t(m, key as MessageKey, locale, params);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [owner, setOwner] = useState(`contact:${subject.id}`);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const reset = () => { setDraft(EMPTY); setMore(false); setOwner(`contact:${subject.id}`); setError(null); };
  // Only Owner and Staff choose; with no group there is nothing to choose between.
  const owners = canMovePlace && groups.length > 0 ? ownerOptions(subject, groups, locale) : null;

  const { pending, onSubmit } = useFormSubmit(async () => {
    const parsed = parsePlaceFields(draft, locale);
    if (!parsed.ok) { setError(tt(parsed.error.key, parsed.error.params)); return; }
    const r = await addPlaceAction(accountId, contactId, { ...draft, owner: owners ? owner : null })
      .catch(() => ({ ok: false as const, error: "places.error.failed" }));
    if (!r.ok) { setError(tt(r.error, "params" in r ? r.params : undefined)); return; }
    onAdded(r.place.id, placeTitle(r.place, locale));
    reset();
    setOpen(false);
  });

  const field = (k: keyof typeof PLACE_LIMITS, labelKey: string, hintKey?: string) => (
    <div className="space-y-1">
      <Label htmlFor={`${id}-${k}`}>{tt(labelKey)}</Label>
      <Input id={`${id}-${k}`} value={draft[k]} onChange={set(k)} maxLength={PLACE_LIMITS[k]} autoComplete="off"
        aria-describedby={hintKey ? `${id}-${k}-hint` : undefined} />
      {hintKey ? <p id={`${id}-${k}-hint`} className={hintClass}>{tt(hintKey)}</p> : null}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        {/* Shrinks and wraps on a narrow card ("Agregar una propiedad" pushed 320px sideways). */}
        <Button type="button" size="sm" variant="ghost" className="h-auto min-h-11 max-w-full whitespace-normal text-left md:min-h-8">
          <Plus className="size-4" aria-hidden />{tt("places.add")}
        </Button>
      </DialogTrigger>
      <DialogContent lang={locale}>
        <DialogHeader><DialogTitle>{tt("places.add")}</DialogTitle></DialogHeader>
        <form className="min-w-0 space-y-4" onSubmit={onSubmit}>
          {field("label", "places.label", "places.labelHint")}
          {field("address", "places.address")}
          <div className="space-y-2">
            <button type="button" aria-expanded={more} aria-controls={`${id}-more`} onClick={() => setMore((v) => !v)}
              className={cn("rounded-[var(--radius-ctl)] text-sm text-muted-foreground underline-offset-4 hover:underline", focusRing)}>
              {tt("places.moreAddress")}
            </button>
            <div id={`${id}-more`} hidden={!more} className="grid gap-2 sm:grid-cols-2">
              {field("city", "places.city")}
              {field("region", "places.region")}
              {field("postal_code", "places.postalCode")}
              <div className="space-y-1">
                <Label htmlFor={`${id}-country`}>{tt("places.country")}</Label>
                <select id={`${id}-country`} value={draft.country} onChange={set("country")} className={cn(nativeFieldClass, "h-9 py-1")}>
                  <option value="">{tt("places.country.none")}</option>
                  <option value="US">{tt("places.country.US")}</option>
                  <option value="MX">{tt("places.country.MX")}</option>
                </select>
              </div>
            </div>
          </div>
          {field("landmark", "places.landmark", "places.landmarkHint")}
          <div className="space-y-1">
            <Label htmlFor={`${id}-directions`}>{tt("places.directions")}</Label>
            <Textarea id={`${id}-directions`} rows={3} value={draft.directions} onChange={set("directions")}
              maxLength={PLACE_LIMITS.directions} aria-describedby={`${id}-directions-hint`} />
            <p id={`${id}-directions-hint`} className={hintClass}>{tt("places.directionsHint")}</p>
          </div>
          {owners ? (
            <div className="space-y-1">
              <Label htmlFor={`${id}-owner`}>{tt("places.belongsTo")}</Label>
              <select id={`${id}-owner`} value={owner} onChange={(e) => setOwner(e.target.value)} className={cn(nativeFieldClass, "h-9 py-1")}>
                {owners.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          ) : null}
          {/* Always mounted, empty until there is something to say, so the words are announced. */}
          <div aria-live="polite" data-place-dialog-error>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">{tt("places.dialog.cancel")}</Button></DialogClose>
            <Button type="submit" disabled={pending}>{tt("places.dialog.add")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
