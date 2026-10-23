"use client";

/**
 * S-47c (plan Task 8; spec 5.7, C13, C21): the Services & prices card. Writes ONLY
 * through `saveServicesAction` (Task 7), the knowledge snapshot RPC. Every
 * edit is staged in this card's own state until "Save services" — nothing a
 * saved row's Remove does is destroyed before Save (spec 5.7), and a refused save
 * keeps every edit (`useFormSubmit`).
 */
import { useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Tag } from "lucide-react";
import { toast } from "sonner";
import type { VoiceServiceInput } from "@bis/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Notice } from "@/components/ui/notice";
import { EmptyState } from "@/components/empty-state";
import { SubmitButton } from "../../submit-button";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { makeTr, type Tr } from "@/lib/record/copy";
import type { MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { amountsInText } from "@/lib/voice/knowledge/facts-warnings";
import { formatUsd, PRICE_KINDS, priceSentence, type PriceKind } from "@/lib/voice/knowledge/price-sentence";
import { formFromServices, parseDollars, servicesFromForm, type ServiceForm } from "@/lib/voice/knowledge/validate";
import { useFocusAfterRender } from "./focus-after-render";
import type { ActionResult } from "./actions";

const KIND_LABEL_KEY: Record<PriceKind, MessageKey> = {
  fixed: "voice.services.kind.fixed", from: "voice.services.kind.from", range: "voice.services.kind.range",
  per_unit: "voice.services.kind.per_unit", free: "voice.services.kind.free", after_visit: "voice.services.kind.after_visit",
};

/** The lengths `servicesFromForm` accepts (and the CHECKs hold): the fields stop there instead of refusing on Save. */
const MAX_NAME = 80;
const MAX_DESCRIPTION = 300;
const MAX_UNIT = 30;

/** `origin` is the row as last saved — its English name and whether it carried a price — or null for a row
 *  added in this visit and never saved. C21 reads it (renaming a priced row on insurance drops the price), and
 *  so does Remove (a never-saved row goes at once; a saved one is staged until Save). */
export type ServiceRowState = ServiceForm & {
  id: string; removed: boolean; editing: boolean;
  origin: { name_en: string; priced: boolean } | null;
};

const isPriced = (kind: ServiceForm["price_kind"]) => kind !== "" && kind !== "after_visit";

/** A brand-new row (spec 5.7): `price_kind: ""` always, whichever account this opens on. On insurance
 *  there is no kind Select to ever change it away from blank, and the server reads that as
 *  `after_visit` (C13) — this factory does not take an `insurance` flag because it has nothing to do
 *  differently; only the editor's RENDER hides the Select on insurance. */
export function newServiceRow(): ServiceForm {
  return {
    name_en: "", name_es: "", description_en: "", description_es: "",
    price_kind: "", amount: "", amount_max: "", unit_en: "", unit_es: "",
  };
}

export function toRowState(rows: readonly VoiceServiceInput[]): ServiceRowState[] {
  return formFromServices(rows).map((f) => ({
    ...f, id: crypto.randomUUID(), removed: false, editing: false,
    origin: { name_en: f.name_en, priced: isPriced(f.price_kind) },
  }));
}

/**
 * What "Save services" actually posts (spec 5.7): every row NOT staged for removal, in the card's
 * current order, stripped back to the plain `ServiceForm` the server validates — never this card's
 * own `id`/`removed`/`editing`/`origin`. Reads nothing about `insurance`: a stored row posts back exactly
 * the kind and amounts it was loaded with, insurance or not, because this function never rewrites a
 * field. Whether a price survives a rename on insurance is the server's call (C21), from its own read.
 */
export function postableServices(rows: readonly ServiceRowState[]): ServiceForm[] {
  return rows.filter((r) => !r.removed).map((r): ServiceForm => ({
    name_en: r.name_en, name_es: r.name_es, description_en: r.description_en, description_es: r.description_es,
    price_kind: r.price_kind, amount: r.amount, amount_max: r.amount_max, unit_en: r.unit_en, unit_es: r.unit_es,
  }));
}

export type ServiceAmountMatch = { name: string; text: string };

/**
 * S-47c follow-up (design review): an amount typed into a row's own NAME or DESCRIPTION — not its
 * price fields — IS read to the caller, as written. `LIST_PRICE_LINE` makes her say the rendered
 * price sentence word for word, and `priceSentence` (price-sentence.ts) builds that sentence from the
 * name verbatim, so a name's amount travels straight into it ("The price for Haircut $40 is $25.");
 * a description's amount is read as its own "About it" line (prompt-blocks.ts's servicesBlock), which
 * the price rule never touches either. Off insurance this contradicts the HARD LIMITS line (no amount
 * outside the price sentence); on insurance no price is ever given at all (5.4), though the words are
 * still in the prompt as written. Scans all four fields of every row passed in (the card calls this
 * with `postableServices(rows)`, so a row staged for removal is already excluded), reusing
 * facts-warnings.ts's own amount matcher and its false-positive guards. Each match is tagged with the
 * row's own English name, or its Spanish one when the English name is still blank.
 */
export function serviceAmountMatches(
  rows: readonly Pick<ServiceForm, "name_en" | "name_es" | "description_en" | "description_es">[],
): ServiceAmountMatch[] {
  const out: ServiceAmountMatch[] = [];
  for (const row of rows) {
    const name = row.name_en.trim() || row.name_es.trim();
    for (const field of [row.name_en, row.name_es, row.description_en, row.description_es]) {
      for (const text of amountsInText(field)) out.push({ name, text });
    }
  }
  return out;
}

/** C21: on insurance, a row loaded with a price whose English name (trimmed) now differs will be saved as
 *  "priced after a visit" — the server's rule (keepStoredInsurancePrices), said before Save rather than after. */
export function renameDropsPrice(row: ServiceRowState, insurance: boolean): boolean {
  return insurance && row.origin !== null && row.origin.priced && row.name_en.trim() !== row.origin.name_en.trim();
}

/** Remove (spec 5.7): a row never saved goes at once (there is nothing to keep it for); a saved row is
 *  staged until Save, so nothing stored is destroyed before the card's commit. */
export function removeRow(rows: readonly ServiceRowState[], id: string): ServiceRowState[] {
  const row = rows.find((r) => r.id === id);
  if (!row) return [...rows];
  if (row.origin === null) return rows.filter((r) => r.id !== id);
  return rows.map((r) => (r.id === id ? { ...r, removed: true, editing: false } : r));
}

/**
 * The card after a successful Save (design review I3): the staged rows are gone, every editor is closed, and
 * every row is now a SAVED row whose `origin` is what was just stored. On insurance that includes C21: a
 * renamed priced row was stored as after_visit with nothing priced, so the card holds the same, and a new row
 * (no kind) was stored as after_visit.
 */
export function settleAfterSave(rows: readonly ServiceRowState[], insurance: boolean): ServiceRowState[] {
  return rows.filter((r) => !r.removed).map((r) => {
    const dropped = renameDropsPrice(r, insurance);
    const next: ServiceRowState = dropped
      ? { ...r, price_kind: "after_visit", amount: "", amount_max: "", unit_en: "", unit_es: "" }
      : insurance && r.price_kind === "" ? { ...r, price_kind: "after_visit" } : { ...r };
    return { ...next, editing: false, origin: { name_en: next.name_en, priced: isPriced(next.price_kind) } };
  });
}

/** After Move up/down the pressed arrow keeps the focus on the moved row, unless the row just reached the end
 *  it was moving to (that arrow is now disabled), when the other arrow takes it (design review I5). */
export function moveFocusTarget(delta: -1 | 1, newIndex: number, count: number): "up" | "down" {
  if (delta === -1) return newIndex === 0 ? "down" : "up";
  return newIndex === count - 1 ? "up" : "down";
}

/**
 * The live preview (spec 5.7): both sentences `priceSentence` — the function the prompt itself uses —
 * would say for this row, or null when the row is not complete enough to ask it (never insurance,
 * C13: no preview there at all). `servicesFromForm` is the SAME gate the server save uses, so a row
 * this reads as complete is one `priceSentence` can never throw on.
 */
export function serviceRowPreview(row: ServiceForm, insurance: boolean): { en: string; es: string } | null {
  if (insurance) return null;
  const validated = servicesFromForm([row], { insurance: false });
  if (!validated.ok) return null;
  const service = validated.services[0]!;
  return { en: priceSentence(service, "en"), es: priceSentence(service, "es") };
}

/** The row's collapsed amount summary (never on insurance, C13) — `null` for a kind with no dollar
 *  amount of its own (free, after_visit, or none chosen yet) or an amount not yet parseable. */
function amountSummary(row: ServiceForm, tr: Tr): string | null {
  switch (row.price_kind) {
    case "fixed":
    case "from": {
      const cents = parseDollars(row.amount);
      return cents === null ? null : formatUsd(cents);
    }
    case "range": {
      const lo = parseDollars(row.amount);
      const hi = parseDollars(row.amount_max);
      return lo === null || hi === null ? null : tr.text("voice.services.summary.range", { min: formatUsd(lo), max: formatUsd(hi) });
    }
    case "per_unit": {
      const cents = parseDollars(row.amount);
      const unit = row.unit_en.trim();
      return cents === null || unit === "" ? null : tr.text("voice.services.summary.perUnit", { amount: formatUsd(cents), unit });
    }
    default:
      return null;
  }
}

/** The collapsed row. Its buttons name the service ("Edit Catering"), and carry ids (`<row id>-edit` and so
 *  on) so the card can put focus back on the right one after the row re-renders (design review I5). A staged
 *  row fades only what will go — the name, kind and amount — never its status word or its Keep (I7). */
export function ServiceRowView({
  row, index, count, insurance, tr, onMove, onEdit, onRemove, onKeep,
}: {
  row: ServiceRowState; index: number; count: number; insurance: boolean; tr: Tr;
  onMove: (delta: -1 | 1) => void; onEdit: () => void; onRemove: () => void; onKeep: () => void;
}) {
  const named = row.name_en.trim() !== "";
  const name = named ? row.name_en : tr.text("voice.services.unnamed");
  // C13 (final review I3): insurance shows no price at all, the kind included.
  const kindLabel = !insurance && row.price_kind ? tr.text(KIND_LABEL_KEY[row.price_kind]) : "";
  const summary = insurance ? null : amountSummary(row, tr);
  const fade = row.removed && "opacity-50";
  return (
    <li className="flex flex-wrap items-center gap-2 border-t border-[var(--row-line)] py-2 first:border-t-0">
      <span className={cn("min-w-0 flex-1 truncate", named ? "font-medium text-card-foreground" : "text-muted-foreground", fade)}>{name}</span>
      {kindLabel ? <span className={cn("shrink-0 text-xs text-muted-foreground", fade)}>{kindLabel}</span> : null}
      {summary ? <span className={cn("shrink-0 text-xs text-muted-foreground tabular-nums", fade)}>{summary}</span> : null}
      {row.removed ? (
        <>
          <span className="text-xs text-muted-foreground">{tr.text("voice.services.removing")}</span>
          <Button
            id={`${row.id}-keep`} type="button" variant="ghost" size="xs"
            aria-label={tr.text("voice.services.keepNamed", { name })} onClick={onKeep}
          >
            {tr.text("voice.services.keep")}
          </Button>
        </>
      ) : (
        <>
          <Button
            id={`${row.id}-up`} type="button" variant="ghost" size="xs"
            aria-label={tr.text("voice.services.moveUp", { name })} disabled={index === 0} onClick={() => onMove(-1)}
          >
            <ArrowUp className="size-3.5" aria-hidden />
          </Button>
          <Button
            id={`${row.id}-down`} type="button" variant="ghost" size="xs"
            aria-label={tr.text("voice.services.moveDown", { name })} disabled={index === count - 1} onClick={() => onMove(1)}
          >
            <ArrowDown className="size-3.5" aria-hidden />
          </Button>
          <Button
            id={`${row.id}-edit`} type="button" variant="ghost" size="xs"
            aria-label={tr.text("voice.services.editNamed", { name })} onClick={onEdit}
          >
            {tr.text("voice.services.edit")}
          </Button>
          <Button
            id={`${row.id}-remove`} type="button" variant="ghost" size="xs"
            aria-label={tr.text("voice.services.removeNamed", { name })} onClick={onRemove}
          >
            {tr.text("voice.services.remove")}
          </Button>
        </>
      )}
    </li>
  );
}

/**
 * The row's inline edit form — its own component (not inlined in the card below) so the render tests
 * can prove the insurance face (no kind Select, no amount/unit field, no preview, no "$" anywhere —
 * spec 5.7, C13) and the live preview directly, without simulating a click on "Edit" (this repo's
 * render harness, `renderToStaticMarkup`, never fires one — `voice-settings.test.ts`'s own note on
 * `ConciergeCard`). `dropsPrice` is `renameDropsPrice` for this row (C21): the one-line hint under the
 * English name, tied to it by `aria-describedby`.
 */
export function ServiceRowEditor({
  rowId, row, insurance, dropsPrice, locale, pseudo, onChange, onDone,
}: {
  rowId: string; row: ServiceForm; insurance: boolean; dropsPrice: boolean; locale: "en" | "es"; pseudo: boolean;
  onChange: (patch: Partial<ServiceForm>) => void; onDone: () => void;
}) {
  const tr = useMemo(() => makeTr(locale, pseudo), [locale, pseudo]);
  const preview = serviceRowPreview(row, insurance);
  const hasAmountFields = row.price_kind === "fixed" || row.price_kind === "from"
    || row.price_kind === "range" || row.price_kind === "per_unit";
  const hintId = `${rowId}-name-en-hint`;
  return (
    <li className="space-y-3 rounded-[var(--radius-ctl)] border-t border-[var(--row-line)] bg-[var(--surface-2)] px-3 py-3 first:border-t-0" lang={locale}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${rowId}-name-en`}>{tr.text("voice.services.nameEn")}</Label>
          <Input
            id={`${rowId}-name-en`} aria-describedby={dropsPrice ? hintId : undefined} maxLength={MAX_NAME}
            value={row.name_en} onChange={(e) => onChange({ name_en: e.target.value })}
          />
          {dropsPrice ? <p id={hintId} className="text-xs text-muted-foreground">{tr.text("voice.services.renameDropsPrice")}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${rowId}-name-es`}>{tr.text("voice.services.nameEs")}</Label>
          <Input id={`${rowId}-name-es`} maxLength={MAX_NAME} value={row.name_es} onChange={(e) => onChange({ name_es: e.target.value })} />
        </div>
      </div>
      {!insurance ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${rowId}-kind`}>{tr.text("voice.services.kind")}</Label>
          <Select value={row.price_kind} onValueChange={(v) => onChange({ price_kind: v as PriceKind })}>
            <SelectTrigger id={`${rowId}-kind`} className="w-full"><SelectValue placeholder={tr.text("voice.services.kindPlaceholder")} /></SelectTrigger>
            <SelectContent>
              {PRICE_KINDS.map((k) => (
                <SelectItem key={k} value={k}>{tr.text(KIND_LABEL_KEY[k])}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {!insurance && hasAmountFields ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {row.price_kind === "fixed" || row.price_kind === "from" || row.price_kind === "per_unit" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${rowId}-amount`}>{tr.text("voice.services.amount")}</Label>
              <Input id={`${rowId}-amount`} inputMode="decimal" value={row.amount} onChange={(e) => onChange({ amount: e.target.value })} />
            </div>
          ) : null}
          {row.price_kind === "range" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`${rowId}-amount-min`}>{tr.text("voice.services.amountMin")}</Label>
                <Input id={`${rowId}-amount-min`} inputMode="decimal" value={row.amount} onChange={(e) => onChange({ amount: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${rowId}-amount-max`}>{tr.text("voice.services.amountMax")}</Label>
                <Input id={`${rowId}-amount-max`} inputMode="decimal" value={row.amount_max} onChange={(e) => onChange({ amount_max: e.target.value })} />
              </div>
            </>
          ) : null}
          {row.price_kind === "per_unit" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`${rowId}-unit-en`}>{tr.text("voice.services.unitEn")}</Label>
                <Input id={`${rowId}-unit-en`} maxLength={MAX_UNIT} value={row.unit_en} onChange={(e) => onChange({ unit_en: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${rowId}-unit-es`}>{tr.text("voice.services.unitEs")}</Label>
                <Input id={`${rowId}-unit-es`} maxLength={MAX_UNIT} value={row.unit_es} onChange={(e) => onChange({ unit_es: e.target.value })} />
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${rowId}-desc-en`}>{tr.text("voice.services.descriptionEn")}</Label>
          <Textarea
            id={`${rowId}-desc-en`} maxLength={MAX_DESCRIPTION} rows={2}
            value={row.description_en} onChange={(e) => onChange({ description_en: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${rowId}-desc-es`}>{tr.text("voice.services.descriptionEs")}</Label>
          <Textarea
            id={`${rowId}-desc-es`} maxLength={MAX_DESCRIPTION} rows={2}
            value={row.description_es} onChange={(e) => onChange({ description_es: e.target.value })}
          />
        </div>
      </div>
      {preview ? (
        <div className="space-y-1 rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-1)] p-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-card-foreground">{tr.text("voice.services.previewEn")}:</span> <span data-preview="en" lang="en">{preview.en}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-card-foreground">{tr.text("voice.services.previewEs")}:</span> <span data-preview="es" lang="es">{preview.es}</span>
          </p>
        </div>
      ) : null}
      <Button type="button" variant="ghost" size="sm" onClick={onDone}>{tr.text("voice.services.done")}</Button>
    </li>
  );
}

