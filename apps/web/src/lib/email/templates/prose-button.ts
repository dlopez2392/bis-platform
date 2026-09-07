import { shell, escapeHtml, button, type EmailBrand } from "./shell";

/**
 * The operator's prose as paragraphs, then ONE call to action as a button
 * — the shape the review request established, shared with the no-show
 * nudge so the two cannot drift. Blank lines are paragraph breaks (the
 * follow-up template's rule); the text part is composed from the same
 * paragraph list, never by stripping tags, and carries the bare link for
 * text-only clients.
 */
export function proseWithButton(
  brand: EmailBrand, body: string, href: string, label: string,
): { html: string; text: string } {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const html = shell(
    brand,
    paragraphs.map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p)}</p>`).join("")
    + `<p style="margin:16px 0 0;">${button(brand, href, label)}</p>`,
  );
  const text = `${paragraphs.join("\n\n")}\n\n${href}`;
  return { html, text };
}
