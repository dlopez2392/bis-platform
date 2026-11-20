import Link from "next/link";
import { DotPill } from "@/components/dot-pill";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/messages";
import type { CapabilityGrade, CapabilityStateName } from "@/lib/surfaces/capabilities";

/**
 * F-088 PR 2: one capability's honest state in words (principle 6, `docs/crm-features.md` 2519-2523): live,
 * needs setup, waiting, in a bigger plan, or absent. Dot + word (rule 3), one sentence, at most one quiet
 * link. No padlock, no upgrade card, no modal (plan 6.7 row 6) and no button: this is a note inside a working
 * screen, so it can never be a second primary (rule 8). Tokens only; the dot's tone is the state's, the
 * sentence stays on text tokens.
 */
const TONE: Record<CapabilityStateName, { chip: string; dot: string }> = {
  live: { chip: "bg-[var(--good-bg)] text-[var(--good)]", dot: "bg-[var(--good)]" },
  needs_setup: { chip: "bg-[var(--warn-bg)] text-[var(--warn)]", dot: "bg-[var(--warn)]" },
  waiting: { chip: "bg-[var(--accent-dim)] text-[var(--accent)]", dot: "bg-[var(--accent)]" },
  bigger_plan: { chip: "bg-[var(--surface-2)] text-[var(--text-2)]", dot: "bg-[var(--text-2)]" },
  absent: { chip: "bg-[var(--surface-2)] text-[var(--text-3)]", dot: "bg-[var(--text-3)]" },
};

export type SurfaceNoteLink = { href: string; label: string };

export function SurfaceStateNote({
  state, sentence, link, locale, pseudo = false,
}: {
  state: CapabilityStateName;
  sentence: string;
  link?: SurfaceNoteLink;
  locale: Locale;
  pseudo?: boolean;
}) {
  const tr = makeTr(locale, pseudo);
  return (
    <div data-surface-state={state} lang={locale} className="flex flex-col items-center gap-2 text-center">
      <DotPill label={tr.text(`surface.state.${state}`)} chip={TONE[state].chip} dot={TONE[state].dot} />
      <p className="max-w-sm text-sm text-muted-foreground">{sentence}</p>
      {link ? (
        <Link
          href={link.href}
          className="rounded-[var(--radius-ctl)] text-sm text-[var(--accent)] underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {link.label}
        </Link>
      ) : null}
    </div>
  );
}

/** Who is reading decides two things only: the needs-setup words (a client is told BIS is on it, the agency is
 *  pointed at the Voice page) and the plan link (an Owner's Plan and billing page; Staff and Technicians cannot
 *  open it, so they get the sentence alone). */
export type SurfaceReader = { isAgency: boolean; role: "owner" | "staff" | "technician" | null };

/** The sentence for Sofía's grade, as the message key to read, so the caller's `tr` decides language and pseudo. */
export function sofiaSentenceKey(grade: CapabilityGrade, reader: SurfaceReader): MessageKey {
  const { reason } = grade;
  switch (reason) {
    case "sofia_off": case "no_number": case "no_trade":
      return reader.isAgency ? (`surface.sofia.${reason}.agency` as MessageKey) : "surface.sofia.setting_up";
    case "plan_no_voice":
      return reader.isAgency ? "surface.sofia.plan_no_voice.agency" : "surface.sofia.plan_no_voice";
    case "sofia_answering": case "sofia_testing": case "read_failed": case "billing_paused": case "crm_only_trade":
      return `surface.sofia.${reason}` as MessageKey;
    default:
      // Texting and chat reasons are not Sofía's; an unexpected one reads as "could not check", never as live.
      return "surface.sofia.read_failed";
  }
}

/** The one link a Sofía note may carry: Plan and billing for an Owner of the business when it is a plan matter,
 *  the Voice page for the agency when setup is theirs. Anything else carries none (absent promises nothing). */
export function sofiaLink(
  grade: CapabilityGrade, reader: SurfaceReader, accountId: string, locale: Locale, pseudo = false,
): SurfaceNoteLink | undefined {
  const tr = makeTr(locale, pseudo);
  const base = `/dashboard/accounts/${accountId}`;
  if (grade.state === "bigger_plan" && !reader.isAgency && reader.role === "owner") {
    return { href: `${base}/billing`, label: tr.text("surface.link.billing") };
  }
  if (grade.state === "needs_setup" && reader.isAgency && grade.reason !== "read_failed") {
    return { href: `${base}/voice`, label: tr.text("surface.link.voice") };
  }
  return undefined;
}
