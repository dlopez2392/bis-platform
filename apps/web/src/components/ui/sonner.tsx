"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
// "radix-ui/internal" is the package's own re-export surface for the
// primitives its public components compose from (radix-ui/dist/internal.d.mts
// — `export { reactFocusScope as FocusScope }`), reached through "radix-ui"'s
// `"./*"` wildcard export map entry (radix-ui/package.json). It is not a
// contractual subpath (the name says so), so a future radix-ui bump that
// restructures it could break this import — worth a direct
// `@radix-ui/react-focus-scope` dependency if that ever happens.
import { FocusScope } from "radix-ui/internal"
import { matchesToastJumpHotkey, isEscapeKey } from "./toast-jump"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  // Sonner is ALWAYS rendered through a portal, even when nothing below is
  // engaged — only the portal's TARGET node changes (default vs. the jump
  // container). Conditionally wrapping/unwrapping Sonner's own JSX instead
  // (e.g. `jumpActive ? <FocusScope>{sonner}</FocusScope> : sonner`) changes
  // the element TYPE at this tree position, which would unmount and remount
  // Sonner — and sonner's toast list lives in a module-level store, not
  // React state reached by a fresh subscription (sonner/dist/index.mjs:125-133,
  // 878-911: `ToastState.subscribe` only replays FUTURE toasts, never the
  // ones already showing) — so a remount would make a visible toast vanish
  // mid-interaction. Swapping only the portal's `container` argument moves
  // the already-mounted DOM without remounting (same portal element type on
  // every render).
  const [defaultContainer, setDefaultContainer] = React.useState<HTMLDivElement | null>(null)
  const [jumpContainer, setJumpContainer] = React.useState<HTMLDivElement | null>(null)
  const [jumpActive, setJumpActive] = React.useState(false)

  // Sonner's own default hotkey (Alt+T, sonner/dist/index.mjs:918-920)
  // focuses its toast list, but while a Radix Sheet/Dialog is open its
  // trapped FocusScope immediately steals focus back: FocusScope's
  // document-level `focusin` listener re-focuses whatever was last focused
  // INSIDE the modal whenever focus lands on something outside the modal's
  // own container (@radix-ui/react-focus-scope/dist/index.mjs:39-46), and
  // the toaster — a sibling in the DOM, not a descendant of the modal's
  // content — is always "outside" to that check. Mounting a FRESH trapped
  // FocusScope of our own around the toaster, only while this mode is
  // engaged, pushes it onto Radix's own focus-scope stack and PAUSES
  // whichever scope was previously active (index.mjs:76-90: `if (container)
  // { focusScopesStack.add(focusScope); ... }`; index.mjs:196-213:
  // `add()` calls `activeFocusScope?.pause()` on whatever was on top) —
  // the exact mechanism Radix itself uses when one dialog opens inside
  // another, applied here to a toast instead of a second dialog. On mount,
  // FocusScope's own `onMountAutoFocus` default focuses the first tabbable
  // element inside it (index.mjs:81-90) — the toast's Undo button. We
  // listen at `window`'s CAPTURE phase so this fires before the modal's own
  // Escape handler, which listens on `ownerDocument` — not `window` — in
  // capture (@radix-ui/react-dismissable-layer/dist/index.mjs:101-106); a
  // `window`-capture listener always runs first in DOM dispatch order
  // (window, then document, then down to the target), regardless of
  // registration time.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (matchesToastJumpHotkey(event)) {
        setJumpActive(true)
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [])

  // Escape claims the keystroke for "leave the toast" — stopping it before
  // the modal's own Escape-closes-overlay handler ever sees it (see the
  // capture-order note above) — rather than exiting jump mode AND closing
  // the drawer on the same press. Unmounting our FocusScope runs Radix's own
  // unmount effect: it returns focus to whatever was focused before we
  // engaged (index.mjs:92-104: `focus(previouslyFocusedElement ??
  // document.body)`) and resumes the modal's own scope
  // (index.mjs:208-211: `remove()` calls `stack[0]?.resume()` on whatever is
  // now on top) — so the modal's Tab trap is exactly as it was.
  React.useEffect(() => {
    if (!jumpActive) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEscapeKey(event)) {
        event.stopPropagation()
        setJumpActive(false)
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [jumpActive])

  const portalTarget = jumpActive && jumpContainer ? jumpContainer : defaultContainer

  const toaster = (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      // Radix sets `body { pointer-events: none }` while a modal Sheet/Dialog
      // is open; without this the toaster — drawn above the modal, but a
      // sibling of it in the DOM — inherits that and a click passes through
      // to whatever sits underneath instead of reaching the toast (#151, an
      // Undo toast unclickable behind the contact drawer). Two things keep
      // this from blocking anything else: the toaster `ol` renders only
      // while a toast exists (sonner's own `if (!filteredToasts.length)
      // return null;`), and even then it has no height of its own — every
      // toast inside it is absolutely positioned — so only the toasts' own
      // boxes ever take a click.
      className="toaster group pointer-events-auto"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        className: "glass-overlay",
        // sonner's own [data-sonner-toast][data-styled=true] rule (specificity
        // 0,2,0) outranks .glass-overlay's box-shadow, so its grey blur shadow
        // would survive the utility. An inline style wins over both.
        style: { boxShadow: "var(--shadow-overlay)" },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--line-strong)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )

  return (
    <>
      {/* Default home: where Sonner's portal target points whenever jump
          mode isn't engaged. Visually inert (no className, empty unless
          portalTarget === this node) — Sonner's own `[data-sonner-toaster]`
          rule is `position: fixed` on the `<ol>` it renders inside here, so
          this div's own position in the layout tree never matters. */}
      <div ref={setDefaultContainer} />
      {jumpActive && (
        // A FRESH FocusScope every time jump mode engages (not one mounted
        // once and toggled via its `trapped` prop) — Radix only pushes onto
        // its focus-scope stack, and only runs the mount-time autofocus, in
        // the effect keyed on this component's OWN mount
        // (@radix-ui/react-focus-scope/dist/index.mjs:76-106, deps
        // `[container, onMountAutoFocus, onUnmountAutoFocus, focusScope]` —
        // note `trapped` is NOT one of them). A permanently-mounted instance
        // toggled via `trapped` would never re-claim the top of the stack
        // once a later-mounted modal's scope paused it.
        <FocusScope.Root trapped loop>
          <div ref={setJumpContainer} />
        </FocusScope.Root>
      )}
      {portalTarget && createPortal(toaster, portalTarget)}
    </>
  )
}

export { Toaster }
