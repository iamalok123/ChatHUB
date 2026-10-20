import { RefreshCw, ServerOff } from 'lucide-react'
import { useState } from 'react'

import { Brand, BrandMark } from '../ui/Brand'
import { Button } from '../ui/Button'
import { ThemeToggle } from '../ui/ThemeToggle'
import { useAuthStore } from '../../store/auth'

export function SplashScreen() {
  return (
    <main className="grid min-h-svh place-items-center bg-bg px-6">
      <div className="flex animate-fade-in flex-col items-center">
        <BrandMark className="size-11 rounded-2xl" />
        <p className="mt-4 text-sm font-medium tracking-tight text-ink">BranchMind</p>
        <p className="mt-1 animate-soft-pulse text-[11px] text-muted">
          Opening your local workspace
        </p>
      </div>
    </main>
  )
}

export function ConnectionScreen() {
  const bootstrap = useAuthStore((state) => state.bootstrap)
  const bootError = useAuthStore((state) => state.bootError)
  const [pending, setPending] = useState(false)

  const retry = async () => {
    setPending(true)
    try {
      await bootstrap()
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="relative grid min-h-svh place-items-center bg-bg px-5 py-12">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md animate-fade-in">
        <Brand />
        <div className="mt-8 rounded-2xl border border-border bg-surface p-6 shadow-soft sm:p-7">
          <span className="mb-5 grid size-11 place-items-center rounded-xl bg-danger-soft text-danger">
            <ServerOff size={21} aria-hidden />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            The backend is out of reach
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            BranchMind could not reach its local API. Start both servers with{' '}
            <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-ink">
              ./run.ps1
            </code>{' '}
            and try again.
          </p>
          {bootError && (
            <p className="mt-4 rounded-xl border border-border bg-subtle px-3.5 py-3 text-xs leading-relaxed text-muted">
              {bootError}
            </p>
          )}
          <Button
            className="mt-6"
            onClick={retry}
            loading={pending}
            leadingIcon={!pending ? <RefreshCw size={15} aria-hidden /> : undefined}
          >
            Retry connection
          </Button>
        </div>
        <p className="mt-5 text-center text-[10px] leading-relaxed text-muted">
          Nothing leaves this machine while the backend is offline.
        </p>
      </div>
    </main>
  )
}
