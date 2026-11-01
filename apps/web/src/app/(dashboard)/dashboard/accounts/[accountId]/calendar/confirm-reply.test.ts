import { describe, it, expect } from "vitest";
import { CONFIRM_REPLY_TREATMENTS, confirmReplyLabel } from "./confirm-reply";

/**
 * S-10 review M-5: the real client call sites (agenda-day.tsx's `row.confirmWord`, job-drawer.tsx's own
 * `makeTr(locale, pseudo).text(...)`) never read a `label` off `CONFIRM_REPLY_TREATMENTS` at all — only
 * `.chip`/`.dot`. The module-level English `label` this carried was therefore dead code outside the
 * styleguide's own demo, and a G3 violation with no real fix available (an English-locked label on a
 * module nothing agency-only reaches, so it cannot be exempted either). Dropped; the styleguide demo
 * gets its label from this function instead.
 */
describe("CONFIRM_REPLY_TREATMENTS (S-10 review M-5)", () => {
  it("carries chip and dot only, no module-level English label (mutation: add label back -> FAILS)", () => {
    expect(CONFIRM_REPLY_TREATMENTS.yes).not.toHaveProperty("label");
    expect(CONFIRM_REPLY_TREATMENTS.no).not.toHaveProperty("label");
    expect(Object.keys(CONFIRM_REPLY_TREATMENTS.yes).sort()).toEqual(["chip", "dot"]);
  });
});

describe("confirmReplyLabel (S-10 review M-5)", () => {
  it("translates yes/no in both locales (mutation: hard-code English -> FAILS)", () => {
    expect(confirmReplyLabel("yes", "en")).toBe("Confirmed by text");
    expect(confirmReplyLabel("yes", "es")).toBe("Confirmó por mensaje");
    expect(confirmReplyLabel("no", "en")).toBe("Asked for a different time");
    expect(confirmReplyLabel("no", "es")).toBe("Pidió otro horario");
  });
});
