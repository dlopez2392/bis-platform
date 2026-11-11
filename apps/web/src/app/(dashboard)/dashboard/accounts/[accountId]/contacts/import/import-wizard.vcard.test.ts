import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "import-wizard.tsx"), "utf8");

describe("the file step accepts a .vcf, by source (import-wizard.test.ts's own style)", () => {
  it("the file input's accept attribute lists .vcf alongside .csv (mutation: drop .vcf from accept -> FAILS)", () => {
    expect(src).toMatch(/accept="\.csv,text\/csv,\.vcf,text\/vcard,text\/x-vcard"/);
  });

  // Fix round M-6: the source-scan "detects a vCard... never by file.type
  // alone" and "guards the file size before reading..." tests that used to
  // sit here were dropped — each only checked that an identifier appeared
  // in the source, which cannot prove detection or the guard actually WORK.
  // Both claims have real behavioural coverage below instead (the
  // .csv-named-but-vCard-content test for detection, the one-byte-over-the-
  // ceiling test for the size guard).
  it("parses a vCard with parseVCardText and pre-maps its columns with vCardContactsToRows, never trusting a raw upload", () => {
    expect(src).toContain("parseVCardText");
    expect(src).toContain("vCardContactsToRows");
  });
});

/**
 * Drives the real onFile handler through the rendered input's onChange, the
 * same reflection technique import-wizard.download.test.ts already uses:
 * every hook mocked, useState's setter captured PER CALL INDEX (source
 * order: phase(0), headers(1), rows(2), mapping(3), source(4), vcardNames(5),
 * createTags(6), fileError(7)) so the test can read exactly what each
 * setter was told to store once the handler's internal awaits resolve.
 */
const localeMock = { value: "en" as "en" | "es" };
let callIndex = 0;
let setters: ReturnType<typeof vi.fn>[] = [];
let overrides: Record<number, unknown> = {};
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => {
      const idx = callIndex++;
      const initial = idx in overrides ? overrides[idx] : (typeof init === "function" ? (init as () => unknown)() : init);
      const setter = vi.fn();
      setters[idx] = setter;
      return [initial, setter];
    },
    useMemo: (fn: () => unknown) => fn(),
    useRef: (init: unknown) => ({ current: init }),
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
  setters = [];
  overrides = { 0: { name: "choose" } };
  return (ImportWizard as unknown as (p: unknown) => unknown)({ accountId: "a1", existingTags: [] });
}

async function flush() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

/** Fix round I-1: parseVCardFile reads bytes (file.arrayBuffer()), not
 *  file.text() — this fake carries both, since the content-sniff path
 *  (onFile, for a non-.vcf name) still peeks with file.slice(0,256).text(). */
function fakeVCardFile(name: string, text: string): File {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    size: bytes.byteLength,
    text: () => Promise.resolve(text),
    arrayBuffer: () => Promise.resolve(bytes.buffer),
    slice: () => ({ text: () => Promise.resolve(text) }),
  } as unknown as File;
}

