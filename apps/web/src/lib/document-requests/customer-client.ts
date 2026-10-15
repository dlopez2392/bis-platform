import type { MessageKey } from "@/lib/messages";
import { prepareFile, xhrPut } from "@/lib/documents/upload-core";
import { stripImage } from "@/lib/documents/strip-image";

/**
 * One customer file's journey (spec 4.3, 4.4; part 1's V6): prepare (an image redrawn without its
 * location data, the size checked AS STORED), start (the server reserves under the request), PUT the
 * bytes straight to storage (retried once, spec 6), finish (the server checks and scans them). Every
 * answer is a phase the page words; nothing here names a file. Browser-safe: no server action, no
 * barrel import.
 */
export type CustomerPhase =
  | { kind: "uploading"; percent: number }
  | { kind: "checking" }
  | { kind: "received" }
  | { kind: "refused"; why: MessageKey; params?: Record<string, string> }
  | { kind: "closed" }
  | { kind: "failed" };

export type CustomerDeps = {
  post: (path: string, body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
  put: typeof xhrPut;
  strip: typeof stripImage;
};

const refused = (why: MessageKey, params?: Record<string, string>): CustomerPhase =>
  (params ? { kind: "refused", why, params } : { kind: "refused", why });
/** The request itself is shut (the routes' 404/410 words): the page re-reads and turns into its dead end. */
const CLOSED = new Set(["expired", "revoked", "completed", "not_found"]);
const FAILED: CustomerPhase = { kind: "failed" };

function startRefusal(body: Record<string, unknown>): CustomerPhase {
  const error = body.error;
  if (typeof error === "string" && CLOSED.has(error)) return { kind: "closed" };
  if (error === "bad_type") return refused("customerDocs.why.type");
  if (error === "too_large") return refused("customerDocs.why.size");
  if (error === "rate_limited") return refused("customerDocs.why.limit");
  if (error === "over_quota") {
    return typeof body.phone === "string" ? refused("customerDocs.why.full", { phone: body.phone }) : refused("customerDocs.why.fullNoPhone");
  }
  return FAILED;
}

function finishRefusal(body: Record<string, unknown>): CustomerPhase {
  const error = body.error;
  if (typeof error === "string" && CLOSED.has(error)) return { kind: "closed" };
  if (error === "bad_type") return refused("customerDocs.why.type");
  return FAILED;
}

const FINISHED: Readonly<Record<string, CustomerPhase>> = {
  received: { kind: "received" },
  checking: { kind: "checking" },
  virus: { kind: "refused", why: "customerDocs.why.virus" },
  password: { kind: "refused", why: "customerDocs.why.password" },
  unscannable: { kind: "refused", why: "customerDocs.why.unscannable" },
};

export async function uploadCustomerFile(
  token: string, itemKey: string, file: File, deps: CustomerDeps, onPhase: (p: CustomerPhase) => void,
): Promise<CustomerPhase> {
  const prepared = await prepareFile(file, deps.strip);
  if (!prepared.ok) {
    if (prepared.error === "documents.error.badType") return refused("customerDocs.why.type");
    if (prepared.error === "documents.error.tooLarge") return refused("customerDocs.why.size");
    return FAILED;
  }
  const base = `/api/d/${encodeURIComponent(token)}`;
  const start = await deps.post(`${base}/start`, {
    itemKey, name: file.name, size: prepared.blob.size, contentType: prepared.contentType,
  }).catch(() => null);
  if (!start) return FAILED;
  if (start.status !== 200) return startRefusal(start.body);
  const { documentId, versionId, uploadUrl } = start.body;
  if (typeof documentId !== "string" || typeof versionId !== "string" || typeof uploadUrl !== "string") return FAILED;

  const progress = (percent: number) => onPhase({ kind: "uploading", percent });
  onPhase({ kind: "uploading", percent: 0 });
  // Spec 6: a failed PUT is retried once, to the same signed URL; then "Didn't upload. Try again."
  const putOnce = () => deps.put(uploadUrl, prepared.blob, prepared.contentType, progress).catch(() => false);
  const put = (await putOnce()) || (await putOnce());
  if (!put) return FAILED;

  onPhase({ kind: "checking" });
  const finish = await deps.post(`${base}/finish`, { documentId, versionId }).catch(() => null);
  if (!finish) return FAILED;
  if (finish.status !== 200) return finishRefusal(finish.body);
  return FINISHED[String(finish.body.state)] ?? FAILED;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The browser's own deps. `redirect: "error"`: a redirect (an auth wall, a captive portal) is a failure,
 * never a 200 HTML page read as an answer (2a's defect). `cache: "no-store"`: every answer is this
 * moment's. A body that is not a JSON object reads as `{}`, so no caller ever throws reading it.
 */
export const browserCustomerDeps = (): CustomerDeps => ({
  post: async (path, body) => {
    const res = await fetch(path, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body), cache: "no-store", redirect: "error",
    });
    const json: unknown = await res.json().catch(() => ({}));
    return { status: res.status, body: isObj(json) ? json : {} };
  },
  put: xhrPut,
  strip: stripImage,
});
