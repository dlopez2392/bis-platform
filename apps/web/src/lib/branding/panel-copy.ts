import { m } from "@/lib/messages";

/**
 * Who is reading the branding panel.
 *
 * The panel renders on two surfaces: the agency's Settings page, where it is
 * one card among several and describes a company that is not the reader's, and
 * the client's own /branding page, where the reader IS that company. Every
 * string that names whose brand it is has to change with that.
 *
 * M4c parameterised the heading and body and stopped there, so five hints kept
 * the agency's voice on the client's page. Collecting the whole set in one
 * place is what makes the omission visible — and testable, since the panel
 * itself is a .tsx and this workspace's vitest only picks up .test.ts.
 */
export type BrandingAudience = "agency" | "client";

export type PanelCopy = {
  title: string;
  description: string;
  nameHint: string;
  colorHint: string;
  neutralHint: string;
  modeHint: string;
  /** A radio OPTION label, not a hint — "Follow their device" reads as a third
   *  party's device when the reader is the company itself. */
  modeFollow: string;
};

const AGENCY: PanelCopy = {
  title: m["branding.title"],
  description: m["branding.body"],
  nameHint: m["branding.nameHint"],
  colorHint: m["branding.colorHint"],
  neutralHint: m["branding.neutralHint"],
  modeHint: m["branding.modeHint"],
  modeFollow: m["branding.modeFollow"],
};

const CLIENT: PanelCopy = {
  title: m["branding.clientTitle"],
  description: m["branding.clientBody"],
  nameHint: m["branding.clientNameHint"],
  colorHint: m["branding.clientColorHint"],
  neutralHint: m["branding.clientNeutralHint"],
  modeHint: m["branding.clientModeHint"],
  modeFollow: m["branding.clientModeFollow"],
};

export function panelCopy(audience: BrandingAudience): PanelCopy {
  return audience === "client" ? CLIENT : AGENCY;
}
