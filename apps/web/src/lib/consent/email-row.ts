import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { formatDateInZone } from "@/lib/format";
import type { ToastLike } from "@/lib/ui/guarded-run";
import type { EmailHow, EmailView } from "./email-view";
import type { EmailActionResult, EmailUndo } from "./email-staff-actions";

/**
 * The Email row's behaviour, minus React (spec §6, consent PR-3): its words,
 * its read, and how an action runs (DESIGN.md rule 6: at once, the answer
 * shown, Undo on the toast). Client-safe: TYPE-ONLY imports of the server
 * modules. The Texts row's shape (texts-row.ts), for the email channel.
 */
export type EmailLoad =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; view: EmailView; zone: string };

/** Dot + word (rule 3), the Texts row's token classes. */
export const EMAIL_TREATMENT = {
  allowed: { label: m["contact.email.allowed"], dot: "bg-success", chip: "border-success/30 bg-success/10 text-foreground" },
  stopped: { label: m["contact.email.stopped"], dot: "bg-destructive", chip: "border-destructive/25 bg-transparent text-muted-foreground" },
} as const;

const EMAIL_WORD = { allowed: "contact.email.allowed", stopped: "contact.email.stopped" } as const satisfies Record<keyof typeof EMAIL_TREATMENT, MessageKey>;

/** The status's word in the reader's language (rule 3: the dot never stands alone). */
export function emailStatusWord(kind: keyof typeof EMAIL_TREATMENT, locale: Locale): string {
  return t(m, EMAIL_WORD[kind], locale);
}

export function emailHowLine(how: EmailHow, locale: Locale = "en"): string {
  switch (how.kind) {
    case "unsubscribe_link": return t(m, "contact.email.how.unsubscribeLink", locale);
    case "staff": return t(m, "contact.email.how.staff", locale);
    case "backfill_0049": return t(m, "contact.email.how.backfill0049", locale);
    case "bounced": return t(m, "contact.email.how.bounced", locale);
    case "complained": return t(m, "contact.email.how.complained", locale);
    case "reply": return t(m, "contact.email.how.reply", locale);
  }
}

/**
 * D-016 item 4: what the row says in place of a Resume button, when
 * `canResume` is false. A hard bounce or a complaint is the provider's own
 * fact about the address, not a link the customer clicked — "They can
 * resubscribe from the unsubscribe link in any email from you" is simply
 * untrue once an address is suppressed (no more emails go out carrying that
 * link), so each gets its own 7am-plain explanation of what actually fixes
 * it. Every other non-resumable how keeps the generic line.
 */
export function noResumeLine(how: EmailHow, locale: Locale = "en"): string {
  switch (how.kind) {
    case "bounced": return t(m, "contact.email.bouncedExplain", locale);
    case "complained": return t(m, "contact.email.complainedExplain", locale);
    // Fix round 1 (the execution note): within the 7-day window the Undo is the way out (the
    // row still says the generic line, same as unsubscribe_link); past it, only the customer's
    // own resubscribe can lift it.
    case "reply": return how.expired ? t(m, "contact.email.replyExpiredExplain", locale) : t(m, "contact.email.customerOnly", locale);
    default: return t(m, "contact.email.customerOnly", locale);
  }
}

/** The line under the status, or null. A date that will not format drops the date, never throws in a render. */
export function emailLine(view: EmailView, zone: string, locale: Locale = "en"): string | null {
  if (view.kind !== "stopped") return null;
  let since: string | null = null;
  try {
    since = t(m, "contact.email.since", locale, { date: formatDateInZone(view.since, zone, locale) });
  } catch {
    since = null;
  }
  const how = emailHowLine(view.how, locale);
  return since ? `${since} · ${how}` : how;
}

export function parseEmailResponse(json: unknown): { view: EmailView; zone: string } | null {
  const j = json as { view?: Record<string, unknown>; zone?: unknown } | null;
  if (!j || typeof j !== "object" || typeof j.zone !== "string" || !j.view) return null;
  const v = j.view;
  if (v.kind === "no_email") return { view: { kind: "no_email" }, zone: j.zone };
  if (v.kind === "allowed" && (v.newestId === null || typeof v.newestId === "string")) return { view: v as EmailView, zone: j.zone };
  if (v.kind === "stopped" && typeof v.eventId === "string" && typeof v.since === "string"
    && typeof v.how === "object" && v.how !== null && typeof v.canResume === "boolean") {
    // Fix round 1: a "reply" how carries its own boolean — refuse a malformed one rather than
    // let a later render crash or silently say the wrong thing.
    const how = v.how as { kind?: unknown; expired?: unknown };
    if (how.kind === "reply" && typeof how.expired !== "boolean") return null;
    return { view: v as EmailView, zone: j.zone };
  }
  return null;
}

export async function emailLoadFrom(res: { ok: boolean; json: () => Promise<unknown> }): Promise<EmailLoad> {
  if (!res.ok) return { status: "error" };
  const parsed = parseEmailResponse(await res.json());
  return parsed ? { status: "ready", ...parsed } : { status: "error" };
}

export type EmailRunner = (work: () => Promise<void>) => boolean | Promise<void>;

async function attempt(
  act: () => Promise<EmailActionResult>, show: (v: EmailView) => void, toast: ToastLike, locale: Locale,
): Promise<Extract<EmailActionResult, { ok: true }> | null> {
  let r: EmailActionResult;
  try {
    r = await act();
  } catch {
    toast.error(t(m, "inline.crashed", locale));
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

/** One action. Answers whether it went through. Undo runs through the row's own guard. */
export async function runEmailAction(
  act: () => Promise<EmailActionResult>, show: (v: EmailView) => void, toast: ToastLike,
  o: { success: string; undo?: (u: EmailUndo) => Promise<EmailActionResult>; run?: EmailRunner; onChanged?: () => void; locale?: Locale },
): Promise<boolean> {
  const locale = o.locale ?? "en";
  const r = await attempt(act, show, toast, locale);
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
      label: t(m, "common.undo", locale),
      onClick: () => {
        const run = o.run ?? ((work) => work());
        const ran = run(async () => {
          if (await attempt(() => undo(token), show, toast, locale)) o.onChanged?.();
        });
        if (ran === false) toast.error(t(m, "contact.email.undoBusy", locale));
        return ran;
      },
    },
  });
  return true;
}
