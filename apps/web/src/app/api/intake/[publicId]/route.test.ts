import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getPublishedFormByPublicIdMock = vi.fn();
const createSubmissionMock = vi.fn();
const findRecentDuplicateMock = vi.fn();
const setSubmissionProcessingErrorMock = vi.fn();
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getPublishedFormByPublicId: (...a: unknown[]) => getPublishedFormByPublicIdMock(...a),
  createSubmission: (...a: unknown[]) => createSubmissionMock(...a),
  findRecentDuplicate: (...a: unknown[]) => findRecentDuplicateMock(...a),
  setSubmissionProcessingError: (...a: unknown[]) => setSubmissionProcessingErrorMock(...a),
}));
// The pipeline after the row is `enrich`, owned and tested by the public form
// action's suite; here it is the seam this route must hand the right things to.
const enrichMock = vi.fn();
vi.mock("@/lib/forms/enrich", () => ({ enrich: (...a: unknown[]) => enrichMock(...a) }));

import { POST } from "./route";

const FORM = {
  id: "form_1", account_id: "acct_1", name: "Website contact — English", locale_default: "en",
  notify_emails: [], success_mode: "message", success_message: null, redirect_url: null,
  fields: [
    { key: "first_name", kind: "core.first_name", label: "First name", required: true },
    { key: "last_name", kind: "core.last_name", label: "Last name", required: false },
    { key: "company_name", kind: "core.company_name", label: "Business name", required: true },
    { key: "email", kind: "core.email", label: "Email address", required: true },
    { key: "phone", kind: "core.phone", label: "Phone number", required: true },
    { key: "message", kind: "message", label: "What would you like help with?", required: false },
    { key: "sms_consent", kind: "consent", label: "Yes, BIS may text me.", required: false },
  ],
};
const GOOD = {
  locale: "en",
  source: "bis-rgv.com assistant",
  attribution: { utm_source: "bis-rgv.com", utm_medium: "ai-assistant", evil: "x" },
  answers: {
    first_name: "Ana", last_name: "Garza", company_name: "Garza HVAC",
    email: "ana@example.com", phone: "(956) 555-0134", message: "[via AI assistant] Missed calls after hours",
  },
};

