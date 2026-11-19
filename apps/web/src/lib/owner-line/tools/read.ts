// apps/web/src/lib/owner-line/tools/read.ts
// F-023: the three reads moved to lib/tools/staff/read.ts. This path stays for the importers outside the owner line
// (the daily brief: lib/automations/passes/daily-owner-brief.ts, lib/brief/brief-content.ts), which name it.
export { callsAndMessages, appointments, needsAttention } from "@/lib/tools/staff/read";
export type {
  StaffReadContext as OwnerReadContext, CallsAndMessagesResult, AppointmentsResult, NeedsAttentionResult,
} from "@/lib/tools/staff/read";
