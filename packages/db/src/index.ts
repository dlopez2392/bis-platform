export { serviceDb } from "./service";
export { userDb } from "./user-client";
export type { SupabaseClient } from "@supabase/supabase-js";
export { emit, listRecentEvents, type ActorType, type EventRow } from "./events";
export { sanitizeSearchTerm } from "./search-term";
export { createAccount, listAccounts, setClientAccess, renameAccount, getAccountByOrgId,
         setA2pRegistration, getA2pRegistration, a2pApprovalIsComplete } from "./accounts";
export type { A2pStatus, A2pRegistration, A2pRegistrationRecord } from "./accounts";
export { createContact, updateContact, listContacts, getContact,
         addTagToContact, removeTagFromContact, listContactTags, fillContactBlanks,
         countContacts, deleteContacts, addTagToContacts, removeTagFromContacts, listTags,
         type ContactInput, type SortKey, type SortDir } from "./contacts";
export { buildMatchIndex, applyImportBatch,
         type MatchIndex, type ImportRow } from "./contact-import";
export { addNote, listNotes, addTask, listContactTasks, completeTask } from "./activities";
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
         REMINDER_WINDOW_START_MS, REMINDER_WINDOW_END_MS, FOLLOWUP_QUERY_WINDOW_MS,
         type CalendarRow, type BookingRow, type BookingStatus, type CalendarSettingsPatch,
         type CreateBookingInput, type DueReminder, type DueFollowup } from "./booking";
export { getAutomation, upsertAutomation, parseReviewRequestConfig,
         listDueReviewRequests, stampReviewRequested, stampReviewRequestSmsFailed, countReviewRequestsSince,
         REVIEW_REQUEST_MAX_AGE_MS,
         parseNoShowNudgeConfig, listDueNoShowNudges, stampNoShowNudged, stampNoShowNudgeSmsFailed,
         countNoShowNudgesSince, NO_SHOW_NUDGE_MAX_AGE_MS,
         listDueSmsReminders, stampSmsReminderSent, stampSmsReminderFailed,
         SMS_REMINDER_WINDOW_START_MS, SMS_REMINDER_WINDOW_END_MS,
         parseInstantReplyConfig, stampInstantReplySent, countInstantRepliesSince,
         type RecipeKey, type AutomationRow, type ReviewRequestChannel,
         type ReviewRequestConfig, type DueReviewRequest,
         type NoShowNudgeChannel, type NoShowNudgeConfig, type DueNoShowNudge,
         type DueSmsReminder, type InstantReplyConfig } from "./automations";
export * from "./voice";
export { getSiteForAccount, upsertSite, listSitesToSync, writeTrafficDay, stampSiteSynced,
         listTrafficDays, listTrafficBreakdown, countTrafficDays, unlinkSite,
         type SiteRow, type TrafficDay, type TrafficDimension, type TrafficBreakdownRow } from "./sites";
