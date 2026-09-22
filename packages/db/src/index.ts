export { serviceDb } from "./service";
export { userDb } from "./user-client";
export type { SupabaseClient } from "@supabase/supabase-js";
export { emit, listRecentEvents, type ActorType, type EventRow } from "./events";
export { sanitizeSearchTerm } from "./search-term";
export { createAccount, listAccounts, setClientAccess, renameAccount, getAccountByOrgId,
         setA2pRegistration, getA2pRegistration, a2pApprovalIsComplete } from "./accounts";
export type { A2pStatus, A2pRegistration, A2pRegistrationRecord } from "./accounts";
export { getAlertPhone, setAlertPhone } from "./accounts";
export { getTransferPhone, setTransferPhone } from "./accounts";
export { ALERT_CODE_DIGITS, ALERT_CODE_MAX_ATTEMPTS, ALERT_CODE_TTL_MINUTES,
         generateAlertCode, hashAlertCode, ALERT_CODE_MAX_SENDS_PER_HOUR,
         countRecentAlertPhoneVerifications, startAlertPhoneVerification,
         discardAlertPhoneVerification,
         verifyAlertPhoneCode, type AlertPhoneVerificationOutcome } from "./alert-phone-verification";
export { createContact, updateContact, listContacts, getContact,
         addTagToContact, removeTagFromContact, listContactTags, fillContactBlanks,
         countContacts, deleteContacts, addTagToContacts, removeTagFromContacts, listTags,
         type ContactInput, type SortKey, type SortDir } from "./contacts";
export { buildMatchIndex, applyImportBatch,
         type MatchIndex, type ImportRow } from "./contact-import";
export { addNote, listNotes, addTask, listContactTasks, completeTask, reopenTask } from "./activities";
export { listAccountWork, listAgencyWork, type WorkRow, type WorkSource, type AgencyWorkRow } from "./work-queue";
export { listCustomFields, createCustomField, listCustomValues, upsertCustomValue,
         ensureDefaultPipeline, listPipelinesWithStages, type CustomFieldDef } from "./crm-config";
export { createOpportunity, moveOpportunityStage, moveOpportunityToStage,
         updateOpportunity, setOpportunityStatus,
         listBoard, listContactOpportunities,
         listOpportunityValuesCreatedBetween } from "./opportunities";
export { ensureConversation, createMessage, updateMessageStatus,
         updateMessageStatusByProviderId, findMessageByProviderId, hasRecentOutboundSms,
         listFailedOutboundSms,
         listConversations, listMessages,
         listContactMessages, incrementUnreadCount, clearUnreadCount,
         type MessageStatus, type NewMessage, type ConversationSummary,
         type FailedOutboundSms, type TextbackWindow,
         sumUnreadCount, searchConversations } from "./messaging";
// NOTE: searchCalls needs no line here — voice is `export * from "./voice"` below.
export { newPublicId, createForm, listForms, getForm, getPublishedFormByPublicId,
         updateForm, createSubmission, recordRejectedSubmission, countRecentSubmissions,
         countRealSubmissionsBetween,
         shouldRecordRateLimit, findRecentDuplicate, linkSubmissionContact,
         setSubmissionProcessingError, emitFormSubmitted, listSubmissions, listContactSubmissions,
         countFormsMissingNotify,
         type FormField, type FormFieldKind, type FormTheme, type FormStatus,
         type FormRow, type FormSummary,
         type SubmissionInput, type SubmissionRow, type SubmissionConsent } from "./forms";
export { captureBlueprint, listBlueprints, getBlueprint, blueprintKey, applyBlueprint,
         BUNDLE_SCHEMA_VERSION,
         type BlueprintBundle, type BlueprintRow, type BlueprintSummary, type ApplyReport } from "./blueprints";
export { listChecklistState, setChecklistItem, addCustomChecklistItem,
         type ChecklistStateRow } from "./checklist";
export { uploadBrandLogo, removeBrandLogo, brandLogoUrl, setBranding, getBranding, brandDisplayName,
         type Branding } from "./branding";
