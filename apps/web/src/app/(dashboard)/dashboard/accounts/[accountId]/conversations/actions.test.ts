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
const accountRow: { name: string; reply_to_email: string | null } = {
  name: "Rio Roofing", reply_to_email: null,
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
