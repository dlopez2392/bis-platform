import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  appendConsentEventGuarded: vi.fn(), ensureConsentTask: vi.fn(), nextBookedStart: vi.fn(),
  readAccountTimezone: vi.fn(), getContact: vi.fn(), completeTasksForConsentEvents: vi.fn(), readConsentHistory: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import {
  classifyInbound, parseAutoresponse, recordInboundConsent, excerptOf, CHANGES_CONSENT,
  type InboundConsentInput, type InboundClass, type ConsentReplyPlan,
} from "./inbound";
import { m } from "@/lib/messages";

const DB = {} as never;
const NOW = new Date("2026-10-06T20:00:00Z");
const input = (over: Partial<InboundConsentInput> = {}): InboundConsentInput => ({
  accountId: "acct_1", address: "+19562921696", text: "STOP", autoresponse: null, autoresponseRaw: null,
  providerMessageId: "msg_1", messagingProfileId: "prof_1", contactId: "ct_1", firstFiling: true, now: NOW, ...over,
});
const appended = (id: string, prior: object | null = null) => ({ outcome: "appended", id, prior });
const calls = () => db.appendConsentEventGuarded.mock.calls.map((c) => [c[1].action, c[1].method, c[2]]);
/** One run of the step; `reply` is the first reply it owed, `owed` every one (there must never be two). */
async function run(i: InboundConsentInput, c: InboundClass): Promise<{ reply: ConsentReplyPlan | null; owed: ConsentReplyPlan[] }> {
  const owed: ConsentReplyPlan[] = [];
  await recordInboundConsent(DB, i, c, (p) => owed.push(p));
  expect(owed.length).toBeLessThanOrEqual(1);
  return { reply: owed[0] ?? null, owed };
}

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
    e.action === "granted" ? { outcome: "refused", prior: null } : appended(`ev_${e.action}`));
  db.ensureConsentTask.mockResolvedValue({ id: "task_1", created: true });
  db.nextBookedStart.mockResolvedValue(null);
  db.readAccountTimezone.mockResolvedValue("America/Los_Angeles");
  db.getContact.mockResolvedValue({ id: "ct_1", first_name: "Ana", last_name: "Ruiz" });
  db.completeTasksForConsentEvents.mockResolvedValue([]);
  db.readConsentHistory.mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("parseAutoresponse and classifyInbound (plan G4)", () => {
  it("ANY non-blank value means Telnyx replied: STOP, START and HELP in any case, INFO read as HELP, anything else OTHER; only a missing or blank value is null (review R2-I2; mutation: map an unknown value to null → BIS would reply too, FAILS)", () => {
    expect([parseAutoresponse("STOP"), parseAutoresponse(" start "), parseAutoresponse("help")]).toEqual(["STOP", "START", "HELP"]);
    expect([parseAutoresponse("INFO"), parseAutoresponse("info")]).toEqual(["HELP", "HELP"]);
    expect([parseAutoresponse("AYUDA"), parseAutoresponse("opt_out")]).toEqual(["OTHER", "OTHER"]);
    expect([parseAutoresponse(""), parseAutoresponse("  "), parseAutoresponse(5), parseAutoresponse(undefined), parseAutoresponse(null)])
      .toEqual([null, null, null, null, null]);
  });

  it("only Telnyx's STOP makes a stop on its own; an OTHER or INFO it sent on a text BIS does not recognise is telnyx_only, recorded nowhere (review R2-I2: only STOP records carrier_block; mutation: treat OTHER as a stop → FAILS)", () => {
    expect(classifyInbound("hola?", "OTHER")).toEqual({ kind: "telnyx_only", autoresponse: "OTHER" });
    expect(classifyInbound("info please", "HELP")).toEqual({ kind: "telnyx_only", autoresponse: "HELP" });
  });

  it("a stop SENTENCE is held even when Telnyx answered something else — the hold is the safe direction (review R2-m-b; mutation: return telnyx_only before reading the phrase list → FAILS)", () => {
    expect(classifyInbound("please stop texting me", "OTHER")).toMatchObject({ kind: "phrase", phrase: { phrase: "stop texting" } });
    expect(classifyInbound("ya no me manden nada", "HELP")).toMatchObject({ kind: "phrase" });
  });

  it("a keyword decides the kind; Telnyx's STOP makes it a stop even when BIS's list does not match (mutation: ignore autoresponse STOP → none, FAILS)", () => {
    expect(classifyInbound("PARAR", null)).toMatchObject({ kind: "stop", keyword: { word: "PARAR", language: "es" } });
    expect(classifyInbound("please stop contacting us", "STOP")).toEqual({ kind: "stop", keyword: null });
    expect(classifyInbound("Unstop", null)).toMatchObject({ kind: "start" });
    expect(classifyInbound("ayuda", null)).toMatchObject({ kind: "help", keyword: { language: "es" } });
  });

  it("a Telnyx START or HELP BIS does not recognise is telnyx_only; a sentence is a phrase; the rest is none (mutation: treat telnyx_only START as a start → FAILS)", () => {
    expect(classifyInbound("join", "START")).toEqual({ kind: "telnyx_only", autoresponse: "START" });
    expect(classifyInbound("ya no me manden nada", null)).toMatchObject({ kind: "phrase", phrase: { phrase: "no me manden nada" } });
    expect(classifyInbound("see you Tuesday", null)).toEqual({ kind: "none" });
  });

  it("only a stop, a start and a phrase change consent, so only they answer 503 on failure (plan G2; mutation: add help → FAILS)", () => {
    expect([...CHANGES_CONSENT].sort()).toEqual(["phrase", "start", "stop"]);
  });
});

