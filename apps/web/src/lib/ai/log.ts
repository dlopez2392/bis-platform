import { loggableError } from "@/lib/loggable-error";

/** An error's class, never its message (a provider error's message can carry the prompt or the answer). */
export function errorName(e: unknown): string {
  if (typeof e === "object" && e !== null && typeof (e as { name?: unknown }).name === "string") return (e as { name: string }).name;
  return typeof e;
}

/**
 * For a caller's catch around code that parses a model's answer (plan deviation 6): JSON.parse's SyntaxError
 * quotes the start of its input, so it is named and never quoted. Anything else keeps loggableError's form
 * (a database error from writing the result, which carries no model text).
 */
export function aiSafeError(e: unknown): string {
  return e instanceof SyntaxError ? "SyntaxError (an answer that did not parse)" : loggableError(e);
}
