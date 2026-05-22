import Anthropic from '@anthropic-ai/sdk'
import { getApiKey } from '@main/store'

export interface StreamResult {
  text: string
  inputTokens: number
  outputTokens: number
}

export interface StreamOptions {
  prompt: string
  model: string
  signal: AbortSignal
  onToken: (text: string) => void
}

const MAX_TOKENS = 1024

export async function streamCompletion(opts: StreamOptions): Promise<StreamResult> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('No Anthropic API key set. Add it in Settings.')
  }

  const client = new Anthropic({ apiKey })
  const stream = client.messages.stream(
    {
      model: opts.model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: opts.prompt }],
    },
    { signal: opts.signal },
  )

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      opts.onToken(event.delta.text)
    }
  }

  const final = await stream.finalMessage()
  const text = final.content.map((block) => (block.type === 'text' ? block.text : '')).join('')

  return {
    text,
    inputTokens: final.usage.input_tokens,
    outputTokens: final.usage.output_tokens,
  }
}
