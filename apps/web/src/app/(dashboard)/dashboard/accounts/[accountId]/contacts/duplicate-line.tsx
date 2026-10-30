import type { DuplicatePair } from "@bis/db";
import { contactDisplayName } from "@/lib/format";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { compareHref, reasonMessageKey } from "@/lib/contacts/duplicates";

/**
 * F-006 part 1 (plan Task 11, spec §6.1): "May be the same person as {name} · {reason} · Compare"
 * under the record header, and the same component in the drawer's header section (6.2's list, not
 * this). `pairs` arrives strongest-first (`duplicatePairsOf`'s own order); with more than one it adds
 * "and N more". No card: a card would be empty on almost every record (rule 5's empty state would
 * sell nothing), so this line renders nothing at all with no open pair. Hidden for a Technician
 * (`canMerge` false) even with pairs read for someone else's render — the caller decides whether to
 * read at all, this just never shows it. Not `role="status"`: nothing changed just now, so there is
 * nothing to announce. Text tokens only, never a card surface.
 */
export function DuplicateLine({
  accountId, contactId, pairs, canMerge, locale,
}: {
  accountId: string; contactId: string; pairs: DuplicatePair[]; canMerge: boolean; locale: Locale;
}) {
  if (!canMerge || pairs.length === 0) return null;
  const strongest = pairs[0]!;
  const other = strongest.a.id === contactId ? strongest.b : strongest.a;
  const name = contactDisplayName({ first_name: other.firstName, last_name: other.lastName });
  const reason = t(m, reasonMessageKey(strongest.reason), locale);
  const more = pairs.length - 1;
  return (
    <p data-duplicate-line className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm text-[var(--text-2)]">
      <span>{t(m, "contacts.duplicates.banner", locale, { name, reason })}</span>
      {more > 0 ? (
        <span>{more === 1 ? t(m, "contacts.duplicates.bannerMoreOne", locale) : t(m, "contacts.duplicates.bannerMore", locale, { count: more })}</span>
      ) : null}
      <a href={compareHref(accountId, strongest)}
        className="rounded-[var(--radius-ctl)] underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {t(m, "contacts.duplicates.compare", locale)}
      </a>
    </p>
  );
}
