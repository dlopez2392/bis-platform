"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { CustomFieldDef, FormField, FormRow } from "@bis/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SubmitButton } from "../../../submit-button";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import { defaultFieldKey } from "@/lib/forms/editor-helpers";

const CORE_KINDS = [
  "core.first_name", "core.last_name", "core.email", "core.phone", "core.company_name",
  "message", "consent",
] as const;

function kindLabel(kind: string, customFields: CustomFieldDef[]): string {
  const key = `forms.kind.${kind}` as keyof typeof m;
  if (m[key]) return m[key] as string;
  const fieldKey = kind.slice("custom.".length);
  return customFields.find((f) => f.field_key === fieldKey)?.name ?? fieldKey;
}

export function FormEditor({
  form, customFields, action,
}: {
  form: FormRow;
  customFields: CustomFieldDef[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [fields, setFields] = useState<FormField[]>(form.fields);
  const [successMode, setSuccessMode] = useState(form.success_mode);

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    try { await action(formData); toast.success(m["forms.saved"]); }
    catch { toast.error(m["forms.saveFailed"]); }
  });

  const available = [
    ...CORE_KINDS.filter((kind) => !fields.some((f) => f.kind === kind)),
    ...customFields
      .map((f) => `custom.${f.field_key}`)
      .filter((kind) => !fields.some((f) => f.kind === kind)),
  ];

  function addField(kind: string) {
    const key = defaultFieldKey(kind);
    // Belt-and-braces: namespacing custom keys (custom_<field_key>) already
    // makes a core/custom collision impossible, but refuse outright rather
    // than silently producing a second field FormData would drop the answer
    // for, in case some future kind ever generates a duplicate key.
    if (fields.some((f) => f.key === key)) {
      toast.error(m["forms.duplicateFieldKey"]);
      return;
    }
    setFields((current) => [...current, {
      key, kind: kind as FormField["kind"],
      label: kindLabel(kind, customFields), required: false,
    }]);
  }

  function move(index: number, delta: number) {
    setFields((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function patch(index: number, changes: Partial<FormField>) {
    setFields((current) => current.map((f, i) => (i === index ? { ...f, ...changes } : f)));
  }

  return (
    <form
      // onSubmit, NOT the `action` prop — React resets an action-prop form
      // even when the action threw and was caught here, and the three Selects
      // below revert to their first-render values on that reset. For
      // `successMode` that also drove `setSuccessMode` backwards through
      // onValueChange, flipping the conditional redirect field with it. See
      // lib/forms/use-form-submit.ts.
      onSubmit={onSubmit}
      className="space-y-4"
    >
      <input type="hidden" name="formId" value={form.id} />
      {/* An ordered array of objects, which flat form fields cannot express. */}
      <input type="hidden" name="fields" value={JSON.stringify(fields)} />

      <Card>
        <CardHeader><CardTitle className="text-sm">{m["forms.fields"]}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">{m["forms.noFields"]}</p>
          ) : (
            <ol className="space-y-2">
              {fields.map((field, index) => (
                <li key={field.key} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
                  <span className="w-40 shrink-0 truncate text-xs text-muted-foreground">
                    {kindLabel(field.kind, customFields)}
                  </span>
                  <Input
                    value={field.label}
                    onChange={(e) => patch(index, { label: e.target.value })}
                    aria-label={`${m["forms.fieldLabel"]} — ${field.key}`}
                    className="h-8 min-w-[160px] flex-1 text-sm"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Checkbox
                      checked={field.required}
                      onCheckedChange={(value) => patch(index, { required: value === true })}
                    />
                    {m["forms.fieldRequired"]}
                  </label>
                  {/* Buttons, not drag: only @dnd-kit/core is installed, and
                      these are keyboard-accessible with no extra work. */}
                  <Button type="button" variant="ghost" size="xs" aria-label={m["forms.moveUp"]}
                          onClick={() => move(index, -1)} disabled={index === 0}>
                    <ArrowUp className="size-3.5" aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="xs" aria-label={m["forms.moveDown"]}
                          onClick={() => move(index, 1)} disabled={index === fields.length - 1}>
                    <ArrowDown className="size-3.5" aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="xs" aria-label={m["forms.removeField"]}
                          onClick={() => setFields((c) => c.filter((_, i) => i !== index))}>
                    <X className="size-3.5" aria-hidden />
                  </Button>
                </li>
              ))}
            </ol>
          )}

          {available.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-xs text-muted-foreground">{m["forms.addField"]}:</span>
              {available.map((kind) => (
                <Button key={kind} type="button" variant="outline" size="xs"
                        onClick={() => addField(kind)}>
                  {kindLabel(kind, customFields)}
                </Button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">{m["forms.settings"]}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="form-name-edit">{m["forms.name"]}</Label>
            <Input id="form-name-edit" name="name" defaultValue={form.name} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="form-locale">{m["forms.locale"]}</Label>
            <Select name="locale" defaultValue={form.locale_default}>
              <SelectTrigger id="form-locale" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="es">Español</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="form-notify">{m["forms.notifyEmails"]}</Label>
            <Input id="form-notify" name="notifyEmails" defaultValue={form.notify_emails.join(", ")} />
            <p className="text-xs text-muted-foreground">{m["forms.notifyHint"]}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="form-success-mode">{m["forms.successMode"]}</Label>
            <Select name="successMode" defaultValue={form.success_mode}
                    onValueChange={(value) => setSuccessMode(value as "message" | "redirect")}>
              <SelectTrigger id="form-success-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="message">{m["forms.successModeMessage"]}</SelectItem>
                <SelectItem value="redirect">{m["forms.successModeRedirect"]}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {successMode === "redirect" ? (
            <div className="space-y-1.5">
              <Label htmlFor="form-redirect">{m["forms.redirectUrl"]}</Label>
              <Input id="form-redirect" name="redirectUrl" type="url"
                     defaultValue={form.redirect_url ?? ""} />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="form-success-message">{m["forms.successMessage"]}</Label>
              <Input id="form-success-message" name="successMessage"
                     defaultValue={form.success_message ?? ""} />
            </div>
          )}
          <label className="flex items-end gap-2 pb-1.5 text-sm">
            <Checkbox name="transparent" defaultChecked={form.theme.transparentBackground} />
            {m["forms.transparent"]}
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pending={pending}>{m["common.save"]}</SubmitButton>
        <Label htmlFor="form-status" className="sr-only">{m["forms.status"]}</Label>
        <Select name="status" defaultValue={form.status}>
          <SelectTrigger id="form-status" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">{m["forms.status.draft"]}</SelectItem>
            <SelectItem value="published">{m["forms.status.published"]}</SelectItem>
            <SelectItem value="archived">{m["forms.status.archived"]}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </form>
  );
}
