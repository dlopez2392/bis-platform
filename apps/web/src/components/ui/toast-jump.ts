/**
 * Pure predicates for `sonner.tsx`'s keyboard-reach fix (#151 follow-up): a
 * Radix modal's FocusScope traps Tab inside itself, so a keyboard user has
 * no way to reach an Undo toast while a Sheet/Dialog is open. Kept separate
 * and DOM-free so the SAME functions `sonner.tsx`'s `window`-capture
 * listeners use are what this suite exercises — not a copy.
 */

/**
 * Mirrors sonner's own default hotkey match (`sonner/dist/index.mjs:917-920`:
 * `hotkey = ["altKey", "KeyT"]`; `index.mjs:1049`:
 * `hotkey.every((key) => event[key] || event.code === key)`). For this
 * exact two-entry hotkey the generalised check reduces to one case each:
 * `event["altKey"]` (truthy) for the first entry, `event.code === "KeyT"`
 * for the second (`event["KeyT"]` is always `undefined` on a KeyboardEvent).
 */
export function matchesToastJumpHotkey(event: { altKey: boolean; code: string }): boolean {
  return event.altKey === true && event.code === "KeyT";
}

export function isEscapeKey(event: { key: string }): boolean {
  return event.key === "Escape";
}
