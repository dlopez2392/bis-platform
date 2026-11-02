// S-10 T9b (owner decision Q4, 2026-10-31): an agency-only screen, English
// for every reader, so its page, loading and error UI sit in lang="en"
// whatever the shell around them reads (components/english-only.tsx).
// Checked route by route in lib/i18n/agency-only-lang.test.ts.
export { EnglishOnlyLayout as default } from "@/components/english-only";
