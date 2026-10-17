import { fetchReceivedEmailFromResend } from "./resend";

/**
 * The received-email seam (S-06 part 1). The one module besides the gate that reaches resend.ts
 * (scans.test.ts lists it in PROVIDER_MODULES); the webhook takes the fetcher it builds, and every
 * test injects its own.
 */
export type ReceivedEmail = {
  id: string; from: string; to: string[]; receivedFor: string[]; subject: string | null;
  text: string | null; html: string | null; rawHeaders: string | null; attachmentCount: number; receivedAt: string;
};
export type ReceivedEmailFetcher = (emailId: string) => Promise<ReceivedEmail>;

export function receivedEmailFetcher(env: NodeJS.ProcessEnv = process.env): ReceivedEmailFetcher {
  const key = env.RESEND_API_KEY ?? "";
  if (!key) throw new Error("RESEND_API_KEY is not set: received email cannot be fetched");
  return (id) => fetchReceivedEmailFromResend(key, id);
}
