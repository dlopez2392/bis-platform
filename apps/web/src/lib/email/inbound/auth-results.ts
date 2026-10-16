/**
 * S-06 part 1, "Rule from the spike": read ONLY the topmost Authentication-Results header whose
 * authserv-id is amazonses.com (Resend's receiving MTA stamps it; a sender can write its own lower in
 * the message, and that one is ignored). X-SES-Spam-Verdict / X-SES-Virus-Verdict: the topmost of
 * each. Pure; the raw header block comes from the received message (plan G5, A1, A2).
 */
export type HeaderList = readonly (readonly [name: string, value: string])[];

export function parseHeaderBlock(raw: string): HeaderList {
  const lines = raw.split(/\r\n|\n/);
  const out: [string, string][] = [];
  for (const line of lines) {
    if (line === "") break;
    if (/^[ \t]/.test(line) && out.length > 0) {
      out[out.length - 1]![1] += ` ${line.trim()}`;
      continue;
    }
    const i = line.indexOf(":");
    if (i <= 0) continue;
    out.push([line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()]);
  }
  return out;
}

export type SesVerdict = {
  found: boolean; spf: string | null; dmarc: string | null;
  dkim: { result: string; domain: string | null }[]; spam: string | null; virus: string | null;
};

const first = (h: HeaderList, name: string) => h.find(([n]) => n === name)?.[1] ?? null;

export function readSesVerdict(headers: HeaderList): SesVerdict {
  const spam = first(headers, "x-ses-spam-verdict")?.trim() ?? null;
  const virus = first(headers, "x-ses-virus-verdict")?.trim() ?? null;
  const ar = headers.find(([n, v]) => n === "authentication-results" && v.split(";")[0]!.trim().toLowerCase() === "amazonses.com")?.[1];
  if (!ar) return { found: false, spf: null, dmarc: null, dkim: [], spam, virus };
  let spf: string | null = null;
  let dmarc: string | null = null;
  const dkim: { result: string; domain: string | null }[] = [];
  for (const part of ar.split(";").slice(1)) {
    const m = /^\s*(spf|dkim|dmarc)=([a-z]+)/i.exec(part);
    if (!m) continue;
    const method = m[1]!.toLowerCase();
    const result = m[2]!.toLowerCase();
    if (method === "spf" && spf === null) spf = result;
    else if (method === "dmarc" && dmarc === null) dmarc = result;
    else if (method === "dkim") {
      const i = /header\.i=@?([^\s;]+)/i.exec(part)?.[1];
      const d = /header\.d=([^\s;]+)/i.exec(part)?.[1];
      const rawVal = (i ?? d ?? "").toLowerCase();
      dkim.push({ result, domain: rawVal ? (rawVal.includes("@") ? rawVal.slice(rawVal.lastIndexOf("@") + 1) : rawVal) : null });
    }
  }
  return { found: true, spf, dmarc, dkim, spam, virus };
}

export function senderAuthenticated(v: SesVerdict, fromDomain: string | null): boolean {
  if (!v.found || !fromDomain) return false;
  if (v.spam !== "PASS" || v.virus !== "PASS") return false;
  if (v.dmarc === "pass") return true;
  if (v.dmarc !== "none") return false;
  return v.spf === "pass" && v.dkim.some((k) => k.result === "pass" && k.domain === fromDomain.toLowerCase());
}

export function authRecord(v: SesVerdict) {
  return { spf: v.spf, dkim: v.dkim.length ? v.dkim.map((k) => k.result).join(",") : null, dmarc: v.dmarc, spam: v.spam, virus: v.virus };
}
