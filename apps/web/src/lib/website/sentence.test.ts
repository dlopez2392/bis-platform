import { describe, it, expect } from "vitest";
import { websiteSentence, type SentenceSegment } from "./sentence";

const text = (s: SentenceSegment[]) => s.map((x) => x.text).join("");
const strong = (s: SentenceSegment[]) => s.filter((x) => x.strong).map((x) => x.text);

const base = {
  period: 14 as const, visitors: 1284, priorVisitors: 1088,
  topSource: { name: "Google", visitors: 783, share: 0.61 }, runnerUpSourceShare: 0.22,
  topPage: { name: "Services", visitors: 412, share: 0.32 }, runnerUpPageShare: 0.20,
  topDevice: { name: "mobile", visitors: 911, share: 0.71 },
};

describe("websiteSentence", () => {
  it("the full sentence, with the bold fragments the mockup shows", () => {
    const s = websiteSentence(base);
    expect(text(s)).toBe("1,284 people visited your website, 18% more than the two weeks before. Most of them found you on Google, the page they read most was Services, and seven in ten were on a phone.");
    expect(strong(s)).toEqual(["1,284 people", "18% more", "Google", "Services"]);
  });
  // Mutation: change SAME_THRESHOLD to 0.5 — this case reads "1% more".
  it("under 5% change reads 'about the same as'", () => {
    expect(text(websiteSentence({ ...base, visitors: 1100, priorVisitors: 1088 })))
      .toMatch(/^1,100 people visited your website, about the same as the two weeks before\./);
  });
  it("fewer is fewer, and the period words follow the period", () => {
    expect(text(websiteSentence({ ...base, period: 7, visitors: 500, priorVisitors: 1000 }))).toContain("50% fewer than the week before");
    expect(text(websiteSentence({ ...base, period: 30 }))).toContain("than the month before");
  });
  // Mutation: change LEAD_MARGIN to 0 — the page clause appears in the first case.
  it("names the top page only with a 10-point lead over the runner-up; the top source likewise", () => {
    expect(text(websiteSentence({ ...base, runnerUpPageShare: 0.30 }))).not.toContain("the page they read most");
    expect(text(websiteSentence({ ...base, runnerUpPageShare: 0.20 }))).toContain("the page they read most was Services");
    expect(text(websiteSentence({ ...base, runnerUpSourceShare: 0.55 }))).not.toContain("found you on");
  });
  it("names a device only at 60% share, in tenths, and 'a computer' for desktop", () => {
    expect(text(websiteSentence({ ...base, topDevice: { name: "desktop", visitors: 1, share: 0.64 } }))).toContain("six in ten were on a computer");
    expect(text(websiteSentence({ ...base, topDevice: { name: "mobile", visitors: 1, share: 0.55 } }))).not.toContain("in ten");
    expect(text(websiteSentence({ ...base, topDevice: { name: "mobile", visitors: 1, share: 0.97 } }))).toContain("nearly all of them were on a phone");
  });
  // Mutation: change PLAIN_COUNT_BELOW to 2 — the 14-visitor case grows a percentage.
  it("under 20 visitors: the plain count and nothing else, so a tiny site never reads '200% more'", () => {
    expect(text(websiteSentence({ ...base, visitors: 14, priorVisitors: 3 }))).toBe("14 people visited your website in the last two weeks.");
    expect(text(websiteSentence({ ...base, visitors: 1, priorVisitors: 0 }))).toBe("1 person visited your website in the last two weeks.");
    expect(text(websiteSentence({ ...base, visitors: 0, priorVisitors: 0 }))).toBe("No one has visited your website in the last two weeks yet.");
  });
  it("a zero prior period never divides: it reads as a plain count too", () => {
    expect(text(websiteSentence({ ...base, visitors: 40, priorVisitors: 0 }))).toMatch(/^40 people visited your website in the last two weeks\./);
  });
  it("a Direct lead is never announced as 'found you on'", () => {
    expect(text(websiteSentence({ ...base, topSource: { name: "Direct", visitors: 700, share: 0.6 }, runnerUpSourceShare: 0.2 }))).not.toContain("found you on");
  });
});

