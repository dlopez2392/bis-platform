import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const dbMocks = vi.hoisted(() => ({
  createContact: vi.fn(), updateContact: vi.fn(), getContact: vi.fn(), linkSubmissionContact: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), incrementUnreadCount: vi.fn(), emitFormSubmitted: vi.fn(),
  setSubmissionProcessingError: vi.fn(), setContactsBusiness: vi.fn(), recordLanguageSignal: vi.fn(),
  insertAiActs: vi.fn(),
}));
// `phoneFields` stays REAL (importOriginal): the act records the phone as the contact write stores it.
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
// The receipt's send: not this file's question (the address answer has one, so it would try).
vi.mock("@/lib/consent/email-gate", () => ({ sendEmailOrThrow: vi.fn(async () => {}), EmailNotSent: class extends Error {} }));
const instantReply = vi.hoisted(() => vi.fn());
vi.mock("@/lib/automations/instant-reply", () => ({ sendInstantReply: (...a: unknown[]) => instantReply(...a) }));

import type { FormRow, serviceDb } from "@bis/db";
import { enrich } from "./enrich";

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
    expect(inserted()).toEqual([[{
      actor: "webchat", callId: null, chatId: "chat-9", contactId: "ct-new", kind: "contact_created",
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
    expect(inserted()).toEqual([[
      { actor: "webchat", callId: null, chatId: "chat-9", contactId: "ct-old", kind: "contact_field_filled",
        target: { field: "lastName" }, before: { value: null }, after: { value: "Ruiz" } },
      { actor: "webchat", callId: null, chatId: "chat-9", contactId: "ct-old", kind: "contact_field_filled",
        target: { field: "email" }, before: { value: "" }, after: { value: "ana@example.com" } },
      { actor: "webchat", callId: null, chatId: "chat-9", contactId: "ct-old", kind: "contact_field_filled",
        target: { field: "phone" }, before: { value: null }, after: { value: "+19562921696" } },
    ]]);
    expect(dbMocks.setContactsBusiness).toHaveBeenCalled();
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
  });
});

/**
 * Who may say "this is the chat": `lib/concierge/lead.ts` alone. Every other caller of `enrich` (the
 * public form, `app/f/[publicId]/actions.ts`) passes eight arguments, so its contacts stay the
 * customer's and nothing it files is recorded as Sofía's. Read off the source tree, because a
 * caller the tests here do not run is exactly the one that would slip through.
 */
describe("only the web chat tells enrich it is the chat", () => {
  const SRC = join(__dirname, "..", "..");
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return name === "node_modules" ? [] : sources(p);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
    });
  }
  it("the one source passing { chatId } to enrich is lib/concierge/lead.ts (mutation: drop it there -> FAILS; pass it from the public form -> FAILS)", () => {
    const callers = sources(SRC).filter((p) => /from "@\/lib\/forms\/enrich"|import\("@\/lib\/forms\/enrich"\)/.test(readFileSync(p, "utf8")));
    expect(callers.length).toBeGreaterThanOrEqual(2);
    const passing = callers
      .filter((p) => /\{\s*chatId:/.test(readFileSync(p, "utf8")))
      .map((p) => relative(SRC, p).split(sep).join("/"));
    expect(passing).toEqual(["lib/concierge/lead.ts"]);
  });
});
