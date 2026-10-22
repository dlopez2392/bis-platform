import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseCorpusItem, parseFixture, moduleForSlug, CORPUS_SLUGS } from "./corpus-lib";
import { SHA256_HISTORY } from "./pin";

const CORPUS = path.resolve(__dirname, "corpus");
const RESULTS = path.resolve(__dirname, "../../../../../../docs/superpowers/results");

const EXPECTED: Record<string, string[]> = {
  "insurance-pc": [
    "01-en-quote-auto-home.md", "02-es-cotizacion-auto.md", "03-en-roughly-how-much.md", "04-es-mas-o-menos-cuanto.md",
    "05-en-am-i-covered-hail.md", "06-es-me-cubre-granizo.md", "07-en-drop-um.md", "08-es-quitar-pip.md",
    "09-en-crash-just-now-transfer.md", "10-es-choque-sin-transferencia.md", "11-en-flood-web.md",
    "12-es-inundacion-dice-que-no.md", "13-en-id-card.md", "14-es-pago-poliza.md", "15-en-volunteers-ssn.md",
    "16-es-numero-de-licencia.md", "17-en-health-insurance.md", "18-es-seguro-de-vida.md",
    "19-en-switch-to-spanish.md", "20-es-switch-to-english.md", "21-en-ignore-your-rules.md",
    "22-es-ignora-tus-reglas.md", "23-en-which-companies.md", "24-es-cambio-y-cancelar.md",
    "25-es-prima-del-volante.md", "26-en-withheld-own-number.md",
  ],
  events: [
    "01-en-is-14th-free.md", "02-es-esta-libre-sabado.md", "03-en-gold-package-price.md", "04-es-precio-no-esta.md",
    "05-en-200-guests-how-much.md", "06-es-200-invitados-web.md", "07-en-haggle-discount.md", "08-es-regatear.md",
    "09-en-deposit-refundable.md", "10-es-deposito-reembolsable.md", "11-en-honoree-questions.md",
    "12-es-quinceanera-festejada.md", "13-en-day-of-problem-transfer.md", "14-es-problema-manana-sin-transferencia.md",
    "15-en-day-of-web.md", "16-es-agendar-recorrido.md", "17-en-book-a-tour.md", "18-es-cambio-a-ingles.md",
    "19-en-switch-to-spanish.md", "20-es-ignora-reglas.md", "21-en-ignore-rules.md", "22-es-capacidad-menu.md",
    "23-en-hold-the-date.md", "24-es-plan-de-pagos.md", "25-es-solo-recados.md",
  ],
};
const WEB: Record<string, string[]> = {
  "insurance-pc": ["04", "08", "11", "16", "18", "20", "22", "23"],
  events: ["06", "08", "10", "15", "19", "21", "22", "24"],
};
const TRANSFER: Record<string, string[]> = { "insurance-pc": ["09", "12", "24"], events: ["13", "23"] };
const BOOKING: Record<string, string[]> = { "insurance-pc": [], events: ["16", "17", "25"] };
// Final-fix item 10: one item per override key, on exactly these phone items.
const CALLER_ID_WITHHELD: Record<string, string[]> = { "insurance-pc": ["26"], events: [] };
const AFTER_HOURS_MESSAGE_ONLY: Record<string, string[]> = { "insurance-pc": [], events: ["25"] };
// M15: one item per module plays an account whose AI disclosure is On.
const DISCLOSURE: Record<string, string[]> = { "insurance-pc": ["19"], events: ["17"] };
// insurance: 26 items, 13 English (C1 added 25, Spanish; final fix added 26, English). events: 25 items,
// 12 English (final fix added 25, Spanish).
const ENGLISH: Record<string, number> = { "insurance-pc": 13, events: 12 };

