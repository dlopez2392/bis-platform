import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `vi.mock` is HOISTED above every `const` in this file, so a bare
// `const db = {...}` referenced inside a mock factory throws a TDZ
// ReferenceError before a single test runs. `vi.hoisted` is the fix, and it
// is already the pattern in `b/[publicId]/actions.test.ts` and
// `api/voice/web/session/route.test.ts`.
const dbFns = vi.hoisted(() => ({
  getVoiceProfileByPublicId: vi.fn(),
  createConciergeConversation: vi.fn(),
  getConciergeConversation: vi.fn(),
  claimConciergeTurn: vi.fn(),
  appendConciergeTurns: vi.fn(),
  setConciergeSubmission: vi.fn(),
  countConciergeConversationsByIp: vi.fn(),
  countConciergeConversationsForAccount: vi.fn(),
  getForm: vi.fn(),
  createSubmission: vi.fn(),
  recordAutomationLog: vi.fn(async () => undefined),
  recordUsage: vi.fn(async () => "recorded"),
  syncWebchatTurns: vi.fn(),
  // S-47c: the price list read, the snapshot RPC (turn 1) and the stamped snapshot read (turn 2+).
  // Typed with a rest signature, so `mock.calls[0]![2]` (the payload) types; `vi.fn(async () => …)` types every call `[]`.
  listVoiceServices: vi.fn<(...a: unknown[]) => Promise<unknown[]>>(async () => []),
  ensureKnowledgeSnapshot: vi.fn<(...a: unknown[]) => Promise<number>>(async () => 5),
  getKnowledgeSnapshot: vi.fn(),
  // S-47d: the switch, the planned closed days and the calendar's hours (SD4). The real implementations
  // are spread in through `importOriginal` below; without an override here EVERY call would run against
  // the mocked `serviceDb()` stub above, which has no `.maybeSingle()` or `.order()` and would throw.
  getBusinessStatusRow: vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => null),
  listClosedDaysFrom: vi.fn<(...a: unknown[]) => Promise<unknown[]>>(async () => []),
  getCalendarForAccount: vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => null),
  // M7a PR-4 (plan G10): read only while BILLING_ENFORCE is "1".
  readBillingStanding: vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => null),
}));
const enrichMock = vi.hoisted(() => vi.fn());

// `after()` becomes a recorder we invoke ourselves — same pattern as
// api/voice/texml/route.test.ts. Spreading `actual` matters: the route
// returns `NextResponse` from this module too.
const afterMock = vi.hoisted(() => vi.fn());
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => unknown) => afterMock(cb) };
});
/** Runs every callback `after()` recorded so far, as production does once
 *  the response is sent, and clears them. */
async function flushAfter(): Promise<void> {
  const calls = [...afterMock.mock.calls];
  afterMock.mockClear();
  for (const [cb] of calls) await (cb as () => unknown)();
}

/**
 * The `accounts` read is a projection-filtered stub — the row below only
 * yields the columns the route's own `.select(...)` string asks for, so an
 * assertion about a column can only pass if the code requested it. Same trick
 * `api/voice/web/session/route.test.ts` uses, and the reason the internal
 * label below can never "accidentally" satisfy a scan.
 *
 * `name` carries the "— trial" suffix an agency label carries. The route must
 * never select it, and `brandDisplayName` (kept REAL through
 * `importOriginal`) must be what resolves what the visitor is told.
 */
const accountRow = {
  name: "Rio Woodworks — trial",
  timezone: "America/Chicago",
  brand_name: "Rio Woodworks",
};

const dbSpy = vi.hoisted(() => ({
  from: [] as string[],
  selects: [] as string[],
  eqs: [] as [string, unknown][],
  deletes: [] as { table: string; eq: [string, unknown][] }[],
  accountsError: null as { message: string } | null,
}));

vi.mock("@bis/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bis/db")>();
  return {
    ...actual,
    recordLanguageSignal: vi.fn(async () => true),
    serviceDb: () => ({
      from: (table: string) => {
        dbSpy.from.push(table);
        return {
          select: (cols: string) => {
            dbSpy.selects.push(cols);
            return {
              eq: (col: string, val: unknown) => {
                dbSpy.eqs.push([col, val]);
                return {
                  single: async () => {
                    if (dbSpy.accountsError) return { data: null, error: dbSpy.accountsError };
                    const wanted = cols.split(",").map((c) => c.trim());
                    return {
                      data: Object.fromEntries(
                        Object.entries(accountRow).filter(([key]) => wanted.includes(key)),
                      ),
                      error: null,
                    };
                  },
                };
              },
            };
          },
          delete: () => {
            const record = { table, eq: [] as [string, unknown][] };
            dbSpy.deletes.push(record);
            const chain = {
              eq: (col: string, val: unknown) => { record.eq.push([col, val]); return chain; },
              then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
            };
            return chain;
          },
        };
      },
    }),
    ...Object.fromEntries(
      Object.entries(dbFns).map(([name, fn]) => [name, (...a: unknown[]) => fn(...a)]),
    ),
  };
});
vi.mock("@/lib/forms/enrich", () => ({ enrich: enrichMock }));

// S-47b: the stamp must be the REGISTRY's version, never a literal. Version 7 exists nowhere else, so a
// route that writes 1 (or any constant) fails.
vi.mock("@/lib/voice/modules/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/voice/modules/events")>()),
  VERSION: 7,
}));

// minors-1b item 6: a passthrough spy (dashboard/layout.test.ts's own precedent on requestLocale) — the
// real effectiveStatusOrUnknown still runs, so every other test's prompt text is unchanged; this one
// alone asks whether it was called at ALL on a failed status read.
vi.mock("@/lib/business-status/status", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/business-status/status")>();
  return { ...actual, effectiveStatusOrUnknown: vi.fn(actual.effectiveStatusOrUnknown) };
});

import { POST } from "./route";
import { signRenderToken, RENDER_TOKEN_FIELD, HONEYPOT_FIELD } from "@/lib/forms/guards";
import {
  CONCIERGE_MAX_CONVERSATIONS_PER_IP, CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY,
  CONCIERGE_MAX_TURNS, CONCIERGE_MAX_MESSAGE_CHARS, CONCIERGE_MAX_REPLY_TOKENS,
} from "@/lib/concierge/guards";
import { conciergeStrings } from "@/lib/concierge/strings";
import { effectiveStatusOrUnknown } from "@/lib/business-status/status";

const PUBLIC_ID = "abc123abc123";
const PROFILE = {
  id: "p1", account_id: "a1", persona_name: "Sofía",
  greeting_en: "Hi", greeting_es: "Hola", facts: "We build tables.", services: "tables",
  languages: "both" as const, booking_enabled: true, after_hours: "message_only" as const,
  enabled: true, textback_enabled: false, textback_body: "",
  // Deliberately DIFFERENT from CONVERSATION.form_id below (I1, whole-branch
  // review): a lead must file against the form the CONVERSATION carries, not
  // whatever the profile points at NOW — an operator can change the
  // destination between turns (migration 0042's own comment on
  // `concierge_conversations.form_id`), and this profile column can go NULL
  // (FK `set null`) without stranding an in-flight chat, unlike the
  // conversation's own `restrict` column. Same literal on both would leave
  // every assertion below blind to which one the route actually read.
  public_id: PUBLIC_ID, concierge_enabled: true, concierge_form_id: "form-now",
  trade_module: null,
  business_hours: null,
};

const CONVERSATION = {
  id: "c1", account_id: "a1", form_id: "form-then", ip_hash: "h",
  turn_count: 1, transcript: [], submission_id: null, locale: "en",
  attribution: {}, origin: null,
  trade_module: null, trade_module_version: null,
  knowledge_version: null,
};

/** One exchange already on file: the conversation's first turn was answered. */
const ANSWERED_EXCHANGE = [
  { role: "visitor" as const, text: "do you build tables?", at: "2026-10-08T12:00:00Z" },
  { role: "assistant" as const, text: "Yes, we do.", at: "2026-10-08T12:00:01Z" },
];

const LEAD_FORM = {
  id: "form-then", account_id: "a1", public_id: "f", name: "Leads",
  status: "published" as const,
  // NO consent field. That is the point of the consent test below.
  fields: [
    { key: "n", kind: "core.first_name" as const, label: "First name", required: true },
    { key: "l", kind: "core.last_name" as const, label: "Last name", required: false },
    { key: "e", kind: "core.email" as const, label: "Email", required: false },
    { key: "m", kind: "message" as const, label: "What do you need?", required: false },
  ],
  theme: {}, success_mode: "message" as const, success_message: null,
  redirect_url: null, notify_emails: ["op@x.co"], locale_default: "en" as const,
  created_at: "", updated_at: "",
};

const fetchMock = vi.fn();

function modelReplies(text: string) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }) };
}

function modelCallsCaptureLead(args: Record<string, unknown>, content: string | null = null) {
  return {
    ok: true, status: 200,
    json: async () => ({
      choices: [{
        message: {
          content,
          tool_calls: [{
            id: "t1", type: "function",
            function: { name: "capture_lead", arguments: JSON.stringify(args) },
          }],
        },
      }],
    }),
  };
}

