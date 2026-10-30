import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { m } from "@/lib/messages";
import { SERVER_SENTENCE_KEYS, inDrawerLanguage } from "./server-words";

/** T11/T12 review: a Spanish drawer toasted the booking actions' English refusals. */
const src = (f: string) => readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), "utf8");

describe("inDrawerLanguage", () => {
  it("every sentence the drawer's booking actions can answer is listed, so none reaches a Spanish drawer in English (mutation: drop a key -> FAILS)", () => {
    const answered = new Set<string>();
    for (const f of ["actions.ts", "prove-booking.ts", "cancel-flow.ts"]) {
      for (const [, key] of src(f).matchAll(/m\["(calendar\.(?:bookings|cancelDialog)\.[A-Za-z.]+)"\]/g)) answered.add(key!);
    }
    // Words the actions use for something other than a toast (the dialog's own labels are its component's).
    for (const k of [...answered]) if (k.startsWith("calendar.cancelDialog.") && k !== "calendar.cancelDialog.messageTooLong") answered.delete(k);
    expect(answered.size).toBeGreaterThan(5);
    for (const k of answered) expect(SERVER_SENTENCE_KEYS as readonly string[], k).toContain(k);
  });

  it("each listed sentence has its Spanish twin, and reads back as it", () => {
    for (const k of SERVER_SENTENCE_KEYS) {
      expect(Object.hasOwn(m, `${k}.es`), k).toBe(true);
      expect(inDrawerLanguage(m[k], "es")).toBe(m[`${k}.es` as keyof typeof m]);
      expect(inDrawerLanguage(m[k], "en")).toBe(m[k]);
    }
  });

  it("an unknown sentence stays as it came in English, and is the generic refusal in Spanish", () => {
    expect(inDrawerLanguage("Nope.", "en")).toBe("Nope.");
    expect(inDrawerLanguage("Nope.", "es")).toBe(m["calendar.bookings.statusUpdateFailed.es"]);
  });
});
