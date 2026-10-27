import { aiAuthorMark } from "@/lib/voice/provenance";
import { AI_MARK_CLASS } from "@/components/ai-mark";
import type { Locale } from "@/lib/i18n/locale";

/**
 * DESIGN.md's author mark for the receptionist's work ("Sofía · AI",
 * Provenance), as its OWN small element: beside a contact's name it must read
 * as a mark, not as more dot-separated parts of the name line. A chip-token
 * pill (999px, sanctioned) at the Label role's size; carries no state of its
 * own. `data-ai-mark` addresses it in tests. `locale` defaults to English, so
 * the agency's work queue, which passes none, is unchanged; the account's To do
 * passes the page's own (F-085 follow-ups).
 */
export function AiAuthorMark({ personaName, locale = "en" }: { personaName?: string | null; locale?: Locale }) {
  return (
    <span
      data-ai-mark
      className={AI_MARK_CLASS}
    >
      {aiAuthorMark(personaName, locale)}
    </span>
  );
}
