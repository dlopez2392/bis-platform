import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source-text pins for the DocumentsCard CONTAINER's requests poll (S-07 2b follow-up, fix round). The repo has
 * no render harness for client containers (preferences-structure.test.ts's pattern, which this copies): the
 * helpers (requestsPollMs, requestsChanged, pollTimerKey) are tested directly in documents-card.test.ts; these
 * pin the WIRING those tests cannot see. The I1 regression (an effect keyed on the ms alone, which fires once
 * and never re-arms because the ms is a constant) passed all 61 helper tests in review; these fail on it.
 * Comments are stripped first, so a pin cannot be satisfied by a commented-out line.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

function stripComments(src: string): string {
  let out = "";
  let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; i++; continue; }
      if (c === "/" && d === "*") { mode = "block"; i++; continue; }
      if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      out += c;
      continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } continue; }
    if (mode === "block") {
      if (c === "*" && d === "/") { mode = "code"; i++; } else if (c === "\n") out += c;
      continue;
    }
    if (c === "\\") { out += c + (d ?? ""); i++; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code";
    }
    out += c;
  }
  return out;
}
const src = stripComments(readFileSync(path.join(here, "documents-card.tsx"), "utf8"));
/** The container's body: the pins below must hold inside DocumentsCard, not in a helper elsewhere in the file. */
const container = src.slice(src.indexOf("export function DocumentsCard("));
/** Whitespace-insensitive: a reformat never breaks a pin, a changed token always does. */
const squash = (s: string) => s.replace(/\s+/g, " ");
const body = squash(container);

describe("the requests poll's timer (owner ruling 2026-10-16; review I1)", () => {
  it("is keyed on pollTimerKey(ms, reads), never on the ms alone (mutations: deps [requestsMs], or a key built without requestsReads -> FAILS)", () => {
    expect(body).toContain("const requestsMs = requestsPollMs(requestsLoad, hidden);");
    expect(body).toContain("const requestsPollKey = pollTimerKey(requestsMs, requestsReads);");
    expect(body).toMatch(
      /useEffect\(\(\) => \{ if \(requestsMs === null\) return; const timer = setTimeout\(\(\) => setRequestsNonce\(\(n\) => n \+ 1\), requestsMs\); return \(\) => clearTimeout\(timer\); \}, \[requestsPollKey\]\);/,
    );
  });

  it("the reads counter bumps in the requests' settle, on every outcome (mutation: drop setRequestsReads -> FAILS)", () => {
    const settle = body.slice(body.indexOf("const settle = (next: DocumentRequestsLoad) =>"), body.indexOf("fetch(requestsRoute"));
    expect(settle).toContain("setRequestsReads((r) => r + 1);");
    // Before the change check, unconditionally: an error tick still re-arms the timer.
    expect(settle.indexOf("setRequestsReads((r) => r + 1);")).toBeLessThan(settle.indexOf("if (requestsChanged("));
  });

  it("a file arriving re-reads the files once and refreshes the router once (mutation: drop router.refresh() -> FAILS)", () => {
    expect(body).toMatch(/if \(requestsChanged\(before, shownRequests\.current\.load\)\) \{ setNonce\(\(n\) => n \+ 1\); router\.refresh\(\); \}/);
  });

  it("hidden is the tab's real visibility, read through visibilitychange (mutation: hidden = false -> FAILS)", () => {
    expect(body).toContain("const hidden = useSyncExternalStore(subscribeVisibility, tabHidden, tabHiddenOnServer);");
    const s = squash(src);
    expect(s).toContain('document.addEventListener("visibilitychange", onChange);');
    expect(s).toContain('const tabHidden = () => document.visibilityState === "hidden";');
  });
});

