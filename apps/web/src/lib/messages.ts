export const m = {
  "nav.dashboard": "Dashboard",
  "nav.contacts": "Contacts",
  "nav.opportunities": "Opportunities",
  "nav.conversations": "Conversations",
  "nav.calendar": "Calendar",
  "nav.settings": "Settings",
  "nav.accounts": "Companies",

  "shell.brand": "BIS",
  "shell.switchAccount": "Switch company",
  "shell.searchAccounts": "Search companies…",
  "shell.noAccounts": "No companies yet",
  "shell.search": "Search",
  "shell.collapse": "Collapse sidebar",
  "shell.expand": "Expand sidebar",

  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.add": "Add",
  "common.import": "Import",
  "common.filters": "Filters",
  "common.sort": "Sort",
  "common.none": "—",
  "common.saving": "Saving…",
  "common.unavailable": "—",

  "empty.conversations.title": "Conversations are coming in M1b",
  "empty.conversations.body": "Unified SMS and email threads will land here.",
  "empty.calendar.title": "Calendar is coming in M1b",
  "empty.calendar.body": "Booking and appointment management will land here.",

  "accounts.title": "Companies",
  "accounts.add": "Add company",
  "accounts.name": "Business name",
  "accounts.timezone": "Timezone",
  "accounts.empty.title": "No companies yet",
  "accounts.empty.body": "Add your first company to start tracking contacts and deals.",
  "accounts.created": "Added {date}",
  "accounts.createFailed": "Could not create that company. Check the name and try again.",

  "dashboard.title": "Dashboard",
  "dashboard.companies": "Companies",
  "dashboard.contacts": "Contacts",
  "dashboard.openOpps": "Open opportunities",
  "dashboard.pipelineValue": "Pipeline value",

  "account.dashboard.title": "Dashboard",
  "account.contacts": "Contacts",
  "account.openOpps": "Open opportunities",
  "account.pipelineValue": "Pipeline value",
} as const;

export type MessageKey = keyof typeof m;