export function ServicesPricesCard({
  locale, pseudo, persona, insurance, services, action,
}: {
  locale: "en" | "es";
  pseudo: boolean;
  persona: string;
  insurance: boolean;
  /** `listVoiceServices`'s result, wrapped by page.tsx so a failed read is this card's own ERROR
   *  state (spec 5.7) rather than the whole page's. */
  services: { ok: true; rows: VoiceServiceInput[] } | { ok: false };
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const tr = useMemo(() => makeTr(locale, pseudo), [locale, pseudo]);
  const baseId = useId();
  const maxHintId = `${baseId}-max`;
  const addId = `${baseId}-add`;
  const focusAfterRender = useFocusAfterRender();
  const [rows, setRows] = useState<ServiceRowState[]>(() => (services.ok ? toRowState(services.rows) : []));

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(async () => {
      const result = await action(formData);
      // Design review I3: a successful Save leaves no staged row and no open editor behind.
      if (result.ok) setRows((current) => settleAfterSave(current, insurance));
      return result;
    }, toast, {
      success: tr.text("voice.services.saved"),
      crashed: tr.text("common.actionCrashed"),
    });
  });

  // Each row action puts the focus somewhere that still exists after the re-render (design review I5).
  function move(id: string, delta: -1 | 1) {
    const index = rows.findIndex((r) => r.id === id);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= rows.length) return;
    setRows((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    focusAfterRender(`${id}-${moveFocusTarget(delta, target, rows.length)}`);
  }
  function patch(id: string, p: Partial<ServiceForm>) {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }
  function startEdit(id: string) {
    setRows((current) => current.map((r) => ({ ...r, editing: r.id === id })));
    focusAfterRender(`${id}-name-en`);
  }
  function closeEdit(id: string) {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, editing: false } : r)));
    focusAfterRender(`${id}-edit`);
  }
  function remove(id: string) {
    const neverSaved = rows.find((r) => r.id === id)?.origin === null;
    setRows((current) => removeRow(current, id));
    focusAfterRender(neverSaved ? addId : `${id}-keep`);
  }
  function keep(id: string) {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, removed: false } : r)));
    focusAfterRender(`${id}-remove`);
  }
  function addRow() {
    const row: ServiceRowState = { ...newServiceRow(), id: crypto.randomUUID(), removed: false, editing: true, origin: null };
    setRows((current) => [...current.map((r) => ({ ...r, editing: false })), row]);
    focusAfterRender(`${row.id}-name-en`);
  }

  const titleKey = insurance ? "voice.services.titleInsurance" : "voice.services.title";

  if (!services.ok) {
    return (
      <Card id="services-prices" lang={locale}>
        <CardHeader>
          <CardTitle>{tr.text(titleKey)}</CardTitle>
        </CardHeader>
        <CardContent>
          <Notice tone="crit">{tr.text("voice.services.loadFailed")}</Notice>
        </CardContent>
      </Card>
    );
  }

  // S-47c follow-up: live, like the Facts flags above this card — recomputed on every keystroke, never
  // blocking Save. Scans exactly what Save would post (removed rows excluded).
  const amountMatches = serviceAmountMatches(postableServices(rows));
  const amountsText = amountMatches
    .map((a) => `${a.name || tr.text("voice.services.unnamed")}: "${a.text}"`)
    .join(", ");

  const atMax = rows.length >= 50;
  const addButton = (
    <Button id={addId} type="button" variant="ghost" size="sm" disabled={atMax} aria-describedby={atMax ? maxHintId : undefined} onClick={addRow}>
      {tr.text("voice.services.add")}
    </Button>
  );

  return (
    <Card id="services-prices" lang={locale}>
      <CardHeader>
        <CardTitle>{tr.text(titleKey)}</CardTitle>
        {insurance ? null : <CardDescription>{tr.text("voice.services.body", { persona })}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* A standing fact about this account, there on first paint: a note, not an assertive alert, and a
            sentence in the foreground ink (design review I8, components/zone-note.tsx). */}
        {insurance ? (
          <Notice tone="warn" role="note" className="text-foreground">{tr.text("voice.services.insuranceNotice", { persona })}</Notice>
        ) : null}
        {/* S-47c follow-up: an amount typed into a name or description, never a blocker (design review
            I8 precedent: a note, not an assertive alert, with the foreground ink). */}
        {amountMatches.length > 0 ? (
          <Notice tone="warn" role="note" className="text-foreground">
            {tr.text(insurance ? "voice.services.amountsNoticeInsurance" : "voice.services.amountsNotice", { persona, amounts: amountsText })}
          </Notice>
        ) : null}
        {rows.length === 0 ? (
          <EmptyState icon={Tag} title={tr.text("voice.services.empty", { persona })} action={addButton} />
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="services" value={JSON.stringify(postableServices(rows))} />
            <ol className="flex flex-col">
              {rows.map((row, index) => (
                row.editing ? (
                  <ServiceRowEditor
                    key={row.id} rowId={row.id} row={row} insurance={insurance} dropsPrice={renameDropsPrice(row, insurance)}
                    locale={locale} pseudo={pseudo}
                    onChange={(p) => patch(row.id, p)} onDone={() => closeEdit(row.id)}
                  />
                ) : (
                  <ServiceRowView
                    key={row.id} row={row} index={index} count={rows.length} insurance={insurance} tr={tr}
                    onMove={(delta) => move(row.id, delta)} onEdit={() => startEdit(row.id)}
                    onRemove={() => remove(row.id)} onKeep={() => keep(row.id)}
                  />
                )
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              {addButton}
              <SubmitButton pending={pending}>{tr.text("voice.services.save")}</SubmitButton>
            </div>
            {atMax ? <p id={maxHintId} className="text-xs text-muted-foreground">{tr.text("voice.services.max")}</p> : null}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
