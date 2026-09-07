import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- @bis/db: the real package (so `brandDisplayName` is the real resolver,
// not a copy of it), with the four data reads replaced. `serviceDb` returns a
// projection-filtered `accounts` stub: the row below only yields the columns
// the route's own `.select(...)` string asks for, so an assertion on a column
// can only pass if the code requested it — the same trick
// `api/voice/incoming/route.test.ts` and `b/[publicId]/actions.test.ts` use.
const getPhoneNumberByE164Mock = vi.hoisted(() => vi.fn());
const getVoiceProfileMock = vi.hoisted(() => vi.fn());
const getOrCreateCalendarMock = vi.hoisted(() => vi.fn());
const dbQuerySpy = vi.hoisted(() => ({ fromCalls: [] as string[], eqCalls: [] as [string, unknown][] }));

/** The agency's INTERNAL label deliberately differs from `brand_name` and
 *  carries the "— trial" suffix such labels carry. The route no longer
 *  selects `name` at all, so the projection filter drops it; the scan at the
 *  bottom only passes if it stays dropped. */
const accountRow = {
  name: "Rio Roofing — trial", timezone: "America/Chicago",
  brand_name: "Rio Roofing Co", brand_logo_path: "logos/rio.png", brand_color: "#1a2b3c",
  brand_neutral: "warm" as const, brand_corners: "soft" as const, brand_type: "inter" as const,
  brand_mode: "light" as const, reply_to_email: "owner-reply@rio.example",
};

vi.mock("@bis/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bis/db")>();
  return {
    ...actual,
    serviceDb: () => ({
      from: (table: string) => {
        dbQuerySpy.fromCalls.push(table);
        return {
          select: (cols: string) => ({
            eq: (col: string, val: unknown) => {
              dbQuerySpy.eqCalls.push([col, val]);
              return {
                single: async () => {
                  const wanted = cols.split(",").map((c) => c.trim());
                  return {
                    data: Object.fromEntries(Object.entries(accountRow).filter(([key]) => wanted.includes(key))),
                    error: null,
                  };
                },
              };
            },
          }),
        };
      },
    }),
    getPhoneNumberByE164: (...a: unknown[]) => getPhoneNumberByE164Mock(...a),
    getVoiceProfile: (...a: unknown[]) => getVoiceProfileMock(...a),
    getOrCreateCalendar: (...a: unknown[]) => getOrCreateCalendarMock(...a),
  };
});

// --- web-demo: the ticket check is the website's signed token; everything
// else (origin allowlist, the appended notice) stays real. ------------------
vi.mock("@/lib/voice/web-demo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/web-demo")>();
  return { ...actual, verifyTicket: () => ({ ok: true as const }) };
});

import { POST } from "./route";

const ORIGIN = "https://bis-rgv.com";
const PHONE_ROW = { id: "pn1", account_id: "acct1", e164: "+19565550999", telnyx_id: null, status: "live" as const };
/** `greeting_en` blank on purpose: the route then builds its own
 *  "Thanks for calling …" line, the second place the name is spoken. */
const PROFILE_ROW = {
  id: "vp1", account_id: "acct1", persona_name: "Sofía",
  greeting_en: "", greeting_es: "",
  facts: "-", services: "-", languages: "en" as const, booking_enabled: true,
  after_hours: "hours_then_message" as const, enabled: true,
  textback_enabled: false, textback_body: null,
};
const CALENDAR_ROW = {
  id: "cal1", account_id: "acct1", public_id: "cal_pub1", enabled: true,
  slot_duration_minutes: 30, buffer_minutes: 0, min_notice_hours: 1, max_advance_days: 14,
  open_hours: {}, notify_emails: [], meeting_type: "phone" as const,
};

const fetchMock = vi.fn();

function req(): Request {
  return new Request("https://app.bis-rgv.com/api/voice/web/session", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ ticket: "signed-by-the-website" }),
  });
}

beforeEach(() => {
  vi.stubEnv("SOFIA_WEB_ORIGINS", ORIGIN);
  vi.stubEnv("SOFIA_WEB_SECRET", "s3cret");
  vi.stubEnv("SOFIA_WEB_NUMBER", "+19565550999");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ value: "ek_test", expires_at: 1 }) });
  getPhoneNumberByE164Mock.mockReset().mockResolvedValue(PHONE_ROW);
  getVoiceProfileMock.mockReset().mockResolvedValue(PROFILE_ROW);
  getOrCreateCalendarMock.mockReset().mockResolvedValue(CALENDAR_ROW);
  dbQuerySpy.fromCalls.length = 0;
  dbQuerySpy.eqCalls.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/voice/web/session — the name a website visitor hears", () => {
  /**
   * The web demo resolves the same tenant as the phone path and must call the
   * company the same thing: the BRAND name, never the agency's internal
   * `accounts.name` label. Until the brand-name resolver landed this route read
   * `acct.name` for both `businessName` and its default greeting, on a public
   * surface with no test at all.
   *
   * Mutation: re-add `name` to the route's `.select(...)` and its cast, and set
   * `businessName = acct.name` — the scan below finds "trial".
   */
  it("mints a session whose prompt carries the brand name and never the internal label", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);

    // The read really went to `accounts`, filtered by the resolved account id.
    expect(dbQuerySpy.fromCalls).toContain("accounts");
    expect(dbQuerySpy.eqCalls).toContainEqual(["id", "acct1"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, { body: string }];
    expect(url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    const sent = String(init.body);
    const { session } = JSON.parse(sent) as { session: { instructions: string; tools: unknown[] } };

    expect(session.instructions).toContain(accountRow.brand_name);
    // The whole minted body, lower-cased: the prompt upper-cases the name in
    // one line, and the label must not have reached ANY field. (The route's
    // own "Thanks for calling …" default greeting is built from the same
    // resolver but `buildSystemPrompt` does not embed `greeting`, so it never
    // appears in this body — the scan is the guard for both uses.)
    expect(sent.toLowerCase()).not.toContain("trial");
    // A stranger's browser gets no tools, regardless of the tenant's setting.
    expect(session.tools).toEqual([]);
  });

  it("refuses with 503, and mints nothing, when the accounts read fails", async () => {
    // Mutation: drop the `if (error || !account)` guard in the route — a
    // session would be minted on a row that never came back.
    const failing = {
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: "boom" } }) }) }) }),
    };
    const db = await import("@bis/db");
    const spy = vi.spyOn(db, "serviceDb").mockReturnValue(failing as unknown as ReturnType<typeof db.serviceDb>);
    try {
      const res = await POST(req());
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "unavailable" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
