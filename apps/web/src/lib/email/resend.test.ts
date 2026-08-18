import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...a: unknown[]) => sendMock(...a) };
  },
}));

import { resendEmailProvider } from "./resend";

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({ data: { id: "re_1" }, error: null });
});

describe("resendEmailProvider", () => {
  it("passes html through when a template supplied one", async () => {
    const provider = resendEmailProvider("re_test", "crm@bis-rgv.com");
    await provider.send({
      to: "customer@example.com", fromName: "Rio Roofing",
      subject: "Hi", body: "plain", html: "<p>rich</p>",
    });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      text: "plain",
      html: "<p>rich</p>",
    }));
  });

  // Both parts, always. A branded email with no text alternative is a
  // spam-filter magnet, and this is the assertion that stops one shipping.
  it("still sends text when there is no html, and omits html entirely", async () => {
    const provider = resendEmailProvider("re_test", "crm@bis-rgv.com");
    await provider.send({
      to: "customer@example.com", fromName: "Rio Roofing",
      subject: "Hi", body: "plain",
    });

    expect(sendMock.mock.calls[0]![0].text).toBe("plain");
    expect(sendMock.mock.calls[0]![0].html).toBeUndefined();
  });
});
