import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { formatCurrency } from "@/lib/format";

/**
 * The header's one number used to disagree with the account dashboard's
 * "Pipeline value" tile two different ways: it summed `totalValue` across
 * every stage (open + won + lost, not open only), AND it derived that sum
 * from `listBoard` — which reads only the ONE default pipeline, unpaged, so
 * a second pipeline or >1,000 open deals would still disagree with the
 * dashboard tile even after filtering by status. The fix calls
 * `sumOpenOpportunities` directly — the exact same call the dashboard tile
 * makes — so this test deliberately gives the board a DIFFERENT set of
 * numbers than the mocked `sumOpenOpportunities` result: if the header ever
 * goes back to deriving from `board`, it would show the board's numbers
 * instead, and this test would catch it.
 */

// F-085 part 1: the page now calls requireNotTechnician first (spec §7.1).
let isAgency = true;
vi.mock("@/lib/auth", () => ({ requireNotTechnician: async () => ({ userId: "user_1", isAgency, role: null, canManage: true }) }));

// S-10 T3: the page now resolves its own render locale (requestLocale + getPersonPrefs +
// accounts.language), the same convention tasks/page.tsx already uses.
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

const boardFixture = vi.hoisted(() => ({
  board: [] as Array<{
    stage: { id: string; name: string; position: number };
    totalValue: number;
    opportunities: Array<{ id: string; name: string; monetary_value: number; status: string;
      contact: { id: string; first_name: string | null; last_name: string | null } }>;
  }>,
}));

const sumOpenOpportunitiesMock = vi.hoisted(() => vi.fn());
const listContactsMock = vi.hoisted(() => vi.fn(async () => []));
const dialogProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));

vi.mock("@bis/db", () => ({
  ensureDefaultPipeline: async () => ({ pipelineId: "pipe1" }),
  listBoard: async () => boardFixture.board,
  listContacts: (...a: unknown[]) => listContactsMock(...(a as [])),
  sumOpenOpportunities: (...a: unknown[]) => sumOpenOpportunitiesMock(...a),
  // Unused by this test (never called — these only back the bound server
  // actions passed down as props), but actions.ts imports them from here.
  createOpportunity: vi.fn(),
  moveOpportunityToStage: vi.fn(),
  updateOpportunity: vi.fn(),
}));

vi.mock("./pipeline-board", () => ({ PipelineBoard: () => null }));
vi.mock("./add-opportunity-dialog", () => ({
  AddOpportunityDialog: (props: Record<string, unknown>) => { dialogProps.last = props; return null; },
}));

const { default: PipelinePage } = await import("./page");

function route(accountId = "acct1") {
  return { params: Promise.resolve({ accountId }) };
}

function opp(id: string, value: number, status: string) {
  return { id, name: id, monetary_value: value, status,
    contact: { id: "c1", first_name: "A", last_name: "B" } };
}

describe("PipelinePage header total", () => {
  it("renders sumOpenOpportunities' own count/value, not a figure derived from the board", async () => {
    // The board disagrees on purpose: 2 open deals worth $500 total here —
    // but sumOpenOpportunities (a second pipeline, or rows past this
    // board's reach) says 9 deals worth $9,999. If the header were still
    // reading the board, it would show "2 open · $500".
    boardFixture.board = [
      {
        stage: { id: "s1", name: "New Lead", position: 0 },
        totalValue: 900,
        opportunities: [opp("a", 400, "open"), opp("b", 500, "won")],
      },
      {
        stage: { id: "s3", name: "Proposal", position: 2 },
        totalValue: 100,
        opportunities: [opp("d", 100, "open")],
      },
    ];
    sumOpenOpportunitiesMock.mockReset();
    sumOpenOpportunitiesMock.mockResolvedValue({ count: 9, value: 9999 });

    const html = renderToStaticMarkup(await PipelinePage(route()));

    expect(html).toContain(`9 open · ${formatCurrency(9999)}`);
    // The board's own (wrong) figure must not leak through instead.
    expect(html).not.toContain(`2 open · ${formatCurrency(500)}`);
  });

  it("says 'open' plainly — the landscaper read, not the bare 'N · $X' the per-column subtotals use", async () => {
    boardFixture.board = [];
    sumOpenOpportunitiesMock.mockReset();
    sumOpenOpportunitiesMock.mockResolvedValue({ count: 2, value: 500 });

    const html = renderToStaticMarkup(await PipelinePage(route()));

    expect(html).toContain(`2 open · ${formatCurrency(500)}`);
  });

  it("scopes the call to this account", async () => {
    sumOpenOpportunitiesMock.mockReset();
    sumOpenOpportunitiesMock.mockResolvedValue({ count: 0, value: 0 });

    await PipelinePage(route("acct_specific"));

    expect(sumOpenOpportunitiesMock).toHaveBeenCalledWith(expect.anything(), "acct_specific");
  });
});

