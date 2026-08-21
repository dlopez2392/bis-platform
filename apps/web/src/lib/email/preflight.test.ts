import { describe, it, expect, vi } from "vitest";
import { verifyFromAddress, saveVerifiedFromAddress } from "./preflight";
import type { EmailProvider } from "./types";

function providerThat(send: EmailProvider["send"], isFake = false): EmailProvider {
  return { isFake, send };
}

describe("verifyFromAddress", () => {
  it("sends one message from the candidate address to the given recipient", async () => {
    const send = vi.fn().mockResolvedValue({ providerMessageId: "re_1" });
    await verifyFromAddress(providerThat(send), "leads@acme.com", "admin@bis-rgv.com");

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({
      to: "admin@bis-rgv.com",
      fromAddress: "leads@acme.com",
    });
  });

  /**
   * The property this whole gate exists for, asserted as IDENTITY rather than
   * a substring match.
   *
   * Resend rejects an unverified sender with a synchronous 403 whose message
   * names the domain and states the remedy — "The acme.com domain is not
   * verified. Please, add and verify your domain." That wording is the only
   * thing telling an operator what went wrong, so it must arrive untouched.
   *
   * A `toThrow(/regex/)` assertion cannot express that: it passes just as
   * happily against an implementation that wraps or re-prefixes the message,
   * which is the exact defect this test is here to catch. `toBe` on the thrown
   * object is what makes wrapping impossible.
   */
  it("rethrows the provider's own error object untouched, so the operator sees Resend's wording", async () => {
    const original = new Error(
      "The acme.com domain is not verified. Please, add and verify your domain.",
    );
    const send = vi.fn().mockRejectedValue(original);

    await expect(
      verifyFromAddress(providerThat(send), "leads@acme.com", "admin@bis-rgv.com"),
    ).rejects.toBe(original);
  });

  /**
   * Outside production getEmailProvider returns the fake, which delivers
   * nothing and therefore proves nothing. It must SAY so rather than resolve
   * quietly — a green save on a laptop is not evidence a domain is verified.
   */
  it("refuses to certify anything when the provider is the fake", async () => {
    const send = vi.fn().mockResolvedValue({ providerMessageId: "fake_x" });
    await expect(
      verifyFromAddress(providerThat(send, true), "leads@acme.com", "admin@bis-rgv.com"),
    ).rejects.toThrow(/cannot be verified outside production/i);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("saveVerifiedFromAddress", () => {
  it("writes only after the address has been proven to send", async () => {
    const send = vi.fn().mockResolvedValue({ providerMessageId: "re_1" });
    const write = vi.fn().mockResolvedValue(undefined);

    await saveVerifiedFromAddress(providerThat(send), "leads@acme.com", "admin@bis-rgv.com", write);

    expect(send).toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith("leads@acme.com");
  });

  /**
   * THE assertion this seam exists for. Storing an address whose domain is not
   * verified breaks every outbound email for that client, and the breakage is
   * invisible until a customer does not reply. Swapping these two lines is a
   * one-character edit that no other test in this repo would notice.
   */
  it("never writes when the address cannot send", async () => {
    const send = vi.fn().mockRejectedValue(new Error("The acme.com domain is not verified."));
    const write = vi.fn().mockResolvedValue(undefined);

    await expect(
      saveVerifiedFromAddress(providerThat(send), "leads@acme.com", "admin@bis-rgv.com", write),
    ).rejects.toThrow(/not verified/);

    expect(write).not.toHaveBeenCalled();
  });
});
