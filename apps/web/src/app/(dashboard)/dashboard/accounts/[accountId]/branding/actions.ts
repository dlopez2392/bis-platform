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
import { clerkClient } from "@clerk/nextjs/server";
import { setBranding, getBranding, uploadBrandLogo, sweepOrphanedLogos, restoreBrandLogoIfCleared,
         logoExists, serviceDb } from "@bis/db";
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
import { syncClerkOrgName } from "@/lib/accounts/clerk-org-name";
import { m } from "@/lib/messages";

/** accounts_mailing_address_check's upper bound (migration 0048). Not
 *  exported: a "use server" module may export only async functions. */
const MAX_MAILING_ADDRESS = 300;

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

  const brandName = String(formData.get("brandName") ?? "").trim();
  // Customers see this name on every email, text and the booking page; it
  // is never blank from here on (spec 2026-09-07-brand-name-resolver).
  if (!brandName) return { ok: false, error: m["branding.nameRequired"] };

  // Empty clears it — unlike brandName above, which now refuses a blank
  // rather than clearing. Anything present must be a real hex color: this
  // string ends up in a CSS custom property on a page anonymous strangers
  // load, so "looks close enough" is not a standard.
  const rawColor = String(formData.get("brandColor") ?? "").trim();
  const brandColor = rawColor === "" ? null : parseHexColor(rawColor);
  if (rawColor !== "" && brandColor === null) {
    return { ok: false, error: m["branding.badColor"] };
  }

  // Empty clears it, like brandColor above (brandName above is the one
  // exception: blank refuses rather than clears). A malformed address
  // is refused here rather than stored: it is handed to Resend on every send,
  // and a bad one fails silently at the provider — long after anyone is
  // looking at this form.
  const rawReplyTo = String(formData.get("replyToEmail") ?? "").trim();
  const replyToEmail = rawReplyTo === "" ? null : rawReplyTo;
  if (replyToEmail !== null && !isValidEmail(replyToEmail)) {
    return { ok: false, error: m["branding.badReplyTo"] };
  }

  // The postal address the reactivation email prints (migration 0048; the
  // requirement for one is the orchestrator's reading of CAN-SPAM, not a
  // lawyer's). Empty clears it, like replyToEmail above. Never looser than
  // the column's CHECK, which strips EXACTLY what `.trim()` strips and caps
  // the rest at 300 code points: whitespace-only therefore arrives as null,
  // never as text Postgres would refuse, and `.length` counts UTF-16 units —
  // never fewer than code points — so a value this accepts the CHECK accepts.
  // An HTML form submission normalizes a textarea's line breaks to CRLF on
  // submit, whatever the user actually typed or however the value was set
  // programmatically — a browser fact, not a bug in the page. Every other
  // line-break convention (a lone CR included) is folded to LF here, before
  // the trim and the length check, so the stored value — and the count the
  // length check uses — is always LF-only, matching what the unit tests
  // post and what the reactivation email expects to print.
  const rawMailing = String(formData.get("mailingAddress") ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  const mailingAddress = rawMailing === "" ? null : rawMailing;
  if (mailingAddress !== null && mailingAddress.length > MAX_MAILING_ADDRESS) {
    return { ok: false, error: m["branding.mailingAddressTooLong"] };
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
  if (file instanceof File && file.size > 0) {
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

  // The brand name BEFORE this save, so Clerk is only called when it changes
  // (D-005 review): a colour or logo save has no reason to touch Clerk. An
  // unreadable earlier name counts as changed: unsure means try. Same
  // request-scoped client as the write below.
  let previousBrandName: string | null = null;
  try {
    previousBrandName = (await getBranding(await dbForRequest(), accountId))?.brandName?.trim() ?? null;
  } catch {
    previousBrandName = null;
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
            replyToEmail, mailingAddress }
        : { brandName, brandColor, brandNeutral, brandCorners, brandType, brandMode,
            replyToEmail, mailingAddress },
      userId,
    );
  } catch (e) {
    console.error(`setBranding: write failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["branding.saveFailed"] };
  }

  // D-005: Clerk names the organisation in every invitation email, so it
  // follows the name the client sees. Only after the write succeeded, and
  // never fatal — syncClerkOrgName logs and returns false on any failure.
  // Skipped when the name is unchanged; a sync that failed earlier is then
  // retried by the next save that changes it, not by every save.
  if (previousBrandName !== brandName) {
    await syncClerkOrgName(await dbForRequest(), clerkClient, accountId, brandName);
  }

  // Only after the new path is durably recorded, and never fatal: an orphaned
  // object costs a few KB, while failing here would report a save that in fact
  // succeeded. sweepOrphanedLogos keeps `brandLogoPath` itself, so a
  // byte-identical re-upload (same content-addressed path as before) is
  // naturally a no-op rather than a special case here — and the sweep also
  // picks up anything an earlier, un-undone "Remove logo" (./actions.ts
  // below) left sitting in this account's folder unreferenced.
  if (brandLogoPath) {
    try {
      await sweepOrphanedLogos(serviceDb(), accountId, brandLogoPath);
    } catch (e) {
      console.error(`setBranding: logo sweep failed for account ${accountId}: ${String(e)}`);
    }
  }

  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  revalidatePath(`/dashboard/accounts/${accountId}/branding`);
  return { ok: true };
}

/**
 * uploadBrandLogo's exact output shape (packages/db/src/branding.ts):
 * `${accountId}/logo-<16 lowercase hex>.<png|jpg|webp>`. Anchored at both
 * ends against the ACCOUNT'S OWN id — not merely a `startsWith` prefix — so
 * a path like `acct_1/../acct_2/logo-abc.png` (which a URL normalizes into
 * the OTHER account's object; a near-Critical review finding, 2026-10-04)
 * fails the match outright: it is neither inside this account's folder nor
 * shaped like one of its own logos. The one legitimate caller of this
 * pattern (restoreBrandLogoAction below) only ever hands back a path this
 * same upload function produced, so the shape check is exact on purpose.
 */
function isOwnLogoPath(accountId: string, path: string): boolean {
  const escaped = accountId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}/logo-[0-9a-f]{16}\\.(?:png|jpg|webp)$`).test(path);
}

/**
 * "Remove logo" (DESIGN.md rule 6): runs at once, no confirm dialog. Clears
 * `brand_logo_path` through the SAME write as setBrandingAction above (RLS
 * client, `account.branding_updated` emit and all) but deliberately does NOT
 * delete the stored object — `restoreBrandLogoAction` below is this
 * action's Undo, and it restores the exact path rather than re-uploading, so
 * the object has to still be there for it to point back at.
 *
 * Sweeps the account's OTHER stored logo objects AFTER the write succeeds,
 * never before (a near-Critical review fix, 2026-10-04): a sweep that ran
 * first and the write then failing would have deleted Storage objects for a
 * database change that never happened. The sweep itself re-reads the live
 * `brand_logo_path` before deleting anything (sweepOrphanedLogos), so a
 * concurrent save landing between this write and this sweep still survives
 * — this call only needs to keep the path it is ABOUT to orphan, which is
 * exactly what Undo needs.
 */
export async function removeBrandLogoAction(
  accountId: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const { userId } = await requireAccountAccess(accountId);

  // The RLS-enforced client, not serviceDb() (house rule: reads on the
  // in-account surface go through the client the signed-in user actually
  // has, the same backstop setBrandingAction's own read relies on).
  const requestDb = await dbForRequest();
  const current = await getBranding(requestDb, accountId);
  const path = current.brandLogoPath;
  if (!path) return { ok: false, error: m["branding.noLogoToRemove"] };

  try {
    await setBranding(requestDb, accountId, { brandLogoPath: null }, userId);
  } catch (e) {
    console.error(`removeBrandLogo: write failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["branding.saveFailed"] };
  }

  try {
    await sweepOrphanedLogos(serviceDb(), accountId, path);
  } catch (e) {
    console.error(`removeBrandLogo: sweep failed for account ${accountId}: ${String(e)}`);
  }

  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  revalidatePath(`/dashboard/accounts/${accountId}/branding`);
  return { ok: true, path };
}

/**
 * The Undo of `removeBrandLogoAction`: restores the exact path Remove just
 * cleared. Never re-derived from an upload — the object was never deleted
 * (ordinarily), so there is nothing to upload again.
 *
 * Two checks a near-Critical review added (2026-10-04), both because a
 * sonner Undo toast can sit around far longer than the click that produced
 * it (its auto-dismiss pauses on hover/focus) and the world can have moved
 * on by the time it fires — reproduced as writes=[null, "...-new.png",
 * "...-old.png"]: Remove, then a fresh upload, then this STALE toast
 * silently overwriting the upload that came after it.
 *   (a) The write only happens if `brand_logo_path` is STILL null right now
 *       — `restoreBrandLogoIfCleared`'s compare-and-set, atomic at the
 *       database, so there is no read-then-write gap for a second save to
 *       land in. A later upload leaves the column non-null, and Undo loses.
 *   (b) The object has to still EXIST in Storage — a later Remove's own
 *       sweep (or this account's next upload) can have deleted it since.
 * Either failing answers the same plain-language refusal, not a crash and
 * not a false "ok: true": the operator sees nothing restored because
 * nothing SHOULD have been.
 *
 * `path` also has to be shaped like one of THIS account's own uploads
 * (isOwnLogoPath) before either check runs — the Undo toast holds it, not
 * the server, and a member of account A handing this a path shaped like
 * `acct_B/logo-....png` must not be able to point their own branding at a
 * different account's stored object.
 */
export async function restoreBrandLogoAction(
  accountId: string, path: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await requireAccountAccess(accountId);

  if (!isOwnLogoPath(accountId, path)) {
    return { ok: false, error: m["branding.saveFailed"] };
  }

  try {
    const stillThere = await logoExists(serviceDb(), path);
    if (!stillThere) return { ok: false, error: m["branding.logoGone"] };

    const restored = await restoreBrandLogoIfCleared(await dbForRequest(), accountId, path, userId);
    if (!restored) return { ok: false, error: m["branding.logoGone"] };
  } catch (e) {
    console.error(`restoreBrandLogo: write failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["branding.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  revalidatePath(`/dashboard/accounts/${accountId}/branding`);
  return { ok: true };
}

