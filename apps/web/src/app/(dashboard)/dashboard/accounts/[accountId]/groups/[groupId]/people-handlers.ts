import { toast } from "sonner";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import {
  setGroupPrimaryContactAction, removeMembershipAction, restoreMembershipAction, setBillingAction, setRoleAction,
  type GroupActionError, type GroupResult,
} from "../../contacts/groups-actions";

/**
 * People's writes (S-03 part 2, plan Task 6, spec §8.2): the Groups card's own actions (plan
 * deviation 5), its toasts in the READER's language (the Groups card's own toasts are English,
 * groups-card.tsx). Every Undo writes what the SERVER handed back, never a value captured here
 * (groups-card.tsx's rule: `undo: (r) => () => action(..., r.previous)`, never the pre-write value).
 * A rejected action (a stale tab after a deploy) is a toast, never an unhandled throw.
 */
const ERROR_KEYS: readonly GroupActionError[] = ["groups.refused", "groups.failed", "groups.nameTaken", "groups.tooLong"];
export function groupErrorText(e: unknown, locale: Locale): string {
  return t(m, ERROR_KEYS.includes(e as GroupActionError) ? (e as GroupActionError) : "groups.failed", locale);
}

type Undo = () => Promise<GroupResult>;

export function peopleHandlers({ accountId, groupId, locale, onChanged }: {
  accountId: string; groupId: string; locale: Locale; onChanged: () => void;
}) {
  const failed = () => toast.error(t(m, "groups.failed", locale));
  async function runUndo(undo: Undo) {
    try {
      const r = await undo();
      if (!r.ok) { toast.error(groupErrorText(r.error, locale)); return; }
      onChanged();
    } catch { failed(); }
  }
  async function write<T extends object>(
    run: () => Promise<GroupResult<T>>, success: (r: T) => string, undo?: (r: T) => Undo,
  ): Promise<boolean> {
    let r: GroupResult<T>;
    try { r = await run(); } catch { failed(); return false; }
    if (!r.ok) { toast.error(groupErrorText(r.error, locale)); return false; }
    onChanged();
    const u = undo?.(r);
    if (u) toast.success(success(r), { action: { label: t(m, "common.undo", locale), onClick: () => runUndo(u) } });
    else toast.success(success(r));
    return true;
  }
  return {
    makePrimaryContact: (member: { memberId: string; name: string }) =>
      write(() => setGroupPrimaryContactAction(accountId, groupId, member.memberId),
        () => t(m, "groupPage.people.primaryContactSet", locale, { name: member.name }),
        (r) => () => setGroupPrimaryContactAction(accountId, groupId, r.previous)),
    remove: (member: { memberId: string; name: string }) =>
      write(() => removeMembershipAction(accountId, member.memberId),
        () => t(m, "groupPage.people.removed", locale, { name: member.name }),
        (r) => () => restoreMembershipAction(accountId, r.removed)),
    toggleBilling: (member: { memberId: string; isBilling: boolean }) =>
      write(() => setBillingAction(accountId, member.memberId, !member.isBilling),
        () => t(m, "groups.saved", locale),
        (r) => () => setBillingAction(accountId, member.memberId, r.previous)),
    roleSave: (memberId: string) => async (v: string): Promise<{ ok: true; undoPayload?: unknown } | { ok: false; error: string }> => {
      let r: GroupResult<{ previous: string | null }>;
      try { r = await setRoleAction(accountId, memberId, v === "" ? null : v); }
      catch { return { ok: false, error: t(m, "groups.failed", locale) }; }
      if (!r.ok) return { ok: false, error: groupErrorText(r.error, locale) };
      onChanged();
      return { ok: true, undoPayload: r.previous };
    },
    roleUndo: (memberId: string) => async (prev: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
      let r: GroupResult;
      try { r = await setRoleAction(accountId, memberId, (prev as string | null) ?? null); }
      catch { return { ok: false, error: t(m, "groups.failed", locale) }; }
      if (!r.ok) return { ok: false, error: groupErrorText(r.error, locale) };
      onChanged();
      return { ok: true };
    },
  };
}
