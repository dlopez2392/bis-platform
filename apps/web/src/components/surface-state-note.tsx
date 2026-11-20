import Link from "next/link";
import { DotPill } from "@/components/dot-pill";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/messages";
import type { Capability, CapabilityGrade, CapabilityStateName } from "@/lib/surfaces/capabilities";

/**
 * F-088 PR 2: one capability's honest state in words (principle 6, `docs/crm-features.md` 2519-2523): live,
 * needs setup, waiting, in a bigger plan, or absent. Dot + word (rule 3), one sentence, at most one quiet
 * link. No padlock, no upgrade card, no modal (plan 6.7 row 6) and no button: this is a note inside a working
 * screen, so it can never be a second primary (rule 8). Tokens only; the dot's tone is the state's, the
 * sentence stays on text tokens.
 */
export const TONE: Record<CapabilityStateName, { chip: string; dot: string }> = {
  live: { chip: "bg-[var(--good-bg)] text-[var(--text-1)]", dot: "bg-[var(--good)]" },
  needs_setup: { chip: "bg-[var(--warn-bg)] text-[var(--text-1)]", dot: "bg-[var(--warn)]" },
  waiting: { chip: "bg-[var(--accent-dim)] text-[var(--accent)]", dot: "bg-[var(--accent)]" },
  bigger_plan: { chip: "bg-[var(--surface-2)] text-[var(--text-2)]", dot: "bg-[var(--text-2)]" },
  // The word is on --text-2 (--text-3 on --surface-2 is 3.1:1 in light, under AA); only the dot is --text-3.
  absent: { chip: "bg-[var(--surface-2)] text-[var(--text-2)]", dot: "bg-[var(--text-3)]" },
};

export type SurfaceNoteLink = { href: string; label: string };

