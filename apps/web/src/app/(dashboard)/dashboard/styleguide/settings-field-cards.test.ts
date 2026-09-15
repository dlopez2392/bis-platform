import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source-text pin — same house convention alert-phone-card.test.ts documents
 * ("the house pattern for a component this repo has no render harness for").
 *
 * The defect this pins: AlertPhoneCard's agency "not ready" branch renders a
 * real `<Link href={`/dashboard/accounts/${accountId}/checklist`}>`, and
 * this demo hands it `accountId="demo"` — not a real account, so the link
 * this demo produces resolves to a route that does not exist. The
 * styleguide route itself has no accountId to hand it instead (`page.tsx`'s
 * own comment: "this route has no accountId"), so the fix stays inside this
 * demo — swallow the click before it can navigate anywhere, rather than
 * ship a dead link.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "settings-field-cards.tsx"), "utf8");

describe("SettingsFieldCards — the not-ready-to-send demo's Checklist link", () => {
  it("swallows the click on the agency not-ready demo rather than letting the Checklist link navigate to a nonexistent account (mutation: drop the click-swallow wrapper → FAILS)", () => {
    const labelIdx = src.indexOf('label="Agency — alert texts, not ready to send"');
    expect(labelIdx).toBeGreaterThan(-1);
    const nextDemoIdx = src.indexOf("<Demo label=", labelIdx + 1);
    const block = src.slice(labelIdx, nextDemoIdx === -1 ? undefined : nextDemoIdx);
    expect(block).toContain("onClickCapture");
    expect(block).toContain("preventDefault");
  });
});
