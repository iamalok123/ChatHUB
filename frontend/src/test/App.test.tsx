import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import App from '../App'
import { useAuthStore } from '../store/auth'
import { useTraceStore } from '../store/trace'
import { useUiStore } from '../store/ui'
import { useWorkspaceStore } from '../store/workspace'

const user = {
  id: 'u1',
  email: 'ada@example.com',
  display_name: 'Ada Lovelace',
  created_at: '2026-01-01T00:00:00.000Z',
}

const space = {
  id: 's1',
  name: 'Product thinking',
  description: '',
  profile: {},
  created_at: '2026-01-01T00:00:00.000Z',
}

const branch = {
  id: 'b1',
  space_id: 's1',
  name: 'main',
  parent_branch_id: null,
  fork_commit_id: null,
  head_commit_id: 'c1',
  system_prompt: '',
  persona: '',
  model: null,
  thinking_level: 'medium',
  top_k: 6,
  memory_mode: 'review',
  color: '#C96442',
  archived: false,
  created_at: '2026-01-01T00:00:00.000Z',
  is_root: true,
  message_count: 0,
  memory_count: 0,
}

const health = {
  status: 'ok',
  version: '0.1.0',
  llm_mode: 'mock',
  provider: { name: 'mock', reachable: true },
  gemini: {
    configured: false,
    reachable: null,
    chat_model: 'gemini-3.8-flash',
    embed_model: 'gemini-embedding-001',
  },
  auth: { signup_enabled: true, session_ttl_days: 30 },
  privacy: { key_location: 'server', host: '127.0.0.1' },
}

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

function unauthorized() {
  return response({ error: { code: 'unauthorized', message: 'Authentication required' } }, 401)
}

function installFetch(authenticated: boolean) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)

    if (path.endsWith('/auth/config')) {
      return response({ signup_enabled: true, llm_mode: 'mock' })
    }
    if (path.endsWith('/health')) {
      return response(health)
    }
    if (path.endsWith('/auth/me')) {
      return authenticated ? response(user) : unauthorized()
    }
    if (path.endsWith('/spaces')) {
      return response(authenticated ? [space] : [])
    }
    if (path.endsWith('/spaces/s1/branches')) {
      return response([branch])
    }
    if (path.endsWith('/branches/b1/messages')) {
      return response([])
    }
    if (path.endsWith('/branches/b1/memories')) {
      return response({ memories: [], excluded: [] })
    }
    if (path.endsWith('/auth/login')) {
      return response({ user })
    }
    if (path.endsWith('/auth/signup')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        email: string
        display_name: string
      }
      return response(
        {
          user: {
            ...user,
            email: body.email,
            display_name: body.display_name,
          },
        },
        201,
      )
    }
    if (path.endsWith('/auth/logout')) {
      return response(null, 204)
    }
    return response({ error: { code: 'not_found', message: 'Not found' } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: 1280,
  })
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  useWorkspaceStore.getState().reset()
  useTraceStore.setState({ target: null })
  useUiStore.setState({
    theme: 'system',
    sidebarOpen: false,
    inspectorOpen: true,
    inspectorTab: 'why',
    settingsOpen: false,
    newSpaceOpen: false,
    toasts: [],
  })
  useAuthStore.setState({
    status: 'loading',
    user: null,
    config: null,
    health: null,
    healthError: null,
    bootError: null,
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('shows the branded sign-in screen and provider mode', async () => {
  installFetch(false)
  render(<App />)

  expect(await screen.findByRole('heading', { name: /sign in to your mind/i })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /create account/i })).toBeInTheDocument()
  expect(screen.getByText(/Mock AI/i)).toBeInTheDocument()
})

it('signs in and enters the workspace shell', async () => {
  const fetchMock = installFetch(false)
  const browser = userEvent.setup()
  render(<App />)

  await screen.findByRole('heading', { name: /sign in to your mind/i })
  await browser.type(screen.getByLabelText('Email'), 'ada@example.com')
  await browser.type(screen.getByLabelText('Password'), 'correct-horse')
  await browser.click(screen.getByRole('button', { name: /^sign in$/i }))

  expect(await screen.findByRole('heading', { name: /give your conversations a place to branch/i })).toBeInTheDocument()
  expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/auth/login'))).toBe(true)
})

