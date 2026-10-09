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

import { POST } from "./route";
import { signRenderToken, RENDER_TOKEN_FIELD, HONEYPOT_FIELD } from "@/lib/forms/guards";
import {
  CONCIERGE_MAX_CONVERSATIONS_PER_IP, CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY,
  CONCIERGE_MAX_TURNS, CONCIERGE_MAX_MESSAGE_CHARS, CONCIERGE_MAX_REPLY_TOKENS,
} from "@/lib/concierge/guards";
import { conciergeStrings } from "@/lib/concierge/strings";

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
};

const CONVERSATION = {
  id: "c1", account_id: "a1", form_id: "form-then", ip_hash: "h",
  turn_count: 1, transcript: [], submission_id: null, locale: "en",
  attribution: {}, origin: null,
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

  it("answers with words when the model returns only a tool call", async () => {
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", need: "a table" }));
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
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", need: "a table" }));
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
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", need: "a table" }));
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
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", need: "a table" }));
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
      fullName: "Ana", email: "not-an-address", need: "a table",
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
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", need: "again" }));
    await laterTurn();
    // MUTATION: drop the submission_id guard — this FAILS, and one visitor
    // becomes two contacts.
    expect(dbFns.createSubmission).not.toHaveBeenCalled();
    expect(enrichMock).not.toHaveBeenCalled();
  });

  it("leaves no orphan row when a concurrent turn claimed the slot first", async () => {
    dbFns.setConciergeSubmission.mockResolvedValue(false);
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", need: "a table" }));
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
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", need: "a table" }, "Got it."));
    const res = await laterTurn();
    expect(res.status).toBe(200);
    expect((await res.json() as { reply: string }).reply).toBe("Got it.");
  });

  it("files nothing when the destination form is no longer published, and does not claim it filed anyway", async () => {
    dbFns.getForm.mockResolvedValue({ ...LEAD_FORM, status: "draft" as const });
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", need: "a table" }));
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
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana", email: "ana@x.co", need: "a table" }))
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
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana", email: "ana@x.co", need: "a table" }))
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
  function toolResult(): { ok: boolean; result?: string; error?: string } {
    return JSON.parse(String((sentToModel(1) as unknown as Sent).messages.at(-1)!.content));
  }

  // A name and a need is a filable lead (`required: ["fullName", "need"]`),
  // but nobody can call it back. "The team will follow up" would be a promise
  // with no way to keep it.
  it("a lead filed with a name but no email or phone: recorded, and the model is told nobody can reach them", async () => {
    fetchMock
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana", need: "a table" }))
      .mockResolvedValueOnce(modelReplies("Thanks, Ana."));
    await laterTurn();
    expect(enrichMock).toHaveBeenCalledTimes(1);
    const r = toolResult();
    expect(r.ok).toBe(true);
    expect(String(r.result)).toMatch(/no email address or phone number/i);
    expect(String(r.result)).not.toMatch(/will follow up/i);
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
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana", email: "ana@x.co", need: "a table" }))
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
        return modelCallsCaptureLead({ fullName: "Ana", email: "ana@x.co", need: "a table" }, PRE_RESULT);
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
      .mockResolvedValueOnce(modelCallsCaptureLead({ fullName: "Ana", email: "ana@x.co", need: "a table" }, PRE_RESULT))
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
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", need: "a table" }));
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
