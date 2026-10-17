import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchFromResend = vi.hoisted(() => vi.fn());
vi.mock("./resend", () => ({ fetchReceivedEmailFromResend: fetchFromResend }));
import { receivedEmailFetcher } from "./receiving";

beforeEach(() => fetchFromResend.mockReset());

describe("receivedEmailFetcher", () => {
  it("binds the API key and passes the id through (mutation: read another env name → throws, FAILS)", async () => {
    fetchFromResend.mockResolvedValue({ id: "re_1" });
    const f = receivedEmailFetcher({ RESEND_API_KEY: "re_key" } as unknown as NodeJS.ProcessEnv);
    expect(await f("re_1")).toEqual({ id: "re_1" });
    expect(fetchFromResend).toHaveBeenCalledWith("re_key", "re_1");
  });

  it("throws with no key, so the route answers 503 (mutation: return a fake → FAILS)", () => {
    expect(() => receivedEmailFetcher({} as NodeJS.ProcessEnv)).toThrow(/RESEND_API_KEY/);
  });
});
