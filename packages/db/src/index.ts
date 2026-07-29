export { serviceDb } from "./service";
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
         type MessageStatus, type NewMessage, type ConversationSummary } from "./messaging";
