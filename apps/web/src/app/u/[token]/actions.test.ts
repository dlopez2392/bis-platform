import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const unsub = vi.hoisted(() => ({ recordUnsubscribe: vi.fn(), recordResubscribe: vi.fn() }));
vi.mock("@/lib/consent/unsubscribe", async (importOriginal) => ({ ...(await importOriginal<object>()), ...unsub }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), serviceDb: () => ({ tag: "service" }) }));

import { unsubscribeAction, resubscribeAction } from "./actions";
import { sealConsentToken } from "@/lib/consent/token";

const SECRET = "page-test-secret-0123456789abcdef-0123";
const P = { v: 1 as const, a: "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f", c: "email" as const, t: "ana@example.com", i: 1_790_000_000_000, n: null };

beforeEach(() => {
  unsub.recordUnsubscribe.mockReset().mockResolvedValue("stopped");
  unsub.recordResubscribe.mockReset().mockResolvedValue("resubscribed");
  vi.stubEnv("CONSENT_TOKEN_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("the page's two server actions", () => {
  it("Unsubscribe records the stop as unsubscribe_link and answers stopped; Resubscribe records the lift and answers resubscribed (spec §4.3; mutation: record one_click from the page → the drawer cannot tell the header from the link, FAILS)", async () => {
    const token = sealConsentToken(P, SECRET);
    expect(await unsubscribeAction(token)).toEqual({ state: "stopped" });
    expect(unsub.recordUnsubscribe).toHaveBeenCalledWith({ tag: "service" }, expect.objectContaining({ a: P.a }), "unsubscribe_link");
    expect(await resubscribeAction(token)).toEqual({ state: "resubscribed" });
    expect(unsub.recordResubscribe).toHaveBeenCalledWith({ tag: "service" }, expect.objectContaining({ a: P.a }));
  });

  it("each re-opens the token itself — a forged one writes nothing and answers bad_link; a failed write answers failed (never trusts the page's state; mutation: skip the re-open → FAILS)", async () => {
    expect(await unsubscribeAction("1.forged.token")).toEqual({ state: "bad_link" });
    expect(await resubscribeAction("1.forged.token")).toEqual({ state: "bad_link" });
    expect(unsub.recordUnsubscribe).not.toHaveBeenCalled();
    unsub.recordUnsubscribe.mockRejectedValueOnce(new Error("down"));
    expect(await unsubscribeAction(sealConsentToken(P, SECRET))).toEqual({ state: "failed" });
  });

  it("a failed resubscribe write answers failed, never resubscribed (mutation: answer 'resubscribed' in the catch → FAILS)", async () => {
    unsub.recordResubscribe.mockRejectedValueOnce(new Error("down"));
    expect(await resubscribeAction(sealConsentToken(P, SECRET))).toEqual({ state: "failed" });
  });
});
