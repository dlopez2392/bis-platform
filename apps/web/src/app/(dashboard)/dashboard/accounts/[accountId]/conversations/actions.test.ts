import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// A vi.fn(), not a plain async function: since 0053 this call is the ONLY
// authorisation on every write these actions make (RLS no longer backs the
// composer's or mark-read's writes, which go through the service client) —
// a test needs to assert it was called, with which account, and that a
// rejection from it stops everything downstream. Its default resolved value
// is set in beforeEach, same as gateMock below.
const requireAccountAccessMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: (...a: unknown[]) => requireAccountAccessMock(...a),
}));

const sendMock = vi.fn();
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => ({ send: (...a: unknown[]) => sendMock(...a) }),
}));

// consent PR-3: spies on the REAL gate, so the kind each site names is
// asserted and the send still goes through the gate's own rules.
vi.mock("@/lib/consent/email-gate", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/consent/email-gate")>();
  return { ...real, sendEmailOrThrow: vi.fn(real.sendEmailOrThrow) };
});
import { sendEmailOrThrow } from "@/lib/consent/email-gate";
const gated = () => vi.mocked(sendEmailOrThrow).mock.calls.map((c) => c[0]);

/**
 * THE gate for SMS, mocked at its own module boundary rather than
 * reconstructed from its two underlying queries (a2p_registrations +
 * phone_numbers) — resolveSmsSender's own correctness is sender.test.ts's
 * job. What THIS file pins is that sendSmsAction obeys whatever the gate
 * says and never re-derives a `from` number or an approval decision itself.
 */
const gateMock = vi.fn();
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => gateMock(...a) }));

const smsSendMock = vi.fn();
// The service client the usage write goes through, and the provider's
// billing-relevant shape. Hoisted: the two mock factories read them.
const svc = vi.hoisted(() => ({
  db: { tag: "service-db" }, throws: false,
  provider: { isFake: false as boolean, redirectTo: undefined as string | undefined },
}));
vi.mock("@/lib/sms", () => ({
  getSmsProvider: () => ({
    isFake: svc.provider.isFake, redirectTo: svc.provider.redirectTo,
    send: (...a: unknown[]) => smsSendMock(...a),
  }),
}));

/**
 * The one direct query this action makes: the account's display name and,
 * as of this change, its reply-to address. Mutated per test rather than
 * re-mocked, and read through a closure so the factory sees the current value
 * at call time rather than at module-init time.
 */
const accountRow: {
  name: string; reply_to_email: string | null; from_email: string | null;
  brand_name: string | null;
  brand_logo_path: string | null; brand_color: string | null;
  brand_neutral: string | null; brand_corners: string | null;
  brand_type: string | null; brand_mode: string | null;
} = {
  // `name` is the AGENCY's internal label for this company; brand_name is what
  // its customers are allowed to see. They differ here on purpose, so the From
  // line can be asserted against the right one of the two.
  name: "Rio Roofing — trial", reply_to_email: null, from_email: null,
  brand_name: "Rio Roofing",
  brand_logo_path: null, brand_color: null, brand_neutral: null,
  brand_corners: null, brand_type: null, brand_mode: null,
};
// Hoisted and held so a test can assert IDENTITY: that a call reached this
// exact client, not merely a same-shaped one. `dbForRequest` returns this
// object every time, and never the service client below — that is the whole
// boundary 0053 draws (reads on the request client, writes on the service
// client).
const req = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/db", () => {
  const fake = {
    from: () => ({
      /**
       * Projects to exactly the columns asked for, and that is load-bearing.
       *
       * The first version of this mock returned the whole row whatever the
       * select said, which made `.select("name")` and
       * `.select("name, reply_to_email")` indistinguishable — a mutation
       * dropping the column from the query left both tests green. A mock more
       * permissive than PostgREST tests nothing about the query.
       */
      select: (cols: string) => ({
        eq: () => ({
          maybeSingle: async () => {
            const wanted = cols.split(",").map((c) => c.trim());
            return {
              data: Object.fromEntries(
                Object.entries(accountRow).filter(([key]) => wanted.includes(key)),
              ),
            };
          },
        }),
      }),
    }),
  };
  req.db = fake;
  return { dbForRequest: async () => req.db };
});

