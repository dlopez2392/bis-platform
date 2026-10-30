import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const verify = vi.hoisted(() => vi.fn());
const dbMocks = vi.hoisted(() => ({
  updateMessageStatusByProviderId: vi.fn(),
  findMessageByProviderId: vi.fn(),
  ensureConversation: vi.fn(),
  createMessage: vi.fn(),
  createContact: vi.fn(),
  incrementUnreadForMessage: vi.fn(),
  getPhoneNumberByE164: vi.fn(),
  getAlertPhone: vi.fn(),
  applyConfirmationReply: vi.fn(),
  serviceDb: vi.fn(),
  // Consent chain PR-2 (the route's consent step, lib/consent/inbound.ts):
  // every export it reaches is defined, so no path here reads an undefined
  // mock (Global Constraints). A plain text writes only the grant.
  appendConsentEventGuarded: vi.fn(),
  ensureConsentTask: vi.fn(),
  nextBookedStart: vi.fn(),
  readAccountTimezone: vi.fn(),
  getContact: vi.fn(),
  completeTasksForConsentEvents: vi.fn(),
  readConsentHistory: vi.fn(),
  // S-47e (Task 10): the shared number's holding filing and the household reply (S30).
  listContactsOnNumber: vi.fn(),
  ensureHoldingContact: vi.fn(),
  listOutstandingConfirmAsks: vi.fn(),
  matchConfirmationReply: vi.fn(),
  addTask: vi.fn(),
  getAccountLanguage: vi.fn(),
  // Contact archive (T9): the customer's own text brings an archived contact back.
  restoreContactOnSign: vi.fn(),
}));
vi.mock("@/lib/voice/telnyx-signature", () => ({ verifyTelnyxSignature: verify }));
vi.mock("@bis/db", () => dbMocks);
const afterMock = vi.hoisted(() => vi.fn());
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => unknown) => afterMock(cb) };
});
vi.mock("@/lib/consent/replies", () => ({ sendConsentReply: vi.fn() }));

import { POST } from "./route";
const realDb = await vi.importActual<typeof import("@bis/db")>("@bis/db");
// Heartbeats are mocked out so the `after()` recorders below keep counting
// only this route's own work (lib/ops/stamp.ts).
const stampMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ops/stamp", () => ({ stampHeartbeat: (...a: unknown[]) => stampMock(...a) }));

