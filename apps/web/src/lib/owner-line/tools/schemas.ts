// apps/web/src/lib/owner-line/tools/schemas.ts
// Flat GA Realtime tool format (lib/voice/tools/schemas.ts:1-3). The owner line's tools are a SEPARATE list: the
// receptionist's are never registered on an owner-line session (spec §4.4), and none of these on a customer's.
import type { OwnerLineLogKind } from "@bis/db";

const RANGE = {
  range: { type: "string", enum: ["today", "yesterday", "tomorrow", "this_week", "dates"],
    description: "Which days, in the business's timezone. Use dates with from (and to) for a named day or days." },
  from: { type: "string", description: "YYYY-MM-DD. Only with range dates." },
  to: { type: "string", description: "YYYY-MM-DD, the last day, at most 31 days after from. Only with range dates." },
} as const;

export const OWNER_TOOL_SCHEMAS = [
  { type: "function", name: "calls_and_messages",
    description: "The calls Sofía answered in a range, the same calls the dashboard counts as 'Calls answered', newest first. count is exact; spam is how many calls looked like spam, said separately and only when above zero. Each call has when, caller (a name, or 'a new caller'), outcome (what came of it, in words), reason (or null) and needsCallback. more says how many were not listed. Say counts from here; never count yourself.",
    parameters: { type: "object", properties: RANGE, required: ["range"] } },
  { type: "function", name: "appointments",
    description: "The appointments in a range, soonest first: count is exact unless truncated is true, which means there were even more than count. Each has when, customer (or null), meetingType (how they meet, in words, or null) and status (in words). Say the count from here.",
    parameters: { type: "object", properties: RANGE, required: ["range"] } },
  { type: "function", name: "needs_attention",
    description: "What is on this person's To do right now, in the same words the To do page uses: count is exact, and each item has what, customer (or null) and due (or null).",
    parameters: { type: "object", properties: {}, required: [] } },
] as const;

export type OwnerToolName = (typeof OWNER_TOOL_SCHEMAS)[number]["name"];
export const OWNER_TOOL_NAMES: readonly OwnerToolName[] = OWNER_TOOL_SCHEMAS.map((s) => s.name);
export const LOG_KIND_OF: Record<OwnerToolName, OwnerLineLogKind> = {
  calls_and_messages: "owner_line_calls_and_messages",
  appointments: "owner_line_appointments",
  needs_attention: "owner_line_needs_attention",
};
