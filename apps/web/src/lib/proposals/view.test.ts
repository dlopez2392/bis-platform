import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Proposal } from "@bis/db/proposal-rules";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { buildSuggestionView } from "./view";
import { ANA, CALL_AT, NAMES, NOW, PIPELINE_STAGES, STAGES, ZONE, rows } from "@/components/proposals/suggestion-specimens";

/** Intl's own spaces (U+00A0, U+202F) read as plain spaces, so the typed-out literals stay readable (A1). */
const plain = (s: string | null) => s?.replace(/[  ]/g, " ") ?? null;

function view(row: Proposal, locale: Locale = "en", over: Partial<Parameters<typeof buildSuggestionView>[1]> = {}) {
  return buildSuggestionView(row, {
    tr: makeTr(locale), zone: ZONE, now: NOW, stages: STAGES, pipelineStages: PIPELINE_STAGES,
    callerName: "Ana López", callStartedAt: CALL_AT, personaName: "Sofía", names: NAMES, viewerId: null, ...over,
  });
}

describe("buildSuggestionView: the source label", () => {
  it("names the call's day in the account's zone and the caller, in English and Spanish", () => {
    expect(plain(view(rows.pending).sourceLabel)).toBe("From the call on Wed, Oct 14 · Ana López");
    expect(plain(view(rows.pending, "es").sourceLabel)).toBe("De la llamada del mié, 14 de oct · Ana López");
  });
  it("with no caller name, names the day alone", () => {
    expect(plain(view(rows.pending, "en", { callerName: null }).sourceLabel)).toBe("From the call on Wed, Oct 14");
    expect(plain(view(rows.pending, "es", { callerName: "  " }).sourceLabel)).toBe("De la llamada del mié, 14 de oct");
  });
  it("a call late in the evening is that evening's day in the account's zone, not the next UTC day", () => {
    // 02:30 UTC on Thu Oct 15 is 9:30 PM on Wed Oct 14 in Chicago.
    expect(plain(view(rows.pending, "en", { callStartedAt: "2026-10-15T02:30:00.000Z" }).sourceLabel))
      .toBe("From the call on Wed, Oct 14 · Ana López");
  });
  it("formats through format.ts's tag(), never a hand-written locale string (plan fix M11)", () => {
    const src = readFileSync(join(__dirname, "view.ts"), "utf8");
    expect(src).toMatch(/import \{[^}]*\btag\b[^}]*\} from "@\/lib\/format"/);
    expect(src).not.toMatch(/["'](?:en|es)-US["']/);
  });
});

describe("buildSuggestionView: the stage edit", () => {
  it("offers exactly the deal's own pipeline's stages after the one it is at and before the last", () => {
    const v = view(rows.stage);
    expect(v.edit).toEqual({
      kind: "opportunity_stage",
      options: [{ id: "st_quote", name: "Quote sent" }, { id: "st_follow", name: "Following up" }],
      toStageId: "st_quote",
    });
  });
  it("offers nothing when the stage it is at is unknown", () => {
    const v = view({ ...rows.stage, payload: { ...rows.stage.payload, fromStageId: "st_gone" } });
    expect(v.edit).toEqual({ kind: "opportunity_stage", options: [], toStageId: "st_quote" });
  });
});

describe("buildSuggestionView: the to-do and field edits", () => {
  it("a to-do's due date is its local day in the account's zone; no due date is empty", () => {
    expect(view(rows.pending).edit).toEqual({ kind: "task", title: "Call back about the quote", dueDate: "2026-10-21" });
    expect(view(rows.edited).edit).toEqual({ kind: "task", title: "Call back about the quote", dueDate: "" });
    // 03:00 UTC on Oct 22 is 10 PM on Oct 21 in Chicago: the form must show the 21st.
    const late = { ...rows.pending, payload: { title: "Call back about the quote", dueAt: "2026-10-22T03:00:00.000Z" } };
    expect(view(late).edit).toEqual({ kind: "task", title: "Call back about the quote", dueDate: "2026-10-21" });
  });
  it("a field edit carries the field's own word in the reader's language and the suggested value", () => {
    expect(view(rows.accepted).edit).toEqual({ kind: "contact_field", label: "Phone", value: "+1 956 555 0142" });
    expect(view(rows.accepted, "es").edit).toEqual({ kind: "contact_field", label: "Teléfono", value: "+1 956 555 0142" });
  });
});

describe("buildSuggestionView: status, canAct and who decided", () => {
  it("canAct follows effectiveStatus: pending acts, a pending row past expiresAt is out of date and does not", () => {
    expect([view(rows.pending).canAct, view(rows.pending).status]).toEqual([true, "pending"]);
    const aged = view(rows.aged);
    expect([aged.canAct, aged.status, aged.statusWord, aged.reasonLine]).toEqual([false, "expired", "Out of date", "More than 30 days old."]);
    expect(view(rows.accepted).canAct).toBe(false);
  });
  it("a decision by the viewer reads You; by a named person, their name; by nobody we can name, Someone on the team", () => {
    expect(plain(view(rows.accepted, "en", { viewerId: ANA }).decidedLine)).toBe("Accepted by You · 9:42 AM");
    expect(plain(view(rows.accepted, "es", { viewerId: ANA }).decidedLine)).toBe("Aceptada por Usted · 9:42 a.m.");
    expect(plain(view(rows.edited).decidedLine)).toBe("Edited by Ana López · 9:42 AM");
    expect(plain(view(rows.dismissed, "en", { names: {} }).decidedLine)).toBe("Discarded by Someone on the team · 9:42 AM");
    expect(plain(view(rows.expired).decidedLine)).toBe("Marked out of date · 9:42 AM");
    expect(view(rows.pending).decidedLine).toBeNull();
  });
  it("an out-of-date row states its stored reason in the reader's language", () => {
    expect([view(rows.expired).reasonLine, view(rows.expired, "es").statusWord]).toEqual(["This deal has moved since.", "Vencida"]);
  });
  it("the persona mark carries the account's persona, never a hard-coded name", () => {
    expect(view(rows.pending, "en", { personaName: "Ana" }).personaMark).toBe("Ana · AI");
    expect(view(rows.pending, "es", { personaName: "Ana" }).personaMark).toBe("Ana · IA");
  });
});
