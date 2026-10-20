import { useEffect } from 'react'

import { useUiStore } from '../../store/ui'

function hasOpenDialog(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

export function GlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return
      if (!event.metaKey && !event.ctrlKey) return
      const key = event.key.toLowerCase()
      if (key !== 'k' && key !== 'b') return
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
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return null
}
