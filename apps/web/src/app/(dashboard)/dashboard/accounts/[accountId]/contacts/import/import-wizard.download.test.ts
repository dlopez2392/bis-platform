import { describe, it, expect, vi } from "vitest";

/**
 * Review fix round (M-2): import-wizard.tsx:76 passes `locale` into `mapRows`, whose own
 * locale-awareness is pinned directly in csv.test.ts — but nothing pinned that the WIZARD
 * itself threads it through on the path that matters: the downloaded skipped-rows CSV's own
 * reason text (downloadSkipped's Blob body), which renders nowhere in the visible HTML (only
 * the row COUNT does, via plural()) and so cannot be reached through renderToStaticMarkup's
 * string output alone.
 *
 * ImportWizard is called directly here (every hook it uses fully mocked — useState's INITIAL
 * value overridden by call index, in source order: phase(1), headers(2), rows(3), mapping(4),
 * createTags(5), fileError(6) — matching import-wizard.locale.test.ts's own documented order;
 * useMemo/useRef/useEffect reduced to their one-shot equivalents, safe since this file never
 * re-renders; useContext answers a controllable locale so useLocale() works with no real
 * Provider) to reach the download button's own onClick and inspect what it actually builds
 * (mutation: call mapRows(rows, mapping) with no locale at import-wizard.tsx:76 -> FAILS).
 */
const localeMock = { value: "es" as "en" | "es" };
let callIndex = 0;
let overrides: Record<number, unknown> = {};
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => {
      const idx = callIndex++;
      const initial = idx in overrides ? overrides[idx] : (typeof init === "function" ? (init as () => unknown)() : init);
      return [initial, vi.fn()];
    },
    useMemo: (fn: () => unknown) => fn(),
    useRef: (init: unknown) => ({ current: init }),
    useEffect: () => {},
    useContext: () => localeMock.value,
  };
});
vi.mock("@/lib/forms/use-form-submit", () => ({ useFormSubmit: () => ({ pending: false, onSubmit: () => {} }) }));

const { ImportWizard } = await import("./import-wizard");

type El = { type: unknown; props: Record<string, unknown> };
function isEl(n: unknown): n is El {
  return !!n && typeof n === "object" && "type" in (n as object);
}
function find(node: unknown, pred: (el: El) => boolean): El | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = find(n, pred);
      if (hit) return hit;
    }
    return null;
  }
  if (!isEl(node)) return null;
  const props = node.props ?? {};
  if (pred({ type: node.type, props })) return { type: node.type, props };
  if (typeof node.type === "function") return find((node.type as (p: unknown) => unknown)(props), pred);
  return find(props.children, pred);
}

function render() {
  callIndex = 0;
  return (ImportWizard as unknown as (p: unknown) => unknown)({ accountId: "a1", existingTags: [] });
}

describe("the downloaded skipped-rows CSV reads the reader's locale (review fix round, M-2)", () => {
  it("a Spanish reader's download carries the Spanish skip reason (mutation: call mapRows with no locale at import-wizard.tsx:76 -> FAILS)", () => {
    localeMock.value = "es";
    // phase(0): "map" so the download button renders. headers(1): one column. rows(2): one row
    // mapping nothing maps to — mapRows's own "no email or phone" rejection. mapping(3): the
    // header mapped to a field that is neither email nor phone, so the row still fails that check.
    overrides = {
      0: { name: "map" },
      1: ["Name"],
      2: [{ line: 2, values: { Name: "Ada" } }],
      3: { Name: "first_name" },
    };
    const blobParts: unknown[][] = [];
    class FakeBlob { constructor(parts: unknown[]) { blobParts.push(parts); } }
    const anchor = { href: "", download: "", click: vi.fn() };
    vi.stubGlobal("Blob", FakeBlob as unknown as typeof Blob);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() });
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor) });
    try {
      const tree = render();
      const downloadBtn = find(tree, (el) => el.type === "button" && el.props.type === "button" && typeof el.props.onClick === "function");
      expect(downloadBtn).not.toBeNull();
      (downloadBtn!.props.onClick as () => void)();
      expect(blobParts).toHaveLength(1);
      const body = String(blobParts[0]![0]);
      expect(body).toContain("sin correo ni teléfono");
      expect(body).not.toContain("no email or phone");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
