"use client";

/**
 * S-47c (plan Task 8; spec 5.7, C13): the Services & prices card. Writes ONLY
 * through `saveServicesAction` (Task 7), the knowledge snapshot RPC. Every
 * edit is staged in this card's own state until "Save services" — nothing a
 * row's Remove does is destroyed before Save (spec 5.7), and a refused save
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
import { Notice } from "@/components/ui/notice";
import { EmptyState } from "@/components/empty-state";
import { SubmitButton } from "../../submit-button";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { makeTr, type Tr } from "@/lib/record/copy";
import type { MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { formatUsd, PRICE_KINDS, priceSentence, type PriceKind } from "@/lib/voice/knowledge/price-sentence";
import { formFromServices, parseDollars, servicesFromForm, type ServiceForm } from "@/lib/voice/knowledge/validate";
import type { ActionResult } from "./actions";

const KIND_LABEL_KEY: Record<PriceKind, MessageKey> = {
  fixed: "voice.services.kind.fixed", from: "voice.services.kind.from", range: "voice.services.kind.range",
  per_unit: "voice.services.kind.per_unit", free: "voice.services.kind.free", after_visit: "voice.services.kind.after_visit",
};

export type ServiceRowState = ServiceForm & { id: string; removed: boolean; editing: boolean };

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

function toRowState(rows: readonly VoiceServiceInput[]): ServiceRowState[] {
  return formFromServices(rows).map((f) => ({ ...f, id: crypto.randomUUID(), removed: false, editing: false }));
}

/**
 * What "Save services" actually posts (spec 5.7): every row NOT staged for removal, in the card's
 * current order, stripped back to the plain `ServiceForm` the server validates — never this card's
 * own `id`/`removed`/`editing`. Reads nothing about `insurance`: a stored row this card never opened
 * for editing posts back exactly the kind and amounts it was loaded with, insurance or not, because
 * this function never rewrites a field — only a card state change (through the editor) ever does.
 */