function post(body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return POST(
    new Request("https://app.test/api/concierge/x/turn", {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-vercel-forwarded-for": "1.2.3.4",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ publicId: PUBLIC_ID }) },
  );
}

/** The body Task 3's composer actually sends (`c/[publicId]/concierge-chat.tsx`). */
function firstTurn(extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return post({
    conversationId: null, text: "do you build tables?", locale: "en", attribution: {},
    // signRenderToken(nowMs, publicId) — nowMs FIRST (lib/forms/guards.ts:54).
    [RENDER_TOKEN_FIELD]: signRenderToken(Date.now() - 3_000, PUBLIC_ID),
    [HONEYPOT_FIELD]: "",
    ...extra,
  }, headers);
}

function laterTurn(extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return post({
    conversationId: "c1", text: "and a bench?", locale: "en",
    [RENDER_TOKEN_FIELD]: signRenderToken(Date.now() - 3_000, PUBLIC_ID),
    [HONEYPOT_FIELD]: "",
    ...extra,
  }, headers);
}

/** The model call's parsed request body — what we actually sent OpenAI. */
function sentToModel(call = 0) {
  const [url, init] = fetchMock.mock.calls[call]! as [string, { body: string }];
  expect(url).toBe("https://api.openai.com/v1/chat/completions");
  return JSON.parse(String(init.body)) as {
    model: string;
    messages: { role: string; content: string }[];
    tools: { function: { name: string } }[];
    max_tokens?: number;
  };
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(modelReplies("Yes, we do."));
  for (const fn of Object.values(dbFns)) fn.mockReset();
  enrichMock.mockReset();
  afterMock.mockReset();
  dbSpy.from.length = 0;
  dbSpy.selects.length = 0;
  dbSpy.eqs.length = 0;
  dbSpy.deletes.length = 0;
  dbSpy.accountsError = null;
  dbFns.getVoiceProfileByPublicId.mockResolvedValue(PROFILE);
  dbFns.countConciergeConversationsByIp.mockResolvedValue(0);
  dbFns.countConciergeConversationsForAccount.mockResolvedValue(0);
  dbFns.createConciergeConversation.mockResolvedValue({ id: "c1" });
  dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION });
  dbFns.claimConciergeTurn.mockResolvedValue(1);
  dbFns.appendConciergeTurns.mockResolvedValue(2);
  dbFns.getForm.mockImplementation(async (_db, _acct, id) => ({ ...LEAD_FORM, id }));
  dbFns.createSubmission.mockResolvedValue({ id: "s1" });
  dbFns.setConciergeSubmission.mockResolvedValue(true);
  dbFns.recordAutomationLog.mockResolvedValue(undefined);
  dbFns.recordUsage.mockResolvedValue("recorded");
  // What a sync with nothing to copy answers (S-06 part 3).
  dbFns.syncWebchatTurns.mockResolvedValue({ outcome: "nothing_new" });
  // S-47c: a successful empty list read and version 5, so every new chat is stamped.
  dbFns.listVoiceServices.mockResolvedValue([]);
  dbFns.ensureKnowledgeSnapshot.mockResolvedValue(5);
  // S-47d: a successful read with no row (open) and no closed days — the real default for an account that
  // has never touched the switch, so most tests here never think about it at all.
  dbFns.getBusinessStatusRow.mockResolvedValue(null);
  dbFns.listClosedDaysFrom.mockResolvedValue([]);
  dbFns.getCalendarForAccount.mockResolvedValue(null);
  // M7a PR-4: unbilled (no row) — and the switch is off unless a test stubs it.
  dbFns.readBillingStanding.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/concierge/[publicId]/turn — answering", () => {
  it("answers a first turn and returns the conversation id", async () => {
    const res = await firstTurn();
    expect(res.status).toBe(200);
    // `closing` rides on every response now (Important B, second-round
    // review of 108b822) so the anti-oracle key-set stays constant across
    // good and refused turns alike — empty here because this turn did not
    // end.
    expect(await res.json()).toEqual({
      conversationId: "c1", reply: "Yes, we do.", ended: false, closing: "",
    });
    expect(dbFns.appendConciergeTurns).toHaveBeenCalledTimes(1);
    const [, , turns] = dbFns.appendConciergeTurns.mock.calls[0]!;
    expect((turns as { role: string; text: string }[]).map((t) => [t.role, t.text])).toEqual([
      ["visitor", "do you build tables?"],
      ["assistant", "Yes, we do."],
    ]);
    // Part C: one `ai` automation-log row per conversation START — "website
    // chats" on the client's Activity page is the count of these.
    expect(dbFns.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "concierge", channel: "ai", subjectKey: "conversation:c1", status: "sent",
    }));
  });

  it("strips markdown emphasis before the visitor or the transcript sees it", async () => {
    // Seen live on bis-rgv.com, 2026-09-30: the bubble renders raw text, so
    // "**BIS Platform**" showed its asterisks on the page.
    fetchMock.mockResolvedValue(modelReplies("1. **BIS Platform**: our own CRM."));
    const res = await firstTurn();
    expect((await res.json()).reply).toBe("1. BIS Platform: our own CRM.");
    const [, , turns] = dbFns.appendConciergeTurns.mock.calls[0]!;
    expect((turns as { role: string; text: string }[]).at(-1)!.text).toBe("1. BIS Platform: our own CRM.");
  });

  it("replays the stored transcript, so turn two knows what turn one said", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({
      ...CONVERSATION,
      transcript: [
        { role: "visitor", text: "do you build tables?", at: "t0" },
        { role: "assistant", text: "Yes, we do.", at: "t1" },
      ],
    });
    await laterTurn();
    const body = sentToModel();
    // MUTATION: send only the system message and the new text — this FAILS,
    // and every turn answers as if it were the first.
    expect(body.messages.map((m) => [m.role, m.content]).slice(1)).toEqual([
      ["user", "do you build tables?"],
      ["assistant", "Yes, we do."],
      ["user", "and a bench?"],
    ]);
    expect(body.tools.map((t) => t.function.name)).toEqual(["capture_lead"]);
    // A continued conversation is not a new one — no second automation-log row.
    expect(dbFns.recordAutomationLog).not.toHaveBeenCalled();
  });

  it("calls the business by its BRAND name and never the agency's label", async () => {
    await firstTurn();
    const body = sentToModel();
    const system = body.messages[0]!.content;
    expect(system).toContain("Rio Woodworks");
    // MUTATION: pass `profile.persona_name` as businessName (the brief's own
    // code) — this FAILS: the prompt would say "the assistant on the website
    // for Sofía". MUTATION: add `name` to the select and pass `acct.name` —
    // the scan below finds "trial".
    expect(system).toContain("the assistant on the website for Rio Woodworks");
    expect(JSON.stringify(body).toLowerCase()).not.toContain("trial");
  });

  it("tells the model the business's own timezone, not UTC", async () => {
    await firstTurn();
    const system = sentToModel().messages[0]!.content;
    // MUTATION: `timezone: "UTC"` (the brief's own code) — this FAILS, and a
    // visitor asking "are you open now" is answered in the wrong zone.
    expect(system).toContain("America/Chicago");
    expect(system).not.toContain("UTC");
  });

  it("never offers a booking tool, whatever the tenant's own setting says", async () => {
    // PROFILE.booking_enabled is true. The web surface has no calendar.
    await firstTurn();
    const body = sentToModel();
    expect(body.tools).toHaveLength(1);
    expect(JSON.stringify(body.tools)).not.toContain("book_appointment");
    expect(body.messages[0]!.content).toContain("YOU CANNOT BOOK FROM HERE");
  });

  it("tells the model it has no take_message on this surface", async () => {
    await firstTurn();
    const system = sentToModel().messages[0]!.content;
    // `buildSystemPrompt` advertises take_message and log_transcript on every
    // OTHER medium; this route hands over exactly one tool, by passing
    // `medium: "web"` into the call below, which drives system-prompt.ts's
    // own `onWeb` branch (its comment there names the exact defect this
    // guards against: "a model told it has them on the web will SAY it took
    // a message that nothing recorded"). Stale-comment fix (I3, whole-branch
    // review): this used to name a mutation on a `WEB_TOOL_NOTICE` append
    // that no longer exists. MUTATION: change `medium: "web"` to anything
    // else in the route's own buildSystemPrompt call — this FAILS, and Sofía
    // tells a visitor she has taken a message that nothing recorded.
    expect(system).toContain("capture_lead is the ONLY tool you have here");
  });

  // Owner decision B (2026-10-09): "Always take a message" changed the PHONE
  // line only. PROFILE is message_only; the chat keeps its conditional line.
  it("keeps the old conditional after-hours line on a message_only profile, never the phone's MESSAGES ONLY", async () => {
    await firstTurn();
    const system = sentToModel().messages[0]!.content;
    expect(system).toContain("AFTER HOURS — If the business is closed right now, say so briefly, and use capture_lead");
    expect(system).not.toContain("MESSAGES ONLY");
  });

  // S-47a (D4): on Trial or On the visitor has already read the AI label and
  // the first message, so the identity line says so. Off keeps the old line.
  // MUTATION: pass `disclosed: false` always — the On case FAILS.
  it.each(["on", "trial"] as const)("tells the model the visitor already knows it is an AI on %s", async (disclosure) => {
    dbFns.getVoiceProfileByPublicId.mockResolvedValue({ ...PROFILE, disclosure });
    await firstTurn();
    const system = sentToModel().messages[0]!.content;
    expect(system).toContain("IDENTITY — You have already told the visitor that you are Sofía, an AI assistant.");
    expect(system).not.toContain("IDENTITY — Do not volunteer");
  });

  it("keeps the old identity line when the setting is off", async () => {
    dbFns.getVoiceProfileByPublicId.mockResolvedValue({ ...PROFILE, disclosure: "off" });
    await firstTurn();
    const system = sentToModel().messages[0]!.content;
    expect(system).toContain("IDENTITY — Do not volunteer");
    expect(system).not.toContain("You have already told the visitor");
  });

  it("answers with words when the model returns only a tool call", async () => {
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", phone: "9565550100", need: "a table" }));
    const res = await laterTurn();
    const body = await res.json() as { reply: string };
    // MUTATION: fall back to `strings.unavailable` — this FAILS, and the
    // visitor reads "Something went wrong" on the very turn their details
    // were filed.
    expect(body.reply).toBe(conciergeStrings("en").captured);
    // What they read is what the transcript stores.
    const [, , turns] = dbFns.appendConciergeTurns.mock.calls[0]!;
    expect((turns as { text: string }[])[1]!.text).toBe(conciergeStrings("en").captured);
  });

  // Minor 1 (second-round review of 108b822): `filed` used to seed from
  // `!!conversation.submission_id` alone, so an empty reply with NO tool
  // call this turn (`toolArgs === null`) on a conversation that already
  // filed a lead earlier still fell through to `strings.captured` — a
  // question the model failed to answer read as a fresh "we've got your
  // details."
  it("does not read an empty reply as a fresh capture on a conversation that already filed one", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, submission_id: "already" });
    fetchMock.mockResolvedValue(modelReplies(""));
    const res = await laterTurn();
    const body = await res.json() as { reply: string };
    // MUTATION: revert to `reply || (filed ? strings.captured :
    // strings.unavailable)` — this FAILS, and a turn with no tool call at
    // all reads as "Thanks, I have passed your details…" a second time.
    expect(body.reply).toBe(conciergeStrings("en").unavailable);
    expect(body.reply).not.toBe(conciergeStrings("en").captured);
  });

  it("truncates a very long message instead of rejecting it", async () => {
    const long = "x".repeat(CONCIERGE_MAX_MESSAGE_CHARS + 500);
    const res = await firstTurn({ text: long });
    expect(res.status).toBe(200);
    const last = sentToModel().messages.at(-1)!;
    expect(last.content).toHaveLength(CONCIERGE_MAX_MESSAGE_CHARS);
  });

  // I2 (whole-branch review): nothing bounded the model's OWN completion.
  // gpt-4o-mini can emit up to 16,384 output tokens, and every reply is
  // replayed into every later turn's transcript — `proposals/generate.ts`
  // already answered this exact question for its own OpenAI call
  // (`max_tokens: 2000`; see its test titled "bounds the model's own
  // completion so a runaway proposals array cannot be returned").
  it("bounds the model's own completion so a runaway reply cannot be returned (mutation: drop max_tokens from the request body -> FAILS)", async () => {
    await firstTurn();
    const body = sentToModel();
    expect(body.max_tokens).toBe(CONCIERGE_MAX_REPLY_TOKENS);
  });

  // I2, second half: max_tokens bounds the completion's TOKEN count, but 500
  // tokens of English can still print more than CONCIERGE_MAX_MESSAGE_CHARS
  // (2000) characters — the same bound already applied to the visitor's own
  // message must apply to what gets WRITTEN DOWN as Sofía's reply too, or the
  // stored side stays unbounded even after the model-side cap above.
  it("bounds the stored transcript entry so a long completion cannot bloat every later turn's payload (mutation: store `spoken` unsliced -> FAILS)", async () => {
    const long = "y".repeat(CONCIERGE_MAX_MESSAGE_CHARS + 500);
    fetchMock.mockResolvedValue(modelReplies(long));
    await firstTurn();
    const [, , turns] = dbFns.appendConciergeTurns.mock.calls[0]!;
    expect((turns as { role: string; text: string }[])[1]!.text)
      .toHaveLength(CONCIERGE_MAX_MESSAGE_CHARS);
  });

  it("stamps the visitor's line with the request's ARRIVAL and Sofía's with the moment after the model (spec G4; mutation: stamp both with `now` → equal times, FAILS)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-17T15:00:00.000Z"));
      fetchMock.mockImplementation(async () => {
        vi.setSystemTime(new Date("2026-10-17T15:00:02.500Z"));
        return modelReplies("Yes, we do.");
      });
      await laterTurn();
      const [, , turns] = dbFns.appendConciergeTurns.mock.calls[0]!;
      expect((turns as { role: string; at: string }[]).map((x) => [x.role, x.at])).toEqual([
        ["visitor", "2026-10-17T15:00:00.000Z"], ["assistant", "2026-10-17T15:00:02.500Z"],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("POST /api/concierge/[publicId]/turn — what a refusal costs", () => {
  it("404s an unknown or switched-off public id, with zero model calls", async () => {
    dbFns.getVoiceProfileByPublicId.mockResolvedValue(null);
    const res = await firstTurn();
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses once this IP is over its conversation cap, BEFORE the model call", async () => {
    dbFns.countConciergeConversationsByIp.mockResolvedValue(CONCIERGE_MAX_CONVERSATIONS_PER_IP);
    const res = await firstTurn();
    expect(res.status).toBe(429);
    // MUTATION: move the fetch above the cap check — this FAILS, and a
    // refused request starts costing money.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbFns.createConciergeConversation).not.toHaveBeenCalled();
  });

  it("refuses once this ACCOUNT is over its daily cap, BEFORE the model call", async () => {
    dbFns.countConciergeConversationsForAccount
      .mockResolvedValue(CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY);
    const res = await firstTurn();
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbFns.createConciergeConversation).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED when a counter throws", async () => {
    dbFns.countConciergeConversationsByIp.mockRejectedValue(new Error("db down"));
    const res = await firstTurn();
    // MUTATION: catch and continue — this FAILS. A guard failing open here
    // costs an unbounded number of model calls, not one.
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbFns.createConciergeConversation).not.toHaveBeenCalled();
  });

  // Minor (review of commit 129b43f): renamed from "…SAME body a good turn
  // gets" — the assertion below only ever compared `Object.keys(...).sort()`,
  // so it proves the response SHAPE matches, not the body. The anti-oracle
  // intent (a widget that answers differently tells a spammer which guard it
  // tripped) is unchanged; only the name now says what is actually checked.
  it("refuses a filled honeypot with the SAME response SHAPE a good turn gets", async () => {
    const good = await (await firstTurn()).json();
    fetchMock.mockClear();
    dbFns.createConciergeConversation.mockClear();
    const bad = await (await firstTurn({ [HONEYPOT_FIELD]: "bot" })).json();
    // Anti-oracle: a widget that answers differently tells a spammer which
    // guard it tripped.
    expect(Object.keys(bad as object).sort()).toEqual(Object.keys(good as object).sort());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbFns.createConciergeConversation).not.toHaveBeenCalled();
  });

  // Item 4 (Branch 2 hardening): a too-fast first message on a valid, FRESH
  // token is not a spam signal on its own — a fast typist, not a bot — so
  // this is a DIFFERENT ended path from the honeypot/bad-signature one below:
  // `ended: false`, and its own sentence, never `strings.ended`. The
  // honeypot test below still asserts `ended: true` — the two must differ.
  it("answers a first turn that arrived too fast with its own sentence, and keeps the composer open", async () => {
    const res = await firstTurn({ [RENDER_TOKEN_FIELD]: signRenderToken(Date.now(), PUBLIC_ID) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbFns.createConciergeConversation).not.toHaveBeenCalled();
    // MUTATION: fall through to the honeypot/bad-signature branch's
    // `ended: true, closing: strings.ended` — this FAILS, and a fast typist
    // reads the SAME dead end a bot gets, on a token the widget itself
    // minted moments ago.
    expect(await res.json()).toEqual({
      conversationId: "", reply: "", ended: false, closing: conciergeStrings("en").tooFast,
    });
    expect(conciergeStrings("en").tooFast).not.toBe(conciergeStrings("en").ended);
  });

  it("refuses a first turn whose token was minted for another widget", async () => {
    await firstTurn({ [RENDER_TOKEN_FIELD]: signRenderToken(Date.now() - 3_000, "someoneelse") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Minor (review of commit 129b43f): a visitor who opened the page and came
  // back to type more than MAX_TOKEN_AGE_MS (30 minutes) later never opened
  // a conversation — `strings.ended` ("This chat is closed…") describes a
  // chat that ran and reached a limit, and gives no path back but a reload.
  it("answers a first message typed too long after the page rendered with a distinct 'refresh' line, same shape", async () => {
    const res = await firstTurn({
      [RENDER_TOKEN_FIELD]: signRenderToken(Date.now() - 31 * 60_000, PUBLIC_ID),
    });
    expect(res.status).toBe(200);
    // MUTATION: drop the `verdict.reason === "expired"` branch — this FAILS,
    // and an expired page reads "This chat is closed" for a chat that never
    // opened.
    //
    // Important B (second-round review of 108b822): `reply` is EMPTY on
    // every ended path now — the closing sentence rides in `closing` only,
    // so the page never renders a bubble AND a fixed paragraph carrying two
    // different (and here contradictory) sentences.
    expect(await res.json()).toEqual({
      conversationId: "", reply: "", ended: true, closing: conciergeStrings("en").expired,
    });
    expect(conciergeStrings("en").expired).not.toBe(conciergeStrings("en").ended);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbFns.createConciergeConversation).not.toHaveBeenCalled();
  });

  // Important B: the start-guard refusal (honeypot, too-fast fill, or a
  // token minted for another widget) is a DIFFERENT ended path from the
  // expired-token one above — same `ended: true`, but the closing sentence
  // is `strings.ended`, not `strings.expired`, and `reply` is empty here
  // too so the fixed paragraph is the only place the sentence appears.
  it("a filled honeypot on turn 1 answers with an empty reply and 'ended' as the closing sentence", async () => {
    const res = await firstTurn({ [HONEYPOT_FIELD]: "bot" });
    // MUTATION: keep sending `strings.ended` back as `reply` (today's code)
    // — this FAILS, and the page's fixed `.bis-concierge-ended` paragraph
    // prints the same sentence a second time as a chat bubble.
    expect(await res.json()).toEqual({
      conversationId: "", reply: "", ended: true, closing: conciergeStrings("en").ended,
    });
  });

  it("does NOT re-check the render token on turn 2, even hours later", async () => {
    const res = await laterTurn({
      [RENDER_TOKEN_FIELD]: signRenderToken(Date.now() - 4 * 3_600_000, PUBLIC_ID),
    });
    // MUTATION: verify the token on every turn — this FAILS, and a panel left
    // open for half an hour dies mid-sentence.
    //
    // Status alone would NOT catch it: a start-guard refusal is `quiet()`,
    // which is also a 200. The answer itself is the evidence.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      conversationId: "c1", reply: "Yes, we do.", ended: false, closing: "",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a conversation belonging to another account", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, account_id: "SOMEONE_ELSE" });
    const res = await laterTurn();
    // MUTATION: drop the `conversation.account_id !== profile.account_id`
    // check — this FAILS, and a leaked id is drivable through any tenant's
    // widget.
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbFns.claimConciergeTurn).not.toHaveBeenCalled();
  });

  it("refuses a conversation id that does not exist", async () => {
    dbFns.getConciergeConversation.mockResolvedValue(null);
    const res = await laterTurn();
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ends the conversation at the turn cap without calling the model", async () => {
    dbFns.claimConciergeTurn.mockResolvedValue(null);
    const res = await laterTurn();
    expect(res.status).toBe(200);
    // Minor (review of commit 129b43f): `reply` is EMPTY here, not
    // `strings.ended` — the chat component renders the closing sentence from
    // `closing` alone, so this stays the only place it appears. MUTATION:
    // pass `strings.ended` back as `reply` — this FAILS.
    //
    // Important B (second-round review of 108b822): `closing` now carries
    // the sentence explicitly, on this path and the other two ended paths
    // alike — MUTATION: send `closing: ""` here — this FAILS, and the cap
    // arrives with no words at all for the visitor to read.
    expect(await res.json()).toEqual({
      conversationId: "c1", reply: "", ended: true, closing: conciergeStrings("en").ended,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses, and stores nothing, when the model call fails", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    const res = await laterTurn();
    expect(res.status).toBe(503);
    expect(dbFns.appendConciergeTurns).not.toHaveBeenCalled();
  });

  // D-050: the row was created, then the model failed, and the 503 carried no
  // id. The page retried as a FIRST turn, opening a second conversation and
  // spending a second of the visitor's three starts on one question.
  it("a failed FIRST reply hands back the conversation it opened, so the retry continues it", async () => {
    // A distinct id, so the retry can only find it by reading the 503.
    dbFns.createConciergeConversation.mockResolvedValue({ id: "c-opened" });
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, id: "c-opened" });
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    const res = await firstTurn();
    expect(res.status).toBe(503);
    const body = await res.json() as { conversationId?: string };
    expect(body).toEqual({ error: "unavailable", conversationId: "c-opened" });
    // The retry the page now sends, on whatever id the 503 carried. Had it
    // carried none, this is a first turn again and opens a second row.
    const retry = await post({
      conversationId: body.conversationId ?? null, text: "do you build tables?", locale: "en",
      [RENDER_TOKEN_FIELD]: signRenderToken(Date.now() - 3_000, PUBLIC_ID), [HONEYPOT_FIELD]: "",
    });
    expect(retry.status).toBe(200);
    expect(dbFns.createConciergeConversation).toHaveBeenCalledTimes(1);
    expect(dbFns.getConciergeConversation).toHaveBeenCalledWith(expect.anything(), "c-opened");
  });

  it("a FIRST turn that fails after its row exists, for any reason, still hands back the id", async () => {
    dbFns.claimConciergeTurn.mockRejectedValueOnce(new Error("db blip"));
    const res = await firstTurn();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable", conversationId: "c1" });
  });

  it("a FIRST turn refused before any row exists hands back no id", async () => {
    dbFns.countConciergeConversationsByIp.mockRejectedValueOnce(new Error("db blip"));
    const res = await firstTurn();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(dbFns.createConciergeConversation).not.toHaveBeenCalled();
  });

  it("refuses when the account read fails rather than prompting with a blank name", async () => {
    dbSpy.accountsError = { message: "boom" };
    const res = await firstTurn();
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    // Minor (review of commit 129b43f): this is turn 1. MUTATION: move the
    // account read back below `createConciergeConversation` — this FAILS,
    // and a misconfigured deployment burns a visitor's conversation budget
    // on a turn that never reaches the model.
    expect(dbFns.createConciergeConversation).not.toHaveBeenCalled();
  });

  it("refuses when no OpenAI key is configured, and claims no turn for it", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const res = await laterTurn();
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbFns.claimConciergeTurn).not.toHaveBeenCalled();
  });

  // Minor (review of commit 129b43f): the case above runs on turn 2, where
  // the key check already sat above `claimConciergeTurn`. Turn 1 is the bug —
  // the key check sat BELOW `createConciergeConversation`.
  it("refuses when no OpenAI key is configured on turn 1, without creating a conversation row", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const res = await firstTurn();
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    // MUTATION: move the key check back below `createConciergeConversation`
    // — this FAILS, and a deployment with no key inflates the per-IP and
    // per-account conversation counters on every visitor who ever tries it.
    expect(dbFns.createConciergeConversation).not.toHaveBeenCalled();
  });
});

