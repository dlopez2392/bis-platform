"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * S-47c (design review I5): moves focus to an element, by id, once the render that a state change causes has
 * committed. The row actions on the Voice page's two knowledge cards replace the button that was pressed (Edit
 * becomes an editor, Remove becomes Keep, a moved row re-renders in its new place), and without this the focus
 * falls back to the page body, so a keyboard user starts again from the top.
 *
 * The caller asks in the same handler that changes the state; the effect runs after every commit and does
 * nothing unless a request is pending. A ref, not state: asking must not cause a render of its own.
 */
export function useFocusAfterRender(): (id: string) => void {
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const id = pending.current;
    if (id === null) return;
    pending.current = null;
    document.getElementById(id)?.focus();
  });
  return useCallback((id: string) => {
    pending.current = id;
  }, []);
}
