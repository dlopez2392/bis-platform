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
import { makeTr } from "@/lib/record/copy";
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
  members, pending, room, clerkUnavailable, defaultLanguage, viewer, actions, locale = "en", pseudo = false,
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
  /** S-10 T9a: the QA pseudo-locale (`requestPseudoMode`), a prop like every
   *  other card on a pseudo-wired page. Default `false` so every
   *  pre-existing caller renders byte-identical to before. */
  pseudo?: boolean;
}) {
  const tr = makeTr(locale, pseudo);
  const full = room !== null && room <= 0;
  const roomLine = roomCopy(room, viewer, locale, pseudo);
  const empty = emptyCopy(viewer, members.length, pending.length, clerkUnavailable, locale, pseudo);

  return (
    <Card id="team" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{tr.text("team.title")}</CardTitle>
        <CardDescription>{tr.text("team.body")}</CardDescription>
        <CardAction>
          <InviteDialog actions={actions} viewer={viewer} defaultLanguage={defaultLanguage} disabled={full} locale={locale} pseudo={pseudo} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {clerkUnavailable ? (
          <Notice tone="warn" className="text-foreground">{tr.text("team.clerkUnavailable")}</Notice>
        ) : null}

        {members.length + pending.length > 0 ? (
          <ul className="flex flex-col" aria-label={tr.text("team.title")}>
            {members.map((member) => (
              <MemberRow key={member.userId} member={member} defaultLanguage={defaultLanguage} viewer={viewer} actions={actions} locale={locale} pseudo={pseudo} />
            ))}
            {pending.map((invite) => (
              <InviteRow key={invite.id} invite={invite} viewer={viewer} actions={actions} locale={locale} pseudo={pseudo} />
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

        <p className="text-xs text-muted-foreground">{tr.text("team.ownerHelp")}</p>
      </CardContent>
    </Card>
  );
}

function MemberRow({
  member, defaultLanguage, viewer, actions, locale = "en", pseudo = false,
}: {
  member: TeamMember; defaultLanguage: PersonLanguage; viewer: TeamViewer; actions: BoundTeamActions;
  locale?: Locale; pseudo?: boolean;
}) {
  const [busy, startTransition] = useTransition();
  const tr = makeTr(locale, pseudo);
  const name = displayName(member);
  // NULL means "follows the company's language" (spec §5); it is shown as
  // the language it resolves to.
  const language = member.language ?? defaultLanguage;
  const rolePills = rolePill(locale, pseudo);
  const languageNames = languageName(locale, pseudo);
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
        <SelectTrigger size="sm" aria-label={fill(tr.text("team.roleFor"), { name })} className={INLINE_TRIGGER}>
          <SelectValue>
            <DotPill dense {...rolePills[member.role]} data-status={member.role} />
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(["owner", "staff", "technician"] as const).map((r) => <SelectItem key={r} value={r}>{rolePills[r].label}</SelectItem>)}
        </SelectContent>
      </Select>
      <DotPill dense {...statusPill(locale, pseudo).active} data-status="active" />
      <Select
        value={language}
        disabled={busy}
        onValueChange={(v) => {
          if (isPersonLanguage(v) && v !== language) startTransition(() => changeLanguage(actions, member, v, viewer, locale));
        }}
      >
        <SelectTrigger size="sm" aria-label={fill(tr.text("team.languageFor"), { name })} className={INLINE_TRIGGER}>
          <SelectValue>{languageNames[language]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(["en", "es"] as const).map((l) => <SelectItem key={l} value={l}>{languageNames[l]}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button
        variant="ghost" size="sm" disabled={busy} className="justify-self-end"
        aria-label={fill(tr.text("team.removeName"), { name })}
        onClick={() => startTransition(() => removeMember(actions, member, viewer, Date.now, locale))}
      >
        {tr.text("team.remove")}
      </Button>
      {/* Its own full-width line at the row's foot rather than inside the
          role column: that column is 8.5rem, and the sentence would wrap to
          three lines there and push the row's rule out of line. */}
      <RoleHelp role={member.role} className="basis-full sm:col-span-full" locale={locale} pseudo={pseudo} />
    </li>
  );
}

/**
 * What a Technician sees (F-085 part 1, spec §9): said under the role picker
 * when Technician is chosen, and on a Technician's row. Nothing for Owner or
 * Staff, whose access the card's own help line already states.
 */
export function RoleHelp({
  role, className, locale = "en", pseudo = false,
}: { role: AccountRole; className?: string; locale?: Locale; pseudo?: boolean }) {
  if (role !== "technician") return null;
  return <p className={cn("text-muted-foreground text-xs", className)}>{makeTr(locale, pseudo).text("team.roleHelp.technician")}</p>;
}

/** An invitation can only be cancelled; its role and language are what the person will get. */
function InviteRow({
  invite, viewer, actions, locale = "en", pseudo = false,
}: { invite: PendingInvite; viewer: TeamViewer; actions: BoundTeamActions; locale?: Locale; pseudo?: boolean }) {
  const [busy, startTransition] = useTransition();
  const tr = makeTr(locale, pseudo);
  const rolePills = rolePill(locale, pseudo);
  const languageNames = languageName(locale, pseudo);
  return (
    <li className={INVITE_ROW} data-team-invite={invite.id}>
      <p className="min-w-0 flex-1 truncate text-muted-foreground">{invite.email}</p>
      <span className="px-1.5"><DotPill dense {...rolePills[invite.role]} data-status={invite.role} /></span>
      <DotPill dense {...statusPill(locale, pseudo).invited} data-status="invited" />
      <span className="px-1.5 text-[13px] text-muted-foreground">{languageNames[invite.language]}</span>
      <Button
        variant="ghost" size="sm" disabled={busy} className="justify-self-end"
        aria-label={fill(tr.text("team.revokeFor"), { email: invite.email })}
        onClick={() => startTransition(() => revokeInvite(actions, invite, viewer, locale))}
      >
        {tr.text("team.revoke")}
      </Button>
    </li>
  );
}

/** Takes `pending` by hand: useFormStatus reports only for `action`-prop forms, and this one has none. */
function SendButton({ pending, locale = "en", pseudo = false }: { pending: boolean; locale?: Locale; pseudo?: boolean }) {
  const tr = makeTr(locale, pseudo);
  return (
    <Button type="submit" disabled={pending}>
      {pending ? tr.text("team.invite.sending") : tr.text("team.invite.send")}
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
  actions, viewer, defaultLanguage, disabled, locale = "en", pseudo = false,
}: {
  actions: BoundTeamActions; viewer: TeamViewer; defaultLanguage: PersonLanguage; disabled: boolean;
  locale?: Locale; pseudo?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultRole: AccountRole = "staff";
  const [role, setRole] = useState<AccountRole>(defaultRole);
  const tr = makeTr(locale, pseudo);
  const rolePills = rolePill(locale, pseudo);
  const languageNames = languageName(locale, pseudo);
  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    const refusal = await inviteMember(actions, formData, viewer, locale);
    if (refusal) { setError(refusal); return; }
    setError(null);
    setOpen(false);
  });
  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setError(null); setRole(defaultRole); } }}>
      <DialogTrigger asChild>
        <Button disabled={disabled}><UserPlus aria-hidden />{tr.text("team.invite")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr.text("team.invite.title")}</DialogTitle>
          <DialogDescription>{tr.text("team.invite.body")}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={onSubmit}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="team-invite-email">{tr.text("team.invite.email")}</Label>
            <Input id="team-invite-email" name="email" type="email" required autoFocus autoComplete="off" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="team-invite-role">{tr.text("team.invite.role")}</Label>
              <Select name="role" value={role} onValueChange={(v) => { if (isAccountRole(v)) setRole(v); }}>
                <SelectTrigger id="team-invite-role" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["staff", "technician", "owner"] as const).map((r) => <SelectItem key={r} value={r}>{rolePills[r].label}</SelectItem>)}
                </SelectContent>
              </Select>
              <RoleHelp role={role} locale={locale} pseudo={pseudo} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-invite-language">{tr.text("team.invite.language")}</Label>
              <Select name="language" defaultValue={defaultLanguage}>
                <SelectTrigger id="team-invite-language" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["en", "es"] as const).map((l) => <SelectItem key={l} value={l}>{languageNames[l]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {error ? <Notice tone="crit" className="text-foreground">{error}</Notice> : null}
          <SendButton pending={pending} locale={locale} pseudo={pseudo} />
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
export function TeamSkeleton({ locale = "en", pseudo = false }: { locale?: Locale; pseudo?: boolean }) {
  const tr = makeTr(locale, pseudo);
  return (
    <Card id="team" className="scroll-mt-24" aria-busy="true" aria-label={tr.text("team.title")}>
      <CardHeader>
        <CardTitle>{tr.text("team.title")}</CardTitle>
        <CardDescription>{tr.text("team.body")}</CardDescription>
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
export function TeamAccessOff({ locale = "en", pseudo = false }: { locale?: Locale; pseudo?: boolean }) {
  const tr = makeTr(locale, pseudo);
  return (
    <Card id="team" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{tr.text("team.title")}</CardTitle>
        <CardDescription>{tr.text("team.body")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Notice tone="warn" className="text-foreground">{tr.text("team.accessOffNote")}</Notice>
      </CardContent>
    </Card>
  );
}

/**
 * The card's own error state (rule 5): the stored team could not be read.
 * Rendered in place of the card so a failed read never takes the rest of
 * Settings (or the Team page's header) down with it.
 */
export function TeamLoadError({ locale = "en", pseudo = false }: { locale?: Locale; pseudo?: boolean }) {
  const tr = makeTr(locale, pseudo);
  return (
    <Card id="team" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{tr.text("team.title")}</CardTitle>
        <CardDescription>{tr.text("team.body")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Notice tone="crit" className="text-foreground">{tr.text("team.loadFailed")}</Notice>
      </CardContent>
    </Card>
  );
}
