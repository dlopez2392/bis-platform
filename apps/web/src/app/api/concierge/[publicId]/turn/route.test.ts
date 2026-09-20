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
}));
const enrichMock = vi.hoisted(() => vi.fn());

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
  dbFns.getForm.mockResolvedValue(LEAD_FORM);
  dbFns.createSubmission.mockResolvedValue({ id: "s1" });
  dbFns.setConciergeSubmission.mockResolvedValue(true);
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

  it("refuses a first turn that arrived too fast to have been typed", async () => {
    await firstTurn({ [RENDER_TOKEN_FIELD]: signRenderToken(Date.now(), PUBLIC_ID) });
    expect(fetchMock).not.toHaveBeenCalled();
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
  // APP_ORIGIN FIRST, same as the enrich route's other two callers
  // (api/intake/[publicId]/route.ts, f/[publicId]/actions.ts).
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
