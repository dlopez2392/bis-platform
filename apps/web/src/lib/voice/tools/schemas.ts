// apps/web/src/lib/voice/tools/schemas.ts
// Flat GA Realtime tool format: type/name/description/parameters at top
// level, no function: wrapper. F-023: the contracts live on the belt's
// customer catalogue (lib/tools/customer/specs.ts); this picks a phone
// session's tools from it, byte for byte what was sent before
// (lib/tools/customer/customer-tool-schemas.fixture.json).
import type { BookingMode } from "../booking-mode";
import { realtimeShape } from "@/lib/tools/belt";
import { CUSTOMER_TOOL_SPECS, selectVariant, type CustomerToolName } from "@/lib/tools/customer/specs";

/** Whether a phone session with this booking mode and handoff carries the tool. Everything else is always there. */
function onSession(name: CustomerToolName, mode: BookingMode, handoffAvailable: boolean): boolean {
  switch (name) {
    // Advertised ONLY when the account actually has somewhere to send the
    // caller; asking for a person has nothing to do with whether this
    // business takes appointments, so booking mode never removes it.
    case "transfer_to_human": return handoffAvailable;
    // "Always take a message": every booking tool but the one that books a NEW
    // appointment (`booking-mode.ts`). check_availability stays — a move needs
    // a time it offered.
    case "book_appointment": return mode === "full";
    case "check_availability": case "reschedule_appointment": case "cancel_appointment":
    case "find_my_booking": case "confirm_identity":
      return mode !== "none";
    case "capture_lead": case "take_message": case "log_transcript": return true;
  }
}

export function toolSchemas(
  mode: BookingMode, meetingType: "in_person" | "phone" | "video",
  handoffAvailable: boolean,
) {
  // The catalogue's order is the session's order: booking tools, then the
  // core three, then transfer_to_human. A variant is picked by the session's
  // facts: check_availability's under "manage" (its description must not name
  // the tool this session lacks), book_appointment's on a video calendar.
  const facts = [mode, meetingType];
  return CUSTOMER_TOOL_SPECS
    .filter((s) => onSession(s.name, mode, handoffAvailable))
    .map((s) => realtimeShape(selectVariant(s, facts)));
}