describe("recordInboundConsent — a stop", () => {
  it("appends revoked / keyword, guarded unless_customer_stopped, sourced to the message, with the evidence staff and counsel read (mutation: drop sourceRef → a retry writes twice, FAILS)", async () => {
    await run(input({ text: "Stop!" }), classifyInbound("Stop!", null));
    const e = db.appendConsentEventGuarded.mock.calls.find((c) => c[1].action === "revoked")!;
    expect(e[1]).toEqual({
      accountId: "acct_1", channel: "sms", address: "+19562921696", contactId: "ct_1", sourceRef: "msg_1",
      action: "revoked", method: "keyword",
      evidence: { keyword: "STOP", language: "en", autoresponse_type: null, autoresponse_type_raw: null, messaging_profile_id: "prof_1", excerpt: "Stop!" },
    });
    expect(e[2]).toBe("unless_customer_stopped");
  });

  it("keeps the RAW autoresponse_type string beside the parsed value, so a spelling BIS reads as OTHER is still on record (mutation: drop autoresponse_type_raw from the evidence → FAILS)", async () => {
    await run(input({ text: "baja", autoresponse: "OTHER", autoresponseRaw: "OPT_OUT_XYZ" }), classifyInbound("baja", "OTHER"));
    const e = db.appendConsentEventGuarded.mock.calls.find((c) => c[1].action === "revoked")!;
    expect(e[1].evidence).toMatchObject({ autoresponse_type: "OTHER", autoresponse_type_raw: "OPT_OUT_XYZ" });
  });

  it("logs the ambiguity — never the customer's own number — when Telnyx's autoresponse_type reads as OTHER on a stop (mutation: skip the log → FAILS; mutation: log i.address → FAILS)", async () => {
    await run(input({ text: "baja", address: "+19562921696", autoresponse: "OTHER", autoresponseRaw: "OPT_OUT_XYZ" }), classifyInbound("baja", "OTHER"));
    const lines = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => /OTHER/.test(l) && /OPT_OUT_XYZ/.test(l))).toBe(true);
    expect(lines.some((l) => l.includes("+19562921696"))).toBe(false);
  });

  it("Telnyx did NOT answer: BIS sends the one confirmation, answering this row, in the keyword's language (mutation: drop answersEventId → FAILS)", async () => {
    const r = await run(input({ text: "baja" }), classifyInbound("baja", null));
    expect(r.reply).toEqual({ kind: "consent.stop_confirmation", language: "es", answersEventId: "ev_revoked" });
  });

  it("Telnyx DID answer: the stop is recorded and BIS sends nothing — one confirmation, never two (spec decision 12, plan F4; mutation: reply anyway → FAILS)", async () => {
    const r = await run(input({ autoresponse: "STOP" }), classifyInbound("STOP", "STOP"));
    expect(calls()).toContainEqual(["revoked", "keyword", "unless_customer_stopped"]);
    expect(r.reply).toBeNull();
  });

  it("a Telnyx STOP BIS's list does not match is recorded as the carrier's block, and BIS sends nothing (plan G4; mutation: skip it → FAILS)", async () => {
    const r = await run(input({ text: "plz no mas msgs", autoresponse: "STOP" }), classifyInbound("plz no mas msgs", "STOP"));
    expect(calls()).toContainEqual(["revoked", "carrier_block", "unless_customer_stopped"]);
    expect(r.reply).toBeNull();
  });

  it("a customer's STOP over a STAFF stop is recorded, with no confirmation: the texts were already off, and now only the customer can turn them back on (danlo 2026-09-28, review R2-I3, spec S8; mutation: confirm it → FAILS)", async () => {
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
      e.action === "revoked" ? appended("ev_kw", { id: "st", action: "revoked", method: "staff", evidence: {} }) : { outcome: "refused", prior: null });
    const r = await run(input({ text: "Alto" }), classifyInbound("Alto", null));
    expect(calls()).toContainEqual(["revoked", "keyword", "unless_customer_stopped"]);
    expect(r.reply).toBeNull();
  });

  it("a CANCEL whose To-do fails still owes its confirmation, owed BEFORE the throw — the attempt that wrote the stop answers it, and the 503's retry (duplicate) owes nothing (review R2-I1a; mutation: owe the reply after cancelTodo → nothing owed, FAILS)", async () => {
    db.nextBookedStart.mockRejectedValue(new Error("bookings read failed"));
    const owed: ConsentReplyPlan[] = [];
    await expect(recordInboundConsent(DB, input({ text: "Cancel." }), classifyInbound("Cancel.", null), (p) => owed.push(p)))
      .rejects.toThrow("bookings read failed");
    expect(owed).toEqual([{ kind: "consent.stop_confirmation", language: "en", answersEventId: "ev_revoked" }]);
  });

  it("a STOP or a START that lands on a HELD address closes the To-dos of EVERY hold on that number — the reopened one of an Undo included — so no row is left with two dead buttons (review R3-I1, R3-N3; mutation: skip the close → FAILS; mutation: close only the prior row's To-dos → FAILS)", async () => {
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
      e.action === "granted" ? { outcome: "refused", prior: null } : appended(`ev_${e.action}`, { id: "ev_hold", action: "held", method: "staff_undo", evidence: {} }));
    // Not a stop, then its Undo: H0 released, then H (the Undo's new hold); T0 was reopened and still links H0.
    db.readConsentHistory.mockResolvedValue([
      { id: "ev_hold", action: "held", method: "staff_undo", occurred_at: "2026-10-05T12:00:00Z", evidence: {}, note: null, actor_id: "u" },
      { id: "ev_rel", action: "hold_released", method: "staff", occurred_at: "2026-10-05T11:00:00Z", evidence: {}, note: null, actor_id: "u" },
      { id: "ev_hold_0", action: "held", method: "free_text", occurred_at: "2026-10-05T10:00:00Z", evidence: {}, note: null, actor_id: null },
    ]);
    await run(input({ text: "STOP" }), classifyInbound("STOP", null));
    expect(db.readConsentHistory).toHaveBeenCalledWith(DB, "acct_1", "sms", "+19562921696");   // this number's holds, not another's (review M8)
    expect(db.completeTasksForConsentEvents).toHaveBeenCalledWith(DB, "acct_1", ["ev_hold", "ev_hold_0"], "sms-inbound", "system");
    db.completeTasksForConsentEvents.mockClear();
    await run(input({ text: "START", providerMessageId: "msg_2" }), classifyInbound("START", null));
    expect(db.completeTasksForConsentEvents).toHaveBeenCalledWith(DB, "acct_1", ["ev_hold", "ev_hold_0"], "sms-inbound", "system");
    // Closing is cleanup: its failure is logged, and the stop still stands and is still confirmed.
    db.completeTasksForConsentEvents.mockRejectedValue(new Error("tasks update failed"));
    const r = await run(input({ text: "STOP", providerMessageId: "msg_3" }), classifyInbound("STOP", null));
    expect(r.reply?.kind).toBe("consent.stop_confirmation");
  });

  it("an address the customer already stopped gets nothing — no confirmation, no To-do (spec §4.2 step 2; mutation: reply on refused → FAILS)", async () => {
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
      e.action === "revoked" ? { outcome: "refused", prior: { id: "old", action: "revoked", method: "keyword", evidence: {} } } : { outcome: "refused", prior: null });
    db.nextBookedStart.mockResolvedValue("2026-10-09T15:00:00Z");
    const r = await run(input({ text: "CANCEL" }), classifyInbound("CANCEL", null));
    expect(r.reply).toBeNull();
    expect(db.ensureConsentTask).not.toHaveBeenCalled();
  });

  it("a retry of the same message (duplicate) sends nothing, and makes sure the CANCEL To-do exists (plan G1; mutation: reply on duplicate → FAILS)", async () => {
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
      e.action === "revoked" ? { outcome: "duplicate", id: "ev_first" } : { outcome: "refused", prior: null });
    db.nextBookedStart.mockResolvedValue("2026-10-09T15:00:00Z");
    const r = await run(input({ text: "cancel", firstFiling: false }), classifyInbound("cancel", null));
    expect(r.reply).toBeNull();
    expect(db.ensureConsentTask).toHaveBeenCalledWith(DB, "acct_1", expect.objectContaining({ consentEventId: "ev_first" }), "sms-inbound", "system");
  });

  it("CANCEL with an upcoming booking adds the To-do in the account's own zone; with none, no To-do (spec §4.2 step 2; mutation: print the date in UTC → Oct 10, FAILS)", async () => {
    db.nextBookedStart.mockResolvedValue("2026-10-10T02:00:00Z"); // Oct 9, 7 PM in Los Angeles
    await run(input({ text: "Cancelar" }), classifyInbound("Cancelar", null));
    expect(db.ensureConsentTask).toHaveBeenCalledWith(DB, "acct_1", {
      contactId: "ct_1", consentEventId: "ev_revoked",
      title: "Ana Ruiz texted CANCELAR, so their texts are stopped. Check whether they also meant their appointment on Oct 9, 2026.",
    }, "sms-inbound", "system");
    db.ensureConsentTask.mockClear();
    db.nextBookedStart.mockResolvedValue(null);
    await run(input({ text: "Cancelar", providerMessageId: "msg_2" }), classifyInbound("Cancelar", null));
    expect(db.ensureConsentTask).not.toHaveBeenCalled();
  });

  it("END is a stop, not a CANCEL: no appointment To-do (mutation: every stop word checks the booking → FAILS)", async () => {
    db.nextBookedStart.mockResolvedValue("2026-10-09T15:00:00Z");
    await run(input({ text: "END" }), classifyInbound("END", null));
    expect(db.nextBookedStart).not.toHaveBeenCalled();
  });

  it("a ledger write that fails THROWS, so the route answers 503 and Telnyx retries (spec §5; mutation: catch and return → FAILS)", async () => {
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) => {
      if (e.action === "revoked") throw new Error("append_consent_event failed: timeout");
      return { outcome: "refused", prior: null };
    });
    await expect(run(input(), classifyInbound("STOP", null))).rejects.toThrow("timeout");
  });
});

