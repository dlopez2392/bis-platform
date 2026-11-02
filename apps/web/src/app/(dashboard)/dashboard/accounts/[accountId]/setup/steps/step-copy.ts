import type { SetupStepKey } from "@/lib/setup/setup-status";
import { m } from "@/lib/messages";

// S-10 T9b: split out of step-shared.tsx (that file's own doc comment at the
// old call site explains why), because step-shared.tsx's `NumberChip` is read
// by the client-reachable alert-phone-card.tsx (Branding), which makes the
// WHOLE FILE client-reachable to ratchet-scan.ts's import-graph closure —
// including this English-only module constant, which no client ever sees.
// Every reader of STEP_COPY (setup-panel.tsx, setup-rail.tsx,
// setup-shell.tsx) sits under the agency-only /setup route
// (requireAgencyOnlyAccountAccess), so this file is correctly exempted by
// the EXISTING reference-based mechanism (agencyOnlyFiles/agencyOnlyKeys) —
// no new exemption entry needed, just not sharing a file with NumberChip.
export const STEP_COPY: Record<SetupStepKey, { title: string; help: string }> = {
  account: { title: m["setup.step.account.title"], help: m["setup.step.account.help"] },
  branding: { title: m["setup.step.branding.title"], help: m["setup.step.branding.help"] },
  hours: { title: m["setup.step.hours.title"], help: m["setup.step.hours.help"] },
  voice_profile: {
    title: m["setup.step.voice_profile.title"], help: m["setup.step.voice_profile.help"],
  },
  website_assistant: {
    title: m["setup.step.website_assistant.title"], help: m["setup.step.website_assistant.help"],
  },
  number: { title: m["setup.step.number.title"], help: m["setup.step.number.help"] },
  email: { title: m["setup.step.email.title"], help: m["setup.step.email.help"] },
  forwarding: { title: m["setup.step.forwarding.title"], help: m["setup.step.forwarding.help"] },
  test_call: { title: m["setup.step.test_call.title"], help: m["setup.step.test_call.help"] },
  go_live: { title: m["setup.step.go_live.title"], help: m["setup.step.go_live.help"] },
};
