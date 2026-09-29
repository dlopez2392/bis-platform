import { m } from "@/lib/messages";
import { formatDateInZone } from "@/lib/format";
import type { ToastLike } from "@/lib/ui/guarded-run";
import type { TextsHow, TextsView } from "./texts-view";
import type { TextsActionResult, TextsUndo } from "./staff-actions";

/**
 * The Texts row's behaviour, minus React (spec §6): its words, its read, and
 * how an action runs (DESIGN.md rule 6: at once, the answer shown, Undo on
 * the toast). Client-safe: TYPE-ONLY imports of the server modules.
 */
export type TextsLoad =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; view: TextsView; zone: string; phone: string | null };

/** Dot + word (rule 3), token classes only. On hold is a warning: staff must decide it. */
export const TEXTS_TREATMENT = {
  allowed: { label: m["contact.texts.allowed"], dot: "bg-success", chip: "border-success/30 bg-success/10 text-foreground" },
  stopped: { label: m["contact.texts.stopped"], dot: "bg-destructive", chip: "border-destructive/25 bg-transparent text-muted-foreground" },
  held: { label: m["contact.texts.held"], dot: "bg-warning", chip: "border-warning/30 bg-warning/10 text-foreground" },
} as const;

const QUOTE = 60;
function quote(s: string): string {
  const c = Array.from(s);
  return c.length <= QUOTE ? s : `${c.slice(0, QUOTE - 1).join("")}…`;
}

export function howLine(how: TextsHow): string {
  switch (how.kind) {
    case "keyword": return m["contact.texts.how.keyword"].replace("{word}", () => how.word);
    case "free_text": {
      const excerpt = quote(how.excerpt ?? "…");
      const by = how.by;
      return by
        ? m["contact.texts.how.freeTextBy"].replace("{excerpt}", () => excerpt).replace("{name}", () => by)
        : m["contact.texts.how.freeText"].replace("{excerpt}", () => excerpt);
    }
    case "staff": return m["contact.texts.how.staff"];
    case "carrier": return m["contact.texts.how.carrier"];
    case "unsubscribe_link": return m["contact.texts.how.unsubscribeLink"];
  }
}

/** The line under the status, or null. A date that will not format drops the date, never throws in a render. */
export function textsLine(view: TextsView, zone: string): string | null {
  if (view.kind === "stopped") {
    let since: string | null = null;
    try {
      since = m["contact.texts.since"].replace("{date}", formatDateInZone(view.since, zone));
    } catch {
      since = null;
    }
    const how = howLine(view.how);
    return since ? `${since} · ${how}` : how;
  }
  if (view.kind === "held") {
    const excerpt = view.excerpt;
    return excerpt ? m["contact.texts.heldLine"].replace("{excerpt}", () => quote(excerpt)) : m["compose.smsHeld"];
  }
  return null;
}

const KINDS = new Set(["no_number", "check_number", "allowed", "stopped", "held"]);

/** The drawer's read, parsed, never cast: a body this bundle cannot trust is the error state. */
export function parseTextsResponse(json: unknown): { view: TextsView; zone: string; phone: string | null } | null {
  const j = json as { view?: Record<string, unknown>; zone?: unknown; phone?: unknown } | null;
  if (!j || typeof j !== "object" || typeof j.zone !== "string" || !j.view || !KINDS.has(j.view.kind as string)) return null;
  const v = j.view;
  if ((v.kind === "stopped" || v.kind === "held") && (typeof v.eventId !== "string" || typeof v.since !== "string")) return null;
  if (v.kind === "stopped" && (typeof v.how !== "object" || v.how === null || typeof v.canResume !== "boolean")) return null;
  if (j.phone !== null && typeof j.phone !== "string") return null;
  return { view: v as TextsView, zone: j.zone, phone: (j.phone as string | null) ?? null };
}

export async function textsLoadFrom(res: { ok: boolean; json: () => Promise<unknown> }): Promise<TextsLoad> {
  if (!res.ok) return { status: "error" };
  const parsed = parseTextsResponse(await res.json());
  return parsed ? { status: "ready", ...parsed } : { status: "error" };
}

export type TextsRunner = (work: () => Promise<void>) => boolean | Promise<void>;

async function attempt(
  act: () => Promise<TextsActionResult>, show: (v: TextsView) => void, toast: ToastLike,
): Promise<Extract<TextsActionResult, { ok: true }> | null> {
  let r: TextsActionResult;
  try {
    r = await act();
  } catch {
    // A stale tab posting a server-action id from before a redeploy rejects.
    toast.error(m["inline.crashed"]);
    return null;
  }
  if (!r.ok) {
    if (r.view) show(r.view);
    toast.error(r.error);
    return null;
  }
  show(r.view);
  return r;
}

/** One action. Answers whether it went through. Undo runs through the row's own guard; a refused Undo says so. */
export async function runTextsAction(
  act: () => Promise<TextsActionResult>, show: (v: TextsView) => void, toast: ToastLike,
  o: { success: string; undo?: (u: TextsUndo) => Promise<TextsActionResult>; run?: TextsRunner; onChanged?: () => void },
): Promise<boolean> {
  const r = await attempt(act, show, toast);
  if (!r) return false;
  o.onChanged?.();
  const undo = o.undo;
  const token = r.undo;
  if (!undo || !token) {
    toast.success(o.success);
    return true;
  }
  toast.success(o.success, {
    action: {
      label: m["common.undo"],
      onClick: () => {
        const run = o.run ?? ((work) => work());
        const ran = run(async () => {
          if (await attempt(() => undo(token), show, toast)) o.onChanged?.();
        });
        if (ran === false) toast.error(m["contact.texts.undoBusy"]);
        return ran;
      },
    },
  });
  return true;
}