it('signs up with a display name and enters the workspace shell', async () => {
  const fetchMock = installFetch(false)
  const browser = userEvent.setup()
  render(<App />)

  await screen.findByRole('heading', { name: /sign in to your mind/i })
  await browser.click(screen.getByRole('tab', { name: /create account/i }))
  expect(
    await screen.findByRole('heading', { name: /start a mind of your own/i }),
  ).toBeInTheDocument()

  await browser.type(screen.getByLabelText('Display name'), 'Grace Hopper')
  await browser.type(screen.getByLabelText('Email'), 'grace@example.com')
  await browser.type(screen.getByLabelText('Password'), 'compiler-1952')
  await browser.click(screen.getByRole('button', { name: /^create account$/i }))

  expect(
    await screen.findByRole('heading', { name: /give your conversations a place to branch/i }),
  ).toBeInTheDocument()
  const call = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/auth/signup'))
  expect(call).toBeTruthy()
  const init = call?.[1] as RequestInit
  expect(JSON.parse(String(init.body))).toEqual({
    email: 'grace@example.com',
    display_name: 'Grace Hopper',
    password: 'compiler-1952',
  })
  expect((init.headers as Headers).get('X-BranchMind-Request')).toBe('1')
  expect(init.credentials).toBe('include')
})

it('loads a branch shell for an authenticated session', async () => {
  installFetch(true)
  render(<App />)

  expect(await screen.findByRole('heading', { name: 'main' })).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: /this branch is ready/i })).toBeInTheDocument()
  expect(screen.getByText(/Mock AI mode/i)).toBeInTheDocument()
})

it('logs out from the sidebar and returns to the sign-in screen', async () => {
  const fetchMock = installFetch(true)
  const browser = userEvent.setup()
  render(<App />)

  await screen.findByRole('heading', { name: 'main' })
  await browser.click(screen.getByRole('button', { name: /more options/i }))
  await browser.click(screen.getByRole('button', { name: /sign out/i }))

  expect(
    await screen.findByRole('heading', { name: /sign in to your mind/i }),
  ).toBeInTheDocument()
  expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/auth/logout'))).toBe(true)
  expect(useWorkspaceStore.getState().currentSpaceId).toBeNull()
  expect(useUiStore.getState().settingsOpen).toBe(false)
})

it('uses a drawer sidebar on a narrow viewport', async () => {
  window.innerWidth = 800
  installFetch(true)
  const browser = userEvent.setup()
  render(<App />)

  await screen.findByRole('heading', { name: 'main' })
  expect(
    screen.queryByRole('complementary', { name: /workspace sidebar/i }),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: /branch inspector/i })).not.toBeInTheDocument()

  await browser.click(screen.getByRole('button', { name: /open sidebar/i }))
  const sidebar = screen.getByRole('complementary', { name: /workspace sidebar/i })
  expect(sidebar).toBeInTheDocument()

  await browser.click(within(sidebar).getByRole('button', { name: /close sidebar/i }))
  await waitFor(() => {
    expect(
      screen.queryByRole('complementary', { name: /workspace sidebar/i }),
    ).not.toBeInTheDocument()
  })
})

it('switches between dark and light themes manually', async () => {
  installFetch(false)
  const browser = userEvent.setup()
  render(<App />)

  await screen.findByRole('heading', { name: /sign in to your mind/i })
  await browser.click(screen.getByRole('button', { name: /switch to dark theme/i }))

  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(window.localStorage.getItem('branchmind-theme')).toBe('dark')

  await browser.click(screen.getByRole('button', { name: /switch to light theme/i }))

  expect(document.documentElement.dataset.theme).toBe('light')
  expect(window.localStorage.getItem('branchmind-theme')).toBe('light')
})
