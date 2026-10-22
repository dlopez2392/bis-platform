// The one line realtime-spike.ts prints for an OpenAI Realtime `error` event. That line lands in a PUBLIC
// workflow log (sofia-corpus.yml), so it is built from the error's `code`, `type` and `param` only: each
// read only when it is a plain string, and kept to identifier characters, capped. It never reads, stringifies
// or interpolates the error itself, whose free text can echo what was sent. Pure, so
// apps/web/ci/realtime-spike.test.ts can prove it against an error whose every text path is a sentinel.

const MAX = 80;

/** A plain-string field as identifier characters only (letters, digits, `_ . - [ ]`), capped; "" otherwise. */
function token(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^\w.[\]-]/g, "").slice(0, MAX) : "";
}

/** A named own field of an object, without touching anything else on it. */
function field(error: unknown, key: "code" | "type" | "param"): unknown {
  return typeof error === "object" && error !== null && Object.prototype.hasOwnProperty.call(error, key)
    ? (error as Record<typeof key, unknown>)[key]
    : undefined;
}

export function realtimeErrorWhy(error: unknown): string {
  const code = token(field(error, "code")) || "no code";
  const type = token(field(error, "type")) || "no type";
  const param = token(field(error, "param"));
  return `error: ${code} / ${type}${param ? ` / param ${param}` : ""}`;
}
