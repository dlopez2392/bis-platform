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
const instantReplyMock = vi.fn();
vi.mock("@/lib/automations/instant-reply", () => ({
  sendInstantReply: (...a: unknown[]) => instantReplyMock(...a),
}));

/**
 * The row behind notify()'s account lookup.
 *
 * `from_email` is deliberately POPULATED and distinctive. Nothing in the
 * shipped `.select(...)` asks for it, so a projecting mock filters it out and
 * the alert's `fromAddress` stays undefined — but the moment someone adds the
 * column to the query and forwards it, the absence assertion below sees
 * "leads@acme.com" rather than a value that was never reachable in the first
 * place. See the mock's own note.
 */
const accountRow = {
  name: "Acme", from_email: "leads@acme.com",
  brand_name: "Rio Roofing", brand_logo_path: null,
  brand_color: null, brand_neutral: null, brand_corners: null,
  brand_type: null, brand_mode: null,
};

vi.mock("@bis/db", () => ({
  // Chainable only as far as the one direct query the action makes outside the
  // mocked helpers: notify()'s account lookup, which now carries the branding
  // columns the alert template needs as well as the name.
  serviceDb: () => ({
    from: () => ({
      /**
       * Projects to exactly the columns asked for, and that is load-bearing —
       * the same shape conversations/actions.test.ts uses, and for the same
       * reason. The first version of this mock ignored its argument and
       * returned a fixed row with no `from_email` key at all, so
       * `account?.from_email` was `undefined` under EVERY implementation and
       * the absence assertion at the bottom of this file could not fail. A
       * mock more permissive than PostgREST tests nothing about the query.
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
  brandLogoUrl: (path: string) => `https://cdn.test/${path}`,
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
  instantReplyMock.mockReset().mockResolvedValue({ kind: "skipped", reason: "disabled" });
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
    // Asserting the submission row alone let the thread quietly go missing:
    // this form has no fields at all, so it takes the same all-blank path the
    // test below pins, and for a while it created no conversation whatsoever.
    expect(ensureConversationMock).toHaveBeenCalledTimes(1);
    expect(createMessageMock).toHaveBeenCalledTimes(1);
  });

  it("a submission with every field blank still opens a conversation", async () => {
    // The third body tier, and the one that has already been broken twice: an
    // earlier version wrapped the whole conversation block in `if (threadBody)`
    // while the fallback was still an empty string, so a submission carrying no
    // answers produced a contact and a notification and nothing in
    // Conversations — silently reproducing the exact bug that block was added
    // to fix. Every field here is optional so an all-blank submission is
    // genuinely accepted rather than turned away by validation.
    const fields = [
      { key: "first_name", kind: "core.first_name", label: "Name", required: false },
      { key: "company_name", kind: "core.company_name", label: "Company", required: false },
    ];
    getPublishedFormByPublicIdMock.mockResolvedValue(formRow({ fields }));
    const token = signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);

    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token, locale: "en",
      first_name: "", company_name: "",
    }));

    expect(result.status).toBe("success");
    expect(ensureConversationMock).toHaveBeenCalledTimes(1);
    expect(incrementUnreadCountMock).toHaveBeenCalledTimes(1);
    // `messages.body` is `not null`, so the fallback has to say something real.
    expect(createMessageMock).toHaveBeenCalledWith(
      expect.anything(), "acct_1",
      expect.objectContaining({
        channel: "form", direction: "inbound",
        body: 'New submission on "Test Form".',
      }),
      "form", "system",
    );
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

/**
 * Where a reply to "New lead" goes.
 *
 * The recipient here is the CLIENT, so the reply has to travel the other way —
 * to the customer who just asked for a quote. Until now every one of these
 * replied to crm@bis-rgv.com, which is a mailbox the customer will never hear
 * from and the client does not own.
 */
describe("submitFormAction — the lead notification replies to the customer", () => {
  it("sets reply-to to the address the visitor submitted", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(formRow({
      fields: [{ key: "email", kind: "core.email", label: "Email", required: true }],
      notify_emails: ["owner@rioroofing.com"],
    }));
    const token = signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);

    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token, locale: "en", email: "customer@example.com",
    }));

    expect(result.status).toBe("success");
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner@rioroofing.com",
      replyTo: "customer@example.com",
    }));
  });

  it("omits reply-to when the form asks for no email address", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(formRow({
      fields: [{ key: "phone", kind: "core.phone", label: "Phone", required: true }],
      notify_emails: ["owner@rioroofing.com"],
    }));
    const token = signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);

    await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token, locale: "en", phone: "956-555-0101",
    }));

    expect(sendMock).toHaveBeenCalled();
    // Absent, NOT empty: `replyTo: ""` is a header with no value.
    expect(sendMock.mock.calls[0]![0].replyTo).toBeUndefined();
  });
});

