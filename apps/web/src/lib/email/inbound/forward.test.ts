import { describe, it, expect, vi } from "vitest";
import { forwardToOwner } from "./forward";

const ROW = {
  id: "ie_1", accountId: "acc", conversationId: "conv", providerEmailId: "re_1", fromEmail: "ana@gmail.com", fromName: "Ana Ruiz",
  toEmail: "r-x@reply.bis-rgv.com", subject: "Re: Your appointment", text: "Sounds good", auth: { spf: null, dkim: null, dmarc: null, spam: null, virus: null }, attachmentCount: 0,
  status: "filed" as const, holdReason: null, messageId: "msg_1", decidedBy: "email-inbound", decidedAt: "x", receivedAt: "x",
};
const fakeDb = (account: Record<string, unknown> | null) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: account, error: null }) }) }) }),
}) as never;

describe("forwardToOwner (spec Inbound step 8)", () => {
  it("sends the owner's copy: operator kind, the platform sender, the customer as Reply-To, subject unchanged, the link (mutation: pass fromAddress → FAILS)", async () => {
    const send = vi.fn().mockResolvedValue({ kind: "sent", providerMessageId: "p" });
    await forwardToOwner({ db: fakeDb({ reply_to_email: "owner@rio.com", brand_name: "Rio Roofing", name: "Rio — trial", language: "en" }), send, origin: "https://app.example.com" },
      { row: ROW, contactId: "ana", senderName: "Ana Ruiz", attachmentCount: 2 });
    const r = send.mock.calls[0]![0];
    expect(r).toMatchObject({ accountId: "acc", kind: "operator.reply_forward", to: "owner@rio.com", fromName: "Ana Ruiz via Rio Roofing", replyTo: "ana@gmail.com", subject: "Re: Your appointment" });
    expect(r.fromAddress).toBeUndefined();
    expect(r.contactId).toBeUndefined();
    expect(r.body).toBe("Sounds good\n\nThis email had 2 attachments. They are not saved in BIS yet.\n\nAnswer in BIS: https://app.example.com/dashboard/accounts/acc/conversations?c=conv");
  });

  it("Spanish account: the Spanish lines (mutation: always English → FAILS)", async () => {
    const send = vi.fn().mockResolvedValue({ kind: "sent", providerMessageId: "p" });
    await forwardToOwner({ db: fakeDb({ reply_to_email: "owner@rio.com", brand_name: "Rio", name: "x", language: "es" }), send, origin: "https://app.example.com" },
      { row: ROW, contactId: "ana", senderName: null, attachmentCount: 1 });
    const r = send.mock.calls[0]![0];
    expect(r.fromName).toBe("ana@gmail.com vía Rio");
    expect(r.body).toBe("Sounds good\n\nEste correo traía 1 archivo adjunto. Aún no se guarda en BIS.\n\nResponder en BIS: https://app.example.com/dashboard/accounts/acc/conversations?c=conv");
  });

  it("no reply_to_email: nothing is sent; no origin: no link line (mutation: send to '' → FAILS)", async () => {
    const send = vi.fn();
    await forwardToOwner({ db: fakeDb({ reply_to_email: null, brand_name: "Rio", name: "x", language: "en" }), send, origin: null }, { row: ROW, contactId: "ana", senderName: "Ana", attachmentCount: 0 });
    expect(send).not.toHaveBeenCalled();
    await forwardToOwner({ db: fakeDb({ reply_to_email: "o@rio.com", brand_name: "Rio", name: "x", language: "en" }), send: send.mockResolvedValue({ kind: "sent", providerMessageId: "p" }), origin: null }, { row: ROW, contactId: "ana", senderName: "Ana", attachmentCount: 0 });
    expect(send.mock.calls[0]![0].body).toBe("Sounds good");
  });

  it("a send that is not 'sent' throws, so the pipeline logs it (mutation: ignore the result → FAILS)", async () => {
    const send = vi.fn().mockResolvedValue({ kind: "blocked", reason: "suppressed_account" });
    await expect(forwardToOwner({ db: fakeDb({ reply_to_email: "o@rio.com", brand_name: "Rio", name: "x", language: "en" }), send, origin: null }, { row: ROW, contactId: "ana", senderName: "Ana", attachmentCount: 0 })).rejects.toThrow(/suppressed_account/);
  });
});
