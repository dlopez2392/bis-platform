import { serviceDb, listCustomFields, listCustomValues } from "@bis/db";
import { SubmitButton } from "../../submit-button";
import { createFieldAction, upsertValueAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CrmSettingsPage({
  params,
}: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const db = serviceDb();
  const [fields, values] = await Promise.all([
    listCustomFields(db, accountId, "contact"),
    listCustomValues(db, accountId),
  ]);
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <section className="space-y-4">
        <h3 className="font-semibold">Custom Fields (contact)</h3>
        <form action={createFieldAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="accountId" value={accountId} />
          <input name="name" placeholder="Field name" required className="rounded border px-3 py-2" />
          <input name="fieldKey" placeholder="field_key" required pattern="[a-z0-9_]+"
            className="rounded border px-3 py-2" />
          <select name="dataType" className="rounded border px-3 py-2">
            <option value="text">text</option>
            <option value="number">number</option>
            <option value="date">date</option>
            <option value="checkbox">checkbox</option>
            <option value="single_select">single select</option>
          </select>
          <input name="options" placeholder="options, comma, separated" className="rounded border px-3 py-2" />
          <SubmitButton>Add field</SubmitButton>
        </form>
        <ul className="space-y-1 text-sm">
          {fields.map((f) => (
            <li key={f.id} className="rounded border p-2">
              <span className="font-medium">{f.name}</span>{" "}
              <code className="text-xs text-gray-500">{f.field_key}</code> · {f.data_type}
              {f.options.length > 0 && <span className="text-xs"> [{f.options.join(", ")}]</span>}
            </li>
          ))}
          {fields.length === 0 && <li className="text-gray-500">No custom fields yet.</li>}
        </ul>
      </section>
      <section className="space-y-4">
        <h3 className="font-semibold">Custom Values (template variables)</h3>
        <p className="text-xs text-gray-500">
          Referenced as {"{{custom_values.key}}"} in templates from M1c on.
        </p>
        <form action={upsertValueAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="accountId" value={accountId} />
          <input name="name" placeholder="Name" required className="rounded border px-3 py-2" />
          <input name="valueKey" placeholder="value_key" required pattern="[a-z0-9_]+"
            className="rounded border px-3 py-2" />
          <input name="value" placeholder="Value" className="rounded border px-3 py-2" />
          <SubmitButton>Save value</SubmitButton>
        </form>
        <ul className="space-y-1 text-sm">
          {values.map((v) => (
            <li key={v.id} className="rounded border p-2">
              <span className="font-medium">{v.name}</span>{" "}
              <code className="text-xs text-gray-500">{v.value_key}</code> = {v.value || "(empty)"}
            </li>
          ))}
          {values.length === 0 && <li className="text-gray-500">No custom values yet.</li>}
        </ul>
      </section>
    </div>
  );
}
