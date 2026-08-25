// sip_headers is an ARRAY of {name, value} (openai SDK RealtimeCallIncomingWebhookEvent.Data).
// Values carry caller PII — sipHeaderNames exists so logs can prove shape without leaking.
const NUMBER_RE = /(?:tel:|sip:)\+?([0-9]{7,15})/i;

type Header = { name?: unknown; value?: unknown };

function headers(eventData: unknown): Header[] {
  if (!eventData || typeof eventData !== "object") return [];
  const h = (eventData as { sip_headers?: unknown }).sip_headers;
  return Array.isArray(h) ? (h as Header[]) : [];
}

function numberFromHeader(list: Header[], name: string): string | null {
  const hit = list.find((h) => h && typeof h === "object" && String(h.name).toLowerCase() === name);
  if (!hit || typeof hit.value !== "string") return null;
  // X-BIS-Called carries a bare E.164 we wrote ourselves; SIP URIs need the regex.
  if (name === "x-bis-called") {
    const direct = hit.value.match(/^\+[0-9]{8,15}$/) ? hit.value : null;
    if (direct) return direct;
  }
  const match = hit.value.match(NUMBER_RE);
  if (!match) return null;
  const digits = match[1]!;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function extractCallerNumber(eventData: unknown): string | null {
  return numberFromHeader(headers(eventData), "from");
}

/** The tenant router's input. Order matters: x-bis-called is written by OUR
 *  TeXML route and is authoritative; To/Diversion are carrier-dependent
 *  fallbacks (the To of the leg reaching OpenAI is usually the OpenAI SIP
 *  URI itself, which contains no phone number and correctly yields null). */
export function extractCalledNumber(eventData: unknown): string | null {
  const list = headers(eventData);
  return numberFromHeader(list, "x-bis-called")
    ?? numberFromHeader(list, "to")
    ?? numberFromHeader(list, "diversion");
}

export function sipHeaderNames(eventData: unknown): string[] {
  return headers(eventData)
    .filter((h) => h && typeof h === "object")
    .map((h) => String(h.name));
}
