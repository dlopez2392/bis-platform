import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitNewDeal } from "./add-opportunity-dialog";
import { m } from "@/lib/messages";

// S-10 T3: the dialog's static JSX (the trigger, the title, the field labels, the Submit button) is
// read without a renderer, the same convention contacts/add-contact-dialog.test.ts already uses —
// called as a plain function so Radix's open/closed mounting never hides the content, with useState,
// useFormSubmit and useLocale stubbed so no real hook runs outside an actual render.
let states: { initial: unknown; set: ReturnType<typeof vi.fn> }[] = [];
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => {
      const initial = typeof init === "function" ? (init as () => unknown)() : init;
      const set = vi.fn();
      states.push({ initial, set });
      return [initial, set];
    },
  };
});
vi.mock("@/lib/forms/use-form-submit", () => ({ useFormSubmit: () => ({ pending: false, onSubmit: () => {} }) }));
let readerLocale: "en" | "es" = "en";
vi.mock("@/components/locale-provider", () => ({ useLocale: () => readerLocale }));
vi.mock("./deal-contact-picker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./deal-contact-picker")>();
  return { ...actual, DealContactPicker: () => null };
});

const { AddOpportunityDialog } = await import("./add-opportunity-dialog");

type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
const isEl = (x: unknown): x is El => typeof x === "object" && x !== null && "props" in x && "type" in x;
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  if (!isEl(node)) return out;
  out.push(node);
  walk(node.props.children, out);
  return out;
}
function words(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(words);
  return isEl(node) ? words(node.props.children) : [];
}
function mount() {
  states = [];
  return (AddOpportunityDialog as unknown as (p: unknown) => unknown)({ accountId: "a1", pipelineId: "p1", action: vi.fn() });
}

beforeEach(() => { readerLocale = "en"; });

describe("AddOpportunityDialog in the reader's language (S-10 T3)", () => {
  it("in Spanish, the trigger, the title and the field labels all read Spanish (mutation: read m[...] directly -> FAILS)", () => {
    readerLocale = "es";
    const all = words(mount());
    expect(all.filter((w) => w === m["pipeline.add.es"])).toHaveLength(2); // the trigger and the title
    expect(all).toContain(m["pipeline.contact.es"]);
    expect(all).toContain(m["pipeline.name.es"]);
    expect(all).toContain(m["pipeline.value.es"]);
    expect(all).not.toContain(m["pipeline.add"]);
    expect(all).not.toContain(m["pipeline.name"]);
  });
  it("in English, nothing changes", () => {
    const all = words(mount());
    expect(all).toContain(m["pipeline.add"]);
    expect(all).toContain(m["pipeline.name"]);
  });
  it("the Submit button is handed the dialog's own locale (mutation: hard-code en -> FAILS)", () => {
    readerLocale = "es";
    const submit = walk(mount()).find((el) => typeof el.type === "function" && (el.type as { name?: string }).name === "Submit");
    expect(submit?.props.locale).toBe("es");
  });
});

/**
 * The Add opportunity dialog's submit (review M1 of fix/batch-oct31): the dialog's hook hands every press to
 * `submitNewDeal`, a plain function, so "no customer chosen never reaches the action" is tested here without a
 * DOM. The action, the toast and the close are passed in.
 */
function deps() {
  return { action: vi.fn(async () => {}), notify: vi.fn(), close: vi.fn() };
}
function form(contactId: string) {
  const fd = new FormData();
  fd.set("contactId", contactId);
  fd.set("name", "Deck build");
  fd.set("pipelineId", "pipe1");
  return fd;
}

describe("submitNewDeal", () => {
  it("with no customer chosen it never calls the action, says why, and stays open (mutation: `const block = null` -> FAILS)", async () => {
    const d = deps();
    await submitNewDeal(form(""), d);
    expect(d.action).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledWith("Choose who this opportunity is for first.");
    expect(m["pipeline.contactRequired"]).toBe("Choose who this opportunity is for first.");
    expect(d.close).not.toHaveBeenCalled();
  });

  it("with a customer chosen it calls the action with the form, then closes, saying nothing", async () => {
    const d = deps();
    const fd = form("c1");
    await submitNewDeal(fd, d);
    expect(d.action).toHaveBeenCalledWith(fd);
    expect(d.close).toHaveBeenCalledTimes(1);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("a failed action says so and stays open", async () => {
    const d = deps();
    d.action.mockRejectedValueOnce(new Error("boom"));
    await submitNewDeal(form("c1"), d);
    expect(d.notify).toHaveBeenCalledWith(m["pipeline.createFailed"]);
    expect(d.close).not.toHaveBeenCalled();
  });
});

// S-10: the "choose a customer first" toast is said in the reader's language.
describe("submitNewDeal — in Spanish (S-10)", () => {
  it("says why in Spanish when the dialog's locale is es (mutation: notify m[block] → FAILS)", async () => {
    const d = { ...deps(), locale: "es" as const };
    await submitNewDeal(form(""), d);
    expect(d.notify).toHaveBeenCalledWith(m["pipeline.contactRequired.es"]);
  });
});
