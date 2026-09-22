import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The automation log (0046): one row per (account, source, subject), status
 * moving in place. Every writer is serviceDb() — the table grants
 * `authenticated` SELECT only — and every writer wraps the call as an
 * isolated leg (apps/web's hold-or-send.ts `record`): a log failure never
 * fails a send.
 */
export const AUTOMATION_LOG_SOURCES = [
  "reminders", "followups", "review_request", "no_show_nudge", "sms_reminder",
  "instant_reply", "weekly_report", "concierge", "voice",
  // Part B, ONE per recipe task (plan amendment B1) — never all four at once.
  // The moment a source is added, RELEASERS (passes/release-held.ts) and
  // SOURCE_TITLES (log-titles.ts) stop compiling, and that red IS the
  // registry's bookkeeping: it arrives in the same commit as the releaser and
  // the title that answer it. Four at once would be four errors an
  // implementer can silence with three `null`s. The SQL CHECK (0047) already
  // carries all thirteen; a TS constant NARROWER than the database's CHECK is
  // safe in the only direction that matters.
  "appointment_confirm",
  "referral_ask",
] as const;
export type AutomationLogSource = (typeof AUTOMATION_LOG_SOURCES)[number];
export type AutomationLogChannel = "sms" | "email" | "ai";
export type AutomationLogStatus = "sent" | "held" | "skipped" | "failed";

export type AutomationLogRow = {
  id: string; account_id: string;
  source: AutomationLogSource; channel: AutomationLogChannel;
  contact_id: string | null; subject_key: string;
  status: AutomationLogStatus; reason: string;
  held_until: string | null; payload: Record<string, unknown>;
  occurred_at: string;
};

const LOG_COLS =
  "id, account_id, source, channel, contact_id, subject_key, status, reason, held_until, payload, occurred_at";

export type AutomationLogWrite = {
  accountId: string; source: AutomationLogSource; channel: AutomationLogChannel;
  contactId: string | null; subjectKey: string; status: AutomationLogStatus;
  /** Client-readable. Empty for `sent`. */
  reason?: string;
  /** Required when status is `held`, forbidden otherwise (the CHECK agrees). */
  heldUntil?: string | null;
  /** What a release needs that the subject row cannot re-derive. Never rendered. */
  payload?: Record<string, unknown>;
};

/**
 * UPSERT on the subject key: the same subject written again REPLACES its
 * row — channel, contact_id, status, reason, held_until, payload, and
 * occurred_at all take the NEW write's values, none of the old row's. That
 * is the whole "one line per subject" contract, so a caller never has to
 * know whether a row exists. `occurred_at` is the moment of the latest
 * transition. Because contact_id is replaced too, a release that already
 * knows the contact must pass it again on every write for the same
 * subject — omit it on the second write and the history line loses its
 * name, even though the first write had it.
 */
export async function recordAutomationLog(db: SupabaseClient, w: AutomationLogWrite): Promise<void> {
  if ((w.status === "held") !== Boolean(w.heldUntil)) {
    throw new Error(`recordAutomationLog: status ${w.status} ${w.heldUntil ? "must not carry" : "needs"} heldUntil`);
  }
  const { error } = await db.from("automation_log").upsert({
    account_id: w.accountId, source: w.source, channel: w.channel, contact_id: w.contactId,
    subject_key: w.subjectKey, status: w.status, reason: w.reason ?? "",
    held_until: w.status === "held" ? w.heldUntil : null,
    payload: w.payload ?? {},
    occurred_at: new Date().toISOString(),
  }, { onConflict: "account_id,source,subject_key" });
  if (error) throw new Error(`recordAutomationLog failed: ${error.message}`);
}

/**
 * One row by its unique key (account, source, subject) — the read
 * `holdOrSend` (apps/web's hold-or-send.ts) makes before re-writing a held
 * row, so a subject re-encountered on every tick while still held under the
 * SAME window does not bump `occurred_at` and re-sort to the top of the
 * Activity page's history on every 15-minute tick. Null when no row exists
 * yet for this subject.
 */
export async function getAutomationLogEntry(
  db: SupabaseClient, accountId: string, source: AutomationLogSource, subjectKey: string,
): Promise<AutomationLogRow | null> {
  const { data, error } = await db.from("automation_log").select(LOG_COLS)
    .eq("account_id", accountId).eq("source", source).eq("subject_key", subjectKey).maybeSingle();
  if (error) throw new Error(`getAutomationLogEntry failed: ${error.message}`);
  return (data as AutomationLogRow | null) ?? null;
}

/** The release pass's queue: held rows whose time has come, oldest first. */
export async function listReleasableHolds(
  db: SupabaseClient, nowIso: string, limit = 200,
): Promise<AutomationLogRow[]> {
  const { data, error } = await db.from("automation_log").select(LOG_COLS)
    .eq("status", "held").lte("held_until", nowIso)
    .order("held_until", { ascending: true }).limit(limit);
  if (error) throw new Error(`listReleasableHolds failed: ${error.message}`);
  return (data ?? []) as AutomationLogRow[];
}

/**
 * Called by the quiet-hours SAVE: every held row of the account becomes due
 * for another look on the next tick, where holdOrSend re-evaluates it under
 * the NEW window (re-holding it if still quiet). Without this, turning
 * quiet hours off would leave tonight's texts waiting until the old 08:00.
 * Returns how many rows were bumped (the action logs it).
 */
export async function bumpHeldForAccount(db: SupabaseClient, accountId: string): Promise<number> {
  const { data, error } = await db.from("automation_log")
    .update({ held_until: new Date().toISOString() })
    .eq("account_id", accountId).eq("status", "held").select("id");
  if (error) throw new Error(`bumpHeldForAccount failed: ${error.message}`);
  return (data ?? []).length;
}

export type AutomationLogCursor = { occurredAt: string; id: string };
export type AutomationLogListRow = AutomationLogRow & { contact_name: string | null };

/**
 * Escapes a value for embedding inside a PostgREST `.or()` filter string —
 * the same rule contacts.ts's private `quoteFilterValue` uses (double-quote
 * the value, backslash-escape a literal `\` or `"` inside it, backslash
 * first so an input holding both round-trips either way). Not exported from
 * there — inlined here so this accessor is safe standing alone, not merely
 * safe because of what currently calls it.
 */
function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The history page, newest first, keyset on (occurred_at desc, id desc) so
 * two rows in one instant cannot skip across a page edge. Runs under the
 * CALLER's client (RLS) — never serviceDb() on the in-account surface.
 *
 * `before.occurredAt` is escaped with `quoteFilterValue` before it is
 * interpolated into a PostgREST `.or()` string — belt AND suspenders: the
 * page also validates it as a timestamp (parseTimeCursor) and the id as a
 * uuid (parseCursor) BEFORE it reaches here, but that is defence in depth,
 * not the only defence, since this function has no way to know its caller
 * did so.
 */
export async function listAutomationLog(
  db: SupabaseClient, accountId: string, opts: { limit: number; before?: AutomationLogCursor },
): Promise<AutomationLogListRow[]> {
  let q = db.from("automation_log")
    .select(`${LOG_COLS}, contacts(first_name, last_name)`)
    .eq("account_id", accountId);
  if (opts.before) {
    const at = quoteFilterValue(opts.before.occurredAt);
    q = q.or(
      `occurred_at.lt.${at},`
      + `and(occurred_at.eq.${at},id.lt.${opts.before.id})`,
    );
  }
  const { data, error } = await q
    .order("occurred_at", { ascending: false }).order("id", { ascending: false })
    .limit(opts.limit);
  if (error) throw new Error(`listAutomationLog failed: ${error.message}`);
  return ((data ?? []) as any[]).map((r) => {
    const { contacts, ...row } = r;
    const name = [contacts?.first_name, contacts?.last_name].filter(Boolean).join(" ").trim();
    return { ...(row as AutomationLogRow), contact_name: name || null };
  });
}

export type AutomationUsage = {
  textsSent: number; emailsSent: number; conversations: number; callsHandled: number;
  held: number; skipped: number;
  topHeldReason: string | null; topSkippedReason: string | null;
};

/** The most frequent non-empty string, ties broken alphabetically so the
 *  answer is stable between two renders of the same data. */
function topReason(reasons: string[]): string | null {
  const tally = new Map<string, number>();
  for (const r of reasons) if (r) tally.set(r, (tally.get(r) ?? 0) + 1);
  let best: string | null = null;
  for (const [reason, n] of tally) {
    if (best === null || n > tally.get(best)! || (n === tally.get(best)! && reason < best)) best = reason;
  }
  return best;
}

/**
 * "This month" in units. Six exact counts over the (account, occurred_at)
 * index — `head: true`, so no row travels — plus one bounded read of the
 * held/skipped reasons for the "most common" line. `[fromIso, toIso)`.
 */
export async function countAutomationUsage(
  db: SupabaseClient, accountId: string, fromIso: string, toIso: string,
): Promise<AutomationUsage> {
  const base = () => db.from("automation_log").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).gte("occurred_at", fromIso).lt("occurred_at", toIso);
  const count = async (apply: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const { count: n, error } = await apply(base());
    if (error) throw new Error(`countAutomationUsage failed: ${error.message}`);
    return n ?? 0;
  };
  const [textsSent, emailsSent, conversations, callsHandled, held, skipped] = await Promise.all([
    count((q) => q.eq("status", "sent").eq("channel", "sms")),
    count((q) => q.eq("status", "sent").eq("channel", "email")),
    count((q) => q.eq("status", "sent").eq("source", "concierge")),
    count((q) => q.eq("status", "sent").eq("source", "voice")),
    count((q) => q.eq("status", "held")),
    count((q) => q.eq("status", "skipped")),
  ]);
  const { data, error } = await db.from("automation_log").select("status, reason")
    .eq("account_id", accountId).gte("occurred_at", fromIso).lt("occurred_at", toIso)
    .in("status", ["held", "skipped"]).limit(1000);
  if (error) throw new Error(`countAutomationUsage reasons failed: ${error.message}`);
  const rows = (data ?? []) as { status: "held" | "skipped"; reason: string }[];
  return {
    textsSent, emailsSent, conversations, callsHandled, held, skipped,
    topHeldReason: topReason(rows.filter((r) => r.status === "held").map((r) => r.reason)),
    topSkippedReason: topReason(rows.filter((r) => r.status === "skipped").map((r) => r.reason)),
  };
}