export { getSendingIdentity, setFromEmail, type SendingIdentity } from "./sending-identity";
export { getOrCreateCalendar, getCalendarForAccount, getCalendarByPublicId, updateCalendarSettings,
         listBookedRanges, createBooking, cancelBookingByToken, setBookingStatus,
         listUpcomingBookings, countRecentBookings, listDueReminders, stampReminderSent,
         listDueFollowups, stampFollowupSent, listBookingCreationsBetween,
         newCancelToken, SlotTakenError,
         getDueReminderById, getDueFollowupById,
         REMINDER_WINDOW_START_MS, REMINDER_WINDOW_END_MS, FOLLOWUP_QUERY_WINDOW_MS,
         type CalendarRow, type BookingRow, type BookingStatus, type CalendarSettingsPatch,
         type CreateBookingInput, type DueReminder, type DueFollowup, type DueLookup } from "./booking";
export { getAutomation, upsertAutomation, parseReviewRequestConfig,
         listDueReviewRequests, stampReviewRequested, stampReviewRequestSmsFailed, countReviewRequestsSince,
         REVIEW_REQUEST_MAX_AGE_MS,
         parseNoShowNudgeConfig, listDueNoShowNudges, stampNoShowNudged, stampNoShowNudgeSmsFailed,
         countNoShowNudgesSince, NO_SHOW_NUDGE_MAX_AGE_MS,
         listDueSmsReminders, stampSmsReminderSent, stampSmsReminderFailed,
         SMS_REMINDER_WINDOW_START_MS, SMS_REMINDER_WINDOW_END_MS,
         parseInstantReplyConfig, stampInstantReplySent, countInstantRepliesSince,
         getDueReviewRequestById, getDueNoShowNudgeById, getDueSmsReminderById,
         listDueAppointmentConfirms, getDueAppointmentConfirmById,
         stampAppointmentConfirmAsked, stampAppointmentConfirmSmsFailed,
         matchConfirmationReply, applyConfirmationReply,
         APPOINTMENT_CONFIRM_WINDOW_START_MS, APPOINTMENT_CONFIRM_WINDOW_END_MS,
         APPOINTMENT_CONFIRM_MIN_LEAD_MS,
         type DueAppointmentConfirm, type ConfirmationAnswer,
         type RecipeKey, type AutomationRow, type ReviewRequestChannel,
         type ReviewRequestConfig, type DueReviewRequest,
         type NoShowNudgeChannel, type NoShowNudgeConfig, type DueNoShowNudge,
         type DueSmsReminder, type InstantReplyConfig } from "./automations";
export * from "./voice";
export * from "./screened-calls";
export { getSiteForAccount, upsertSite, listSitesToSync, writeTrafficDay, stampSiteSynced,
         listTrafficDays, listTrafficBreakdown, countTrafficDays, unlinkSite,
         type SiteRow, type TrafficDay, type TrafficDimension, type TrafficBreakdownRow } from "./sites";
export * from "./weekly-report";
export * from "./automation-log";
export * from "./automation-settings";

// The demo tenant's fiction — data only, no seeder. `seed.ts` deliberately
// stays out of the package's public surface: it DELETES the account it finds,
// and nothing in apps/web has any business reaching it. The one export the
// app genuinely needs is the forwarding tick key, which
// setup-status.test.ts asserts against its own copy so the two cannot drift.
export {
  DEMO_ORG_ID, DEMO_ACCOUNT_NAME, DEMO_TIMEZONE, DEMO_BRAND_COLOR,
  DEMO_BUSINESS_LINE, DEMO_FROM_EMAIL, DEMO_OPEN_HOURS,
  DEMO_FORWARDING_TICK_KEY,
} from "./demo/fiction";
export * from "./timezone";
export * from "./zone-resolution";
export {
  insertProposal, listProposalsForCall, listPendingProposals, getProposal,
  markProposalDecided, listPendingProposalsForAgency,
  type CallProposal, type ProposalKind, type ProposalStatus,
  type ProposalPayload, type ProposalInput, type TaskPayload,
  type ContactFieldPayload, type OpportunityStagePayload,
} from "./call-proposals";
export * from "./voice-web-sessions";
export * from "./concierge";
