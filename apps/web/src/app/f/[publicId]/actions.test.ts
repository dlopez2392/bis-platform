import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const getPublishedFormByPublicIdMock = vi.fn();
const createSubmissionMock = vi.fn();
const recordRejectedSubmissionMock = vi.fn();
const countRecentSubmissionsMock = vi.fn();
const shouldRecordRateLimitMock = vi.fn();
const findRecentDuplicateMock = vi.fn();
const setSubmissionProcessingErrorMock = vi.fn();
const createContactMock = vi.fn();
const ensureConversationMock = vi.fn();
const createMessageMock = vi.fn();
const incrementUnreadCountMock = vi.fn();

const sendMock = vi.fn();
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => ({ send: (...a: unknown[]) => sendMock(...a) }),
}));

vi.mock("@bis/db", () => ({
  // Chainable only as far as the one direct query the action makes outside the
  // mocked helpers: notify()'s account-name lookup.
  serviceDb: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Acme" } }) }) }),
    }),
  }),
  getPublishedFormByPublicId: (...a: unknown[]) => getPublishedFormByPublicIdMock(...a),
  createSubmission: (...a: unknown[]) => createSubmissionMock(...a),
  recordRejectedSubmission: (...a: unknown[]) => recordRejectedSubmissionMock(...a),
  countRecentSubmissions: (...a: unknown[]) => countRecentSubmissionsMock(...a),
  shouldRecordRateLimit: (...a: unknown[]) => shouldRecordRateLimitMock(...a),
  findRecentDuplicate: (...a: unknown[]) => findRecentDuplicateMock(...a),
  linkSubmissionContact: vi.fn(),
  setSubmissionProcessingError: (...a: unknown[]) => setSubmissionProcessingErrorMock(...a),
  emitFormSubmitted: vi.fn(),
  createContact: (...a: unknown[]) => createContactMock(...a),
  updateContact: vi.fn(),
  getContact: vi.fn(),
  ensureConversation: (...a: unknown[]) => ensureConversationMock(...a),
  createMessage: (...a: unknown[]) => createMessageMock(...a),
  incrementUnreadCount: (...a: unknown[]) => incrementUnreadCountMock(...a),
}));

import { headers } from "next/headers";
import { submitFormAction } from "./actions";
import {
  signRenderToken, MAX_TOKEN_AGE_MS, MIN_FILL_MS, RENDER_TOKEN_FIELD,
  HONEYPOT_FIELD, RATE_LIMIT_MAX,
} from "@/lib/forms/guards";
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
  sendMock.mockReset().mockResolvedValue(undefined);
  createContactMock.mockReset().mockResolvedValue({ id: "contact_1", existing: false });
  ensureConversationMock.mockReset().mockResolvedValue({ id: "convo_1" });
  createMessageMock.mockReset().mockResolvedValue({ id: "msg_1" });
  incrementUnreadCountMock.mockReset();
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

  it("a lead with no message field still opens a conversation", async () => {
    // The gate used to be `if (messageBody)`, so a short form — name and email,
    // the highest-converting kind — produced a contact and an email and
    // NOTHING in Conversations, the only screen that flags a lead as unread.
    const fields = [
      { key: "first_name", kind: "core.first_name", label: "Name", required: true },
      { key: "email", kind: "core.email", label: "Email", required: true },
    ];
    getPublishedFormByPublicIdMock.mockResolvedValue(formRow({ fields }));
    const token = signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);

    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token, locale: "en",
      first_name: "Maria", email: "maria@example.com",
    }));

    expect(result.status).toBe("success");
    expect(ensureConversationMock).toHaveBeenCalledTimes(1);
    // The thread carries what the person actually submitted, so an operator
    // opening it sees the lead rather than an empty bubble.
    expect(createMessageMock).toHaveBeenCalledWith(
      expect.anything(), "acct_1",
      expect.objectContaining({
        channel: "form", direction: "inbound",
        body: "Name: Maria\nEmail: maria@example.com",
      }),
      "form", "system",
    );
    expect(incrementUnreadCountMock).toHaveBeenCalledTimes(1);
  });

  it("one notify recipient's failure does not silence the others", async () => {
    // The loop used to await each send bare, so the first provider failure —
    // one bad address, one rejected domain — threw out of the loop and every
    // later recipient heard nothing about the lead at all.
    getPublishedFormByPublicIdMock.mockResolvedValue(
      formRow({ notify_emails: ["first@bis-rgv.com", "second@bis-rgv.com"] }));
    sendMock.mockReset()
      .mockRejectedValueOnce(new Error("provider rejected the recipient"))
      .mockResolvedValueOnce(undefined);

    const token = signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);
    const result = await submitFormAction(
      PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token, locale: "en" }));

    expect(result.status).toBe("success");
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[1]![0]).toMatchObject({ to: "second@bis-rgv.com" });
    // And the one that did fail is still on the record, not swallowed.
    expect(setSubmissionProcessingErrorMock).toHaveBeenCalledWith(
      expect.anything(), "acct_1", "sub_1", expect.stringContaining("first@bis-rgv.com"));
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

