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
  found: boolean; spf: string | null; dmarc: string | null; dmarcDomain: string | null;
  dkim: { result: string; domain: string | null }[]; spam: string | null; virus: string | null;
};

const first = (h: HeaderList, name: string) => h.find(([n]) => n === name)?.[1] ?? null;

/**
 * CRITICAL 2 (review, round 1 and round 2): split the header's
 * `;`-separated segments WITHOUT breaking inside a `"…"` quoted string or a
 * `(…)` comment — RFC 8601's own grammar for this header. A sender controls
 * `envelope-from=` and `helo=`, and an unquoted-split would let a quoted
 * value's embedded `;` manufacture a fake extra segment
 * (`envelope-from="a;dmarc=pass"@evil.com`) ahead of the real `dmarc=`
 * result. Round 2: a backslash escapes the NEXT character, both inside a
 * quoted string and inside a comment (the same grammar) — without tracking
 * that, a sender's escaped `"` or `)` fools the naive toggle into closing
 * the quote/comment early, letting a forged segment slip out as if it were
 * a real, unquoted one. And if the scan ends STILL inside a quote or a
 * comment, the header never closed what it opened — fail closed entirely
 * (`unterminated: true`) rather than trust whatever was parsed so far.
 */
function tokenizeAuthResults(s: string): { segments: string[]; unterminated: boolean } {
  const parts: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let escaped = false;
  let cur = "";
  for (const c of s) {
    if (escaped) { cur += c; escaped = false; continue; }
    if (c === "\\" && (inQuotes || depth > 0)) { escaped = true; cur += c; continue; }
    if (c === '"') { inQuotes = !inQuotes; cur += c; continue; }
    if (!inQuotes && c === "(") { depth++; cur += c; continue; }
    if (!inQuotes && c === ")") { depth = Math.max(0, depth - 1); cur += c; continue; }
    if (!inQuotes && depth === 0 && c === ";") { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  parts.push(cur);
  return { segments: parts, unterminated: inQuotes || depth > 0 };
}

export function readSesVerdict(headers: HeaderList): SesVerdict {
  const spam = first(headers, "x-ses-spam-verdict")?.trim() ?? null;
  const virus = first(headers, "x-ses-virus-verdict")?.trim() ?? null;
  const ar = headers.find(([n, v]) => n === "authentication-results" && v.split(";")[0]!.trim().toLowerCase() === "amazonses.com")?.[1];
  if (!ar) return { found: false, spf: null, dmarc: null, dmarcDomain: null, dkim: [], spam, virus };
  const { segments, unterminated } = tokenizeAuthResults(ar);
  // CRITICAL (review, round 2): an Authentication-Results header that never
  // closed a quote or a comment it opened is malformed on its face — fail
  // closed rather than trust the segments a half-open scan produced.
  if (unterminated) return { found: false, spf: null, dmarc: null, dmarcDomain: null, dkim: [], spam, virus };
  let spf: string | null = null;
  let spfSeen = 0;
  let dmarc: string | null = null;
  let dmarcDomain: string | null = null;
  let dmarcSeen = 0;
  const dkim: { result: string; domain: string | null }[] = [];
  for (const part of segments.slice(1)) {
    const m = /^\s*(spf|dkim|dmarc)=([a-z]+)/i.exec(part);
    if (!m) continue;
    const method = m[1]!.toLowerCase();
    const result = m[2]!.toLowerCase();
    if (method === "spf") {
      spfSeen++;
      if (spf === null) spf = result;
    } else if (method === "dmarc") {
      dmarcSeen++;
      if (dmarc === null) dmarc = result;
      if (dmarcDomain === null) {
        const from = /header\.from=([^\s;]+)/i.exec(part)?.[1];
        if (from) dmarcDomain = from.toLowerCase();
      }
    } else if (method === "dkim") {
      const i = /header\.i=@?([^\s;]+)/i.exec(part)?.[1];
      const d = /header\.d=([^\s;]+)/i.exec(part)?.[1];
      const rawVal = (i ?? d ?? "").toLowerCase();
      dkim.push({ result, domain: rawVal ? (rawVal.includes("@") ? rawVal.slice(rawVal.lastIndexOf("@") + 1) : rawVal) : null });
    }
  }
  // CRITICAL 2: a repeated spf= or dmarc= inside ONE Authentication-Results
  // header is itself the attack (a sender-stamped decoy ahead of the real
  // result) — fail closed by nulling the field rather than trusting either
  // occurrence. Multiple dkim= entries are normal (multiple signers) and
  // stay an array.
  if (spfSeen > 1) spf = null;
  if (dmarcSeen > 1) { dmarc = null; dmarcDomain = null; }
  return { found: true, spf, dmarc, dmarcDomain, dkim, spam, virus };
}

export function senderAuthenticated(v: SesVerdict, fromDomain: string | null): boolean {
  if (!v.found || !fromDomain) return false;
  if (v.spam !== "PASS" || v.virus !== "PASS") return false;
  // CRITICAL 1 (review, round 1): dmarc=pass alone names no domain — bind
  // it to the From domain exactly, the same exact match G15 requires of
  // DKIM's header.i/header.d, or a dmarc=pass stamped for a different
  // domain authenticates an unrelated From.
  if (v.dmarc === "pass" && v.dmarcDomain === fromDomain.toLowerCase()) return true;
  if (v.dmarc !== "none") return false;
  return v.spf === "pass" && v.dkim.some((k) => k.result === "pass" && k.domain === fromDomain.toLowerCase());
}

export function authRecord(v: SesVerdict) {
  return { spf: v.spf, dkim: v.dkim.length ? v.dkim.map((k) => k.result).join(",") : null, dmarc: v.dmarc, spam: v.spam, virus: v.virus };
}