/**
 * The alert a client actually receives.
 *
 * Both assertions below were impossible before: there was no html part, and
 * the link was a bare path that no email client renders as a link.
 */
describe("submitFormAction — phone normalized to E.164 at the boundary (create path)", () => {
  // Voice stores phones as E.164; web previously stored whatever the visitor
  // typed, so the same person became two contacts and `find_my_booking`
  // couldn't see web submissions. A parseable number must reach
  // `createContact` already in E.164 (mutation: drop the `toE164` call →
  // FAILS, sees the raw "956-555-1234").
  it("a parseable US number reaches createContact as E.164", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(formRow({
      fields: [{ key: "phone", kind: "core.phone", label: "Phone", required: false }],
    }));
    const token = signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);

    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token, locale: "en", phone: "956-555-1234",
    }));

    expect(result.status).toBe("success");
    expect(createContactMock.mock.calls[0]![2]).toMatchObject({ phone: "+19565551234" });
  });

  // `isValidPhone` (apps/web/src/lib/forms/guards.ts) accepts a bare 7-digit
  // string ("5551234" clears its digit-count>=7 floor and PHONE_RE), but
  // `toE164` (apps/web/src/lib/voice/phone-number.ts) returns null for
  // anything under 8 digits — so this input genuinely reaches the `?? rawPhone`
  // fallback rather than exercising unreachable code (mutation: mangle the
  // fallback into `?? ""` or reject it outright → FAILS).
  it("a 7-digit number isValidPhone accepts but toE164 cannot parse passes through unchanged, never rejected", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(formRow({
      fields: [{ key: "phone", kind: "core.phone", label: "Phone", required: false }],
    }));
    const token = signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);

    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token, locale: "en", phone: "5551234",
    }));

    expect(result.status).toBe("success");
    expect(createContactMock.mock.calls[0]![2]).toMatchObject({ phone: "5551234" });
  });
});

describe("submitFormAction — the lead alert is branded and linkable", () => {
  it("sends html and text, with an absolute contact link in both", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(formRow({
      fields: [{ key: "email", kind: "core.email", label: "Email", required: true }],
      notify_emails: ["owner@rioroofing.com"],
    }));
    vi.mocked(headers).mockResolvedValue(new Headers({
      "user-agent": "test-agent", host: "crm.example.com", "x-forwarded-proto": "https",
    }) as never);
    const token = signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);

    await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token, locale: "en", email: "customer@example.com",
    }));

    const sent = sendMock.mock.calls[0]![0];
    const url = "https://crm.example.com/dashboard/accounts/acct_1/contacts/contact_1";
    expect(sent.html).toContain(url);
    expect(sent.body).toContain(url);
    // The brand name, never accounts.name — that is the agency's private label.
    expect(sent.fromName).toBe("Rio Roofing");
    expect(sent.body.length).toBeGreaterThan(0);
  });

  it("still sends the lead when there is no host to build a link from", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(formRow({
      fields: [{ key: "email", kind: "core.email", label: "Email", required: true }],
      notify_emails: ["owner@rioroofing.com"],
    }));
    vi.mocked(headers).mockResolvedValue(new Headers({ "user-agent": "test-agent" }) as never);
    const token = signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);

    await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token, locale: "en", email: "customer@example.com",
    }));

    const sent = sendMock.mock.calls[0]![0];
    expect(sent.body).toContain("customer@example.com");
    expect(sent.body).not.toContain("/dashboard/");
  });

  it("sends the lead alert from the platform address, never the client's domain", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(formRow({
      fields: [{ key: "email", kind: "core.email", label: "Email", required: true }],
      notify_emails: ["owner@rioroofing.com"],
    }));
    const token = signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);

    await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token, locale: "en", email: "customer@example.com",
    }));

    // Deliberate, and load-bearing: this message goes to the CLIENT'S OWN
    // STAFF. acme.com -> acme.com through a third-party sender is the shape
    // corporate filters treat as internal spoofing, and nothing downstream
    // retries a lead alert — notified_at records an attempt, not a receipt.
    // See spec §3.
    //
    // This can now actually fail. The @bis/db mock above PROJECTS to the
    // columns the query asks for, and `accountRow.from_email` is populated
    // with "leads@acme.com" on purpose — so adding the column to notify()'s
    // `.select(...)` and forwarding it as `fromAddress` (the shape the sibling
    // conversations action uses, 400 lines away) turns this into a visible
    // value rather than the `undefined` it was under every implementation
    // while the mock ignored its argument.
    expect(sendMock).toHaveBeenCalled();
    expect(sendMock.mock.calls[0]![0].fromAddress).toBeUndefined();
  });
});