function post(body: object) {
  return new Request("https://x.test/api/sms/inbound", {
    method: "POST",
    headers: { "telnyx-timestamp": "1", "telnyx-signature-ed25519": "sig" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verify.mockReturnValue(true);
  process.env.TELNYX_PUBLIC_KEY = "test-key";
  dbMocks.serviceDb.mockReturnValue({});
  // Default: no prior delivery on record. Individual tests override this to
  // simulate a replay.
  dbMocks.findMessageByProviderId.mockResolvedValue(null);
  // Off by default, same as a real account (0035_alert_phone.sql: the field
  // IS the switch) — the loop-guard test below overrides it.
  dbMocks.getAlertPhone.mockResolvedValue(null);
  dbMocks.appendConsentEventGuarded.mockResolvedValue({ outcome: "refused", prior: null });
  // S-47e (Task 10): nobody on the number by default, so every case below files as it always has.
  dbMocks.listContactsOnNumber.mockResolvedValue({ rows: [], truncated: false });
  dbMocks.ensureHoldingContact.mockResolvedValue({ id: "ct_hold", created: true });
  dbMocks.listOutstandingConfirmAsks.mockResolvedValue([]);
  dbMocks.addTask.mockResolvedValue({ id: "t1" });
  dbMocks.getAccountLanguage.mockResolvedValue(null);
  dbMocks.restoreContactOnSign.mockResolvedValue(false);
  // The real matcher (pure): the household reply reads "Sí" as yes exactly as production does.
  dbMocks.matchConfirmationReply.mockImplementation(realDb.matchConfirmationReply);
  afterMock.mockReset();
});

describe("POST /api/sms/inbound", () => {
  it("rejects a bad signature with 401 and writes nothing", async () => {
    verify.mockReturnValue(false);
    const res = await POST(post({ data: { event_type: "message.received" } }));
    expect(res.status).toBe(401);
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("returns 200 and writes NOTHING for a number this platform does not own", async () => {
    // A webhook that 500s gets retried forever, and an unowned number is not
    // an error condition this platform can fix. It is LOGGED, because the
    // case that matters is a number we DO own whose row is missing — in
    // which case a real customer's text is being discarded and no screen
    // would say so.
    dbMocks.getPhoneNumberByE164.mockResolvedValue(null);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post({
      data: { event_type: "message.received", payload: {
        to: [{ phone_number: "+15550000000" }], from: { phone_number: "+15551112222" }, text: "hi" } },
    }));
    expect(res.status).toBe(200);
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns 200 and writes NOTHING for a released number (stale account_id on the row)", async () => {
    // setPhoneNumberStatus is a plain UPDATE, never a delete: a released or
    // reassigned number's row persists with the OLD account_id. Without this
    // guard a stranger's text to that number would be attributed to the
    // former tenant's conversation list instead of being treated as unowned
    // — the same precedent voice/incoming already applies at its own
    // tenant-resolution step.
    dbMocks.getPhoneNumberByE164.mockResolvedValue({
      id: "pn_1", account_id: "acct_former_tenant", e164: "+15550000000",
      telnyx_id: null, status: "released",
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post({
      data: { event_type: "message.received", payload: {
        to: [{ phone_number: "+15550000000" }], from: { phone_number: "+15551112222" }, text: "hi" } },
    }));
    expect(res.status).toBe(200);
    expect(dbMocks.createContact).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("acks 200 even when serviceDb() throws synchronously (missing env vars)", async () => {
    // serviceDb() throws synchronously when NEXT_PUBLIC_SUPABASE_URL /
    // SUPABASE_SERVICE_ROLE_KEY are missing. It MUST be called inside the
    // route's try, or this exception escapes past the "never-500" guarantee
    // the adjacent comment claims and Next returns a 500 that Telnyx retries
    // forever.
    dbMocks.serviceDb.mockImplementation(() => {
      throw new Error("Supabase service env vars missing");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post({
      data: { event_type: "message.received", payload: {
        to: [{ phone_number: "+15550000000" }], from: { phone_number: "+15551112222" }, text: "hi" } },
    }));
    expect(res.status).toBe(200);
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("records an inbound text from a known number", async () => {
    dbMocks.getPhoneNumberByE164.mockResolvedValue({
      id: "pn_1", account_id: "acct_1", e164: "+15550000000", telnyx_id: null, status: "live",
    });
    dbMocks.createContact.mockResolvedValue({ id: "contact_1", existing: false });
    dbMocks.ensureConversation.mockResolvedValue({ id: "conv_1", created: true });
    dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });

    const res = await POST(post({
      data: { event_type: "message.received", payload: {
        id: "msg_evt_1",
        to: [{ phone_number: "+15550000000" }], from: { phone_number: "+15551112222" }, text: "hi there" } },
    }));

    expect(res.status).toBe(200);
    expect(dbMocks.findMessageByProviderId).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_evt_1");
    expect(dbMocks.createContact).toHaveBeenCalledWith(
      expect.anything(), "acct_1", { phone: "+15551112222" }, expect.any(String), expect.any(String),
    );
    expect(dbMocks.ensureConversation).toHaveBeenCalledWith(
      expect.anything(), "acct_1", "contact_1", expect.any(String), expect.any(String),
    );
    expect(dbMocks.createMessage).toHaveBeenCalledWith(
      expect.anything(), "acct_1",
      expect.objectContaining({
        conversationId: "conv_1", channel: "sms", direction: "inbound", body: "hi there",
        providerMessageId: "msg_evt_1", status: "delivered",
      }),
      expect.any(String), expect.any(String),
    );
    // The finding this covers: without this call an inbound text left both
    // the conversation-list badge and the sidebar unread meter at zero.
    // 0106 (Task 7, plan review m7): the bump is called with the MESSAGE id
    // createMessage answered, never the conversation id — a merge between the
    // insert and this call can move the message off the conversation this
    // route still remembers (mutation: pass conversation.id as before → FAILS).
    expect(dbMocks.incrementUnreadForMessage).toHaveBeenCalledWith(
      expect.anything(), "acct_1", "msg_1",
    );
  });

  // Finding 1 (alert-send-report follow-up review): a transient getAlertPhone
  // read failure used to escape handleInbound into the route's outer catch,
  // which logs and still returns 200 — so Telnyx is told "handled" and never
  // retries, and the text is gone. The loop guard is a nicety; the customer's
  // message is not. A read error must be contained to "no alert phone" so
  // the rest of the write still happens.
  it("still records the inbound text when getAlertPhone's read rejects (mutation: let the throw escape → FAILS)", async () => {
    dbMocks.getPhoneNumberByE164.mockResolvedValue({
      id: "pn_1", account_id: "acct_1", e164: "+15550000000", telnyx_id: null, status: "live",
    });
    dbMocks.getAlertPhone.mockRejectedValue(new Error("db blip"));
    dbMocks.createContact.mockResolvedValue({ id: "contact_1", existing: false });
    dbMocks.ensureConversation.mockResolvedValue({ id: "conv_1", created: true });
    dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(post({
      data: { event_type: "message.received", payload: {
        id: "msg_evt_blip",
        to: [{ phone_number: "+15550000000" }], from: { phone_number: "+15551112222" }, text: "hi there" } },
    }));

    expect(res.status).toBe(200);
    expect(dbMocks.createContact).toHaveBeenCalledTimes(1);
    expect(dbMocks.createMessage).toHaveBeenCalledWith(
      expect.anything(), "acct_1",
      expect.objectContaining({ conversationId: "conv_1", channel: "sms", direction: "inbound", body: "hi there" }),
      expect.any(String), expect.any(String),
    );
    expect(dbMocks.incrementUnreadForMessage).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("skips a retried message.received (same payload.id) — writes exactly one message", async () => {
    // Telnyx retries webhooks at-least-once. createContact dedupes by phone
    // and ensureConversation by account+contact, but createMessage itself
    // inserts unconditionally — this dedupe check is what stops a retried
    // delivery from putting a duplicate line in the customer's thread.
    dbMocks.getPhoneNumberByE164.mockResolvedValue({
      id: "pn_1", account_id: "acct_1", e164: "+15550000000", telnyx_id: null, status: "live",
    });
    dbMocks.createContact.mockResolvedValue({ id: "contact_1", existing: false });
    dbMocks.ensureConversation.mockResolvedValue({ id: "conv_1", created: true });
    dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
    dbMocks.findMessageByProviderId
      .mockResolvedValueOnce(null) // first delivery: nothing recorded yet
      .mockResolvedValueOnce({ id: "msg_1" }); // Telnyx's retry: already recorded

    const body = {
      data: { event_type: "message.received", payload: {
        id: "msg_evt_1",
        to: [{ phone_number: "+15550000000" }], from: { phone_number: "+15551112222" }, text: "hi there" } },
    };

    const first = await POST(post(body));
    const second = await POST(post(body));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    // The idempotent-skip branch returns before the increment call — a
    // replayed delivery must not double-count the same text as two unreads.
    expect(dbMocks.incrementUnreadForMessage).toHaveBeenCalledTimes(1);
    // YES/NO answers "the most recent unanswered ask" and is not idempotent
    // (plan G1): a retry must not run it a second time (mutation: run it in
    // the retry/else branch too → this goes to 2, FAILS).
    expect(dbMocks.applyConfirmationReply).toHaveBeenCalledTimes(1);
  });

  it("routes a delivery receipt to updateMessageStatusByProviderId", async () => {
    // The message id lives at data.payload.id, NOT data.id — data.id is the
    // webhook EVENT's own id (confirmed against Telnyx's current messaging
    // webhook docs; see route.ts's file header). provider_message_id is set
    // from the send API's data.id (lib/sms/telnyx.ts), which is the SAME
    // value as this webhook's data.payload.id, not its data.id.
    const res = await POST(post({
      data: { event_type: "message.finalized", payload: { id: "prov_1", to: [{ status: "delivered" }] } },
    }));
    expect(res.status).toBe(200);
    expect(dbMocks.updateMessageStatusByProviderId).toHaveBeenCalledWith(
      expect.anything(), "prov_1", "delivered",
    );
  });

  // THE loop guard (danlo, 2026-09-15): 0035_alert_phone.sql deliberately
  // leaves this to the send path rather than the schema. Nothing stops
  // `accounts.alert_phone` from equalling this account's own `phone_numbers`
  // row, and a text FROM that number would otherwise create a contact and a
  // conversation for the business's own owner — quietly corrupting the CRM
  // with a record of the operator as their own lead.
  it("recognizes and drops an inbound text FROM the account's own alert_phone — no contact, no conversation (mutation: drop the loop guard → FAILS)", async () => {
    dbMocks.getPhoneNumberByE164.mockResolvedValue({
      id: "pn_1", account_id: "acct_1", e164: "+15550000000", telnyx_id: null, status: "live",
    });
    dbMocks.getAlertPhone.mockResolvedValue("+15551112222"); // == the inbound `from`
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(post({
      data: { event_type: "message.received", payload: {
        id: "msg_evt_alert", to: [{ phone_number: "+15550000000" }],
        from: { phone_number: "+15551112222" }, text: "thanks!" } },
    }));

    expect(res.status).toBe(200);
    expect(dbMocks.createContact).not.toHaveBeenCalled();
    expect(dbMocks.ensureConversation).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.incrementUnreadForMessage).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("leaves every other inbound number untouched — the guard checks equality, not merely presence of an alert_phone", async () => {
    dbMocks.getPhoneNumberByE164.mockResolvedValue({
      id: "pn_1", account_id: "acct_1", e164: "+15550000000", telnyx_id: null, status: "live",
    });
    // An alert_phone IS set, but it is NOT the number this text came from.
    dbMocks.getAlertPhone.mockResolvedValue("+15559990000");
    dbMocks.createContact.mockResolvedValue({ id: "contact_1", existing: false });
    dbMocks.ensureConversation.mockResolvedValue({ id: "conv_1", created: true });
    dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });

    const res = await POST(post({
      data: { event_type: "message.received", payload: {
        id: "msg_evt_ok", to: [{ phone_number: "+15550000000" }],
        from: { phone_number: "+15551112222" }, text: "hi" } },
    }));

    expect(res.status).toBe(200);
    expect(dbMocks.createContact).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Part B, Task 4: the one place in this platform where an inbound text means
// something other than "a person wrote in". `appointment_confirm` asks a
// customer to reply YES or NO, and `applyConfirmationReply` records what they
// said on the booking. This route is a RECORDER: no reply-back, no status
// change, no new event.
// ---------------------------------------------------------------------------
const OUR_NUMBER = "+15550000000";
const THEIR_NUMBER = "+19565550107";

/** The four mocks a message has to pass to reach the end of handleInbound,
 *  set exactly as `records an inbound text from a known number` sets them.
 *  Local to this describe: the file's own beforeEach deliberately leaves
 *  getPhoneNumberByE164 unset so the "unowned number" cases can use the
 *  default. */
function anOwnedNumberAndAKnownContact() {
  dbMocks.getPhoneNumberByE164.mockResolvedValue({
    id: "pn_1", account_id: "acct_1", e164: OUR_NUMBER, telnyx_id: null, status: "live",
  });
  dbMocks.createContact.mockResolvedValue({ id: "contact_1", existing: true });
  dbMocks.ensureConversation.mockResolvedValue({ id: "conv_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  // The file's top-level beforeEach runs `vi.clearAllMocks()`, which clears
  // CALLS and not IMPLEMENTATIONS. Without this line a case appended after
  // "a failure recording the answer is CONTAINED" inherits its REJECTING
  // applyConfirmationReply, the route swallows the rejection by design, and
  // the new case passes green while silently exercising the failure path.
  // The same shape cost part C's appointment-confirm suite ~0.9s per test
  // before it was noticed.
  dbMocks.applyConfirmationReply.mockResolvedValue(null);
}

const inbound = (text: string, from = THEIR_NUMBER) => post({
  data: {
    event_type: "message.received",
    payload: {
      id: `evt_${text.slice(0, 6)}`,
      to: [{ phone_number: OUR_NUMBER }], from: { phone_number: from }, text,
    },
  },
});

describe("an inbound text that is a one-word answer", () => {
  beforeEach(anOwnedNumberAndAKnownContact);

  it("records the answer AFTER the message is filed, and sends nothing", async () => {
    dbMocks.applyConfirmationReply.mockResolvedValue("yes");
    await POST(inbound("YES"));
    // Order matters: the customer's message is filed first, always.
    expect(dbMocks.createMessage).toHaveBeenCalled();
    expect(dbMocks.incrementUnreadForMessage).toHaveBeenCalled();
    expect(dbMocks.applyConfirmationReply).toHaveBeenCalledWith(
      expect.anything(), "acct_1", "contact_1", "YES", expect.any(Date));
    // Mutation: move the call ABOVE createMessage -> the order assertion below reds.
    const filedAt = dbMocks.createMessage.mock.invocationCallOrder[0]!;
    const answeredAt = dbMocks.applyConfirmationReply.mock.invocationCallOrder[0]!;
    expect(answeredAt).toBeGreaterThan(filedAt);
  });

  it("the YES/NO leg still sends nothing; the route's only way to send is the consent reply, after the response (plan G16; mutation: import any sender into this route → FAILS)", async () => {
    dbMocks.applyConfirmationReply.mockResolvedValue("yes");
    const res = await POST(inbound("yes"));
    expect(res.status).toBe(200);
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.createMessage.mock.calls[0]![2].direction).toBe("inbound");
    // A YES answer is a recorder's job (automation spec decision 6): nothing
    // is scheduled after the response.
    expect(afterMock).not.toHaveBeenCalled();
    // The import surface, as before (a sender reached through a library
    // import is what this case exists to stop): no SMS provider, no
    // automation, no email, no composer action, and not the gate itself —
    // the consent replies reach the gate only through lib/consent/replies,
    // whose one kind family scans.test.ts pins (Task 14).
    const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    expect(routeSource).not.toContain('from "@/lib/sms');
    expect(routeSource).not.toContain('from "@/lib/automations');
    expect(routeSource).not.toContain('from "@/lib/email');
    expect(routeSource).not.toContain('from "@/lib/consent/gate');
    expect(routeSource).not.toContain("sendSmsAction");
  });

  it("a failure recording the answer is CONTAINED — the customer's message is filed and the outer catch never sees it", async () => {
    // The containment is the whole point of this leg, and the ONLY thing
    // that proves it is WHICH log line came out. Dropping the try/catch
    // lets the rejection reach the route's outer catch, which logs and STILL
    // returns `{ ok: true }` — by which time createMessage and
    // incrementUnreadForMessage have each run once. So `res.status === 200` and
    // both call counts of 1 stay TRUE under the mutation: an earlier draft
    // of this case asserted exactly those three and could not fail.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.applyConfirmationReply.mockRejectedValue(new Error("db blip"));
    const res = await POST(inbound("no"));
    expect(res.status).toBe(200);
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.incrementUnreadForMessage).toHaveBeenCalledTimes(1);

    const logged = spy.mock.calls.map((args) => args.join(" ")).join("\n");
    // Mutation: drop the try/catch around applyConfirmationReply -> this pair
    // flips, and only this pair. The contained line disappears and the outer
    // catch's appears.
    expect(logged).toContain("could not record a confirmation reply");
    expect(logged).not.toContain("unexpected failure handling webhook");
    spy.mockRestore();
  });

  it("an ordinary message still goes through untouched", async () => {
    dbMocks.applyConfirmationReply.mockResolvedValue(null);
    await POST(inbound("can you come Tuesday instead?"));
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.applyConfirmationReply).toHaveBeenCalledTimes(1);   // a plain text reaches it; a keyword or a stop sentence does not (the route classifies first, spec §4.2 step 5)
  });

  it("a text from the account's own alert phone never reaches the matcher", async () => {
    dbMocks.getAlertPhone.mockResolvedValue("+19565559999");
    await POST(inbound("yes", "+19565559999"));
    expect(dbMocks.applyConfirmationReply).not.toHaveBeenCalled();
    // Mutation: delete the guard's early return (route.ts:130-133) -> red.
    //
    // NOT "move the new block above the alert-phone guard", which is what the
    // plan prescribed and nobody can apply: the block reads `contact.id`, and
    // `contact` is const-declared 27 lines BELOW the guard (route.ts:157), so
    // that move is a TDZ/compile error rather than a test failure. A mutation
    // that cannot be applied proves nothing about the case it names.
  });
});

describe("the sms.inbound heartbeat (operational-floor spec §1)", () => {
  it("a handled event is one ok stamp", async () => {
    await POST(post({ data: { event_type: "message.finalized", payload: { id: "prov_1", to: [{ status: "delivered" }] } } }));
    expect(stampMock).toHaveBeenCalledExactlyOnceWith("sms.inbound", { ok: true });
  });

  it("a refused signature — or an unset key — is never stamped (mutation: stamp an error there → FAILS)", async () => {
    verify.mockReturnValue(false);
    await POST(post({ data: { event_type: "message.received" } }));
    delete process.env.TELNYX_PUBLIC_KEY;
    await POST(post({ data: { event_type: "message.received" } }));
    expect(stampMock).not.toHaveBeenCalled();
  });

  it("a failure past the signature is an error stamp naming the event and the error's TYPE, never its message, and no ok stamp after it", async () => {
    dbMocks.serviceDb.mockImplementation(() => { throw new Error("env missing for +15551112222"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await POST(post({ data: { event_type: "message.received", payload: {
      to: [{ phone_number: "+15550000000" }], from: { phone_number: "+15551112222" }, text: "hi" } } }));
    expect(stampMock).toHaveBeenCalledExactlyOnceWith("sms.inbound", { ok: false, error: "message.received handling failed (Error)" });
    expect(JSON.stringify(stampMock.mock.calls)).not.toContain("5551112222");
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// S-47e (E8, S27, S30): a text from a phone several customers share carries no
// name, so it files on that number's ONE holding record; a one-word answer from
// it confirms the household's one outstanding ask, or files one To-do.
// ---------------------------------------------------------------------------
/** Not "acct_1": a literal account id in any read below must not pass by coincidence. */
const SHARED_ACCT = "acct_shared_9";
const row = (id: string, first: string, phone: string, holding = false) => ({
  id, first_name: first, last_name: holding ? null : "Ruiz", phone, email_key: null, holds_shared_number: holding,
});
const ANA = row("ct_ana", "Ana", THEIR_NUMBER);
const BETO = row("ct_beto", "Beto", THEIR_NUMBER);
/** Left out of every read of who is on the number: the holding record itself, and a +52 twin with the same ten digits. */
const HOLDING_ROW = row("ct_hold", "Caller", THEIR_NUMBER, true);
const MX_TWIN = row("ct_mx", "Mexico", "+529565550107");

function aNumberWith(rows: object[], truncated = false) {
  dbMocks.getPhoneNumberByE164.mockResolvedValue({
    id: "pn_9", account_id: SHARED_ACCT, e164: OUR_NUMBER, telnyx_id: null, status: "live",
  });
  dbMocks.listContactsOnNumber.mockResolvedValue({ rows, truncated });
  dbMocks.createContact.mockResolvedValue({ id: "contact_1", existing: true, flagged: false });
  dbMocks.ensureConversation.mockResolvedValue({ id: "conv_hold", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  dbMocks.applyConfirmationReply.mockResolvedValue(null);
}
const askedAt = () => dbMocks.listOutstandingConfirmAsks.mock.calls[0]![3] as Date;
const REPLY_TODO_EN = "A reply from a shared number couldn't be matched to one appointment";

describe("a text from a number several customers share (S-47e E8)", () => {
  it("files on the number's holding thread, never on a household member by phone (mutation (a): isShared → false FAILS; mutation (b): a literal account id in readCandidates FAILS)", async () => {
    aNumberWith([HOLDING_ROW, ANA, BETO]);
    const res = await POST(inbound("can you come Tuesday?"));
    expect(res.status).toBe(200);
    expect(dbMocks.listContactsOnNumber).toHaveBeenCalledWith(expect.anything(), SHARED_ACCT, THEIR_NUMBER);
    // "sms": the holding record says a text made it, never Sofía (fix round item 5).
    expect(dbMocks.ensureHoldingContact).toHaveBeenCalledWith(expect.anything(), SHARED_ACCT, THEIR_NUMBER, "sms");
    expect(dbMocks.ensureConversation).toHaveBeenCalledWith(expect.anything(), SHARED_ACCT, "ct_hold", "sms-inbound", "system");
    expect(dbMocks.createContact).not.toHaveBeenCalled();
    expect(dbMocks.createMessage.mock.calls[0]![2]).toMatchObject({ conversationId: "conv_hold", direction: "inbound" });
  });

  it("a number with one contact files as today: createContact, no holding record", async () => {
    aNumberWith([ANA, MX_TWIN, HOLDING_ROW]);
    await POST(inbound("can you come Tuesday?"));
    expect(dbMocks.createContact).toHaveBeenCalledWith(expect.anything(), SHARED_ACCT, { phone: THEIR_NUMBER }, "sms-inbound", "system");
    expect(dbMocks.ensureHoldingContact).not.toHaveBeenCalled();
    expect(dbMocks.ensureConversation).toHaveBeenCalledWith(expect.anything(), SHARED_ACCT, "contact_1", "sms-inbound", "system");
  });

  it("a text with no sender number reads nobody on a number", async () => {
    aNumberWith([ANA, BETO]);
    await POST(post({ data: { event_type: "message.received", payload: { id: "evt_nofrom", to: [{ phone_number: OUR_NUMBER }], text: "hi" } } }));
    expect(dbMocks.listContactsOnNumber).not.toHaveBeenCalled();
    expect(dbMocks.ensureHoldingContact).not.toHaveBeenCalled();
    expect(dbMocks.createContact).toHaveBeenCalledWith(expect.anything(), SHARED_ACCT, { phone: undefined }, "sms-inbound", "system");
  });
});

describe("a one-word answer from a shared number (S-47e S30)", () => {
  it("Ana has the one outstanding ask: her appointment is answered, no To-do (mutation (c): the holding id → FAILS)", async () => {
    aNumberWith([HOLDING_ROW, ANA, BETO]);
    // Answers like the database: Ana's ask only when Ana is among the ids asked for.
    dbMocks.listOutstandingConfirmAsks.mockImplementation(async (_d: unknown, _a: string, ids: readonly string[]) =>
      ids.includes("ct_ana") ? [{ bookingId: "bk_ana", contactId: "ct_ana" }] : []);
    await POST(inbound("Sí"));
    expect(dbMocks.applyConfirmationReply).toHaveBeenCalledTimes(1);
    expect(dbMocks.applyConfirmationReply).toHaveBeenCalledWith(expect.anything(), SHARED_ACCT, "ct_ana", "Sí", expect.any(Date));
    expect(dbMocks.applyConfirmationReply.mock.calls[0]![4]).toBe(askedAt());   // one "now" for the read and the write
    expect(dbMocks.addTask).not.toHaveBeenCalled();
  });

  it("Beto, not the first on the number, has the one ask: HIS appointment is answered (fix round item 2; mutation: shared.realContactIds[0] → FAILS)", async () => {
    aNumberWith([HOLDING_ROW, ANA, BETO]);
    dbMocks.listOutstandingConfirmAsks.mockImplementation(async (_d: unknown, _a: string, ids: readonly string[]) =>
      ids.includes("ct_beto") ? [{ bookingId: "bk_beto", contactId: "ct_beto" }] : []);
    await POST(inbound("Sí"));
    expect(dbMocks.applyConfirmationReply).toHaveBeenCalledTimes(1);
    expect(dbMocks.applyConfirmationReply).toHaveBeenCalledWith(expect.anything(), SHARED_ACCT, "ct_beto", "Sí", expect.any(Date));
    expect(dbMocks.addTask).not.toHaveBeenCalled();
  });

  it("more people on the number than one read returns: nothing is applied, even with one ask among those read, and the one To-do is filed (fix round item 3; mutation: drop the truncated guard → FAILS)", async () => {
    aNumberWith([HOLDING_ROW, ANA, BETO], true);
    dbMocks.listOutstandingConfirmAsks.mockResolvedValue([{ bookingId: "bk_ana", contactId: "ct_ana" }]);
    await POST(inbound("Sí"));
    expect(dbMocks.applyConfirmationReply).not.toHaveBeenCalled();
    expect(dbMocks.addTask).toHaveBeenCalledTimes(1);
    expect(dbMocks.addTask.mock.calls[0]![2]).toMatchObject({ contactId: "ct_hold", title: REPLY_TODO_EN });
  });

  it("Ana and Beto both have one: nothing is applied and ONE To-do is filed on the holding record (mutation (d): asks.length >= 1 FAILS)", async () => {
    aNumberWith([HOLDING_ROW, ANA, BETO]);
    dbMocks.listOutstandingConfirmAsks.mockResolvedValue([
      { bookingId: "bk_ana", contactId: "ct_ana" }, { bookingId: "bk_beto", contactId: "ct_beto" },
    ]);
    await POST(inbound("Sí"));
    expect(dbMocks.applyConfirmationReply).not.toHaveBeenCalled();
    expect(dbMocks.addTask).toHaveBeenCalledTimes(1);
    expect(dbMocks.addTask).toHaveBeenCalledWith(expect.anything(), SHARED_ACCT, {
      contactId: "ct_hold", title: REPLY_TODO_EN, dueAt: askedAt().toISOString(),
    }, "sms-inbound", "system");
  });

  it("the To-do is in the account's language", async () => {
    aNumberWith([HOLDING_ROW, ANA, BETO]);
    dbMocks.getAccountLanguage.mockResolvedValue("es");
    dbMocks.listOutstandingConfirmAsks.mockResolvedValue([
      { bookingId: "bk_ana", contactId: "ct_ana" }, { bookingId: "bk_beto", contactId: "ct_beto" },
    ]);
    await POST(inbound("Sí"));
    expect(dbMocks.getAccountLanguage).toHaveBeenCalledWith(expect.anything(), SHARED_ACCT);
    expect(dbMocks.addTask.mock.calls[0]![2].title).toBe("Una respuesta de un número compartido no se pudo asociar con una sola cita");
  });

  it("nobody has one: nothing is applied, and the same one To-do", async () => {
    aNumberWith([HOLDING_ROW, ANA, BETO]);
    await POST(inbound("Sí"));
    expect(dbMocks.applyConfirmationReply).not.toHaveBeenCalled();
    expect(dbMocks.addTask).toHaveBeenCalledTimes(1);
    expect(dbMocks.addTask.mock.calls[0]![2]).toMatchObject({ contactId: "ct_hold", title: REPLY_TODO_EN });
  });

  it("the asks are read for exactly the REAL contacts on the number, on the route's own account (mutation: the holding id FAILS; mutation: a literal account id FAILS)", async () => {
    aNumberWith([HOLDING_ROW, ANA, MX_TWIN, BETO]);
    await POST(inbound("Sí"));
    expect(dbMocks.listOutstandingConfirmAsks).toHaveBeenCalledTimes(1);
    expect(dbMocks.listOutstandingConfirmAsks).toHaveBeenCalledWith(expect.anything(), SHARED_ACCT, ["ct_ana", "ct_beto"], expect.any(Date));
  });

  it("a text that is not a one-word answer reads no asks and files no To-do", async () => {
    aNumberWith([HOLDING_ROW, ANA, BETO]);
    await POST(inbound("hola"));
    expect(dbMocks.listOutstandingConfirmAsks).not.toHaveBeenCalled();
    expect(dbMocks.applyConfirmationReply).not.toHaveBeenCalled();
    expect(dbMocks.addTask).not.toHaveBeenCalled();
  });

  it("a retried delivery (already filed) applies nothing and files no To-do", async () => {
    aNumberWith([HOLDING_ROW, ANA, BETO]);
    dbMocks.findMessageByProviderId.mockResolvedValue({ id: "msg_1" });
    dbMocks.listOutstandingConfirmAsks.mockResolvedValue([{ bookingId: "bk_ana", contactId: "ct_ana" }]);
    await POST(inbound("Sí"));
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.listOutstandingConfirmAsks).not.toHaveBeenCalled();
    expect(dbMocks.applyConfirmationReply).not.toHaveBeenCalled();
    expect(dbMocks.addTask).not.toHaveBeenCalled();
  });

  it("a CANCEL from a number with more people than one read returns: the one reply To-do on the holding record, never one person's appointment (T17 review M4; mutation: drop truncated from sharedNumber -> Ana's CANCEL To-do, FAILS)", async () => {
    aNumberWith([HOLDING_ROW, ANA, BETO], true);
    dbMocks.appendConsentEventGuarded.mockResolvedValue({ outcome: "appended", id: "ev_cancel", prior: null });
    dbMocks.nextBookedStart.mockImplementation(async (_d: unknown, _a: string, id: string) => id === "ct_ana" ? "2026-10-10T02:00:00Z" : null);
    try {
      await POST(inbound("CANCEL"));
      expect(dbMocks.ensureConsentTask).toHaveBeenCalledTimes(1);
      expect(dbMocks.ensureConsentTask.mock.calls[0]![1]).toBe(SHARED_ACCT);
      expect(dbMocks.ensureConsentTask.mock.calls[0]![2]).toMatchObject({ contactId: "ct_hold", title: REPLY_TODO_EN });
    } finally {
      dbMocks.nextBookedStart.mockReset();
    }
  });

  it("a one-contact number answers as today, on that contact, with no read of asks", async () => {
    aNumberWith([ANA]);
    await POST(inbound("Sí"));
    expect(dbMocks.applyConfirmationReply).toHaveBeenCalledWith(expect.anything(), SHARED_ACCT, "contact_1", "Sí", expect.any(Date));
    expect(dbMocks.listOutstandingConfirmAsks).not.toHaveBeenCalled();
    expect(dbMocks.addTask).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Contact archive (owner ruling Q1, review I7/I8): the customer's own text brings an archived contact back.
// Never a keyword, a Telnyx autoresponse or a stop sentence (consent.kind), never a phone's auto-reply
// (looksAutomaticText), never a shared number's holding record. Inside the filing try, BEFORE the message.
// ---------------------------------------------------------------------------
describe("an inbound text brings an archived contact back (contact archive T9)", () => {
  const theService = () => dbMocks.serviceDb.mock.results[0]!.value;
  const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0]!;

  it("a plain text restores the contact it filed on, with the sign 'text', on the service client, BEFORE the message is written (mutation: restore after createMessage → FAILS)", async () => {
    anOwnedNumberAndAKnownContact();
    const res = await POST(inbound("Can you come Tuesday?"));
    expect(res.status).toBe(200);
    expect(dbMocks.restoreContactOnSign).toHaveBeenCalledExactlyOnceWith(theService(), "acct_1", "contact_1", "text");
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(order(dbMocks.restoreContactOnSign)).toBeLessThan(order(dbMocks.createMessage));
    expect(order(dbMocks.ensureConversation)).toBeLessThan(order(dbMocks.restoreContactOnSign));
  });

  it("a retried delivery (the message already filed) restores too: it is idempotent and runs on every delivery (mutation: restore only inside if (firstFiling) → FAILS)", async () => {
    anOwnedNumberAndAKnownContact();
    dbMocks.findMessageByProviderId.mockResolvedValue({ id: "msg_1" });
    await POST(inbound("Can you come Tuesday?"));
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.restoreContactOnSign).toHaveBeenCalledExactlyOnceWith(theService(), "acct_1", "contact_1", "text");
  });

  it.each([
    ["STOP", {}],
    ["START", {}],
    ["HELP", {}],
    ["a text Telnyx answered itself (telnyx_only)", { autoresponse_type: "HELP" }],
    ["unsubscribe me", {}],
  ] as const)("%s restores nobody: consent.kind is not none (mutation: drop the consent.kind term → FAILS)", async (body, over) => {
    anOwnedNumberAndAKnownContact();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const text = body.startsWith("a text") ? "hello there" : body;
    await POST(post({ data: { event_type: "message.received", payload: {
      id: `evt_consent_${text}`, to: [{ phone_number: OUR_NUMBER }], from: { phone_number: THEIR_NUMBER }, text, ...over } } }));
    // The text still reached the filing step, so a missing guard WOULD have restored.
    expect(dbMocks.ensureConversation).toHaveBeenCalledTimes(1);
    expect(dbMocks.restoreContactOnSign).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("a phone's own auto-reply restores nobody, but is still filed (mutation: drop the looksAutomaticText term → FAILS)", async () => {
    anOwnedNumberAndAKnownContact();
    await POST(inbound("I'm driving, will reply later"));
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.restoreContactOnSign).not.toHaveBeenCalled();
  });

  it("a text from a shared number restores nobody: it files on the number's holding record (mutation: drop the shared term → FAILS)", async () => {
    aNumberWith([HOLDING_ROW, ANA, BETO]);
    await POST(inbound("can you come Tuesday?"));
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.restoreContactOnSign).not.toHaveBeenCalled();
  });

  it("a restore that fails on the first filing files nothing and answers 503, so Telnyx retries the whole text (mutation: catch the restore → 200, FAILS; restore after createMessage → a message is written, FAILS)", async () => {
    anOwnedNumberAndAKnownContact();
    dbMocks.restoreContactOnSign.mockRejectedValue(new Error("restoreContactOnSign failed: down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(inbound("Can you come Tuesday?"));
    expect(res.status).toBe(503);
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.incrementUnreadForMessage).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