export function postableServices(rows: readonly ServiceRowState[]): ServiceForm[] {
  return rows.filter((r) => !r.removed).map((r): ServiceForm => ({
    name_en: r.name_en, name_es: r.name_es, description_en: r.description_en, description_es: r.description_es,
    price_kind: r.price_kind, amount: r.amount, amount_max: r.amount_max, unit_en: r.unit_en, unit_es: r.unit_es,
  }));
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

function ServiceRowView({
  row, index, count, insurance, tr, onMove, onEdit, onRemove, onKeep,
}: {
  row: ServiceRowState; index: number; count: number; insurance: boolean; tr: Tr;
  onMove: (delta: number) => void; onEdit: () => void; onRemove: () => void; onKeep: () => void;
}) {
  const kindLabel = row.price_kind ? tr.text(KIND_LABEL_KEY[row.price_kind]) : "";
  const summary = insurance ? null : amountSummary(row, tr);
  return (
    <li className={cn("flex flex-wrap items-center gap-2 border-t border-[var(--row-line)] py-2 first:border-t-0", row.removed && "opacity-50")}>
      <span className="min-w-0 flex-1 truncate font-medium text-card-foreground">{row.name_en || tr.text("voice.services.nameEn")}</span>
      {kindLabel ? <span className="shrink-0 text-xs text-muted-foreground">{kindLabel}</span> : null}
      {summary ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{summary}</span> : null}
      {row.removed ? (
        <>
          <span className="text-xs text-muted-foreground">{tr.text("voice.services.removing")}</span>
          <Button type="button" variant="ghost" size="xs" onClick={onKeep}>{tr.text("voice.services.keep")}</Button>
        </>
      ) : (
        <>
          <Button type="button" variant="ghost" size="xs" aria-label={tr.text("voice.services.moveUp")} disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="size-3.5" aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="xs" aria-label={tr.text("voice.services.moveDown")} disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown className="size-3.5" aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={onEdit}>{tr.text("voice.services.edit")}</Button>
          <Button type="button" variant="ghost" size="xs" onClick={onRemove}>{tr.text("voice.services.remove")}</Button>
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
 * `ConciergeCard`).
 */
export function ServiceRowEditor({
  rowId, row, insurance, locale, pseudo, onChange, onDone,
}: {
  rowId: string; row: ServiceForm; insurance: boolean; locale: "en" | "es"; pseudo: boolean;
  onChange: (patch: Partial<ServiceForm>) => void; onDone: () => void;
}) {
  const tr = useMemo(() => makeTr(locale, pseudo), [locale, pseudo]);
  const preview = serviceRowPreview(row, insurance);
  const hasAmountFields = row.price_kind === "fixed" || row.price_kind === "from"
    || row.price_kind === "range" || row.price_kind === "per_unit";
  return (
    <li className="space-y-3 border-t border-[var(--row-line)] bg-[var(--surface-2)] px-3 py-3 first:border-t-0" lang={locale}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${rowId}-name-en`}>{tr.text("voice.services.nameEn")}</Label>
          <Input id={`${rowId}-name-en`} value={row.name_en} onChange={(e) => onChange({ name_en: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${rowId}-name-es`}>{tr.text("voice.services.nameEs")}</Label>
          <Input id={`${rowId}-name-es`} value={row.name_es} onChange={(e) => onChange({ name_es: e.target.value })} />
        </div>
      </div>
      {!insurance ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${rowId}-kind`}>{tr.text("voice.services.kind")}</Label>
          <Select value={row.price_kind} onValueChange={(v) => onChange({ price_kind: v as PriceKind })}>
            <SelectTrigger id={`${rowId}-kind`} className="w-full"><SelectValue placeholder={tr.text("voice.services.kind")} /></SelectTrigger>
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
                <Input id={`${rowId}-unit-en`} value={row.unit_en} onChange={(e) => onChange({ unit_en: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${rowId}-unit-es`}>{tr.text("voice.services.unitEs")}</Label>
                <Input id={`${rowId}-unit-es`} value={row.unit_es} onChange={(e) => onChange({ unit_es: e.target.value })} />
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${rowId}-desc-en`}>{tr.text("voice.services.descriptionEn")}</Label>
          <Input id={`${rowId}-desc-en`} value={row.description_en} onChange={(e) => onChange({ description_en: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${rowId}-desc-es`}>{tr.text("voice.services.descriptionEs")}</Label>
          <Input id={`${rowId}-desc-es`} value={row.description_es} onChange={(e) => onChange({ description_es: e.target.value })} />
        </div>
      </div>
      {preview ? (
        <div className="space-y-1 rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-1)] p-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-card-foreground">{tr.text("voice.services.previewEn")}:</span> {preview.en}
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-card-foreground">{tr.text("voice.services.previewEs")}:</span> {preview.es}
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
  const maxHintId = useId();
  const [rows, setRows] = useState<ServiceRowState[]>(() => (services.ok ? toRowState(services.rows) : []));

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => action(formData), toast, {
      success: tr.text("voice.services.saved"),
      crashed: tr.text("common.actionCrashed"),
    });
  });

  function move(id: string, delta: number) {
    setRows((current) => {
      const index = current.findIndex((r) => r.id === id);
      const target = index + delta;
      if (index === -1 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }
  function patch(id: string, p: Partial<ServiceForm>) {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }
  function startEdit(id: string) {
    setRows((current) => current.map((r) => ({ ...r, editing: r.id === id })));
  }
  function closeEdit(id: string) {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, editing: false } : r)));
  }
  function stageRemove(id: string) {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, removed: true, editing: false } : r)));
  }
  function keep(id: string) {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, removed: false } : r)));
  }
  function addRow() {
    const row: ServiceRowState = { ...newServiceRow(), id: crypto.randomUUID(), removed: false, editing: true };
    setRows((current) => [...current.map((r) => ({ ...r, editing: false })), row]);
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

  const atMax = rows.length >= 50;
  const addButton = (
    <Button type="button" variant="ghost" size="sm" disabled={atMax} aria-describedby={atMax ? maxHintId : undefined} onClick={addRow}>
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
        {insurance ? <Notice tone="warn">{tr.text("voice.services.insuranceNotice", { persona })}</Notice> : null}
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
                    key={row.id} rowId={row.id} row={row} insurance={insurance} locale={locale} pseudo={pseudo}
                    onChange={(p) => patch(row.id, p)} onDone={() => closeEdit(row.id)}
                  />
                ) : (
                  <ServiceRowView
                    key={row.id} row={row} index={index} count={rows.length} insurance={insurance} tr={tr}
                    onMove={(delta) => move(row.id, delta)} onEdit={() => startEdit(row.id)}
                    onRemove={() => stageRemove(row.id)} onKeep={() => keep(row.id)}
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
