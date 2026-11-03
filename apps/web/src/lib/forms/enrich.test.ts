import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const dbMocks = vi.hoisted(() => ({
  createContact: vi.fn(), updateContact: vi.fn(), getContact: vi.fn(), linkSubmissionContact: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), incrementUnreadCount: vi.fn(), emitFormSubmitted: vi.fn(),
  setSubmissionProcessingError: vi.fn(), setContactsBusiness: vi.fn(), recordLanguageSignal: vi.fn(),
  insertAiActs: vi.fn(),
  // Contact archive (T9): a form or a chat lead brings an archived contact back.
  restoreContactOnSign: vi.fn(),
}));
// `phoneFields` stays REAL (importOriginal): the act records the phone as the contact write stores it.
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
// The receipt's send: not this file's question (the address answer has one, so it would try).
vi.mock("@/lib/consent/email-gate", () => ({ sendEmailOrThrow: vi.fn(async () => {}), EmailNotSent: class extends Error {} }));
const instantReply = vi.hoisted(() => vi.fn());
vi.mock("@/lib/automations/instant-reply", () => ({ sendInstantReply: (...a: unknown[]) => instantReply(...a) }));

import type { FormRow, serviceDb } from "@bis/db";
import { enrich, setAttribution } from "./enrich";

/** The one raw read `enrich` makes on this path: the account's language (no attribution, no
 *  notify addresses, no receipt address, so nothing else reaches `db.from`). */
const DB = {
  from: (table: string) => {
    if (table !== "accounts") throw new Error(`unexpected table ${table}`);
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { language: "en" }, error: null }) }) }) };
  },
} as unknown as ReturnType<typeof serviceDb>;

const FORM = {
  id: "form-1", account_id: "acct-A", public_id: "pub-1", name: "Contact us", status: "published",
  fields: [
    { key: "f", kind: "core.first_name", label: "First name" },
    { key: "l", kind: "core.last_name", label: "Last name" },
    { key: "e", kind: "core.email", label: "Email" },
    { key: "p", kind: "core.phone", label: "Phone" },
    { key: "c", kind: "core.company_name", label: "Business" },
    { key: "m", kind: "message", label: "Message" },
  ],
  notify_emails: [], locale_default: "en",
} as unknown as FormRow;
const ANSWERS = [
  { key: "f", label: "First name", value: "Ana" },
  { key: "l", label: "Last name", value: "Ruiz" },
  { key: "e", label: "Email", value: "  ana@example.com " },
  { key: "p", label: "Phone", value: "(956) 292-1696" },
  { key: "c", label: "Business", value: "Rio Roofing" },
  { key: "m", label: "Message", value: "A quote please" },
];

const chat = (over: { chatId?: string } = {}) => ({ chatId: over.chatId ?? "chat-9" });
const run = (webchat?: { chatId: string }) =>
  enrich(DB, FORM, "sub-1", ANSWERS, {}, null, "en", true, webchat);
const inserted = () => dbMocks.insertAiActs.mock.calls.map((c) => c[2] as unknown[]);

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.createContact.mockResolvedValue({ id: "ct-new", existing: false, flagged: false });
  dbMocks.ensureConversation.mockResolvedValue({ id: "cv-1", created: true });
  dbMocks.createMessage.mockResolvedValue({ id: "msg-1" });
  dbMocks.setContactsBusiness.mockResolvedValue([{ status: "ok" }]);
  dbMocks.updateContact.mockResolvedValue({ flagged: false });
  dbMocks.insertAiActs.mockResolvedValue(undefined);
  dbMocks.restoreContactOnSign.mockResolvedValue(false);
  instantReply.mockReset().mockResolvedValue({ kind: "skipped" });
});

