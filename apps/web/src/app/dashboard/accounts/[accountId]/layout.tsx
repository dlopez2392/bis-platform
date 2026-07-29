import { notFound } from "next/navigation";
import { serviceDb } from "@bis/db";
import { requireAgency } from "@/lib/auth";

export default async function AccountWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ accountId: string }>;
}) {
  await requireAgency();
  const { accountId } = await params;
  const { data: account } = await serviceDb()
    .from("accounts")
    .select("id, name")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) notFound();
  return <>{children}</>;
}
