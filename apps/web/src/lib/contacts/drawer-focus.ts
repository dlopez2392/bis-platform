/**
 * Where focus goes when the contact drawer closes (2026-10-28).
 *
 * The drawer is a controlled Sheet opened from a table row, with no Radix
 * Trigger, so Radix's own close handler ("prevent the default, focus the
 * trigger") focused nothing and Esc dropped keyboard users on <body>. This is
 * the drawer's `onCloseAutoFocus`: it gives focus back to the row whose
 * `data-contact-row` is the contact the drawer last showed, so row nav
 * (ArrowUp/ArrowDown) carries on from where it was.
 *
 * Rows are matched by reading the attribute, not by building a selector from
 * the id, so no id can ever break or widen the query. A row that is not on
 * this page (a deep link, a remembered row) is simply not focused.
 */
export function returnFocusToRow(
  event: { preventDefault(): void },
  rowId: string | null,
  doc: { querySelectorAll(selector: string): ArrayLike<{ getAttribute(name: string): string | null; focus(): void }> } = document,
): void {
  event.preventDefault();
  if (!rowId) return;
  const rows = Array.from(doc.querySelectorAll("[data-contact-row]"));
  rows.find((r) => r.getAttribute("data-contact-row") === rowId)?.focus();
}