describe("POST /api/concierge/[publicId]/turn — the budget Sofía is told about", () => {
  it("says nothing about the budget while the conversation has room", async () => {
    dbFns.claimConciergeTurn.mockResolvedValue(1);
    await laterTurn();
    expect(sentToModel().messages[0]!.content).not.toContain("ALMOST OVER");
  });

  it("tells her how many replies are left as the cap approaches", async () => {
    dbFns.claimConciergeTurn.mockResolvedValue(CONCIERGE_MAX_TURNS - 2);
    await laterTurn();
    const system = sentToModel().messages[0]!.content;
    // `remaining` counts the reply being written (Important 3): claimed is
    // 2 short of the cap, so 3 replies — this one plus 2 more — remain.
    // MUTATION: drop the budgetNotice append — this FAILS, and the cap
    // arrives with no name and no number, on a composer that has just
    // disabled itself.
    expect(system).toContain("3 replies left");
    expect(system).toContain("ALMOST OVER");
  });

  // Important 3 (review of commit 129b43f): `claimConciergeTurn` returns
  // the POST-increment count, so `claimed === CONCIERGE_MAX_TURNS` on the
  // FINAL permitted turn — the reply being written right now IS the last
  // one, not one of two more to come.
  it("tells her THIS is her last reply on the final permitted turn, not one more to come", async () => {
    dbFns.claimConciergeTurn.mockResolvedValue(CONCIERGE_MAX_TURNS);
    await laterTurn();
    const system = sentToModel().messages[0]!.content;
    // A correctness pin, not a mutation-isolating test on its own: reverting
    // the route's `+ 1` formula in isolation does NOT turn this red, because
    // `budgetNotice`'s `remaining <= 1` branch renders identically for
    // `remaining === 0` and `remaining === 1` — verified by running exactly
    // that mutation (see the report). The test below is the one that
    // isolates it.
    expect(system.toLowerCase()).toContain("last reply");
    expect(system).not.toContain("1 more reply");
  });

  // The formula fix is only OBSERVABLE, on its own, at the exact turn where
  // `remaining` crosses from the ">= 2" branch into the "<= 1" branch — one
  // turn EARLIER than the true cap under the old formula. This is the
  // mutation-isolating test: reverting `CONCIERGE_MAX_TURNS - claimed + 1`
  // to `CONCIERGE_MAX_TURNS - claimed` moves this exact turn's text from
  // "2 replies left" to "THIS IS YOUR LAST REPLY", one turn too soon.
  it("does not tell her to close one reply early — the second-to-last permitted turn still has two", async () => {
    dbFns.claimConciergeTurn.mockResolvedValue(CONCIERGE_MAX_TURNS - 1);
    await laterTurn();
    const system = sentToModel().messages[0]!.content;
    // MUTATION: revert to `CONCIERGE_MAX_TURNS - claimed` — this FAILS, and
    // the model is told to close a reply before the actual last one.
    expect(system).toContain("2 replies left");
    expect(system.toLowerCase()).not.toContain("last reply");
  });
});

