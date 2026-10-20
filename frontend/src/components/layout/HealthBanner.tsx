import { RefreshCw, Sparkles, TriangleAlert } from 'lucide-react'

import { useAuthStore } from '../../store/auth'
import { IconButton } from '../ui/IconButton'

export function HealthBanner() {
  const health = useAuthStore((state) => state.health)
  const healthError = useAuthStore((state) => state.healthError)
  const refreshHealth = useAuthStore((state) => state.refreshHealth)

  if (!health && healthError) {
    return (
      <div className="flex items-center gap-2.5 border-b border-danger/20 bg-danger-soft px-4 py-2 text-[11px] text-danger">
        <TriangleAlert size={14} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          AI status is unavailable. {healthError}
        </span>
        <button
          type="button"
          onClick={() => void refreshHealth()}
          className="shrink-0 font-medium underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!health) return null

  if (health.gemini.configured && health.gemini.reachable === false) {
    return (
      <div className="flex items-center gap-2.5 border-b border-danger/20 bg-danger-soft px-4 py-2 text-[11px] text-danger">
        <TriangleAlert size={14} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          Gemini is configured but unreachable. New replies may fail.
        </span>
        <IconButton
          label="Retry AI health check"
          className="size-6 text-danger hover:bg-danger/10 hover:text-danger"
          onClick={() => void refreshHealth()}
        >
          <RefreshCw size={13} aria-hidden />
        </IconButton>
      </div>
    )
  }

  if (health.llm_mode === 'mock') {
    return (
      <div className="flex items-center gap-2.5 border-b border-warning/20 bg-warning-soft px-4 py-2 text-[11px] text-warning">
        <Sparkles size={14} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          Mock AI mode. Replies and memories are generated locally and labelled as mock.
        </span>
        <span className="hidden shrink-0 rounded-full border border-warning/20 px-2 py-0.5 text-[10px] sm:inline">
          No key
        </span>
      </div>
    )
  }

  return null
}