// S-10 T3: the page resolves its own locale (it had none before — spec row 9 "no locale on the page")
// and the header's title and count read it.
describe("PipelinePage reads the reader's language (S-10 T3)", () => {
  it("a client-role person on a Spanish account reads the header in Spanish (mutation: read m[...] directly -> FAILS)", async () => {
    // Review fix round (M-4): reset INSIDE finally — an assertion failure above must never
    // leave isAgency/accountLanguage dirty for the next test to inherit silently.
    isAgency = false;
    personLanguage = null;
    accountLanguage = "es";
    try {
      sumOpenOpportunitiesMock.mockReset();
      sumOpenOpportunitiesMock.mockResolvedValue({ count: 2, value: 500 });
      const html = renderToStaticMarkup(await PipelinePage(route()));
      expect(html).toContain(m["pipeline.title.es"]);
      expect(html).toContain(m["pipeline.openTotal.es"].replace("{count}", "2").replace("{value}", formatCurrency(500)));
      expect(html).not.toContain(m["pipeline.title"]);
    } finally {
      isAgency = true;
      accountLanguage = null;
    }
  });
  it("an agency operator reads English even on a Spanish account (requestLocale's role split)", async () => {
    isAgency = true;
    accountLanguage = "es";
    try {
      sumOpenOpportunitiesMock.mockReset();
      sumOpenOpportunitiesMock.mockResolvedValue({ count: 2, value: 500 });
      const html = renderToStaticMarkup(await PipelinePage(route()));
      expect(html).toContain(m["pipeline.title"]);
    } finally {
      accountLanguage = null;
    }
  });
  it("a single open deal reads the singular form, in Spanish too (mutation: drop pipeline.openTotalOne -> FAILS)", async () => {
    isAgency = false;
    accountLanguage = "es";
    try {
      sumOpenOpportunitiesMock.mockReset();
      sumOpenOpportunitiesMock.mockResolvedValue({ count: 1, value: 500 });
      const html = renderToStaticMarkup(await PipelinePage(route()));
      expect(html).toContain(m["pipeline.openTotalOne.es"].replace("{value}", formatCurrency(500)));
    } finally {
      isAgency = true;
      accountLanguage = null;
    }
  });

  // S-10 leftovers (#317 follow-up): the header's own money figure was built with
  // formatCurrency(total) — no locale — so a Spanish reader's header still carried an
  // en-US-tagged amount even once the surrounding words were Spanish.
  it("the header's own total passes es-US to Intl.NumberFormat, not the en-US default (mutation: call formatCurrency(total) with no locale -> FAILS)", async () => {
    isAgency = false;
    accountLanguage = "es";
    const Original = Intl.NumberFormat;
    const spy = vi.spyOn(Intl, "NumberFormat").mockImplementation(function (
      this: unknown, ...args: unknown[]
    ) {
      return new (Original as new (...a: unknown[]) => unknown)(...args);
    } as never);
    try {
      sumOpenOpportunitiesMock.mockReset();
      sumOpenOpportunitiesMock.mockResolvedValue({ count: 2, value: 500 });
      renderToStaticMarkup(await PipelinePage(route()));
      expect(spy.mock.calls.length).toBeGreaterThan(0);
      for (const call of spy.mock.calls) expect(call[0]).toBe("es-US");
    } finally {
      spy.mockRestore();
      isAgency = true;
      accountLanguage = null;
    }
  });
  // The QA override (`?locale=`, BIS_I18N_QA only) reaches this page's own locale resolution,
  // the same mechanism the record and To do pages already prove end to end.
  it("the QA override (?locale=es) turns the header Spanish even on an English account (mutation: drop { locale: localeParam } from requestLocale -> FAILS)", async () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      sumOpenOpportunitiesMock.mockReset();
      sumOpenOpportunitiesMock.mockResolvedValue({ count: 2, value: 500 });
      const html = renderToStaticMarkup(await PipelinePage({
        params: Promise.resolve({ accountId: "acct1" }), searchParams: Promise.resolve({ locale: "es" }),
      }));
      expect(html).toContain(m["pipeline.title.es"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // S-10 leftovers (#317 follow-up, item 6, "forged-locale" assertion): a value nothing in the
  // product ever sends ("fr", typed into the URL bar by hand) must fall back to the page's
  // normal resolution, never crash and never leak through as `lang` — requestLocale's own
  // isLocale() guard (request-locale.ts), proved end to end on this page.
  it("a forged ?locale= value (never 'en' or 'es') falls back to the normal resolution, never crashing or leaking through as lang (mutation: drop the isLocale() guard in requestLocale -> FAILS)", async () => {
    // Review fix round (M-4): sets its OWN isAgency/personLanguage/accountLanguage rather than
    // inheriting whatever an earlier test's cleanup (or failure to clean up) left behind — the
    // assertion below (English output) must hold because THIS test asked for it, not by accident
    // of test order.
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    isAgency = true;
    personLanguage = null;
    accountLanguage = null;
    try {
      sumOpenOpportunitiesMock.mockReset();
      sumOpenOpportunitiesMock.mockResolvedValue({ count: 2, value: 500 });
      const html = renderToStaticMarkup(await PipelinePage({
        params: Promise.resolve({ accountId: "acct1" }), searchParams: Promise.resolve({ locale: "fr" }),
      }));
      expect(html).toContain('lang="en"');
      expect(html).not.toContain('lang="fr"');
      expect(html).toContain(m["pipeline.title"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// The new-deal picker (F-092 out-of-scope finding): the page used to read the newest 200 contacts for a plain
// dropdown, so a deal for anyone older could not be added. The dialog now searches as you type, on its own.
describe("PipelinePage — the new-deal customer picker", () => {
  it("reads no contact list for the dialog, and hands it the account to search instead (mutation: keep listContacts({ limit: 200 }) -> FAILS)", async () => {
    sumOpenOpportunitiesMock.mockReset();
    sumOpenOpportunitiesMock.mockResolvedValue({ count: 0, value: 0 });
    listContactsMock.mockClear();
    dialogProps.last = null;
    renderToStaticMarkup(await PipelinePage(route("acct_specific")));
    expect(listContactsMock).not.toHaveBeenCalled();
    expect(dialogProps.last).toMatchObject({ accountId: "acct_specific", pipelineId: "pipe1" });
    expect(dialogProps.last).not.toHaveProperty("contacts");
  });
});
