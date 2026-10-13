import type { ContactNextUp, GroupNextUp } from "@bis/db";
import { formatDateInZone } from "@/lib/format";
import { dayKeyIn } from "./record-facts";
import type { Tr } from "./copy";

/** `who`: the member the row is for, on the group page (S-03 part 2b, C9); null on the contact page. */
export type NextUpRow =
  | { kind: "booking"; id: string; label: string; who: string | null }
  | { kind: "task"; id: string; title: string; detail: string; overdue: boolean; who: string | null };
export type NextUpView = { rows: NextUpRow[]; undated: string | null };

/**
 * Up to three rows, soonest first (spec §9.3). An overdue To-do's due date is in the past, so it
 * sorts first on its own. Days are the ACCOUNT's (a due date is midnight there, D-006).
 */
export function nextUpView(
  data: ContactNextUp | GroupNextUp, ctx: { zone: string; now: Date; tr: Tr; names?: Readonly<Record<string, string>> }, limit = 3,
): NextUpView {
  const { zone, now, tr } = ctx;
  // A To-do carries its member only in the group form; a booking always does (booking.ts).
  const who = (row: object): string | null => {
    const id = "contact_id" in row && typeof row.contact_id === "string" ? row.contact_id : null;
    return ctx.names && id !== null && Object.hasOwn(ctx.names, id) ? ctx.names[id]! : null;
  };
  const tag = tr.locale === "es" ? "es-US" : "en-US";
  const today = dayKeyIn(now, zone);
  const dated = [
    ...data.datedTasks.map((t) => ({ at: t.due_at, rank: 0, row: (): NextUpRow => {
      const day = dayKeyIn(new Date(t.due_at), zone);
      const date = formatDateInZone(t.due_at, zone, tr.locale);
      const overdue = day < today;
      const detail = overdue ? tr.text("record.nextUp.overdue", { date })
        : day === today ? tr.text("record.nextUp.dueToday") : tr.text("record.nextUp.due", { date });
      return { kind: "task", id: t.id, title: t.title, detail, overdue, who: who(t) };
    } })),
    ...data.bookings.map((b) => ({ at: b.starts_at, rank: 1, row: (): NextUpRow => {
      const instant = new Date(b.starts_at);
      const day = new Intl.DateTimeFormat(tag, { timeZone: zone, weekday: "short", month: "short", day: "numeric" }).format(instant);
      const time = new Intl.DateTimeFormat(tag, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(instant);
      return { kind: "booking", id: b.id, label: tr.text("record.nextUp.booking", { when: `${day} · ${time}` }), who: who(b) };
    } })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.rank - b.rank);
  const rows = dated.slice(0, limit).map((d) => d.row());
  // "N more" only reads right under rows; alone, the line says how many have no date.
  const undatedKey = rows.length > 0 ? "record.nextUp.undated" : "record.nextUp.undatedOnly";
  return { rows, undated: data.undatedCount > 0 ? tr.count(undatedKey, data.undatedCount) : null };
}
