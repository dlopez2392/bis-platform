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

  "empty.conversations.title": "Conversations are coming in M1b",
  "empty.conversations.body": "Unified SMS and email threads will land here.",
  "empty.calendar.title": "Calendar is coming in M1b",
  "empty.calendar.body": "Booking and appointment management will land here.",
} as const;

export type MessageKey = keyof typeof m;
