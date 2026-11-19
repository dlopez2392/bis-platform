// apps/web/src/lib/owner-line/tools/schemas.ts
// Flat GA Realtime tool format (lib/voice/tools/schemas.ts:1-3). The owner line's tools are a SEPARATE list: the
// receptionist's are never registered on an owner-line session (spec §4.4), and none of these on a customer's.
// F-023: the contracts live on the belt's staff catalogue (lib/tools/staff/specs.ts); this is them in the Realtime
// shape, byte for byte what was sent before (owner-tool-schemas.fixture.json).
import type { OwnerLineLogKind } from "@bis/db";
import { realtimeShape } from "@/lib/tools/belt";
import { STAFF_TOOL_SPECS } from "@/lib/tools/staff/specs";

export const OWNER_TOOL_SCHEMAS = STAFF_TOOL_SPECS.map(realtimeShape);

export type OwnerToolName = (typeof OWNER_TOOL_SCHEMAS)[number]["name"];
export const OWNER_TOOL_NAMES: readonly OwnerToolName[] = OWNER_TOOL_SCHEMAS.map((s) => s.name);
export const LOG_KIND_OF: Record<OwnerToolName, OwnerLineLogKind> = {
  calls_and_messages: "owner_line_calls_and_messages",
  appointments: "owner_line_appointments",
  needs_attention: "owner_line_needs_attention",
  lookup_customer: "owner_line_lookup_customer",
};
