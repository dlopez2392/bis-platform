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
  if (error) {
    // 22P02 = Postgres invalid_text_representation, which PostgREST surfaces
    // when accountId isn't valid uuid syntax (e.g. a malformed or guessed
    // URL segment like ".../accounts/foo/dashboard"). That is a routing
    // miss, not a query fault, so it belongs behind the same notFound() a
    // well-formed-but-nonexistent id already gets below — not the error
    // boundary. Every other query error still throws and fails loud.
    if (error.code === "22P02") notFound();
    throw new Error(`account lookup failed: ${error.message}`);
  }
  if (!account) notFound();
  return <>{children}</>;
}
