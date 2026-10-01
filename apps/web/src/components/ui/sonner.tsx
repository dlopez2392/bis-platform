"use client"

import * as React from "react"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
// "radix-ui/internal" (not a separate `@radix-ui/react-focus-scope`
// dependency) is deliberate: it reaches the SAME FocusScope module instance
// Sheet/Dialog's own Radix Dialog primitive uses internally (both come
// through the one "radix-ui" package already a direct dependency here). A
// second, independently-installed copy of @radix-ui/react-focus-scope would
// carry its OWN `focusScopesStack` module-level singleton (@radix-ui/
// react-focus-scope/dist/index.mjs:196 — `var focusScopesStack =
// createFocusScopesStack();`), so our scope and the modal's would never see
// each other on the same stack and the whole pause/resume handoff below
// would silently no-op. Reached through "radix-ui"'s `"./*"` wildcard export
// map entry (radix-ui/package.json) — not a contractual subpath (the name
// says so), so a future radix-ui bump that restructures it could break this
// import.
import { FocusScope } from "radix-ui/internal"
import {
  TOAST_JUMP_HOTKEY,
  TOAST_JUMP_HOTKEY_LABEL,
  matchesToastJumpHotkey,
  isEscapeKey,
} from "./toast-jump"

const TOAST_SELECTOR = "[data-sonner-toast]"
const TOAST_ACTION_SELECTOR = "[data-action]"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  // Sonner's own root — the <section aria-live="polite"> it forwards `ref`
  // to (sonner/dist/index.mjs:916, 1080-ish: `React.forwardRef(function
  // Toaster(props, ref) {... return React.createElement("section", {ref,
  // ...})`). It exists even with zero toasts (only the `ol` inside is
  // conditional on `filteredToasts.length`, sonner/dist/index.mjs:1091), so
  // there's no race scoping queries/observers to it instead of `document`.
  const toasterRef = React.useRef<HTMLElement | null>(null)
  const [jumpActive, setJumpActive] = React.useState(false)
  // M2: set just before `setJumpActive(false)` when we're exiting BECAUSE
  // focus already moved somewhere on its own (the `focusin` listener below)
  // — read once, synchronously, by the sentinel's own `onUnmountAutoFocus`.
  const skipUnmountAutoFocusRef = React.useRef(false)

  // Tag every action (Undo-style) button with its keyboard shortcut as AT
  // metadata — owner decision: no visible hint/new copy, `aria-keyshortcuts`
  // only. Sonner's own toastOptions only accept className/style for this
  // button (sonner/dist/index.mjs:815, 823), never arbitrary attributes, so
  // a MutationObserver scoped to Sonner's own root is the smallest way to
  // tag every one, present or future.
  React.useEffect(() => {
    const root = toasterRef.current
    if (!root) return
    const tag = () => {
      root.querySelectorAll<HTMLElement>(TOAST_ACTION_SELECTOR).forEach((el) => {
        if (!el.hasAttribute("aria-keyshortcuts")) {
          el.setAttribute("aria-keyshortcuts", TOAST_JUMP_HOTKEY_LABEL)
        }
      })
    }
    tag()
    const observer = new MutationObserver(tag)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  // Sonner's own default hotkey (Alt+T, sonner/dist/index.mjs:918-920;
  // passed explicitly below so it can't drift from TOAST_JUMP_HOTKEY) tries
  // to focus its toast list, but while a Radix Sheet/Dialog is open its
  // trapped FocusScope immediately steals focus back: FocusScope's
  // document-level `focusin` listener re-focuses whatever was last focused
  // INSIDE the modal whenever focus lands on something outside the modal's
  // own container (@radix-ui/react-focus-scope/dist/index.mjs:39-46), and
  // the toaster — a sibling in the DOM, not a descendant of the modal's
  // content — is always "outside" to that check.
  //
  // IMPORTANT: never engage with no toast on screen — an empty, invisible
  // trapped-stack entry would swallow Tab for nothing (there'd be nothing to
  // focus) and only Escape could get out. Gate on a real `[data-sonner-toast]`
  // existing first.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesToastJumpHotkey(event)) return
      if (!toasterRef.current?.querySelector(TOAST_SELECTOR)) return
      setJumpActive(true)
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [])

  // Escape claims the keystroke for "leave the toast" with `preventDefault`,
  // NOT `stopPropagation`. We listen at `window`'s CAPTURE phase, which runs
  // before the modal's own `ownerDocument`-level capture listener
  // (@radix-ui/react-dismissable-layer/dist/index.mjs:101-106: `if
  // (event.key !== "Escape") return; onEscapeKeyDown?.(event); if
  // (!event.defaultPrevented && onDismiss) { event.preventDefault();
  // onDismiss(); }`) — that handler only dismisses `if
  // (!event.defaultPrevented)`, so `preventDefault()` alone keeps the drawer
  // open; we don't need (and must not use) `stopPropagation`, which would
  // ALSO have stopped Sonner's own Escape handler (`document` BUBBLE phase,
  // sonner/dist/index.mjs:1055-1057: `if (event.code === 'Escape' &&
  // (document.activeElement === listRef.current || listRef.current
  // ?.contains(document.activeElement))) setExpanded(false);` — it doesn't
  // check `defaultPrevented` at all, so it still runs). That's the handler
  // that resumes the toast's auto-dismiss timer: sonner's own Alt+T handler
  // sets `expanded = true` (sonner/dist/index.mjs:1049-1050), which pauses
  // it (index.mjs:605); without Sonner's own Escape resetting `expanded`
  // back to `false`, the toast would never time out again.
  React.useEffect(() => {
    if (!jumpActive) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEscapeKey(event)) {
        event.preventDefault()
        setJumpActive(false)
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [jumpActive])

  // IMPORTANT: jump mode must end as soon as it's no longer useful, not only
  // on Escape — when the toast itself goes away (Undo fired: sonner's own
  // action-button handler calls `deleteToast()` right after the caller's
  // `onClick`, sonner/dist/index.mjs:816-820, which removes the toast node
  // ~200ms later, sonner/dist/index.mjs:425 `TIME_BEFORE_UNMOUNT`), or when
  // focus moves back into the modal on its own (e.g. a stray click into a
  // drawer field) — M2: that's the user's own, deliberate choice of where
  // focus should be, so we flag it for the sentinel's `onUnmountAutoFocus`
  // below to leave alone rather than snapping it back to wherever it was
  // BEFORE jump mode engaged.
  React.useEffect(() => {
    if (!jumpActive) return
    const root = toasterRef.current
    if (!root) return
    const observer = new MutationObserver(() => {
      if (!root.querySelector(TOAST_SELECTOR)) setJumpActive(false)
    })
    observer.observe(root, { childList: true, subtree: true })
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (target instanceof Node && !root.contains(target)) {
        skipUnmountAutoFocusRef.current = true
        setJumpActive(false)
      }
    }
    document.addEventListener("focusin", onFocusIn)
    return () => {
      observer.disconnect()
      document.removeEventListener("focusin", onFocusIn)
    }
  }, [jumpActive])

  return (
    <>
      {jumpActive && (
        // A FRESH FocusScope every time jump mode engages (not one mounted
        // once and toggled via its `trapped` prop) — Radix only pushes onto
        // its focus-scope stack in the effect keyed on this component's OWN
        // mount (@radix-ui/react-focus-scope/dist/index.mjs:76-90, deps
        // `[container, onMountAutoFocus, onUnmountAutoFocus, focusScope]` —
        // `trapped` is NOT one of them, and the push itself is unconditional
        // on `trapped`, index.mjs:76-78). A permanently-mounted instance
        // toggled via `trapped` would never re-claim the top of the stack
        // once a later-mounted modal's scope paused it.
        //
        // Deliberately UNTRAPPED: the real toast lives OUTSIDE this
        // sentinel's own (empty) container, so a trapped scope's
        // `handleFocusIn` would see our own focus call as an "outside"
        // interaction and immediately snap it back (index.mjs:39-46) — we
        // only want the stack push/pause and the default
        // return-focus-on-unmount, both unconditional on `trapped`
        // (index.mjs:76-78, 92-104), not FocusScope's actual containment
        // enforcement.
        //
        // `container` is `useState`, not a plain ref (index.mjs:23, composed
        // via `useComposedRefs(forwardedRef, setContainer)` at line 27), so
        // the push/pause/autofocus effect — gated `if (container)`,
        // index.mjs:77 — runs ONE COMMIT AFTER this sentinel's DOM node
        // mounts, not in the same one. Doing the real focus work from
        // `onMountAutoFocus` (rather than a separate effect keyed on
        // `jumpActive`) is what fixes that: `focusScopesStack.add(focusScope)`
        // (line 77, pausing the modal's scope) always runs BEFORE
        // `container.dispatchEvent(mountEvent)` a few lines later in that
        // SAME effect, so by the time this handler fires the modal is
        // already paused. `preventDefault()` skips FocusScope's own default
        // (which would focus the first tabbable candidate INSIDE the
        // sentinel's empty container, find nothing, and fall back to
        // focusing the sentinel div itself, index.mjs:81-90).
        //
        // The actual `.focus()` call is still deferred one more step, via a
        // macrotask (`setTimeout`, NOT a microtask/Promise) — browsers run a
        // microtask checkpoint between invoking separate listeners for the
        // SAME event, and Sonner's own Alt+T handler is a plain `document`
        // BUBBLE-phase listener that ALSO tries `listRef.current.focus()`
        // on this exact keydown (sonner/dist/index.mjs:1047-1053), running
        // later in this same dispatch than our `window`-capture listener. A
        // microtask-deferred call here could still land before that bubble
        // listener runs and then lose when it fires; a macrotask guarantees
        // we are the last writer.
        <FocusScope.Root
          onMountAutoFocus={(event) => {
            event.preventDefault()
            const root = toasterRef.current
            window.setTimeout(() => {
              root?.querySelector<HTMLElement>(TOAST_ACTION_SELECTOR)?.focus()
            }, 0)
          }}
          onUnmountAutoFocus={(event) => {
            if (skipUnmountAutoFocusRef.current) {
              event.preventDefault()
              skipUnmountAutoFocusRef.current = false
            }
          }}
        />
      )}
      <Sonner
        ref={toasterRef}
        theme={theme as ToasterProps["theme"]}
        hotkey={[...TOAST_JUMP_HOTKEY]}
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
    </>
  )
}

export { Toaster }
