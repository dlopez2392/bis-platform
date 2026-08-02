import { notFound } from "next/navigation";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";

export default async function AccountWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  await requireAccountAccess(accountId);
  const db = await dbForRequest();
  const { data: account, error } = await db
    .from("accounts")
    .select("id, name")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(`account lookup failed: ${error.message}`);
  if (!account) notFound();
  return <>{children}</>;
}