describe("choosing a .vcf file pre-maps its columns (F-150 part 1)", () => {
  it("a .vcf by extension goes straight to the map phase with every column already mapped, source tracked as vcard", async () => {
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "N:Lovelace;Ada;;;", "TEL:5551234567", "EMAIL:ada@example.com", "END:VCARD"].join("\r\n");
    const tree = render();
    const input = find(tree, (el) => el.type === "input" && el.props.type === "file");
    expect(input).not.toBeNull();
    const file = fakeVCardFile("contacts.vcf", vcard);
    (input!.props.onChange as (e: unknown) => void)({ target: { files: [file] } });
    await flush();

    const phaseSetter = setters[0]!;
    const headersSetter = setters[1]!;
    const rowsSetter = setters[2]!;
    const mappingSetter = setters[3]!;
    const sourceSetter = setters[4]!;
    const vcardNamesSetter = setters[5]!;
    expect(phaseSetter).toHaveBeenCalledWith({ name: "map" });
    expect(sourceSetter).toHaveBeenCalledWith("vcard");
    const headers = headersSetter.mock.calls[0]![0] as string[];
    expect(headers).toEqual([
      m["contacts.firstName"], m["contacts.lastName"], m["contacts.email"], m["contacts.phone"], m["contact.company"],
    ]);
    // Fix round M-3(b) RULING: every header EXCEPT company_name pre-maps to
    // itself; company_name (ORG) starts unmatched.
    const mapping = mappingSetter.mock.calls[0]![0] as Record<string, string | null>;
    for (const h of headers.slice(0, 4)) expect(mapping[h]).not.toBeNull();
    expect(mapping[m["contact.company"]]).toBeNull();
    const rows = rowsSetter.mock.calls[0]![0] as { line: number; values: Record<string, string> }[];
    expect(rows[0]!.values[m["contacts.firstName"]]).toBe("Ada");
    expect(rows[0]!.values[m["contacts.lastName"]]).toBe("Lovelace");
    // Fix round M-4: the skipped-rows download's own name column reads this.
    expect(vcardNamesSetter).toHaveBeenCalledWith(["Ada Lovelace"]);
  });

  it("a .csv-named file whose content starts with BEGIN:VCARD is still detected and pre-mapped (mutation: branch on file.type instead of looksLikeVCard -> FAILS, since this fake carries no .type at all)", async () => {
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", "N:Byron;Annabella;;;", "TEL:5559876543", "END:VCARD"].join("\r\n");
    const tree = render();
    const input = find(tree, (el) => el.type === "input" && el.props.type === "file");
    const file = fakeVCardFile("export.csv", vcard);
    (input!.props.onChange as (e: unknown) => void)({ target: { files: [file] } });
    await flush();
    expect(setters[0]!).toHaveBeenCalledWith({ name: "map" });
    const mapping = setters[3]!.mock.calls[0]![0] as Record<string, string | null>;
    expect(mapping[m["contacts.lastName"]]).toBe("last_name");
  });

  it("a .vcf one byte over the ceiling shows the specific too-large message, not a generic read failure (mutation: disable the vCardFileTooLarge check -> FAILS, since the file is never even read in the correct version, but would read as readFailed once the poisoned arrayBuffer() throws)", async () => {
    const tree = render();
    const input = find(tree, (el) => el.type === "input" && el.props.type === "file");
    // arrayBuffer() throws if ever called: a passing test here must be
    // because the SIZE guard answered first, before any read was attempted.
    const arrayBuffer = () => { throw new Error("must not be called — the size guard runs first"); };
    const size = 104_857_601; // MAX_VCARD_FILE_BYTES (100 MiB) + 1
    const file = { name: "huge.vcf", size, arrayBuffer } as unknown as File;
    (input!.props.onChange as (e: unknown) => void)({ target: { files: [file] } });
    await flush();
    const fileErrorSetter = setters[7]!;
    expect(fileErrorSetter).toHaveBeenCalledWith(t(m, "contacts.import.tooLarge", "en"));
    const phaseSetter = setters[0]!;
    expect(phaseSetter).not.toHaveBeenCalledWith({ name: "map" });
  });

  // Fix round D2: a read failure (the bytes could not even be fetched) must
  // read differently from "the file was read and had nothing in it".
  it("a .vcf whose bytes cannot be read shows the read-failed message, not the empty-contacts one (mutation: catch the read failure with contacts.import.vcardEmpty instead -> FAILS)", async () => {
    const tree = render();
    const input = find(tree, (el) => el.type === "input" && el.props.type === "file");
    const file = {
      name: "broken.vcf", size: 10,
      arrayBuffer: () => Promise.reject(new Error("disk error")),
    } as unknown as File;
    (input!.props.onChange as (e: unknown) => void)({ target: { files: [file] } });
    await flush();
    const fileErrorSetter = setters[7]!;
    expect(fileErrorSetter).toHaveBeenCalledWith(t(m, "contacts.import.readFailed", "en"));
  });

  // Fix round M-5: once the source is a vCard with zero recognised cards,
  // the empty message says "contacts", not "rows".
  it("a .vcf with no BEGIN/END blocks at all shows the vCard-specific empty message", async () => {
    const tree = render();
    const input = find(tree, (el) => el.type === "input" && el.props.type === "file");
    const file = fakeVCardFile("blank.vcf", "not actually a vcard");
    (input!.props.onChange as (e: unknown) => void)({ target: { files: [file] } });
    await flush();
    const fileErrorSetter = setters[7]!;
    expect(fileErrorSetter).toHaveBeenCalledWith(t(m, "contacts.import.vcardEmpty", "en"));
  });
});
