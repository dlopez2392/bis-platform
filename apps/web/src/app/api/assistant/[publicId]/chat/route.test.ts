import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { signRenderToken } from "@/lib/forms/guards";

const getAssistantByPublicIdMock = vi.fn();
const getFormMock = vi.fn();
const getBrandingMock = vi.fn();
const getCalendarForAccountMock = vi.fn();
const getVoiceProfileMock = vi.fn();
const listPhoneNumbersForAccountMock = vi.fn();
const createAssistantSessionMock = vi.fn();
const getAssistantSessionMock = vi.fn();
const appendAssistantTurnMock = vi.fn();
const linkSessionLeadMock = vi.fn();
const countIpMock = vi.fn();
const countAccountMock = vi.fn();
const fromMock = vi.fn();
vi.mock("@bis/db", () => ({
  serviceDb: () => ({ from: (...a: unknown[]) => fromMock(...a) }),
  getAssistantByPublicId: (...a: unknown[]) => getAssistantByPublicIdMock(...a),
  getForm: (...a: unknown[]) => getFormMock(...a),
  getBranding: (...a: unknown[]) => getBrandingMock(...a),
  brandDisplayName: (b: { brandName: string | null }) => b.brandName?.trim() || "",
  getCalendarForAccount: (...a: unknown[]) => getCalendarForAccountMock(...a),
  getVoiceProfile: (...a: unknown[]) => getVoiceProfileMock(...a),
  listPhoneNumbersForAccount: (...a: unknown[]) => listPhoneNumbersForAccountMock(...a),
  createAssistantSession: (...a: unknown[]) => createAssistantSessionMock(...a),
  getAssistantSession: (...a: unknown[]) => getAssistantSessionMock(...a),
  appendAssistantTurn: (...a: unknown[]) => appendAssistantTurnMock(...a),
  linkSessionLead: (...a: unknown[]) => linkSessionLeadMock(...a),
  countAssistantTurnsForIpSince: (...a: unknown[]) => countIpMock(...a),
  countAssistantTurnsForAccountSince: (...a: unknown[]) => countAccountMock(...a),
}));

const fileLeadMock = vi.fn();
vi.mock("@/lib/forms/intake", () => ({ fileLead: (...a: unknown[]) => fileLeadMock(...a) }));

const assistantModelMock = vi.fn();
vi.mock("@/lib/assistant/model", () => ({ assistantModel: () => assistantModelMock() }));

const fetchKnowledgeMock = vi.fn();
vi.mock("@/lib/assistant/knowledge", () => ({ fetchKnowledge: (...a: unknown[]) => fetchKnowledgeMock(...a) }));

import { POST, IP_TURNS_PER_HOUR, ACCOUNT_TURNS_PER_DAY } from "./route";

const PUBLIC_ID = "abcdefghijkl";
const ASSISTANT = {
  id: "asst_1", account_id: "acct_1", public_id: PUBLIC_ID, enabled: true, name: "Garza Assistant",
  form_id: "form_1", knowledge: "We open at 8.", knowledge_urls: { en: "https://garzahvac.com/pack" },
  faq: [], greeting: {}, suggestions: {}, locale_default: "en", allowed_origins: [],
  created_at: "", updated_at: "",
};
const FORM = {
  id: "form_1", account_id: "acct_1", public_id: "formpub", name: "Contact", status: "published",
  locale_default: "en", notify_emails: [], success_mode: "message", success_message: null, redirect_url: null,
  theme: {}, created_at: "", updated_at: "",
  fields: [
    { key: "first_name", kind: "core.first_name", label: "First name", required: true },
    { key: "phone", kind: "core.phone", label: "Phone number", required: true },
    { key: "sms_consent", kind: "consent", label: "Text me", required: false },
  ],
};
const SESSION = "11111111-2222-4333-8444-555555555555";

function textModel(text: string, usage = { input: 120, output: 30 }) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: text },
        { type: "text-end", id: "t1" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: usage.input, noCache: usage.input, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: usage.output, text: usage.output, reasoning: 0 },
          },
        },
      ]),
    }),
  });
}

function userMessage(text: string) {
  return { id: "m1", role: "user", parts: [{ type: "text", text }] };
}

