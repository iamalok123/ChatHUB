import type { ApiErrorBody } from './types'

const API_BASE = '/api'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code = 'request_failed') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export async function readApiError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null
  try {
    body = (await response.json()) as ApiErrorBody
  } catch {
    body = null
  }
  const message = body?.error?.message ?? `Request failed with status ${response.status}`
  const code = body?.error?.code ?? 'request_failed'
  return new ApiError(message, response.status, code)
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof TypeError) {
    return 'Cannot reach the BranchMind backend. Check that it is running.'
  }
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong. Please try again.'
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers = new Headers({ Accept: 'application/json' })
  let body: string | undefined

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(options.body)
  }
  if (method !== 'GET') {
    headers.set('X-BranchMind-Request', '1')
  }

  const response = await fetch(`${API_BASE}${path}`, {
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
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    request<T>(path, { method: 'POST', body, signal }),
  patch: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    request<T>(path, { method: 'PATCH', body, signal }),
  delete: <T = void>(path: string, signal?: AbortSignal) =>
    request<T>(path, { method: 'DELETE', signal }),
}