describe("enrich: the public form is the customer's, the chat is Sofía's (item 8c)", () => {
  it("the public form (no ninth argument) records nothing and leaves the contact's author to the actor (customer)", async () => {
    await run();
    expect(dbMocks.createContact).toHaveBeenCalledTimes(1);
    expect(dbMocks.createContact.mock.calls[0]![2]).not.toHaveProperty("author");
    expect(dbMocks.createContact.mock.calls[0]!.slice(3)).toEqual(["form", "system"]);
    expect(dbMocks.insertAiActs).not.toHaveBeenCalled();
  });

  it("the chat stores an AI-made contact and records contact_created with the thread message and the submission, AFTER the message", async () => {
    const order: string[] = [];
    dbMocks.createMessage.mockImplementation(async () => { order.push("message"); return { id: "msg-1" }; });
    dbMocks.insertAiActs.mockImplementation(async () => { order.push("record"); });
    dbMocks.incrementUnreadCount.mockImplementation(async () => { order.push("unread"); });
    await run(chat());
    expect(dbMocks.createContact.mock.calls[0]![2]).toMatchObject({ author: { authorKind: "ai", authorId: null } });
    expect(dbMocks.insertAiActs).toHaveBeenCalledTimes(1);
    expect(dbMocks.insertAiActs.mock.calls[0]![1]).toBe("acct-A");
    // F-115: the act carries the id its insert named (the F-115 case below pins which).
    expect(inserted()).toEqual([[{
      actor: "webchat", callId: null, chatId: "chat-9", contactId: "ct-new", id: expect.stringMatching(/^[0-9a-f-]{36}$/), kind: "contact_created",
      target: { messageId: "msg-1", submissionId: "sub-1" }, before: null, after: null,
    }]]);
    expect(order).toEqual(["message", "record", "unread"]);
  });

  it("a chat lead that lands on an existing contact records one act per column filled, in the stored form, and no contact_created; the business is not an act", async () => {
    dbMocks.createContact.mockResolvedValue({ id: "ct-old", existing: true, flagged: false });
    dbMocks.getContact.mockResolvedValue({ id: "ct-old", first_name: "Ana", last_name: null, email: "", phone: null,
      company_name: null, custom: {} });
    await run(chat());
    expect(dbMocks.updateContact).toHaveBeenCalledTimes(1);
    // F-115: the first act carries the id the fill's write named (the F-115 block below pins which).
    expect(inserted()).toEqual([[
      { actor: "webchat", callId: null, chatId: "chat-9", contactId: "ct-old", id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        kind: "contact_field_filled", target: { field: "lastName" }, before: { value: null }, after: { value: "Ruiz" } },
      { actor: "webchat", callId: null, chatId: "chat-9", contactId: "ct-old", kind: "contact_field_filled",
        target: { field: "email" }, before: { value: "" }, after: { value: "ana@example.com" } },
      { actor: "webchat", callId: null, chatId: "chat-9", contactId: "ct-old", kind: "contact_field_filled",
        target: { field: "phone" }, before: { value: null }, after: { value: "+19562921696" } },
    ]]);
    expect(dbMocks.setContactsBusiness).toHaveBeenCalled();
  });

  // F-115 (plan Task 2 Step 7): the chat's insert names the act it logs (`via: ai_act:<id>`), and the act is
  // inserted under that same id. Mutation: mint the act's id apart from the via (two different uuids) -> FAILS.
  it("F-115: the chat's new contact names its contact_created act", async () => {
    await run(chat());
    const [made] = inserted()[0] as { id?: string }[];
    expect(made?.id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(dbMocks.createContact.mock.calls[0]![2]).toMatchObject({
      author: { authorKind: "ai", authorId: null }, via: `ai_act:${made!.id}`,
    });
  });

  it("F-115: the public form logs no act, so its insert names none", async () => {
    await run();
    expect(dbMocks.createContact.mock.calls[0]![2]).not.toHaveProperty("via");
  });

  it("a public-form lead on an existing contact fills the same columns and records nothing", async () => {
    dbMocks.createContact.mockResolvedValue({ id: "ct-old", existing: true, flagged: false });
    dbMocks.getContact.mockResolvedValue({ id: "ct-old", first_name: "Ana", last_name: null, email: null, phone: null,
      company_name: null, custom: {} });
    await run();
    expect(dbMocks.updateContact).toHaveBeenCalledTimes(1);
    expect(dbMocks.insertAiActs).not.toHaveBeenCalled();
  });

  it("a chat lead whose fill wrote nothing records nothing", async () => {
    dbMocks.createContact.mockResolvedValue({ id: "ct-old", existing: true, flagged: false });
    dbMocks.getContact.mockResolvedValue({ id: "ct-old", first_name: "Ana", last_name: "Ruiz", email: "a@x.example",
      phone: "+19560000000", company_name: "Rio", custom: {} });
    await run(chat());
    expect(dbMocks.updateContact).not.toHaveBeenCalled();
    expect(dbMocks.insertAiActs).not.toHaveBeenCalled();
  });

  it("a failed message write leaves the new contact unrecorded (the act needs the message it may remove)", async () => {
    dbMocks.createMessage.mockRejectedValue(new Error("db down"));
    await run(chat());
    expect(dbMocks.insertAiActs).not.toHaveBeenCalled();
  });

  it.each([
    ["a new contact", () => {}],
    ["an existing contact's fills", () => {
      dbMocks.createContact.mockResolvedValue({ id: "ct-old", existing: true, flagged: false });
      dbMocks.getContact.mockResolvedValue({ id: "ct-old", first_name: "Ana", last_name: null, email: null, phone: null,
        company_name: null, custom: {} });
    }],
  ] as const)("%s: a throwing insertAiActs changes nothing else the lead goes through (mutation: remove the try in recordActs -> FAILS)", async (_label, setup) => {
    // F-115: a new contact's insert names a freshly minted act id; one id for both runs, so the two runs' calls
    // compare on what this test is about.
    const uuid = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
    try {
      setup();
      await run(chat());
      const okCalls = Object.fromEntries(Object.entries(dbMocks).filter(([k]) => k !== "insertAiActs").map(([k, f]) => [k, f.mock.calls]));
      const withoutClock = (calls: unknown[][]) => calls.map(([input]) => ({ ...(input as object), now: "the clock" }));
      const okReply = withoutClock(instantReply.mock.calls);
      for (const fn of Object.values(dbMocks)) fn.mockClear();
      instantReply.mockClear();
      dbMocks.insertAiActs.mockReset().mockRejectedValue(Object.assign(new Error("down"), { code: "08006" }));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(run(chat())).resolves.toBeUndefined();
      err.mockRestore();
      expect(dbMocks.insertAiActs).toHaveBeenCalledTimes(1);
      const failedCalls = Object.fromEntries(Object.entries(dbMocks).filter(([k]) => k !== "insertAiActs").map(([k, f]) => [k, f.mock.calls]));
      expect(failedCalls).toEqual(okCalls);
      expect(withoutClock(instantReply.mock.calls)).toEqual(okReply);
      expect(okReply).toHaveLength(1);
      expect(dbMocks.setSubmissionProcessingError).not.toHaveBeenCalled();
    } finally {
      uuid.mockRestore();
    }
  });
});

// F-115 (plan Task 2 Step 7; orchestrator ruling 2026-11-02): a returning lead's fill is ONE write with ONE author.
// From the chat, Sofía extracted it and logs contact_field_filled acts, so the write is hers and names the first
// act; its custom fields ride the same write. From the public form it stays the customer's, with no via.
describe("F-115: a returning lead's fill names who made it", () => {
  const RETURNING = { id: "ct-old", first_name: "Ana", last_name: null, email: null, phone: null, company_name: null, custom: {} };
  const SOFIA = { authorKind: "ai", authorId: null };
  const CUSTOMER = { authorKind: "customer", authorId: "form" };
  beforeEach(() => {
    dbMocks.createContact.mockResolvedValue({ id: "ct-old", existing: true, flagged: false });
    dbMocks.getContact.mockResolvedValue(RETURNING);
  });

  it("(a) a chat fill is Sofía's, and its via is the first contact_field_filled act's id (mutation: the chat path uses the customer author -> FAILS)", async () => {
    await run(chat());
    const acts = inserted()[0] as { id?: string }[];
    expect(acts[0]!.id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(acts.slice(1).every((a) => a.id !== acts[0]!.id)).toBe(true);
    expect(dbMocks.updateContact).toHaveBeenCalledTimes(1);
    expect(dbMocks.updateContact).toHaveBeenCalledWith(DB, "acct-A", "ct-old", expect.any(Object), SOFIA, `ai_act:${acts[0]!.id}`);
  });

  it("(b) a form fill stays the customer's, with no via", async () => {
    await run();
    expect(dbMocks.updateContact).toHaveBeenCalledTimes(1);
    const call = dbMocks.updateContact.mock.calls[0]!;
    expect(call[4]).toEqual(CUSTOMER);
    expect(call[5]).toBeUndefined();
  });

  it("a chat fill of custom fields alone logs no act, so it names none (still Sofía's write)", async () => {
    dbMocks.getContact.mockResolvedValue({ ...RETURNING, last_name: "Ruiz", email: "a@x.example", phone: "+19560000000" });
    const form = { ...FORM, fields: [...FORM.fields, { key: "z", kind: "custom.zone", label: "Zone" }] } as unknown as FormRow;
    await enrich(DB, form, "sub-1", [...ANSWERS, { key: "z", label: "Zone", value: "North" }], {}, null, "en", true, chat());
    expect(dbMocks.insertAiActs).not.toHaveBeenCalled();
    const call = dbMocks.updateContact.mock.calls[0]!;
    expect(call[3]).toEqual({ custom: { zone: "North" } });
    expect(call[4]).toEqual(SOFIA);
    expect(call[5]).toBeUndefined();
  });

  /** A client that answers the attribution read and records each write's x-bis-author header. */
  function attributionDb() {
    const headers: string[] = [];
    const db = {
      from: (table: string) => {
        if (table === "accounts") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { language: "en" }, error: null }) }) }) };
        }
        if (table !== "contacts") throw new Error(`unexpected table ${table}`);
        const read = { eq: () => read, maybeSingle: async () => ({ data: { attribution: {} }, error: null }) };
        return {
          select: () => read,
          update: () => {
            const b = {
              eq: () => b,
              setHeader: (n: string, v: string) => { if (n === "x-bis-author") headers.push(v); return b; },
              then: (res: (v: { error: null }) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ error: null }).then(res, rej),
            };
            return b;
          },
        };
      },
    } as unknown as ReturnType<typeof serviceDb>;
    return { db, headers };
  }

  it("setAttribution sends the author it is given, with no via (mutation: drop withAuthor -> FAILS)", async () => {
    const { db, headers } = attributionDb();
    await setAttribution(db, "acct-A", "ct-1", { utm_source: "g" }, true, { authorKind: "customer", authorId: "form" });
    await setAttribution(db, "acct-A", "ct-1", { utm_source: "g" }, true, { authorKind: "ai", authorId: null });
    expect(headers.map((h) => JSON.parse(h))).toEqual([{ kind: "customer", id: "form" }, { kind: "ai" }]);
  });

  it.each([
    ["the chat's new contact", true, false, { kind: "ai" }],
    ["the form's new contact", false, false, { kind: "customer", id: "form" }],
    ["the chat's returning contact", true, true, { kind: "ai" }],
    ["the form's returning contact", false, true, { kind: "customer", id: "form" }],
  ] as const)("%s: the attribution write carries the same author as its lead (mutation: always the customer -> FAILS for the chat)", async (_l, fromChat, returning, header) => {
    if (!returning) dbMocks.createContact.mockResolvedValue({ id: "ct-new", existing: false, flagged: false });
    const { db, headers } = attributionDb();
    await enrich(db, FORM, "sub-1", ANSWERS, { utm_source: "g" }, null, "en", true, fromChat ? chat() : undefined);
    expect(headers.map((h) => JSON.parse(h))).toEqual([header]);
  });
});

