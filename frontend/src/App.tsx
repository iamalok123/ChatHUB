import { GitBranch, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

type Health = {
  status: string
  llm_mode: string
  gemini: { configured: boolean }
}

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error('unhealthy')
        return response.json() as Promise<Health>
      })
      .then(setHealth)
      .catch(() => setError(true))
  }, [])

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-accent text-white">
            <GitBranch size={20} aria-hidden />
          </span>
          <span className="text-lg font-semibold tracking-tight">BranchMind</span>
        </div>
        <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
          Local-first
        </span>
      </header>

      <section className="flex flex-1 flex-col justify-center py-16">
        <p className="mb-4 text-sm font-medium text-accent">Git for chatbot memory</p>
        <h1 className="max-w-3xl font-serif text-5xl leading-[1.05] tracking-tight text-ink sm:text-6xl">
          Conversations branch. Memory should too.
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-muted">
          Fork any message, choose which memories carry over, merge what you learned, and see
          exactly why every answer happened.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm">
            <Sparkles size={16} className="text-accent" aria-hidden />
            {error
              ? 'Backend offline'
              : health
                ? `${health.llm_mode === 'mock' ? 'Mock mode' : 'Gemini mode'} · ${health.gemini.configured ? 'key configured' : 'no key'}`
                : 'Checking backend…'}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm">
            <ShieldCheck size={16} className="text-accent" aria-hidden />
            Private to this machine
          </span>
        </div>
      </section>

      <footer className="border-t border-border pt-5 text-xs text-muted">
        Phase 0 scaffold. Authentication, branching, and memory controls are on the way.
      </footer>
    </main>
  )
}

export default App
