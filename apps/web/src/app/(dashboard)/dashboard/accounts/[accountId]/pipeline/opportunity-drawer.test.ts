import { describe, it, expect, vi, beforeEach } from "vitest";
import { m } from "@/lib/messages";

// S-10 T3: the drawer's static JSX (the field labels, the status options, the Submit button) is
// read without a renderer, the same plain-function-and-walk convention
// contacts/add-contact-dialog.test.ts uses for a dialog whose content Radix would otherwise hide
// behind its own open/closed mounting.
vi.mock("@/lib/forms/use-form-submit", () => ({ useFormSubmit: () => ({ pending: false, onSubmit: () => {} }) }));
let readerLocale: "en" | "es" = "en";
vi.mock("@/components/locale-provider", () => ({ useLocale: () => readerLocale }));

const { OpportunityDrawer } = await import("./opportunity-drawer");

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

const OPP = { id: "o1", name: "Deck build", monetary_value: 500, status: "open", contact: { id: "c1", first_name: "Maria", last_name: "Garcia" } };
function mount() {
  return (OpportunityDrawer as unknown as (p: unknown) => unknown)({ opportunity: OPP, onClose: vi.fn(), action: vi.fn() });
}

beforeEach(() => { readerLocale = "en"; });

describe("OpportunityDrawer in the reader's language (S-10 T3)", () => {
  it("in Spanish, the field labels and status options all read Spanish (mutation: read m[...] directly -> FAILS)", () => {
    readerLocale = "es";
    const all = words(mount());
    expect(all).toContain(m["pipeline.name.es"]);
    expect(all).toContain(m["pipeline.value.es"]);
    expect(all).toContain(m["pipeline.status.es"]);
    expect(all).toContain(m["pipeline.status.open.es"]);
    expect(all).toContain(m["pipeline.status.won.es"]);
    expect(all).toContain(m["pipeline.status.lost.es"]);
    expect(all).not.toContain(m["pipeline.name"]);
    expect(all).not.toContain(m["pipeline.status.open"]);
  });
  it("in English, nothing changes", () => {
    const all = words(mount());
    expect(all).toContain(m["pipeline.name"]);
    expect(all).toContain(m["pipeline.status.open"]);
  });
  it("the Submit button is handed the drawer's own locale (mutation: hard-code en -> FAILS)", () => {
    readerLocale = "es";
    const submit = walk(mount()).find((el) => typeof el.type === "function" && (el.type as { name?: string }).name === "Submit");
    expect(submit?.props.locale).toBe("es");
  });
});