describe("POST /api/concierge/[publicId]/turn — filing the lead", () => {
  it("files through enrich with consentWithheld TRUE, always", async () => {
    fetchMock.mockResolvedValue(modelCallsCaptureLead({
      fullName: "Ana García", email: "ana@x.co", need: "a table",
    }, "Got it."));

    await laterTurn({ text: "I'm Ana García, ana@x.co" });

    expect(enrichMock).toHaveBeenCalledTimes(1);
    const call = enrichMock.mock.calls[0]!;
    // The form above carries NO consent field. MUTATION: derive
    // consentWithheld from the form's fields — this FAILS, and a widget lead
    // triggers an automatic text nobody agreed to.
    expect(call[7]).toBe(true);
    expect(call[1]).toEqual(LEAD_FORM);
    expect(call[2]).toBe("s1");
    expect(call[6]).toBe("en");
  });

  // I3 (whole-branch review): the raw `Origin` header is spoofable and, from
  // inside a sandboxed iframe, is the literal string "null" — that used to
  // flow straight into the lead-alert email's dashboard link, producing
  // "null/dashboard/accounts/…". `lib/email/origin.ts`'s `originFrom` checks
  // APP_ORIGIN FIRST, same as enrich's other caller (f/[publicId]/actions.ts).
  it("builds the lead-alert link through originFrom(), never the raw (spoofable) Origin header", async () => {
    vi.stubEnv("APP_ORIGIN", "https://app.example");
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", phone: "9565550100", need: "a table" }));
    await laterTurn({}, { origin: "null" }); // what a sandboxed iframe actually sends
    expect(enrichMock).toHaveBeenCalledTimes(1);
    const call = enrichMock.mock.calls[0]!;
    // enrich(db, form, submissionId, answers, attribution, origin, locale, consentWithheld)
    // MUTATION: pass the raw `Origin` header instead of `originFrom(req.headers)`
    // — this FAILS: call[5] reads the literal string "null", not the
    // configured origin.
    expect(call[5]).toBe("https://app.example");
  });

  it("reads the destination form through the tenant boundary", async () => {
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", phone: "9565550100", need: "a table" }));
    await laterTurn();
    // getForm(db, accountId, formId) — the account id IS the boundary
    // (packages/db/src/forms.ts:97).
    const [, accountId, formId] = dbFns.getForm.mock.calls[0]!;
    expect([accountId, formId]).toEqual(["a1", "form-then"]);
  });

  // I1 (whole-branch review): the lead must file against the CONVERSATION's
  // own form_id, captured at conversation start, not the profile's CURRENT
  // concierge_form_id — an operator switching the destination form
  // mid-conversation must not strand a lead halfway (migration 0042's own
  // comment on the column). PROFILE.concierge_form_id is "form-now";
  // CONVERSATION.form_id is "form-then" — different literals on purpose.
  it("files against the conversation's OWN form, not whatever the profile points at now", async () => {
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", phone: "9565550100", need: "a table" }));
    await laterTurn();
    // MUTATION: revert to `profile.concierge_form_id` — this FAILS, and a
    // form switched mid-conversation reads/files against the wrong one.
    const [, , formId] = dbFns.getForm.mock.calls[0]!;
    expect(formId).toBe("form-then");
    expect(formId).not.toBe("form-now");
    const [, , submittedFormId] = dbFns.createSubmission.mock.calls[0]!;
    expect(submittedFormId).toBe("form-then");
  });

  it("maps the lead onto the form's own fields, by kind", async () => {
    fetchMock.mockResolvedValue(modelCallsCaptureLead({
      fullName: "Ana García", email: "ana@x.co", phone: "not a phone", need: "a dining table",
    }));
    await laterTurn();
    const [, , , input] = dbFns.createSubmission.mock.calls[0]!;
    expect((input as { answers: unknown }).answers).toEqual([
      { key: "n", label: "First name", value: "Ana" },
      { key: "l", label: "Last name", value: "García" },
      { key: "e", label: "Email", value: "ana@x.co" },
      { key: "m", label: "What do you need?", value: "a dining table" },
    ]);
  });

  it("drops a value the model invented rather than storing it", async () => {
    fetchMock.mockResolvedValue(modelCallsCaptureLead({
      // A valid phone so the lead files at all (danlo, 2026-10-09: a name
      // with no way to reach them is held, not filed); the form has no phone
      // field, so the answers are still the name and the need.
      fullName: "Ana", email: "not-an-address", phone: "9565550100", need: "a table",
    }));
    await laterTurn();
    const [, , , input] = dbFns.createSubmission.mock.calls[0]!;
    // MUTATION: pass `lead.email` without `isValidEmail` — this FAILS, and
    // the contact dedupe matches on a value that is not an address.
    expect((input as { answers: { key: string }[] }).answers.map((a) => a.key))
      .toEqual(["n", "m"]);
  });

  it("files nothing when the model called the tool with no name, and does not thank them for details it never stored", async () => {
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ email: "ana@x.co", need: "a table" }));
    const res = await laterTurn();
    expect(res.status).toBe(200);
    expect(dbFns.createSubmission).not.toHaveBeenCalled();
    expect(enrichMock).not.toHaveBeenCalled();
    // Important 1 (review of commit 129b43f): `reply` used to be computed
    // from `toolArgs` alone, BEFORE `fileLead` ran — so a visitor who gave
    // an email and a need but no name read "Thanks. I have passed your
    // details to the team…" while nothing was written, and that exact
    // sentence was stored as Sofía's own words in the transcript.
    // MUTATION: choose `strings.captured` before `fileLead` runs (revert to
    // `reply || (toolArgs ? strings.captured : strings.unavailable)`) — this
    // FAILS.
    const body = await res.json() as { reply: string };
    expect(body.reply).not.toBe(conciergeStrings("en").captured);
    expect(body.reply).toBe(conciergeStrings("en").unavailable);
    const [, , turns] = dbFns.appendConciergeTurns.mock.calls[0]!;
    expect((turns as { text: string }[])[1]!.text).toBe(body.reply);
  });

  it("files at most one submission per conversation", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, submission_id: "already" });
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", phone: "9565550100", need: "again" }));
    await laterTurn();
    // MUTATION: drop the submission_id guard — this FAILS, and one visitor
    // becomes two contacts.
    expect(dbFns.createSubmission).not.toHaveBeenCalled();
    expect(enrichMock).not.toHaveBeenCalled();
  });

  it("leaves no orphan row when a concurrent turn claimed the slot first", async () => {
    dbFns.setConciergeSubmission.mockResolvedValue(false);
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", phone: "9565550100", need: "a table" }));
    await laterTurn();
    // MUTATION: call enrich regardless of the boolean — this FAILS, and the
    // loser of the race creates a second contact, thread and alert.
    expect(enrichMock).not.toHaveBeenCalled();
    // The row was written BEFORE the claim (setConciergeSubmission needs its
    // id), so the loser has to clean up after itself.
    expect(dbSpy.deletes).toEqual([
      { table: "form_submissions", eq: [["id", "s1"], ["account_id", "a1"]] },
    ]);
  });

  it("still answers the visitor when filing the lead throws", async () => {
    dbFns.createSubmission.mockRejectedValue(new Error("db down"));
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", phone: "9565550100", need: "a table" }, "Got it."));
    const res = await laterTurn();
    expect(res.status).toBe(200);
    expect((await res.json() as { reply: string }).reply).toBe("Got it.");
  });

  it("files nothing when the destination form is no longer published, and does not claim it filed anyway", async () => {
    dbFns.getForm.mockResolvedValue({ ...LEAD_FORM, status: "draft" as const });
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", phone: "9565550100", need: "a table" }));
    const res = await laterTurn();
    expect(dbFns.createSubmission).not.toHaveBeenCalled();
    expect(enrichMock).not.toHaveBeenCalled();
    // Important 1: the reply used to be decided BEFORE `fileLead` ran, so an
    // unpublished form still produced "Thanks. I have passed your details…".
    const body = await res.json() as { reply: string };
    expect(body.reply).not.toBe(conciergeStrings("en").captured);
  });
});

/**
 * D-047: the model never received the capture's result. Its words came back
 * in the SAME completion as the capture_lead call, written before anything
 * was filed, so "I have passed your details on" could reach the visitor (and
 * the transcript) beside a capture that failed. The prompt told it never to
 * say so "unless capture_lead came back successful", which it could not
 * know. Now a capture turn makes a second call carrying the real result.
 */
