// S-47b (spec section 7): the corpus runner's PURE half. It parses a corpus item and a fixture and builds
// the EXACT prompt input and tool list each live surface builds for that item's medium, so a transcript
// shows what Sofía would really do. No network, no database, no environment: scripts/sofia-corpus.ts does
// the IO. Relative imports only, so tsx runs the script with no alias resolution (A10).
import { toolSchemas } from "../tools/schemas";
import { bookingMode } from "../booking-mode";
import type { VoicePromptInput } from "../session-config";
import { CAPTURE_LEAD_TOOL, parseCaptureLead } from "../../concierge/prompt";
import { isValidEmail, isValidPhone } from "../../forms/guards";
import { formatWhen } from "../../booking/time";
import type { TradeModuleId } from "./index";

export type PhoneEngine = "realtime" | "chat";
/** "realtime": Task 0's spike ran on 2026-10-22 (GitHub run 39814905846) and gpt-realtime accepts a
 *  text-only session through `output_modalities`, so phone items play on the phone's own model. "chat"
 *  stays as the --phone-engine fallback (spec section 7). */
export const DEFAULT_PHONE_ENGINE: PhoneEngine = "realtime";
/** Spec section 7's fallback for phone items when the Realtime model will not run text-only. */
export const PHONE_FALLBACK_MODEL = "gpt-4o";

export const CORPUS_SLUGS = { insurance_pc: "insurance-pc", events: "events" } as const satisfies Record<TradeModuleId, string>;
export function moduleForSlug(slug: string): TradeModuleId | null {
  const hit = (Object.entries(CORPUS_SLUGS) as Array<[TradeModuleId, string]>).find(([, s]) => s === slug);
  return hit ? hit[0] : null;
}

export type CorpusItem = {
  file: string; id: string; lang: "en" | "es"; medium: "phone" | "web";
  transfer: boolean; booking: boolean; disclosure: boolean;
  /** "withheld" plays a phone call with no caller ID (callerNumber null). Phone only. */
  callerId: "shown" | "withheld";
  /** Overrides the fixture's after-hours mode; null = the fixture's. "message_only" turns new booking off. */
  afterHours: CorpusFixture["afterHours"] | null;
  facts: string;
  caller: string[]; must: string[]; mustNot: string[];
};
export type CorpusFixture = {
  businessName: string; personaName: string; languages: "en" | "es" | "both"; timezone: string;
  facts: string; services: string; meetingType: "in_person" | "phone" | "video";
  slotDurationMinutes: number; afterHours: "hours_then_message" | "message_only"; callerNumber: string;
  greetingEn: string; greetingEs: string;
};

const FILE_RE = /^(\d{2})-(en|es)-[a-z0-9-]+\.md$/;
const KEYS = new Set(["lang", "medium", "transfer", "booking", "disclosure", "callerId", "afterHours", "facts"]);

