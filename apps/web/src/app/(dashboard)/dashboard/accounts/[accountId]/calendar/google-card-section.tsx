import type { Locale } from "@/lib/i18n/locale";
import { GoogleCard } from "./google-card";
import { loadGoogleCardView, type GoogleOutcome } from "./google-card-data";
import { disconnectGoogleCalendarAction } from "./google-actions";

/**
 * The Google Calendar card's own server boundary (S-22 slice 1, PR 3; DESIGN.md rule 5): it reads its own status
 * behind a Suspense skeleton on the page, and a failed read is the card's error state (loadGoogleCardView never
 * throws), so the rest of the page loads whatever happens here. Renders nothing when dormant or when the reader
 * may not manage the account.
 */
export async function GoogleCardSection(p: {
  accountId: string; isAgency: boolean; canManage: boolean; origin: string; outcome: GoogleOutcome | null;
  locale: Locale; pseudo: boolean;
}) {
  const view = await loadGoogleCardView(p);
  if (!view) return null;
  return (
    <GoogleCard
      view={view} locale={p.locale} pseudo={p.pseudo}
      disconnect={disconnectGoogleCalendarAction.bind(null, p.accountId)}
    />
  );
}
