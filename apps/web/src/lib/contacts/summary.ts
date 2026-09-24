import type { ContactSummary } from "@/app/api/accounts/[accountId]/contacts/[contactId]/summary/route";
import type { OptOutZone } from "@/lib/contacts/marketing-optout";

/**
 * What the drawer can rely on after parsing the summary GET's body. The
 * route's `ContactSummary` stays the server's exact contract; this is the
 * same shape with `zone` possibly undefined, because the drawer tolerates a
 * missing zone (a server from before #124 sent none) rather than refusing.
 */
export type ParsedContactSummary = Omit<ContactSummary, "zone"> & { zone: OptOutZone | undefined };

type Kind = ContactSummary["recent"][number]["kind"];

/** Every kind this bundle knows. A `Record` over the union, so adding a kind
 *  to the route's type without adding it here fails typecheck; otherwise the
 *  parser would silently drop the new kind from every drawer built from the
 *  same commit. It cannot help a tab whose bundle predates a server that added
 *  one. That tab drops those items and still shows the rest of the summary. */
const KINDS: Record<Kind, true> = { call: true, note: true, submission: true, message: true, opportunity: true };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isKind(v: unknown): v is Kind {
  // `=== true`, not `in`: "constructor" or "toString" are properties of any
  // object literal and must not pass for a kind.
  return typeof v === "string" && (KINDS as Record<string, unknown>)[v] === true;
}

/** Whether this browser's Intl can format in `zone`. `formatDateInZone`
 *  THROWS on a name it does not know, and it runs inside the drawer's render
 *  for the "Off since" line; the server's Intl and an older browser's need
 *  not agree on the list. */
function usableZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function parseZone(v: unknown): OptOutZone | undefined {
  if (!isRecord(v)) return undefined;
  if (typeof v.zone !== "string" || typeof v.guessed !== "boolean" || typeof v.label !== "string") return undefined;
  if (!usableZone(v.zone)) return undefined;
  return { zone: v.zone, guessed: v.guessed, label: v.label };
}

/**
 * The contact drawer's summary body, checked rather than cast. The body comes
 * from whatever server answered — possibly an older or newer one than this
 * tab's bundle — and the drawer renders inside the dashboard's only error
 * boundary, so a throw during render over one missing field replaces the
 * whole dashboard.
 *
 * - `tags`, `recent` and `marketing_email_opted_out_at` are REQUIRED: any of
 *   them missing or the wrong shape answers null, and the drawer shows its
 *   "couldn't load" state. The stamp is not defaulted to null: that would
 *   show an opted-out contact as unticked, and one tick would then write.
 * - A `recent` item that is not an object, or whose `label` or `at` is not a
 *   string, is a malformed body: null. Those two are what the drawer renders.
 * - A `recent` item whose `kind` this bundle does not know is DROPPED, and the
 *   rest of the summary still loads. The drawer never reads `kind`, and the
 *   likely stale-tab case after a deploy is an OLD bundle talking to a NEW
 *   server. If the server adds a kind, refusing it would show "couldn't load"
 *   in every open tab for each contact with such an item. The cost: the
 *   dropped items are missing from that tab's "Recent" list until a reload.
 * - `zone` is TOLERATED: missing or malformed (or a zone this browser cannot
 *   format in) becomes undefined, and the switch leaves out its "Off since"
 *   line (`optOutSinceLine`, #124).
 * - Keys it does not know are ignored and not carried through.
 *
 * Returns null rather than throwing (unlike web-analytics.ts's parsers): the
 * caller has a designed state for "no", and nothing to log.
 */
export function parseContactSummary(json: unknown): ParsedContactSummary | null {
  if (!isRecord(json)) return null;

  if (!Array.isArray(json.tags)) return null;
  const tags: ParsedContactSummary["tags"] = [];
  for (const t of json.tags) {
    if (!isRecord(t) || typeof t.id !== "string" || typeof t.name !== "string") return null;
    tags.push({ id: t.id, name: t.name });
  }

  if (!Array.isArray(json.recent)) return null;
  const recent: ParsedContactSummary["recent"] = [];
  for (const r of json.recent) {
    // Malformed first: an item the drawer would render (label, at) has to
    // be renderable whatever its kind says.
    if (!isRecord(r) || typeof r.label !== "string" || typeof r.at !== "string") return null;
    // Then dropped, not refused: a kind this bundle does not know.
    if (!isKind(r.kind)) continue;
    recent.push({ kind: r.kind, label: r.label, at: r.at });
  }

  const stamp = json.marketing_email_opted_out_at;
  if (stamp !== null && typeof stamp !== "string") return null;

  return { tags, recent, marketing_email_opted_out_at: stamp, zone: parseZone(json.zone) };
}

/** The drawer's load outcome for one contact. */
export type SummaryLoad =
  | { status: "error" }
  | { status: "ready"; summary: ParsedContactSummary; nowMs: number };

/**
 * The drawer's fetch `.then` body, pure: a non-OK response is the error state
 * and its body is never read; an OK one is parsed, and a body the parser
 * refuses is the error state too. `nowMs` is the caller's — read in the
 * fetch callback, never here, so this stays free of `Date.now()`. A body that
 * is not JSON rejects, and the drawer's `.catch` turns that into the error
 * state as before.
 */
export async function summaryLoadFrom(
  res: { ok: boolean; json: () => Promise<unknown> }, nowMs: number,
): Promise<SummaryLoad> {
  if (!res.ok) return { status: "error" };
  const summary = parseContactSummary(await res.json());
  return summary === null ? { status: "error" } : { status: "ready", summary, nowMs };
}