describe("recordInboundConsent — START and HELP", () => {
  it("START lifts a stop, and the confirmation speaks the language of the stop it lifts (spec §4.2; mutation: always English → FAILS)", async () => {
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
      e.action === "resubscribed" ? appended("ev_start", { id: "old", action: "revoked", method: "keyword", evidence: { language: "es" } }) : { outcome: "refused", prior: null });
    const r = await run(input({ text: "START" }), classifyInbound("START", null));
    expect(calls()).toContainEqual(["resubscribed", "start_keyword", "if_stopped_or_held"]);
    expect(r.reply).toEqual({ kind: "consent.start_confirmation", language: "es" });
  });

  it("START that Telnyx answered, or that lifted nothing, gets no BIS reply (mutation: reply when refused → FAILS)", async () => {
    expect((await run(input({ text: "START", autoresponse: "START" }), classifyInbound("START", "START"))).reply).toBeNull();
    db.appendConsentEventGuarded.mockResolvedValue({ outcome: "refused", prior: null });
    expect((await run(input({ text: "START" }), classifyInbound("START", null))).reply).toBeNull();
  });

  it("AYUDA gets BIS's Spanish help, once, only when Telnyx did not answer and only from the attempt that filed the text (mutation: reply on a retry → FAILS)", async () => {
    expect((await run(input({ text: "Ayuda" }), classifyInbound("Ayuda", null))).reply).toEqual({ kind: "consent.help", language: "es" });
    expect((await run(input({ text: "Ayuda", firstFiling: false }), classifyInbound("Ayuda", null))).reply).toBeNull();
    expect((await run(input({ text: "HELP", autoresponse: "HELP" }), classifyInbound("HELP", "HELP"))).reply).toBeNull();
    expect(calls().filter(([a]) => a !== "granted")).toEqual([]);
  });

  it("AYUDA that Telnyx marked INFO or with a value BIS does not know gets NO BIS reply — one reply, never two (review R2-I2; mutation: reply when autoresponse is OTHER → FAILS)", async () => {
    expect((await run(input({ text: "Ayuda", autoresponse: parseAutoresponse("INFO") }), classifyInbound("Ayuda", parseAutoresponse("INFO")))).reply).toBeNull();
    expect((await run(input({ text: "Ayuda", autoresponse: "OTHER" }), classifyInbound("Ayuda", "OTHER"))).reply).toBeNull();
    expect((await run(input({ text: "baja", autoresponse: "OTHER" }), classifyInbound("baja", "OTHER"))).reply).toBeNull();
    expect(calls()).toContainEqual(["revoked", "keyword", "unless_customer_stopped"]);   // the stop is still recorded
  });

  it("a Telnyx START that BIS does not recognise is logged, never recorded (plan G4: disagreement resolves toward sending less; mutation: record it → FAILS)", async () => {
    const r = await run(input({ text: "join", autoresponse: "START" }), classifyInbound("join", "START"));
    expect(r.reply).toBeNull();
    expect(calls().filter(([a]) => a !== "granted")).toEqual([]);
    expect(String(vi.mocked(console.error).mock.calls.at(-1)?.[0])).toMatch(/does not match/);
  });
});

