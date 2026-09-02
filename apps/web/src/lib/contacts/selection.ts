export function pageSelectionState(
  selected: Set<string>, pageIds: string[],
): "none" | "some" | "all" {
  const on = pageIds.filter((id) => selected.has(id)).length;
  return on === 0 ? "none" : on === pageIds.length ? "all" : "some";
}

export function togglePageSelection(
  selected: Set<string>, pageIds: string[],
): Set<string> {
  const next = new Set(selected);
  if (pageSelectionState(selected, pageIds) === "all") {
    for (const id of pageIds) next.delete(id);
  } else {
    for (const id of pageIds) next.add(id);
  }
  return next;
}
