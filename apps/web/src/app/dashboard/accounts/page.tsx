import { serviceDb, listAccounts } from "@bis/db";
import { createClientAccount } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await listAccounts(serviceDb());
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Client Accounts</h1>
      <form action={createClientAccount} className="flex gap-2">
        <input name="name" placeholder="Business name" required
          className="rounded border px-3 py-2" />
        <input name="timezone" defaultValue="America/Chicago"
          className="rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-black px-4 py-2 text-white">
          Create account
        </button>
      </form>
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b">
          <th className="py-2">Name</th><th>Status</th><th>Timezone</th><th>Created</th>
        </tr></thead>
        <tbody>
          {accounts.map(a => (
            <tr key={a.id} className="border-b">
              <td className="py-2">{a.name}</td>
              <td>{a.status}</td>
              <td>{a.timezone}</td>
              <td>{new Date(a.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
          {accounts.length === 0 && (
            <tr><td colSpan={4} className="py-6 text-gray-500">No client accounts yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