describe("recordInboundConsent — a phrase, the grant, the alert phone", () => {
  it("a phrase holds texts (if_allowed) and asks staff with a To-do naming the contact and what they wrote; no text is sent (choice 20; mutation: reply → FAILS)", async () => {
    const text = "Por favor ya no me manden mensajes, estoy muy ocupada con el trabajo y la familia esta semana";
    const r = await run(input({ text }), classifyInbound(text, null));
    expect(calls()).toContainEqual(["held", "free_text", "if_allowed"]);
    expect(db.appendConsentEventGuarded.mock.calls.find((c) => c[1].action === "held")![1].evidence)
      .toEqual({ phrase: "no me manden mensajes", language: "es", excerpt: text });
    expect(db.ensureConsentTask).toHaveBeenCalledWith(DB, "acct_1", {
      contactId: "ct_1", consentEventId: "ev_held",
      title: m["todo.consent.hold.en"].replace("{name}", "Ana Ruiz").replace("{excerpt}", excerptOf(text, 60)),
    }, "sms-inbound", "system");
    expect(r.reply).toBeNull();
  });

  it("a phrase on an address that is not allowed holds nothing and asks nothing (mutation: To-do on refused → FAILS)", async () => {
    db.appendConsentEventGuarded.mockResolvedValue({ outcome: "refused", prior: null });
    await run(input({ text: "wrong number" }), classifyInbound("wrong number", null));
    expect(db.ensureConsentTask).not.toHaveBeenCalled();
  });

  it("a nameless contact is named by their number in the To-do (mutation: print '(no name)' → FAILS)", async () => {
    db.getContact.mockResolvedValue({ id: "ct_1", first_name: null, last_name: null });
    await run(input({ text: "remove me" }), classifyInbound("remove me", null));
    expect(db.ensureConsentTask.mock.calls[0]![2].title).toMatch(/^\+19562921696 may have asked/);
  });

  it("the first-text grant is written FIRST, if_empty, and its failure is only logged — the stop still lands (decision 8, plan G2; mutation: let the grant's failure throw → FAILS)", async () => {
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) => {
      if (e.action === "granted") throw new Error("grant write failed");
      return appended(`ev_${e.action}`);
    });
    const r = await run(input(), classifyInbound("STOP", null));
    expect(calls()[0]).toEqual(["granted", "inbound_text", "if_empty"]);
    expect(r.reply?.kind).toBe("consent.stop_confirmation");
  });

  it("the alert phone (no contact) gets no grant and no To-do, but its STOP is recorded and confirmed (plan G10; mutation: grant with contactId null → FAILS)", async () => {
    db.nextBookedStart.mockResolvedValue("2026-10-09T15:00:00Z");
    const r = await run(input({ contactId: null, text: "cancel" }), classifyInbound("cancel", null));
    expect(calls()).toEqual([["revoked", "keyword", "unless_customer_stopped"]]);
    expect(db.ensureConsentTask).not.toHaveBeenCalled();
    expect(r.reply?.kind).toBe("consent.stop_confirmation");
  });
});

describe("excerptOf", () => {
  it("keeps at most `max` characters, never splitting an emoji, and marks the cut (mutation: .slice on UTF-16 → a lone surrogate, FAILS)", () => {
    const text = `${"a".repeat(58)}👍👍👍`;
    const cut = excerptOf(text, 60);
    expect(Array.from(cut)).toHaveLength(60);
    expect(cut.endsWith("👍…")).toBe(true);
    expect(excerptOf("  short\n text ")).toBe("short text");
  });
});
