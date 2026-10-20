import { useEffect } from 'react'

import { AuthScreen } from './auth/AuthScreen'
import { AppShell } from './components/layout/AppShell'
import {
  ConnectionScreen,
  SplashScreen,
} from './components/layout/StatusScreens'
import { Toaster } from './components/ui/Toaster'
import { useAuthStore } from './store/auth'
import { applyTheme, useUiStore } from './store/ui'

function App() {
  const status = useAuthStore((state) => state.status)
  const bootstrap = useAuthStore((state) => state.bootstrap)
  const theme = useUiStore((state) => state.theme)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => applyTheme('system')
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [theme])

  return (
    <>
      {status === 'loading' && <SplashScreen />}
      {status === 'offline' && <ConnectionScreen />}
      {status === 'anonymous' && <AuthScreen />}
      {status === 'authenticated' && <AppShell />}
      <Toaster />
    </>
  )
}

export default App
