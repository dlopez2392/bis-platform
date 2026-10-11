import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement } from "react";

/**
 * The editing branch has no DOM harness in apps/web, so InlineField is CALLED with React's hooks
 * captured: the first boolean state (editing) starts true, and the element it returns is read.
 */
// Reset before every render (beforeEach): a once-per-file flag would leave every case after the
// first rendering at rest, and the editing assertions would then read the wrong element.
const h = vi.hoisted(() => ({ firstBoolean: true, sets: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: (v: unknown) => ({ current: v }),
    useState: (init: unknown) => {
      const set = vi.fn();
      h.sets.push(set);
      if (init === false && h.firstBoolean) { h.firstBoolean = false; return [true, set]; }
      return [init, set];
    },
  };
});
const sets = h.sets;
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
const { InlineField } = await import("./inline-field");
const { Textarea } = await import("@/components/ui/textarea");
const { Input } = await import("@/components/ui/input");

const save = async () => ({ ok: true as const });
function editor(props: Record<string, unknown>) {
  const el = InlineField({ label: "How to get there", value: "Past the canal", save, rule: { kind: "text", max: 1000, required: false }, ...props } as never);
  if (!isValidElement(el)) throw new Error("no element");
  return el as ReactElement<Record<string, unknown>>;
}
beforeEach(() => { sets.length = 0; h.firstBoolean = true; });

describe("InlineField editing modes", () => {
  it("multiline edits in a Textarea where Enter is a new line, not a save (mutation: blur on Enter in the multiline arm -> FAILS)", () => {
    const el = editor({ inputType: "multiline" });
    expect(el.type).toBe(Textarea);
    const blur = vi.fn();
    (el.props.onKeyDown as (e: unknown) => void)({ key: "Enter", currentTarget: { blur } });
    expect(blur).not.toHaveBeenCalled();
  });
  it("Esc cancels a multiline edit without saving (mutation: drop `cancelled.current = true` from the multiline Esc -> FAILS)", () => {
    const spy = vi.fn(save);
    const el = editor({ inputType: "multiline", save: spy });
    expect(el.type).toBe(Textarea);
    const blur = vi.fn();
    (el.props.onKeyDown as (e: unknown) => void)({ key: "Escape", currentTarget: { blur } });
    expect(sets.some((s) => s.mock.calls.some(([v]) => v === false))).toBe(true); // editing set back to false
    // The blur that follows the Esc (the field leaving) must not save what was typed.
    (el.props.onBlur as (e: unknown) => void)({ currentTarget: { value: "Typed, then abandoned" } });
    expect(spy).not.toHaveBeenCalled();
  });
  it("a single-line field still saves on Enter (the existing behaviour)", () => {
    const el = editor({});
    expect(el.type).toBe(Input);
    const blur = vi.fn();
    (el.props.onKeyDown as (e: unknown) => void)({ key: "Enter", currentTarget: { blur } });
    expect(blur).toHaveBeenCalledTimes(1);
  });
  it("a date field is a native date input", () => {
    const el = editor({ inputType: "date", value: "2019-03-03", rule: { kind: "date", required: false } });
    expect(el.type).toBe(Input);
    expect(el.props.type).toBe("date");
  });
});

describe("InlineField's own chrome follows locale after a save", () => {
  it("a Spanish field's saved toast and its Undo are Spanish (mutation: drop locale from the inlineSavedView call, or read common.undo without it -> FAILS)", async () => {
    const { toast } = await import("sonner");
    const { m } = await import("@/lib/messages");
    vi.mocked(toast.success).mockClear();
    const el = editor({ inputType: "multiline", locale: "es", label: "Cómo llegar" });
    (el.props.onBlur as (e: unknown) => void)({ currentTarget: { value: "Pasando el canal" } });
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    const [message, opts] = vi.mocked(toast.success).mock.calls[0]! as [string, { action?: { label: string } }];
    expect(message).toBe(m["inline.saved.es"].replace("{label}", "Cómo llegar"));
    expect(opts.action?.label).toBe(m["common.undo.es"]);
  });
});

describe("InlineField's rule arm validates before it saves", () => {
  it("a value past the rule's limit is refused in the field's language and never reaches save (mutation: skip the rule branch in normalize -> FAILS)", async () => {
    const { toast } = await import("sonner");
    const { m } = await import("@/lib/messages");
    vi.mocked(toast.error).mockClear();
    const spy = vi.fn(save);
    const el = editor({ inputType: "multiline", locale: "es", save: spy, rule: { kind: "text", max: 5, required: false } });
    (el.props.onBlur as (e: unknown) => void)({ currentTarget: { value: "abcdef" } });
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(m["inline.rule.tooLong.es"].replace("{max}", "5"));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("InlineField's crash line follows locale", () => {
  it("a save that throws says so in the field's language (mutation: read inline.crashed without the locale -> FAILS)", async () => {
    const { toast } = await import("sonner");
    const { m } = await import("@/lib/messages");
    vi.mocked(toast.error).mockClear();
    const el = editor({ locale: "es", save: async () => { throw new Error("stale action"); } });
    (el.props.onBlur as (e: unknown) => void)({ currentTarget: { value: "Pasando el canal" } });
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(m["inline.crashed.es"]));
  });
});
