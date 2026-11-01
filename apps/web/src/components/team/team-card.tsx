"use client";

import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
import type { AccountRole, PersonLanguage, TeamMember } from "@bis/db";
import { DotPill } from "@/components/dot-pill";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";
import { isAccountRole, isPersonLanguage, type PendingInvite } from "@/lib/team/team-view";
import {
  languageName, rolePill, statusPill, displayName, emptyCopy, fill, roomCopy, type TeamViewer,
} from "./team-copy";
import {
  changeLanguage, changeRole, inviteMember, removeMember, revokeInvite, type BoundTeamActions,
} from "./team-handlers";

export type { BoundTeamActions } from "./team-handlers";

/**
 * The Team card (staff and roles, spec §8). The same card on the client
 * Owner's /team page and under the agency's Client access switch.
 *
 * Rows are rules inside the card and rise to `--surface-3` on hover. A row
 * is NOT a click target: its controls
 * are, so row navigation is Tab through each row's role, language and
 * remove, each with the controls' own focus ring. There are no checkboxes,
 * so there is no bulk bar (rule 4).
 *
 * ONE primary for the card (rule 8): "Invite someone". Everything a row can
 * do is ghost or an inline Select, and each runs at once with an Undo toast
 * (rule 6, team-handlers.ts).
 */

/**
 * A row is a rule inside the card, never a box each (the mockup's row rule,
 * list-panel.tsx's LIST_ROW, pinned for these rows in ui/material.test.ts),
 * rising to `--surface-3` on hover. The columns line up from `sm` up and
 * are wide enough for "Empleado" and "Invitado" with their dots and chevrons.
 */
const LAYOUT = "relative -mx-2 flex flex-wrap items-center gap-x-3 gap-y-2 px-2 transition-colors duration-150 hover:bg-[var(--surface-3)] sm:grid sm:grid-cols-[minmax(0,1fr)_8.5rem_6.5rem_7.5rem_auto]";
const ROW = `border-t border-[var(--row-line)] py-[7px] text-[13px] first:border-t-0 ${LAYOUT}`;
/** A pending invitation keeps its dashed edge, on the interactive line token. */
const INVITE_ROW = `border-t border-dashed border-[var(--line-strong)] py-[7px] text-[13px] first:border-t-0 ${LAYOUT}`;
/**
 * An inline Select that reads as its value until used: no box, the
 * trigger's own focus ring kept. A hovered trigger sits inside a hovered row
 * (already `--surface-3`), so it shows itself as the input it is: the
 * ladder's input step `--surface-2` and the interactive edge `--line-strong`
 * (fix round 1, M7). The base trigger's `dark:hover:bg-input/50` is
 * overridden too, so both modes agree.
 */
const INLINE_TRIGGER = "h-8 border-transparent bg-transparent px-1.5 shadow-none hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] dark:bg-transparent dark:hover:bg-[var(--surface-2)]";

export function TeamCard({
  members, pending, room, clerkUnavailable, defaultLanguage, viewer, actions, locale = "en",
}: {
  members: TeamMember[];
  pending: PendingInvite[];
  /** Seats left (team-view.ts `roomLeft`); null when no cap is known or Clerk could not be read. */
  room: number | null;
  clerkUnavailable: boolean;
  defaultLanguage: PersonLanguage;
  viewer: TeamViewer;
  actions: BoundTeamActions;
  /** S-10 T6: the reader's own locale. Optional, defaulting to "en" so every
   *  existing caller (the agency's Settings card, before this task) is
   *  unaffected; the client's own Team page passes its resolved locale. */
  locale?: Locale;
}) {
  const full = room !== null && room <= 0;
  const roomLine = roomCopy(room, viewer, locale);
  const empty = emptyCopy(viewer, members.length, pending.length, clerkUnavailable, locale);

  return (
    <Card id="team" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{t(m, "team.title", locale)}</CardTitle>
        <CardDescription>{t(m, "team.body", locale)}</CardDescription>
        <CardAction>
          <InviteDialog actions={actions} viewer={viewer} defaultLanguage={defaultLanguage} disabled={full} locale={locale} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {clerkUnavailable ? (
          <Notice tone="warn" className="text-foreground">{t(m, "team.clerkUnavailable", locale)}</Notice>
        ) : null}

        {members.length + pending.length > 0 ? (
          <ul className="flex flex-col" aria-label={t(m, "team.title", locale)}>
            {members.map((member) => (
              <MemberRow key={member.userId} member={member} defaultLanguage={defaultLanguage} viewer={viewer} actions={actions} locale={locale} />
            ))}
            {pending.map((invite) => (
              <InviteRow key={invite.id} invite={invite} viewer={viewer} actions={actions} locale={locale} />
            ))}
          </ul>
        ) : null}

        {empty ? <p className="text-sm text-muted-foreground">{empty}</p> : null}

        {roomLine ? (
          full ? (
            <Notice tone="warn" className="text-foreground">{roomLine}</Notice>
          ) : (
            <p className="text-sm text-muted-foreground tabular-nums">{roomLine}</p>
          )
        ) : null}

        <p className="text-xs text-muted-foreground">{t(m, "team.ownerHelp", locale)}</p>
      </CardContent>
    </Card>
  );
}

