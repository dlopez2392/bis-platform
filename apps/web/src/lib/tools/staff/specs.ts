// apps/web/src/lib/tools/staff/specs.ts
// The staff catalogue (F-023 plan §3.1): tools for a person who works at the business, never for a customer. Today
// these are the owner line's three reads and its customer lookup (F-032 §5); the owner line sends them as realtimeShape (its tools/schemas.ts)
// and runs them through lib/tools/staff/read.ts. Their words are pinned byte for byte by
// lib/owner-line/tools/owner-tool-schemas.fixture.json.
import type { ToolSpec } from "../belt";

const RANGE = {
  range: { type: "string", enum: ["today", "yesterday", "tomorrow", "this_week", "dates"],
    description: "Which days, in the business's timezone. Use dates with from (and to) for a named day or days." },
  from: { type: "string", description: "YYYY-MM-DD. Only with range dates." },
  to: { type: "string", description: "YYYY-MM-DD, the last day, at most 31 days after from. Only with range dates." },
} as const;

export const STAFF_TOOL_SPECS = [
  { audience: "staff", name: "calls_and_messages",
    description: "The calls Sofía answered in a range, the same calls the dashboard counts as 'Calls answered', newest first. count is exact; spam is how many calls looked like spam, said separately and only when above zero. Each call has when, caller (a name, or 'a new caller'), outcome (what came of it, in words), reason (or null) and needsCallback. more says how many were not listed. Say counts from here; never count yourself.",
    parameters: { type: "object", properties: RANGE, required: ["range"] } },
  { audience: "staff", name: "appointments",
    description: "The appointments in a range, soonest first: count is exact unless truncated is true, which means there were even more than count. Each has when, customer (or null), meetingType (how they meet, in words, or null) and status (in words). Say the count from here.",
    parameters: { type: "object", properties: RANGE, required: ["range"] } },
  { audience: "staff", name: "needs_attention",
    description: "What is on this person's To do right now, in the same words the To do page uses: count is exact, and each item has what, customer (or null) and due (or null).",
    parameters: { type: "object", properties: {}, required: [] } },
  // F-023 PR 5: the owner-line plan's Task 17, word for word. At most 3 matches and five fields
  // (lib/tools/staff/read.ts lookupCustomer); finding no one is one answer whoever asks.
  { audience: "staff", name: "lookup_customer",
    description: "Find up to 3 customers by name or phone: each has name, phone, lastVisit, nextVisit (or null) and openTodos. If count is 0, say exactly: \"I don't see that customer on your list.\" Never say whether a customer exists beyond what this returns.",
    parameters: { type: "object", properties: { term: { type: "string", description: "A name or a phone number, as the person said it." } }, required: ["term"] } },
] as const satisfies readonly ToolSpec<"staff">[];

export type StaffToolName = (typeof STAFF_TOOL_SPECS)[number]["name"];
export const STAFF_TOOL_NAMES: readonly StaffToolName[] = STAFF_TOOL_SPECS.map((s) => s.name);
