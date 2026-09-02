"use client";

import { useCallback, useEffect, useState } from "react";

const PARAM = "peek";

function readPeek(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(PARAM);
}

/**
 * Drawer open-state mirrored into `?peek=<id>` with SHALLOW history calls —
 * never router.push, which would re-render the server component tree on
 * every open/close (approach A's whole point). Back closes an open drawer
 * (we pushed one entry); refresh with ?peek= present re-opens after
 * hydration; Esc/✕ call close(), which goes back IF we pushed, else
 * (arrived via direct load) strips the param in place.
 */
export function usePeek() {
  const [peekId, setPeekId] = useState<string | null>(null);
  const [pushed, setPushed] = useState(false);

  useEffect(() => {
    setPeekId(readPeek()); // initial mount — honor a deep-linked ?peek=
    const onPop = () => { setPeekId(readPeek()); setPushed(false); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const open = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, id);
    window.history.pushState(window.history.state, "", url);
    setPushed(true);
    setPeekId(id);
  }, []);

  const close = useCallback(() => {
    if (pushed) {
      window.history.back(); // popstate handler clears peekId
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete(PARAM);
      window.history.replaceState(window.history.state, "", url);
      setPeekId(null);
    }
  }, [pushed]);

  return { peekId, open, close };
}
