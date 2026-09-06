import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const dbMocks = vi.hoisted(() => ({ upsertAutomation: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}),
}));
// voice/actions.test.ts's switchable guard: requireAccountAccess resolves for
// any legitimate caller; the ACTION turns isAgency:false into {ok:false}.
const guardFixture = vi.hoisted(() => ({ isAgency: true }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: guardFixture.isAgency }),
}));

import { m } from "@/lib/messages";
import { saveReviewRequestAction } from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const URL = "https://g.page/r/x/review";

beforeEach(() => {
  guardFixture.isAgency = true;
  dbMocks.upsertAutomation.mockReset().mockResolvedValue({});
});

describe("saveReviewRequestAction", () => {
  it("refuses a non-agency caller before touching the database", async () => {
    guardFixture.isAgency = false;
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: URL })))
      .toEqual({ ok: false, error: m["automations.agencyOnly"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saves enabled + channel + link + body through serviceDb, validated with the pass's own parser", async () => {
    expect(await saveReviewRequestAction("acct_1",
      fd({ enabled: "on", channel: "sms", review_url: ` ${URL} `, body: "Thanks!" }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "review_request",
      { enabled: true, body: "Thanks!", config: { channel: "sms", reviewUrl: URL } }, "user_1");
  });

  it("turning it on without a link is refused, with copy that says what to do", async () => {
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: "" })))
      .toEqual({ ok: false, error: m["automations.review.urlRequired"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("a junk link is refused even while the recipe is OFF — a javascript: url must never be stored", async () => {
    // Mutation: validate only when `enabled`.
    for (const bad of ["javascript:alert(1)", "not a url", "ftp://x.example/r"]) {
      expect(await saveReviewRequestAction("acct_1", fd({ channel: "email", review_url: bad })), bad)
        .toEqual({ ok: false, error: m["automations.review.urlInvalid"] });
    }
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saves an OFF row with an empty link, so the operator can fill it in later", async () => {
    expect(await saveReviewRequestAction("acct_1", fd({ channel: "email", review_url: "", body: "" }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "review_request",
      { enabled: false, body: "", config: { channel: "email", reviewUrl: "" } }, "user_1");
  });

  it("an unknown channel and a database failure both come back as a toastable failure", async () => {
    expect(await saveReviewRequestAction("acct_1", fd({ channel: "fax", review_url: URL })))
      .toEqual({ ok: false, error: m["automations.review.saveFailed"] });
    dbMocks.upsertAutomation.mockRejectedValue(new Error("db down"));
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: URL })))
      .toEqual({ ok: false, error: m["automations.review.saveFailed"] });
  });
});
