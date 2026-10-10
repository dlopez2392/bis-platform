import type { AccountRole, PersonLanguage } from "@bis/db";
import type { TeamError } from "@/app/(dashboard)/dashboard/accounts/[accountId]/team/actions";
import { m } from "@/lib/messages";

/**
 * The Team card's words (spec §8), with no React and no I/O.
 *
 * Who is looking changes two sentences: the agency is never on the team
 * list (plan deviation 6), so "Just you so far" would be false for it, and
 * the agency is the one that raises the cap (decision 33), so "Ask BIS to
 * make room" would tell it to ask itself.
 */
export type TeamViewer = "owner" | "agency";

/** The DotPill treatments: a dot AND a word (rule 3). Tokens only. */
export const ROLE_PILL: Record<AccountRole, { label: string; dot: string; chip: string }> = {
  owner: { label: m["team.role.owner"], dot: "bg-primary", chip: "border-transparent bg-[var(--accent-dim)] text-foreground" },
  staff: { label: m["team.role.staff"], dot: "bg-muted-foreground/60", chip: "border-border bg-transparent text-foreground" },
};
export const STATUS_PILL = {
  active: { label: m["team.status.active"], dot: "bg-success", chip: "border-success/30 bg-success/10 text-foreground" },
  invited: { label: m["team.status.invited"], dot: "bg-warning", chip: "border-warning/30 bg-warning/10 text-foreground" },
} as const;

export const LANGUAGE_NAME: Record<PersonLanguage, string> = {
  en: m["team.languageName.english"],
  es: m["team.languageName.spanish"],
};

/** Fills `{name}`-style holes. A replacer function, so a `$&` in a person's name is inserted literally. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (hole, k: string) => (k in vars ? String(vars[k]) : hole));
}

/** Every code the Team actions return is its own message key (messages.ts, `team.*`). */
export function teamErrorCopy(code: TeamError, viewer: TeamViewer): string {
  if (code === "team.full" && viewer === "agency") return m["team.full.agency"];
  return m[code];
}

/** "Room for N more people" / "Room for 1 more person" / full / null when no cap is known. */
export function roomCopy(room: number | null, viewer: TeamViewer): string | null {
  if (room === null) return null;
  if (room <= 0) return viewer === "agency" ? m["team.full.agency"] : m["team.full"];
  if (room === 1) return m["team.room.one"];
  return fill(m["team.room.many"], { count: room });
}

export function emptyCopy(viewer: TeamViewer, members: number, pending: number): string | null {
  if (pending > 0) return null;
  if (viewer === "agency") return members === 0 ? m["team.empty.agency"] : null;
  return members <= 1 ? m["team.empty"] : null;
}

/** A person is named by their name, or by their email when Clerk had none. */
export function displayName(p: { name: string | null; email: string }): string {
  return p.name?.trim() || p.email;
}
