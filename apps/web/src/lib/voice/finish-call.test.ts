import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  finishCallRow: vi.fn(), createContact: vi.fn(), ensureConversation: vi.fn(),
  createMessage: vi.fn(), incrementUnreadCount: vi.fn(), emit: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const emailRefs = vi.hoisted(() => ({ providerShouldThrow: false, send: vi.fn() }));
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => {
    if (emailRefs.providerShouldThrow) throw new Error("RESEND_API_KEY missing");
    return { send: (...a: unknown[]) => emailRefs.send(...a) };
  },
}));
vi.mock("./summary-service", () => ({ generateSummary: vi.fn().mockResolvedValue("RECORDED — test.") }));

import { finishCall, type FinishContext } from "./finish-call";
import { emptyCallState, withLead, withMessage, withTranscript, withBooking } from "./call-state";

const ctx: FinishContext = {
  db: {} as any, accountId: "a1", accountName: "Rio Roofing",
  branding: { brandName: null, brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
  notifyEmails: ["staff@example.com"], callerNumber: "+19562921696",
  origin: "https://x.example", profileLanguage: "both",
};
const meta = { callRowId: "call1", startedAt: new Date("2027-06-01T12:00:00Z"), endedAt: new Date("2027-06-01T12:02:00Z") };

beforeEach(() => {
  Object.values(dbMocks).forEach((m) => m.mockReset());
  emailRefs.providerShouldThrow = false;
  emailRefs.send.mockReset().mockResolvedValue({ providerMessageId: "x" });
  dbMocks.createContact.mockResolvedValue({ id: "ct1", existing: false });
  dbMocks.ensureConversation.mockResolvedValue({ id: "cv1", created: true });
  dbMocks.createMessage.mockResolvedValue({ id: "m1" });
  dbMocks.finishCallRow.mockResolvedValue(undefined);
});

describe("finishCall", () => {
  it("a lead call runs the full treatment: contact → conversation → message(voice) → unread → alert → row", async () => {
    const s = withLead(withTranscript(emptyCallState(), { role: "caller", text: "hi", at: "t" }),
      { fields: { fullName: "Ana Ruiz", need: "roof quote", callbackNumber: "+19562921696" } });
    const r = await finishCall(s, ctx, meta);
    expect(r).toMatchObject({ stored: true, notified: true, outcome: "lead" });
    expect(dbMocks.createContact).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ firstName: "Ana", lastName: "Ruiz", phone: "+19562921696", source: "voice" }), "voice", "ai");
    expect(dbMocks.createMessage).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ channel: "voice", direction: "inbound" }), "voice", "ai");
    expect(dbMocks.incrementUnreadCount).toHaveBeenCalled();
    expect(emailRefs.send).toHaveBeenCalledTimes(1);
    const sent = emailRefs.send.mock.calls[0]![0];
    expect(sent.fromAddress).toBeUndefined();              // staff mail: platform From
    expect(dbMocks.finishCallRow).toHaveBeenCalledWith({}, "a1", "call1",
      expect.objectContaining({ outcome: "lead", contactId: "ct1", conversationId: "cv1", durationSecs: 120 }));
  });
  it("an abandoned call records the row but creates nothing and alerts nobody", async () => {
    const s = withTranscript(emptyCallState(), { role: "caller", text: "uh", at: "t" });
    const r = await finishCall(s, ctx, meta);
    expect(r.outcome).toBe("abandoned");
    expect(dbMocks.createContact).not.toHaveBeenCalled();
    expect(emailRefs.send).not.toHaveBeenCalled();
    expect(dbMocks.finishCallRow).toHaveBeenCalled();
  });
  it("DB down + email up → stored:false notified:true, and it never throws", async () => {
    dbMocks.finishCallRow.mockRejectedValue(new Error("db down"));
    dbMocks.createContact.mockRejectedValue(new Error("db down"));
    const s = withMessage(emptyCallState(), { body: "call me", at: "t" });
    const r = await finishCall(s, ctx, meta);
    expect(r).toMatchObject({ stored: false, notified: true });
  });
  it("both legs down → CALL LOST logged, still no throw", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.finishCallRow.mockRejectedValue(new Error("db down"));
    dbMocks.createContact.mockRejectedValue(new Error("db down"));
    emailRefs.send.mockRejectedValue(new Error("mail down"));
    const s = withMessage(emptyCallState(), { body: "call me", at: "t" });
    const r = await finishCall(s, ctx, meta);
    expect(r).toMatchObject({ stored: false, notified: false });
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes("CALL LOST"))).toBe(true);
    errSpy.mockRestore();
  });
  it("getEmailProvider() throwing (rotated key) returns ok without throwing, row still written", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    emailRefs.providerShouldThrow = true;
    const s = withLead(withTranscript(emptyCallState(), { role: "caller", text: "hi", at: "t" }),
      { fields: { fullName: "Ana Ruiz", need: "roof quote", callbackNumber: "+19562921696" } });
    const r = await finishCall(s, ctx, meta);
    expect(r).toMatchObject({ stored: true, notified: false, outcome: "lead" });
    expect(dbMocks.finishCallRow).toHaveBeenCalled();
    errSpy.mockRestore();
  });
  it("a booked call reuses state.contactId instead of creating a duplicate", async () => {
    const s = { ...withBooking(emptyCallState(), { id: "bk1", contactName: "Ana", startsAt: "x", endsAt: "y" }), contactId: "ct-existing" };
    await finishCall(s, ctx, meta);
    expect(dbMocks.createContact).not.toHaveBeenCalled();
    expect(dbMocks.finishCallRow).toHaveBeenCalledWith({}, "a1", "call1",
      expect.objectContaining({ outcome: "booked", contactId: "ct-existing", bookingId: "bk1" }));
  });
});