function bool(file: string, key: string, raw: string | undefined, dflt: boolean | null): boolean {
  if (raw === undefined) {
    if (dflt === null) throw new Error(`${file}: front matter is missing "${key}"`);
    return dflt;
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${file}: "${key}" must be true or false, not "${raw}"`);
}

export function parseCorpusItem(file: string, text: string): CorpusItem {
  const name = FILE_RE.exec(file);
  if (!name) throw new Error(`${file}: file name must be NN-<en|es>-<slug>.md`);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") throw new Error(`${file}: must start with a --- front matter line`);
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error(`${file}: front matter is not closed with ---`);
  const fm: Record<string, string> = {};
  for (const l of lines.slice(1, end)) {
    const m = /^([a-zA-Z]+):\s*(.*)$/.exec(l);
    if (!m) throw new Error(`${file}: bad front matter line "${l}"`);
    if (!KEYS.has(m[1]!)) throw new Error(`${file}: unknown front matter key "${m[1]}"`);
    fm[m[1]!] = m[2]!.trim();
  }
  const lang = fm.lang;
  if (lang !== "en" && lang !== "es") throw new Error(`${file}: "lang" must be en or es`);
  if (lang !== name[2]) throw new Error(`${file}: front matter lang "${lang}" disagrees with the file name`);
  const medium = fm.medium;
  if (medium !== "phone" && medium !== "web") throw new Error(`${file}: "medium" must be phone or web`);
  if (!fm.facts) throw new Error(`${file}: front matter is missing "facts"`);
  const transfer = bool(file, "transfer", fm.transfer, null);
  const booking = bool(file, "booking", fm.booking, false);
  // M15: an item may play an account whose AI disclosure is On (S-47a): the opening sentence and the
  // disclosed IDENTITY line, exactly as the live routes send them.
  const disclosure = bool(file, "disclosure", fm.disclosure, false);
  // Final-fix item 10: two optional overrides of the fixture, each refusing any value but its own.
  const callerId = fm.callerId ?? "shown";
  if (callerId !== "shown" && callerId !== "withheld") throw new Error(`${file}: "callerId" must be shown or withheld, not "${callerId}"`);
  const afterHours = fm.afterHours ?? null;
  if (afterHours !== null && afterHours !== "hours_then_message" && afterHours !== "message_only") {
    throw new Error(`${file}: "afterHours" must be hours_then_message or message_only, not "${afterHours}"`);
  }
  if (medium === "web" && callerId === "withheld") throw new Error(`${file}: a web item cannot have callerId: withheld (the chat has no caller ID)`);
  if (medium === "web" && transfer) throw new Error(`${file}: a web item cannot have transfer: true (the chat has none)`);
  if (medium === "web" && booking) throw new Error(`${file}: a web item cannot have booking: true (the chat has none)`);

  const sections: Record<"caller" | "must" | "must not", string[]> = { caller: [], must: [], "must not": [] };
  let current: keyof typeof sections | null = null;
  for (const l of lines.slice(end + 1)) {
    if (l.trim() === "") continue;
    if (l === "caller:" || l === "must:" || l === "must not:") { current = l.slice(0, -1) as keyof typeof sections; continue; }
    const bullet = /^- (.+)$/.exec(l);
    if (!bullet || current === null) throw new Error(`${file}: line outside a "- " bullet in a section: "${l}"`);
    sections[current].push(bullet[1]!.trim());
  }
  if (sections.caller.length === 0) throw new Error(`${file}: needs at least one caller line`);
  if (sections.must.length === 0) throw new Error(`${file}: needs at least one must rule`);
  if (sections["must not"].length === 0) throw new Error(`${file}: needs at least one must not rule`);
  return {
    file, id: name[1]!, lang, medium, transfer, booking, disclosure, callerId, afterHours, facts: fm.facts,
    caller: sections.caller, must: sections.must, mustNot: sections["must not"],
  };
}

export function parseFixture(name: string, json: string): CorpusFixture {
  const f = JSON.parse(json) as Partial<CorpusFixture>;
  const need: Array<keyof CorpusFixture> = ["businessName", "personaName", "languages", "timezone", "facts", "services",
    "meetingType", "slotDurationMinutes", "afterHours", "callerNumber", "greetingEn", "greetingEs"];
  for (const k of need) if (f[k] === undefined) throw new Error(`fixture ${name}: missing "${k}"`);
  return f as CorpusFixture;
}

/** The live input for this item's medium: the incoming call route's (`promptInput` in
 *  api/voice/incoming/route.ts) or the concierge turn route's (its `buildSystemPrompt({...})` call in
 *  api/concierge/[publicId]/turn/route.ts), with this item's flags and the module under test. */
export function promptInputFor(item: CorpusItem, f: CorpusFixture, module: TradeModuleId): VoicePromptInput {
  if (item.medium === "web") {
    return {
      personaName: f.personaName, businessName: f.businessName, facts: f.facts, services: f.services,
      languages: f.languages, bookingEnabled: false, timezone: f.timezone, slotDurationMinutes: 30,
      afterHours: item.afterHours ?? f.afterHours, callerNumber: null, meetingType: "in_person", medium: "web",
      disclosed: item.disclosure, tradeModule: module,
    };
  }
  return {
    personaName: f.personaName, businessName: f.businessName, facts: f.facts, services: f.services,
    languages: f.languages, bookingEnabled: item.booking, timezone: f.timezone,
    slotDurationMinutes: f.slotDurationMinutes, afterHours: item.afterHours ?? f.afterHours,
    callerNumber: item.callerId === "withheld" ? null : f.callerNumber,
    meetingType: f.meetingType, handoffAvailable: item.transfer, disclosed: item.disclosure, tradeModule: module,
  };
}

export type CorpusTool = { name: string; schema: unknown };
/** The session's real tools: toolSchemas for the phone (buildRealtimeSessionConfig), CAPTURE_LEAD_TOOL for the chat. */
export function toolsFor(item: CorpusItem, input: VoicePromptInput): CorpusTool[] {
  if (item.medium === "web") return [{ name: "capture_lead", schema: CAPTURE_LEAD_TOOL }];
  return toolSchemas(bookingMode(input), input.meetingType, input.handoffAvailable === true)
    .map((t) => ({ name: t.name, schema: t }));
}

/** The flat Realtime tool shape as a chat-completions tool (for the phone fallback engine). */
export function realtimeToolAsChat(schema: unknown): unknown {
  const t = schema as { name: string; description: string; parameters: unknown };
  return { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } };
}

/** Word for word from captureResult("needs_contact"), api/concierge/[publicId]/turn/route.ts (a test reads
 *  the route's source and fails when the two drift). */
const NEEDS_CONTACT = "Not recorded yet: the team needs an email address or a phone number to reach them. Ask the visitor for one, then call capture_lead again with it. If they would rather not give one, nothing is recorded; do not say the team will follow up.";
/** Word for word from captureResult("unusable"), the same route: no fullName, nothing filed (a test reads it). */
const UNUSABLE = "Not recorded: their name is missing. Ask for it.";
/** registry.ts's own DAY_RE. */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type StubContext = { medium: CorpusItem["medium"]; timezone: string };

/** Every tool answers ok and is logged (spec section 7), except the live refusals a corpus item can trigger,
 *  each word for word from the live code:
 *  - web capture_lead with no name: the chat route files nothing (parseCaptureLead returns null; "unusable");
 *  - web capture_lead with a name but no valid email and no valid phone: the chat route HOLDS it
 *    (leadHasContact, lib/concierge/lead.ts, mirrored with the same two validators; a test checks parity);
 *  - phone take_message with an empty body: registry.ts's "message body required";
 *  - check_availability with a date that is not YYYY-MM-DD: registry.ts's refusal (never a thrown Invalid Date).
 *  check_availability answers exactly as the live tool does, `{ slots }` with no `ok` (registry.ts, M5),
 *  offering two times on the asked date, each `local` rendered by the live formatWhen in the fixture's zone. */
export function stubToolResult(name: string, args: Record<string, unknown>, ctx: StubContext): Record<string, unknown> {
  if (name === "check_availability") {
    const date = String(args.date ?? "");
    if (!DAY_RE.test(date)) return { ok: false, error: "date must be YYYY-MM-DD" };
    return { slots: [`${date}T16:00:00.000Z`, `${date}T20:00:00.000Z`].map((startsAt) => ({
      startsAt, local: formatWhen(new Date(startsAt), ctx.timezone),
    })) };
  }
  if (name === "capture_lead" && ctx.medium === "web") {
    const lead = parseCaptureLead(JSON.stringify(args));
    if (!lead) return { ok: false, error: UNUSABLE };
    if (!(isValidEmail(lead.email) || isValidPhone(lead.phone))) return { ok: false, error: NEEDS_CONTACT };
  }
  if (name === "take_message" && ctx.medium === "phone" && !String(args.body ?? "").trim()) {
    return { ok: false, error: "message body required" };
  }
  return { ok: true };
}

/** m1: where a Realtime `error` event goes. A pending response or session.update is failed by it. One that
 *  arrives while neither is pending is a STRAY: recorded in the transcript, and it fails the item. */
export function routeRealtimeError(pending: { response: boolean; session: boolean }): "response" | "session" | "stray" {
  if (pending.response) return "response";
  if (pending.session) return "session";
  return "stray";
}

export function strayErrorTurn(code: string): TranscriptTurn {
  return { role: "tool", text: `realtime error while no response was pending: ${code}. This item FAILED.` };
}

/** An item that failed with a transcript worth keeping: the script writes these turns, then counts it failed. */
export class CorpusItemFailed extends Error {
  constructor(message: string, readonly turns: TranscriptTurn[]) {
    super(message);
    this.name = "CorpusItemFailed";
  }
}

/** M3: anything the runner prints passes through here, so an OpenAI key echoed in an error never reaches a
 *  terminal or a transcript. */
export function redact(text: string): string {
  return text.replace(/sk-[\w*-]+/g, "sk-[redacted]");
}

/** The items a run plays: every `.md` in file order, or the one `--only NN` names. An `--only` that names no
 *  item is an ERROR, never a green run of zero items (the workflow's log would read "0 of 0 played", ok). */
export function selectCorpusFiles(files: string[], only: string | null, slug: string): { files: string[]; error: string | null } {
  const picked = files.filter((f) => f.endsWith(".md")).sort().filter((f) => only === null || f.startsWith(`${only}-`));
  return { files: picked, error: only !== null && picked.length === 0 ? `--only ${only} selects no item in ${slug}` : null };
}

/** Why an item failed when the Realtime message handler itself threw (a stub's RangeError, an unparseable
 *  frame): the error's CLASS only. Its message can carry transcript text or a raw frame, and the runner's FAIL
 *  line goes to a public workflow log. */
export function handlerFailureReason(err: unknown): string {
  const name = err instanceof Error && /^\w{1,40}$/.test(err.name) ? err.name : "unknown";
  return `local error while handling a Realtime event: ${name}`;
}

export type TranscriptTurn = { role: "caller" | "sofia" | "tool"; text: string };
export type RunMeta = {
  moduleId: TradeModuleId; slug: string; version: number; sha256: string; date: string;
  phoneEngine: PhoneEngine; phoneModel: string; chatModel: string;
};

function header(meta: RunMeta): string[] {
  return [
    `Module: ${meta.moduleId} v${meta.version}`,
    `Text SHA-256: ${meta.sha256}`,
    `Date: ${meta.date}`,
    `Phone: ${meta.phoneEngine === "realtime" ? `${meta.phoneModel}, Realtime, text-only` : `${meta.phoneModel}, chat completions (Realtime text-only unavailable; spec section 7)`}`,
    `Web chat: ${meta.chatModel}, chat completions`,
  ];
}

export function renderTranscript(item: CorpusItem, meta: RunMeta, turns: TranscriptTurn[]): string {
  return [
    `# ${item.file}`, "", ...header(meta),
    `Item: ${item.medium}, ${item.lang}, transfer ${item.transfer}, booking ${item.booking}, facts ${item.facts}` +
      `${item.callerId === "withheld" ? ", caller ID withheld" : ""}${item.afterHours ? `, after hours ${item.afterHours}` : ""}`, "",
    "## Conversation", "",
    ...turns.map((t) => (t.role === "tool" ? `- tool: \`${t.text}\`` : `- **${t.role === "caller" ? "Caller" : "Sofía"}:** ${t.text}`)),
    "", "## Rules to grade", "",
    ...item.must.map((r) => `- [ ] MUST: ${r}`),
    ...item.mustNot.map((r) => `- [ ] MUST NOT: ${r}`), "",
  ].join("\n");
}

export function resultsSheetSkeleton(meta: RunMeta, items: CorpusItem[]): string {
  return [
    `# Sofía corpus results — ${meta.slug} v${meta.version}`, "", ...header(meta),
    "Graded by: ", "",
    "Gate (spec section 7): 100% of MUST NOT rules pass; at least 90% of MUST rules pass, each miss explained.",
    "One MUST NOT failure: fix the wording, bump VERSION, append the hash, re-run the whole module.", "",
    "| Item | Kind | Rule | Pass/Fail | Note |", "|---|---|---|---|---|",
    ...items.flatMap((i) => [
      ...i.must.map((r) => `| ${i.file} | MUST | ${r} |  |  |`),
      ...i.mustNot.map((r) => `| ${i.file} | MUST NOT | ${r} |  |  |`),
    ]),
    "", "MUST: _ of _ pass. MUST NOT: _ of _ pass. Gate: PASS / FAIL.", "",
  ].join("\n");
}