/**
 * The one contact row both actions read. sendEmailAction only ever looks at
 * `email`; sendSmsAction only at `phone` (run through toE164 before it
 * reaches the provider) — one mutable object covers both, same pattern as
 * accountRow above.
 */
const contactRow: { id: string; email: string | null; phone: string | null } = {
  id: "contact_1", email: "customer@example.com", phone: "9565551234",
};

vi.mock("@bis/db", () => ({
  brandLogoUrl: (path: string) => `https://cdn.test/${path}`,
  // vi.fn(), not a plain async function: 0053's tests assert which CLIENT
  // (the request client vs. the service client) each call reached, and that
  // needs a mock to inspect.
  getContact: vi.fn(async () => contactRow),
  ensureConversation: vi.fn(async () => ({ id: "convo_1" })),
  // vi.fn(), not a plain async function: the write-then-send ordering test
  // below needs invocationCallOrder against the SMS provider's send mock.
  createMessage: vi.fn(async () => ({ id: "msg_1" })),
  updateMessageStatus: vi.fn(),
  clearUnreadCount: vi.fn(),
  serviceDb: () => {
    if (svc.throws) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");
    return svc.db;
  },
  recordUsage: vi.fn(),
  // The send gate's reads (lib/consent/gate.ts): the composer goes through
  // the REAL gate, so its ledger and country-flag reads are mocked here,
  // allowed by default.
  readConsentState: vi.fn(async () => ({ state: "allowed" })),
  // D-016 item 3: the email gate's suppression check, for staff.composer_email
  // (staff_typed — the ledger read above skips it, but not this one).
  readEmailSuppression: vi.fn(async () => null),
  readPhoneCountryFlag: vi.fn(async () => false),
  readAccountTimezone: vi.fn(async () => "America/Chicago"),
  recordCarrierBlock: vi.fn(),
  // D-061: the gate's own account-level send switch, for both composer
  // sends. Allowed by default.
  isAccountOutboundSuppressed: vi.fn(async () => false),
}));

import { sendEmailAction, sendSmsAction, markConversationReadAction } from "./actions";
import {
  createMessage, updateMessageStatus, recordUsage, getContact, ensureConversation, clearUnreadCount,
  readConsentState, readPhoneCountryFlag, isAccountOutboundSuppressed,
} from "@bis/db";
import { m } from "@/lib/messages";
import { sendRejectedReason } from "./send-errors";
import { SmsProviderError } from "@/lib/sms/types";

const createMessageMock = vi.mocked(createMessage);
const updateMessageStatusMock = vi.mocked(updateMessageStatus);
const recordUsageMock = vi.mocked(recordUsage);

function fd(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [k, v] of Object.entries(entries)) formData.set(k, v);
  return formData;
}

beforeEach(() => {
  requireAccountAccessMock.mockReset().mockResolvedValue({ userId: "user_1", isAgency: false });
  sendMock.mockReset().mockResolvedValue({ providerMessageId: "pm_1" });
  smsSendMock.mockReset().mockResolvedValue({ providerMessageId: "pm_1" });
  gateMock.mockReset().mockResolvedValue({ ok: true, from: "+19565559999" });
  createMessageMock.mockClear();
  createMessageMock.mockResolvedValue({ id: "msg_1" });
  updateMessageStatusMock.mockClear();
  updateMessageStatusMock.mockResolvedValue(undefined);
  vi.mocked(getContact).mockClear();
  vi.mocked(ensureConversation).mockClear();
  vi.mocked(clearUnreadCount).mockClear();
  accountRow.reply_to_email = null;
  accountRow.from_email = null;
  accountRow.brand_name = "Rio Roofing";
  contactRow.email = "customer@example.com";
  contactRow.phone = "9565551234";
  svc.throws = false;
  svc.provider.isFake = false;
  svc.provider.redirectTo = undefined;
  recordUsageMock.mockReset().mockResolvedValue("recorded");
  vi.mocked(sendEmailOrThrow).mockClear();
});

