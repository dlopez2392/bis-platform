"use server";

import { revalidatePath } from "next/cache";
import { requireAgencyOnlyAccountAccess, requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { createCustomField, upsertCustomValue, setClientAccess, setBranding,
         getBranding, uploadBrandLogo, removeBrandLogo, serviceDb,
         type CustomFieldDef } from "@bis/db";
import { sniffImageType, MAX_LOGO_BYTES } from "@/lib/branding/validate-logo";
import { m } from "@/lib/messages";

export async function createFieldAction(accountId: string, formData: FormData): Promise<void> {
  await requireAgencyOnlyAccountAccess(accountId);
  const dataType = String(formData.get("dataType")) as CustomFieldDef["data_type"];
  const options = String(formData.get("options") ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  await createCustomField(await dbForRequest(), accountId, {
    model: "contact",
    fieldKey: String(formData.get("fieldKey") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    dataType, options: options.length ? options : undefined,
  });
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
}

export async function upsertValueAction(accountId: string, formData: FormData): Promise<void> {
  await requireAgencyOnlyAccountAccess(accountId);
  await upsertCustomValue(await dbForRequest(), accountId, {
    valueKey: String(formData.get("valueKey") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    value: String(formData.get("value") ?? ""),
  });
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
}

/**
 * Deliberately serviceDb(), not dbForRequest(): this writes the very flag
 * app.current_account_id() reads to resolve an account for a client's
 * RLS-scoped token, so an RLS-scoped client could never turn its own access
 * back *on* — the row would already be invisible to it. Guarded on isAgency
 * instead, since the database can't be trusted to gate this one.
 */
export async function setClientAccessAction(accountId: string, formData: FormData): Promise<void> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) throw new Error("only the agency may change client access");

  const enabled = formData.get("enabled") === "true";
  await setClientAccess(serviceDb(), accountId, enabled, userId);
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
}

/**
 * Sets a company's display name and logo.
 *
 * Agency-only, and the gate is the first statement: the whole milestone rests
 * on there being no client-facing write path to branding. `accountId` is bound
 * server-side by the caller via `.bind(null, accountId)` — never a form field,
 * or this becomes the thirteenth IDOR on this codebase.
 *
 * serviceDb() is correct here, as it is elsewhere in this file: Settings is
 * agency-only, and a Storage write needs the service role.
 */
export async function setBrandingAction(
  accountId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);

  const brandName = String(formData.get("brandName") ?? "").trim() || null;
  const file = formData.get("logo");

  let brandLogoPath: string | undefined;
  let previousLogoPath: string | null = null;
  if (file instanceof File && file.size > 0) {
    // Read before the write, so the old object can be swept up afterwards.
    previousLogoPath = (await getBranding(serviceDb(), accountId)).brandLogoPath;
    if (file.size > MAX_LOGO_BYTES) return { ok: false, error: m["branding.tooLarge"] };
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Re-check against what actually arrived. file.size is metadata; this is
    // the payload, and only one of the two is what gets stored.
    if (bytes.length > MAX_LOGO_BYTES) return { ok: false, error: m["branding.tooLarge"] };
    // Sniff the real bytes. file.type is browser-supplied and the filename is
    // client-controlled; neither is evidence of anything.
    const contentType = sniffImageType(bytes);
    if (!contentType) return { ok: false, error: m["branding.badFormat"] };
    try {
      brandLogoPath = await uploadBrandLogo(serviceDb(), accountId, bytes, contentType);
    } catch (e) {
      // A Storage outage should not take the Settings page down with a red
      // screen — the panel renders this inline and the rest of the page, which
      // includes the client-access switch, stays usable.
      console.error(`setBranding: logo upload failed for account ${accountId}: ${String(e)}`);
      return { ok: false, error: m["branding.saveFailed"] };
    }
  }

  try {
    await setBranding(
      serviceDb(), accountId,
      // brandLogoPath is omitted, not nulled, when no new file was sent:
      // editing the display name must not delete the logo already set.
      brandLogoPath ? { brandName, brandLogoPath } : { brandName },
      userId,
    );
  } catch (e) {
    console.error(`setBranding: write failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["branding.saveFailed"] };
  }

  // Only after the new path is durably recorded, and never fatal: an orphaned
  // object costs a few KB, while failing here would report a save that in fact
  // succeeded. Deliberately skipped when the paths match — re-uploading the
  // same image resolves to the same content-addressed path, and deleting it
  // would delete the logo that was just saved.
  if (brandLogoPath && previousLogoPath && previousLogoPath !== brandLogoPath) {
    try {
      await removeBrandLogo(serviceDb(), previousLogoPath);
    } catch (e) {
      console.error(`setBranding: orphaned previous logo ${previousLogoPath}: ${String(e)}`);
    }
  }

  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  return { ok: true };
}

export async function inviteClientAdminAction(
  accountId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) throw new Error("only the agency may invite client users");

  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { ok: false, error: m["clientAccess.inviteFailed"] };

  const db = serviceDb();
  const { data: account, error } = await db.from("accounts")
    .select("clerk_org_id, client_access_enabled").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`invite: account lookup failed: ${error.message}`);
  if (!account) throw new Error("invite: account not found");
  if (!account.client_access_enabled) {
    return { ok: false, error: m["clientAccess.disabledHint"] };
  }

  const res = await fetch(
    `https://api.clerk.com/v1/organizations/${account.clerk_org_id}/invitations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: email,
        role: "org:admin",
        inviter_user_id: userId,
      }),
    },
  );
  if (!res.ok) {
    // Expected failures (already invited, already a member, seat limit) are
    // rendered, not thrown — the dialog shows them and stays open.
    console.error("clerk invite failed", res.status, await res.text());
    return { ok: false, error: m["clientAccess.inviteFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  return { ok: true };
}
