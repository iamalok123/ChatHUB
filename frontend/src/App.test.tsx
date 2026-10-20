import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        llm_mode: 'mock',
        gemini: { configured: false },
      }),
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('renders the BranchMind shell and reports provider mode', async () => {
  render(<App />)
  expect(screen.getByText(/Conversations branch/i)).toBeInTheDocument()
  expect(await screen.findByText(/Mock mode/)).toBeInTheDocument()
})
