// The AI apps cards' pure parts (plan 2026-11-19-mcp-server.md 3.6), so they are tested without React: the server
// address, one log line in words, and the Preferences card's per-business rows.
import { OWNER_LINE_ROLES } from "@/lib/owner-line/data-path";
import type { MyMembership } from "@/lib/owner-line/memberships";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";
import type { AiAppLogRow, AiAppsSwitchState } from "@bis/db";

/** The route PR B serves (lib/mcp/auth.ts MCP_PATH; view.test.ts pins the two together without importing Clerk here). */
const MCP_ROUTE = "/api/mcp";

/** `<app origin>/api/mcp`; null when the app has no origin to build on, so the card says so rather than showing a path. */
export function mcpServerUrl(origin: string | null): string | null {
  return origin ? `${origin.replace(/\/+$/, "")}${MCP_ROUTE}` : null;
}

/** "Nov 19, 2:30 PM": a moment in the account's own zone, the way the owner line's switch card prints it. */
export function whenLabel(iso: string, locale: Locale, zone: string): string {
  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US",
    { timeZone: zone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(new Date(iso)).replace(/ /g, " ");
}

/** One read in words: who (never blank: provenance), which read, when. Kinds only, never what was read (D4). */
export function aiAppLogLine(row: AiAppLogRow, locale: Locale, zone: string): { who: string; what: string; when: string } {
  const lc: Locale = locale === "es" ? "es" : "en";
  return {
    who: row.who?.trim() ? row.who : t(m, "aiApps.log.someone", lc),
    what: t(m, `aiApps.log.${row.kind}`, lc),
    when: whenLabel(row.at, lc, zone),
  };
}

export type AiAppsUseRow = { accountId: string; businessName: string; role: string; state: "on" | "off" | "unknown" };

/** One row per business whose Owner or Staff this person is (D1: a Technician gets none). A switch that could not be
 *  read is "unknown", never "off": claiming a business has it off when we do not know would send a person to ask for
 *  something that may already be on. */
export function aiAppsUseRows(
  memberships: readonly MyMembership[], switches: ReadonlyMap<string, AiAppsSwitchState>,
): AiAppsUseRow[] {
  return memberships
    .filter((mb) => OWNER_LINE_ROLES.includes(mb.role))
    .map((mb) => {
      const sw = switches.get(mb.accountId);
      return { accountId: mb.accountId, businessName: mb.businessName, role: mb.role,
        state: sw === undefined ? "unknown" as const : sw.enabledAt !== null ? "on" as const : "off" as const };
    })
    .sort((a, b) => a.businessName.localeCompare(b.businessName) || a.accountId.localeCompare(b.accountId));
}
