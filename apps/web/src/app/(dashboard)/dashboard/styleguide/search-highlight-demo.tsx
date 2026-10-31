import { HighlightedText } from "@/components/highlighted-text";
import { nameRanges, phoneRanges } from "@/lib/contacts/search-highlight";

/**
 * F-092 part 1 (plan Task 7): HighlightedText in the two shapes it actually ships in — the command
 * palette's contacts row (a name, then a muted phone sublabel, stacked) and a list row (name and phone
 * as two separate cells) — across the three matching rules this plan ships: a full name typed in any
 * word order, the n/ñ fold (owner ruling Q1), and a phone search by its last digits (Q2's 4-digit
 * floor). Every displayed string lives here, in the data, not as JSX text (the i18n ratchet counts a
 * JSX text literal; this page is internal tooling, so none of these need a Spanish twin, but adding one
 * would still cost this file's own ratchet ceiling for no reason).
 */
const CASES: {
  key: string;
  name: string;
  nameQuery: string;
  phone: string;
  phoneQuery: string;
}[] = [
  {
    key: "full-name",
    name: "María García López",
    nameQuery: "garcia maria",
    phone: "(956) 555-0199",
    phoneQuery: "0199",
  },
  {
    key: "fold",
    name: "Peña",
    nameQuery: "pena",
    phone: "(956) 555-0199",
    phoneQuery: "0199",
  },
];

export function SearchHighlightDemo() {
  return (
    <div className="grid w-full gap-4 md:grid-cols-2" data-testid="styleguide-search-highlight">
      {CASES.map((c) => (
        <div key={c.key} className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-card)] border border-border p-4">
          {/* The command palette's own contacts row: a name, then a muted phone sublabel, stacked. */}
          <div
            data-testid="styleguide-search-highlight-palette"
            className="flex flex-col gap-1.5 rounded-[var(--radius-ctl)] bg-[var(--surface-2)] px-2 py-1.5"
          >
            <span className="truncate text-sm">
              <HighlightedText text={c.name} ranges={nameRanges(c.name, c.nameQuery)} />
            </span>
            <span className="truncate text-xs text-muted-foreground">
              <HighlightedText text={c.phone} ranges={phoneRanges(c.phone, c.phoneQuery)} />
            </span>
          </div>
          {/* A list row: name and phone as two separate cells (the contacts table's own shape). */}
          <div
            data-testid="styleguide-search-highlight-list"
            className="flex items-center justify-between gap-3 border-t border-border pt-2 text-sm"
          >
            <span className="truncate">
              <HighlightedText text={c.name} ranges={nameRanges(c.name, c.nameQuery)} />
            </span>
            <span className="truncate text-muted-foreground">
              <HighlightedText text={c.phone} ranges={phoneRanges(c.phone, c.phoneQuery)} />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
