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

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

const { AddContactDialog } = await import("./add-contact-dialog");
const { m } = await import("@/lib/messages");

function mount(action: (formData: FormData) => Promise<CreateContactResult>) {
  states = [];
  capturedRun = null;
  (AddContactDialog as unknown as (p: unknown) => unknown)({ accountId: "a1", action });
  if (!capturedRun) throw new Error("useFormSubmit's run callback was never captured");
  return {
    openState: states.find((s) => s.initial === false)!,
    existingState: states.find((s) => s.initial === null)!,
  };
}

const emptyForm = () => new FormData();
const fakeFormEl = {} as HTMLFormElement;

beforeEach(() => {
  toastError.mockReset();
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
