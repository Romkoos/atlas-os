import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

export interface Mailbox {
  stream: AsyncIterable<SDKUserMessage>
  push: (text: string) => void
  close: () => void
}

function userMessage(text: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  }
}

// A single-consumer async queue used as the SDK's streaming-input `prompt`.
// Yields the initial message immediately, then yields each pushed reply as it
// arrives (awaiting when empty), and ends the iteration when close() is called.
export function createMailbox(initial: string): Mailbox {
  const queue: SDKUserMessage[] = [userMessage(initial)]
  let closed = false
  // Resolver for a consumer currently parked on an empty queue.
  let wake: (() => void) | null = null

  function signal() {
    if (wake) {
      const w = wake
      wake = null
      w()
    }
  }

  async function* gen(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift() as SDKUserMessage
        continue
      }
      if (closed) return
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  }

  return {
    stream: gen(),
    push: (text: string) => {
      if (closed) return
      queue.push(userMessage(text))
      signal()
    },
    close: () => {
      closed = true
      signal()
    },
  }
}
