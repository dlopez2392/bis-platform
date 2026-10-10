import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requestLocale, requestPseudoMode } from "./request-locale";

const here = path.dirname(fileURLToPath(import.meta.url));
const appsWebRoot = path.join(here, "..", "..", "..");

describe("requestLocale", () => {
  it("a CLIENT session reads the account's language (mutation: drop the isOperator branch → the operator test below also returns 'es', FAILS)", () => {
    expect(requestLocale({ account: { language: "es" }, isOperator: false })).toBe("es");
    expect(requestLocale({ account: { language: null }, isOperator: false })).toBe("en");
    expect(requestLocale({ account: null, isOperator: false })).toBe("en");
  });

  it("an OPERATOR session never reads the account's language, even on a Spanish account (owner decision 1; mutation: drop the isOperator branch → the operator-on-Spanish-account case returns es, FAILS)", () => {
    expect(requestLocale({ account: { language: "es" }, isOperator: true })).toBe("en");
  });

  it("an operator's OWN userLanguage still wins once it exists, even when it disagrees with the account's language (mutation: pass account.language instead of null in the operator branch → FAILS, since account is 'en' here but userLanguage is 'es' — a wrong implementation returns 'en', not 'es')", () => {
    expect(requestLocale({ account: { language: "en" }, isOperator: true, userLanguage: "es" })).toBe("es");
  });

  it("the ?locale= override applies only when BIS_I18N_QA is exactly \"1\" (mutation: drop the flag check → the unset case FAILS, honouring the override anyway)", () => {
    expect(requestLocale({ account: { language: "en" }, isOperator: false }, { locale: "es" })).toBe("en");
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", ""); // not a Vercel deployment, whatever the host env says
    expect(requestLocale({ account: { language: "en" }, isOperator: false }, { locale: "es" })).toBe("es");
  });

  // M2 (whole-branch review): a second, independent floor under the flag.
  // Vercel sets VERCEL on every deployment it builds or runs, so even a
  // BIS_I18N_QA=1 that somehow reached a deployment's env cannot turn the
  // override on there. A plain presence read — no value is parsed.
  it("the ?locale= override is refused on a Vercel deployment even with BIS_I18N_QA=\"1\" (mutation: drop the !process.env.VERCEL check → FAILS, the override applies)", () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "1");
    expect(requestLocale({ account: { language: "en" }, isOperator: false }, { locale: "es" })).toBe("en");
  });

  afterEach(() => vi.unstubAllEnvs());
});

describe("requestPseudoMode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is false on a Vercel deployment even with BIS_I18N_QA=\"1\" and ?locale=pseudo (mutation: drop the !process.env.VERCEL check → FAILS)", () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "1");
    expect(requestPseudoMode({ locale: "pseudo" })).toBe(false);
  });

  it("is false when BIS_I18N_QA is unset, even with ?locale=pseudo (mutation: drop the flag check → FAILS, returns true anyway)", () => {
    expect(requestPseudoMode({ locale: "pseudo" })).toBe(false);
  });

  it("is true only when BIS_I18N_QA=\"1\" AND ?locale=pseudo are BOTH present", () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    expect(requestPseudoMode({ locale: "pseudo" })).toBe(true);
    expect(requestPseudoMode({ locale: "es" })).toBe(false);
    expect(requestPseudoMode(undefined)).toBe(false);
  });
});

describe("BIS_I18N_QA never reaches a Vercel deployment (orchestrator checklist)", () => {
  // Source-scan, not an import: neither file is JSON-schema-free TypeScript
  // that is safe to `require()` from a vitest worker (next.config.ts expects
  // the Next.js build runtime), and a plain text search is exactly what a
  // stray `"BIS_I18N_QA"` in either file would look like, however it got
  // there (vercel.json's own top-level "env", a `NextConfig.env` entry, or a
  // careless copy-paste of Playwright's/CI's `env:` block).
  it("vercel.json names no such variable (mutation: add \"env\": { \"BIS_I18N_QA\": \"1\" } to vercel.json → FAILS)", () => {
    const vercelJson = readFileSync(path.join(appsWebRoot, "vercel.json"), "utf8");
    expect(vercelJson).not.toContain("BIS_I18N_QA");
  });

  it("next.config.ts names no such variable (mutation: add env: { BIS_I18N_QA: \"1\" } to next.config.ts → FAILS)", () => {
    const nextConfig = readFileSync(path.join(appsWebRoot, "next.config.ts"), "utf8");
    expect(nextConfig).not.toContain("BIS_I18N_QA");
  });
});
