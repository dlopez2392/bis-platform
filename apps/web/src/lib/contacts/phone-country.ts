import type { PhoneCountry } from "@bis/db/phone";
import { m } from "@/lib/messages";
import type { OptOutToast } from "@/lib/contacts/marketing-optout";

/**
 * The Texts row's Check number state (consent chain spec §6, F-009): "This
 * number could be Mexican or US." with ghost "Mexico (+52)" and "US (+1)",
 * each run at once with an undo toast (DESIGN.md rule 6). This is the
 * behaviour; phone-country-row.tsx is its shell. Type-only import of the
 * normaliser's module: nothing of libphonenumber reaches the browser.
 */

/** Status dot + word (rule 3), in token classes only: a warning, because
 *  it is the one texts state an operator must act on before anything sends. */
export const PHONE_CHECK_TREATMENT = {
  label: m["contact.phoneCountry.word"],
  dot: "bg-warning",
  chip: "border-warning/30 bg-warning/10 text-foreground",
} as const;

export type PhoneCountryPrevious = { phone: string; unconfirmed: boolean };
export type PhoneCountryPickResult =
  | { ok: true; phone: string; previous: PhoneCountryPrevious }
  | { ok: false; error: string };
export type PhoneCountryUndoResult = { ok: true } | { ok: false; error: string };

export type PhoneCountrySave = (country: PhoneCountry) => Promise<PhoneCountryPickResult>;
export type PhoneCountryUndo = (picked: string, previous: PhoneCountryPrevious) => Promise<PhoneCountryUndoResult>;

/** One call, with a rejected promise (a stale tab's server-action id after
 *  a redeploy) turned into the same "crashed" toast every inline edit uses. */
async function attempt<T extends { ok: boolean }>(call: () => Promise<T>, toast: OptOutToast): Promise<T | null> {
  try {
    const result = await call();
    if (!result.ok) toast.error((result as unknown as { error: string }).error);
    return result.ok ? result : null;
  } catch {
    toast.error(m["inline.crashed"]);
    return null;
  }
}

/**
 * Pick the country. On success the row goes (`show(false)`) and the toast
 * offers Undo, which puts the previous phone and flag back and brings the
 * row back (`show(true)`). A failed pick leaves the row as it was and says
 * why. Undo runs through `run` — the row's own `runGuarded` — so it can
 * never race a write still in flight; a refused Undo says so, because
 * sonner has already dismissed the toast that carried it.
 */
export async function pickPhoneCountry(
  country: PhoneCountry, save: PhoneCountrySave, undo: PhoneCountryUndo,
  show: (checking: boolean) => void, toast: OptOutToast,
  run: (work: () => Promise<void>) => boolean | Promise<void> = (work) => work(),
  // Re-review minor 1: the host (PhoneCountryRow) has no other way to learn
  // that the number changed — the row is keyed by the SUMMARY's flag, not
  // the contact alone, and a pick or an Undo the server took must make the
  // host re-read that summary, or the row for the NEXT ambiguous number
  // never remounts (it shows no row until a reload). Never called for a
  // refusal: nothing changed, and the row is exactly as it was.
  onChanged: () => void = () => {},
): Promise<void> {
  const picked = await attempt(() => save(country), toast);
  if (!picked || !picked.ok) return;
  show(false);
  onChanged();
  toast.success(m[country === "MX" ? "contact.phoneCountry.mxToast" : "contact.phoneCountry.usToast"], {
    action: {
      label: m["common.undo"],
      onClick: () => {
        const ran = run(async () => {
          if (await attempt(() => undo(picked.phone, picked.previous), toast)) {
            show(true);
            onChanged();
          }
        });
        if (ran === false) toast.error(m["contact.phoneCountry.undoBusy"]);
        return ran;
      },
    },
  });
}