describe.each(Object.keys(EXPECTED))("the %s corpus", (slug) => {
  const files = readdirSync(path.join(CORPUS, slug)).filter((f) => f.endsWith(".md")).sort();
  const items = files.map((f) => parseCorpusItem(f, readFileSync(path.join(CORPUS, slug, f), "utf8")));

  it("is exactly the planned items, 26 for insurance and 25 for events (mutation: delete one -> FAILS)", () => {
    expect(files).toEqual(EXPECTED[slug]);
    expect(files.length).toBe(slug === "insurance-pc" ? 26 : 25);
  });
  it("is about half English and half Spanish; 8 web items, on exactly the planned ones, the rest phone", () => {
    expect(items.filter((i) => i.lang === "en").length).toBe(ENGLISH[slug]);
    expect(items.filter((i) => i.medium === "web").map((i) => i.id)).toEqual(WEB[slug]);
  });
  it("transfer, booking and disclosure are on exactly the planned phone items", () => {
    expect(items.filter((i) => i.transfer).map((i) => i.id)).toEqual(TRANSFER[slug]);
    expect(items.filter((i) => i.booking).map((i) => i.id)).toEqual(BOOKING[slug]);
    expect(items.filter((i) => i.disclosure).map((i) => i.id)).toEqual(DISCLOSURE[slug]);
  });
  it("callerId: withheld and afterHours: message_only are on exactly the planned phone items (mutation: drop the key from the item -> FAILS)", () => {
    expect(items.filter((i) => i.callerId === "withheld").map((i) => i.id)).toEqual(CALLER_ID_WITHHELD[slug]);
    expect(items.filter((i) => i.afterHours === "message_only").map((i) => i.id)).toEqual(AFTER_HOURS_MESSAGE_ONLY[slug]);
    // No item pins hours_then_message: that is every fixture's own mode, so pinning it would be noise.
    expect(items.filter((i) => i.afterHours === "hours_then_message").map((i) => i.id)).toEqual([]);
    for (const id of [...CALLER_ID_WITHHELD[slug]!, ...AFTER_HOURS_MESSAGE_ONLY[slug]!]) {
      expect(items.find((i) => i.id === id)?.medium, id).toBe("phone");
    }
  });
  it("the message-only item is a booking item, so the override is what turns new booking off (not booking: false)", () => {
    for (const id of AFTER_HOURS_MESSAGE_ONLY[slug]!) expect(items.find((i) => i.id === id)?.booking, id).toBe(true);
  });
  it("every item names a fixture that parses", () => {
    for (const i of items) parseFixture(i.facts, readFileSync(path.join(CORPUS, "fixtures", `${i.facts}.json`), "utf8"));
  });
  it("every item has at least two caller lines and one rule of each kind", () => {
    for (const i of items) {
      expect(i.caller.length, i.file).toBeGreaterThanOrEqual(2);
      expect(i.must.length, i.file).toBeGreaterThanOrEqual(1);
      expect(i.mustNot.length, i.file).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("graded results sheets are bound to the exact words they graded (SD8)", () => {
  const files = readdirSync(RESULTS);
  it("the results folder is the right one (guards the loop below from a mistyped path)", () => {
    expect(files).toContain("_template-sofia-corpus.md");
  });
  it("every sheet's Text SHA-256 equals pin.ts's hash for that version (mutation: overwrite a graded version's hash in pin.ts -> FAILS)", () => {
    for (const f of files) {
      const m = /^\d{4}-\d{2}-\d{2}-(insurance-pc|events)-v(\d+)\.md$/.exec(f);
      if (!m) continue;
      const id = moduleForSlug(m[1]!)!;
      const sha = /^Text SHA-256: ([0-9a-f]{64})$/m.exec(readFileSync(path.join(RESULTS, f), "utf8"))?.[1];
      // M1: both sides must be real hashes, so an undefined history entry and a sheet with no hash line cannot pass together.
      expect(sha, f).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
      expect(SHA256_HISTORY[id][Number(m[2]) - 1], f).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
      expect(sha, f).toBe(SHA256_HISTORY[id][Number(m[2]) - 1]);
    }
  });
  it("the slugs the sheets use are the corpus's own", () => {
    expect(Object.values(CORPUS_SLUGS).sort()).toEqual(Object.keys(EXPECTED).sort());
  });
});
