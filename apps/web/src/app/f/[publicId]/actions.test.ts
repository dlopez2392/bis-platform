import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const getPublishedFormByPublicIdMock = vi.fn();
const createSubmissionMock = vi.fn();
const recordRejectedSubmissionMock = vi.fn();
const countRecentSubmissionsMock = vi.fn();
const shouldRecordRateLimitMock = vi.fn();
const findRecentDuplicateMock = vi.fn();
const setSubmissionProcessingErrorMock = vi.fn();

vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getPublishedFormByPublicId: (...a: unknown[]) => getPublishedFormByPublicIdMock(...a),
  createSubmission: (...a: unknown[]) => createSubmissionMock(...a),
  recordRejectedSubmission: (...a: unknown[]) => recordRejectedSubmissionMock(...a),
  countRecentSubmissions: (...a: unknown[]) => countRecentSubmissionsMock(...a),
  shouldRecordRateLimit: (...a: unknown[]) => shouldRecordRateLimitMock(...a),
  findRecentDuplicate: (...a: unknown[]) => findRecentDuplicateMock(...a),
  linkSubmissionContact: vi.fn(),
  setSubmissionProcessingError: (...a: unknown[]) => setSubmissionProcessingErrorMock(...a),
  emitFormSubmitted: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  getContact: vi.fn(),
  ensureConversation: vi.fn(),
  createMessage: vi.fn(),
  incrementUnreadCount: vi.fn(),
}));

import { headers } from "next/headers";
import { submitFormAction } from "./actions";
import { signRenderToken, MAX_TOKEN_AGE_MS, MIN_FILL_MS, RENDER_TOKEN_FIELD } from "@/lib/forms/guards";
import { IDLE } from "./submit-result";

const PUBLIC_ID = "form_test1234";

function formRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "form_row_1",
    account_id: "acct_1",
    name: "Test Form",
    fields: [],
    theme: {},
    locale_default: "en",
    success_message: null,
    success_mode: "message",
    redirect_url: null,
    notify_emails: [],
    ...overrides,
  };
}

function fd(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [k, v] of Object.entries(entries)) formData.set(k, v);
  return formData;
}

beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});

beforeEach(() => {
  vi.mocked(headers).mockResolvedValue(new Headers({ "user-agent": "test-agent" }) as never);
  getPublishedFormByPublicIdMock.mockReset().mockResolvedValue(formRow());
  createSubmissionMock.mockReset().mockResolvedValue({ id: "sub_1" });
  recordRejectedSubmissionMock.mockReset();
  countRecentSubmissionsMock.mockReset().mockResolvedValue(0);
  shouldRecordRateLimitMock.mockReset().mockResolvedValue(true);
  findRecentDuplicateMock.mockReset().mockResolvedValue(null);
  setSubmissionProcessingErrorMock.mockReset();
});

describe("submitFormAction — expired render token (lead-loss regression)", () => {
  it("does not record the submission as spam and does not tell the visitor it succeeded", async () => {
    const issuedAt = Date.now() - MAX_TOKEN_AGE_MS - 60_000; // 31+ minutes ago
    const token = signRenderToken(issuedAt, PUBLIC_ID);
    const formData = fd({ [RENDER_TOKEN_FIELD]: token, locale: "en" });

    const result = await submitFormAction(PUBLIC_ID, IDLE, formData);

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.formError).toBeTruthy();
      expect(result.formError).toMatch(/refresh/i);
    }
    // The whole point: nothing lands in the spam bin, and no row is written
    // pretending this was rejected input.
    expect(recordRejectedSubmissionMock).not.toHaveBeenCalled();
    expect(createSubmissionMock).not.toHaveBeenCalled();
  });

  it("still returns a Spanish message when the expired submission was in es", async () => {
    const issuedAt = Date.now() - MAX_TOKEN_AGE_MS - 60_000;
    const token = signRenderToken(issuedAt, PUBLIC_ID);
    const formData = fd({ [RENDER_TOKEN_FIELD]: token, locale: "es" });

    const result = await submitFormAction(PUBLIC_ID, IDLE, formData);

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") expect(result.formError).toMatch(/actualiza/i);
  });

  it("a normal, well-timed submission still succeeds (no regression on the happy path)", async () => {
    const issuedAt = Date.now() - MIN_FILL_MS - 1000; // comfortably past MIN_FILL_MS, well inside the window
    const token = signRenderToken(issuedAt, PUBLIC_ID);
    const formData = fd({ [RENDER_TOKEN_FIELD]: token, locale: "en" });

    const result = await submitFormAction(PUBLIC_ID, IDLE, formData);

    expect(result.status).toBe("success");
    expect(createSubmissionMock).toHaveBeenCalledTimes(1);
    expect(recordRejectedSubmissionMock).not.toHaveBeenCalled();
  });

  it("a malformed/forged token is still recorded as too_fast spam (unchanged behavior)", async () => {
    const formData = fd({ [RENDER_TOKEN_FIELD]: "not-a-real-token", locale: "en" });

    const result = await submitFormAction(PUBLIC_ID, IDLE, formData);

    expect(result.status).toBe("success"); // same body a genuine accept gets
    expect(recordRejectedSubmissionMock).toHaveBeenCalledWith(
      expect.anything(), "acct_1", "form_row_1",
      expect.objectContaining({ spamReason: "too_fast" }),
    );
  });
});
