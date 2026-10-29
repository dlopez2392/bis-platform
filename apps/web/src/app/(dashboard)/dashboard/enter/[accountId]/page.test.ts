import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

/**
 * F-118 part 1 (plan Task 5, spec 3.2): the reason chooser, `/dashboard/enter/<accountId>`. Outside
 * `ACCT/` on purpose (spec 3.2), so none of ACCT's own guards or shell reads run here — this file mocks
 * only what the page itself calls.
 */
const authFixture = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireAgency: async () => {
    if (authFixture.fail) throw new Error("NEXT_REDIRECT:/sign-in");
    return { userId: "user_agency" };
  },
}));

const clerkFixture = vi.hoisted(() => ({ sessionId: "sess_1" as string | null }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ sessionId: clerkFixture.sessionId }) }));

const gateMocks = vi.hoisted(() => ({ agencyVisitOk: vi.fn() }));
vi.mock("@/lib/access-log/gate", () => ({
  agencyVisitOk: (...a: unknown[]) => gateMocks.agencyVisitOk(...a),
}));

const visitMocks = vi.hoisted(() => ({ lastVisitEndedRecently: vi.fn() }));
vi.mock("@/lib/access-log/visit", () => ({
  lastVisitEndedRecently: (...a: unknown[]) => visitMocks.lastVisitEndedRecently(...a),
}));

const dbFixture = vi.hoisted(() => ({
  data: { name: "E2E Co" } as { name: string } | null,
  error: null as { message: string } | null,
  calls: 0,
}));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => {
    dbFixture.calls++;
    return {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: dbFixture.data, error: dbFixture.error }) }),
        }),
      }),
    };
  },
}));

const prefsFixture = vi.hoisted(() => ({ language: null as "en" | "es" | null }));
vi.mock("@/lib/preferences/person-prefs", () => ({
  getPersonPrefs: async () => ({ language: prefsFixture.language, theme: null }),
}));

/** Keeps the real `notFound` control-flow contract (throws), same shape repo-wide. */
const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: () => { throw NOT_FOUND; },
  redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url }); },
}));

const { default: EnterPage } = await import("./page");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const page = (accountId = A, to?: string, extra: { locale?: string } = {}) =>
  EnterPage({
    params: Promise.resolve({ accountId }),
    searchParams: Promise.resolve({ ...(to === undefined ? {} : { to }), ...extra }),
  }).then(renderToStaticMarkup);

const redirectUrl = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    const url = (e as { url?: string }).url;
    if (url !== undefined) return url;
    throw e;
  }
  throw new Error("page resolved without redirecting");
};

beforeEach(() => {
  authFixture.fail = false;
  clerkFixture.sessionId = "sess_1";
  gateMocks.agencyVisitOk.mockReset().mockResolvedValue(false);
  visitMocks.lastVisitEndedRecently.mockReset().mockResolvedValue(false);
  dbFixture.data = { name: "E2E Co" };
  dbFixture.error = null;
  dbFixture.calls = 0;
  prefsFixture.language = null;
});

describe("the chooser — guards, before anything renders", () => {
  it("a non-UUID account id gives notFound before any read (mutation: skip the uuid check -> FAILS)", async () => {
    await expect(page("not-a-uuid")).rejects.toThrow(NOT_FOUND.message);
    expect(gateMocks.agencyVisitOk).not.toHaveBeenCalled();
    expect(dbFixture.calls).toBe(0);
  });

  it("requireAgency throwing stops everything before it: no visit check, no read (mutation: read before the gate -> FAILS)", async () => {
    authFixture.fail = true;
    await expect(page()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(gateMocks.agencyVisitOk).not.toHaveBeenCalled();
    expect(dbFixture.calls).toBe(0);
  });

  it("a live visit redirects at once to the safe `to`, re-validated through safeReturnPath (mutation: trust `to` unvalidated -> the account-B case below FAILS)", async () => {
    gateMocks.agencyVisitOk.mockResolvedValue(true);
    const to = `/dashboard/accounts/${A}/contacts/c1?x=1`;
    const url = await redirectUrl(page(A, to));
    expect(url).toBe(to);
    expect(dbFixture.calls).toBe(0);
  });

  it("a live visit with no safe `to` redirects to this account's own home, never another account's path (mutation: redirect(to ?? home) unvalidated -> FAILS, landing in B)", async () => {
    gateMocks.agencyVisitOk.mockResolvedValue(true);
    const url = await redirectUrl(page(A, `/dashboard/accounts/${B}/x`));
    expect(url).toBe(`/dashboard/accounts/${A}/dashboard`);
  });

  it("a missing account gives notFound (mutation: render with a blank name instead -> FAILS)", async () => {
    dbFixture.data = null;
    await expect(page()).rejects.toThrow(NOT_FOUND.message);
  });

  it("an account read error THROWS rather than 404ing (mutation: notFound() on an error -> FAILS)", async () => {
    dbFixture.error = { message: "permission denied for table accounts" };
    await expect(page()).rejects.toThrow("permission denied for table accounts");
  });
});

describe("the chooser — what it renders", () => {
  it("the heading, the four reason buttons in order, the notice, a form and the Back link (mutation: drop a tile, or reorder them -> FAILS)", async () => {
    const html = await page();
    const text = renderedText(html);
    expect(text).toContain("Why are you opening E2E Co?");
    const order = ["Setup", "Support request", "Fixing a problem", "Billing"].map((label) => text.indexOf(label));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text).toContain("The business's Owners can see each visit, its reason and everything you open.");
    expect(html).toContain("<form");
    expect(html).toMatch(/<a[^>]*href="\/dashboard\/accounts"[^>]*>/);
    expect(text).toContain("Back to accounts");
    expect(text).not.toContain("Your last visit here ended after 2 hours.");
  });

  it("shows the ended hint only when lastVisitEndedRecently says so (mutation: always show it -> FAILS)", async () => {
    visitMocks.lastVisitEndedRecently.mockResolvedValue(true);
    const html = await page();
    expect(renderedText(html)).toContain("Your last visit here ended after 2 hours.");
  });

  it("renders in Spanish when the reader's own stored language is es (mutation: ignore prefs.language -> FAILS)", async () => {
    prefsFixture.language = "es";
    const html = await page();
    const text = renderedText(html);
    expect(text).toContain("¿Por qué abre E2E Co?");
    expect(text).toContain("Solicitud de ayuda");
  });

  it("the QA override: ?locale=es renders Spanish with lang=es, ?locale=pseudo renders the pseudo-locale (mutation: drop the search param from requestLocale or makeTr -> FAILS)", async () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      const es = await page(A, undefined, { locale: "es" });
      expect(es).toContain('lang="es"');
      expect(renderedText(es)).toContain("¿Por qué abre E2E Co?");
      const pseudo = renderedText(await page(A, undefined, { locale: "pseudo" }));
      expect(pseudo).not.toContain("Why are you opening E2E Co?");
      expect(pseudo).not.toContain("Back to accounts");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("renders no primary button: four equal tiles and a ghost Back link (rule 8) (mutation: give a tile the primary treatment -> FAILS)", async () => {
    const html = await page();
    expect(html).not.toContain("bg-primary");
  });
});