describe("submitFormAction — the receipt to the person who wrote in", () => {
  const withEmail = (over: Record<string, unknown> = {}) => formRow({
    fields: [
      { key: "first_name", kind: "core.first_name", label: "Name", required: true },
      { key: "email", kind: "core.email", label: "Email", required: true },
    ],
    notify_emails: [],
    ...over,
  });
  const token = () => signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);

  it("sends one, in the page's language, from the account's own address, when the form collected an email", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(withEmail());

    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token(), locale: "es", first_name: "María", email: "customer@example.com",
    }));

    expect(result.status).toBe("success");
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sent = sendMock.mock.calls[0]![0];
    expect(sent.to).toBe("customer@example.com");
    expect(sent.subject).toBe("Recibimos tu mensaje — Rio Roofing");
    expect(sent.fromName).toBe("Rio Roofing");
    // Customer-facing outbound, the booking confirmation's shape: the
    // account's own sending address, unlike the staff-facing alert.
    expect(sent.fromAddress).toBe("leads@acme.com");
    expect(sent.body).toContain("Hola María:");
    expect(sent.html).toContain("Hola María:");
    // The fixture account has no reply-to address, so the receipt neither
    // sets one nor invites a reply that would land nowhere.
    expect(sent.replyTo).toBeUndefined();
    expect(sent.body).not.toContain("responde a este correo");
  });

  it("goes after the company's alert, never instead of it", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(withEmail({ notify_emails: ["owner@rioroofing.com"] }));

    await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token(), locale: "en", first_name: "Maria", email: "customer@example.com",
    }));

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0]![0]).toMatchObject({ to: "owner@rioroofing.com", subject: "New lead: Test Form" });
    expect(sendMock.mock.calls[1]![0]).toMatchObject({
      to: "customer@example.com", subject: "We received your message — Rio Roofing",
    });
    expect(sendMock.mock.calls[1]![0].body).toContain("Hi Maria,");
  });

  it("is skipped when the form asks for no email address", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(formRow({
      fields: [{ key: "phone", kind: "core.phone", label: "Phone", required: true }],
      notify_emails: [],
    }));

    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: "956-555-0101",
    }));

    expect(result.status).toBe("success");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("a receipt that fails to send never fails the submission and is not recorded on it", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(withEmail());
    sendMock.mockRejectedValue(new Error("provider down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token(), locale: "en", first_name: "Maria", email: "customer@example.com",
    }));

    expect(result.status).toBe("success");
    // `processing_error` is the operator's "nobody was told" signal; a
    // bounced auto-reply is not that.
    expect(setSubmissionProcessingErrorMock).not.toHaveBeenCalled();
    quiet.mockRestore();
  });
});

