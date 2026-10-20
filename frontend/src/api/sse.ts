import { readApiError } from './client'

export type SseEvent = {
  event: string
  data: unknown
}

type StreamOptions = {
  method?: 'GET' | 'POST'
  body?: unknown
  signal?: AbortSignal
  onEvent: (event: SseEvent) => void
}

function parseBlock(block: string): SseEvent | null {
  let event = 'message'
  const data: string[] = []

  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    let value = separator === -1 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') event = value
    if (field === 'data') data.push(value)
  }

  if (data.length === 0) return null
  const payload = data.join('\n')
  try {
    return { event, data: JSON.parse(payload) as unknown }
  } catch {
    return { event, data: payload }
  }
}

export async function streamApi(path: string, options: StreamOptions): Promise<void> {
  const method = options.method ?? 'POST'
  const headers = new Headers({
    Accept: 'text/event-stream',
    'X-BranchMind-Request': '1',
  })
  let body: string | undefined

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(options.body)
  }

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body,
    credentials: 'include',
    cache: 'no-store',
    signal: options.signal,
  })

  if (!response.ok) {
    throw await readApiError(response)
  }
  if (!response.body) {
    throw new Error('The response did not include a stream')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const event = parseBlock(block)
      if (event) options.onEvent(event)
      boundary = buffer.indexOf('\n\n')
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) {
    const event = parseBlock(buffer)
    if (event) options.onEvent(event)
  }
}
