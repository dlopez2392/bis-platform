"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import { serviceDb, createAccount } from "@bis/db";

export async function createClientAccount(formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "America/Chicago");
  if (!name) throw new Error("Account name is required");

  const clerk = await clerkClient();
  const org = await clerk.organizations.createOrganization({ name, createdBy: userId });
  try {
    await createAccount(serviceDb(), { clerkOrgId: org.id, name, timezone, actorId: userId });
  } catch (err) {
    // compensating rollback: never leave a Clerk org without a tenant row
    await clerk.organizations.deleteOrganization(org.id).catch(() => {});
    throw err;
  }
  revalidatePath("/dashboard/accounts");
}
