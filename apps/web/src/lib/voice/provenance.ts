import { m } from "@/lib/messages";

/**
 * DESIGN.md's author mark for anything the receptionist wrote ("Sofía · AI",
 * Provenance): the account's own persona when the screen has it to hand
 * (D-063's rule for the presence indicator, since clients rename theirs),
 * else "Sofía". One function so every surface that marks her work — the call
 * card, the callback To do on the queue and on the contact's timeline —
 * spells the mark the same way.
 */
export function aiAuthorMark(personaName?: string | null): string {
  const name = personaName?.trim() || "Sofía";
  return m["provenance.ai"].replace("{name}", () => name);
}