describe("coming back to the tab re-reads at once (owner ruling 2026-10-16)", () => {
  const effect = body.slice(body.indexOf("const onVisible = () =>"), body.indexOf("}, [requestsRoute]);") + 20);

  it("listens for visibilitychange and removes the listener on cleanup (mutation: drop the listener -> FAILS)", () => {
    expect(effect).toContain('document.addEventListener("visibilitychange", onVisible);');
    expect(effect).toContain('return () => document.removeEventListener("visibilitychange", onVisible);');
  });

  it("re-reads only on becoming VISIBLE, and only while a request is open (mutations: drop the visible guard, or the open-request gate -> FAILS)", () => {
    expect(effect).toContain('if (document.visibilityState !== "visible") return;');
    expect(effect).toMatch(/if \(shown\.route === requestsRoute && requestsPollMs\(shown\.load, false\) !== null\) setRequestsNonce\(\(n\) => n \+ 1\);/);
  });
});

describe("the checklist re-reads only when a files read changed what it depends on (S-07 2c; plan review I5, M3)", () => {
  /** The FILES settle: from its declaration to its fetch. */
  const settleFrom = body.indexOf("const settle = (load: DocumentsLoad) =>");
  const settleTo = body.indexOf("fetch(route, { cache: \"no-store\" })");
  const filesSettle = settleFrom >= 0 && settleTo > settleFrom ? body.slice(settleFrom, settleTo) : "";
  it("both anchors of the files settle are found (N2: a missing anchor must fail, never slice the wrong text)", () => {
    expect(settleFrom).toBeGreaterThanOrEqual(0);
    expect(settleTo).toBeGreaterThan(settleFrom);
  });
  const GUARDED = "if (hasChecklist && shouldReloadRequirements(lastReadyFiles.current, load)) setRequirementsNonce((n) => n + 1);";

  it("the files settle bumps the checklist's read ONLY inside the shouldReloadRequirements guard (mutations: bump it on every settle, or drop the guard -> FAILS)", () => {
    expect(filesSettle).toContain(GUARDED);
    expect(filesSettle.split(GUARDED).join("")).not.toContain("setRequirementsNonce");
    // Before the last-ready read is replaced, so the guard compares against the PREVIOUS ready read.
    expect(filesSettle.indexOf(GUARDED)).toBeLessThan(filesSettle.indexOf("lastReadyFiles.current = load;"));
  });

  it("the files effect depends on the derived boolean, never on the checklist object a page re-creates each render (M3; mutation: deps [route, requestsRoute, nonce, checklist] -> FAILS)", () => {
    expect(body).toContain('const hasChecklist = checklist !== undefined && record.kind === "contact";');
    expect(body).toContain("}, [route, requestsRoute, nonce, hasChecklist]);");
    expect(body).not.toMatch(/\}, \[[^\]]*\bchecklist\b[^\]]*\]\);/);
  });

  it("the checklist has no timer of its own (mutation: a setTimeout or setInterval in its effect -> FAILS)", () => {
    // N2: both anchors must be FOUND before slicing; a missing one (-1) would slice the wrong text and pass.
    const from = body.indexOf("const settleRequirements = (next: RequirementsLoad) =>");
    const to = body.indexOf("}, [requirementsRoute, requirementsNonce]);");
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThan(from);
    const effect = body.slice(from, to);
    expect(effect).not.toMatch(/setTimeout|setInterval/);
  });
});

describe("a To-do's link focuses its file and pre-ticks Ask (S-07 3a, spec 3.2; plan deviations 5, 6)", () => {
  it("the header's Ask the customer opens with the link's category (mutation: onAsk: () => openAsk() -> FAILS)", () => {
    expect(body).toContain("onAsk: () => openAsk(askPreset(focus))");
    expect(body).not.toContain("onAsk: () => openAsk(),");
  });

  it("the focus effect runs once, only after the files are ready, only for a row it found, and sets no state (mutations: drop the once guard or the row check; a setState in the effect -> FAILS)", () => {
    const from = body.indexOf("const focusedOnce = useRef(false);");
    const to = body.indexOf("}, [focusId, filesReady]);");
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThan(from);
    const effect = body.slice(from, to);
    expect(effect).toContain("if (focusedOnce.current || !focusId || !filesReady) return;");
    expect(effect).toContain("if (!button) return;");
    expect(effect.indexOf("focusedOnce.current = true;")).toBeGreaterThan(effect.indexOf("if (!button) return;"));
    expect(effect).not.toMatch(/\bset[A-Z]\w*\(/);
  });
});
