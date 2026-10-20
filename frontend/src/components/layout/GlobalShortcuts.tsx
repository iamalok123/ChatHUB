import { useEffect } from 'react'

import { useUiStore } from '../../store/ui'
import { selectCurrentBranch, useWorkspaceStore } from '../../store/workspace'

function hasOpenDialog(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

export function GlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return
      if (!event.metaKey && !event.ctrlKey) return
      const key = event.key.toLowerCase()
      if (key !== 'k' && key !== 'b' && key !== '.') return
      const ui = useUiStore.getState()

      if (key === 'k') {
        if (!ui.paletteOpen && hasOpenDialog()) return
        event.preventDefault()
        ui.setPaletteOpen(!ui.paletteOpen)
        return
      }

      if (ui.paletteOpen || hasOpenDialog()) return

      if (key === 'b') {
        event.preventDefault()
        const desktop = window.matchMedia('(min-width: 900px)').matches
        if (desktop) {
          ui.setSidebarCollapsed(!ui.sidebarCollapsed)
        } else {
          ui.setSidebarOpen(!ui.sidebarOpen)
        }
        return
      }

      const branch = selectCurrentBranch(useWorkspaceStore.getState())
      if (key === '.' && branch) {
        event.preventDefault()
        ui.setInspectorOpen(!ui.inspectorOpen)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return null
}
