import { Braces, SlidersHorizontal } from "lucide-react";
import { serviceDb, listCustomFields, listCustomValues, listBlueprints, type CustomFieldDef } from "@bis/db";
import { SubmitButton } from "../../submit-button";
import { createFieldAction, upsertValueAction } from "./actions";
import { SaveBlueprintDialog } from "./save-blueprint-dialog";
import { captureBlueprintAction } from "../../../blueprints/actions";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

const DATA_TYPE_LABEL: Record<CustomFieldDef["data_type"], string> = {
  text: m["settings.dataType.text"],
  number: m["settings.dataType.number"],
  date: m["settings.dataType.date"],
  checkbox: m["settings.dataType.checkbox"],
  single_select: m["settings.dataType.singleSelect"],
};

export default async function CrmSettingsPage({
  params,
}: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const db = serviceDb();
  const [fields, values, blueprints] = await Promise.all([
    listCustomFields(db, accountId, "contact"),
    listCustomValues(db, accountId),
    // Agency-wide, not account-scoped — this account is just where the
    // capture happens. Passed down so the save dialog can warn before a
    // recapture silently overwrites an existing blueprint's bundle: capture
    // has no version history and no undo.
    listBlueprints(db),
  ]);
  const boundCreateField = createFieldAction.bind(null, accountId);
  const boundUpsertValue = upsertValueAction.bind(null, accountId);
  return (
    <>
      <PageHeader
        title={m["settings.title"]}
        actions={
          <SaveBlueprintDialog
            action={captureBlueprintAction.bind(null, accountId)}
            existing={blueprints.map((b) => ({ name: b.name, version: b.version }))}
          />
        }
      />
      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{m["settings.customFields"]}</CardTitle>
            <CardDescription>{m["settings.customFieldsBody"]}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form action={boundCreateField} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="field-name">{m["settings.fieldName"]}</Label>
                <Input id="field-name" name="name" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="field-key">{m["settings.fieldKey"]}</Label>
                <Input id="field-key" name="fieldKey" required pattern="[a-z0-9_]+" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="field-type">{m["settings.dataType"]}</Label>
                <Select name="dataType" defaultValue="text">
                  <SelectTrigger id="field-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">{m["settings.dataType.text"]}</SelectItem>
                    <SelectItem value="number">{m["settings.dataType.number"]}</SelectItem>
                    <SelectItem value="date">{m["settings.dataType.date"]}</SelectItem>
                    <SelectItem value="checkbox">{m["settings.dataType.checkbox"]}</SelectItem>
                    <SelectItem value="single_select">{m["settings.dataType.singleSelect"]}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="field-options">{m["settings.options"]}</Label>
                <Input id="field-options" name="options" />
              </div>
              <SubmitButton>{m["settings.addField"]}</SubmitButton>
            </form>

            {fields.length === 0 ? (
              <EmptyState icon={SlidersHorizontal} title={m["settings.noFields"]} />
            ) : (
              <ul className="space-y-2">
                {fields.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border p-3 text-sm"
                  >
                    <span className="font-medium text-card-foreground">{f.name}</span>
                    <code className="font-mono text-xs text-muted-foreground">{f.field_key}</code>
                    <span className="text-xs text-muted-foreground">
                      · {DATA_TYPE_LABEL[f.data_type]}
                    </span>
                    {f.options.length > 0 && (
                      <span className="text-xs text-muted-foreground">[{f.options.join(", ")}]</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{m["settings.customValues"]}</CardTitle>
            <CardDescription>{m["settings.customValuesBody"]}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form action={boundUpsertValue} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="value-name">{m["settings.valueName"]}</Label>
                <Input id="value-name" name="name" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="value-key">{m["settings.valueKey"]}</Label>
                <Input id="value-key" name="valueKey" required pattern="[a-z0-9_]+" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="value-value">{m["settings.value"]}</Label>
                <Input id="value-value" name="value" />
              </div>
              <SubmitButton>{m["settings.saveValue"]}</SubmitButton>
            </form>

            {values.length === 0 ? (
              <EmptyState icon={Braces} title={m["settings.noValues"]} />
            ) : (
              <ul className="space-y-2">
                {values.map((v) => (
                  <li
                    key={v.id}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border p-3 text-sm"
                  >
                    <span className="font-medium text-card-foreground">{v.name}</span>
                    <code className="font-mono text-xs text-muted-foreground">{v.value_key}</code>
                    <span className="text-xs text-muted-foreground">
                      = {v.value || m["common.none"]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