/**
 * Without a reply-to, the customer's reply follows the From address — the
 * BIS mailbox while this account still sends from crm@bis-rgv.com, and the
 * client's own sending domain once from_email is set, which for a send-only
 * subdomain usually has no mailbox at all. Either way the company that wrote
 * to them never sees it. That is the gap this pair pins.
 */
describe("sendEmailAction — where the customer's reply goes", () => {
  it("replies to the company's own address when one is set", async () => {
    accountRow.reply_to_email = "hello@rioroofing.com";

    await sendEmailAction("acct_1", fd({
      contactId: "contact_1", subject: "Hi", body: "Quote attached",
    }));

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      to: "customer@example.com",
      replyTo: "hello@rioroofing.com",
    }));
  });

  it("omits reply-to when the company has not set one, exactly as before", async () => {
    await sendEmailAction("acct_1", fd({
      contactId: "contact_1", subject: "Hi", body: "Quote attached",
    }));

    expect(sendMock).toHaveBeenCalled();
    // Absent, NOT empty. Every account starts unset, so this is the common path.
    expect(sendMock.mock.calls[0]![0].replyTo).toBeUndefined();
  });
});

/**
 * f/[publicId]/actions.test.ts pins that account.from_email must NOT reach
 * the lead alert's fromAddress — an absence check (spec §3). Absence alone
 * proves nothing about THIS send path: it would stay green whether
 * from_email is correctly selected and forwarded here, silently dropped
 * from the `.select` string, or never read at all. This project has been
 * bitten by exactly that asymmetry before — a spec that passed five absence
 * checks while the feature under test was entirely broken. This pair is the
 * positive counterpart: it proves the column is actually selected and
 * actually reaches the customer-facing send.
 */
describe("sendEmailAction — the client's own sending domain, when they have one", () => {
  it("sends from the client's own domain when the account has set one", async () => {
    accountRow.from_email = "leads@acme.com";

    await sendEmailAction("acct_1", fd({
      contactId: "contact_1", subject: "Hi", body: "Quote attached",
    }));

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      fromAddress: "leads@acme.com",
    }));
  });

  it("omits the from-address when the account has not set one, falling back to EMAIL_FROM", async () => {
    await sendEmailAction("acct_1", fd({
      contactId: "contact_1", subject: "Hi", body: "Quote attached",
    }));

    expect(sendMock).toHaveBeenCalled();
    expect(sendMock.mock.calls[0]![0].fromAddress).toBeUndefined();
  });
});

