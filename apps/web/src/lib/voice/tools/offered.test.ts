// F-023 PR 4: which tools a prompt may name — the ones its session is sent, decided from the same input.
import { describe, it, expect } from "vitest";
import { offeredTools, ifOffered } from "./offered";
import { toolSchemas } from "./schemas";
import type { BookingMode } from "../booking-mode";

const base = {
  bookingEnabled: true, afterHours: "hours_then_message" as const, meetingType: "in_person" as const,
};
const MODE_INPUT: Record<BookingMode, { bookingEnabled: boolean; afterHours: "hours_then_message" | "message_only" }> = {
  full: { bookingEnabled: true, afterHours: "hours_then_message" },
  manage: { bookingEnabled: true, afterHours: "message_only" },
  none: { bookingEnabled: false, afterHours: "hours_then_message" },
};

describe("offeredTools", () => {
  it("the phone (no medium, or \"phone\") offers exactly what toolSchemas sends, for every mode × meeting type × handoff", () => {
    for (const [mode, modeInput] of Object.entries(MODE_INPUT) as [BookingMode, (typeof MODE_INPUT)[BookingMode]][])
      for (const meetingType of ["in_person", "phone", "video"] as const)
        for (const handoffAvailable of [false, true])
          for (const medium of [undefined, "phone"] as const) {
            const sent = toolSchemas(mode, meetingType, handoffAvailable).map((t) => t.name);
            expect([...offeredTools({ ...modeInput, meetingType, handoffAvailable, medium })], `${mode}/${meetingType}/${handoffAvailable}/${medium}`)
              .toEqual(sent);
          }
  });

  it("a browser demo (web_voice) offers nothing, whatever the profile says: both routes mint tools: []", () => {
    expect([...offeredTools({ ...base, medium: "web_voice", handoffAvailable: true })]).toEqual([]);
    expect([...offeredTools({ ...base, medium: "web_voice", bookingEnabled: false })]).toEqual([]);
  });

  it("the web chat offers capture_lead alone (CAPTURE_LEAD_TOOL), whatever the profile says", () => {
    expect([...offeredTools({ ...base, medium: "web", handoffAvailable: true })]).toEqual(["capture_lead"]);
    expect([...offeredTools({ ...base, medium: "web", bookingEnabled: false })]).toEqual(["capture_lead"]);
  });
});

describe("ifOffered", () => {
  const offered = new Set(["take_message", "find_my_booking"] as const);
  it("is the line when its tool is offered, and nothing when it is not", () => {
    expect(ifOffered(offered, "take_message", "- take_message(body)")).toEqual(["- take_message(body)"]);
    expect(ifOffered(offered, "capture_lead", "- capture_lead(fields)")).toEqual([]);
  });
  it("with several tools, needs every one of them", () => {
    expect(ifOffered(offered, ["take_message", "find_my_booking"], "both")).toEqual(["both"]);
    expect(ifOffered(offered, ["take_message", "cancel_appointment"], "one missing")).toEqual([]);
  });
});
