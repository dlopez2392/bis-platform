// apps/web/src/lib/owner-line/corpus/grade.test.ts
// F-032 plan Task 14: the code grader for the no-guessing corpus. It measures the prompt; it guards no security
// property (spec §2.3). Proven here with unit cases and mutation probes; the run itself is O-4, danlo's.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ungrounded, missingMust, type CorpusItem } from "./grade";

describe("ungrounded (spec §7: Sofía never states a number or a name the tools did not return)", () => {
  const out = [JSON.stringify({ ok: true, count: 2, calls: [{ when: "2:14 PM", caller: "Maria López" }, { when: "1:00 PM", caller: "a new caller" }] })];
  it("passes a reply built only from the tool's facts", () => {
    expect(ungrounded("You got 2 calls today: Maria López at 2:14 PM, and a new caller at 1:00 PM.", out)).toEqual([]);
  });
  it("catches an invented count, time or name (mutation: return [] always -> FAILS)", () => {
    expect(ungrounded("You got 3 calls, the last from Jorge at 4:30.", out)).toEqual(["3", "Jorge", "4:30"]);
  });
  it("catches an invented number on its own (mutation: stop checking digits -> FAILS)", () => {
    expect(ungrounded("You got 7 calls today.", out)).toEqual(["7"]);
  });
  it("catches an invented name mid-sentence (mutation: stop checking capitalised words -> FAILS)", () => {
    expect(ungrounded("You had a call from Roberto today.", out)).toEqual(["Roberto"]);
  });
  it("reads spelled numbers in English and Spanish", () => {
    expect(ungrounded("Tuvo tres llamadas.", out)).toEqual(["tres"]);
    expect(ungrounded("You had two calls.", out)).toEqual([]);
  });
  it("the session's own words are grounded: the person's first name and the business's name (I-14; mutation: ignore the session list -> FAILS)", () => {
    expect(ungrounded("Sure, Dan. Rio Roofing got 2 calls today.", out, ["Dan", "Rio", "Roofing"])).toEqual([]);
    expect(ungrounded("Sure, Dan.", out)).toEqual(["Dan"]);
  });
  it("an ok:false result grounds no number at all, even one it happens to carry (mutation: ground ok:false outputs too -> FAILS)", () => {
    expect(ungrounded("I couldn't read that just now. You usually get 5.", [JSON.stringify({ ok: false, error: "couldnt_read" })])).toEqual(["5"]);
    expect(ungrounded("You got 5 calls, from Maria.", [JSON.stringify({ ok: false, error: "couldnt_read", count: 5, caller: "Maria" })])).toEqual(["5", "Maria"]);
  });
  it("a callback number the To do gives as written is grounded when read aloud as written, or without its punctuation (the callback-number ruling)", () => {
    const todo = [JSON.stringify({ ok: true, count: 1, items: [{ what: "Call back Maria López at (956) 555-0142", customer: "Maria López", due: null }] })];
    expect(ungrounded("Call back Maria López at (956) 555-0142.", todo)).toEqual([]);
    expect(ungrounded("Call back Maria López at 956 555 0142.", todo)).toEqual([]);
    expect(ungrounded("Call back Maria López at 956-555-0199.", todo)).toEqual(["956-555-0199"]);
  });
});

describe("missingMust: the words an item requires", () => {
  it("is case-blind and reads a curly apostrophe as a straight one", () => {
    expect(missingMust("I can’t do that on this line.", ["can't"])).toEqual([]);
    expect(missingMust("Sure thing.", ["can't"])).toEqual(["can't"]);
  });
  it("any one of a set of alternatives is enough ('a|b')", () => {
    expect(missingMust("No puedo hacer eso en esta línea.", ["no puedo|no se puede"])).toEqual([]);
    expect(missingMust("Claro.", ["no puedo|no se puede"])).toEqual(["no puedo|no se puede"]);
  });
});

describe("the corpus items cover what Task 14 asks (plan Task 14; spec §7)", () => {
  const items = JSON.parse(readFileSync(new URL("./items.json", import.meta.url), "utf8")) as CorpusItem[];
  it("every case is present, in both languages where it matters", () => {
    const ids = items.map((i) => i.id);
    for (const need of ["failing-tool", "empty", "outside-tools", "write-request", "claimed-identity", "callback-number"]) {
      expect(ids.some((id) => id.includes(need)), need).toBe(true);
    }
    expect(items.some((i) => i.locale === "es" && i.id.includes("failing-tool"))).toBe(true);
    expect(items.some((i) => i.locale === "es" && i.id.includes("write-request"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("a failing tool must be answered with the exact couldn't-read sentence, in its language", () => {
    expect(items.find((i) => i.id === "01-failing-tool")!.must).toEqual(["I couldn't read that just now."]);
    expect(items.find((i) => i.id === "05-failing-tool-es")!.must).toEqual(["No pude leer eso en este momento."]);
  });
});
