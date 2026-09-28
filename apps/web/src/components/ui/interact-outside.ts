/**
 * Sonner mounts its toaster at `ol[data-sonner-toaster]` above every Radix
 * overlay (z-index 999999999 — sonner's own CSS), so a toast is drawn ON TOP
 * of an open Sheet/Dialog. Radix's modal Dialog passes
 * `deferPointerDownOutside: true` (`@radix-ui/react-dialog@1.1.23`), so a
 * pointer-down on the toast does not dismiss the modal on the spot —
 * DismissableLayer (`@radix-ui/react-dismissable-layer@1.1.19`) defers the
 * outside dispatch to a one-shot listener on the next document `click`,
 * which fires AFTER the toast's own `onClick` has already run. Without this
 * exemption, Undo would still fire and the drawer would THEN close under the
 * toast (#151). The focus-outside half of the same check is inert here
 * regardless — a modal Sheet/Dialog's content always calls
 * `event.preventDefault()` on a focus-outside event itself — so only the
 * deferred pointer-down path needs the exemption; it would matter for a
 * non-modal Sheet/Dialog, but nothing in this repo renders one non-modal
 * today. This is the shared predicate + composition both `SheetContent` and
 * `DialogContent` use to exempt it, kept in one place so both primitives
 * can't drift.
 *
 * `target` can be `null`, and this module has no DOM global to lean on:
 * `vitest.config.ts` runs `src/**\/*.test.ts` in vitest's default node
 * environment, so `target instanceof Element` would throw a ReferenceError
 * there — hence the duck-typed `closest` check instead.
 */
export function isToasterTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as { closest?: unknown }).closest !== "function") {
    return false;
  }
  return (target as Element).closest("[data-sonner-toaster]") !== null;
}

/**
 * Wraps a caller's own `onInteractOutside` (Radix's Dialog/Sheet content
 * prop) so a toaster interaction is prevented — never treated as dismissing
 * the modal — while every other outside interaction still runs exactly what
 * the caller passed in, unchanged. `E` is left generic (rather than imported
 * from `radix-ui`'s dismissable-layer types) because Sheet and Dialog each
 * have their own alias for the same underlying `Dialog` export; the members
 * below are the ones Radix's `PointerDownOutsideEvent` and
 * `FocusOutsideEvent` both carry (they extend DOM `Event`).
 */
export function interactOutsideExemptingToaster<
  E extends { target: EventTarget | null; defaultPrevented: boolean; preventDefault(): void },
>(onInteractOutside: ((event: E) => void) | undefined): (event: E) => void {
  return (event) => {
    if (isToasterTarget(event.target)) {
      event.preventDefault();
      return;
    }
    onInteractOutside?.(event);
  };
}