describe("POST /api/concierge/[publicId]/turn — the capture's result reaches the model (D-047)", () => {
  const PRE_RESULT = "Thanks, I have passed your details on to the team.";
  type Sent = { messages: { role: string; content: string | null; tool_call_id?: string }[]; tool_choice?: string };

  it("a FAILED capture: the model is told it failed, and the visitor never reads the words it wrote before knowing", async () => {
    dbFns.createSubmission.mockRejectedValue(new Error("db down"));
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana", phone: "9565550100", need: "a table" }, PRE_RESULT))
      .mockResolvedValueOnce(modelReplies("Sorry, I could not save your details just now."));
    const res = await laterTurn();
    const body = await res.json() as { reply: string };
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = sentToModel(1) as unknown as Sent;
    const tool = second.messages.at(-1)!;
    expect(tool.role).toBe("tool");
    expect(tool.tool_call_id).toBe("t1");
    expect(JSON.parse(String(tool.content))).toMatchObject({ ok: false });
    expect(body.reply).toBe("Sorry, I could not save your details just now.");
    expect(body.reply).not.toBe(PRE_RESULT);
    const [, , turns] = dbFns.appendConciergeTurns.mock.calls[0]!;
    expect((turns as { text: string }[])[1]!.text).toBe(body.reply);
  });

  it("a FILED capture: the model is told it worked, and writes the reply from that", async () => {
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana", email: "hello@x.co", need: "a table" }))
      .mockResolvedValueOnce(modelReplies("Got it, Ana. The team will be in touch."));
    const res = await laterTurn();
    const body = await res.json() as { reply: string };
    expect(enrichMock).toHaveBeenCalledTimes(1);
    const second = sentToModel(1) as unknown as Sent;
    expect(JSON.parse(String(second.messages.at(-1)!.content))).toMatchObject({ ok: true });
    expect(body.reply).toBe("Got it, Ana. The team will be in touch.");
  });

  it("the follow-up call cannot call the tool again", async () => {
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana", email: "hello@x.co", need: "a table" }))
      .mockResolvedValueOnce(modelReplies("Done."));
    await laterTurn();
    expect((sentToModel(1) as unknown as Sent).tool_choice).toBe("none");
  });

  it("a capture with no name tells the model what is missing", async () => {
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ email: "ana@x.co", need: "a table" }, PRE_RESULT))
      .mockResolvedValueOnce(modelReplies("Could I get your name?"));
    const res = await laterTurn();
    const content = JSON.parse(String((sentToModel(1) as unknown as Sent).messages.at(-1)!.content));
    expect(content).toMatchObject({ ok: false });
    expect(String(content.error)).toMatch(/name/i);
    // Review: `parseCaptureLead` rejects only a missing name (or unreadable
    // arguments), so the result must not claim an email or phone is required.
    expect(String(content.error)).not.toMatch(/email|phone/i);
    expect((await res.json() as { reply: string }).reply).toBe("Could I get your name?");
  });

  /** The tool result the follow-up call carried, parsed. */
  function toolResult(): { ok: boolean; result?: string; error?: string; note?: string } {
    return JSON.parse(String((sentToModel(1) as unknown as Sent).messages.at(-1)!.content));
  }

  // A name and a need is a filable lead (`required: ["fullName", "need"]`),
  // but nobody can call it back. "The team will follow up" would be a promise
  // with no way to keep it.
  // danlo, 2026-10-09: a name with no email and no phone is HELD, not filed.
  // Filing it would spend the conversation's ONE lead slot on a lead the team
  // cannot act on, and a later capture carrying the number would then be
  // refused as "already on file". Held, the slot stays free and the model is
  // told to ask for a way to reach them.
  it("a name with no email and no phone files NOTHING, and the model is told to ask for one", async () => {
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana", need: "a table" }, "Thanks, I have passed that on."))
      .mockResolvedValueOnce(modelReplies("What is the best number or email to reach you, Ana?"));
    const res = await laterTurn();
    expect(dbFns.createSubmission).not.toHaveBeenCalled();
    expect(dbFns.setConciergeSubmission).not.toHaveBeenCalled();
    expect(enrichMock).not.toHaveBeenCalled();
    const r = toolResult();
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/email address or a phone number/i);
    expect(String(r.error)).toMatch(/ask/i);
    expect((await res.json() as { reply: string }).reply)
      .toBe("What is the best number or email to reach you, Ana?");
  });

  it("an email and phone that are not valid hold the lead the same way (the validators filing uses)", async () => {
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana", email: "hello@", phone: "call me", need: "a table" }))
      .mockResolvedValueOnce(modelReplies("Could I get an email or a number?"));
    await laterTurn();
    expect(dbFns.createSubmission).not.toHaveBeenCalled();
    expect(String(toolResult().error)).toMatch(/email address or a phone number/i);
  });

  it("once a later capture carries a phone, the held lead files normally with the name", async () => {
    // Turn A: name only, held.
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana García", need: "a table" }))
      .mockResolvedValueOnce(modelReplies("What number can the team reach you on?"));
    await laterTurn();
    expect(dbFns.createSubmission).not.toHaveBeenCalled();
    // Turn B: the slot is still free (nothing was filed), and the phone arrives.
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana García", phone: "9565550100", need: "a table" }))
      .mockResolvedValueOnce(modelReplies("Thanks, Ana. The team will call you."));
    await laterTurn();
    expect(dbFns.createSubmission).toHaveBeenCalledTimes(1);
    expect(enrichMock).toHaveBeenCalledTimes(1);
    const [, , , input] = dbFns.createSubmission.mock.calls[0]!;
    expect((input as { answers: { key: string; value: string }[] }).answers)
      .toEqual(expect.arrayContaining([{ key: "n", label: "First name", value: "Ana" }]));
    const sent = JSON.parse(String((sentToModel(3) as unknown as Sent).messages.at(-1)!.content));
    expect(sent).toMatchObject({ ok: true });
  });

  // S-47b v3 (corpus run 2): placeholders never get stored (lib/voice/tools/placeholders.ts).
  it("a placeholder name ('User') files NOTHING: the 'unusable' answer plus what was dropped and why (mutation: route skips sanitizeWebLead -> FAILS)", async () => {
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "User", phone: "9565550100", need: "Urgent: flooding." }))
      .mockResolvedValueOnce(modelReplies("What's your name?"));
    await laterTurn();
    expect(dbFns.createSubmission).not.toHaveBeenCalled();
    expect(toolResult()).toEqual({
      ok: false, error: "Not recorded: their name is missing. Ask for it.",
      note: `Left out of the record, because a record holds only what they said: fullName "User" (a placeholder, not something they said). If you need any of it, ask them; never fill it in yourself.`,
    });
  });
  it("a name taken only from the email address files NOTHING; the visitor's own address does not count as saying it", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, transcript: [{ role: "visitor", text: "¿Más o menos cuánto cuesta asegurar mi casa?", at: "" }] });
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Juan", email: "juan.p@example.com", need: "Quote: home." }))
      .mockResolvedValueOnce(modelReplies("¿Cómo te llamas?"));
    await laterTurn({ text: "mi correo es juan.p@example.com" });
    expect(dbFns.createSubmission).not.toHaveBeenCalled();
    expect(toolResult().note).toContain(`fullName "Juan" (taken from their email address; they never said it)`);
  });
  // Review I-3: the most common capture, name and email in the SAME message that triggers capture_lead.
  it("a name typed in the CURRENT message counts as said: name and email together file (mutation: drop this turn's text from what was said -> FAILS)", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, transcript: [{ role: "visitor", text: "¿Más o menos cuánto cuesta asegurar mi casa?", at: "" }] });
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Juan", email: "juan.p@example.com", need: "Quote: home." }))
      .mockResolvedValueOnce(modelReplies("Gracias, Juan."));
    await laterTurn({ text: "Soy Juan, mi correo es juan.p@example.com" });
    expect(dbFns.createSubmission).toHaveBeenCalledTimes(1);
    expect(toolResult()).toEqual({ ok: true, result: "Recorded. The team will follow up with them." });
  });
  it("a name joined to the address by a comma in the current message is still said (review I-1)", async () => {
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Dan", email: "dan@example.com", need: "Quote: auto." }))
      .mockResolvedValueOnce(modelReplies("Thanks, Dan."));
    await laterTurn({ text: "Dan,dan@example.com" });
    expect(dbFns.createSubmission).toHaveBeenCalledTimes(1);
  });
  it("the same name, said by the visitor in an EARLIER turn, files normally (the whole transcript is read)", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, transcript: [{ role: "visitor", text: "Soy Juan", at: "" }] });
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Juan", email: "juan.p@example.com", need: "Quote: home." }))
      .mockResolvedValueOnce(modelReplies("Gracias, Juan."));
    await laterTurn({ text: "mi correo es juan.p@example.com" });
    expect(dbFns.createSubmission).toHaveBeenCalledTimes(1);
    expect(toolResult()).toEqual({ ok: true, result: "Recorded. The team will follow up with them." });
  });
  it("a placeholder part of the need is stripped before filing, and the model hears it", async () => {
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana", phone: "9565550100", need: "Quote: auto. Best time: no se indicó." }))
      .mockResolvedValueOnce(modelReplies("Thanks, Ana."));
    await laterTurn();
    const [, , , input] = dbFns.createSubmission.mock.calls[0]!;
    const answers = (input as { answers: { key: string; value: string }[] }).answers;
    expect(answers.map((a) => a.value)).not.toContain("Quote: auto. Best time: no se indicó.");
    expect(JSON.stringify(answers)).not.toContain("no se indic");
    expect(toolResult()).toMatchObject({ ok: true, note: expect.stringContaining(`need "Best time: no se indicó."`) });
  });

  it("a lead filed with a way to reach them says the team will follow up", async () => {
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana", phone: "9565550100", need: "a table" }))
      .mockResolvedValueOnce(modelReplies("Thanks, Ana."));
    await laterTurn();
    expect(String(toolResult().result)).toMatch(/will follow up/i);
  });

  // Item 4: a capture on a conversation that already filed its one lead
  // writes nothing (`submission_id` guard), so "their details are with the
  // team" would claim the NEW details reached anyone.
  it("a capture on a conversation that already has its lead: already recorded, the new details were not added", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, submission_id: "already" });
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana", email: "new@x.co", need: "a bench" }))
      .mockResolvedValueOnce(modelReplies("Noted."));
    await laterTurn();
    expect(dbFns.createSubmission).not.toHaveBeenCalled();
    const r = toolResult();
    expect(String(r.result ?? r.error)).toMatch(/already recorded/i);
    expect(String(r.result ?? r.error)).toMatch(/not added/i);
  });

  // Two tabs on one conversation: this turn lost the race, the OTHER turn
  // filed the lead. The save did not fail; a lead is on file.
  it("a capture that lost the race to another turn says a lead is already on file, not that the save failed", async () => {
    dbFns.getConciergeConversation
      .mockResolvedValueOnce({ ...CONVERSATION })
      .mockResolvedValue({ ...CONVERSATION, submission_id: "s-other-tab" });
    dbFns.setConciergeSubmission.mockResolvedValue(false);
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana", email: "hello@x.co", need: "a table" }))
      .mockResolvedValueOnce(modelReplies("Got it."));
    await laterTurn();
    const r = toolResult();
    expect(String(r.result ?? r.error)).toMatch(/already recorded/i);
    expect(String(r.result ?? r.error)).not.toMatch(/could not be saved/i);
  });

  // Item 6: the follow-up is skipped when the invocation has too little of
  // `maxDuration` left; the visitor reads the fixed line for what happened.
  it("with ~26s already spent, no follow-up call is made and the fixed line is shown", async () => {
    const realNow = Date.now.bind(Date);
    let skew = 0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + skew);
    try {
      fetchMock.mockImplementationOnce(async () => {
        skew = 26_000;
        return modelCallsCaptureLead({ fullName: "Ana", email: "hello@x.co", need: "a table" }, PRE_RESULT);
      });
      const res = await laterTurn();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(enrichMock).toHaveBeenCalledTimes(1);
      expect((await res.json() as { reply: string }).reply).toBe(conciergeStrings("en").captured);
    } finally {
      spy.mockRestore();
    }
  });

  it("when the follow-up call itself fails after a FAILED capture, the pre-result words are still never shown", async () => {
    dbFns.getForm.mockResolvedValue({ ...LEAD_FORM, status: "draft" as const });
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana", phone: "9565550100", need: "a table" }, PRE_RESULT))
      .mockRejectedValueOnce(new Error("timeout"));
    const res = await laterTurn();
    expect(res.status).toBe(200);
    const body = await res.json() as { reply: string };
    expect(body.reply).not.toBe(PRE_RESULT);
    expect(body.reply).toBe(conciergeStrings("en").unavailable);
  });

  it("when the follow-up call fails after a FILED capture, the visitor reads the fixed 'captured' line", async () => {
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana", email: "hello@x.co", need: "a table" }, PRE_RESULT))
      .mockRejectedValueOnce(new Error("timeout"));
    const res = await laterTurn();
    expect((await res.json() as { reply: string }).reply).toBe(conciergeStrings("en").captured);
  });

  it("a turn with no tool call makes exactly one model call", async () => {
    await laterTurn();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/concierge/[publicId]/turn — usage: one website chat, billed when Sofía's FIRST reply succeeds (client billing)", () => {
  // Every test FLUSHES after() before asserting, so "records nothing" means
  // nothing was scheduled either, not merely that it has not run yet.
  it("a first turn Sofía answered records ONE website chat against the conversation (mutation: drop the usage leg → FAILS)", async () => {
    const res = await firstTurn();
    expect(res.status).toBe(200);
    await flushAfter();
    expect(dbFns.recordUsage).toHaveBeenCalledTimes(1);
    expect(dbFns.recordUsage).toHaveBeenCalledWith(expect.anything(), {
      accountId: "a1", meter: "ai_chats", quantity: 1, occurredAt: expect.any(Date), sourceRef: "conversation:c1",
    });
  });

  it("records in after(), once the visitor has the reply, never before the response (mutation: await the usage write inline → recorded before the flush, FAILS)", async () => {
    const res = await firstTurn();
    expect(res.status).toBe(200);
    expect(dbFns.recordUsage).not.toHaveBeenCalled();
    expect(afterMock).toHaveBeenCalledTimes(1);
    await flushAfter();
    expect(dbFns.recordUsage).toHaveBeenCalledTimes(1);
  });

  it("a first turn where the model ONLY called capture_lead (no text; the lead was filed, the visitor reads the 'captured' line) bills exactly one chat (mutation: answered = Boolean(reply) → records nothing, FAILS)", async () => {
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", phone: "9565550100", need: "a table" }));
    const res = await firstTurn();
    expect(res.status).toBe(200);
    expect((await res.json() as { reply: string }).reply).toBe(conciergeStrings("en").captured);
    expect(dbFns.createSubmission).toHaveBeenCalledTimes(1);
    await flushAfter();
    expect(dbFns.recordUsage).toHaveBeenCalledTimes(1);
    expect(dbFns.recordUsage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ meter: "ai_chats", sourceRef: "conversation:c1" }));
  });

  it("a first turn whose model call FAILS (an OpenAI outage's 503) records nothing, though the conversation row exists (mutation: record at createConciergeConversation → FAILS)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const res = await firstTurn();
    expect(res.status).toBe(503);
    expect(dbFns.createConciergeConversation).toHaveBeenCalledTimes(1);
    await flushAfter();
    expect(dbFns.recordUsage).not.toHaveBeenCalled();
  });

  it("a first turn whose completion is EMPTY (the visitor reads the 'unavailable' line) records nothing (mutation: gate on the model call returning alone → FAILS)", async () => {
    fetchMock.mockResolvedValue(modelReplies(""));
    const res = await firstTurn();
    expect(res.status).toBe(200);
    expect((await res.json() as { reply: string }).reply).toBe(conciergeStrings("en").unavailable);
    await flushAfter();
    expect(dbFns.recordUsage).not.toHaveBeenCalled();
  });

  it("a later turn after an ANSWERED one records nothing: the chat was billed when it was first answered (mutation: drop the gate → FAILS)", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, transcript: ANSWERED_EXCHANGE });
    const res = await laterTurn();
    expect(res.status).toBe(200);
    await flushAfter();
    expect(dbFns.recordUsage).not.toHaveBeenCalled();
  });

  // Review of D-050: the retry of a failed first reply arrives WITH the
  // conversation id, so a `!priorId`-only gate never billed that chat at all.
  // "First answered turn" is what bills, whichever request it happens on.
  it("a failed first reply, then a retry that is answered, bills the chat exactly once", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    const failed = await firstTurn();
    expect(failed.status).toBe(503);
    const { conversationId } = await failed.json() as { conversationId: string };
    await flushAfter();
    expect(dbFns.recordUsage).not.toHaveBeenCalled();

    // The failed turn appended nothing, so the stored transcript is empty.
    expect(dbFns.appendConciergeTurns).not.toHaveBeenCalled();
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, transcript: [] });
    const retry = await post({ conversationId, text: "do you build tables?", locale: "en" });
    expect(retry.status).toBe(200);
    await flushAfter();
    expect(dbFns.recordUsage).toHaveBeenCalledTimes(1);
    expect(dbFns.recordUsage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      meter: "ai_chats", sourceRef: "conversation:c1",
    }));
  });

  // An EMPTY completion appends an exchange (the visitor's line and the
  // 'unavailable' sentence) without billing, so "the transcript is empty" is
  // not the same question as "nothing was answered yet".
  it("a turn answered after an unanswered one (empty completion) bills the chat", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({
      ...CONVERSATION,
      transcript: [
        { role: "visitor", text: "hello?", at: "2026-10-08T12:00:00Z" },
        { role: "assistant", text: conciergeStrings("en").unavailable, at: "2026-10-08T12:00:01Z" },
      ],
    });
    await laterTurn();
    await flushAfter();
    expect(dbFns.recordUsage).toHaveBeenCalledTimes(1);
  });

  it("an ordinary two-turn conversation still bills once", async () => {
    await firstTurn();
    await flushAfter();
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, transcript: ANSWERED_EXCHANGE });
    await laterTurn();
    await flushAfter();
    expect(dbFns.recordUsage).toHaveBeenCalledTimes(1);
  });

  it("a failing usage write leaves the visitor's answer untouched and never rejects the background work (mutation: remove recordUsageSafely's catch AND the callback's own try → the flushed callback rejects, FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    dbFns.recordUsage.mockRejectedValue(new Error("usage_events is down"));
    const res = await firstTurn();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ conversationId: "c1", reply: "Yes, we do.", ended: false, closing: "" });
    await expect(flushAfter()).resolves.toBeUndefined();
    expect(dbFns.recordUsage).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/concierge/[publicId]/turn — a lead's chat files on the customer's thread (S-06 part 3, spec §3)", () => {
  const LEAD = { fullName: "Ana", phone: "9565550100", need: "a table" };
  const filedEarlier = () => dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, submission_id: "s0" });

  it("a turn that files the lead schedules ONE sync in after(), for this account and chat, with no unread flag: the sync decides unread per row (final review P1; mutation: drop the sync → not called, FAILS; pass a caller flag again → a fourth argument, FAILS)", async () => {
    fetchMock.mockResolvedValue(modelCallsCaptureLead(LEAD));
    const res = await laterTurn();
    expect(res.status).toBe(200);
    expect(dbFns.syncWebchatTurns).not.toHaveBeenCalled();
    await flushAfter();
    expect(dbFns.syncWebchatTurns).toHaveBeenCalledTimes(1);
    expect(dbFns.syncWebchatTurns).toHaveBeenCalledWith(expect.anything(), "a1", "c1");
  });

  it("a lead filed on an earlier turn: every later turn syncs, the same three arguments (spec §4; mutation: sync only when filed THIS turn → not called, FAILS)", async () => {
    filedEarlier();
    await laterTurn();
    await flushAfter();
    expect(dbFns.syncWebchatTurns).toHaveBeenCalledWith(expect.anything(), "a1", "c1");
  });

  it("another tab filed it first: this turn syncs too (route.ts:567-568; mutation: sync on outcome 'filed' only → not called, FAILS)", async () => {
    dbFns.setConciergeSubmission.mockResolvedValue(false);
    dbFns.getConciergeConversation
      .mockResolvedValueOnce({ ...CONVERSATION })
      .mockResolvedValueOnce({ ...CONVERSATION, submission_id: "s-other-tab" });
    fetchMock.mockResolvedValue(modelCallsCaptureLead(LEAD));
    await laterTurn();
    await flushAfter();
    expect(dbFns.syncWebchatTurns).toHaveBeenCalledWith(expect.anything(), "a1", "c1");
  });

  it("no lead on file, or a held capture: no sync (decision 1; mutation: sync on every answered turn → FAILS)", async () => {
    await firstTurn();
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana" }));
    await laterTurn();
    await flushAfter();
    expect(dbFns.syncWebchatTurns).not.toHaveBeenCalled();
  });

  it("no refusal schedules one, even on a chat with a lead: unknown widget, the turn cap, a failed model call (spec §3 'Where it does NOT run'; mutation: schedule before the claim → the cap case calls it, FAILS)", async () => {
    filedEarlier();
    dbFns.getVoiceProfileByPublicId.mockResolvedValueOnce(null);
    expect((await laterTurn()).status).toBe(404);
    dbFns.claimConciergeTurn.mockResolvedValueOnce(null);
    expect(((await (await laterTurn()).json()) as { ended: boolean }).ended).toBe(true);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    expect((await laterTurn()).status).toBe(503);
    await flushAfter();
    expect(dbFns.syncWebchatTurns).not.toHaveBeenCalled();
  });

  it("a sync that throws or fails leaves the visitor's response byte-identical, the background work resolves, and each log line names the account only (decision 5; mutation: run the sync inline → the body changes or the turn 503s, FAILS; log the chat id → FAILS)", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    filedEarlier();
    const baseline = await (await laterTurn()).text();
    await flushAfter();
    const lines = (msg: string) => logs.mock.calls.map((c) => String(c[0])).filter((l) => l.includes(`"msg":"${msg}"`)).map((l) => JSON.parse(l));
    dbFns.syncWebchatTurns.mockRejectedValueOnce(new Error("db down for c1 Ana 9565550100"));
    expect(await (await laterTurn()).text()).toBe(baseline);
    await expect(flushAfter()).resolves.toBeUndefined();
    dbFns.syncWebchatTurns.mockResolvedValueOnce({ outcome: "failed", stage: "keys" });
    expect(await (await laterTurn()).text()).toBe(baseline);
    await flushAfter();
    dbFns.syncWebchatTurns.mockResolvedValueOnce({ outcome: "no_customer" });
    await laterTurn();
    await flushAfter();
    dbFns.syncWebchatTurns.mockResolvedValueOnce({ outcome: "filed", result: { inserted: 1, visitorInserted: 1, unreadRaised: 0, stoppedAt: 1, failedSteps: ["unread"] } });
    await laterTurn();
    await flushAfter();
    expect(lines("webchat sync failed")).toEqual([
      { at: "concierge/turn", msg: "webchat sync failed", accountId: "a1", stage: "threw" },
      { at: "concierge/turn", msg: "webchat sync failed", accountId: "a1", stage: "keys" },
    ]);
    expect(lines("webchat sync dropped")).toEqual([{ at: "concierge/turn", msg: "webchat sync dropped", accountId: "a1", reason: "no customer" }]);
    expect(lines("webchat sync partial")).toEqual([{ at: "concierge/turn", msg: "webchat sync partial", accountId: "a1", inserted: 1, stopped: true, failedSteps: ["unread"] }]);
    const all = logs.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("webchat sync")).join("\n");
    expect(all).not.toMatch(/"c1"|Ana|9565550100/);
  });

  it("the visitor waits for nothing the sync does: a sync that never settles does not hold the reply (mutation: await the sync before returning → the race answers 'held', FAILS)", async () => {
    filedEarlier();
    dbFns.syncWebchatTurns.mockReturnValue(new Promise(() => {}));
    const res = await Promise.race([laterTurn(), new Promise<"held">((r) => setTimeout(() => r("held"), 2_000))]);
    expect(res).not.toBe("held");
    expect((res as Response).status).toBe(200);
  });

  // Task 3 review: `conversationId` in the body is the visitor's own string. Postgres matches any
  // spelling of the same uuid (`.eq("id", …)` on a uuid column), so after the tenant check every key,
  // the id handed to the sync and the id echoed back are the STORED row's, or one chat could be
  // billed, claimed and copied under two spellings.
  it("a chat id sent in another uuid spelling: the claim, the transcript, the sync and the reply all carry the STORED id (Task 3 review; mutation: `conversationId = priorId` → 'C1…' reaches them, FAILS)", async () => {
    const STORED = "0b7e3c2a-9f41-4d6e-8a52-3c1d9e7f6a10";
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, id: STORED, submission_id: "s0" });
    const res = await laterTurn({ conversationId: STORED.toUpperCase() });
    expect(dbFns.getConciergeConversation).toHaveBeenCalledWith(expect.anything(), STORED.toUpperCase());
    expect(((await res.json()) as { conversationId: string }).conversationId).toBe(STORED);
    expect(dbFns.claimConciergeTurn).toHaveBeenCalledWith(expect.anything(), STORED, CONCIERGE_MAX_TURNS);
    expect(dbFns.appendConciergeTurns).toHaveBeenCalledWith(expect.anything(), STORED, expect.any(Array));
    await flushAfter();
    expect(dbFns.syncWebchatTurns).toHaveBeenCalledWith(expect.anything(), "a1", STORED);
  });

  it("the same spelling on the chat's first answered turn, which also files the lead: the usage ledger's source and the lead's claimed slot carry the STORED id too (Task 4 M1; mutations: sourceRef from priorId → 'conversation:0B7E…', FAILS; fileLead's conversationId from priorId → setConciergeSubmission gets the upper-case spelling, FAILS)", async () => {
    const STORED = "0b7e3c2a-9f41-4d6e-8a52-3c1d9e7f6a10";
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, id: STORED });
    fetchMock.mockResolvedValue(modelCallsCaptureLead(LEAD));
    const res = await laterTurn({ conversationId: STORED.toUpperCase() });
    expect(res.status).toBe(200);
    // fileLead is the real one (lib/concierge/lead.ts): the slot it claims is keyed on the id it was given.
    expect(dbFns.setConciergeSubmission).toHaveBeenCalledTimes(1);
    expect(dbFns.setConciergeSubmission).toHaveBeenCalledWith(expect.anything(), STORED, expect.any(String));
    await flushAfter();
    expect(dbFns.recordUsage).toHaveBeenCalledTimes(1);
    expect(dbFns.recordUsage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ meter: "ai_chats", sourceRef: `conversation:${STORED}` }));
    expect(dbFns.syncWebchatTurns).toHaveBeenCalledWith(expect.anything(), "a1", STORED);
  });
});

