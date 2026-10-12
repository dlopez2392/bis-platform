"use client";

import { useSyncExternalStore } from "react";

/** A phone, for the record page's disclosures (spec §8, D6). Tailwind's `md` is 768px. */
export const PHONE_QUERY = "(max-width: 767px)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * True on a phone. The SERVER snapshot is `true` (phone-first) on purpose: a collapsible card's
 * body must not mount, and so must not fetch, before the client knows it is on a desk (spec §8,
 * "a closed card fetches nothing"). A desk opens those cards right after hydration.
 */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE_QUERY).matches, () => true);
}
