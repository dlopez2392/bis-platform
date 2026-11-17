import { shell, escapeHtml, type EmailBrand } from "./shell";
import { briefHeading, briefOff, briefSections, briefSubject, type BriefLink } from "@/lib/brief/brief-copy";
import type { BriefContent } from "@/lib/brief/brief-content";

export type DailyBriefInput = {
  brand: EmailBrand;
  content: BriefContent;
  /** The dashboard pages the sections point at, absolute (origin from the tick, never a vercel.app one). */
  links: Record<BriefLink, string>;
  /** The signed "turn this off" page (lib/brief/token.ts). */
  offUrl: string;
};

const MUTED = "color:#71717a;";
const LINK = "color:#18181b;text-decoration:underline;";

/**
 * The 7 AM email (F-082). All words come from brief-copy.ts, filled from BriefContent (which holds what the owner
 * line's own reads said), so this file only decides how they sit in html and in plain text. Operator mail: the gate
 * removes the shell's footer marker and adds no footer of its own, so the way off is written here, in the body.
 * The text part is composed on purpose rather than stripped from the html.
 */
export function dailyBriefEmail(input: DailyBriefInput): { subject: string; html: string; text: string } {
  const { content, links, offUrl } = input;
  const sections = briefSections(content);
  const off = briefOff(content.locale);
  const heading = briefHeading(content);

  const htmlSections = sections.map((s) => [
    `<p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:.02em;${MUTED}">${escapeHtml(s.title)}</p>`,
    ...s.lines.map((l) => `<p style="margin:0 0 4px;">${escapeHtml(l)}</p>`),
    `<p style="margin:4px 0 20px;"><a href="${escapeHtml(links[s.link])}" style="${LINK}">${escapeHtml(s.linkLabel)}</a></p>`,
  ].join("")).join("");

  const html = shell(input.brand, [
    `<p style="margin:0 0 16px;font-size:17px;font-weight:600;">${escapeHtml(heading)}</p>`,
    htmlSections,
    `<p style="margin:8px 0 0;font-size:13px;line-height:1.5;${MUTED}">${escapeHtml(off.lead)} `
    + `<a href="${escapeHtml(offUrl)}" style="${MUTED}text-decoration:underline;">${escapeHtml(off.link)}</a></p>`,
  ].join(""));

  const text = [
    heading,
    ...sections.map((s) => [s.title, ...s.lines, `${s.linkLabel}: ${links[s.link]}`].join("\n")),
    `${off.lead}\n${off.link}: ${offUrl}`,
  ].join("\n\n");

  return { subject: briefSubject(content), html, text };
}
