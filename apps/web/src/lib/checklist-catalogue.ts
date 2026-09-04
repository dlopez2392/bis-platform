import type { A2pStatus, ChecklistStateRow } from "@bis/db";
import { m } from "./messages";

export type CatalogueItem = {
  key: string;
  title: string;
  help: string;
  /** True when the work happens outside this platform. The UI must say so —
   *  a checklist implying the app performs these is a lie it tells daily. */
  external: boolean;
  href?: string;
};

export const CHECKLIST_CATALOGUE: CatalogueItem[] = [
  { key: "phone_number", title: m["checklist.phone_number.title"],
    help: m["checklist.phone_number.help"], external: true },
  { key: "a2p_registration", title: m["checklist.a2p_registration.title"],
    help: m["checklist.a2p_registration.help"], external: true },
  { key: "email_domain", title: m["checklist.email_domain.title"],
    help: m["checklist.email_domain.help"], external: true, href: "https://resend.com/domains" },
  { key: "form_notify", title: m["checklist.form_notify.title"],
    help: m["checklist.form_notify.help"], external: false },
  // Not external: this is done in this app, on the company's Branding page.
  // No href — the catalogue is a static module with no account id in scope, so
  // the help text names the destination instead, as every internal item does.
  { key: "reply_to", title: m["checklist.reply_to.title"],
    help: m["checklist.reply_to.help"], external: false },
  { key: "gbp_connect", title: m["checklist.gbp_connect.title"],
    help: m["checklist.gbp_connect.help"], external: true },
  // Not external as of M2: inviting the owner is done in this company's
  // Settings under Client access, not in the Clerk dashboard. Leaving
  // external:true would keep the "Done outside BIS" badge on an item the
  // platform now performs itself.
  { key: "invite_owner", title: m["checklist.invite_owner.title"],
    help: m["checklist.invite_owner.help"], external: false },
];

export type ChecklistEntry = {
  key: string; title: string; help: string; external: boolean; href?: string;
  custom: boolean; done: boolean; note: string | null;
  /** True when `done` came from account state rather than a stored tick, so
   *  the panel must NOT offer a toggle: writing the row would succeed and
   *  change nothing on screen, which is a control that lies. */
  derived: boolean;
};

/**
 * Merges the code catalogue with stored state.
 *
 * A catalogue item with no row appears undone — which is why a new catalogue
 * item needs no backfill. A stored row whose key is no longer in the catalogue
 * is dropped rather than rendered untitled, so retiring an item cannot break
 * an account that had ticked it.
 */
export function mergeChecklist(
  rows: ChecklistStateRow[],
  /** Items whose truth lives in account state rather than a stored tick.
   *  A2P is the first: registration happens with the carriers, so a manual
   *  tick could claim done for a client who cannot legally text. Undefined
   *  (no account read available) falls back to the stored row. */
  accountState: { a2pStatus?: A2pStatus } = {},
): ChecklistEntry[] {
  const byKey = new Map(rows.map((r) => [r.item_key, r]));

  const catalogue: ChecklistEntry[] = CHECKLIST_CATALOGUE.map((item) => {
    const row = byKey.get(item.key);
    const derived = item.key === "a2p_registration" && accountState.a2pStatus !== undefined;
    // Only `approved` reads as done, and it OVERRIDES a stored tick rather
    // than OR-ing with it — the accepted consequence is that this one item can
    // go backwards if a registration is later rejected.
    const done = derived
      ? accountState.a2pStatus === "approved"
      : Boolean(row?.done_at);
    return {
      key: item.key, title: item.title, help: item.help,
      external: item.external, href: item.href, custom: false,
      done, note: row?.note ?? null, derived,
    };
  });

  const custom: ChecklistEntry[] = rows
    .filter((r) => r.item_key.startsWith("custom:"))
    .map((r) => ({
      key: r.item_key, title: r.title ?? "", help: "", external: false,
      custom: true, done: Boolean(r.done_at), note: r.note ?? null,
      derived: false,
    }));

  return [...catalogue, ...custom];
}
