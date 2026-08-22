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
  if (!publicId) return;

  var origin = new URL(script.src).origin;
  var params = new URLSearchParams();

  var locale = script.getAttribute("data-locale");
  if (locale) params.set("locale", locale);

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
  iframe.src = origin + path + encodeURIComponent(publicId) + "?" + params.toString();
  iframe.style.width = "100%";
  iframe.style.border = "0";
  iframe.style.display = "block";
  iframe.style.height = (script.getAttribute("data-min-height") || minHeight) + "px";
  iframe.setAttribute("title", script.getAttribute("data-title") || defaultTitle);
  iframe.setAttribute("loading", "lazy");
  script.parentNode.insertBefore(iframe, script.nextSibling);

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

    if (data.type === "bis-form-height" && typeof data.height === "number" && data.height > 0) {
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