describe("sendEmailAction — the customer sees the brand, never the internal label", () => {
  it("sends html and text and uses the brand name", async () => {
    await sendEmailAction("acct_1", fd({
      contactId: "contact_1", subject: "Hi", body: "Quote attached",
    }));

    const sent = sendMock.mock.calls[0]![0];
    expect(sent.html).toContain("Rio Roofing");
    expect(sent.body).toBe("Quote attached");
    // accounts.name is "Rio Roofing — trial": the agency's private label, which
    // has been going out in the From line of every message a customer receives.
    expect(sent.fromName).toBe("Rio Roofing");
  });

  // Review fix. Same CRLF normalization as sendSmsAction's own (a real
  // browser's form-data-set algorithm writes `\r\n` for a textarea's line
  // breaks on submit): outboundEmail's html conversion is
  // `body.replace(/\n/g, "<br />")`, which only matches the `\n` half of an
  // un-normalized CRLF and leaves a stray `\r` sitting in front of every
  // `<br />` in the html part, and in the text part verbatim.
  it("normalizes a CRLF line break (what a real browser's form submit sends) to a bare \\n before sending, in both parts (mutation: skip the normalize → FAILS)", async () => {
    await sendEmailAction("acct_1", fd({
      contactId: "contact_1", subject: "Hi", body: "line one\r\nline two",
    }));

    const sent = sendMock.mock.calls[0]![0];
    expect(sent.body).toBe("line one\nline two");
    expect(sent.html).toContain("line one<br />line two");
    expect(sent.html).not.toContain("\r");
  });

  // Was "falls back to the account name when no brand name is set". There is
  // no fallback any more: `emailBrand` takes the branding and nothing else, and
  // this action no longer even selects `name`. An account with no brand name
  // sends with a blank From name rather than the agency's private label —
  // unreachable through the product (creation seeds a brand name, the Branding
  // save refuses a blank, go-live requires the step, 0028 backfilled the rest).
  //
  // Mutation: reintroduce `?? account?.name` at the emailBrand call.
  it("sends a BLANK From name, never the internal label, when no brand name is set", async () => {
    accountRow.brand_name = null;

    await sendEmailAction("acct_1", fd({
      contactId: "contact_1", subject: "Hi", body: "Quote attached",
    }));

    expect(sendMock.mock.calls[0]![0].fromName).toBe("");
  });

  it("a staff-typed email goes as staff.composer_email for this account and contact, and — (decision Q4) — reaches the provider with no unsubscribe footer and no headers, even with the secret set (choice 22; mutation: send it as a customer-initiated kind → headers appear, FAILS)", async () => {
    vi.stubEnv("CONSENT_TOKEN_SECRET", "composer-test-secret-0123456789abcdef");
    vi.stubEnv("APP_ORIGIN", "https://app.example.com");

    await sendEmailAction("acct_1", fd({
      contactId: "contact_1", subject: "Hi", body: "Quote attached",
    }));

    expect(gated()).toEqual([expect.objectContaining({ kind: "staff.composer_email", accountId: "acct_1", contactId: "contact_1" })]);
    const provided = sendMock.mock.calls[0]![0] as { headers?: unknown; body: string };
    expect(provided.headers).toBeUndefined();
    expect(provided.body).not.toMatch(/Unsubscribe/);
    vi.unstubAllEnvs();
  });
});

/**
 * sendSmsAction is the feature's entire safety boundary (A2P gate + phone
 * normalization stand between a click and a real text to a real phone), and
 * had no test at any layer before this file.
 */
describe("sendSmsAction — the gate blocks before anything is written", () => {
  it("a gate refusal stops the send: no provider call, no message row", async () => {
    gateMock.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });

    await expect(sendSmsAction("acct_1", fd({
      contactId: "contact_1", body: "On our way",
    }))).rejects.toThrow();

    expect(createMessageMock).not.toHaveBeenCalled();
    expect(smsSendMock).not.toHaveBeenCalled();
  });
});

describe("sendSmsAction — the from number comes from the gate and nowhere else", () => {
  it("sends from exactly the number the gate returned", async () => {
    gateMock.mockResolvedValue({ ok: true, from: "+19565550001" });

    await sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }));

    expect(smsSendMock).toHaveBeenCalledWith(expect.objectContaining({ from: "+19565550001" }));
  });

  it("the send gate runs on the SERVICE client, and only after the contact was read on the request client, the read that authorises it (mutation: read the contact on the service client -> FAILS)", async () => {
    await sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }));

    expect(vi.mocked(getContact).mock.calls[0]![0]).toBe(req.db);
    expect(gateMock.mock.calls[0]![0]).toBe(svc.db);
    expect(vi.mocked(getContact).mock.invocationCallOrder[0]!).toBeLessThan(gateMock.mock.invocationCallOrder[0]!);
  });
});