describe("submitFormAction — the instant reply to the person who wrote in (Milestone C)", () => {
  const withPhone = (over: Record<string, unknown> = {}) => formRow({
    fields: [
      { key: "first_name", kind: "core.first_name", label: "Name", required: false },
      { key: "email", kind: "core.email", label: "Email", required: false },
      { key: "phone", kind: "core.phone", label: "Phone", required: false },
    ],
    notify_emails: [],
    ...over,
  });
  const token = () => signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);
  const PHONE = "956-555-0101";

  it("runs LAST — after the receipt — with the E.164 phone, the page's locale, the contact, the thread and the consent flag", async () => {
    // Mutation: call it before the receipt, or pass the raw phone.
    getPublishedFormByPublicIdMock.mockResolvedValue(withPhone());
    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token(), locale: "es", first_name: "María", email: "customer@example.com", phone: PHONE,
    }));
    expect(result.status).toBe("success");
    expect(instantReplyMock).toHaveBeenCalledTimes(1);
    const arg = instantReplyMock.mock.calls[0]![0];
    expect(arg).toMatchObject({
      accountId: "acct_1", submissionId: "sub_1", contactId: "contact_1", conversationId: "convo_1",
      phoneE164: "+19565550101", locale: "es", consentWithheld: false,
    });
    expect(arg.now).toBeInstanceOf(Date);
    // The receipt is sendMock's only call here (no alert addresses), and the
    // instant reply comes after it.
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(instantReplyMock.mock.invocationCallOrder[0]!).toBeGreaterThan(sendMock.mock.invocationCallOrder[0]!);
  });

  it("passes a null phone when the form asked for none", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(withPhone({ fields: [
      { key: "email", kind: "core.email", label: "Email", required: false },
    ] }));
    await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", email: "a@example.com" }));
    expect(instantReplyMock.mock.calls[0]![0]).toMatchObject({ phoneE164: null, locale: "en" });
  });

  it("reports consentWithheld when an OPTIONAL consent box was left unticked, and false once it is ticked", async () => {
    // Mutation: derive it from `required` instead of `given`.
    getPublishedFormByPublicIdMock.mockResolvedValue(withPhone({ fields: [
      { key: "phone", kind: "core.phone", label: "Phone", required: false },
      { key: "ok_to_text", kind: "consent", label: "You may text me", required: false },
    ] }));
    await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: PHONE }));
    expect(instantReplyMock.mock.calls[0]![0]).toMatchObject({ consentWithheld: true });

    instantReplyMock.mockClear();
    await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: PHONE, ok_to_text: "on" }));
    expect(instantReplyMock.mock.calls[0]![0]).toMatchObject({ consentWithheld: false });
  });

  it("a returning contact still qualifies — the thread hold, not `existing`, is the dedupe", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(withPhone());
    createContactMock.mockResolvedValue({ id: "contact_1", existing: true });
    await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: PHONE }));
    expect(instantReplyMock).toHaveBeenCalledTimes(1);
  });

  it("a THROWING instant reply never fails the submission and never writes processing_error", async () => {
    // Mutation: drop the try/catch around the call.
    getPublishedFormByPublicIdMock.mockResolvedValue(withPhone());
    instantReplyMock.mockRejectedValue(new Error("module exploded"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: PHONE }));
    expect(result.status).toBe("success");
    expect(setSubmissionProcessingErrorMock).not.toHaveBeenCalled();
    quiet.mockRestore();
  });

  it("is never reached by a spam-rejected or duplicate submission", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(withPhone());
    // Honeypot filled.
    await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: PHONE, [HONEYPOT_FIELD]: "bot" }));
    // Too fast: a token minted this instant is inside MIN_FILL_MS.
    await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: signRenderToken(Date.now(), PUBLIC_ID), locale: "en", phone: PHONE }));
    // Rate-limited.
    countRecentSubmissionsMock.mockResolvedValue(RATE_LIMIT_MAX);
    await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: PHONE }));
    // Duplicate.
    countRecentSubmissionsMock.mockResolvedValue(0);
    findRecentDuplicateMock.mockResolvedValue({ id: "sub_0" });
    await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: PHONE }));
    expect(instantReplyMock).not.toHaveBeenCalled();
    expect(createSubmissionMock).not.toHaveBeenCalled();
  });

  it("is skipped when the contact work failed — no thread, nothing to reply into", async () => {
    // Mutation: call it whenever the submission row exists.
    getPublishedFormByPublicIdMock.mockResolvedValue(withPhone());
    createContactMock.mockRejectedValue(new Error("contacts down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: PHONE }));
    expect(result.status).toBe("success");
    expect(instantReplyMock).not.toHaveBeenCalled();
    quiet.mockRestore();
  });
});