describe("POST /api/concierge/[publicId]/turn — trade rules (S-47b)", () => {
  const EVT = "TRADE RULES — EVENTS AND VENUES:";
  const INS = "TRADE RULES — INSURANCE (PROPERTY AND CASUALTY):";

  it("turn 1, no module: the conversation is created exactly as before and the prompt carries no rules (mutation: pass tradeModule: null -> FAILS)", async () => {
    await firstTurn();
    expect(dbFns.createConciergeConversation).toHaveBeenCalledWith(expect.anything(), {
      accountId: "a1", formId: "form-now", ipHash: expect.any(String), locale: "en", attribution: {}, origin: null,
      knowledgeVersion: 5,
    });
    expect(sentToModel().messages[0]!.content).not.toContain("TRADE RULES —");
  });

  it("turn 1, events: the conversation is stamped with the registry's version and the first prompt carries the web events block (mutation: version literal -> FAILS)", async () => {
    dbFns.getVoiceProfileByPublicId.mockResolvedValue({ ...PROFILE, trade_module: "events" });
    await firstTurn();
    expect(dbFns.createConciergeConversation).toHaveBeenCalledWith(expect.anything(), {
      accountId: "a1", formId: "form-now", ipHash: expect.any(String), locale: "en", attribution: {}, origin: null,
      tradeModule: { module: "events", version: 7 }, knowledgeVersion: 5,
    });
    const system = sentToModel().messages[0]!.content;
    expect(system).toContain(EVT);
    expect(system).toContain(` Then, once you know whether anyone is hurt or in danger, use capture_lead with a need that starts with "Urgent:" as soon as you have their name and a phone number or email, and tell them the team will follow up as soon as they can. Never promise a time.`);
  });

  it("a later turn builds its prompt from the conversation's stamp, not the profile's current module (mutation: read profile.trade_module -> FAILS)", async () => {
    dbFns.getVoiceProfileByPublicId.mockResolvedValue({ ...PROFILE, trade_module: "events" });
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, trade_module: "insurance_pc", trade_module_version: 1 });
    await laterTurn();
    const system = sentToModel().messages[0]!.content;
    expect(system).toContain(INS);
    expect(system).not.toContain(EVT);
  });

  it("a chat begun with no module keeps none after the agency sets one (mutation: fall back to the profile -> FAILS)", async () => {
    dbFns.getVoiceProfileByPublicId.mockResolvedValue({ ...PROFILE, trade_module: "events" });
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, trade_module: null, trade_module_version: null });
    await laterTurn();
    expect(sentToModel().messages[0]!.content).not.toContain("TRADE RULES —");
  });

  it("the model is CONCIERGE_MODEL, gpt-4o-mini (SD6)", async () => {
    await firstTurn();
    expect(sentToModel().model).toBe("gpt-4o-mini");
  });
});

