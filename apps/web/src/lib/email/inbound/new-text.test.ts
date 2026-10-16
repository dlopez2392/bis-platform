import { describe, it, expect } from "vitest";
import { newText, htmlToText } from "./new-text";

describe("newText: the reply without its quoted history (spec Inbound step 5)", () => {
  it("cuts at Gmail's English marker, on one or two lines (mutation: drop the 'On … wrote:' rule → the quote stays, FAILS)", () => {
    expect(newText("Sounds good, see you then.\n\nOn Tue, Oct 14, 2026 at 3:00 PM Rio Roofing <crm@bis-rgv.com> wrote:\n> Your appointment is at 3.")).toBe("Sounds good, see you then.");
    expect(newText("Yes\n\nOn Tue, Oct 14, 2026 at 3:00 PM Rio Roofing <\ncrm@bis-rgv.com> wrote:\n> x")).toBe("Yes");
  });

  it("cuts at the Spanish marker (mutation: drop 'El … escribió:' → FAILS)", () => {
    expect(newText("Sí, ahí estaré.\n\nEl mar, 14 oct 2026 a las 15:00, Rio Roofing (<crm@bis-rgv.com>) escribió:\n> Su cita es a las 3.")).toBe("Sí, ahí estaré.");
  });

  it("drops '>' lines and cuts at Outlook's From: block, English and Spanish (mutation: drop the Outlook rule → FAILS)", () => {
    expect(newText("Thanks!\n> old line\n> older")).toBe("Thanks!");
    expect(newText("Ok\r\n\r\n________________________________\r\nFrom: Rio Roofing <crm@bis-rgv.com>\r\nSent: Tuesday\r\nSubject: Hi")).toBe("Ok");
    expect(newText("Vale\n\nDe: Rio Roofing <crm@bis-rgv.com>\nEnviado: martes\nAsunto: Hola")).toBe("Vale");
    expect(newText("Vale\n\n-----Original Message-----\nFrom: x")).toBe("Vale");
  });

  it("keeps a body that only mentions 'from' mid-sentence, and an empty reply stays empty (mutation: cut at any 'From' → FAILS)", () => {
    expect(newText("I got a quote from: Bob's.\nCan you beat it?")).toBe("I got a quote from: Bob's.\nCan you beat it?");
    expect(newText("> only a quote")).toBe("");
  });

  // M5: the Outlook From:/De: block marker must look like an address line
  // (an '@' or '<'), or ordinary prose that happens to start "De:"/"Para:"
  // gets cut as if it were a quoted thread.
  it("does not cut a 'De:'/'Para:' line with no address on it (mutation: drop the address-like check → FAILS)", () => {
    expect(newText("De: mi jefe me dijo\nPara: mañana\nok")).toBe("De: mi jefe me dijo\nPara: mañana\nok");
  });
});

describe("htmlToText (G11)", () => {
  // M6: blockquote and table close tags must also end a block, or two
  // adjacent block elements run together with no line break at all.
  it("treats </blockquote> and </table> as block ends too (mutation: drop them from the block-end list → 'oldnew' runs together, FAILS)", () => {
    expect(htmlToText("<blockquote>old</blockquote>new")).toBe("old\nnew");
  });
});

describe("htmlToText (G11)", () => {
  it("drops tags, turns br and block ends into line breaks, decodes the five entities (mutation: skip &amp; → FAILS)", () => {
    expect(htmlToText("<div>Hi &amp; thanks<br>See you</div><p>Ana &lt;3 &quot;x&quot; &#39;y&#39;</p><style>p{}</style>")).toBe("Hi & thanks\nSee you\nAna <3 \"x\" 'y'");
  });
});