function MemberRow({
  member, defaultLanguage, viewer, actions, locale = "en",
}: { member: TeamMember; defaultLanguage: PersonLanguage; viewer: TeamViewer; actions: BoundTeamActions; locale?: Locale }) {
  const [busy, startTransition] = useTransition();
  const name = displayName(member);
  // NULL means "follows the company's language" (spec §5); it is shown as
  // the language it resolves to.
  const language = member.language ?? defaultLanguage;
  const ROLE_PILL = rolePill(locale);
  const LANGUAGE_NAME = languageName(locale);
  return (
    <li className={ROW} data-team-row={member.userId}>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-card-foreground">{name}</p>
        {member.name?.trim() ? <p className="truncate text-xs text-muted-foreground">{member.email}</p> : null}
      </div>
      <Select
        value={member.role}
        disabled={busy}
        onValueChange={(v) => {
          if (isAccountRole(v) && v !== member.role) startTransition(() => changeRole(actions, member, v, viewer, locale));
        }}
      >
        <SelectTrigger size="sm" aria-label={fill(t(m, "team.roleFor", locale), { name })} className={INLINE_TRIGGER}>
          <SelectValue>
            <DotPill dense {...ROLE_PILL[member.role]} data-status={member.role} />
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(["owner", "staff", "technician"] as const).map((r) => <SelectItem key={r} value={r}>{ROLE_PILL[r].label}</SelectItem>)}
        </SelectContent>
      </Select>
      <DotPill dense {...statusPill(locale).active} data-status="active" />
      <Select
        value={language}
        disabled={busy}
        onValueChange={(v) => {
          if (isPersonLanguage(v) && v !== language) startTransition(() => changeLanguage(actions, member, v, viewer, locale));
        }}
      >
        <SelectTrigger size="sm" aria-label={fill(t(m, "team.languageFor", locale), { name })} className={INLINE_TRIGGER}>
          <SelectValue>{LANGUAGE_NAME[language]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(["en", "es"] as const).map((l) => <SelectItem key={l} value={l}>{LANGUAGE_NAME[l]}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button
        variant="ghost" size="sm" disabled={busy} className="justify-self-end"
        aria-label={fill(t(m, "team.removeName", locale), { name })}
        onClick={() => startTransition(() => removeMember(actions, member, viewer, Date.now, locale))}
      >
        {t(m, "team.remove", locale)}
      </Button>
      {/* Its own full-width line at the row's foot rather than inside the
          role column: that column is 8.5rem, and the sentence would wrap to
          three lines there and push the row's rule out of line. */}
      <RoleHelp role={member.role} className="basis-full sm:col-span-full" locale={locale} />
    </li>
  );
}

/**
 * What a Technician sees (F-085 part 1, spec §9): said under the role picker
 * when Technician is chosen, and on a Technician's row. Nothing for Owner or
 * Staff, whose access the card's own help line already states.
 */
export function RoleHelp({ role, className, locale = "en" }: { role: AccountRole; className?: string; locale?: Locale }) {
  if (role !== "technician") return null;
  return <p className={cn("text-muted-foreground text-xs", className)}>{t(m, "team.roleHelp.technician", locale)}</p>;
}

/** An invitation can only be cancelled; its role and language are what the person will get. */
function InviteRow({
  invite, viewer, actions, locale = "en",
}: { invite: PendingInvite; viewer: TeamViewer; actions: BoundTeamActions; locale?: Locale }) {
  const [busy, startTransition] = useTransition();
  const ROLE_PILL = rolePill(locale);
  const LANGUAGE_NAME = languageName(locale);
  return (
    <li className={INVITE_ROW} data-team-invite={invite.id}>
      <p className="min-w-0 flex-1 truncate text-muted-foreground">{invite.email}</p>
      <span className="px-1.5"><DotPill dense {...ROLE_PILL[invite.role]} data-status={invite.role} /></span>
      <DotPill dense {...statusPill(locale).invited} data-status="invited" />
      <span className="px-1.5 text-[13px] text-muted-foreground">{LANGUAGE_NAME[invite.language]}</span>
      <Button
        variant="ghost" size="sm" disabled={busy} className="justify-self-end"
        aria-label={fill(t(m, "team.revokeFor", locale), { email: invite.email })}
        onClick={() => startTransition(() => revokeInvite(actions, invite, viewer, locale))}
      >
        {t(m, "team.revoke", locale)}
      </Button>
    </li>
  );
}

/** Takes `pending` by hand: useFormStatus reports only for `action`-prop forms, and this one has none. */
function SendButton({ pending, locale = "en" }: { pending: boolean; locale?: Locale }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t(m, "team.invite.sending", locale) : t(m, "team.invite.send", locale)}
    </Button>
  );
}

