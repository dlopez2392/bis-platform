import type { EmailProvider } from "./types";

/**
 * Proves an address can actually send BEFORE it is stored.
 *
 * Setting a from-address whose domain is not verified breaks every outbound
 * email for that client, and the breakage is invisible until a customer does
 * not reply. Resend rejects an unverified sender synchronously with a 403
 * validation_error, so one real send is a sufficient gate — and it needs no
 * key beyond the sending key already in production, which is the property
 * agency-run provisioning was chosen to keep (spec §2 decision 1, §7).
 *
 * ⚠️ It does NOT prove the domain is authenticated well enough to LAND.
 * Verified and deliverable are different properties: a domain with no DMARC
 * record is accepted by the receiving server and then filed or discarded, and
 * nothing here or in Resend's webhook can see that happen. See spec §9 — this
 * is why no "deliverability" indicator may be built on top of this function.
 */
export async function verifyFromAddress(
  provider: EmailProvider, fromAddress: string, to: string,
): Promise<void> {
  // The fake delivers nothing, so letting it resolve would report a
  // verification that never happened — the exact class of lie this gate
  // exists to prevent. Fail loudly instead of certifying silence.
  if (provider.isFake) {
    throw new Error(
      "A sending address cannot be verified outside production, because email is suppressed there.",
    );
  }

  // Deliberately unguarded: the caller must see the provider's own wording.
  // Resend's message names the domain and tells the operator what to do, and
  // anything this module substituted would be worse.
  await provider.send({
    to,
    fromName: "BIS Platform",
    fromAddress,
    subject: "Sending address check",
    body: `This confirms ${fromAddress} can send from this platform. No action needed.`,
  });
}

/**
 * Verify, then write — in that order, and never the other way round.
 *
 * The ordering is the entire safety property: an address whose domain is not
 * verified must never reach the column, because storing one breaks every
 * outbound email for that client and stays invisible until a customer does not
 * reply. Swapping these two awaits is a trivial edit, which is exactly why it
 * is pinned by a test rather than by a comment in a server action.
 *
 * `write` is a callback rather than a db handle so this stays dependency-free
 * and unit-testable — apps/web has no server-action harness, so a seam that
 * needed one could not be covered at all.
 */
export async function saveVerifiedFromAddress(
  provider: EmailProvider,
  fromAddress: string,
  to: string,
  write: (fromAddress: string) => Promise<void>,
): Promise<void> {
  await verifyFromAddress(provider, fromAddress, to);
  await write(fromAddress);
}
