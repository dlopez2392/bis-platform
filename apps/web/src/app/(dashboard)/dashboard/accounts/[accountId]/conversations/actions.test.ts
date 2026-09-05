import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: async () => ({ userId: "user_1" }) }));

const sendMock = vi.fn();
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => ({ send: (...a: unknown[]) => sendMock(...a) }),
}));

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
vi.mock("@/lib/sms", () => ({
  getSmsProvider: () => ({ send: (...a: unknown[]) => smsSendMock(...a) }),
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
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
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
  }),
}));

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
  getContact: async () => contactRow,
  ensureConversation: async () => ({ id: "convo_1" }),
  // vi.fn(), not a plain async function: the write-then-send ordering test
  // below needs invocationCallOrder against the SMS provider's send mock.
  createMessage: vi.fn(async () => ({ id: "msg_1" })),
  updateMessageStatus: vi.fn(),
  clearUnreadCount: vi.fn(),
}));

import { sendEmailAction, sendSmsAction } from "./actions";
import { createMessage, updateMessageStatus } from "@bis/db";

const createMessageMock = vi.mocked(createMessage);
const updateMessageStatusMock = vi.mocked(updateMessageStatus);

function fd(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [k, v] of Object.entries(entries)) formData.set(k, v);
  return formData;
}

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({ providerMessageId: "pm_1" });
  smsSendMock.mockReset().mockResolvedValue({ providerMessageId: "pm_1" });
  gateMock.mockReset().mockResolvedValue({ ok: true, from: "+19565559999" });
  createMessageMock.mockClear();
  createMessageMock.mockResolvedValue({ id: "msg_1" });
  updateMessageStatusMock.mockClear();
  updateMessageStatusMock.mockResolvedValue(undefined);
  accountRow.reply_to_email = null;
  accountRow.from_email = null;
  accountRow.brand_name = "Rio Roofing";
  contactRow.email = "customer@example.com";
  contactRow.phone = "9565551234";
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

  it("falls back to the account name when no brand name is set", async () => {
    accountRow.brand_name = null;

    await sendEmailAction("acct_1", fd({
      contactId: "contact_1", subject: "Hi", body: "Quote attached",
    }));

    expect(sendMock.mock.calls[0]![0].fromName).toBe("Rio Roofing — trial");
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
});

describe("sendSmsAction — the contact's phone must survive toE164 before anything is written", () => {
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