describe("POST /api/concierge/[publicId]/turn — what Sofía knows (S-47c)", () => {
  const SNAP = {
    schema: 1, facts: "Snapshot facts.", services_text: "Snapshot services", timezone: "America/Chicago",
    business_hours: null, hours_lines: null, renderer_version: 1,
    services: [{ position: 1, name_en: "Tables", name_es: null, description_en: null, description_es: null, price_kind: "fixed",
      amount_cents: 9900, amount_max_cents: null, unit_en: null, unit_es: null,
      sentence_en: "The price for Tables is $99.", sentence_es: "El precio de Tables es $99." }],
  };
  it("turn 1 stamps the conversation with the version the RPC returned and builds the first prompt from that payload, list included (mutation: build the prompt without priceList -> FAILS)", async () => {
    dbFns.listVoiceServices.mockResolvedValue([{ id: "s1", account_id: "a1", position: 1, created_at: "x", name_en: "Benches", name_es: null,
      description_en: null, description_es: null, price_kind: "from", amount_cents: 4500, amount_max_cents: null, unit_en: null, unit_es: null }]);
    dbFns.ensureKnowledgeSnapshot.mockResolvedValue(7);
    await firstTurn();
    expect(dbFns.createConciergeConversation.mock.calls[0]![1]).toMatchObject({ knowledgeVersion: 7 });
    const system = sentToModel().messages[0]!.content;
    expect(system).toContain(PROFILE.facts);
    expect(system).toContain(`- Benches — English: "The price for Benches starts at $45." Spanish: "El precio de Benches es desde $45."`);
    const sent = dbFns.ensureKnowledgeSnapshot.mock.calls[0]![2] as { services: { sentence_en: string }[] };
    expect(sent.services.map((x) => x.sentence_en)).toEqual(["The price for Benches starts at $45."]);
  });
  it("turn 1: the profile's hours reach the prompt and the payload (mutation: drop businessHours from the prompt -> FAILS)", async () => {
    dbFns.getVoiceProfileByPublicId.mockResolvedValue({ ...PROFILE, business_hours: { tue: [["08:00", "18:00"]] } });
    await firstTurn();
    expect(sentToModel().messages[0]!.content).toContain("BUSINESS HOURS (");
    expect((dbFns.ensureKnowledgeSnapshot.mock.calls[0]![2] as { business_hours: unknown }).business_hours).toEqual({ tue: [["08:00", "18:00"]] });
  });
  it("turn 1 with the services read failing: unstamped, and the C20 closed price line", async () => {
    dbFns.listVoiceServices.mockRejectedValue(new Error("listVoiceServices failed: boom"));
    await firstTurn();
    expect(dbFns.ensureKnowledgeSnapshot).not.toHaveBeenCalled();
    expect("knowledgeVersion" in (dbFns.createConciergeConversation.mock.calls[0]![1] as object)).toBe(false);
    expect(sentToModel().messages[0]!.content).toContain("- Do not give, confirm or estimate any price, rate or amount right now, not even one written above. If asked, say the business will confirm pricing and offer to take their details. This overrides any rule below that allows a price from the facts.");
  });
  it("a later turn builds from the STAMPED snapshot after the profile changed (C4; mutation: read the live profile -> FAILS)", async () => {
    dbFns.getVoiceProfileByPublicId.mockResolvedValue({ ...PROFILE, facts: "LIVE facts that changed." });
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, knowledge_version: 3 });
    dbFns.getKnowledgeSnapshot.mockResolvedValue({ id: "k", account_id: "a1", version: 3, payload: SNAP, created_at: "x", created_by: "system" });
    await laterTurn();
    const system = sentToModel().messages[0]!.content;
    expect(dbFns.getKnowledgeSnapshot).toHaveBeenCalledWith(expect.anything(), "a1", 3);
    expect(system).toContain("Snapshot facts.");
    expect(system).not.toContain("LIVE facts that changed.");
    expect(system).toContain(`- Tables — English: "The price for Tables is $99." Spanish: "El precio de Tables es $99."`);
    expect(dbFns.listVoiceServices).not.toHaveBeenCalled();
    expect(dbFns.ensureKnowledgeSnapshot).not.toHaveBeenCalled();
  });
  it("a later turn of a stamped chat tells the time in the SNAPSHOT's zone, not the account's current one (SD13; mutation: keep the account's timezone in the prompt -> FAILS)", async () => {
    // The account row (accountRow above) says America/Chicago; the chat began when the account said Denver.
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, knowledge_version: 3 });
    dbFns.getKnowledgeSnapshot.mockResolvedValue({ id: "k", account_id: "a1", version: 3, payload: { ...SNAP, timezone: "America/Denver" }, created_at: "x", created_by: "system" });
    await laterTurn();
    const system = sentToModel().messages[0]!.content;
    expect(system).toContain(" (America/Denver).");
    expect(system).not.toContain("America/Chicago");
  });
  it("an unstamped later turn reads the live profile and list, as today, and records nothing", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, knowledge_version: null });
    await laterTurn();
    expect(dbFns.getKnowledgeSnapshot).not.toHaveBeenCalled();
    expect(dbFns.listVoiceServices).toHaveBeenCalledTimes(1);
    expect(dbFns.ensureKnowledgeSnapshot).not.toHaveBeenCalled();
  });
  it("an unstamped later turn whose services read fails gets the C20 closed price line", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, knowledge_version: null });
    dbFns.listVoiceServices.mockRejectedValue(new Error("boom"));
    await laterTurn();
    expect(sentToModel().messages[0]!.content).toContain("- Do not give, confirm or estimate any price, rate or amount right now, not even one written above. If asked, say the business will confirm pricing and offer to take their details. This overrides any rule below that allows a price from the facts.");
  });
  it("a stamped snapshot read that THROWS answers 503 and spends no turn (SD12)", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, knowledge_version: 3 });
    dbFns.getKnowledgeSnapshot.mockRejectedValue(new Error("getKnowledgeSnapshot failed: boom"));
    const res = await laterTurn();
    expect(res.status).toBe(503);
    expect(dbFns.claimConciergeTurn).not.toHaveBeenCalled();
  });
  it("a stamped snapshot that is missing or does not parse falls back to the live knowledge (SD12)", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, knowledge_version: 3 });
    dbFns.getKnowledgeSnapshot.mockResolvedValue(null);
    await laterTurn();
    expect(sentToModel().messages[0]!.content).toContain(PROFILE.facts);
    // Bad data, not a missing row: a payload no build could have written.
    fetchMock.mockClear();
    dbFns.getKnowledgeSnapshot.mockResolvedValue({ id: "k", account_id: "a1", version: 3, payload: { ...SNAP, schema: 2 }, created_at: "x", created_by: "system" });
    await laterTurn();
    const system = sentToModel().messages[0]!.content;
    expect(system).toContain(PROFILE.facts);
    expect(system).not.toContain("Snapshot facts.");
  });
  it("turn 1 with the RPC failing creates the conversation unstamped and still answers", async () => {
    dbFns.ensureKnowledgeSnapshot.mockRejectedValue(new Error("boom"));
    const res = await firstTurn();
    expect(res.status).toBe(200);
    expect("knowledgeVersion" in (dbFns.createConciergeConversation.mock.calls[0]![1] as object)).toBe(false);
  });
});

