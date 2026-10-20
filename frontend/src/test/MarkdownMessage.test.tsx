import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { MarkdownMessage } from '../components/chat/MarkdownMessage'

afterEach(() => {
  cleanup()
})

it('renders safe markdown, highlighted code, links, and tables', () => {
  const { container } = render(
    <MarkdownMessage
      content={[
        '## A clear answer',
        '',
        'A **bold** idea with `inline code`.',
        '',
        '```ts',
        'const answer = 42',
        '```',
        '',
        '| Name | Value |',
        '| --- | --- |',
        '| Branch | main |',
        '',
        '[Docs](https://example.com)',
      ].join('\n')}
    />,
  )

  expect(screen.getByRole('heading', { name: 'A clear answer' })).toBeInTheDocument()
  expect(screen.getByText('bold')).toBeInTheDocument()
  expect(screen.getByText('inline code')).toBeInTheDocument()
  expect(screen.getByRole('table')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute(
    'href',
    'https://example.com',
  )
  expect(container.querySelector('pre code')?.textContent).toContain('const answer = 42')
  expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
})

it('adds the streaming caret class only while streaming', () => {
  const { container, rerender } = render(
    <MarkdownMessage content="Still writing" streaming />,
  )
  expect(container.querySelector('.message-markdown')).toHaveClass('is-streaming')

  rerender(<MarkdownMessage content="Still writing" />)
  expect(container.querySelector('.message-markdown')).not.toHaveClass('is-streaming')
})
