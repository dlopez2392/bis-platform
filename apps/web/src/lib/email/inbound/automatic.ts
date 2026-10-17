import type { HeaderList } from "./auth-results";

/**
 * S-06 part 2, spec "Pipeline order" 1: automatic mail (out-of-office, auto-responders, bounces) is
 * dropped before anything is stored. Reads only the TOP-LEVEL header block (parseHeaderBlock stops at
 * the first blank line), never the body. G9: the mailer-daemon / postmaster rule reads the From the
 * API gives, so it applies even when the raw block is missing; every header rule needs the block.
 * G10 (ruled 2026-10-17): `Auto-Submitted: auto-forwarded` as the ONLY marker is "auto_forwarded"; the
 * pipeline files it for a team sender (a teammate's forwarding rule) and drops it for anyone else.
 */
export type AutomaticClass = "none" | "automatic" | "auto_forwarded";

const AUTO_REPLY_HEADERS = new Set(["x-autoreply", "x-autorespond", "x-autoresponse"]);
const PRECEDENCE = new Set(["auto_reply", "bulk", "junk"]);
const DAEMONS = new Set(["mailer-daemon", "postmaster"]);

function isDeliveryReport(contentType: string): boolean {
  const parts = contentType.toLowerCase().split(";").map((p) => p.trim());
  if (parts[0] !== "multipart/report") return false;
  return parts.slice(1).some((p) => p.replace(/\s+/g, "").replace(/"/g, "") === "report-type=delivery-status");
}

export function classifyAutomatic(headers: HeaderList | null, fromAddress: string | null): AutomaticClass {
  const at = fromAddress ? fromAddress.lastIndexOf("@") : -1;
  if (fromAddress && at > 0 && DAEMONS.has(fromAddress.slice(0, at).toLowerCase())) return "automatic";
  if (!headers) return "none";
  let autoForwarded = false;
  for (const [name, value] of headers) {
    if (name === "auto-submitted") {
      const v = value.toLowerCase().split(/[;(]/)[0]!.trim();
      if (v === "auto-forwarded") autoForwarded = true;
      else if (v !== "no") return "automatic";
    } else if (AUTO_REPLY_HEADERS.has(name)) {
      return "automatic";
    } else if (name === "precedence" && PRECEDENCE.has(value.trim().toLowerCase())) {
      return "automatic";
    } else if (name === "content-type" && isDeliveryReport(value)) {
      return "automatic";
    }
  }
  return autoForwarded ? "auto_forwarded" : "none";
}
