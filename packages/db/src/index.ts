export { serviceDb } from "./service";
export { userDb } from "./user-client";
export type { SupabaseClient } from "@supabase/supabase-js";
export { emit, type ActorType } from "./events";
export { createAccount, listAccounts, setClientAccess, getAccountByOrgId } from "./accounts";
export { createContact, updateContact, listContacts, getContact,
         addTagToContact, removeTagFromContact, listContactTags,
         type ContactInput } from "./contacts";
export { addNote, listNotes, addTask, listContactTasks, completeTask } from "./activities";
export { listCustomFields, createCustomField, listCustomValues, upsertCustomValue,
         ensureDefaultPipeline, listPipelinesWithStages, type CustomFieldDef } from "./crm-config";
export { createOpportunity, moveOpportunityStage, moveOpportunityToStage,
         updateOpportunity, setOpportunityStatus,
         listBoard, listContactOpportunities } from "./opportunities";
export { ensureConversation, createMessage, updateMessageStatus,
         updateMessageStatusByProviderId, listConversations, listMessages, listContactMessages,
         incrementUnreadCount, clearUnreadCount,
         type MessageStatus, type NewMessage, type ConversationSummary } from "./messaging";
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
export { uploadBrandLogo, removeBrandLogo, brandLogoUrl, setBranding, getBranding,
         type Branding } from "./branding";
export { getSendingIdentity, setFromEmail, type SendingIdentity } from "./sending-identity";
export { getOrCreateCalendar, getCalendarForAccount, getCalendarByPublicId, updateCalendarSettings,
         listBookedRanges, createBooking, cancelBookingByToken, setBookingStatus,
         listUpcomingBookings, countRecentBookings, listDueReminders, stampReminderSent,
         newCancelToken, SlotTakenError,
         type CalendarRow, type BookingRow, type BookingStatus, type CalendarSettingsPatch,
         type CreateBookingInput, type DueReminder } from "./booking";
export * from "./voice";
