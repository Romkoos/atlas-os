import { createChatRunStore } from '@renderer/store/createChatRunStore'

// General free-form chat run. Persisted + resumable via the generic factory;
// the subscription is hosted at App level (ChatHost).
export const useGeneralChatRun = createChatRunStore('atlas-chat-run-general')

export type { ChatEntry as GeneralChatEntry } from '@renderer/store/createChatRunStore'