export function SurfaceStateNote({
  state, sentence, word, link, locale, pseudo = false, align = "center",
}: {
  state: CapabilityStateName;
  sentence: string;
  /** undefined: the state's own word; a string: a reason-level word in its place ("Testing" on a live
   *  state); null: no pill at all (a read that failed says nothing about the state). */
  word?: string | null;
  link?: SurfaceNoteLink;
  locale: Locale;
  pseudo?: boolean;
  /** "center" (default) is the empty-state note; "start" is a row inside a card (Plan and billing). */
  align?: "center" | "start";
}) {
  const tr = makeTr(locale, pseudo);
  const start = align === "start";
  return (
    <div data-surface-state={state} lang={locale} className={start ? "flex flex-col items-start gap-2" : "flex flex-col items-center gap-2 text-center"}>
      {word === null ? null : (
        <DotPill label={word ?? tr.text(`surface.state.${state}`)} chip={TONE[state].chip} dot={TONE[state].dot} />
      )}
      <p className={start ? "max-w-prose text-sm text-muted-foreground" : "max-w-sm text-sm text-muted-foreground"}>{sentence}</p>
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

/** Who is reading decides two things only: the words (a client is told BIS is on it, the agency is pointed at
 *  the page that fixes it) and the plan link (an Owner's Billing page; Staff and Technicians cannot open it,
 *  so they get the sentence alone). */
export type SurfaceReader = { isAgency: boolean; role: "owner" | "staff" | "technician" | null };

/** The sentence for Sofía's grade, as the message key to read, so the caller's `tr` decides language and pseudo. */
export function sofiaSentenceKey(grade: CapabilityGrade, reader: SurfaceReader): MessageKey {
  const { reason } = grade;
  switch (reason) {
    case "sofia_off": case "no_number": case "no_trade":
      return reader.isAgency ? (`surface.sofia.${reason}.agency` as MessageKey) : "surface.sofia.setting_up";
    case "plan_no_voice": case "sofia_testing": case "billing_paused": case "billing_ended": case "calls_forwarded":
      return (reader.isAgency ? `surface.sofia.${reason}.agency` : `surface.sofia.${reason}`) as MessageKey;
    case "sofia_answering": case "read_failed": case "crm_only_trade":
      return `surface.sofia.${reason}` as MessageKey;
    default:
      // Texting and chat reasons are not Sofía's; an unexpected one reads as "could not check", never as live.
      return "surface.sofia.read_failed";
  }
}

/** The pill's own word where the state's would mislead: a testing number is "Testing", not "Live"; forwarded
 *  calls are "Calls forwarded", not "Needs setup"; a failed read has no pill (null). undefined: the state's word. */
export function sofiaPill(grade: CapabilityGrade, locale: Locale, pseudo = false): string | null | undefined {
  const tr = makeTr(locale, pseudo);
  if (grade.reason === "read_failed") return null;
  if (grade.reason === "sofia_testing") return tr.text("surface.pill.testing");
  if (grade.reason === "calls_forwarded") return tr.text("surface.pill.calls_forwarded");
  return undefined;
}

/** The one link a Sofía note may carry: the Billing page for an Owner of the business when it is a plan matter,
 *  Settings (the trade) or Voice for the agency when setup is theirs. Anything else carries none (absent
 *  promises nothing; a failed read has nothing to open). */
export function sofiaLink(
  grade: CapabilityGrade, reader: SurfaceReader, accountId: string, locale: Locale, pseudo = false,
): SurfaceNoteLink | undefined {
  const tr = makeTr(locale, pseudo);
  const base = `/dashboard/accounts/${accountId}`;
  if (grade.state === "bigger_plan" && !reader.isAgency && reader.role === "owner") {
    // Labelled with the page's own nav title so the label always matches where it lands (PR 3 renames the key).
    return { href: `${base}/billing`, label: tr.text("nav.billing") };
  }
  if (grade.state === "needs_setup" && reader.isAgency) {
    if (grade.reason === "no_trade") return { href: `${base}/settings`, label: tr.text("nav.settings") };
    if (grade.reason !== "read_failed") return { href: `${base}/voice`, label: tr.text("surface.link.voice") };
  }
  return undefined;
}

/** F-088 PR 3: the website chat's sentence, as a message key (same rule as Sofía's: the client reads that BIS is
 *  setting it up, the agency reads where to fix it). An unexpected reason reads as "could not check", never live. */
export function webChatSentenceKey(grade: CapabilityGrade, reader: SurfaceReader): MessageKey {
  const { reason } = grade;
  switch (reason) {
    case "chat_off":
      return reader.isAgency ? "surface.chat.chat_off.agency" : "surface.chat.setting_up";
    case "no_trade":
      return reader.isAgency ? "surface.chat.no_trade.agency" : "surface.chat.setting_up";
    case "plan_no_chat": case "billing_paused": case "billing_ended":
      return (reader.isAgency ? `surface.chat.${reason}.agency` : `surface.chat.${reason}`) as MessageKey;
    case "chat_open": case "crm_only_trade": case "read_failed":
      return `surface.chat.${reason}` as MessageKey;
    default:
      return "surface.chat.read_failed";
  }
}

/** Texting's sentence. Live says it is set up, never that texts go out (a paused account's texts are blocked). */
export function textingSentenceKey(grade: CapabilityGrade, reader: SurfaceReader): MessageKey {
  switch (grade.reason) {
    case "texting_registered": case "carrier_review": case "read_failed":
      return `surface.texting.${grade.reason}` as MessageKey;
    case "not_registered":
      return reader.isAgency ? "surface.texting.not_registered.agency" : "surface.texting.setting_up";
    case "registration_rejected":
      return reader.isAgency ? "surface.texting.registration_rejected.agency" : "surface.texting.registration_rejected";
    default:
      return "surface.texting.read_failed";
  }
}

/** One capability's sentence key: Sofía's, the chat's or texting's. */
export function capabilitySentenceKey(cap: Capability, grade: CapabilityGrade, reader: SurfaceReader): MessageKey {
  if (cap === "sofia") return sofiaSentenceKey(grade, reader);
  return cap === "webChat" ? webChatSentenceKey(grade, reader) : textingSentenceKey(grade, reader);
}

/** The pill word for a row on Plan and billing: Sofía's own overrides, no pill for a failed read, else the state's. */
export function capabilityPill(cap: Capability, grade: CapabilityGrade, locale: Locale, pseudo = false): string | null | undefined {
  if (cap === "sofia") return sofiaPill(grade, locale, pseudo);
  return grade.reason === "read_failed" ? null : undefined;
}

/** The one link a row on Plan and billing may carry. Never the Billing page itself (the reader is on it); only the
 *  agency gets one, to the page that fixes the setup: Voice for Sofía and the chat, the Checklist for texting. */
export function capabilityLink(
  cap: Capability, grade: CapabilityGrade, reader: SurfaceReader, accountId: string, locale: Locale, pseudo = false,
): SurfaceNoteLink | undefined {
  const tr = makeTr(locale, pseudo);
  const base = `/dashboard/accounts/${accountId}`;
  if (!reader.isAgency || grade.state !== "needs_setup" || grade.reason === "read_failed") return undefined;
  if (grade.reason === "no_trade") return { href: `${base}/settings`, label: tr.text("nav.settings") };
  if (cap === "texting") return { href: `${base}/checklist#a2p-registration`, label: tr.text("surface.link.checklist") };
  return { href: `${base}/voice`, label: tr.text("surface.link.voice") };
}
