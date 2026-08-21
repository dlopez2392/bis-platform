import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: async () => ({ userId: "user_1" }) }));

const sendMock = vi.fn();
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => ({ send: (...a: unknown[]) => sendMock(...a) }),
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

vi.mock("@bis/db", () => ({
  brandLogoUrl: (path: string) => `https://cdn.test/${path}`,
  getContact: async () => ({ id: "contact_1", email: "customer@example.com" }),
  ensureConversation: async () => ({ id: "convo_1" }),
  createMessage: async () => ({ id: "msg_1" }),
  updateMessageStatus: vi.fn(),
  clearUnreadCount: vi.fn(),
}));

import { sendEmailAction } from "./actions";

function fd(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [k, v] of Object.entries(entries)) formData.set(k, v);
  return formData;
}

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({ providerMessageId: "pm_1" });
  accountRow.reply_to_email = null;
  accountRow.from_email = null;
  accountRow.brand_name = "Rio Roofing";
});

/**
 * Mail goes out FROM crm@bis-rgv.com carrying the company's display name, so
 * without a reply-to the customer's reply reaches BIS and the company that
 * wrote to them never sees it. That is the gap this pair pins.
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