describe("sendSmsAction — the contact's phone must survive normalisation (F-009) before anything is written", () => {
  it("rejects an unnormalizable phone before any row is written", async () => {
    contactRow.phone = "not a phone";

    await expect(sendSmsAction("acct_1", fd({
      contactId: "contact_1", body: "On our way",
    }))).rejects.toThrow();

    expect(createMessageMock).not.toHaveBeenCalled();
    expect(smsSendMock).not.toHaveBeenCalled();
  });

  it("normalizes a free-form phone to E.164 before it reaches the provider", async () => {
    contactRow.phone = "(956) 292-1696";

    await sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }));

    expect(smsSendMock).toHaveBeenCalledWith(expect.objectContaining({ to: "+19562921696" }));
  });
});

describe("sendSmsAction — write then send", () => {
  it("creates the message row before calling the provider", async () => {
    await sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }));

    expect(createMessageMock).toHaveBeenCalled();
    expect(smsSendMock).toHaveBeenCalled();
    expect(createMessageMock.mock.invocationCallOrder[0]!)
      .toBeLessThan(smsSendMock.mock.invocationCallOrder[0]!);
  });
});

describe("sendSmsAction — provider failure marks the row failed", () => {
  it("marks the message failed when the provider throws", async () => {
    smsSendMock.mockRejectedValue(new Error("carrier rejected"));

    await expect(sendSmsAction("acct_1", fd({
      contactId: "contact_1", body: "On our way",
    }))).rejects.toThrow("carrier rejected");

    expect(updateMessageStatusMock).toHaveBeenCalledWith(
      expect.anything(), "acct_1", "msg_1", "failed",
      expect.objectContaining({ error: "carrier rejected" }),
      "user_1",
    );
  });
});

describe("sendSmsAction — success, and the one place it must not paper over a failure", () => {
  it("marks the row sent with the provider's message id", async () => {
    smsSendMock.mockResolvedValue({ providerMessageId: "pm_success" });

    await sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }));

    expect(updateMessageStatusMock).toHaveBeenCalledWith(
      expect.anything(), "acct_1", "msg_1", "sent",
      { providerMessageId: "pm_success" },
      "user_1",
    );
  });

  /**
   * The final status write sits OUTSIDE the try/catch that wraps the
   * provider call, on purpose: by the time it runs the text is already gone
   * and irrevocably out the door, so a failure here (a rare DB error) must
   * propagate as-is, never get caught and relabeled "failed" — that would
   * tell the operator a delivered text didn't go out and invite a duplicate
   * send to a real phone.
   */
  it("propagates a failure of the final status write without relabeling the row failed", async () => {
    updateMessageStatusMock.mockRejectedValue(new Error("db down"));

    await expect(sendSmsAction("acct_1", fd({
      contactId: "contact_1", body: "On our way",
    }))).rejects.toThrow("db down");

    expect(updateMessageStatusMock).toHaveBeenCalledTimes(1);
    expect(updateMessageStatusMock.mock.calls[0]![3]).toBe("sent");
  });
});

