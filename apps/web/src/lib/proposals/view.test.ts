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
    callerName: "Ana Lopez", callStartedAt: CALL_AT, personaName: "Sofia", names: NAMES, viewerId: null, ...over,
  });
}

describe("buildSuggestionView: the source label", () => {
  it("names the call's day in the account's zone and the caller, in English and Spanish", () => {
    expect(plain(view(rows.pending).sourceLabel)).toBe("From the call on Wed, Oct 14 · Ana Lopez");
    expect(plain(view(rows.pending, "es").sourceLabel)).toBe("De la llamada del mié, 14 de oct · Ana Lopez");
  });
  it("with no caller name, names the day alone", () => {
    expect(plain(view(rows.pending, "en", { callerName: null }).sourceLabel)).toBe("From the call on Wed, Oct 14");
    expect(plain(view(rows.pending, "es", { callerName: "  " }).sourceLabel)).toBe("De la llamada del mié, 14 de oct");
  });
  it("a call late in the evening is that evening's day in the account's zone, not the next UTC day", () => {
    // 02:30 UTC on Thu Oct 15 is 9:30 PM on Wed Oct 14 in Chicago.
    expect(plain(view(rows.pending, "en", { callStartedAt: "2026-10-15T02:30:00.000Z" }).sourceLabel))
      .toBe("From the call on Wed, Oct 14 · Ana Lopez");
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
  it("a decision by the viewer reads its own sentence, by you / por usted, for each of the three decisions", () => {
    expect(plain(view(rows.accepted, "en", { viewerId: ANA }).decidedLine)).toBe("Accepted by you · 9:42 AM");
    expect(plain(view(rows.accepted, "es", { viewerId: ANA }).decidedLine)).toBe("Aceptada por usted · 9:42 a.m.");
    expect(plain(view(rows.edited, "en", { viewerId: ANA }).decidedLine)).toBe("Edited by you · 9:42 AM");
    expect(plain(view(rows.dismissed, "es", { viewerId: ANA }).decidedLine)).toBe("Descartada por usted · 9:42 a.m.");
  });
  it("a decision made before today in the account's zone carries its date, and the year when it is not this year", () => {
    // 02:30 UTC on Oct 15 is 9:30 PM on Oct 14 in Chicago: yesterday there, though today in UTC.
    const lastNight = { ...rows.accepted, decidedAt: "2026-10-15T02:30:00.000Z" };
    expect(plain(view(lastNight).decidedLine)).toBe("Accepted by Ana Lopez · Oct 14, 9:30 PM");
    expect(plain(view(lastNight, "es").decidedLine)).toBe("Aceptada por Ana Lopez · 14 oct, 9:30 p.m.");
    const lastYear = { ...rows.accepted, decidedAt: "2025-10-14T14:42:00.000Z" };
    expect(plain(view(lastYear).decidedLine)).toBe("Accepted by Ana Lopez · Oct 14, 2025, 9:42 AM");
  });
  // Mid-sentence, the unnamed person is lowercase (final review M-2): "Discarded by someone on the team",
  // never the standalone mark's capital ("Someone on the team", assign.someone).
  it("a decision by a named person reads their name; by nobody we can name, someone on the team, lowercase mid-sentence", () => {
    expect(plain(view(rows.edited).decidedLine)).toBe("Edited by Ana Lopez · 9:42 AM");
    expect(plain(view(rows.dismissed, "en", { names: {} }).decidedLine)).toBe("Discarded by someone on the team · 9:42 AM");
    expect(plain(view(rows.dismissed, "es", { names: {} }).decidedLine)).toBe("Descartada por alguien del equipo · 9:42 a.m.");
    expect(plain(view(rows.expired).decidedLine)).toBe("Marked out of date · 9:42 AM");
    expect(view(rows.pending).decidedLine).toBeNull();
  });
  it("an out-of-date row states its stored reason in the reader's language", () => {
    expect([view(rows.expired).reasonLine, view(rows.expired, "es").statusWord]).toEqual(["This deal has moved since.", "Ya no aplica"]);
  });
  // Design review I2 and minor 2: "Pendiente" read as already on the to-do list (the To do page is
  // "Pendientes", a suggested to-do "Agregar un pendiente"), and "Vencida" read as overdue next to
  // "Vencía el {date}". The Spanish states are Sugerida and Ya no aplica, the refusals' own words.
  it("Spanish: a pending card reads Sugerida, an out-of-date one Ya no aplica, in its status and its decided line", () => {
    expect(view(rows.pending, "es").statusWord).toBe("Sugerida");
    expect(plain(view(rows.expired, "es").decidedLine)).toBe("Se marcó que ya no aplica · 9:42 a.m.");
    expect(view(rows.aged, "es").statusWord).toBe("Ya no aplica");
  });
  it("the persona mark carries the account's persona, never a hard-coded name", () => {
    expect(view(rows.pending, "en", { personaName: "Ana" }).personaMark).toBe("Ana · AI");
    expect(view(rows.pending, "es", { personaName: "Ana" }).personaMark).toBe("Ana · IA");
  });
});

// item 8b-2 (spec 5.5): a card links to the exact transcript turn. The call started at CALL_AT (9:42:00 AM);
// the cited turn was spoken 2 min 14 s in. The row itself was written later, when the call ended, so a
// time computed from `createdAt` instead of the call's start would read a different (negative) answer.
const cited = { ...rows.pending, createdAt: "2026-10-14T14:50:00.000Z", evidenceRef: { turn: 4, at: "2026-10-14T14:44:14.000Z" } } satisfies Proposal;

describe("buildSuggestionView: the transcript link", () => {
  it("links to the cited turn on the call page with the time since the call began, in English and Spanish (mutation: time from createdAt -> FAILS)", () => {
    expect(view(cited).transcript).toEqual({
      href: "/dashboard/accounts/acc_1/calls/call_1#turn-4", label: "See it in the transcript · 2:14",
    });
    expect(view(cited, "es").transcript).toEqual({
      href: "/dashboard/accounts/acc_1/calls/call_1#turn-4", label: "Ver en la transcripción · 2:14",
    });
  });
  it("pads the seconds and counts turn 0 as a turn", () => {
    const first = { ...cited, evidenceRef: { turn: 0, at: "2026-10-14T14:43:05.900Z" } } satisfies Proposal;
    expect(view(first).transcript).toEqual({
      href: "/dashboard/accounts/acc_1/calls/call_1#turn-0", label: "See it in the transcript · 1:05",
    });
  });
  it("with no call start, or a turn before it, the link has no time", () => {
    expect(view(cited, "en", { callStartedAt: null }).transcript)
      .toEqual({ href: "/dashboard/accounts/acc_1/calls/call_1#turn-4", label: "See it in the transcript" });
    expect(view(cited, "es", { callStartedAt: "2026-10-14T14:45:00.000Z" }).transcript)
      .toEqual({ href: "/dashboard/accounts/acc_1/calls/call_1#turn-4", label: "Ver en la transcripción" });
    const noAt = { ...cited, evidenceRef: { turn: 4, at: "" } } satisfies Proposal;
    expect(view(noAt).transcript).toEqual({ href: "/dashboard/accounts/acc_1/calls/call_1#turn-4", label: "See it in the transcript" });
  });
  it("a copied row (no turn) links to the call page itself, with no time", () => {
    expect(view(rows.pending).transcript).toEqual({ href: "/dashboard/accounts/acc_1/calls/call_1", label: "See it in the transcript" });
  });
  it("on the call page, the cited turn is an anchor on the same page and a copied row has no link", () => {
    expect(view(cited, "en", { onCallPage: true }).transcript).toEqual({ href: "#turn-4", label: "See it in the transcript · 2:14" });
    expect(view(rows.pending, "en", { onCallPage: true }).transcript).toBeNull();
  });
  it("a row with no call has no link", () => {
    expect(view({ ...cited, callId: null }).transcript).toBeNull();
  });
});

describe("buildSuggestionView: the reload answer (8b-1 follow-up 1)", () => {
  it("a client-side rejection tells the person to reload, in English and Spanish (mutation: back to maybeFailed -> FAILS)", () => {
    expect(view(rows.pending).labels.crashed).toBe("That didn't reach us. Reload the page, then check before trying again.");
    expect(view(rows.pending, "es").labels.crashed).toBe("No nos llegó. Recargue la página y revise antes de intentarlo otra vez.");
    expect([view(rows.pending).labels.reload, view(rows.pending, "es").labels.reload]).toEqual(["Reload", "Recargar"]);
  });
});
