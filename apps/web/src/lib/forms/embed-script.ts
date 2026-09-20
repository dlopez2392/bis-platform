/**
 * Served verbatim at GET /embed.js. Plain ES5-ish browser JS in a string: no
 * build step, and the unit test evaluates this exact value rather than a
 * parallel copy that could drift from what ships.
 *
 * `window`, `document`, `URL` and `URLSearchParams` are read as free variables
 * so the test can supply fakes; in the browser they resolve to the globals.
 */
export const EMBED_SCRIPT = `(function () {
  var script = document.currentScript;
  if (!script) return;
  // data-form wins when a tag carries both attributes (first-wins, documented).
  var publicId = script.getAttribute("data-form");
  var path = "/f/";
  var minHeight = "420";
  var defaultTitle = "Form";
  if (!publicId) {
    publicId = script.getAttribute("data-booking");
    path = "/b/";
    minHeight = "560";
    defaultTitle = "Booking";
  }
  var concierge = false;
  if (!publicId) {
    publicId = script.getAttribute("data-concierge");
    path = "/c/";
    defaultTitle = "Chat";
    concierge = true;
  }
  if (!publicId) return;

  // Idempotence: the bubble is page-level chrome — only ONE ever, even if
  // the snippet is pasted twice on one page by mistake. data-form and
  // data-booking are deliberately NOT guarded here: a page can legitimately
  // embed two different forms inline, each its own iframe beside its own
  // <script> tag, and a global flag would break that.
  if (concierge) {
    if (window.__bisConciergeMounted) return;
    window.__bisConciergeMounted = true;
  }

  var origin = new URL(script.src).origin;
  var params = new URLSearchParams();

  var locale = script.getAttribute("data-locale");
  if (locale) params.set("locale", locale);

  // The host page's own colour mode. A site that toggles its own dark class
  // knows the answer; prefers-color-scheme inside the iframe does not. Only
  // the two words are forwarded — anything else is not a hint.
  var theme = script.getAttribute("data-theme");
  if (theme === "light" || theme === "dark") params.set("theme", theme);

  // utm_* and click ids live on the HOST page url. The iframe cannot read them
  // — its own url is ours — so they have to be lifted here and passed through.
  // Miss this and attribution records empty forever while appearing to work.
  var host = new URLSearchParams(window.location.search);
  var keys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];
  for (var i = 0; i < keys.length; i++) {
    var value = host.get(keys[i]);
    if (value) params.set(keys[i], value);
  }
  params.set("page", window.location.href);
  if (document.referrer) params.set("ref", document.referrer);

  var iframe = document.createElement("iframe");
  // Preloaded, hidden for the concierge branch: src is set here, at page
  // load, regardless of whether the launcher is ever clicked — so the
  // render token's MIN_FILL_MS floor has long passed before anyone can
  // click. Moving this into the click handler would make a fast visitor's
  // first message bounce with "please send it again".
  iframe.src = origin + path + encodeURIComponent(publicId) + "?" + params.toString();
  iframe.style.width = "100%";
  iframe.style.border = "0";
  iframe.style.display = "block";
  iframe.setAttribute("title", script.getAttribute("data-title") || defaultTitle);

  var panel, launcher, setOpen;

  if (concierge) {
    // The conversation still lives entirely in the iframe — CSS isolation by
    // construction, no shadow DOM, no injected styles, no collision, because
    // none of the client-facing UI runs in the host page's DOM. Only this
    // chrome does.
    //
    // z-index is the one thing an embed cannot win outright on someone
    // else's page. A high explicit value, overridable with data-z, is the
    // honest mitigation — not a solution.
    var z = script.getAttribute("data-z") || "2147483000";
    iframe.style.height = "100%";

    panel = document.createElement("div");
    panel.style.position = "fixed";
    panel.style.zIndex = z;
    panel.style.display = "none";
    panel.style.overflow = "hidden";
    panel.style.boxShadow = "0 12px 40px rgba(24, 16, 48, .28)";
    panel.appendChild(iframe);

    // Mobile: under 480px the floating card becomes a full-viewport sheet —
    // inset:0, no radius — because a 380px card makes no sense pinned to the
    // corner of a 360px phone screen. Applied at load AND kept live on
    // resize/rotate, not read once: a phone opened landscape-then-rotated
    // must not get stuck on the wrong geometry.
    function applyGeometry(mobile) {
      if (mobile) {
        panel.style.inset = "0";
        panel.style.right = "";
        panel.style.bottom = "";
        panel.style.width = "100%";
        panel.style.maxWidth = "100%";
        panel.style.height = "100%";
        panel.style.borderRadius = "0";
      } else {
        panel.style.inset = "";
        panel.style.right = "16px";
        panel.style.bottom = "88px";
        panel.style.width = "380px";
        panel.style.maxWidth = "calc(100vw - 32px)";
        panel.style.height = "min(620px, calc(100vh - 120px))";
        panel.style.borderRadius = "12px";
      }
    }
    var mq = window.matchMedia ? window.matchMedia("(max-width: 480px)") : null;
    applyGeometry(mq ? mq.matches : false);
    if (mq) {
      if (mq.addEventListener) {
        mq.addEventListener("change", function (e) { applyGeometry(e.matches); });
      } else if (mq.addListener) {
        // Legacy Safari/older browsers never got addEventListener on
        // MediaQueryList.
        mq.addListener(function (e) { applyGeometry(e.matches); });
      }
    }

    launcher = document.createElement("button");
    launcher.type = "button";
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-label", script.getAttribute("data-title") || defaultTitle);
    launcher.style.position = "fixed";
    launcher.style.right = "16px";
    launcher.style.bottom = "16px";
    launcher.style.zIndex = z;
    launcher.style.width = "56px";
    launcher.style.height = "56px";
    launcher.style.borderRadius = "999px";
    launcher.style.border = "0";
    launcher.style.cursor = "pointer";
    launcher.style.background = script.getAttribute("data-color") || "#6D28D9";
    launcher.style.color = "#fff";
    launcher.style.fontSize = "22px";
    // An ES5 surrogate-pair escape for the emoji, not the ES6 codepoint-escape
    // form — a u followed by a braced hex value — this string ships verbatim
    // to browsers this file's own header comment claims to still run on.
    launcher.textContent = "\\uD83D\\uDCAC";

    setOpen = function (open) {
      panel.style.display = open ? "block" : "none";
      launcher.setAttribute("aria-expanded", open ? "true" : "false");
      // Focus follows the visitor's action: opening hands the conversation
      // to the iframe, so a keyboard user lands where they can type rather
      // than stranded on the launcher button.
      if (open && iframe.focus) iframe.focus();
    };
    launcher.addEventListener("click", function () {
      setOpen(panel.style.display === "none");
    });
    // Esc closes the overlay, on the HOST page too — the panel sits over
    // someone else's content and must behave like one. (Once the visitor is
    // typing INSIDE the iframe, this keydown listener is dead — a keydown
    // fired inside a cross-origin iframe never reaches the host window at
    // all. The chat page's own Esc handler and close button cover that case
    // by posting bis-concierge-close instead, handled below.)
    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setOpen(false);
    });

    // document.body is null when this script is pasted in <head> with no
    // async/defer — falling straight through to document.body.appendChild
    // threw a TypeError there and killed the whole IIFE, the message
    // listener included. document.documentElement always exists by the time
    // any <script> can run.
    var mountTarget = document.body || document.documentElement;
    mountTarget.appendChild(panel);
    mountTarget.appendChild(launcher);
  } else {
    iframe.style.height = (script.getAttribute("data-min-height") || minHeight) + "px";
    iframe.setAttribute("loading", "lazy");
    script.parentNode.insertBefore(iframe, script.nextSibling);
  }

  // The redirect message crosses a trust boundary: this script runs on a
  // client's page, in that page's origin. It must not assume the payload is
  // safe just because our own iframe usually sends it — a compromised or
  // buggy sender is not this script's problem to inherit. Only ever hand
  // http(s) to window.top.location; anything else (a bare "javascript:"
  // string included) is dropped. Parse defensively: a malformed or exotic
  // URL should be ignored, not throw inside the message handler.
  function isHttpUrl(url) {
    try {
      var scheme = new URL(url, window.location.href).protocol;
      return scheme === "http:" || scheme === "https:";
    } catch (e) {
      return false;
    }
  }

  window.addEventListener("message", function (event) {
    // Both checks matter. Without the source check any script or frame on the
    // host page could resize or navigate this embed.
    if (event.source !== iframe.contentWindow) return;
    if (event.origin !== origin) return;

    var data = event.data;
    if (!data || typeof data !== "object") return;

    if (concierge && data.type === "bis-concierge-close") {
      setOpen(false);
      return;
    }

    // Sent once by the chat page at load, from the same theme values it
    // paints with — self-healing on a rebrand, and per-tenant colour never
    // bakes into this cached, shared script. data-color is an explicit
    // operator override and always wins, even after this message arrives.
    //
    // A hex check, the same boundary discipline isHttpUrl already keeps for
    // the redirect message below: this crosses from an iframe into a CLIENT's
    // page, and a compromised or buggy sender is not this script's problem to
    // inherit. Only #rrggbb(-aa) ever reaches CSS, never url(...), a
    // gradient, or anything else the two properties would otherwise accept.
    var hexColor = /^#[0-9a-fA-F]{3,8}$/;
    if (concierge && data.type === "bis-concierge-brand"
        && typeof data.accent === "string" && hexColor.test(data.accent)
        && typeof data.accentForeground === "string" && hexColor.test(data.accentForeground)) {
      if (!script.getAttribute("data-color")) {
        launcher.style.background = data.accent;
        launcher.style.color = data.accentForeground;
      }
      return;
    }

    // The concierge iframe fills its panel by CSS (height: 100%), not by a
    // message — a stray or malicious bis-form-height must not resize it.
    if (!concierge && data.type === "bis-form-height" && typeof data.height === "number" && data.height > 0) {
      iframe.style.height = Math.ceil(data.height) + "px";
      return;
    }

    // A redirect fired inside the iframe would navigate the iframe. The point
    // of a redirect success mode is to move the visitor's page.
    if (data.type === "bis-form-redirect" && typeof data.url === "string" && isHttpUrl(data.url)) {
      try { window.top.location.href = data.url; }
      catch (e) { window.location.href = data.url; }
    }
  });
})();
`;
