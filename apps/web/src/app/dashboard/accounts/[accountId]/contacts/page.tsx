import Link from "next/link";
import { serviceDb, listContacts } from "@bis/db";
import { SubmitButton } from "../../submit-button";
import { createContactAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  params, searchParams,
}: { params: Promise<{ accountId: string }>; searchParams: Promise<{ q?: string }> }) {
  const { accountId } = await params;
  const { q } = await searchParams;
  const contacts = await listContacts(serviceDb(), accountId, { search: q });
  const base = `/dashboard/accounts/${accountId}/contacts`;
  return (
    <div className="space-y-6">
      <form action={base} className="flex gap-2">
        <input name="q" defaultValue={q ?? ""} placeholder="Search name, email, phone…"
          className="w-72 rounded border px-3 py-2" />
        <button type="submit" className="rounded border px-4 py-2">Search</button>
      </form>
      <form action={createContactAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="accountId" value={accountId} />
        <input name="firstName" placeholder="First name" className="rounded border px-3 py-2" />
        <input name="lastName" placeholder="Last name" className="rounded border px-3 py-2" />
        <input name="email" type="email" placeholder="Email" className="rounded border px-3 py-2" />
        <input name="phone" placeholder="Phone" className="rounded border px-3 py-2" />
        <SubmitButton>Add contact</SubmitButton>
      </form>
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b">
          <th className="py-2">Name</th><th>Email</th><th>Phone</th><th>Created</th>
        </tr></thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id} className="border-b">
              <td className="py-2">
                <Link className="underline" href={`${base}/${c.id}`}>
                  {[c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)"}
                </Link>
              </td>
              <td>{c.email}</td>
              <td>{c.phone}</td>
              <td>{new Date(c.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
          {contacts.length === 0 && (
            <tr><td colSpan={4} className="py-6 text-gray-500">
              {q ? "No matches." : "No contacts yet."}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