describe("sendSmsAction — usage (client billing)", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

  it("a sent text records its segments on the SERVICE client, against the message row (mutation: pass the request's RLS client → FAILS)", async () => {
    await sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }));
    expect(recordUsageMock).toHaveBeenCalledTimes(1);
    expect(recordUsageMock).toHaveBeenCalledWith(svc.db, {
      accountId: "acct_1", meter: "sms", quantity: 1, occurredAt: expect.any(Date), sourceRef: "message:msg_1",
    });
  });

  it("a 161-character text bills two segments (mutation: bill 1 per text → FAILS)", async () => {
    await sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "a".repeat(161) }));
    expect(recordUsageMock).toHaveBeenCalledWith(svc.db, expect.objectContaining({ quantity: 2 }));
  });

  // Review fix. A real browser's form-data-set algorithm normalizes a
  // textarea's line breaks to CRLF on submit (HTML spec), even though the
  // operator only ever typed (and the live segment counter in
  // message-composer.tsx only ever saw) a bare \n. segments.ts counts \r as
  // its own GSM-7 septet, so an un-normalized CRLF line break costs TWO
  // septets instead of one. The line break sits in the MIDDLE, not at an
  // edge: `sendSmsAction` already `.trim()`s the body, which would eat a
  // trailing CRLF on its own and prove nothing about the normalize this
  // fix adds. 80 + 79 'a's plus one mid-string line break: 160 septets (1
  // segment) normalized, 161 (2 segments) if the \r survives — the FormData
  // built by `fd()` here already carries the literal CRLF a real browser
  // submit would; this is not a browser simulation, it is the exact bytes
  // `formData.get("body")` returns either way.
  it("a near-160-character text with a mid-string CRLF line break (what a real browser's form submit sends) bills ONE segment, matching what the operator's own counter showed (mutation: skip the CRLF normalize → FAILS)", async () => {
    await sendSmsAction("acct_1", fd({
      contactId: "contact_1", body: `${"a".repeat(80)}\r\n${"a".repeat(79)}`,
    }));
    expect(recordUsageMock).toHaveBeenCalledWith(svc.db, expect.objectContaining({ quantity: 1 }));
  });

  it("a text the carrier refused records nothing (mutation: record before the send → FAILS)", async () => {
    smsSendMock.mockRejectedValue(new Error("carrier rejected"));
    await expect(sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }))).rejects.toThrow("carrier rejected");
    expect(recordUsageMock).not.toHaveBeenCalled();
  });

  it("a fake provider, or a real one redirected to a developer's phone, records nothing (mutation: drop the smsBillable gate → FAILS)", async () => {
    svc.provider.isFake = true;
    await sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }));
    svc.provider.isFake = false;
    svc.provider.redirectTo = "+19565550199";
    await sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }));
    expect(smsSendMock).toHaveBeenCalledTimes(2);
    expect(recordUsageMock).not.toHaveBeenCalled();
  });

  it("the 'sent' write, which stores the provider id the delivery webhook correlates against, comes straight after the send, BEFORE the usage write (mutation: record usage before the 'sent' write → call order FAILS)", async () => {
    await sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }));
    expect(updateMessageStatusMock.mock.calls.map((c) => c[3])).toEqual(["sent"]);
    expect(updateMessageStatusMock.mock.invocationCallOrder[0]!).toBeLessThan(recordUsageMock.mock.invocationCallOrder[0]!);
  });

  it("the usage row lands even when the final 'sent' write throws, and that write's error is what rejects (mutation: record after that write outside its finally → FAILS)", async () => {
    updateMessageStatusMock.mockRejectedValue(new Error("db down"));
    await expect(sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }))).rejects.toThrow("db down");
    expect(recordUsageMock).toHaveBeenCalledTimes(1);
  });

  // Split from a single test that used to also cover a service client that
  // cannot be built at all: since 0053 the writer is built BEFORE any row is
  // written, so with no service key the action refuses up front rather than
  // resolving with the row still marked sent. See the next describe block.
  it("a failing usage write leaves the action resolving and the row marked sent", async () => {
    recordUsageMock.mockRejectedValue(new Error("usage_events is down"));
    await expect(sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }))).resolves.toBeUndefined();
    expect(updateMessageStatusMock.mock.calls.map((c) => c[3])).toEqual(["sent"]);
  });
});