describe("submitFormAction — guard-ordering regressions (the two M1c Criticals)", () => {
  // A field with `required: true` is the only way to make `validate` ever
  // produce an error — a `fields: []` form (every other test in this file)
  // can never fail validation, so it cannot exercise either ordering below.
  const REQUIRED_KEY = "name";
  function formWithRequiredField(overrides: Record<string, unknown> = {}) {
    return formRow({
      fields: [{ key: REQUIRED_KEY, kind: "core.first_name", label: "Name", required: true }],
      ...overrides,
    });
  }

  it("validation runs before the honeypot guard: a honeypot-filled submission with a blank required field is just as invalid as one without the honeypot", async () => {
    // If a spam guard ran first, filling the honeypot alongside a blank
    // required field would return `success` while the same request with the
    // honeypot empty returns `invalid` — a single-request-pair oracle a bot
    // can use to identify the honeypot field by watching the response flip.
    // Neither request below carries a render token: validate() must reject
    // both before any guard that would care about one is ever reached.
    getPublishedFormByPublicIdMock.mockResolvedValue(formWithRequiredField());

    const withHoneypot = await submitFormAction(
      PUBLIC_ID, IDLE, fd({ [HONEYPOT_FIELD]: "gotcha", locale: "en" }));
    const withoutHoneypot = await submitFormAction(PUBLIC_ID, IDLE, fd({ locale: "en" }));

    expect(withHoneypot.status).toBe("invalid");
    expect(withoutHoneypot.status).toBe("invalid");
    if (withHoneypot.status === "invalid" && withoutHoneypot.status === "invalid") {
      expect(withHoneypot.fieldErrors).toEqual(withoutHoneypot.fieldErrors);
      expect(withHoneypot.fieldErrors[REQUIRED_KEY]).toBeTruthy();
    }
    // The response flip is exactly what must not happen — and separately,
    // nothing was written for either request.
    expect(createSubmissionMock).not.toHaveBeenCalled();
    expect(recordRejectedSubmissionMock).not.toHaveBeenCalled();
  });

  it("the rate limit runs before the honeypot guard: once over the limit, a honeypot-filled submission is recorded rate_limited, not honeypot", async () => {
    // If honeypot ran first, a well-formed request with the honeypot filled
    // would write a `honeypot` row on every single request forever, with
    // nothing capping it — exactly the unbounded growth the rate-limit
    // marker exists to prevent, just reached on the branch a real bot hits
    // most often.
    getPublishedFormByPublicIdMock.mockResolvedValue(formWithRequiredField());
    countRecentSubmissionsMock.mockResolvedValue(RATE_LIMIT_MAX);

    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({
      [REQUIRED_KEY]: "Maria", [HONEYPOT_FIELD]: "gotcha", locale: "en",
    }));

    expect(result.status).toBe("success"); // same body every blocked path gets
    expect(recordRejectedSubmissionMock).toHaveBeenCalledWith(
      expect.anything(), "acct_1", "form_row_1",
      expect.objectContaining({ spamReason: "rate_limited" }),
    );
    expect(recordRejectedSubmissionMock).not.toHaveBeenCalledWith(
      expect.anything(), "acct_1", "form_row_1",
      expect.objectContaining({ spamReason: "honeypot" }),
    );
    expect(createSubmissionMock).not.toHaveBeenCalled();
  });
});
