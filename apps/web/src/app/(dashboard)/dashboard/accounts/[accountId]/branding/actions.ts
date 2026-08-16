"use server";

/**
 * The branding write, and the only one.
 *
 * It lives in the CLIENT-facing route folder rather than in settings/ because
 * that is now the surface it primarily belongs to; the agency's Settings page
 * imports it from here, the same way settings/page.tsx already imports
 * captureBlueprintAction from ../../../blueprints/actions.
 *
 * Kept out of settings/actions.ts on purpose: that module also exports
 * agency-only actions (custom fields, the client-access switch, invitations),
 * and a client-reachable page should not be importing from the module that
 * holds them.
 */

import { revalidatePath } from "next/cache";
import { setBranding, getBranding, uploadBrandLogo, removeBrandLogo, serviceDb } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { sniffImageType, MAX_LOGO_BYTES } from "@/lib/branding/validate-logo";
import { parseHexColor } from "@/lib/branding/color";
import { CORNER_NAMES, MODE_NAMES, NEUTRAL_NAMES, TYPE_NAMES, parseAllowlisted } from "@/lib/branding/theme";
// The public form's own validator, reused deliberately rather than a second
// regex. Its rejections are stricter than RFC (no % or _) for a reason
// recorded there: those are ILIKE metacharacters in contact dedupe. The extra
// strictness costs nothing for an address we only ever hand to Resend, and one
// email regex that drifts from another is worse than one that is strict.
import { isValidEmail } from "@/lib/forms/guards";
import { m } from "@/lib/messages";

export async function setBrandingAction(
  accountId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Widened from agency-only: this action is now the ONE branding write,
  // reached from the agency's Settings card and from the client's own
  // Branding page. requireAccountAccess already redirects a client asking
  // for someone else's account to their own rather than 403ing (a 403
  // confirms the account exists), and refuses one whose access is off.
  const { userId } = await requireAccountAccess(accountId);

  const brandName = String(formData.get("brandName") ?? "").trim() || null;

  // Empty clears it, exactly like brandName above. Anything present must be a
  // real hex color: this string ends up in a CSS custom property on a page
  // anonymous strangers load, so "looks close enough" is not a standard.
  const rawColor = String(formData.get("brandColor") ?? "").trim();
  const brandColor = rawColor === "" ? null : parseHexColor(rawColor);
  if (rawColor !== "" && brandColor === null) {
    return { ok: false, error: m["branding.badColor"] };
  }

  // Empty clears it, like brandName and brandColor above. A malformed address
  // is refused here rather than stored: it is handed to Resend on every send,
  // and a bad one fails silently at the provider — long after anyone is
  // looking at this form.
  const rawReplyTo = String(formData.get("replyToEmail") ?? "").trim();
  const replyToEmail = rawReplyTo === "" ? null : rawReplyTo;
  if (replyToEmail !== null && !isValidEmail(replyToEmail)) {
    return { ok: false, error: m["branding.badReplyTo"] };
  }

  // A closed set on the way in as well as in the column. The constraint is the
  // real guarantee; this exists so a typo in the form returns a message
  // instead of a Postgres error the operator cannot act on.
  function pickOne<T extends readonly string[]>(
    field: string, allowed: T,
  ): T[number] | null | false {
    return parseAllowlisted(String(formData.get(field) ?? ""), allowed);
  }

  const brandNeutral = pickOne("brandNeutral", NEUTRAL_NAMES);
  const brandCorners = pickOne("brandCorners", CORNER_NAMES);
  const brandType = pickOne("brandType", TYPE_NAMES);
  const brandMode = pickOne("brandMode", MODE_NAMES);
  if (brandNeutral === false || brandCorners === false || brandType === false || brandMode === false) {
    return { ok: false, error: m["branding.badTheme"] };
  }

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
      // The RLS-enforced client, NOT serviceDb(). accounts_agency_all covers
      // the agency and accounts_member_update (0013) covers the client, so
      // one call serves both and a guard mistake yields zero rows instead of
      // another company's branding. setBranding already .select("id")s and
      // throws when it matches nothing, so an RLS-filtered write surfaces as
      // a failure rather than a silent success.
      await dbForRequest(), accountId,
      // brandLogoPath is omitted, not nulled, when no new file was sent:
      // editing the display name must not delete the logo already set.
      brandLogoPath
        ? { brandName, brandLogoPath, brandColor, brandNeutral, brandCorners, brandType, brandMode,
            replyToEmail }
        : { brandName, brandColor, brandNeutral, brandCorners, brandType, brandMode,
            replyToEmail },
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
  revalidatePath(`/dashboard/accounts/${accountId}/branding`);
  return { ok: true };
}

