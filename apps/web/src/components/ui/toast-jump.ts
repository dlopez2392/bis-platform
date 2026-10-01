/**
 * Pure predicates + the single shared hotkey spec for `sonner.tsx`'s
 * keyboard-reach fix (#151 follow-up): a Radix modal's FocusScope traps Tab
 * inside itself, so a keyboard user has no way to reach an Undo toast while
 * a Sheet/Dialog is open. Kept separate and DOM-free so the SAME functions
 * `sonner.tsx`'s `window`-capture listeners use are what this suite
 * exercises — not a copy.
 */

/**
 * The exact shape sonner's own default hotkey check reads
 * (`sonner/dist/index.mjs:1049`: `hotkey.every((key) => event[key] ||
 * event.code === key)`) — passed to BOTH `<Sonner hotkey={TOAST_JUMP_HOTKEY}>`
 * in `sonner.tsx` and `matchesToastJumpHotkey` below, so the two can never
 * drift apart. Mirrors sonner's own default value
 * (`sonner/dist/index.mjs:918-920`).
 */
export const TOAST_JUMP_HOTKEY = ["altKey", "KeyT"] as const;

function hotkeyPartLabel(part: string): string {
  // A `KeyboardEvent.code` for a single letter, e.g. "KeyT" -> "T".
  if (part.startsWith("Key") && part.length === 4) return part.slice(3);
  // A modifier flag read via `event[key]`, e.g. "altKey" -> "Alt".
  if (part.endsWith("Key")) {
    const name = part.slice(0, -3);
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return part;
}

/**
 * A human-readable label for `TOAST_JUMP_HOTKEY`, e.g. "Alt+T" — used for
 * `aria-keyshortcuts` on every toast action button (owner decision:
 * assistive-tech metadata only, no visible hint/copy). Derived mechanically
 * from the one shared array so it cannot name a different key than the
 * listener actually matches.
 */
export const TOAST_JUMP_HOTKEY_LABEL = TOAST_JUMP_HOTKEY.map(hotkeyPartLabel).join("+");

/**
 * Mirrors sonner's own default hotkey match
 * (`sonner/dist/index.mjs:1049`), generalised over `TOAST_JUMP_HOTKEY`
 * instead of hardcoding its two entries — but, unlike sonner's own check,
 * ALSO rejects Ctrl or Meta held alongside it: on Windows, AltGr is
 * physically Ctrl+Alt, so typing a character that needs AltGr+T on an
 * international keyboard layout would otherwise engage jump mode and pause
 * the open modal's trap mid-keystroke. Sonner's own hotkey has this same gap
 * (it only focuses its own toast list, not consequential enough to matter);
 * ours pauses a modal, so it's worth the extra check here.
 */
export function matchesToastJumpHotkey(event: {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  code?: string;
}): boolean {
  if (event.ctrlKey === true || event.metaKey === true) return false;
  return TOAST_JUMP_HOTKEY.every(
    (key) => (event as Record<string, unknown>)[key] === true || event.code === key,
  );
}

export function isEscapeKey(event: { key: string }): boolean {
  return event.key === "Escape";
}
