import { notFound } from "next/navigation";
import { serviceDb, getContact, listContactTags, listNotes, listContactTasks,
         listCustomFields, listContactOpportunities } from "@bis/db";
import { SubmitButton } from "../../../submit-button";
import { updateContactAction, addTagAction, removeTagAction,
         addNoteAction, addTaskAction, completeTaskAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
}: { params: Promise<{ accountId: string; contactId: string }> }) {
  const { accountId, contactId } = await params;
  const db = serviceDb();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) notFound();
  const [tags, notes, tasks, fieldDefs, opps] = await Promise.all([
    listContactTags(db, accountId, contactId),
    listNotes(db, accountId, contactId),
    listContactTasks(db, accountId, contactId),
    listCustomFields(db, accountId, "contact"),
    listContactOpportunities(db, accountId, contactId),
  ]);
  const custom = (contact.custom ?? {}) as Record<string, unknown>;
  const hidden = (
    <>
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="contactId" value={contactId} />
    </>
  );
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section className="space-y-4">
        <h3 className="font-semibold">Details</h3>
        <form action={updateContactAction} className="space-y-2">
          {hidden}
          <input name="firstName" defaultValue={contact.first_name ?? ""} placeholder="First name" className="w-full rounded border px-3 py-2" />
          <input name="lastName" defaultValue={contact.last_name ?? ""} placeholder="Last name" className="w-full rounded border px-3 py-2" />
          <input name="email" defaultValue={contact.email ?? ""} placeholder="Email" className="w-full rounded border px-3 py-2" />
          <input name="phone" defaultValue={contact.phone ?? ""} placeholder="Phone" className="w-full rounded border px-3 py-2" />
          <input name="companyName" defaultValue={contact.company_name ?? ""} placeholder="Company" className="w-full rounded border px-3 py-2" />
          {fieldDefs.map((d) => (
            <label key={d.id} className="block text-sm">
              <span className="mb-1 block text-gray-500">{d.name}</span>
              {d.data_type === "checkbox" ? (
                <input type="checkbox" name={`cf_${d.field_key}`} defaultChecked={custom[d.field_key] === true} />
              ) : d.data_type === "single_select" ? (
                <select name={`cf_${d.field_key}`} defaultValue={String(custom[d.field_key] ?? "")} className="w-full rounded border px-3 py-2">
                  <option value="">—</option>
                  {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={d.data_type === "number" ? "number" : d.data_type === "date" ? "date" : "text"}
                  name={`cf_${d.field_key}`} defaultValue={String(custom[d.field_key] ?? "")}
                  className="w-full rounded border px-3 py-2" />
              )}
            </label>
          ))}
          <SubmitButton>Save</SubmitButton>
        </form>
        <div>
          <h3 className="mb-2 font-semibold">Tags</h3>
          <div className="flex flex-wrap items-center gap-2">
            {tags.map((t) => (
              <form key={t.id} action={removeTagAction} className="inline">
                {hidden}
                <input type="hidden" name="tagId" value={t.id} />
                <button className="rounded-full border px-3 py-1 text-xs" title="Remove tag">
                  {t.name} ✕
                </button>
              </form>
            ))}
            <form action={addTagAction} className="inline-flex gap-1">
              {hidden}
              <input name="tag" placeholder="add tag" className="w-28 rounded border px-2 py-1 text-xs" />
              <button className="rounded border px-2 py-1 text-xs">+</button>
            </form>
          </div>
        </div>
        <div>
          <h3 className="mb-2 font-semibold">Opportunities</h3>
          <ul className="space-y-1 text-sm">
            {opps.map((o) => (
              <li key={o.id}>{o.name} — ${Number(o.monetary_value).toLocaleString()} · {o.status}</li>
            ))}
            {opps.length === 0 && <li className="text-gray-500">None yet.</li>}
          </ul>
        </div>
      </section>
      <section className="space-y-6">
        <div>
          <h3 className="mb-2 font-semibold">Notes</h3>
          <form action={addNoteAction} className="mb-3 flex gap-2">
            {hidden}
            <input name="body" placeholder="Add a note…" className="flex-1 rounded border px-3 py-2" />
            <SubmitButton>Add</SubmitButton>
          </form>
          <ul className="space-y-2 text-sm">
            {notes.map((n) => (
              <li key={n.id} className="rounded border p-2">
                {n.body}
                <div className="mt-1 text-xs text-gray-500">{new Date(n.created_at).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 font-semibold">Tasks</h3>
          <form action={addTaskAction} className="mb-3 flex gap-2">
            {hidden}
            <input name="title" placeholder="New task…" className="flex-1 rounded border px-3 py-2" />
            <input name="dueAt" type="date" className="rounded border px-3 py-2" />
            <SubmitButton>Add</SubmitButton>
          </form>
          <ul className="space-y-1 text-sm">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                {t.completed_at ? (
                  <span className="line-through text-gray-500">{t.title}</span>
                ) : (
                  <form action={completeTaskAction} className="inline-flex items-center gap-2">
                    {hidden}
                    <input type="hidden" name="taskId" value={t.id} />
                    <button className="rounded border px-2 text-xs">done</button>
                    <span>{t.title}</span>
                    {t.due_at && <span className="text-xs text-gray-500">due {new Date(t.due_at).toLocaleDateString()}</span>}
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
