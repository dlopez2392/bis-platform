import type { TimelineEntry } from "@bis/db";
import { splitSummaryBlocks } from "@/lib/voice/summary-blocks";
import type { AuthorMarkView } from "./author-mark";
import type { TimelineRow, TimelineStatus } from "./timeline-rows";

/**
 * One row of the list drawer's Recent (S-03 part 3 C6, §9.4), built on the server from the record
 * page's own `timelineRows`, and JSON only: the browser never receives a whole TimelineEntry (call
 * summaries, form answers) to throw most of it away. No day separator, no per-row link, no Done.
 */
export type RecentRowView = {
  key: string; kind: TimelineEntry["kind"]; mark: AuthorMarkView; verb: string; status: TimelineStatus | null;
  detail: string | null; time: string; dateTime: string;
  /** At most two lines under the head. `lang`: "" for typed text, "en" for a call summary's prose. */
  excerpt: { text: string; lang: "" | "en"; done: boolean } | null;
};

const typed = (text: string | null | undefined, done = false): RecentRowView["excerpt"] =>
  text && text.trim() ? { text, lang: "", done } : null;

/** The group timeline's per-kind body rules (`groups/[groupId]/group-timeline.tsx:92-172`), as text. */
function excerptOf(e: TimelineEntry): RecentRowView["excerpt"] {
  switch (e.kind) {
    case "note": return typed(e.note.body);
    case "task": return typed(e.task.title, Boolean(e.task.completed_at));
    case "deal": return null;
    case "submission": return null;
    case "message": return typed(e.message.subject?.trim() ? e.message.subject : e.message.body);
    case "booking": return typed(e.booking.note);
    case "call": {
      // The reason as typed; else only the summary's English prose; nothing when it carries a MISMATCH.
      const reason = e.call.reason?.trim() || null;
      if (reason) return { text: reason, lang: "", done: false };
      const blocks = splitSummaryBlocks(e.call.summary);
      if (blocks.some((b) => b.kind === "mismatch")) return null;
      const prose = blocks.filter((b) => b.kind === "prose").map((b) => b.text).join(" ");
      return prose ? { text: prose, lang: "en", done: false } : null;
    }
  }
}

export function recentRowsView(rows: readonly TimelineRow[]): RecentRowView[] {
  return rows.map((r) => ({
    key: r.key, kind: r.entry.kind, mark: r.mark, verb: r.verb, status: r.status, detail: r.detail,
    time: r.time, dateTime: r.entry.at, excerpt: excerptOf(r.entry),
  }));
}