function call(body: unknown, headers: Record<string, string> = {}, publicId = "i994hbegzxng") {
  const req = new Request(`https://app.bis-rgv.com/api/intake/${publicId}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "app.bis-rgv.com", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ publicId }) });
}
const bearer = { authorization: "Bearer test-secret-value" };

describe("POST /api/intake/[publicId]", () => {
  const original = process.env.LEAD_INTAKE_SECRET;
  beforeEach(() => {
    process.env.LEAD_INTAKE_SECRET = "test-secret-value";
    // `hashIp`/`hashAnswers` in guards.ts are keyed hashes; the public form's
    // own suite sets the same key.
    process.env.FORM_TOKEN_SECRET = "test-form-token-secret";
    getPublishedFormByPublicIdMock.mockReset().mockResolvedValue(FORM);
    createSubmissionMock.mockReset().mockResolvedValue({ id: "sub_1" });
    findRecentDuplicateMock.mockReset().mockResolvedValue(null);
    setSubmissionProcessingErrorMock.mockReset().mockResolvedValue(undefined);
    enrichMock.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => { process.env.LEAD_INTAKE_SECRET = original; });

  it("is closed, with zero queries, until the secret is configured", async () => {
    delete process.env.LEAD_INTAKE_SECRET;
    const res = await call(GOOD, bearer);
    expect(res.status).toBe(503);
    expect(getPublishedFormByPublicIdMock).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong bearer before touching the database", async () => {
    expect((await call(GOOD)).status).toBe(401);
    expect((await call(GOOD, { authorization: "Bearer nope" })).status).toBe(401);
    expect((await call(GOOD, { authorization: "Bearer test-secret-valu" })).status).toBe(401);
    expect(getPublishedFormByPublicIdMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed or oversized body, and an unknown form", async () => {
    expect((await call("{not json", bearer)).status).toBe(400);
    expect((await call({ locale: "en" }, bearer)).status).toBe(400);
    expect((await call({ answers: { message: "x".repeat(40_000) } }, bearer)).status).toBe(413);
    getPublishedFormByPublicIdMock.mockResolvedValue(null);
    expect((await call(GOOD, bearer)).status).toBe(404);
    expect(createSubmissionMock).not.toHaveBeenCalled();
  });

  it("validates against the form's own fields — required, email, phone — and names the field", async () => {
    const missing = await call({ ...GOOD, answers: { ...GOOD.answers, company_name: "" } }, bearer);
    expect(missing.status).toBe(400);
    expect((await missing.json()).fieldErrors).toEqual({ company_name: "required" });
    const bad = await call({ ...GOOD, answers: { ...GOOD.answers, email: "not-an-email", phone: "12" } }, bearer);
    expect((await bad.json()).fieldErrors).toEqual({ email: "invalid", phone: "invalid" });
    expect(createSubmissionMock).not.toHaveBeenCalled();
  });

  it("writes one submission shaped like the form, with consent NOT given, then enriches with the text withheld", async () => {
    const res = await call(GOOD, bearer);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, submissionId: "sub_1" });

    const [, accountId, formId, input] = createSubmissionMock.mock.calls[0]!;
    expect([accountId, formId]).toEqual(["acct_1", "form_1"]);
    expect(input.answers).toEqual([
      { key: "first_name", label: "First name", value: "Ana" },
      { key: "last_name", label: "Last name", value: "Garza" },
      { key: "company_name", label: "Business name", value: "Garza HVAC" },
      { key: "email", label: "Email address", value: "ana@example.com" },
      { key: "phone", label: "Phone number", value: "(956) 555-0134" },
      { key: "message", label: "What would you like help with?", value: "[via AI assistant] Missed calls after hours" },
    ]);
    // A conversation cannot tick a box: recorded, and recorded as not given.
    expect(input.consent).toEqual([expect.objectContaining({ key: "sms_consent", given: false, text: "Yes, BIS may text me." })]);
    // Only the allow-listed attribution keys survive.
    expect(input.attribution).toEqual({ utm_source: "bis-rgv.com", utm_medium: "ai-assistant" });
    expect(input.locale).toBe("en");

    const [, form, submissionId, answers, attribution, origin, locale, consentWithheld] = enrichMock.mock.calls[0]!;
    expect(form).toBe(FORM);
    expect(submissionId).toBe("sub_1");
    expect(answers).toBe(input.answers);
    expect(attribution).toEqual(input.attribution);
    expect(origin).toBe("https://app.bis-rgv.com");
    expect(locale).toBe("en");
    expect(consentWithheld).toBe(true);
  });

  it("suppresses a duplicate inside the window without a second row", async () => {
    findRecentDuplicateMock.mockResolvedValue({ id: "sub_0" });
    const res = await call(GOOD, bearer);
    expect(await res.json()).toEqual({ ok: true, duplicate: true, submissionId: "sub_0" });
    expect(createSubmissionMock).not.toHaveBeenCalled();
    expect(enrichMock).not.toHaveBeenCalled();
  });

  it("tells the caller when the row itself could not be written, so it can fall back", async () => {
    createSubmissionMock.mockRejectedValue(new Error("db down"));
    const res = await call(GOOD, bearer);
    expect(res.status).toBe(500);
    expect(enrichMock).not.toHaveBeenCalled();
  });

  it("keeps the lead and records the failure when enrichment throws", async () => {
    enrichMock.mockRejectedValue(new Error("mail down"));
    const res = await call(GOOD, bearer);
    expect(res.status).toBe(200);
    expect(setSubmissionProcessingErrorMock).toHaveBeenCalledWith({}, "acct_1", "sub_1", "mail down");
  });
});
