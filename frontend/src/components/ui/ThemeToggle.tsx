import { Moon, Sun } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { useUiStore } from '../../store/ui'
import { IconButton } from './IconButton'

const darkQuery = '(prefers-color-scheme: dark)'

export function subscribeToSystemTheme(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined
  const media = window.matchMedia(darkQuery)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(darkQuery).matches
}

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark, () => false)
  const effective = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
  const label = effective === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'

  return (
    <IconButton
      label={label}
      className={className}
      onClick={() => setTheme(effective === 'dark' ? 'light' : 'dark')}
    >
      {effective === 'dark' ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
    </IconButton>
  )
}