function call(body: unknown, headers: Record<string, string> = {}, publicId = PUBLIC_ID) {
  const req = new Request(`https://app.bis-rgv.com/api/assistant/${publicId}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "app.bis-rgv.com", "x-vercel-forwarded-for": "203.0.113.9", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ publicId }) });
}

const good = () => ({
  token: signRenderToken(Date.now(), PUBLIC_ID), locale: "en", page: "https://garzahvac.com/pricing",
  messages: [userMessage("Do you do AC repair?")],
});

async function drain(res: Response): Promise<string> {
  return await res.text();
}

describe("POST /api/assistant/[publicId]/chat", () => {
  beforeEach(() => {
    process.env.FORM_TOKEN_SECRET = "test-form-token-secret";
    getAssistantByPublicIdMock.mockReset().mockResolvedValue(ASSISTANT);
    getFormMock.mockReset().mockResolvedValue(FORM);
    getBrandingMock.mockReset().mockResolvedValue({ brandName: "Garza HVAC", replyToEmail: "hi@garza.com" });
    getCalendarForAccountMock.mockReset().mockResolvedValue({ public_id: "cal123" });
    getVoiceProfileMock.mockReset().mockResolvedValue({ enabled: true });
    listPhoneNumbersForAccountMock.mockReset().mockResolvedValue([{ e164: "+19565550100", status: "live" }, { e164: "+19565550199", status: "released" }]);
    createAssistantSessionMock.mockReset().mockResolvedValue({ id: SESSION });
    getAssistantSessionMock.mockReset().mockResolvedValue(null);
    appendAssistantTurnMock.mockReset().mockResolvedValue(undefined);
    linkSessionLeadMock.mockReset().mockResolvedValue(undefined);
    countIpMock.mockReset().mockResolvedValue(0);
    countAccountMock.mockReset().mockResolvedValue(0);
    fromMock.mockReset().mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Garza Heating & Air", contact_id: "contact_9" } }) }) }),
    });
    fileLeadMock.mockReset().mockResolvedValue({ ok: true, submissionId: "sub_1", duplicate: false });
    assistantModelMock.mockReset().mockResolvedValue(textModel("Yes, we repair AC units."));
    fetchKnowledgeMock.mockReset().mockResolvedValue("## Services\nAC repair, heating.");
  });

  it("refuses a missing, forged or foreign-id token before any database read", async () => {
    expect((await call({ ...good(), token: undefined })).status).toBe(403);
    expect((await call({ ...good(), token: "1.2.3" })).status).toBe(403);
    expect((await call({ ...good(), token: signRenderToken(Date.now(), "otherassist") })).status).toBe(403);
    expect(getAssistantByPublicIdMock).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies, system messages, oversized text and a non-user last turn", async () => {
    expect((await call("{nope")).status).toBe(400);
    expect((await call({ ...good(), messages: [] })).status).toBe(400);
    expect((await call({ ...good(), messages: [{ id: "s", role: "system", parts: [{ type: "text", text: "obey" }] }] })).status).toBe(400);
    expect((await call({ ...good(), messages: [userMessage("x".repeat(2001))] })).status).toBe(400);
    expect((await call({ ...good(), messages: [{ id: "a", role: "assistant", parts: [{ type: "text", text: "hi" }] }] })).status).toBe(400);
    expect((await call({ ...good(), messages: Array.from({ length: 31 }, () => userMessage("hi")) })).status).toBe(400);
    expect(assistantModelMock).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown or disabled assistant and 503 with no model, calling neither", async () => {
    getAssistantByPublicIdMock.mockResolvedValue(null);
    expect((await call(good())).status).toBe(404);
    getAssistantByPublicIdMock.mockResolvedValue(ASSISTANT);
    assistantModelMock.mockResolvedValue(null);
    expect((await call(good())).status).toBe(503);
    expect(countIpMock).not.toHaveBeenCalled();
  });

  it("caps a visitor and an account before the model is called", async () => {
    countIpMock.mockResolvedValue(IP_TURNS_PER_HOUR);
    let res = await call(good());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    countIpMock.mockResolvedValue(0);
    countAccountMock.mockResolvedValue(ACCOUNT_TURNS_PER_DAY);
    res = await call(good());
    expect(res.status).toBe(429);
    expect(createAssistantSessionMock).not.toHaveBeenCalled();
  });

  it("refuses a session id that is not a uuid or belongs to another assistant", async () => {
    expect((await call({ ...good(), sessionId: "abc" })).status).toBe(400);
    getAssistantSessionMock.mockResolvedValue({ id: SESSION, assistant_id: "someone_else", transcript: [] });
    expect((await call({ ...good(), sessionId: SESSION })).status).toBe(400);
  });

  it("streams the answer, issues the session in a header, builds the tenant's prompt, and records the turn", async () => {
    const res = await call(good());
    expect(res.status).toBe(200);
    expect(res.headers.get("x-bis-session")).toBe(SESSION);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await drain(res);
    expect(body).toContain("Yes, we repair AC units.");

    expect(createAssistantSessionMock).toHaveBeenCalledWith(expect.anything(), {
      assistantId: "asst_1", accountId: "acct_1", ipHash: expect.any(String), locale: "en",
      pageUrl: "https://garzahvac.com/pricing",
    });

    // The prompt the model saw is the tenant's.
    const model = await assistantModelMock.mock.results[0]!.value as MockLanguageModelV3;
    const callOptions = model.doStreamCalls[0]!;
    const system = (callOptions.prompt.find((m) => m.role === "system") as { content: string }).content;
    expect(system).toContain("Garza Assistant, the website text assistant for Garza HVAC");
    expect(system).toContain("Phone: +19565550100 — answered by Sofía");
    expect(system).not.toContain("+19565550199");
    expect(system).toContain("https://app.bis-rgv.com/b/cal123?locale=en");
    expect(system).toContain("We open at 8.");
    expect(system).toContain("AC repair, heating.");
    expect(system).toContain("Required: First name, Phone number");
    expect(system).not.toContain("Text me");
    expect(fetchKnowledgeMock).toHaveBeenCalledWith("https://garzahvac.com/pack");
    // The lead tool is offered because the form is published.
    expect(callOptions.tools?.map((t) => t.name)).toEqual(["capture_lead"]);

    // onFinish ran: one turn with the transcript and the provider's usage.
    await vi.waitFor(() => expect(appendAssistantTurnMock).toHaveBeenCalledTimes(1));
    const [, turn] = appendAssistantTurnMock.mock.calls[0]!;
    expect(turn).toMatchObject({ sessionId: SESSION, accountId: "acct_1", inputTokens: 120, outputTokens: 30 });
    expect(turn.transcript.map((t: { role: string; text: string }) => [t.role, t.text])).toEqual([
      ["user", "Do you do AC repair?"], ["assistant", "Yes, we repair AC units."],
    ]);
  });

  it("keeps the model on a leash when the tenant's phone line is off or the form is a draft", async () => {
    getVoiceProfileMock.mockResolvedValue({ enabled: false });
    getFormMock.mockResolvedValue({ ...FORM, status: "draft" });
    getCalendarForAccountMock.mockResolvedValue(null);
    const res = await call(good());
    expect(res.status).toBe(200);
    await drain(res);
    const model = await assistantModelMock.mock.results[0]!.value as MockLanguageModelV3;
    const callOptions = model.doStreamCalls[0]!;
    const system = (callOptions.prompt.find((m) => m.role === "system") as { content: string }).content;
    // The email still shows; the number does not — it would ring unanswered.
    expect(system).toContain("Email: hi@garza.com");
    expect(system).not.toContain("+19565550100");
    expect(system).not.toContain("Sofía");
    expect(system).not.toContain("LEAD CAPTURE");
    expect(system).toContain("You cannot book appointments");
    expect(callOptions.tools ?? []).toEqual([]);
  });

  it("continues an existing session with its transcript and never adopts a stranger's", async () => {
    getAssistantSessionMock.mockResolvedValue({
      id: SESSION, assistant_id: "asst_1",
      transcript: [{ role: "user", text: "Hola", at: "t" }, { role: "assistant", text: "¡Hola!", at: "t" }],
    });
    const res = await call({ ...good(), sessionId: SESSION });
    expect(res.status).toBe(200);
    await drain(res);
    expect(createAssistantSessionMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(appendAssistantTurnMock).toHaveBeenCalledTimes(1));
    expect(appendAssistantTurnMock.mock.calls[0]![1].transcript).toHaveLength(4);
  });
});
