import { describe, it, expect, vi, afterEach } from "vitest";
import { requestLocale } from "./request-locale";

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
    expect(requestLocale({ account: { language: "en" }, isOperator: false }, { locale: "es" })).toBe("es");
  });

  afterEach(() => vi.unstubAllEnvs());
});