/**
 * Who may say "this is the chat": `lib/concierge/lead.ts` alone. Every other caller of `enrich` (the
 * public form, `app/f/[publicId]/actions.ts`) passes eight arguments, so its contacts stay the
 * customer's and nothing it files is recorded as Sofía's. Read off the source tree, because a
 * caller the tests here do not run is exactly the one that would slip through.
 */
describe("enrich: the customer's own form or chat lead brings an archived contact back (contact archive T9)", () => {
  it("a public form restores its contact with the sign 'form' (mutation: drop the call → FAILS)", async () => {
    dbMocks.createContact.mockResolvedValue({ id: "ct-old", existing: true, flagged: false });
    dbMocks.getContact.mockResolvedValue(null);
    await run();
    expect(dbMocks.restoreContactOnSign).toHaveBeenCalledExactlyOnceWith(DB, "acct-A", "ct-old", "form");
  });

  it("a web chat lead restores with the sign 'chat' (mutation: always 'form' → FAILS)", async () => {
    await run(chat());
    expect(dbMocks.restoreContactOnSign).toHaveBeenCalledExactlyOnceWith(DB, "acct-A", "ct-new", "chat");
  });

  it("no contact, no restore: a failed contact write restores nobody", async () => {
    dbMocks.createContact.mockRejectedValue(new Error("db down"));
    await run();
    expect(dbMocks.restoreContactOnSign).not.toHaveBeenCalled();
  });

  it("a failed restore still files the thread, the unread and the event, and is not a processing error (mutation: let the throw escape the group → FAILS)", async () => {
    dbMocks.restoreContactOnSign.mockRejectedValue(new Error("restoreContactOnSign failed: down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await run();
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.incrementUnreadCount).toHaveBeenCalledTimes(1);
    expect(dbMocks.emitFormSubmitted).toHaveBeenCalledTimes(1);
    expect(dbMocks.setSubmissionProcessingError).not.toHaveBeenCalled();
    expect(spy.mock.calls.map((c) => String(c[0]))).toContain("form form-1 submission sub-1: restore failed for contact ct-new: restoreContactOnSign failed: down");
    spy.mockRestore();
  });
});

describe("only the web chat tells enrich it is the chat", () => {
  const SRC = join(__dirname, "..", "..");
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return name === "node_modules" ? [] : sources(p);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
    });
  }
  // Only `src/lib` and `src/app` hold callers (review M-b): walking all of `src` took ~5 s under a parallel run
  // and flaked on the default timeout, so the walk is narrowed and the timeout stated.
  it("the one source passing { chatId } to enrich is lib/concierge/lead.ts (mutation: drop it there -> FAILS; pass it from the public form -> FAILS)", { timeout: 30_000 }, () => {
    const callers = [join(SRC, "lib"), join(SRC, "app")].flatMap(sources).filter((p) => /from "@\/lib\/forms\/enrich"|import\("@\/lib\/forms\/enrich"\)/.test(readFileSync(p, "utf8")));
    expect(callers.length).toBeGreaterThanOrEqual(2);
    const passing = callers
      .filter((p) => /\{\s*chatId:/.test(readFileSync(p, "utf8")))
      .map((p) => relative(SRC, p).split(sep).join("/"));
    expect(passing).toEqual(["lib/concierge/lead.ts"]);
  });
});
