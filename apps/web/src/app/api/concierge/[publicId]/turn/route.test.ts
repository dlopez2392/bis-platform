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
  CONCIERGE_MAX_TURNS, CONCIERGE_MAX_MESSAGE_CHARS,
} from "@/lib/concierge/guards";
import { conciergeStrings } from "@/lib/concierge/strings";

const PUBLIC_ID = "abc123abc123";
const PROFILE = {
  id: "p1", account_id: "a1", persona_name: "Sofía",
  greeting_en: "Hi", greeting_es: "Hola", facts: "We build tables.", services: "tables",
  languages: "both" as const, booking_enabled: true, after_hours: "message_only" as const,
  enabled: true, textback_enabled: false, textback_body: "",
  public_id: PUBLIC_ID, concierge_enabled: true, concierge_form_id: "form1",
};

const CONVERSATION = {
  id: "c1", account_id: "a1", form_id: "form1", ip_hash: "h",
  turn_count: 1, transcript: [], submission_id: null, locale: "en",
  attribution: {}, origin: null,
};

const LEAD_FORM = {
  id: "form1", account_id: "a1", public_id: "f", name: "Leads",
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

function post(body: Record<string, unknown>) {
  return POST(
    new Request("https://app.test/api/concierge/x/turn", {
      method: "POST",
      headers: { "content-type": "application/json", "x-vercel-forwarded-for": "1.2.3.4" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ publicId: PUBLIC_ID }) },
  );
}

/** The body Task 3's composer actually sends (`c/[publicId]/concierge-chat.tsx`). */
function firstTurn(extra: Record<string, unknown> = {}) {
  return post({
    conversationId: null, text: "do you build tables?", locale: "en", attribution: {},
    // signRenderToken(nowMs, publicId) — nowMs FIRST (lib/forms/guards.ts:54).
    [RENDER_TOKEN_FIELD]: signRenderToken(Date.now() - 3_000, PUBLIC_ID),
    [HONEYPOT_FIELD]: "",
    ...extra,
  });
}

function laterTurn(extra: Record<string, unknown> = {}) {
  return post({
    conversationId: "c1", text: "and a bench?", locale: "en",
    [RENDER_TOKEN_FIELD]: signRenderToken(Date.now() - 3_000, PUBLIC_ID),
    [HONEYPOT_FIELD]: "",
    ...extra,
  });
}

/** The model call's parsed request body — what we actually sent OpenAI. */
function sentToModel(call = 0) {
  const [url, init] = fetchMock.mock.calls[call]! as [string, { body: string }];
  expect(url).toBe("https://api.openai.com/v1/chat/completions");
  return JSON.parse(String(init.body)) as {
    model: string;
    messages: { role: string; content: string }[];
    tools: { function: { name: string } }[];
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
    expect(await res.json()).toEqual({
      conversationId: "c1", reply: "Yes, we do.", ended: false,
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
    // medium; this route hands over exactly one tool. MUTATION: drop the
    // WEB_TOOL_NOTICE append — this FAILS, and Sofía tells a visitor she has
    // taken a message that nothing recorded.
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

  it("truncates a very long message instead of rejecting it", async () => {
    const long = "x".repeat(CONCIERGE_MAX_MESSAGE_CHARS + 500);
    const res = await firstTurn({ text: long });
    expect(res.status).toBe(200);
    const last = sentToModel().messages.at(-1)!;
    expect(last.content).toHaveLength(CONCIERGE_MAX_MESSAGE_CHARS);
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

  it("refuses a filled honeypot with the SAME body a good turn gets", async () => {
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
      conversationId: "c1", reply: "Yes, we do.", ended: false,
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
    expect(await res.json()).toEqual({
      conversationId: "c1", reply: conciergeStrings("en").ended, ended: true,
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
  });

  it("refuses when no OpenAI key is configured, and claims no turn for it", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const res = await laterTurn();
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbFns.claimConciergeTurn).not.toHaveBeenCalled();
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
    // MUTATION: drop the budgetNotice append — this FAILS, and the cap
    // arrives with no name and no number, on a composer that has just
    // disabled itself.
    expect(system).toContain("2 more replies");
    expect(system).toContain("ALMOST OVER");
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

  it("reads the destination form through the tenant boundary", async () => {
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", need: "a table" }));
    await laterTurn();
    // getForm(db, accountId, formId) — the account id IS the boundary
    // (packages/db/src/forms.ts:97).
    const [, accountId, formId] = dbFns.getForm.mock.calls[0]!;
    expect([accountId, formId]).toEqual(["a1", "form1"]);
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

  it("files nothing when the model called the tool with no name", async () => {
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ email: "ana@x.co", need: "a table" }));
    const res = await laterTurn();
    expect(res.status).toBe(200);
    expect(dbFns.createSubmission).not.toHaveBeenCalled();
    expect(enrichMock).not.toHaveBeenCalled();
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

  it("files nothing when the destination form is no longer published", async () => {
    dbFns.getForm.mockResolvedValue({ ...LEAD_FORM, status: "draft" as const });
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana", need: "a table" }));
    await laterTurn();
    expect(dbFns.createSubmission).not.toHaveBeenCalled();
    expect(enrichMock).not.toHaveBeenCalled();
  });
});
