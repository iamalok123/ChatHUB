import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { Message } from '../api/types'
import { MessageItem } from '../components/chat/MessageItem'

const { markdownSpy } = vi.hoisted(() => ({ markdownSpy: vi.fn() }))

vi.mock('../components/chat/MarkdownMessage', () => ({
  MarkdownMessage: ({ content }: { content: string }) => {
    markdownSpy(content)
    return <div>{content}</div>
  },
}))

const messages: Message[] = Array.from({ length: 500 }, (_, index) => ({
  id: `message-${index}`,
  role: 'assistant',
  content: `Answer ${index}`,
  parent_id: index === 0 ? null : `message-${index - 1}`,
  branch_id: 'branch-1',
  origin_branch_name: 'main',
  is_inherited: false,
  status: 'complete',
  created_at: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
}))

afterEach(() => {
  cleanup()
  markdownSpy.mockClear()
})

it('rerenders only the changed row in a 500-message transcript', () => {
  const onOpenTrace = vi.fn()
  const view = render(
    <>
      {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          onOpenTrace={onOpenTrace}
        />
      ))}
    </>,
  )

  expect(markdownSpy).toHaveBeenCalledTimes(500)
  markdownSpy.mockClear()

  const updated = messages.map((message, index) =>
    index === 250 ? { ...message, content: 'Edited answer' } : message,
  )

  view.rerender(
    <>
      {updated.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          onOpenTrace={onOpenTrace}
        />
      ))}
    </>,
  )

  expect(markdownSpy).toHaveBeenCalledTimes(1)
  expect(markdownSpy).toHaveBeenCalledWith('Edited answer')
})
