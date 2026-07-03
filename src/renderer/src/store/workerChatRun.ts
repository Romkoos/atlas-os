import { createChatRunStore } from '@renderer/store/createChatRunStore'

// Full-power worker chat run (can edit code). Persisted + resumable via the
// generic factory; the subscription is hosted at App level (ChatHost).
export const useWorkerChatRun = createChatRunStore('atlas-chat-run-worker')