describe("POST /api/concierge/[publicId]/turn — today's status and the closed days (S-47d, spec 5.4.3, S20, SD4)", () => {
  const STORM_ROW = {
    account_id: "a1", state: "storm" as const, late_minutes: null, until: null,
    set_by: "owner_1", set_at: "2026-10-23T12:00:00.000000Z",
  };
  const XMAS_LINE = {
    starts_on: "2026-12-24", ends_on: "2026-12-25", reason: "holiday" as const,
    line: "- Thursday, December 24 to Friday, December 25, 2026 (holiday)",
  };
  const SNAP2 = {
    schema: 2 as const, facts: "Snapshot facts.", services_text: "Snapshot services", timezone: "America/Chicago",
    business_hours: null, hours_lines: null, renderer_version: 2, services: [], closed_days: [XMAS_LINE],
  };

  it("the status read runs on EVERY turn — once on turn 1, once more on a later turn (mutation: read it only on turn 1 -> FAILS)", async () => {
    await firstTurn();
    await laterTurn();
    expect(dbFns.getBusinessStatusRow).toHaveBeenCalledTimes(2);
    expect(dbFns.getBusinessStatusRow).toHaveBeenCalledWith(expect.anything(), "a1");
  });

  it("a stamped turn's closed days come from the SNAPSHOT — listClosedDaysFrom is never called for it", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, knowledge_version: 3 });
    dbFns.getKnowledgeSnapshot.mockResolvedValue({ id: "k", account_id: "a1", version: 3, payload: SNAP2, created_at: "x", created_by: "system" });
    await laterTurn();
    expect(dbFns.listClosedDaysFrom).not.toHaveBeenCalled();
    expect(sentToModel().messages[0]!.content).toContain(
      "CLOSED DAYS (the business is closed all day on these dates, and no time on them can be booked):",
    );
    expect(sentToModel().messages[0]!.content).toContain("- Thursday, December 24 to Friday, December 25, 2026 (holiday)");
  });

  it("an unstamped later turn reads the closed days live, the same way turn 1 does", async () => {
    dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, knowledge_version: null });
    dbFns.listClosedDaysFrom.mockResolvedValue([{ id: "cd1", account_id: "a1", starts_on: "2026-12-24", ends_on: "2026-12-25", reason: "holiday", created_by: "owner_1", created_at: "2026-10-01T00:00:00Z" }]);
    await laterTurn();
    expect(dbFns.listClosedDaysFrom).toHaveBeenCalledWith(expect.anything(), "a1", expect.any(String));
    expect(sentToModel().messages[0]!.content).toContain("- Thursday, December 24 to Friday, December 25, 2026 (holiday)");
  });

  it("a storm status still sends exactly the capture_lead tool, unchanged in every state (D10)", async () => {
    dbFns.getBusinessStatusRow.mockResolvedValue(STORM_ROW);
    await firstTurn();
    expect(sentToModel().tools.map((t) => t.function.name)).toEqual(["capture_lead"]);
    expect(sentToModel().messages[0]!.content).toContain("TODAY: The business is closed because of a storm, until further notice.");
  });

  it("the calendar read runs only when this turn's payload carries no business hours (SD4; mutation: always read it -> FAILS)", async () => {
    // PROFILE.business_hours is null, so turn 1's live payload has none.
    await firstTurn();
    expect(dbFns.getCalendarForAccount).toHaveBeenCalledTimes(1);
    expect(dbFns.getCalendarForAccount).toHaveBeenCalledWith(expect.anything(), "a1");

    dbFns.getCalendarForAccount.mockClear();
    dbFns.getVoiceProfileByPublicId.mockResolvedValue({ ...PROFILE, business_hours: { tue: [["08:00", "18:00"]] } });
    await firstTurn();
    expect(dbFns.getCalendarForAccount).not.toHaveBeenCalled();
  });

  it("a status read that throws leaves the turn answering with no TODAY line, never a 503", async () => {
    dbFns.getBusinessStatusRow.mockRejectedValue(new Error("getBusinessStatusRow failed: boom"));
    const res = await firstTurn();
    expect(res.status).toBe(200);
    expect(sentToModel().messages[0]!.content).not.toContain("TODAY:");
  });

  // minors-1b item 6: today's prompt text is unaffected either way (effectiveStatusOrUnknown({row:
  // null, ...}) already reads "open", and todayLine("open") is already null) — but a failed read must
  // never be folded into "no row" and handed to effectiveStatusOrUnknown as if it were one; it must
  // short-circuit to effective=null directly, the same FAILED-marker shape api/voice/incoming/route.ts
  // already uses. This is the one check that tells the two shapes apart.
  it("a status read that throws skips effectiveStatusOrUnknown entirely — never folded into row: null (mutation: .catch(() => null) -> FAILS)", async () => {
    dbFns.getBusinessStatusRow.mockRejectedValue(new Error("getBusinessStatusRow failed: boom"));
    vi.mocked(effectiveStatusOrUnknown).mockClear();
    const res = await firstTurn();
    expect(res.status).toBe(200);
    expect(effectiveStatusOrUnknown).not.toHaveBeenCalled();
  });

  // Task 10 review (orchestrator ruling, S17 extended): the status row read can succeed (open) while the
  // closed-days read fails — [] is not "none planned", it is "unknown", and a day actually inside an unseen
  // closed range must never read as open.
  describe("a closed-days read that fails while the status reads open (S17 extended)", () => {
    it("is unknown, never a guessed open: no TODAY line, the turn is still answered", async () => {
      // dbFns.getBusinessStatusRow's default (beforeEach) is a successful `null` row — open.
      dbFns.listClosedDaysFrom.mockRejectedValue(new Error("listClosedDaysFrom failed: boom"));
      const res = await firstTurn();
      expect(res.status).toBe(200);
      expect(sentToModel().messages[0]!.content).not.toContain("TODAY:");
    });

    // "open" has no TODAY line either way (guessed or unknown), so a running_late row is what actually
    // proves this in the prompt text: its own TODAY line is a real string, and it does not depend on
    // closedDays at all for its STATE — exactly why it must still become unknown (a closed day this turn
    // could not see would have outranked it, S11), unlike closed_today/storm below.
    it("the same is true of a running_late row: no TODAY line (mutation: drop the unknown branch -> FAILS)", async () => {
      dbFns.getBusinessStatusRow.mockResolvedValue({
        account_id: "a1", state: "running_late" as const, late_minutes: 15,
        until: "2099-01-01T00:00:00.000000Z", set_by: "owner_1", set_at: "2026-10-23T12:00:00.000000Z",
      });
      dbFns.listClosedDaysFrom.mockRejectedValue(new Error("listClosedDaysFrom failed: boom"));
      const res = await firstTurn();
      expect(res.status).toBe(200);
      expect(sentToModel().messages[0]!.content).not.toContain("TODAY:");
    });

    it("a storm status stands on its own: the TODAY line survives a failed closed-days read", async () => {
      dbFns.getBusinessStatusRow.mockResolvedValue(STORM_ROW);
      dbFns.listClosedDaysFrom.mockRejectedValue(new Error("listClosedDaysFrom failed: boom"));
      await firstTurn();
      expect(sentToModel().messages[0]!.content).toContain("TODAY: The business is closed because of a storm, until further notice.");
    });
  });
});

// M7a PR-4 (plan G10; owner answer Q5): a paused account, or a plan without
// the website chat, answers exactly as a switched-off chat does, before
// anything is spent. A billing read error lets the chat answer (fail open).
describe("POST /api/concierge/[publicId]/turn — billing (BILLING_ENFORCE)", () => {
  const STANDING = {
    complimentary: false, pausedAt: null as string | null, subscriptionStatus: "active",
    features: { voice_receptionist: true, web_concierge: true },
  };
  const PAUSED = { ...STANDING, pausedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), subscriptionStatus: "past_due" };
  beforeEach(() => { vi.stubEnv("BILLING_ENFORCE", "1"); });

  it("switch on, paused → 404 not_found before any counter is spent (mutation: check after createConciergeConversation → FAILS)", async () => {
    dbFns.readBillingStanding.mockResolvedValue(PAUSED);
    const res = await firstTurn();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(dbFns.readBillingStanding).toHaveBeenCalledWith(expect.anything(), PROFILE.account_id);
    expect(dbFns.countConciergeConversationsByIp).not.toHaveBeenCalled();
    expect(dbFns.createConciergeConversation).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    const later = await laterTurn();
    expect(later.status).toBe(404);
    expect(dbFns.claimConciergeTurn).not.toHaveBeenCalled();
  });

  it("plan without the website chat → 404 (mutation: read voice instead of concierge → FAILS)", async () => {
    dbFns.readBillingStanding.mockResolvedValue({ ...STANDING, features: { voice_receptionist: true, web_concierge: false } });
    const res = await firstTurn();
    expect(res.status).toBe(404);
    expect(dbFns.createConciergeConversation).not.toHaveBeenCalled();
  });

  it("a plan without Sofía's phone line keeps the chat (the gate reads the chat's own feature)", async () => {
    dbFns.readBillingStanding.mockResolvedValue({ ...STANDING, features: { voice_receptionist: false, web_concierge: true } });
    expect((await firstTurn()).status).toBe(200);
  });

  it("a billing read error → the chat answers (mutation: return 404 on a read error → FAILS)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    dbFns.readBillingStanding.mockRejectedValue(new Error("billing: standing read failed: boom"));
    const res = await firstTurn();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ conversationId: "c1", reply: "Yes, we do." });
    vi.restoreAllMocks();
  });

  it("switch OFF and paused: the chat answers and billing is never read (mutation: read regardless → FAILS)", async () => {
    vi.stubEnv("BILLING_ENFORCE", "");
    dbFns.readBillingStanding.mockResolvedValue(PAUSED);
    expect((await firstTurn()).status).toBe(200);
    expect(dbFns.readBillingStanding).not.toHaveBeenCalled();
  });
});
