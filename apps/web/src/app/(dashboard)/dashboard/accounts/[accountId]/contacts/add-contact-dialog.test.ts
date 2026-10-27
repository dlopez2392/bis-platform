import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreateContactResult } from "./actions";

// D-013: a dedupe match must say so plainly and link to the existing
// contact instead of closing the dialog silently (same symptom this fixes).
// No DOM renderer in apps/web (contact-drawer.wiring.test.ts's own
// convention) — rather than walk Dialog/DialogContent's Radix internals to
// reach the <form>, `useFormSubmit`'s own `run` callback is captured
// directly: it IS the submit handler's real body, fully formed before any
// JSX renders, so calling it straight is the SAME code a real submit would
// run, with none of Radix's render machinery in the way.
let capturedRun: ((formData: FormData, form: HTMLFormElement) => Promise<void>) | null = null;
vi.mock("@/lib/forms/use-form-submit", () => ({
  useFormSubmit: (run: (formData: FormData, form: HTMLFormElement) => Promise<void>) => {
    capturedRun = run;
    return { pending: false, onSubmit: () => {} };
  },
}));

type StateEntry = { initial: unknown; set: ReturnType<typeof vi.fn> };
let states: StateEntry[] = [];
// When set, the existing-contact state (initial null) reads this id instead,
// so the dedupe Notice is part of the returned tree.
let existingOverride: string | null = null;
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => {
      const initial = typeof init === "function" ? (init as () => unknown)() : init;
      const set = vi.fn();
      states.push({ initial, set });
      return [initial === null && existingOverride ? existingOverride : initial, set];
    },
  };
});

// The component is called as a plain function below (no renderer), so the
// LocaleProvider context cannot reach it: useLocale is stubbed to the
// reader's language under test instead.
let readerLocale: "en" | "es" = "en";
vi.mock("@/components/locale-provider", () => ({ useLocale: () => readerLocale }));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

const { AddContactDialog } = await import("./add-contact-dialog");
const { DialogContent } = await import("@/components/ui/dialog");
const { m } = await import("@/lib/messages");

function mount(action: (formData: FormData) => Promise<CreateContactResult>) {
  states = [];
  capturedRun = null;
  const tree = (AddContactDialog as unknown as (p: unknown) => unknown)({ accountId: "a1", action });
  if (!capturedRun) throw new Error("useFormSubmit's run callback was never captured");
  return {
    tree,
    openState: states.find((s) => s.initial === false)!,
    existingState: states.find((s) => s.initial === null)!,
  };
}

type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
const isEl = (x: unknown): x is El => typeof x === "object" && x !== null && "props" in x && "type" in x;
/** Every element in the returned tree, depth first — the component's own JSX, never rendered. */
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  if (!isEl(node)) return out;
  out.push(node);
  walk(node.props.children, out);
  return out;
}
/** Every string leaf in the tree: the words the dialog would show. */
function words(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(words);
  return isEl(node) ? words(node.props.children) : [];
}

const emptyForm = () => new FormData();
const fakeFormEl = {} as HTMLFormElement;

beforeEach(() => {
  toastError.mockReset();
  readerLocale = "en";
  existingOverride = null;
});

describe("AddContactDialog (D-013)", () => {
  it("on an 'existing' result, sets the existing-contact id and does NOT close the dialog (mutation: close on existing too → FAILS)", async () => {
    const action = vi.fn(async (): Promise<CreateContactResult> => ({ kind: "existing", contactId: "c9" }));
    const { openState, existingState } = mount(action);
    await capturedRun!(emptyForm(), fakeFormEl);
    expect(existingState.set).toHaveBeenCalledWith("c9");
    expect(openState.set).not.toHaveBeenCalledWith(false);
  });

  it("on an 'invalid' result, toasts the error and does NOT close the dialog (mutation: close on invalid too → FAILS)", async () => {
    const action = vi.fn(async (): Promise<CreateContactResult> => ({ kind: "invalid", error: "nope" }));
    const { openState } = mount(action);
    await capturedRun!(emptyForm(), fakeFormEl);
    expect(toastError).toHaveBeenCalledWith("nope");
    expect(openState.set).not.toHaveBeenCalledWith(false);
  });

  it("on a 'created' result, closes the dialog and clears any prior existing-contact state", async () => {
    const action = vi.fn(async (): Promise<CreateContactResult> => ({ kind: "created" }));
    const { openState, existingState } = mount(action);
    await capturedRun!(emptyForm(), fakeFormEl);
    expect(openState.set).toHaveBeenCalledWith(false);
    expect(existingState.set).toHaveBeenCalledWith(null);
  });

  it("a thrown action toasts the generic crashed message and does not close", async () => {
    const action = vi.fn(async (): Promise<CreateContactResult> => { throw new Error("boom"); });
    const { openState } = mount(action);
    await capturedRun!(emptyForm(), fakeFormEl);
    expect(toastError).toHaveBeenCalledWith(m["contacts.createFailed"]);
    expect(openState.set).not.toHaveBeenCalledWith(false);
  });
});

// F-085 follow-ups (design I1 / final I2): the button, the dialog and every
// word inside it read the list's own language. Spanish is pinned to the
// literal words, never t()'s output (a missing twin falls back to English
// silently).
describe("AddContactDialog in the reader's language (F-085 follow-ups)", () => {
  it("in Spanish, the button, the title, the labels, the dedupe line and its link all read Spanish (mutation: read m[\"contacts.add\"] directly -> FAILS)", () => {
    readerLocale = "es";
    existingOverride = "c9";
    const { tree } = mount(vi.fn());
    const all = words(tree);
    expect(all.filter((w) => w === "Agregar contacto")).toHaveLength(2); // the trigger and the title
    for (const w of ["Nombre", "Apellido", "Correo", "Teléfono", "Esta persona ya está en sus contactos.", "Ver contacto"]) {
      expect(all, w).toContain(w);
    }
    expect(all).not.toContain(m["contacts.add"]);
    expect(all).not.toContain(m["contacts.add.existing"]);
    // Save/Saving live in the Submit leaf (not expanded by this walk): it is handed the same locale.
    const submit = walk(tree).find((el) => typeof el.type === "function" && el.type.name === "Submit");
    expect(submit?.props.locale).toBe("es");
  });

  it("the dialog's content, portaled out of the list's lang wrapper, carries lang itself (mutation: drop lang={locale} -> FAILS)", () => {
    readerLocale = "es";
    const content = walk(mount(vi.fn()).tree).filter((el) => el.type === DialogContent);
    expect(content).toHaveLength(1);
    expect(content[0]!.props.lang).toBe("es");
    expect(content[0]!.props.closeLabel).toBe("Cerrar");
  });

  it("in English, nothing changes", () => {
    existingOverride = "c9";
    const { tree } = mount(vi.fn());
    const all = words(tree);
    expect(all).toContain(m["contacts.add"]);
    expect(all).toContain(m["contacts.add.existing"]);
    expect(walk(tree).find((el) => el.type === DialogContent)!.props.lang).toBe("en");
  });

  it("a thrown action toasts the reader's language (mutation: toast m[\"contacts.createFailed\"] regardless -> FAILS)", async () => {
    readerLocale = "es";
    mount(vi.fn(async (): Promise<CreateContactResult> => { throw new Error("boom"); }));
    await capturedRun!(emptyForm(), fakeFormEl);
    expect(toastError).toHaveBeenCalledWith("No se pudo agregar ese contacto. Revise los datos e intente de nuevo.");
  });
});
