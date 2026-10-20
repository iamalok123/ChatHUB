import { afterEach, expect, it, vi } from 'vitest'

import { streamApi } from './sse'

const encoder = new TextEncoder()

function streamResponse(chunks: string[]): Response {
  const encoded = chunks.map((chunk) => encoder.encode(chunk))
  let index = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          index < encoded.length
            ? { done: false, value: encoded[index++] }
            : { done: true, value: undefined },
      }),
    },
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

it('parses SSE events, comments, CRLF, and a trailing block', async () => {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      streamResponse([
        ': heartbeat\n\n',
        'event: step\ndata: {"name":"retrieve","status":"running"}\n\n',
        'event: token\r\ndata: {"text":"Hello"}\r\n\r\n',
        'event:token\ndata: [1,2]\n\n',
        'event: done\ndata: {"ok":true}',
      ]),
  )
  vi.stubGlobal('fetch', fetchMock)
  const events: Array<{ event: string; data: unknown }> = []

  await streamApi('/branches/b1/chat', {
    body: { message: 'Hi' },
    onEvent: (event) => events.push(event),
  })

  expect(events).toEqual([
    { event: 'step', data: { name: 'retrieve', status: 'running' } },
    { event: 'token', data: { text: 'Hello' } },
    { event: 'token', data: [1, 2] },
    { event: 'done', data: { ok: true } },
  ])

  const [url, init] = fetchMock.mock.calls[0]
  const headers = new Headers(init?.headers)
  expect(url).toBe('/api/branches/b1/chat')
  expect(init?.method).toBe('POST')
  expect(init?.credentials).toBe('include')
  expect(JSON.parse(String(init?.body))).toEqual({ message: 'Hi' })
  expect(headers.get('Accept')).toBe('text/event-stream')
  expect(headers.get('X-BranchMind-Request')).toBe('1')
})

it('keeps non-JSON data as text', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => streamResponse(['event: notice\ndata: maintenance soon\n\n'])),
  )
  const onEvent = vi.fn()

  await streamApi('/branches/b1/chat', { onEvent })

  expect(onEvent).toHaveBeenCalledWith({
    event: 'notice',
    data: 'maintenance soon',
  })
})
