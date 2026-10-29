import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AGENCY_VISIT_REASONS, type AgencyVisitReason } from "@bis/db";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { LocaleProvider } from "@/components/locale-provider";
import type { VisitRowView } from "@/lib/access-log/view";
import { ReasonTiles } from "./reason-tiles";
import { BisAccessFrame } from "./bis-access-frame";
import { BisAccessList } from "./bis-access-list";
import { BisAccessSkeleton } from "./bis-access-skeleton";
import { BisAccessError } from "./bis-access-error";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/**
 * F-118 part 1 (plan Task 4, step 4). `renderToStaticMarkup`+`createElement` (the `account-name-fields
 * .test.ts:2-3,28` shape), inside `LocaleProvider` for the client components, and `renderedText` to read
 * past React's entity-escaping (apostrophes).
 */

const REASON_LABEL: Record<AgencyVisitReason, string> = {
  setup: m["accessLog.reason.setup"], support: m["accessLog.reason.support"],
  fix: m["accessLog.reason.fix"], billing: m["accessLog.reason.billing"],
};
const OPTIONS = AGENCY_VISIT_REASONS.map((value) => ({ value, label: REASON_LABEL[value] }));

describe("ReasonTiles (server-safe, no \"use client\")", () => {
  const html = renderToStaticMarkup(createElement(ReasonTiles, { legend: m["accessLog.enter.legend"], options: OPTIONS }));

  it("renders exactly the four reasons, in order, as submit buttons named 'reason' (mutation: type=\"button\" -> FAILS)", () => {
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((x) => x[0]);
    expect(buttons).toHaveLength(4);
    for (const b of buttons) {
      expect(b).toMatch(/type="submit"/);
      expect(b).toMatch(/name="reason"/);
    }
    expect(buttons.map((b) => /value="([^"]+)"/.exec(b)?.[1])).toEqual([...AGENCY_VISIT_REASONS]);
    expect(html).toContain("<legend");
    expect(renderedText(html)).toContain(m["accessLog.enter.legend"]);
  });

  it("carries no element using the primary variant's class (rule 8: a choice of four, no default)", () => {
    expect(html).not.toContain("bg-primary");
  });
});

describe("BisAccessFrame", () => {
  function render(locale: "en" | "es") {
    return renderToStaticMarkup(createElement(LocaleProvider, { locale } as Parameters<typeof LocaleProvider>[0],
      createElement(BisAccessFrame, null, createElement("p", { "data-testid": "frame-child" }, "child content"))));
  }

  it("renders the section id, title, intro and all three disclosure notes in English", () => {
    const html = render("en");
    expect(html).toContain('id="bis-access"');
    const text = renderedText(html);
    expect(text).toContain(m["accessLog.title"]);
    expect(text).toContain(m["accessLog.intro"]);
    expect(text).toContain(m["accessLog.note.automatic"]);
    expect(text).toContain(m["accessLog.note.lists"]);
    expect(text).toContain(m["accessLog.note.agencyLists"]);
    expect(text).toContain("child content");
  });

  it("renders all three disclosure notes in Spanish too (mutation: drop the agency-lists note (ruling 3) -> FAILS in both languages; drop the lists note (I5) -> FAILS in both languages)", () => {
    const html = render("es");
    const text = renderedText(html);
    expect(text).toContain(m["accessLog.title.es"]);
    expect(text).toContain(m["accessLog.intro.es"]);
    expect(text).toContain(m["accessLog.note.automatic.es"]);
    expect(text).toContain(m["accessLog.note.lists.es"]);
    expect(text).toContain(m["accessLog.note.agencyLists.es"]);
  });
});

const ROWS: VisitRowView[] = [
  {
    id: "visit_1", label: "Dan Lopez · Support request", when: "Oct 29, 2026, 2:10 PM–2:25 PM",
    summary: "Opened 1 customer.",
    items: [
      { key: "contact-c1", text: "Customer · Maria Lopez", href: "/dashboard/accounts/A1/contacts/c1" },
      { key: "contact-c2", text: "A customer who was later deleted", href: null },
    ],
    more: "and 3 more",
  },
  {
    id: "visit_2", label: "Someone at BIS · Fixing a problem", when: "Oct 27, 2026, 9:02 AM",
    summary: "Didn't open any customer, call, conversation or file.",
    items: [], more: null,
  },
];

describe("BisAccessList", () => {
  const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "en" } as Parameters<typeof LocaleProvider>[0], createElement(BisAccessList, { rows: ROWS })));
  const block1 = html.slice(html.indexOf('data-bis-access-visit="visit_1"'), html.indexOf('data-bis-access-visit="visit_2"'));
  const block2 = html.slice(html.indexOf('data-bis-access-visit="visit_2"'));

  it("renders each visit keyed by data-bis-access-visit, its label, its tabular-nums when, and its summary", () => {
    expect(html).toContain('data-bis-access-visit="visit_1"');
    expect(html).toContain('data-bis-access-visit="visit_2"');
    const text = renderedText(html);
    expect(text).toContain("Dan Lopez");
    expect(text).toContain("Support request");
    expect(text).toContain("Oct 29, 2026, 2:10 PM–2:25 PM");
    expect(text).toContain("Opened 1 customer.");
    expect(block1).toMatch(/<[a-z]+[^>]*tabular-nums[^>]*>Oct 29, 2026, 2:10 PM–2:25 PM</);
  });

  it("a row with items gets a ghost toggle naming the items list (collapsed by default), a link for a linked item, plain text for a gone one, and the 'more' line (mutation: drop aria-controls or aria-expanded -> FAILS)", () => {
    expect(block1).toMatch(/aria-expanded="false"/);
    expect(block1).toMatch(/data-variant="ghost"/);
    const controls = /aria-controls="([^"]+)"/.exec(block1)?.[1];
    expect(controls).toBeTruthy();
    const listOpenTag = new RegExp(`<[a-zA-Z]+[^>]*id="${controls}"[^>]*>`).exec(block1)?.[0];
    expect(listOpenTag).toContain("hidden");
    expect(block1).toMatch(/<a[^>]*href="\/dashboard\/accounts\/A1\/contacts\/c1"/);
    expect(block1).toContain("A customer who was later deleted");
    expect(renderedText(block1)).toContain("and 3 more");
  });

  it("a row with no items renders no toggle button at all (mutation: always render the button -> FAILS)", () => {
    expect(block2).not.toContain("<button");
  });
});

describe("BisAccessSkeleton", () => {
  const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "en" } as Parameters<typeof LocaleProvider>[0], createElement(BisAccessSkeleton)));

  it("renders three row skeletons and the sr-only loading text", () => {
    expect((html.match(/data-slot="skeleton"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(renderedText(html)).toContain(m["accessLog.loading"]);
  });

  it("renders no spinner (mutation: add a spinner element -> FAILS)", () => {
    expect(html).not.toMatch(/animate-spin|role="progressbar"/);
  });
});

describe("BisAccessError", () => {
  const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "en" } as Parameters<typeof LocaleProvider>[0], createElement(BisAccessError)));

  it("renders the error sentence and a ghost Try again button", () => {
    const text = renderedText(html);
    expect(text).toContain(m["accessLog.error"]);
    expect(text).toContain(m["accessLog.retry"]);
    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).toMatch(/data-variant="ghost"/);
  });
});
