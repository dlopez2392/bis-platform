// The daily brief card's rows (plan D3): one per business the person may get the brief for, pure so it is tested
// alone. A Technician's membership never makes a row (D1); the on/off of each row is whether a subscription exists.
import { DAILY_BRIEF_ROLES, type BriefSubscription } from "@bis/db";
import type { MyMembership } from "@/lib/owner-line/memberships";
import type { Locale } from "@/lib/i18n/locale";

export type DailyBriefRowView = {
  accountId: string;
  /** brandDisplayName's answer (listMyMemberships), never accounts.name. */
  businessName: string;
  on: boolean;
  /** The account-local day the last brief went out, "YYYY-MM-DD", or null when none has. */
  lastSentDay: string | null;
};

export function dailyBriefRows(memberships: readonly MyMembership[], subs: readonly BriefSubscription[]): DailyBriefRowView[] {
  const byAccount = new Map(subs.map((s) => [s.accountId, s] as const));
  return memberships
    .filter((mb) => (DAILY_BRIEF_ROLES as readonly string[]).includes(mb.role))
    .map((mb) => {
      const sub = byAccount.get(mb.accountId);
      return { accountId: mb.accountId, businessName: mb.businessName, on: sub !== undefined, lastSentDay: sub?.lastSentDay ?? null };
    })
    .sort((a, b) => a.businessName.localeCompare(b.businessName) || a.accountId.localeCompare(b.accountId));
}

/** "Tuesday, Nov 17" / "martes, 17 nov": a calendar day already decided in the account's zone, so it is printed in
 *  UTC, which can never move it a day. */
export function briefDayLabel(day: string, locale: Locale): string {
  const [y = 0, mo = 1, d = 1] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", {
    weekday: "long", month: "short", day: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(y, mo - 1, d)));
}
