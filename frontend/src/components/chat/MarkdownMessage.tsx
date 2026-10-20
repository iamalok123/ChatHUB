import { Check, Copy } from 'lucide-react'
import { isValidElement, memo, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

import { copyToClipboard } from '../../lib/clipboard'

function plainText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(plainText).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return plainText(node.props.children)
  }
  return ''
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await copyToClipboard(plainText(children).replace(/\n$/, ''))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="group/code relative my-4">
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? 'Code copied' : 'Copy code'}
        className="absolute top-2 right-2 z-10 grid size-7 place-items-center rounded-md border border-white/10 bg-white/10 text-white/70 opacity-0 backdrop-blur transition-opacity duration-150 group-hover/code:opacity-100 focus-visible:opacity-100"
      >
        {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      </button>
      <pre className="overflow-x-auto rounded-xl border border-border bg-[#1f1e1d] px-4 py-3.5 text-[12px] leading-relaxed text-[#eceae3]">
        {children}
      </pre>
    </div>
  )
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 mb-2 font-serif text-2xl tracking-tight text-ink first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-5 mb-2 font-serif text-xl tracking-tight text-ink first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-4 mb-1.5 text-[15px] font-semibold text-ink first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }) => <p className="my-3 leading-[1.75] first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-3 list-disc space-y-1.5 pl-5 marker:text-accent first:mt-0 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-decimal space-y-1.5 pl-5 marker:text-muted first:mt-0 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-accent/40 pl-4 text-muted italic">
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-accent-ink underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-6 border-border" />,
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border bg-subtle px-3 py-2 text-left font-medium text-ink">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border px-3 py-2 align-top text-muted last:border-b-0">
      {children}
    </td>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ className, children }) => <code className={className}>{children}</code>,
}

export const MarkdownMessage = memo(function MarkdownMessage({
  content,
  streaming = false,
}: {
  content: string
  streaming?: boolean
}) {
  return (
    <div
      className={
        streaming
          ? 'message-markdown is-streaming min-w-0 max-w-full font-serif text-[15px] leading-[1.75] text-ink'
          : 'message-markdown min-w-0 max-w-full font-serif text-[15px] leading-[1.75] text-ink'
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
