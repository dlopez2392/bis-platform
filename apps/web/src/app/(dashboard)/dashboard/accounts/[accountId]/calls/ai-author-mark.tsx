import { aiAuthorMark } from "@/lib/voice/provenance";

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
      className="inline-flex shrink-0 items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-1.5 text-[10px] leading-4 font-medium text-[var(--chip-text)]"
    >
      {aiAuthorMark(personaName)}
    </span>
  );
}