// S-10 T2 (spec §3.1 row 13): the sentence panel is generated prose, not a
// catalogue read, and was English-only regardless of the reader's locale.
// `locale` is a new, optional third parameter (default "en") so every test
// above is byte-for-byte unaffected (mutation: drop the default → every
// existing call site above fails to compile).
describe("websiteSentence in Spanish (usted register, Valley trades Spanish)", () => {
  it("the full sentence, with the same bold fragments as the English mockup", () => {
    const s = websiteSentence(base, "es");
    expect(text(s)).toBe(
      "1,284 personas visitaron su sitio web, 18% más que en las dos semanas anteriores. "
      + "La mayoría llegó desde Google, la página que más leyeron fue Services y siete de cada diez usaron el celular.",
    );
    expect(strong(s)).toEqual(["1,284 personas", "18% más", "Google", "Services"]);
  });

  it("under 5% change reads 'casi igual que en'", () => {
    expect(text(websiteSentence({ ...base, visitors: 1100, priorVisitors: 1088 }, "es")))
      .toMatch(/^1,100 personas visitaron su sitio web, casi igual que en las dos semanas anteriores\./);
  });

  it("fewer is 'menos', and the period phrase follows the period", () => {
    expect(text(websiteSentence({ ...base, period: 7, visitors: 500, priorVisitors: 1000 }, "es")))
      .toContain("50% menos que en la semana anterior");
    expect(text(websiteSentence({ ...base, period: 30 }, "es"))).toContain("que en el mes anterior");
  });

  it("names the top page only with a 10-point lead over the runner-up; the top source likewise", () => {
    expect(text(websiteSentence({ ...base, runnerUpPageShare: 0.30 }, "es"))).not.toContain("la página que más leyeron");
    expect(text(websiteSentence({ ...base, runnerUpPageShare: 0.20 }, "es"))).toContain("la página que más leyeron fue Services");
    expect(text(websiteSentence({ ...base, runnerUpSourceShare: 0.55 }, "es"))).not.toContain("llegó desde");
  });

  it("names a device only at 60% share, in tenths ('de cada diez'), and 'la computadora' for desktop", () => {
    expect(text(websiteSentence({ ...base, topDevice: { name: "desktop", visitors: 1, share: 0.64 } }, "es"))).toContain("seis de cada diez usaron la computadora");
    expect(text(websiteSentence({ ...base, topDevice: { name: "mobile", visitors: 1, share: 0.55 } }, "es"))).not.toContain("de cada diez");
    expect(text(websiteSentence({ ...base, topDevice: { name: "mobile", visitors: 1, share: 0.97 } }, "es"))).toContain("casi todas usaron el celular");
  });

  // I-3 (review): channelOf's category names take an article in the
  // sentence ("desde las redes sociales", "desde otros sitios web"); brand
  // names (Google, Bing, ...) take none ("desde Google").
  it("channel category names take their article; brand names stay bare", () => {
    expect(text(websiteSentence({ ...base, topSource: { name: "Social", visitors: 783, share: 0.61 }, runnerUpSourceShare: 0.22 })))
      .toContain("Most of them found you on Social");
    expect(text(websiteSentence({ ...base, topSource: { name: "Social", visitors: 783, share: 0.61 }, runnerUpSourceShare: 0.22 }, "es")))
      .toContain("La mayoría llegó desde las redes sociales");
    expect(text(websiteSentence({ ...base, topSource: { name: "AI assistants", visitors: 783, share: 0.61 }, runnerUpSourceShare: 0.22 }, "es")))
      .toContain("La mayoría llegó desde los asistentes de IA");
    expect(text(websiteSentence({ ...base, topSource: { name: "Other websites", visitors: 783, share: 0.61 }, runnerUpSourceShare: 0.22 }, "es")))
      .toContain("La mayoría llegó desde otros sitios web");
    expect(text(websiteSentence(base, "es"))).toContain("La mayoría llegó desde Google");
  });

  it("under 20 visitors: the plain count and nothing else, with singular/plural agreement", () => {
    expect(text(websiteSentence({ ...base, visitors: 14, priorVisitors: 3 }, "es"))).toBe("14 personas visitaron su sitio web en las últimas dos semanas.");
    expect(text(websiteSentence({ ...base, visitors: 1, priorVisitors: 0 }, "es"))).toBe("1 persona visitó su sitio web en las últimas dos semanas.");
    expect(text(websiteSentence({ ...base, visitors: 0, priorVisitors: 0 }, "es"))).toBe("Todavía nadie ha visitado su sitio web en las últimas dos semanas.");
  });

  it("a zero prior period never divides: it reads as a plain count too", () => {
    expect(text(websiteSentence({ ...base, visitors: 40, priorVisitors: 0 }, "es")))
      .toMatch(/^40 personas visitaron su sitio web en las últimas dos semanas\./);
  });

  it("a Direct lead is never announced as 'llegó desde'", () => {
    expect(text(websiteSentence({ ...base, topSource: { name: "Direct", visitors: 700, share: 0.6 }, runnerUpSourceShare: 0.2 }, "es")))
      .not.toContain("llegó desde");
  });

  it("never switches to tú (usted everywhere): no bare tú-only word appears", () => {
    const TU = /\b(tu|tus|te|vos|visitaste)\b/i;
    expect(TU.test(text(websiteSentence(base, "es")))).toBe(false);
  });
});
