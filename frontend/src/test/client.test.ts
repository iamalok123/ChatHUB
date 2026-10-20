import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, errorMessage } from '../api/client'

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client', () => {
  it('sends JSON mutations with credentials and the local request header', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => response({ id: 'space-1' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await api.post('/spaces', { name: 'Research' })

    const [url, init] = fetchMock.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(url).toBe('/api/spaces')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'Research' })
    expect(headers.get('X-BranchMind-Request')).toBe('1')
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('does not add the mutation header to reads', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => response([]),
    )
    vi.stubGlobal('fetch', fetchMock)

    await api.get('/spaces')

    const [, init] = fetchMock.mock.calls[0]
    expect(new Headers(init?.headers).get('X-BranchMind-Request')).toBeNull()
  })

  it('turns the stable error envelope into an ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({ error: { code: 'not_found', message: 'Space not found' } }, 404),
      ),
    )

    const request = api.get('/spaces/missing')
    await expect(request).rejects.toBeInstanceOf(ApiError)
    await expect(request).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'Space not found',
    })
  })

  it('returns undefined for empty responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(null, 204)))

    await expect(api.delete('/spaces/space-1')).resolves.toBeUndefined()
  })

  it('labels unreachable backend failures', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toMatch(/cannot reach/i)
  })
})
