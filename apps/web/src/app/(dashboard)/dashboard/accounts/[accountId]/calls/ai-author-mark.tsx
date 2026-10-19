import { aiAuthorMark } from "@/lib/voice/provenance";
import { AI_MARK_CLASS } from "@/components/ai-mark";

/**
 * DESIGN.md's author mark for the receptionist's work ("Sofía · AI",
 * Provenance), as its OWN small element: beside a contact's name it must read
 * as a mark, not as more dot-separated parts of the name line. A chip-token
 * pill (999px, sanctioned) at the Label role's size; carries no state of its
 * own. `data-ai-mark` addresses it in tests.
 */
export function AiAuthorMark({ personaName }: { personaName?: string | null }) {
  return (
    <span
      data-ai-mark
      className={AI_MARK_CLASS}
    >
      {aiAuthorMark(personaName)}
    </span>
  );
}
