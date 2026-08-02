export { serviceDb } from "./service";
export { userDb } from "./user-client";
export { emit, type ActorType } from "./events";
export { createAccount, listAccounts } from "./accounts";
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
         updateMessageStatusByProviderId, listConversations, listMessages,
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
