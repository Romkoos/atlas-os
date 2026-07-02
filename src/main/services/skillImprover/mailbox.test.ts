import { createMailbox } from '@main/services/skillImprover/mailbox'
import { describe, expect, it } from 'vitest'

async function collect(mb: ReturnType<typeof createMailbox>): Promise<string[]> {
  const out: string[] = []
  for await (const msg of mb.stream) {
    const content = msg.message.content
    out.push(typeof content === 'string' ? content : JSON.stringify(content))
  }
  return out
}

describe('createMailbox', () => {
  it('yields the initial message then pushed replies in order, completing on close', async () => {
    const mb = createMailbox('first')
    const collected = collect(mb)
    mb.push('second')
    mb.push('third')
    mb.close()
    expect(await collected).toEqual(['first', 'second', 'third'])
  })

  it('each yielded message is a well-formed SDKUserMessage', async () => {
    const mb = createMailbox('hello')
    mb.close()
    const first = (await mb.stream[Symbol.asyncIterator]().next()).value
    expect(first.type).toBe('user')
    expect(first.message.role).toBe('user')
    expect(first.message.content).toBe('hello')
    expect(first.parent_tool_use_id).toBeNull()
  })
})

describe('createMailbox empty start', () => {
  it('yields nothing until push when no initial is given', async () => {
    const mailbox = createMailbox()
    const iter = mailbox.stream[Symbol.asyncIterator]()
    const pending = iter.next()
    mailbox.push('first reply')
    const first = await pending
    expect(first.done).toBe(false)
    expect(first.value.message.content).toBe('first reply')
  })

  it('ends immediately when closed before any push', async () => {
    const mailbox = createMailbox()
    const iter = mailbox.stream[Symbol.asyncIterator]()
    const pending = iter.next()
    mailbox.close()
    expect((await pending).done).toBe(true)
  })
})