describe("sendSmsAction — with no service client, the action refuses up front", () => {
  it("with no service client the action refuses before any row is written or any text is sent (mutation: build the writer after the send -> FAILS)", async () => {
    svc.throws = true;
    await expect(sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" })))
      .rejects.toThrow("SUPABASE_SERVICE_ROLE_KEY is missing");
    expect(createMessageMock).not.toHaveBeenCalled();
    expect(smsSendMock).not.toHaveBeenCalled();
  });
});

describe("0053 — conversations and messages are written by server code", () => {
  it("email: reads the contact as the signed-in user, writes conversation and message rows with the service client (mutation: pass the request client to createMessage -> FAILS)", async () => {
    await sendEmailAction("acct_1", fd({ contactId: "contact_1", subject: "Hi", body: "Hello" }));
    // IDENTITY, not structural equality: a same-shaped object that is not the
    // exact mock would satisfy `toHaveBeenCalledWith`'s deep-equal and pass
    // whichever client actually reached the call.
    expect(vi.mocked(getContact).mock.calls[0]![0]).toBe(req.db);
    expect(vi.mocked(getContact).mock.calls[0]!.slice(1)).toEqual(["acct_1", "contact_1"]);
    expect(vi.mocked(ensureConversation).mock.calls[0]![0]).toBe(svc.db);
    expect(vi.mocked(ensureConversation).mock.calls[0]!.slice(1)).toEqual(["acct_1", "contact_1", "user_1"]);
    expect(createMessageMock.mock.calls[0]![0]).toBe(svc.db);
    expect(updateMessageStatusMock.mock.calls.map((c) => c[0])).toEqual([svc.db]);
  });

  it("email: a provider failure marks the row failed on the SERVICE client, not the request client (mutation: the failure branch uses the request client -> FAILS)", async () => {
    sendMock.mockRejectedValueOnce(new Error("provider down"));
    await expect(sendEmailAction("acct_1", fd({ contactId: "contact_1", subject: "Hi", body: "Hello" })))
      .rejects.toThrow("provider down");
    expect(updateMessageStatusMock).toHaveBeenCalledWith(
      svc.db, "acct_1", "msg_1", "failed", { error: "provider down" }, "user_1",
    );
  });

  it("sms: same split, including the failed-send status write (mutation: the failure branch uses the request client -> FAILS)", async () => {
    smsSendMock.mockRejectedValueOnce(new Error("carrier down"));
    await expect(sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }))).rejects.toThrow("carrier down");
    expect(vi.mocked(getContact).mock.calls[0]![0]).toBe(req.db);
    expect(vi.mocked(getContact).mock.calls[0]!.slice(1)).toEqual(["acct_1", "contact_1"]);
    expect(vi.mocked(ensureConversation).mock.calls[0]![0]).toBe(svc.db);
    expect(vi.mocked(ensureConversation).mock.calls[0]!.slice(1)).toEqual(["acct_1", "contact_1", "user_1"]);
    expect(createMessageMock.mock.calls[0]![0]).toBe(svc.db);
    expect(updateMessageStatusMock).toHaveBeenCalledWith(svc.db, "acct_1", "msg_1", "failed", { error: "carrier down" }, "user_1");
  });

  it("sms: a successful send marks the row sent on the SERVICE client, not the request client (mutation: the sent write uses the request client -> FAILS)", async () => {
    await sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }));
    expect(updateMessageStatusMock).toHaveBeenCalledWith(
      svc.db, "acct_1", "msg_1", "sent", { providerMessageId: "pm_1" }, "user_1",
    );
  });

  it("mark read: calls requireAccountAccess for the account, and clears the unread count with the service client (mutation: dbForRequest() -> FAILS)", async () => {
    await markConversationReadAction("acct_1", "convo_9");
    expect(requireAccountAccessMock).toHaveBeenCalledWith("acct_1");
    expect(vi.mocked(clearUnreadCount)).toHaveBeenCalledWith(svc.db, "acct_1", "convo_9");
  });
});

