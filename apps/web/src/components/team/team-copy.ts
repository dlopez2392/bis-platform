import type { AccountRole, PersonLanguage } from "@bis/db";
import type { TeamError } from "@/app/(dashboard)/dashboard/accounts/[accountId]/team/actions";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The Team card's words (spec §8), with no React and no I/O.
 *
 * Who is looking changes two sentences: the agency is never on the team
 * list (plan deviation 6), so "Just you so far" would be false for it, and
 * the agency is the one that raises the cap (decision 33), so "Ask BIS to
 * make room" would tell it to ask itself.
 */
export type TeamViewer = "owner" | "agency";

/**
 * The DotPill treatments: a dot AND a word (rule 3). Tokens only.
 *
 * S-10 T6: these were module-level English constants, built once at import
 * — team-card.tsx read them directly, English regardless of the reader's
 * own stored choice. Now functions of locale (default "en", every existing
 * caller unaffected); team-card.tsx shadows the same names locally per
 * render (`const ROLE_PILL = rolePill(locale);`), so every JSX read below
 * stays byte-identical and only the VALUE changes.
 */
/** `pseudo` (S-10 T9a) is the same QA prop every pseudo-wired page's cards
 *  take — default `false`, so every pre-existing caller (the agency's
 *  Settings card) renders byte-identical to before. */
export function rolePill(
  locale: Locale = "en", pseudo = false,
): Record<AccountRole, { label: string; dot: string; chip: string }> {
  const tr = makeTr(locale, pseudo);
  return {
    owner: { label: tr.text("team.role.owner"), dot: "bg-primary", chip: "border-transparent bg-[var(--accent-dim)] text-foreground" },
    staff: { label: tr.text("team.role.staff"), dot: "bg-muted-foreground/60", chip: "border-border bg-transparent text-foreground" },
    // F-085 part 1: the least access, the faintest dot; the word carries it.
    technician: { label: tr.text("team.role.technician"), dot: "bg-muted-foreground/30", chip: "border-border bg-transparent text-foreground" },
  };
}

export function statusPill(
  locale: Locale = "en", pseudo = false,
): Record<"active" | "invited", { label: string; dot: string; chip: string }> {
  const tr = makeTr(locale, pseudo);
  return {
    active: { label: tr.text("team.status.active"), dot: "bg-success", chip: "border-success/30 bg-success/10 text-foreground" },
    invited: { label: tr.text("team.status.invited"), dot: "bg-warning", chip: "border-warning/30 bg-warning/10 text-foreground" },
  };
}

export function languageName(locale: Locale = "en", pseudo = false): Record<PersonLanguage, string> {
  const tr = makeTr(locale, pseudo);
  return {
    en: tr.text("team.languageName.english"),
    es: tr.text("team.languageName.spanish"),
  };
}

/** Fills `{name}`-style holes. A replacer function, so a `$&` in a person's name is inserted literally. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (hole, k: string) => (k in vars ? String(vars[k]) : hole));
}

/** Every code the Team actions return is its own message key (messages.ts, `team.*`). Never pseudo: these
 *  are post-interaction error strings, not part of the page's own static render (this file's own `pseudo`
 *  props stop at the static labels/pills above; see team-card.tsx and page.tsx's own notes on the same
 *  boundary for billing/branding). */
export function teamErrorCopy(code: TeamError, viewer: TeamViewer, locale: Locale = "en"): string {
  if (code === "team.full" && viewer === "agency") return t(m, "team.full.agency", locale);
  return t(m, code, locale);
}

/** "Room for N more people" / "Room for 1 more person" / full / null when no cap is known. */
export function roomCopy(room: number | null, viewer: TeamViewer, locale: Locale = "en", pseudo = false): string | null {
  const tr = makeTr(locale, pseudo);
  if (room === null) return null;
  if (room <= 0) return viewer === "agency" ? tr.text("team.full.agency") : tr.text("team.full");
  if (room === 1) return tr.text("team.room.one");
  return fill(tr.text("team.room.many"), { count: room });
}

/** With Clerk unreachable the invitations are UNKNOWN, not none, so "Just you so far" would be a guess (fix round 1, M2). */
export function emptyCopy(
  viewer: TeamViewer, members: number, pending: number, clerkUnavailable: boolean, locale: Locale = "en", pseudo = false,
): string | null {
  const tr = makeTr(locale, pseudo);
  if (clerkUnavailable || pending > 0) return null;
  if (viewer === "agency") return members === 0 ? tr.text("team.empty.agency") : null;
  return members <= 1 ? tr.text("team.empty") : null;
}

/** A person is named by their name, or by their email when Clerk had none. */
export function displayName(p: { name: string | null; email: string }): string {
  return p.name?.trim() || p.email;
}