/**
 * Email, role (default Staff) and language (default the company's). Esc
 * closes it (Radix Dialog). A refusal (already invited, already on the
 * team, full) is said inside the dialog, which stays open with the email,
 * role and language as they were (spec §9); success closes it with a toast.
 *
 * Submitted through useFormSubmit (onSubmit), NOT the `action` prop. React
 * 19 resets a form after every action resolves, a refusal included, and
 * Radix Select reverts on that reset event, so with `action` a refused
 * invite wiped the typed email and put role and language back to their
 * defaults while the dialog stayed open (fix round 1, I1;
 * lib/forms/use-form-submit.ts). Nothing to reset on success: the dialog
 * closes, and its content unmounts.
 */
function InviteDialog({
  actions, viewer, defaultLanguage, disabled, locale = "en",
}: { actions: BoundTeamActions; viewer: TeamViewer; defaultLanguage: PersonLanguage; disabled: boolean; locale?: Locale }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultRole: AccountRole = "staff";
  const [role, setRole] = useState<AccountRole>(defaultRole);
  const ROLE_PILL = rolePill(locale);
  const LANGUAGE_NAME = languageName(locale);
  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    const refusal = await inviteMember(actions, formData, viewer, locale);
    if (refusal) { setError(refusal); return; }
    setError(null);
    setOpen(false);
  });
  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setError(null); setRole(defaultRole); } }}>
      <DialogTrigger asChild>
        <Button disabled={disabled}><UserPlus aria-hidden />{t(m, "team.invite", locale)}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(m, "team.invite.title", locale)}</DialogTitle>
          <DialogDescription>{t(m, "team.invite.body", locale)}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={onSubmit}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="team-invite-email">{t(m, "team.invite.email", locale)}</Label>
            <Input id="team-invite-email" name="email" type="email" required autoFocus autoComplete="off" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="team-invite-role">{t(m, "team.invite.role", locale)}</Label>
              <Select name="role" value={role} onValueChange={(v) => { if (isAccountRole(v)) setRole(v); }}>
                <SelectTrigger id="team-invite-role" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["staff", "technician", "owner"] as const).map((r) => <SelectItem key={r} value={r}>{ROLE_PILL[r].label}</SelectItem>)}
                </SelectContent>
              </Select>
              <RoleHelp role={role} locale={locale} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-invite-language">{t(m, "team.invite.language", locale)}</Label>
              <Select name="language" defaultValue={defaultLanguage}>
                <SelectTrigger id="team-invite-language" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["en", "es"] as const).map((l) => <SelectItem key={l} value={l}>{LANGUAGE_NAME[l]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {error ? <Notice tone="crit" className="text-foreground">{error}</Notice> : null}
          <SendButton pending={pending} locale={locale} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Shaped like the loaded card (rule 7, no spinners): the title and
 * description are static copy, so they are real text; then three rows
 * (name and email, role, status, language, remove), the room line and the
 * help line. Carries `id="team"` for the same reason ClientAccessSkeleton
 * keeps its id: the hash scroll runs once, while this is showing.
 * `/team/loading.tsx` and every Suspense fallback share it.
 */
export function TeamSkeleton({ locale = "en" }: { locale?: Locale }) {
  return (
    <Card id="team" className="scroll-mt-24" aria-busy="true" aria-label={t(m, "team.title", locale)}>
      <CardHeader>
        <CardTitle>{t(m, "team.title", locale)}</CardTitle>
        <CardDescription>{t(m, "team.body", locale)}</CardDescription>
        <CardAction><Skeleton className="h-9 w-36" /></CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col">
          {[0, 1, 2].map((i) => (
            <div key={i} className={ROW}>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-44 max-w-full" />
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-20 justify-self-end" />
            </div>
          ))}
        </div>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-96 max-w-full" />
      </CardContent>
    </Card>
  );
}

/**
 * Client access is off (spec §8: the Team card shows only while it is on).
 * Only the agency can land here: a client cannot sign in while it is off.
 * Says why there is nothing to manage and where it is turned on, instead
 * of an Invite that the server would refuse with team.accessOff.
 */
export function TeamAccessOff({ locale = "en" }: { locale?: Locale }) {
  return (
    <Card id="team" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{t(m, "team.title", locale)}</CardTitle>
        <CardDescription>{t(m, "team.body", locale)}</CardDescription>
      </CardHeader>
      <CardContent>
        <Notice tone="warn" className="text-foreground">{t(m, "team.accessOffNote", locale)}</Notice>
      </CardContent>
    </Card>
  );
}

/**
 * The card's own error state (rule 5): the stored team could not be read.
 * Rendered in place of the card so a failed read never takes the rest of
 * Settings (or the Team page's header) down with it.
 */
export function TeamLoadError({ locale = "en" }: { locale?: Locale }) {
  return (
    <Card id="team" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{t(m, "team.title", locale)}</CardTitle>
        <CardDescription>{t(m, "team.body", locale)}</CardDescription>
      </CardHeader>
      <CardContent>
        <Notice tone="crit" className="text-foreground">{t(m, "team.loadFailed", locale)}</Notice>
      </CardContent>
    </Card>
  );
}
