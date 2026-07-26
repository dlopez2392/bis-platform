import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceDb } from "@bis/db";
import { requireAgency } from "@/lib/auth";

export default async function AccountWorkspaceLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ accountId: string }> }) {
  await requireAgency();
  const { accountId } = await params;
  const { data: account } = await serviceDb()
    .from("accounts").select("id, name").eq("id", accountId).maybeSingle();
  if (!account) notFound();
  const base = `/dashboard/accounts/${account.id}`;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-3">
        <h2 className="text-lg font-semibold">{account.name}</h2>
        <nav className="flex gap-4 text-sm">
          <Link href={`${base}/contacts`}>Contacts</Link>
          <Link href={`${base}/pipeline`}>Pipeline</Link>
          <Link href={`${base}/settings`}>CRM Settings</Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
