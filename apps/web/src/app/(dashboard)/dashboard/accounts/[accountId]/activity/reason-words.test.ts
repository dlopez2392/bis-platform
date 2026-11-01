import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { REASONS } from "@/lib/automations/hold-or-send";
import { REASON_KEYS, reasonInLanguage } from "./reason-words";

/**
 * S-10 fix round I6. `automation_log.reason` is stored as the ENGLISH
 * sentence REASONS (lib/automations/hold-or-send.ts) wrote at the time, so
 * the Activity page has to read it back to its catalogue key at render time
 * (calendar/server-words.ts's inDrawerLanguage pattern) to say it in Spanish.
 */
describe("reasonInLanguage — a stored English reason, in the reader's language", () => {
  const fixed: [string, string][] = Object.entries(REASONS as Record<string, unknown>)
    .filter((e): e is [string, string] => typeof e[1] === "string");

  it("knows every fixed sentence REASONS can store, word for word (mutation: add a REASONS entry, or reword one -> FAILS naming it)", () => {
    const keys = REASON_KEYS as Record<string, keyof typeof m>;
    for (const [name, english] of fixed) {
      expect(keys[name], `REASONS.${name} has no catalogue key in REASON_KEYS`).toBeDefined();
      expect(m[keys[name]!], `REASONS.${name}`).toBe(english);
      expect((m as Record<string, string>)[`${keys[name]}.es`], `REASONS.${name} has no Spanish`).toBeTruthy();
    }
    expect(Object.keys(REASON_KEYS).sort()).toEqual(fixed.map(([n]) => n).sort());
  });

  it("says every fixed sentence in Spanish, and never the English (mutation: return the stored text -> FAILS)", () => {
    for (const [name, english] of fixed) {
      const es = reasonInLanguage(english, "es");
      expect(es, `REASONS.${name}`).not.toBe(english);
      expect(es).toBe((m as Record<string, string>)[`${(REASON_KEYS as Record<string, string>)[name]}.es`]);
    }
  });

  it("reads the quiet-hours shape back with its time, as REASONS.quietHours really writes it (mutation: match fixed sentences only -> FAILS)", () => {
    const stored = REASONS.quietHours(new Date("2026-10-08T13:00:00Z"), "America/Chicago");
    expect(reasonInLanguage(stored, "es")).toBe("En espera hasta las 8:00 a.m. — horario de silencio");
    const pm = REASONS.quietHours(new Date("2026-10-08T02:30:00Z"), "America/Chicago");
    expect(reasonInLanguage(pm, "es")).toBe("En espera hasta las 9:30 p.m. — horario de silencio");
  });

  it("an English reader gets the stored sentence untouched", () => {
    const stored = REASONS.quietHours(new Date("2026-10-08T13:00:00Z"), "America/Chicago");
    expect(reasonInLanguage(stored, "en")).toBe(stored);
    expect(reasonInLanguage(REASONS.dailyCap, "en")).toBe(REASONS.dailyCap);
  });

  it("text it does not know shows as stored, in either language (mutation: a Spanish fallback sentence -> FAILS)", () => {
    expect(reasonInLanguage("Provider said: 30007 carrier filtered", "es")).toBe("Provider said: 30007 carrier filtered");
  });
});