describe("0053 — every write-path action requires access before touching anything else", () => {
  it("sendEmailAction: a rejected access check stops everything downstream (mutation: call it after getContact -> FAILS)", async () => {
    requireAccountAccessMock.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(sendEmailAction("acct_1", fd({ contactId: "contact_1", subject: "Hi", body: "Hello" })))
      .rejects.toThrow("NEXT_REDIRECT");
    expect(vi.mocked(getContact)).not.toHaveBeenCalled();
    expect(createMessageMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sendSmsAction: a rejected access check stops everything downstream (mutation: call it after getContact -> FAILS)", async () => {
    requireAccountAccessMock.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" })))
      .rejects.toThrow("NEXT_REDIRECT");
    expect(vi.mocked(getContact)).not.toHaveBeenCalled();
    expect(createMessageMock).not.toHaveBeenCalled();
    expect(smsSendMock).not.toHaveBeenCalled();
  });

  it("markConversationReadAction: a rejected access check leaves clearUnreadCount untouched (mutation: remove the call, or move it after clearUnreadCount -> FAILS)", async () => {
    requireAccountAccessMock.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(markConversationReadAction("acct_1", "convo_9")).rejects.toThrow("NEXT_REDIRECT");
    expect(vi.mocked(clearUnreadCount)).not.toHaveBeenCalled();
  });
});

/**
 * Consent chain PR-1 (spec §6): the composer goes through the send gate as
 * `staff.composer_sms`. A refusal after an attempt (a stale tab, or a stop
 * that landed since the page rendered) says the SAME line the composer shows
 * on render (lib/consent/composer-state.ts); an unreadable ledger is a
 * failure, never worded as the customer's choice.
 */
describe("sendSmsAction — the consent gate's refusals", () => {
  const send = () => sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" })).catch((e: unknown) => e);

  it("a stopped number: rejected with the composer's own stopped line; nothing written, nothing sent (mutation: rethrow the raw reason → FAILS)", async () => {
    vi.mocked(readConsentState).mockResolvedValueOnce({ state: "stopped", since: "2026-10-03T15:00:00Z", method: "keyword", eventId: "e1" });
    expect(sendRejectedReason(await send())).toBe(m["compose.smsStoppedUndated"]);
    expect(createMessageMock).not.toHaveBeenCalled();
    expect(smsSendMock).not.toHaveBeenCalled();
  });

  it("held, and a number that could be Mexican or US, each say their own line (mutation: swap the two lines → FAILS)", async () => {
    vi.mocked(readConsentState).mockResolvedValueOnce({ state: "held", since: "2026-10-03T15:00:00Z", method: "free_text", eventId: "e2" });
    expect(sendRejectedReason(await send())).toBe(m["compose.smsHeld"]);
    vi.mocked(readPhoneCountryFlag).mockResolvedValueOnce(true);
    expect(sendRejectedReason(await send())).toBe(m["compose.smsCheckNumber"]);
    expect(smsSendMock).not.toHaveBeenCalled();
  });

  it("an unreadable state answers the render's own line, never the customer's choice (review R3-M2; mutation: map it to the stopped line → FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(readConsentState).mockRejectedValueOnce(new Error("permission denied for table consent_events"));
    expect(sendRejectedReason(await send())).toBe(m["compose.smsStateUnknown"]);
    expect(smsSendMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a carrier refusal for a number that texted STOP says the stopped line on the FIRST attempt, and the row is marked failed (review R3-I3; mutation: throw the provider's error → FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    smsSendMock.mockRejectedValueOnce(new SmsProviderError('telnyx send failed (400): {"errors":[{"code":"40300"}]}', 400, ["40300"]));
    expect(sendRejectedReason(await send())).toBe(m["compose.smsStoppedUndated"]);
    expect(updateMessageStatusMock).toHaveBeenCalledWith(svc.db, "acct_1", "msg_1", "failed", expect.anything(), "user_1");
    spy.mockRestore();
  });

  it("the ledger is read for THIS account, sms, on the contact's NORMALISED number (mutation: pass the stored phone as typed → FAILS)", async () => {
    contactRow.phone = "(956) 292-1696";
    await sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }));
    expect(vi.mocked(readConsentState)).toHaveBeenCalledWith(svc.db, "acct_1", "sms", "+19562921696");
  });

  it("a suppressed account: refused with the plain sentence, nothing written, nothing sent (D-061; mutation: drop the chokepoint check → sent, FAILS)", async () => {
    vi.mocked(isAccountOutboundSuppressed).mockResolvedValueOnce(true);
    expect(sendRejectedReason(await send())).toBe(m["automations.reason.accountSuppressed"]);
    expect(createMessageMock).not.toHaveBeenCalled();
    expect(smsSendMock).not.toHaveBeenCalled();
  });
});
