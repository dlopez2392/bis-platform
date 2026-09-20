/**
 * Served verbatim at GET /assistant.js. Plain ES5-ish browser JS in a string,
 * on the same convention `lib/forms/embed-script.ts`'s `EMBED_SCRIPT` uses:
 * no build step, and the unit test evaluates this exact value rather than a
 * parallel copy that could drift from what ships.
 *
 * `window`, `document`, `URL` and `URLSearchParams` are read as free
 * variables so the test can supply fakes; in the browser they resolve to the
 * globals.
 *
 * This is its OWN script rather than a third mode of `EMBED_SCRIPT`: a form
 * or booking embed is a fixed-size block the host page lays out inline, but
 * the assistant is a floating launcher the host page never sizes at all —
 * different geometry, a different open/close lifecycle, and a body-scroll
 * lock on small screens that neither sibling needs.
 */
export const ASSISTANT_EMBED_SCRIPT = `(function () {
  var script = document.currentScript;
  if (!script) return;
  var publicId = script.getAttribute("data-assistant");
  if (!publicId) return;

  var origin = new URL(script.src).origin;
  var params = new URLSearchParams();
  params.set("embed", "1");

  var locale = script.getAttribute("data-locale");
  if (locale) params.set("locale", locale);

  // The host page's own colour mode — same two-word allowlist
  // lib/forms/embed-script.ts uses, and for the same reason: the iframe
  // cannot ask prefers-color-scheme about a mode the HOST toggled itself.
  var theme = script.getAttribute("data-theme");
  if (theme === "light" || theme === "dark") params.set("theme", theme);

  // utm_* and click ids live on the HOST page's url, which the iframe can
  // never see on its own — lifted here exactly like the form/booking embed,
  // or a lead this assistant files would carry no attribution at all.
  var host = new URLSearchParams(window.location.search);
  var keys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];
  for (var i = 0; i < keys.length; i++) {
    var value = host.get(keys[i]);
    if (value) params.set(keys[i], value);
  }
  params.set("page", window.location.href);
  if (document.referrer) params.set("ref", document.referrer);

  var CLOSED_SIZE = 72;
  var INSET = 16;
  var WIDE_BREAKPOINT = 640;

  var iframe = document.createElement("iframe");
  iframe.src = origin + "/a/" + encodeURIComponent(publicId) + "?" + params.toString();
  iframe.setAttribute("title", script.getAttribute("data-title") || "Assistant");
  iframe.setAttribute("allowtransparency", "true");
  iframe.setAttribute("loading", "lazy");
  iframe.style.position = "fixed";
  iframe.style.border = "0";
  iframe.style.zIndex = "2147483000";

  var open = false;

  function isWide() {
    return window.innerWidth >= WIDE_BREAKPOINT;
  }

  // Every branch sets all six geometry properties explicitly rather than
  // relying on a previous call's leftovers — going from the narrow full-bleed
  // layout (top/left set, right/bottom cleared) back to closed must clear
  // top/left again, or the launcher would still be pinned to the corner the
  // full-screen panel used.
  function layout() {
    if (!open) {
      iframe.style.width = CLOSED_SIZE + "px";
      iframe.style.height = CLOSED_SIZE + "px";
      iframe.style.top = "auto";
      iframe.style.left = "auto";
      iframe.style.right = INSET + "px";
      iframe.style.bottom = INSET + "px";
      iframe.style.borderRadius = "999px";
      return;
    }
    if (isWide()) {
      iframe.style.width = "min(400px, calc(100vw - " + (INSET * 2) + "px))";
      iframe.style.height = "min(640px, calc(100vh - " + (INSET * 2) + "px))";
      iframe.style.top = "auto";
      iframe.style.left = "auto";
      iframe.style.right = INSET + "px";
      iframe.style.bottom = INSET + "px";
      iframe.style.borderRadius = "16px";
    } else {
      iframe.style.width = "100vw";
      iframe.style.height = "100vh";
      iframe.style.top = "0px";
      iframe.style.left = "0px";
      iframe.style.right = "auto";
      iframe.style.bottom = "auto";
      iframe.style.borderRadius = "0px";
    }
  }

  // Non-null only while THIS script holds the lock, so a close that runs
  // before any open ever did (there isn't one, but belt-and-suspenders
  // matches the rest of this file) can never write "hidden" back as if it
  // were the page's own original value.
  var lockedOverflow = null;

  function setOpen(next) {
    open = next;
    layout();
    if (open && !isWide()) {
      // Scroll lock only on the small-screen full-bleed layout: at ≥640px
      // the panel is a fixed-size card over the page, and the host page
      // keeps scrolling under it exactly like any other overlay.
      if (lockedOverflow === null) lockedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    } else if (lockedOverflow !== null) {
      document.body.style.overflow = lockedOverflow;
      lockedOverflow = null;
    }
  }

  layout();
  script.parentNode.insertBefore(iframe, script.nextSibling);

  window.addEventListener("resize", function () {
    if (open) layout();
  });

  window.addEventListener("message", function (event) {
    // Both checks matter, same reasoning as embed.js: without the source
    // check any script or frame on the host page could open/close this.
    if (event.source !== iframe.contentWindow) return;
    if (event.origin !== origin) return;

    var data = event.data;
    if (!data || typeof data !== "object") return;

    // The widget (inside the iframe) is the one thing that knows whether its
    // own launcher or its own close button was just clicked; it reports the
    // result rather than asking permission, and this listener only resizes
    // the frame around whatever it decided.
    if (data.type === "bis-assistant-state" && typeof data.open === "boolean") {
      setOpen(data.open);
    }
  });

  // Esc on the HOST page — the iframe has its own document and never sees a
  // keydown that landed on the host's body. Resized here immediately (rather
  // than waiting on the widget's own round-trip bis-assistant-state reply)
  // and ALSO posted into the iframe, so the widget's own rendered state
  // (launcher vs panel) still catches up to match.
  window.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && open) {
      setOpen(false);
      iframe.contentWindow.postMessage({ type: "bis-assistant-close" }, origin);
    }
  });

  // For a site's own "Chat with us" link or button — the assistant does not
  // have to be the one thing that can open itself. Mirrors the Esc handler's
  // shape: resize immediately, then tell the widget which state to render.
  window.BISAssistant = {
    open: function () {
      setOpen(true);
      iframe.contentWindow.postMessage({ type: "bis-assistant-open" }, origin);
    },
    close: function () {
      setOpen(false);
      iframe.contentWindow.postMessage({ type: "bis-assistant-close" }, origin);
    },
  };
})();
`;
