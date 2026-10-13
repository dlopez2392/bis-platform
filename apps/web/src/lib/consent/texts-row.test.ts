import { describe, it, expect, vi } from "vitest";
import { m } from "@/lib/messages";
import { howLine, textsLine, parseTextsResponse, textsLoadFrom, runTextsAction, textsStatusWord, TEXTS_TREATMENT } from "./texts-row";
import type { TextsView } from "./texts-view";

const STOPPED: TextsView = { kind: "stopped", eventId: "ev1", since: "2026-10-04T02:30:00Z", how: { kind: "keyword", word: "STOP" }, canResume: false };

describe("the Texts row's lines (spec §6)", () => {
  it("stopped reads 'Since {date} · {how}', the date in the ACCOUNT's zone (mutation: format in UTC → Oct 4, FAILS)", () => {
    expect(textsLine(STOPPED, "America/Chicago")).toBe(`${m["contact.texts.since"].replace("{date}", "Oct 3, 2026")} · they texted STOP`);
    expect(textsLine(STOPPED, "UTC")).toContain("Oct 4, 2026");
  });

  it("an unreadable date keeps the how, never throws inside a render (mutation: let formatDateInZone throw → FAILS)", () => {
    expect(textsLine({ ...STOPPED, since: "not a date" }, "America/Chicago")).toBe("they texted STOP");
  });

  it("each how in plain words, a free-text stop naming who confirmed it (mutation: drop the name branch → FAILS)", () => {
    expect(howLine({ kind: "free_text", excerpt: "ya no me manden mensajes", by: "Ana" })).toBe("they wrote “ya no me manden mensajes”, confirmed by Ana");
    expect(howLine({ kind: "free_text", excerpt: "ya no me manden mensajes", by: null })).toBe("they wrote “ya no me manden mensajes”, confirmed by your team");
    expect(howLine({ kind: "staff" })).toBe(m["contact.texts.how.staff"]);
    expect(howLine({ kind: "carrier" })).toBe(m["contact.texts.how.carrier"]);
    expect(howLine({ kind: "unsubscribe_link" })).toBe(m["contact.texts.how.unsubscribeLink"]);
  });

  it("a hold quotes what they wrote, cut at 60 characters; with nothing to quote it says texts are on hold (mutation: no fallback → '“null”', FAILS)", () => {
    expect(textsLine({ kind: "held", eventId: "h", since: "2026-10-03T15:00:00Z", excerpt: "remove me" }, "UTC")).toBe("They wrote “remove me”. Texts are on hold.");
    expect(textsLine({ kind: "held", eventId: "h", since: "2026-10-03T15:00:00Z", excerpt: null }, "UTC")).toBe(m["compose.smsHeld"]);
    const long = textsLine({ kind: "held", eventId: "h", since: "x", excerpt: "a".repeat(80) }, "UTC")!;
    expect(long).toContain(`“${"a".repeat(59)}…”`);
  });

  it("status is a dot and a word from the token classes (rule 3; mutation: stopped borrows allowed's dot → FAILS)", () => {
    expect(TEXTS_TREATMENT.allowed).toMatchObject({ label: "Allowed", dot: "bg-success" });
    expect(TEXTS_TREATMENT.stopped).toMatchObject({ label: "Stopped", dot: "bg-destructive" });
    expect(TEXTS_TREATMENT.held).toMatchObject({ label: "On hold", dot: "bg-warning" });
  });
});

describe("parseTextsResponse / textsLoadFrom — the drawer's read is parsed, not cast", () => {
  it("a good body is ready; a non-OK response or a malformed body is the error state (mutation: cast the body → the bad one is ready, FAILS)", async () => {
    const good = { view: { kind: "allowed", newestId: null }, zone: "America/Chicago", phone: "+19562921696" };
    expect(await textsLoadFrom({ ok: true, json: async () => good })).toEqual({ status: "ready", ...good });
    expect(await textsLoadFrom({ ok: false, json: async () => good })).toEqual({ status: "error" });
    expect(parseTextsResponse({ view: { kind: "maybe" }, zone: "UTC", phone: null })).toBeNull();
    expect(parseTextsResponse({ view: { kind: "stopped", since: "x", how: { kind: "staff" } }, zone: "UTC", phone: null })).toBeNull();
    expect(parseTextsResponse({ view: { kind: "allowed", newestId: null }, phone: null })).toBeNull();
  });
});

