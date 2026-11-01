import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";

// S-10 T3: the import page had no locale at all; now resolves it the same way the record,
// pipeline and To do pages do (requestLocale + getPersonPrefs + accounts.language).
let isAgency = true;
vi.mock("@/lib/auth", () => ({ requireNotTechnician: async () => ({ userId: "user_1", isAgency, role: null, canManage: true }) }));
let personLanguage: "en" | "es" | null = null;
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: personLanguage, theme: null }) }));
let accountLanguage: "en" | "es" | null = null;
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: (table: string) => {
      if (table !== "accounts") throw new Error(`unexpected table ${table}`);
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { language: accountLanguage }, error: null }) }) }) };
    },
  }),
}));
vi.mock("@bis/db", () => ({ listTags: async () => [] }));
vi.mock("./import-wizard", () => ({ ImportWizard: () => null }));

const { default: ImportContactsPage } = await import("./page");

function route(accountId = "acct1") {
  return { params: Promise.resolve({ accountId }) };
}

describe("ImportContactsPage reads the reader's language (S-10 T3)", () => {
  it("a client-role person on a Spanish account reads the header in Spanish (mutation: read m[...] directly -> FAILS)", async () => {
    isAgency = false;
    personLanguage = null;
    accountLanguage = "es";
    const html = renderToStaticMarkup(await ImportContactsPage(route()));
    expect(html).toContain(m["contacts.import.title.es"]);
    expect(html).not.toContain(m["contacts.import.title"]);
  });
  it("an agency operator reads English even on a Spanish account", async () => {
    isAgency = true;
    accountLanguage = "es";
    const html = renderToStaticMarkup(await ImportContactsPage(route()));
    expect(html).toContain(m["contacts.import.title"]);
  });
});
