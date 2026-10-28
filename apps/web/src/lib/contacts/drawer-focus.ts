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

/**
 * Where focus goes when the bulk bar unmounts (final review M5): Archive, Restore, Delete, a tag or Clear
 * selection empty the selection, and the bar with the button that had focus goes with it. The table's
 * select-all checkbox (`data-select-page`) is the nearest control that stays; else the table itself
 * (`data-contacts-table`, focusable by script only).
 */
export function focusAfterBar(
  doc: { querySelector(selector: string): { focus(): void } | null } = document,
): void {
  (doc.querySelector("[data-select-page]") ?? doc.querySelector("[data-contacts-table]"))?.focus();
}

/** The row that takes a gone row's place in the focus order (final review M5): the drawer closed because its
 *  contact left the list (archived, restored or deleted), so focus goes to the next row, or the previous one
 *  when it was the last. Null when it was the only row, or was not on this page. */
export function nextRowId(rowIds: readonly string[], goneId: string): string | null {
  const i = rowIds.indexOf(goneId);
  if (i < 0) return null;
  return rowIds[i + 1] ?? rowIds[i - 1] ?? null;
}
