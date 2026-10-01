import { UNSUBSCRIBE_MARKER } from "./shell";

/**
 * Strips shell()'s invisible `UNSUBSCRIBE_MARKER` comment before a template
 * test asserts the VISIBLE html has no "unsubscribe" text of its own (the
 * email gate writes the real footer in later, outside the template). Shared
 * by every template test that makes this exact assertion (item 5, email
 * follow-ups) instead of five copies of the same one-liner.
 */
export function withoutUnsubscribeMarker(html: string): string {
  return html.toLowerCase().replace(UNSUBSCRIBE_MARKER, "");
}