describe("runTextsAction — at once, the answer shown, Undo on the toast (rule 6)", () => {
  const toast = () => {
    let undo: (() => unknown) | null = null;
    const t = {
      success: vi.fn((_m: string, opts?: { action: { label: string; onClick: () => void } }) => { undo = opts?.action.onClick ?? null; }),
      error: vi.fn(),
    };
    return { t, click: () => undo?.() };
  };
  const ALLOWED: TextsView = { kind: "allowed", newestId: "e0" };

  it("shows the new state, calls onChanged, and offers Undo that runs with the action's own token (mutation: drop the undo action → FAILS)", async () => {
    const shown: TextsView[] = [];
    const { t, click } = toast();
    const undo = vi.fn(async () => ({ ok: true as const, view: ALLOWED }));
    const onChanged = vi.fn();
    expect(await runTextsAction(async () => ({ ok: true, view: STOPPED, undo: { kind: "stop", eventId: "ev1" } }), (v) => shown.push(v), t,
      { success: m["contact.texts.stoppedToast"], undo, onChanged })).toBe(true);
    expect(shown).toEqual([STOPPED]);
    expect(t.success).toHaveBeenCalledWith(m["contact.texts.stoppedToast"], expect.objectContaining({ action: expect.objectContaining({ label: m["common.undo"] }) }));
    await click();
    expect(undo).toHaveBeenCalledWith({ kind: "stop", eventId: "ev1" });
    expect(shown).toEqual([STOPPED, ALLOWED]);
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("a refusal says why AND shows where things stand now (mutation: drop show on refusal → FAILS)", async () => {
    const shown: TextsView[] = [];
    const { t } = toast();
    expect(await runTextsAction(async () => ({ ok: false, error: m["contact.texts.changed"], view: STOPPED }), (v) => shown.push(v), t, { success: "x" })).toBe(false);
    expect(t.error).toHaveBeenCalledWith(m["contact.texts.changed"]);
    expect(shown).toEqual([STOPPED]);
  });

  it("a rejected action (a stale tab after a redeploy) is the 'crashed' line (mutation: let it throw → FAILS)", async () => {
    const { t } = toast();
    expect(await runTextsAction(async () => { throw new Error("stale action id"); }, () => {}, t, { success: "x" })).toBe(false);
    expect(t.error).toHaveBeenCalledWith(m["inline.crashed"]);
  });

  it("a success with nothing to undo is a plain toast; a refused Undo says so (mutation: drop the undoBusy line → FAILS)", async () => {
    const { t, click } = toast();
    await runTextsAction(async () => ({ ok: true, view: ALLOWED }), () => {}, t, { success: m["contact.texts.resumedToast"] });
    expect(t.success).toHaveBeenCalledWith(m["contact.texts.resumedToast"]);
    const second = toast();
    await runTextsAction(async () => ({ ok: true, view: STOPPED, undo: { kind: "stop", eventId: "ev1" } }), () => {}, second.t,
      { success: "x", undo: async () => ({ ok: true, view: ALLOWED }), run: () => false });
    second.click();
    expect(second.t.error).toHaveBeenCalledWith(m["contact.texts.undoBusy"]);
    void click;
  });
});

describe("the Texts row's words in Spanish (S-03 part 3 §10.1)", () => {
  it("how it stopped, and since when, in the reader's language (mutation: ignore the locale -> FAILS)", () => {
    expect(howLine({ kind: "staff" }, "es")).toBe("usted lo registró");
    expect(howLine({ kind: "keyword", word: "STOP" }, "es")).toBe("mandó STOP por texto");
    expect(howLine({ kind: "free_text", excerpt: "ya no", by: "Ana" }, "es")).toBe("escribió “ya no”, confirmado por Ana");
    expect(textsLine({ kind: "held", eventId: "h", since: "2026-10-03T15:00:00Z", excerpt: "remove me" }, "UTC", "es"))
      .toBe("Escribió “remove me”. Los textos están en pausa.");
    expect(textsLine({ kind: "stopped", eventId: "e", since: "2026-10-03T15:00:00Z", how: { kind: "carrier" }, canResume: false }, "UTC", "es"))
      .toMatch(/^Desde el .*2026 · la compañía telefónica lo bloqueó$/);
  });
  it("the status words (mutation: textsStatusWord ignores the locale -> FAILS)", () => {
    expect([textsStatusWord("allowed", "es"), textsStatusWord("stopped", "es"), textsStatusWord("held", "es")]).toEqual(["Permitido", "Detenido", "En pausa"]);
    expect(textsStatusWord("held", "en")).toBe("On hold");
  });
  it("the action's Undo and its crash line (mutation: keep m[\"common.undo\"] -> FAILS)", async () => {
    const toast = { success: vi.fn(), error: vi.fn() };
    await runTextsAction(async () => ({ ok: true, view: { kind: "allowed", newestId: null }, undo: { kind: "stop", eventId: "e1" } }), () => {}, toast,
      { success: "x", undo: async () => ({ ok: true, view: { kind: "allowed", newestId: null } }), locale: "es" });
    expect(toast.success.mock.calls[0]![1].action.label).toBe("Deshacer");
    await runTextsAction(async () => { throw new Error("stale action id"); }, () => {}, toast, { success: "x", locale: "es" });
    expect(toast.error).toHaveBeenLastCalledWith(m["inline.crashed.es"]);
  });
});
