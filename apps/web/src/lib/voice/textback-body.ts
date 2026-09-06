/**
 * What a missed caller receives when the operator has not written their own.
 *
 * Deliberately short: it is one SMS segment in GSM-7 for any plausible
 * company name, so the default never silently costs two messages. Check it
 * with segmentsFor() if you change it.
 *
 * Plain language a business owner would text, no template syntax, and it
 * names the company because a text from an unknown number is otherwise
 * indistinguishable from spam.
 *
 * The brief's copy used an em dash ("—") here; that character is outside
 * GSM7_BASE (segments.ts) and silently flips the whole message to UCS-2,
 * failing the one-segment contract this file exists to guarantee — caught by
 * running the brief's own test (task-5-brief.md), not by inspection. Swapped
 * for a comma, which reads at least as plain and stays in the GSM-7 set.
 */
export function defaultTextbackBody(accountName: string): string {
  return `Hi, this is ${accountName}. Sorry we missed you just now, reply here and we'll help.`;
}
