import { promises as dns } from "node:dns";
import { BIS_REPLY_DOMAIN } from "./address";

/** S-06 part 1, "Check DNS": an MX on the client's reply domain that points at Resend's inbound host (ASSUMPTION A3). */
export type MxResolver = (domain: string) => Promise<{ exchange: string; priority: number }[]>;
export const RESEND_INBOUND_MX = /^inbound-smtp\.[a-z0-9-]+\.amazonaws\.com\.?$/i;
const HOST = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function cleanInboundDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase();
  return d.length <= 253 && HOST.test(d) && d !== BIS_REPLY_DOMAIN ? d : null;
}

export async function inboundMxReady(domain: string, resolve: MxResolver = (d) => dns.resolveMx(d)): Promise<"ready" | "missing" | "lookup_failed"> {
  try {
    const records = await resolve(domain);
    return records.some((r) => RESEND_INBOUND_MX.test(r.exchange)) ? "ready" : "missing";
  } catch (e) {
    const code = (e as { code?: string }).code;
    return code === "ENOTFOUND" || code === "ENODATA" ? "missing" : "lookup_failed";
  }
}
